import { randomUUID } from 'node:crypto';
import { schemas, PlanError, readPlan, savePlan, generatePlan, schedulePlan, revisePlan, guardPlanningText, changeTask } from './planning.js';
export function registerPlanRoutes(app,{db,authorizeStudent,id,validate,limiter}) {
  const base='/api/students/:id/plan';
  app.use(base,limiter(60,60000));
  function scope(req){const studentId=id(req.params.id);authorizeStudent(req.user,studentId);return studentId;}
  function current(req,schema){const studentId=scope(req);const body=validate(schema,req.body);const plan=readPlan(db,req.user.id,studentId);if(!plan)throw new PlanError('Create a plan first.',404);if(plan.version!==body.version)throw new PlanError('This plan changed. Refresh before editing it.',409);return {studentId,body,plan};}
  const wrap=fn=>(req,res,next)=>{try{fn(req,res);}catch(e){if(e instanceof PlanError)res.status(e.status).json({error:e.message});else next(e);}};
  app.get(base,wrap((req,res)=>res.json({plan:readPlan(db,req.user.id,scope(req))})));
  app.get(base+'/history',wrap((req,res)=>{
    const studentId=scope(req);
    res.json({history:db.prepare('SELECT version,event,source,occurred_at FROM plan_activity WHERE owner_id=? AND student_id=? ORDER BY version DESC LIMIT 20').all(req.user.id,studentId)});
  }));
  app.post(base+'/undo',wrap((req,res)=>{
    const {studentId,body}=current(req,schemas.undo);
    const row=db.prepare('SELECT before_body,occurred_at FROM plan_activity WHERE owner_id=? AND student_id=? AND version=?').get(req.user.id,studentId,body.version);
    if(!row?.before_body || Date.now()-Date.parse(row.occurred_at)>600000)throw new PlanError('Undo is available for the latest edit for ten minutes.',409);
    res.json({plan:savePlan(db,req.user.id,studentId,schedulePlan(schemas.plan.parse(JSON.parse(row.before_body))),body.version,'Latest edit undone','undo')});
  }));
  app.post(base,wrap((req,res)=>{
    const studentId=scope(req),body=validate(schemas.generate,req.body),previous=readPlan(db,req.user.id,studentId);
    if((previous?.version||0)!==body.version)throw new PlanError('This plan changed. Refresh before editing it.',409);
    const plan=generatePlan(db,studentId,body.preferences,previous);
    res.json({plan:savePlan(db,req.user.id,studentId,plan,body.version,previous?'Plan refreshed; preferences updated':'Study plan generated')});
  }));
  app.post(base+'/revise',wrap((req,res)=>{
    const {studentId,body,plan}=current(req,schemas.revise);const result=revisePlan(plan,body.message);
    if(result.plan.preferences.target!==plan.preferences.target&&!body.confirmed)return res.json({plan,confirmation:`Move your planning target to ${result.plan.preferences.target}? Official assignment deadlines will stay unchanged.`});
    res.json({message:result.message,plan:result.plan===plan?plan:savePlan(db,req.user.id,studentId,result.plan,body.version,result.message,'assistant')});
  }));
  app.patch(base+'/tasks',wrap((req,res)=>{
    const {studentId,body,plan}=current(req,schemas.edit);changeTask(plan,body.taskId,body.changes);
    res.json({plan:savePlan(db,req.user.id,studentId,schedulePlan(plan),body.version,body.changes.completed===undefined?'Study step edited':body.changes.completed?'Study step completed':'Study step reopened')});
  }));
  app.post(base+'/tasks',wrap((req,res)=>{
    const {studentId,body,plan}=current(req,schemas.add);guardPlanningText(body.title);
    if(plan.tasks.length>=32)throw new PlanError('Keep this plan to 32 steps or fewer.');
    plan.tasks.push({id:randomUUID(),title:body.title,minutes:body.minutes,priority:body.priority,completed:false,assignmentId:null,deadline:null,scheduled:null,dependsOn:[],reason:'A study step you added. Its effort and priority are your estimates.'});
    res.json({plan:savePlan(db,req.user.id,studentId,schedulePlan(plan),body.version)});
  }));
  app.delete(base+'/tasks',wrap((req,res)=>{
    const {studentId,body,plan}=current(req,schemas.remove);
    if(!plan.tasks.some(t=>t.id===body.taskId))throw new PlanError('This study step is unavailable.',404);
    if(plan.tasks.some(t=>t.dependsOn.includes(body.taskId)))throw new PlanError('Remove the dependent review step first.');
    plan.tasks=plan.tasks.filter(t=>t.id!==body.taskId);
    res.json({plan:savePlan(db,req.user.id,studentId,schedulePlan(plan),body.version)});
  }));
}
