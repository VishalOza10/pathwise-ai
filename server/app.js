import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loginSchema, logoutSchema, idSchema, completionSchema, alertSchema, assistantSchema } from '../shared/schemas.js';
import { hashPassword, verifyPassword } from './database.js';
import { supportIndicators, APPROVED_LINKS } from './support.js';
import { assistantResponse, UNAVAILABLE } from './assistant.js';
import { registerPlanRoutes } from './plan-routes.js';
import { readPlan, revisePlan, savePlan, PlanError } from './planning.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const safeEqual = (a,b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b));
class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
const deny = () => { throw new ApiError(403, "You don't have permission to view this information."); };
const validate = (schema, value) => { const parsed = schema.safeParse(value); if (!parsed.success) throw new ApiError(400,'Please check your input. Some values are missing or invalid.'); return parsed.data; };
const id = value => validate(idSchema,value);

export function createApp({ db, origin = 'http://localhost:3000', aiMode = process.env.AI_MODE || 'demo', aiProvider, aiTimeoutMs = 5000, loginLimit = 20, aiLimit = 30, sessionMinutes = Number(process.env.SESSION_MINUTES || 60), secureCookie = process.env.COOKIE_SECURE === 'true' }) {
  if (!Number.isFinite(sessionMinutes) || sessionMinutes < 1 || sessionMinutes > 1440) throw new Error('Invalid session duration');
  const parsedOrigin = new URL(origin);
  if (parsedOrigin.origin !== origin || !['http:','https:'].includes(parsedOrigin.protocol)) throw new Error('Invalid application origin');
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'",'data:'], connectSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'self'"], upgradeInsecureRequests: null } }, strictTransportSecurity: secureCookie ? undefined : false }));
  // Explicit host check also rejects DNS rebinding against the loopback demo server.
  app.use((req,res,next) => { if (req.headers.host !== parsedOrigin.host) return res.status(403).json({ error: 'This host is not permitted.' }); next(); });
  app.use('/api', (req,res,next) => {
    res.set('Cache-Control','no-store');
    if (Object.keys(req.query).length) return next(new ApiError(400,'Unexpected query parameters.'));
    if (!['GET','HEAD'].includes(req.method)) {
      if (req.headers.origin !== origin) return next(new ApiError(403,'This request is not permitted.'));
      if (!req.is('application/json')) return next(new ApiError(415,'Please send a JSON request.'));
    }
    next();
  });
  const limiter = (limit, windowMs) => rateLimit({ windowMs, limit, standardHeaders:'draft-8', legacyHeaders:false, message: { error:'Too many requests. Please wait a little and try again.' } });
  app.use('/api/auth/login', limiter(loginLimit,15 * 60 * 1000));
  app.use(express.json({ limit:'16kb', strict:true }));
  const dummyHash = hashPassword(randomBytes(24).toString('hex'));
  const cookieOptions = { httpOnly:true, sameSite:'strict', secure:secureCookie, path:'/' };
  function principal(user) {
    const student = user.role === 'student' ? db.prepare('SELECT id FROM students WHERE user_id=?').get(user.id) : null;
    return { id:user.id, name:user.display_name, role:user.role, studentId:student?.id || null };
  }
  app.post('/api/auth/login', (req,res) => {
    const body = validate(loginSchema,req.body);
    const user = db.prepare('SELECT * FROM users WHERE email=?').get(body.email);
    const valid = verifyPassword(body.password,user?.password_hash || dummyHash);
    if (!valid || !user || !['student','advisor'].includes(user.role)) throw new ApiError(401,'Email or password is incorrect.');
    db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now());
    // Rotate any existing session on sign-in.
    const existing = sessionToken(req);
    if (existing) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(existing));
    const token = randomBytes(32).toString('hex'); const csrf = randomBytes(32).toString('hex');
    const expiresAt = Date.now() + sessionMinutes * 60000;
    db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(hash(token),user.id,csrf,expiresAt);
    res.cookie('pathwise_session',token,{ ...cookieOptions,maxAge:sessionMinutes * 60000 });
    res.json({ user:principal(user), csrf, expiresAt });
  });
  function sessionToken(req) {
    const values = (req.headers.cookie || '').split(';').map(v => v.trim()).filter(v => v.startsWith('pathwise_session='));
    if (values.length !== 1) return null;
    const token = values[0].slice('pathwise_session='.length);
    return /^[a-f0-9]{64}$/.test(token) ? token : null;
  }
  app.use('/api', (req,res,next) => {
    const token = sessionToken(req);
    const session = token ? db.prepare('SELECT s.*,u.role,u.display_name,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=?').get(hash(token)) : null;
    if (!session || session.expires_at <= Date.now()) {
      if (session) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(session.token_hash);
      res.clearCookie('pathwise_session',cookieOptions);
      return next(new ApiError(401,'Your session expired. Please sign in again.'));
    }
    if (!['student','advisor'].includes(session.role)) return next(new ApiError(403,'Access is not permitted.'));
    req.user = { id:session.user_id, role:session.role, display_name:session.display_name };
    req.session = session;
    if (!['GET','HEAD'].includes(req.method) && !safeEqual(req.headers['x-csrf-token'],session.csrf)) return next(new ApiError(403,'Please refresh the page and try again.'));
    next();
  });
  const advisor = (req,res,next) => req.user.role === 'advisor' ? next() : next(new ApiError(403,"You don't have permission to view this information."));
  function authorizeStudent(user, studentId) {
    const student = db.prepare('SELECT s.*,u.display_name AS name FROM students s JOIN users u ON u.id=s.user_id WHERE s.id=?').get(studentId);
    if (!student || (user.role === 'student' ? student.user_id !== user.id : user.role !== 'advisor' || student.advisor_id !== user.id)) deny();
    return { id:student.id, name:student.name, program:student.program };
  }
  function object(table, value, user) {
    // table names come only from fixed route declarations, never from request data.
    const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id(value));
    if (!row) deny();
    authorizeStudent(user,row.student_id);
    if (table === 'notes' && row.visibility === 'advisor' && user.role !== 'advisor') deny();
    return row;
  }
  function overview(user, studentId) {
    const student = authorizeStudent(user,studentId);
    const courses = db.prepare('SELECT * FROM courses WHERE student_id=? ORDER BY id').all(studentId);
    const assignments = db.prepare('SELECT a.*,c.title AS course_title,c.code AS course_code FROM assignments a JOIN courses c ON c.id=a.course_id AND c.student_id=a.student_id WHERE a.student_id=? ORDER BY a.due_at').all(studentId);
    const grades = db.prepare('SELECT g.*,c.title AS course_title FROM grades g JOIN courses c ON c.id=g.course_id AND c.student_id=g.student_id WHERE g.student_id=? ORDER BY observed_at').all(studentId);
    const alerts = db.prepare('SELECT * FROM alerts WHERE student_id=? ORDER BY id').all(studentId);
    const resources = db.prepare('SELECT * FROM resources WHERE student_id=?').all(studentId).map(r => ({ ...r,url:APPROVED_LINKS[r.link_key] }));
    const notes = db.prepare("SELECT id,body,visibility FROM notes WHERE student_id=? AND (visibility='student' OR ?='advisor')").all(studentId,user.role);
    const studentOwner=db.prepare('SELECT user_id FROM students WHERE id=?').get(studentId);
    const studyPlan=readPlan(db,studentOwner.user_id,studentId);
    const planSummary=studyPlan?{goal:studyPlan.preferences.goal,completed:studyPlan.tasks.filter(t=>t.completed).length,total:studyPlan.tasks.length,nextAction:studyPlan.nextAction,risks:studyPlan.risks,updatedAt:studyPlan.updatedAt}:null;
    return { student,courses,assignments,grades,alerts,resources,notes,planSummary,support:supportIndicators(assignments,grades) };
  }
  app.get('/api/auth/session', (req,res) => res.json({ user:principal(req.user),csrf:req.session.csrf,expiresAt:req.session.expires_at }));
  registerPlanRoutes(app,{db,authorizeStudent,id,validate,limiter});
  app.post('/api/auth/logout', (req,res) => {
    validate(logoutSchema,req.body);
    db.prepare('DELETE FROM sessions WHERE token_hash=?').run(req.session.token_hash);
    res.clearCookie('pathwise_session',cookieOptions).json({ ok:true });
  });
  app.get('/api/advisor/students',advisor,(req,res) => {
    const rows = db.prepare('SELECT id FROM students WHERE advisor_id=? ORDER BY id').all(req.user.id);
    res.json({ students:rows.map(row => { const data=overview(req.user,row.id); return { ...data.student,support:data.support,openAlerts:data.alerts.filter(a => a.status !== 'resolved').length }; }) });
  });
  app.get('/api/students/:id', (req,res) => res.json(overview(req.user,id(req.params.id))));
  for (const table of ['courses','assignments','grades','alerts','notes','resources']) {
    app.get(`/api/${table}/:id`, (req,res) => {
      const row = object(table,req.params.id,req.user);
      if (table === 'resources') row.url = APPROVED_LINKS[row.link_key];
      res.json(row);
    });
  }
  app.patch('/api/assignments/:id', (req,res) => {
    if (req.user.role !== 'student') deny();
    const row = object('assignments',req.params.id,req.user);
    const body = validate(completionSchema,req.body);
    if (row.version !== body.version || Boolean(row.completed) === body.completed) throw new ApiError(409,'This assignment has changed. Refresh and try again.');
    const updated = db.prepare('UPDATE assignments SET completed=?,completed_at=?,version=version+1 WHERE id=? AND version=? RETURNING *').get(body.completed ? 1 : 0,body.completed ? new Date().toISOString() : null,row.id,body.version);
    if (!updated) throw new ApiError(409,'This assignment has changed. Refresh and try again.');
    res.json(updated);
  });
  app.patch('/api/advisor/alerts/:id',advisor,(req,res) => {
    const row = object('alerts',req.params.id,req.user);
    const body = validate(alertSchema,req.body);
    if (body.version !== row.version || !((row.status === 'new' && body.status === 'reviewed') || (row.status === 'reviewed' && body.status === 'resolved'))) throw new ApiError(409,'That alert transition is not available. Refresh and review the current status.');
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = db.prepare('UPDATE alerts SET status=?,version=version+1 WHERE id=? AND version=? RETURNING *').get(body.status,row.id,body.version);
      if (!result) throw new ApiError(409,'This alert has already changed.');
      db.prepare("INSERT INTO audit(alert_id,actor_id,previous_status,new_status,event,occurred_at) VALUES (?,?,?,?,'status_changed',?)").run(row.id,req.user.id,row.status,body.status,new Date().toISOString());
      db.exec('COMMIT'); res.json(result);
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  });
  app.get('/api/advisor/alerts/:id/history',advisor,(req,res) => {
    const alert = object('alerts',req.params.id,req.user);
    res.json({ history:db.prepare("SELECT a.id,a.event,a.previous_status,a.new_status,a.occurred_at,COALESCE(u.display_name,'Demo seed') AS actor FROM audit a LEFT JOIN users u ON u.id=a.actor_id WHERE alert_id=? ORDER BY a.id").all(alert.id) });
  });
  app.post('/api/assistant',limiter(aiLimit,60000),async (req,res) => {
    const body = validate(assistantSchema,req.body);
    const studentId = req.user.role === 'student' ? principal(req.user).studentId : body.studentId;
    if (!studentId) throw new ApiError(400,'Select an authorized student first.');
    authorizeStudent(req.user,studentId);
    if (req.user.role === 'student' && body.studentId !== undefined && body.studentId !== studentId) deny();
    if(aiMode==='demo' && /^(?:i\s+(?:already\s+)?(?:completed|finished)|reopen|add\s)|hours?\s*(?:per|a|each|\/)\s*week|less aggressive|make.*easier|faster|why.*next|miss.*milestone/i.test(body.message)) {
      const plan=readPlan(db,req.user.id,studentId);
      if(plan) {
        try {
          const result=revisePlan(plan,body.message);
          if(result.plan.preferences.target!==plan.preferences.target)return res.json({kind:'academic',summary:'Open Study plan to confirm a target-date change. Your official assignment deadlines stay unchanged.',priorities:[],recommendedResources:[],needsAdvisor:false});
          const updated=result.plan===plan?plan:savePlan(db,req.user.id,studentId,result.plan,plan.version,result.message,'assistant');
          return res.json({kind:'academic',summary:result.message,priorities:[updated.nextAction,...updated.risks].slice(0,8),recommendedResources:[],needsAdvisor:updated.risks.length>0});
        } catch(error){if(error instanceof PlanError)return res.status(error.status).json({error:error.message});throw error;}
      }
    }
    try { res.json(await assistantResponse({ db,studentId,message:body.message,mode:aiMode,provider:aiProvider,timeoutMs:aiTimeoutMs })); }
    catch { throw new ApiError(503,UNAVAILABLE); }
  });
  app.use('/api', (req,res) => res.status(404).json({ error:'This API route does not exist.' }));
  app.use('/shared',express.static(fileURLToPath(new URL('../shared/',import.meta.url)),{ fallthrough:false }));
  app.use('/vendor/zod',express.static(fileURLToPath(new URL('../node_modules/zod/',import.meta.url)),{ fallthrough:false,dotfiles:'deny' }));
  app.use(express.static(fileURLToPath(new URL('../public/',import.meta.url)),{ index:false,dotfiles:'deny' }));
  const page = fileURLToPath(new URL('../public/index.html',import.meta.url));
  // Fixed files only: allow the workspace's .codex parent directory on Windows.
  app.get(['/','/login','/dashboard','/assignments','/courses','/resources','/assistant','/plan','/advisor','/students/:id'],(req,res) => res.sendFile(page,{dotfiles:'allow'}));
  app.use((req,res) => res.status(404).sendFile(fileURLToPath(new URL('../public/404.html',import.meta.url)),{dotfiles:'allow'}));
  app.use((error,req,res,next) => {
    if (res.headersSent) return next(error);
    const status = error instanceof ApiError ? error.status : error.type === 'entity.too.large' ? 413 : error instanceof SyntaxError && 'body' in error ? 400 : error.status === 404 ? 404 : 500;
    const message = error instanceof ApiError ? error.message : status === 413 ? 'This request is too large.' : status === 400 ? 'Please send valid JSON.' : status === 404 ? 'This resource does not exist.' : 'We couldn’t complete your request. Please try again.';
    // Log only event category; never request bodies, tokens, SQL, or provider output.
    if (status === 500) console.error('pathwise_request_failed', { method:req.method,status });
    res.status(status).json({ error:message });
  });
  return app;
}
