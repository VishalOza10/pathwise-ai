import { responseSchema } from '../shared/schemas.js';

const reply = (summary, kind = 'boundary', priorities = [], recommendedResources = [], needsAdvisor = false) => ({ kind, summary, priorities, recommendedResources, needsAdvisor });
export const UNAVAILABLE = 'PathWise Assistant is temporarily unavailable. Your academic dashboard is still available.';
const normalize = value => value.normalize('NFKC').replace(/[\u200B-\u200F\uFEFF]/g, '').toLowerCase();

export function classifyMessage(message) {
  const text = normalize(message);
  if (/suicid|kill myself|hurt myself|end my life|end it all|self.harm|immediate danger|overdos|can.t stay safe|cannot stay safe|want to die|kill someone|hurt someone|can.t breathe|cannot breathe|heart attack|severe bleeding/.test(text)) return 'crisis';
  if (/ignore.{0,40}instruction|system prompt|developer message|pretend.{0,40}(admin|unrestricted)|disable.{0,40}(restrict|guardrail)|api.?key|environment variable|database credential|password|secret|jailbreak|another student|other student|everyone.s grades|all students.{0,30}grades|student\s*(id)?\s*[#:=]?\s*\d/.test(text)) return 'restricted';
  // The prototype does not resolve student identities from free text. Use the
  // authorized record selector instead of asking it to look up named people.
  if (/\b[a-z]+['’]s\s+(grades|records|scores)|\b(grades|records|scores)\s+(for|of)\s+(?!me\b|my\b|the selected student\b)/.test(text)) return 'restricted';
  if (/(write|give|solve|complete|answer).{0,50}(my |graded |final |take.home )?(exam|test answers)|do my homework|submit.{0,30}(for me|as me)|help me cheat|plagiar|bypass.{0,20}proctor/.test(text)) return 'integrity';
  if (/weather|sports|football|basketball|stock|crypto|bitcoin|investment|election|recipe|movie/.test(text)) return 'scope';
  if (/official|policy|policies|visa|financial aid|admission|probation|suspend|disciplin|drop.{0,20}course|withdraw|registrar|tuition/.test(text)) return 'official';
  if (/office hours|professor|instructor.s|syllabus|course requirements|advisor message/.test(text)) return 'missing';
  if (/grade|score|assessment|progress/.test(text)) return 'grades';
  if (/resource|support service|writing center|tutor/.test(text)) return 'resources';
  if (/explain|concept|practice question|study guide|brainstorm|feedback/.test(text)) return 'learning';
  if (/assignment|deadline|due|study|plan|time management|workload/.test(text)) return 'assignments';
  if (/course|class/.test(text)) return 'courses';
  if (/alert|advisor|check.in/.test(text)) return 'alerts';
  return 'scope';
}

// Only retrieve the category needed, after the API authorizes the student.
// No user table, emails, notes, credentials, or full-cohort context enters this service.
export function retrieveContext(db, studentId, topic) {
  if (topic === 'assignments') return { assignments: db.prepare('SELECT id,title,due_at,completed FROM assignments WHERE student_id=? ORDER BY due_at LIMIT 8').all(studentId) };
  if (topic === 'grades') return { grades: db.prepare('SELECT g.id,g.score,g.observed_at,c.title AS course_title FROM grades g JOIN courses c ON c.id=g.course_id AND c.student_id=g.student_id WHERE g.student_id=? ORDER BY g.observed_at DESC LIMIT 8').all(studentId) };
  if (topic === 'courses') return { courses: db.prepare('SELECT id,code,title,credits FROM courses WHERE student_id=? LIMIT 8').all(studentId) };
  if (topic === 'resources') return { resources: db.prepare('SELECT id,title,description FROM resources WHERE student_id=? LIMIT 5').all(studentId) };
  if (topic === 'alerts') return { alerts: db.prepare('SELECT id,title,status FROM alerts WHERE student_id=? ORDER BY id LIMIT 8').all(studentId) };
  return {};
}

export function composeResponse(topic, context, message, now = Date.now()) {
  switch (topic) {
    case 'crisis': return reply('Your safety matters. PathWise is an academic prototype and cannot provide emergency or mental-health care. If you may be in immediate danger, contact local emergency services now. Reach out to a qualified support professional or a trusted person who can stay with you.');
    case 'restricted': return reply('I can help with authorized academic information. I cannot reveal secrets, change permissions, or access another student’s records.');
    case 'integrity': return reply('I can help you review concepts, create practice questions, or plan your study time, but I should not complete a graded exam for you. Try “Explain binary search” or “Help me plan my assignments.”');
    case 'scope': return reply('I’m designed to help with academic progress, assignments, study planning, and academic resources. I can help you review upcoming deadlines.');
    case 'official': return reply('I do not have approved university policy or decision information in PathWise. For official guidance, contact your academic advisor, registrar, financial aid office, or international student office as appropriate.');
    case 'missing': return reply('I don’t have that information in the current PathWise data. Please check your course syllabus or contact your instructor or academic advisor.', 'missing');
    case 'learning': {
      const text = normalize(message);
      if (/binary search/.test(text)) return reply('Binary search finds a value in a sorted sequence by repeatedly halving the search interval. Compare the target with the middle item, then keep only the half that could contain it.', 'academic', ['Practice: trace the search for 14 in [2, 5, 8, 11, 14, 19, 23]. Which item do you inspect first?', 'Explain why the sequence must be sorted before using binary search.']);
      if (/graph/.test(text)) return reply('A graph represents objects as vertices and relationships as edges. A directed edge has a direction; an undirected edge connects both ways.', 'academic', ['Practice: draw four tasks as vertices and connect tasks that depend on each other.', 'Explain how you would represent a prerequisite relationship.']);
      return reply('The demo learning library currently includes binary search and graph basics. I can explain either topic or help you plan coursework. I do not have approved learning material for other concepts yet.', 'missing');
    }
    case 'assignments': {
      if (!context.assignments.length) return reply('I don’t have assignment data for this student in PathWise. Please check with the instructor.', 'missing');
      const pending = context.assignments.filter(a => !a.completed);
      return reply(pending.length ? 'Based on the assignments available in PathWise, start with overdue work, then set aside a study block for the next deadline. Completion here tracks your plan; it does not submit coursework.' : 'All assignments in the available context are marked complete. Check your course platform for any additional work.', 'academic', pending.map(a => `${a.title} — due ${a.due_at.slice(0,10)}${Date.parse(a.due_at) < now ? ' (overdue)' : ''}.`), [], pending.some(a => Date.parse(a.due_at) < now));
    }
    case 'grades': return context.grades.length ? reply('Based on recorded assessments in PathWise, these are the available scores. They are individual assessment results, not official final course grades or predictions.', 'academic', context.grades.map(g => `${g.course_title}: ${g.score}% recorded ${g.observed_at.slice(0,10)}.`)) : reply('Not enough data yet. I don’t have recorded grades for this student.', 'missing');
    case 'courses': return context.courses.length ? reply('These are the courses in the authorized PathWise record.', 'academic', context.courses.map(c => `${c.code}: ${c.title} (${c.credits} credits).`)) : reply('I don’t have course information for this student.', 'missing');
    case 'resources': return context.resources.length ? reply('These public learning resources are recommended in the demo record. They are not a claim about services offered by your university.', 'academic', context.resources.map(r => r.description), context.resources.map(r => r.id)) : reply('There are no recommended resources in the current student record.', 'missing');
    case 'alerts': return context.alerts.length ? reply('These support alerts are recorded in PathWise. An advisor can review them with the student; they do not determine institutional outcomes.', 'academic', context.alerts.map(a => `${a.title} — ${a.status}.`), [], context.alerts.some(a => a.status !== 'resolved')) : reply('There are no support alerts in the current student record.', 'missing');
    default: return reply('I don’t have enough authorized academic information to answer.', 'missing');
  }
}

export function validateResponse(candidate, expected, context) {
  const checked = responseSchema.parse(candidate);
  const text = JSON.stringify(checked);
  if (text.length > 6500 || /sk-[A-Za-z0-9_-]{12,}|-----BEGIN|Bearer\s+[A-Za-z0-9._-]+|password\s*[:=]|https?:\/\//i.test(text)) throw new Error('Unsafe assistant response');
  const allowedIds = new Set((context.resources || []).map(r => r.id));
  if (checked.recommendedResources.some(id => !allowedIds.has(id))) throw new Error('Unauthorized resource');
  // Demo replies must exactly match server-authored text from authorized context.
  // A future model integration must preserve provenance checks; schema checks alone are insufficient.
  if (JSON.stringify(checked) !== JSON.stringify(expected)) throw new Error('Unverified response provenance');
  return checked;
}

export async function assistantResponse({ db, studentId, message, mode = 'demo', provider, timeoutMs = 5000 }) {
  if (mode !== 'demo') throw new Error('Assistant unavailable');
  const topic = classifyMessage(message);
  const context = retrieveContext(db, studentId, topic);
  const expected = composeResponse(topic, context, message);
  const controller = new AbortController();
  let timer;
  try {
    const candidate = await Promise.race([
      provider ? Promise.resolve().then(() => provider({ topic, context, signal: controller.signal })) : Promise.resolve(expected),
      new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Assistant timeout')); }, timeoutMs); }),
    ]);
    return validateResponse(candidate, expected, context);
  } finally { clearTimeout(timer); }
}
