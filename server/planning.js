import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { planningSchemas } from '../shared/planning.js';
import { classifyMessage, composeResponse } from './assistant.js';
export const schemas=planningSchemas(z);
const iso = time => new Date(time).toISOString().slice(0,10);
const day=86400000;
export class PlanError extends Error { constructor(message,status=400){super(message);this.status=status;} }
export function guardPlanningText(text) {
  const topic=classifyMessage(text);
  if(['crisis','restricted','integrity','official','missing'].includes(topic)) throw new PlanError(composeResponse(topic,{},text).summary);
  if(/weather|sports|stock|crypto|investment|election|recipe|movie/i.test(text)) throw new PlanError('Let’s keep this plan focused on coursework, study, and academic progress.');
  if(topic==='scope'&&!/goal|milestone|task|hours?|week|learn|semester|scholarship|orientation|fafsa|transcript|application|academic|college|degree|read|chapter|review|lab|essay|project|research|completed|finished|reopen|less aggressive|easier|gentle|faster|focused|urgent|priority|december|november|october|september|august|july|june|may|april|march|february|january/i.test(text))throw new PlanError('I can help with academic goals, study steps, and schedules. Please describe an academic task or goal.');
}
export function readPlan(db,userId,studentId){
  const row=db.prepare('SELECT version,body FROM plans WHERE owner_id=? AND student_id=?').get(userId,studentId);
  return row ? schemas.plan.parse({...JSON.parse(row.body),version:row.version}) : null;
}
export function savePlan(db,userId,studentId,plan,expected,event='Plan updated',source='form'){
  const checked=schemas.plan.parse({...plan,version:expected+1});
  const payload=JSON.stringify(checked);
  if(payload.length>45000 || /sk-[A-Za-z0-9_-]{12,}|-----BEGIN|Bearer\s+[A-Za-z0-9._-]+|https?:\/\//i.test(payload)) throw new PlanError('Please remove links or sensitive values from the planning fields.');
  const before=readPlan(db,userId,studentId);
  db.exec('BEGIN IMMEDIATE');
  try {
  const result=expected===0
    ? db.prepare('INSERT INTO plans(owner_id,student_id,version,body) VALUES(?,?,1,?) ON CONFLICT DO NOTHING').run(userId,studentId,payload)
    : db.prepare('UPDATE plans SET body=?,version=version+1 WHERE owner_id=? AND student_id=? AND version=?').run(payload,userId,studentId,expected);
  if(!result.changes) throw new PlanError('This plan changed in another tab. Refresh the plan before trying again.',409);
  db.prepare('INSERT INTO plan_activity(owner_id,student_id,version,event,source,before_body,after_body,occurred_at) VALUES(?,?,?,?,?,?,?,?)').run(userId,studentId,checked.version,event,source,before?JSON.stringify(before):null,payload,new Date().toISOString());
  // Keep a bounded audit/undo history per demo plan, without storing conversation prompts.
  db.prepare('DELETE FROM plan_activity WHERE owner_id=? AND student_id=? AND version<?').run(userId,studentId,checked.version-19);
  db.exec('COMMIT');
  return checked;
  } catch(e){db.exec('ROLLBACK');throw e;}
}
export function generatePlan(db,studentId,preferences,previous=null,now=Date.now()){
  guardPlanningText(preferences.goal+' '+preferences.constraints);
  if(preferences.target && (preferences.target<iso(now) || Date.parse(preferences.target)>now+day*366)) throw new PlanError('Choose a target date between today and one year from now.');
  const assignments=db.prepare('SELECT id,title,due_at,completed FROM assignments WHERE student_id=? ORDER BY due_at,id LIMIT 12').all(studentId);
  const tasks=previous ? structuredClone(previous.tasks) : assignments.filter(a=>!a.completed).flatMap(a=>[
    {id:`assignment-${a.id}-work`,title:`Work on ${a.title}`,minutes:45,priority:Date.parse(a.due_at)<now+5*day?'high':'medium',completed:false,assignmentId:a.id,deadline:a.due_at.slice(0,10),scheduled:null,dependsOn:[],reason:'Start from the recorded deadline; reserve a focused work block before checking your understanding.'},
    {id:`assignment-${a.id}-check`,title:`Review ${a.title}`,minutes:15,priority:Date.parse(a.due_at)<now+5*day?'high':'medium',completed:false,assignmentId:a.id,deadline:a.due_at.slice(0,10),scheduled:null,dependsOn:[`assignment-${a.id}-work`],reason:'Check the requirements and note remaining questions after the work block. Submit coursework in your course platform.'}
  ]);
  if(!previous && !tasks.length) {
    for(const [title,minutes] of [['Define one measurable study outcome',20],['Practice the most important concept',45],['Review progress and choose the next step',15]]) {
      tasks.push({id:randomUUID(),title,minutes,priority:'medium',completed:false,assignmentId:null,deadline:null,scheduled:null,dependsOn:tasks.length?[tasks.at(-1).id]:[],reason:'A general study suggestion based on your stated goal; no course requirements or deadlines are assumed.'});
    }
  }
  // Academic completion is authoritative; plan checkboxes never write back to academic records.
  for(const task of tasks){const a=assignments.find(a=>a.id===task.assignmentId);if(a){task.deadline=a.due_at.slice(0,10);if(a.completed)task.completed=true;}}
  const plan={version:previous?.version||0,preferences,tasks,known:[`${assignments.length} assignments available in the authorized record; ${assignments.filter(a=>a.completed).length} marked complete.`,...(preferences.constraints?[`Your stated constraints: ${preferences.constraints}`]:[])],assumptions:['Suggested effort is an estimate, not a course requirement. Adjust each task’s minutes to match your workload.','Study time is spread over five weekdays, using UTC dates. Scheduled dates are suggestions; official deadlines stay unchanged.','Plan completion records preparation only; it does not submit assignments or change grades.',...(preferences.constraints?['Free-text constraints are recorded for your review. Only hours, horizon, strategy, and target date are automatically scheduled.']:[])],risks:[],milestones:[],nextAction:'',summary:'',updatedAt:new Date(now).toISOString()};
  return schedulePlan(plan,now);
}
export function schedulePlan(plan,now=Date.now()){
  const p=plan.preferences;
  const capacity=Math.floor(p.hours*60*(p.strategy==='gentle'?0.7:p.strategy==='balanced'?0.85:1));
  const daily=capacity/5;
  let cursor=Date.parse(iso(now)),available=0;
  const pending=plan.tasks.filter(t=>!t.completed);
  const ordered=[],visited=new Set();
  function visit(task){if(visited.has(task.id))return;visited.add(task.id);for(const dep of task.dependsOn){const before=pending.find(t=>t.id===dep);if(before)visit(before);}ordered.push(task);}
  [...pending].sort((a,b)=>({high:0,medium:1,low:2}[a.priority]-{high:0,medium:1,low:2}[b.priority])||(a.deadline||'9999').localeCompare(b.deadline||'9999')).forEach(visit);
  plan.risks=[];plan.milestones=[];
  const horizon=p.target || iso(now+p.weeks*7*day);
  for(const task of ordered){
    let remaining=task.minutes;
    while(remaining>0){
      while([0,6].includes(new Date(cursor).getUTCDay()))cursor+=day;
      if(available===0)available=daily;
      const consumed=Math.min(available,remaining);remaining-=consumed;available-=consumed;
      task.scheduled=iso(cursor);
      if(available<0.001){available=0;cursor+=day;}
    }
  }
  const late=ordered.filter(t=>t.deadline && t.scheduled>t.deadline);
  if(late.length)plan.risks.push(`${late.length} study steps finish after a recorded deadline at this capacity. Contact your instructor or advisor about overdue work; an extension is not assumed.`);
  const overflow=ordered.filter(t=>t.scheduled>horizon);
  if(overflow.length)plan.risks.push(`${overflow.length} steps extend beyond your target ${horizon}. Reduce scope, increase available hours, or move the planning target.`);
  if(p.constraints)plan.risks.push('Review your stated constraints against each proposed date before relying on this schedule.');
  const weeks=new Map();
  for(const task of [...plan.tasks].sort((a,b)=>(a.scheduled||'').localeCompare(b.scheduled||''))){const index=Math.max(0,Math.floor((Date.parse(task.scheduled||iso(now))-Date.parse(iso(now)))/(7*day)));if(!weeks.has(index))weeks.set(index,[]);weeks.get(index).push(task);}
  // Summarize very long schedules without silently discarding tasks.
  for(const [index,tasks] of [...weeks].slice(0,52)) plan.milestones.push({title:`Study checkpoint ${index+1}`,date:tasks.at(-1).scheduled||iso(now),taskIds:tasks.map(t=>t.id)});
  plan.milestones.push({title:'Review the goal and adjust next steps',date:horizon,taskIds:[]});
  plan.nextAction=ordered.length?`${ordered[0].title} — start with up to ${Math.max(5,Math.min(25,ordered[0].minutes))} minutes. Open its requirements and note one concrete outcome.`:'All planned steps are complete. Review what you learned and set your next academic goal.';
  plan.summary=`${plan.tasks.filter(t=>t.completed).length} of ${plan.tasks.length} study steps complete. ${p.hours} hours/week available; ${capacity} minutes/week scheduled, with ${Math.round(p.hours*60-capacity)} minutes of buffer. ${ordered.length?'Dates are estimates based on your remaining effort.':'Review your course platform for additional requirements.'}`;
  plan.updatedAt=new Date(now).toISOString();
  return schemas.plan.parse(plan);
}
export function revisePlan(plan,message,now=Date.now()){
  guardPlanningText(message);
  const text=message.toLowerCase();const next=structuredClone(plan);let changed=false;
  const completion=text.match(/^(?:i\s+)?(?:already\s+)?(completed|finished|reopen|reopened)\s+(.+?)[.!]?$/);
  if(completion){
    const query=completion[2].replace(/\s+yesterday$/,'').trim();
    const exact=next.tasks.filter(t=>t.title.toLowerCase()===query);
    const matches=exact.length?exact:next.tasks.filter(t=>t.title.toLowerCase().includes(query));
    if(matches.length!==1)throw new PlanError(matches.length?'More than one step matches. Use its full title or its checkbox so I update the correct step.':'I could not identify one saved study step. Use its exact title or checkbox. No records were changed.');
    changeTask(next,matches[0].id,{completed:!completion[1].startsWith('reopen')});
    return {plan:schedulePlan(next,now),message:`Recorded “${matches[0].title}” as ${matches[0].completed?'complete':'open'} in your study plan. This does not submit coursework or confirm an external action.`};
  }
  const add=text.match(/^add\s+(.+)$/);
  if(add){if(next.tasks.length>=32)throw new PlanError('Keep this plan to 32 steps or fewer.');next.tasks.push({id:randomUUID(),title:message.slice(4).trim(),minutes:30,priority:'medium',completed:false,assignmentId:null,deadline:null,scheduled:null,dependsOn:[],reason:'Added from your request. The 30-minute estimate is a starting assumption; edit it as needed.'});return {plan:schedulePlan(next,now),message:'Added your study step with an adjustable 30-minute estimate.'};}
  const priority=text.match(/^make\s+(.+?)\s+(urgent|high priority|medium priority|low priority)[.!]?$/);
  if(priority){const matches=next.tasks.filter(t=>t.title.toLowerCase()===priority[1]);if(matches.length!==1)throw new PlanError('Use the exact study-step title when changing priority. No records were changed.');changeTask(next,matches[0].id,{priority:priority[2]==='urgent'?'high':priority[2].split(' ')[0]});return {plan:schedulePlan(next,now),message:'Updated the priority and remaining schedule. Required prerequisites still come first.'};}
  const words={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,ten:10};
  const hours=text.match(/\b(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|ten)\s*hours?(?:\s*(?:per|a|each|\/)?\s*week)?/);
  if(hours){next.preferences.hours=Number(hours[1])||words[hours[1]];changed=true;}
  if(/less aggressive|easier|gentl|less intense/.test(text)){next.preferences.strategy='gentle';changed=true;}
  if(/faster|aggressive|focused/.test(text)&&!/less aggressive/.test(text)){next.preferences.strategy='focused';changed=true;}
  const target=text.match(/\b\d{4}-\d{2}-\d{2}\b/);
  if(target){next.preferences.target=target[0];changed=true;}
  const month=text.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/);
  if(month&&!target){const m=['january','february','march','april','may','june','july','august','september','october','november','december'].indexOf(month[1]);let year=new Date(now).getUTCFullYear();let d=new Date(Date.UTC(year,m+1,0));if(d.getTime()<now)d=new Date(Date.UTC(++year,m+1,0));next.preferences.target=iso(d);changed=true;}
  if(!changed) {
    if(/why|prioriti|focus|miss|milestone|progress/.test(text))return {plan,message:/miss/.test(text)?'If a milestone slips, leave unfinished tasks unchecked and choose “Refresh from progress.” The remaining work will be scheduled from today within your capacity. Contact your instructor if an official deadline is affected.':`Your next step is: ${plan.nextAction} Higher priorities and earlier recorded deadlines come first, while prerequisites stay ahead of dependent steps.`};
    throw new PlanError('I can revise weekly hours, pace, or a target date. Try “I only have three hours per week.” To record finished steps, use their checkboxes so I know exactly which ones you mean.');
  }
  const parsed=schemas.preferences.safeParse(next.preferences);if(!parsed.success)throw new PlanError('Use 0.5–40 hours per week and a valid date.');
  if(next.preferences.target&&(next.preferences.target<iso(now)||Date.parse(next.preferences.target)>now+366*day))throw new PlanError('Choose a target between today and one year from now.');
  return {plan:schedulePlan(next,now),message:month&&!target?'Updated your target to the last day of that month; change the date field if you intended a different day.':'Updated the schedule while keeping your tasks and completed progress.'};
}
export function changeTask(plan,taskId,changes){
  const task=plan.tasks.find(t=>t.id===taskId);
  if(!task)throw new PlanError('This study step is unavailable.',404);
  if(changes.title)guardPlanningText(changes.title);
  if(changes.completed===true&&task.dependsOn.some(dep=>!plan.tasks.find(t=>t.id===dep)?.completed))throw new PlanError('Complete the prerequisite study step first.',409);
  if(changes.completed===false&&plan.tasks.some(t=>t.completed&&t.dependsOn.includes(task.id)))throw new PlanError('Reopen the dependent review step first.',409);
  Object.assign(task,changes);
  return plan;
}
