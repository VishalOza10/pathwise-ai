import { z } from '/vendor/zod/index.js';
import { createSchemas } from '/shared/validation.js';
const { loginSchema, completionSchema, alertSchema, assistantSchema, responseSchema } = createSchemas(z);

const root = document.querySelector('#app');
document.querySelector('.skip-link')?.addEventListener('click',event => {
  event.preventDefault();
  document.querySelector('#main-content')?.focus();
});
const state = { user:null, csrf:null, data:null, students:[], selected:null, messages:[], busy:false, filter:'all', epoch:0, pending:new Set(), expiryTimer:null };
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const date = value => new Date(value).toLocaleDateString(undefined,{month:'short',day:'numeric'});
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${({
  grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  book:'<path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Z"/><path d="M12 5v15"/>',
  list:'<rect x="5" y="4" width="15" height="17" rx="2"/><path d="M9 4V2h7v2M9 10h7M9 15h7"/>',
  spark:'<path d="m12 3 2.8 6.2L21 12l-6.2 2.8L12 21l-2.8-6.2L3 12l6.2-2.8L12 3ZM20 2v4m-2-2h4"/>',
  arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>',
  external:'<path d="M14 3h7v7M21 3 10 14M10 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-5"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  people:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v2"/>',
  chart:'<path d="M4 3v17h17M8 15l4-5 4 2 5-6"/>',
  resource:'<path d="M3 6h7l2 2h9v12H3V6ZM3 6V4h7l2 2h9v2"/>',
  logout:'<path d="M9 4H4v16h5m6-13 5 5-5 5M8 12h12"/>',
  shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
  back:'<path d="M19 12H5m5-5-5 5 5 5"/>',
  send:'<path d="m3 3 18 9-18 9 4-9-4-9ZM7 12h14"/>',
})[name] || ''}</svg>`;
const pill = (label, kind = label) => `<span class="pill ${esc(kind)}">${esc(label)}</span>`;
const supportLabel = level => ({elevated:'Elevated support',moderate:'Moderate support',steady:'On track',unknown:'Not enough data'})[level] || 'Not enough data';
const allowedLinks = new Set(['https://learningcenter.unc.edu/tips-and-tools/using-planners/','https://owl.purdue.edu/owl/general_writing/index.html','https://learningcenter.unc.edu/tips-and-tools/']);
const resourceLink = (resource, label) => allowedLinks.has(resource.url) ? `<a href="${esc(resource.url)}" target="_blank" rel="noopener noreferrer" class="text-link">${esc(label || resource.title)} ${icon('external')}</a>` : '<span class="muted">Resource unavailable</span>';

class RequestError extends Error { constructor(message,status=0) { super(message); this.status=status; } }
async function api(path,{ method='GET',body,auth=true }={}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(),10000);
  try {
    const response = await fetch(path,{ method,credentials:'same-origin',signal:controller.signal,headers:{ ...(body !== undefined ? {'Content-Type':'application/json'} : {}), ...(state.csrf ? {'X-CSRF-Token':state.csrf} : {}) },body:body !== undefined ? JSON.stringify(body) : undefined });
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401 && auth) { clearSession(); history.replaceState({},'','/login'); renderLogin('Your session expired. Please sign in again.'); }
      throw new RequestError(data.error || 'We couldn’t complete that request.',response.status);
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new RequestError('The request took too long. Please retry. If you changed a record, refresh to check its current status.');
    if (error instanceof RequestError) throw error;
    throw new RequestError('We couldn’t connect to PathWise. Please try again.');
  } finally { clearTimeout(timer); }
}
function clearSession() {
  clearTimeout(state.expiryTimer);
  Object.assign(state,{ user:null,csrf:null,data:null,students:[],selected:null,messages:[],busy:false });
  state.pending.clear(); state.epoch++;
}
function acceptSession(result) {
  state.user=result.user; state.csrf=result.csrf;
  clearTimeout(state.expiryTimer);
  state.expiryTimer=setTimeout(() => { clearSession(); history.replaceState({},'','/login'); renderLogin('Your session expired. Please sign in again.'); },Math.max(0,result.expiresAt-Date.now()));
}
let toastTimer;
function toast(message) { clearTimeout(toastTimer); document.querySelector('#toast').textContent=message; toastTimer=setTimeout(() => document.querySelector('#toast').textContent='',5000); }
function navigate(path) { history.pushState({},'',path); renderRoute(); window.scrollTo(0,0); }
function validate(schema, data) { const result=schema.safeParse(data); if (!result.success) throw new RequestError('Please check your input. Use valid values and stay within the displayed limits.'); return result.data; }
function confirmAction(title,body,action) {
  return new Promise(resolve => {
    const trigger=document.activeElement;
    const dialog=document.createElement('dialog'); dialog.className='modal';
    dialog.setAttribute('aria-labelledby','confirmation-title');
    dialog.setAttribute('aria-describedby','confirmation-description');
    dialog.innerHTML=`<h2 id="confirmation-title">${esc(title)}</h2><p id="confirmation-description">${esc(body)}</p><div class="modal-actions"><button class="button" data-cancel>Cancel</button><button class="button primary" data-confirm>${esc(action)}</button></div>`;
    const finish = value => { dialog.close(); dialog.remove(); if(trigger?.isConnected)trigger.focus(); resolve(value); };
    dialog.querySelector('[data-cancel]').onclick=() => finish(false);
    dialog.querySelector('[data-confirm]').onclick=() => finish(true);
    dialog.addEventListener('cancel',event => { event.preventDefault(); finish(false); });
    document.body.append(dialog); dialog.showModal(); dialog.querySelector('[data-cancel]').focus();
  });
}

function renderLogin(message='') {
  root.innerHTML=`<main class="login" id="main-content" tabindex="-1"><section class="login-story"><a href="/login" class="brand"><img src="/mark.svg" alt="">PathWise<em>AI</em></a><div class="login-copy"><p class="eyebrow">A LITTLE CLARITY. A WAY FORWARD.</p><h1>Your potential.<br>Your pace.<br><em>Your next step.</em></h1><p>A calmer place to see your progress, plan your coursework, and find the support you need.</p><div class="login-preview"><span class="preview-label">SMALL STEPS, REAL PROGRESS</span><strong>${icon('check')} Make room for what’s next.</strong><p>Bring your deadlines, study plans, and academic support together in one place.</p></div></div><p class="login-footer">${icon('shield')} Built around privacy and human support.<br>Academic prototype · Fictional records only</p></section><section class="login-form-area"><button type="button" class="button theme-toggle login-theme" data-theme-toggle aria-label="Switch to dark mode">☾ Dark mode</button><div class="login-form-inner"><p class="eyebrow">WELCOME TO PATHWISE</p><h2>A clear start.</h2><p>Sign in to explore your academic workspace.</p>${message ? `<div class="notice">${esc(message)}</div>` : ''}<div class="role-options" aria-label="Choose a demo account"><button class="role-choice active" data-role="student" aria-pressed="true">${icon('book')} Student demo</button><button class="role-choice" data-role="advisor" aria-pressed="false">${icon('people')} Advisor demo</button></div><form id="login-form" novalidate><label class="field">Email address<input name="email" type="email" value="student@pathwise.example" autocomplete="username" maxlength="120" required></label><label class="field">Demo password<input name="password" type="password" autocomplete="current-password" maxlength="128" placeholder="Enter the demo password" required></label><button class="button primary" type="submit">Sign in to PathWise ${icon('arrow')}</button><div class="error-inline" id="login-error" role="alert"></div></form><div class="demo-credentials"><strong>Just exploring? You’re in the right place.</strong>Default demo password:<br><code>Pathwise-Demo-Only-2026!</code><br>Use fictional demo accounts only. A custom password in your local configuration replaces this default.</div><p class="login-disclaimer">This is an academic prototype, not an official university system.<br>Do not enter real student information.</p></div></section></main>`;
  document.dispatchEvent(new Event('pathwise:render'));
  document.querySelectorAll('[data-role]').forEach(button => button.onclick=() => {
    document.dispatchEvent(new Event('pathwise:render'));
  document.querySelectorAll('[data-role]').forEach(item => { item.classList.toggle('active',item === button); item.setAttribute('aria-pressed',String(item === button)); });
    document.querySelector('[name=email]').value=`${button.dataset.role}@pathwise.example`;
  });
  let loggingIn=false;
  document.querySelector('#login-form').onsubmit=async event => {
    event.preventDefault(); if(loggingIn)return;
    const form=event.currentTarget; const button=form.querySelector('button');
    const error=document.querySelector('#login-error'); error.textContent='';
    try {
      const body=validate(loginSchema,Object.fromEntries(new FormData(form)));
      loggingIn=true; button.disabled=true; button.textContent='Signing in…';
      const result=await api('/api/auth/login',{method:'POST',body,auth:false});
      clearSession(); acceptSession(result); history.replaceState({},'',state.user.role === 'advisor' ? '/advisor' : '/dashboard'); await renderRoute();
    } catch(err) { error.textContent=err.message; }
    finally { loggingIn=false; button.disabled=false; button.innerHTML=`Sign in to PathWise ${icon('arrow')}`; }
  };
}

function shell(content,title) {
  if(!state.user)return;
  const advisor=state.user.role === 'advisor'; const path=location.pathname;
  const nav=advisor ? [['/advisor','people','My cohort'],['/plan','list','Study plan'],['/assistant','spark','AI assistant']] : [['/dashboard','grid','Overview'],['/courses','book','My courses'],['/assignments','list','Assignments'],['/plan','list','Study plan'],['/assistant','spark','AI assistant'],['/resources','resource','Resources']];
  root.innerHTML=`<div class="app-shell"><aside class="sidebar"><a class="brand" href="${advisor ? '/advisor' : '/dashboard'}" data-nav><img src="/mark.svg" alt="">PathWise<em>AI</em></a><div class="workspace-label">${advisor ? 'ADVISOR' : 'STUDENT'} WORKSPACE</div><nav class="nav" aria-label="Main navigation">${nav.map(([href,name,label]) => `<a href="${href}" data-nav class="${path === href || href === '/dashboard' && path === '/' ? 'active' : ''}" ${path === href ? 'aria-current="page"' : ''}>${icon(name)}<span>${label}</span>${label === 'Assignments' && state.data?.support.overdue ? `<span class="nav-count">${state.data.support.overdue}</span>` : ''}</a>`).join('')}</nav><div class="sidebar-bottom"><div class="prototype"><strong>${icon('shield')} A space to move forward.</strong>Academic prototype.<br>Fictional data. Human guidance.</div><div class="account"><span class="avatar">${esc(state.user.name.split(' ').map(v => v[0]).slice(0,2).join(''))}</span><div><strong>${esc(state.user.name)}</strong><small>${esc(state.user.role)} demo</small></div><button data-logout aria-label="Sign out" title="Sign out">${icon('logout')}</button></div></div></aside><div class="main-shell"><header class="topbar"><div class="breadcrumb">My workspace <span aria-hidden="true"> / </span> <strong>${esc(title)}</strong></div><div class="top-right"><button type="button" class="button theme-toggle" data-theme-toggle aria-label="Switch to dark mode">☾ Dark mode</button><span><span class="demo-dot"></span>Academic prototype</span><span class="session-label">${icon('shield')} Private demo session</span><button class="button subtle small mobile-logout" data-logout aria-label="Sign out">${icon('logout')}</button></div></header><main class="page" id="main-content" tabindex="-1">${content}<p class="footnote">Made for progress, not predictions. PathWise supports learning; people make the decisions.</p></main></div></div>`;
  bindCommon();
}
function bindCommon() {
  document.dispatchEvent(new Event('pathwise:render'));
  document.querySelectorAll('[data-nav]').forEach(link => link.onclick=event => { if(event.ctrlKey || event.metaKey || event.shiftKey)return; event.preventDefault(); navigate(link.getAttribute('href')); });
  document.querySelectorAll('[data-logout]').forEach(button => button.onclick=async () => {
    button.disabled=true;
    try { await api('/api/auth/logout',{method:'POST',body:{}}); clearSession(); history.replaceState({},'','/login'); renderLogin('You’ve signed out.'); }
    catch(err) { toast(err.message); button.disabled=false; }
  });
}
const heading = (eyebrow,title,subtitle,aside='') => `<div class="page-heading"><div><p class="eyebrow">${esc(eyebrow)}</p><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div>${aside}</div>`;
const stat = (label,value,note,name) => `<div class="stat"><div class="stat-top"><span>${esc(label)}</span><span class="stat-icon">${icon(name)}</span></div><div class="stat-value">${esc(value)}</div><small>${esc(note)}</small></div>`;
function supportPanel(data) {
  const s=data.support;
  return `<section class="panel support-panel"><div class="panel-heading"><h2>Academic support indicators</h2>${icon('chart')}</div><div class="panel-inner">${pill(supportLabel(s.level),s.level)}<ul class="factor-list">${s.factors.length ? s.factors.map(f => `<li>${esc(f)}</li>`).join('') : `<li>${esc(s.reasoning)}</li>`}</ul>${s.factors.length ? `<p>${esc(s.reasoning)}</p>` : ''}<div class="action-box"><strong>A helpful next step</strong>${esc(s.action)}</div><p class="support-note">Calculated from recorded data · ${esc(date(s.calculatedAt))}<br>A support signal, not an institutional decision.</p></div></section>`;
}
function assignmentRows(assignments) {
  if (!assignments.length) return '<div class="empty">No assignments in this view.</div>';
  return assignments.map(a => {
    const status=a.completed ? 'Completed' : Date.parse(a.due_at)<Date.now() ? 'Overdue' : 'Upcoming';
    return `<div class="assignment ${a.completed ? 'completed' : ''}">${state.user.role === 'student' ? `<button class="check ${a.completed ? 'done' : ''}" data-complete="${a.id}" aria-label="${esc(`${a.completed ? 'Mark incomplete' : 'Mark complete'}: ${a.title}`)}" ${state.pending.has(`assignment-${a.id}`) ? 'disabled' : ''}>${a.completed ? icon('check') : ''}</button>` : `<span class="course-symbol">${icon('list')}</span>`}<div class="assignment-body"><h3>${esc(a.title)}</h3><p>${esc(a.course_code)} · ${esc(a.course_title)}</p></div><div class="assignment-meta">${pill(status,status.toLowerCase())}<small>Due ${esc(date(a.due_at))}</small></div></div>`;
  }).join('');
}
function bindAssignments() {
  document.querySelectorAll('[data-complete]').forEach(button => button.onclick=async () => {
    const item=state.data?.assignments.find(a => a.id === Number(button.dataset.complete)); if(!item)return;
    const key=`assignment-${item.id}`; if(state.pending.has(key))return;
    state.pending.add(key); button.disabled=true;
    const studentId=state.data.student.id;
    try {
      const body=validate(completionSchema,{completed:!item.completed,version:item.version});
      await api(`/api/assignments/${item.id}`,{method:'PATCH',body});
      if(state.user && state.data?.student.id === studentId) await renderRoute();
      toast(body.completed ? 'Assignment marked complete. Your dashboard is up to date.' : 'Assignment marked incomplete.');
    } catch(err) { toast(err.message); if(err.status === 409 && state.user)await renderRoute(); }
    finally { state.pending.delete(key); const nextButton=document.querySelector(`[data-complete="${item.id}"]`); nextButton?.removeAttribute('disabled'); nextButton?.focus({preventScroll:true}); }
  });
}
function sparkline(grades) {
  if(grades.length<2)return '';
  const ordered=[...grades].sort((a,b) => a.observed_at.localeCompare(b.observed_at));
  const points=ordered.map((g,i) => `${3+i/(ordered.length-1)*60},${28-g.score/100*25}`).join(' ');
  return `<svg class="sparkline" viewBox="0 0 66 30" role="img" aria-label="Recorded assessment trend"><polyline points="${points}" fill="none" stroke="#a5b999" stroke-width="2"/><circle cx="63" cy="${28-ordered.at(-1).score/100*25}" r="2.5" fill="#809b70"/></svg>`;
}
function courseRows(data) {
  return data.courses.length ? data.courses.map(c => { const grades=data.grades.filter(g => g.course_id === c.id); const latest=grades.at(-1); return `<div class="course-mini"><span class="course-symbol">${icon('book')}</span><div><h3>${esc(c.title)}</h3><p>${esc(c.code)} · ${c.credits} credits</p></div>${sparkline(grades)}<div class="score">${latest ? `${latest.score}%` : '—'}<small>Latest assessment</small></div></div>`; }).join('') : '<div class="empty">Not enough data yet</div>';
}
function miniAssistant() {
  return `<section class="panel assistant-card"><div class="sparkle">${icon('spark')}</div><h2>A little guidance goes a long way.</h2><p>Your academic copilot, grounded in the information available to you.</p><button class="suggestion" data-ask="Help me plan my assignments">Help me plan my week ${icon('arrow')}</button><button class="suggestion" data-ask="Show my academic resources">Find a useful resource ${icon('arrow')}</button></section>`;
}
function bindSuggestions() {
  document.querySelectorAll('[data-ask]').forEach(button => button.onclick=async () => {
    const text=button.dataset.ask; await goAssistant(); if(state.user && location.pathname === '/assistant')sendMessage(text);
  });
}
async function goAssistant() { history.pushState({},'','/assistant'); await renderRoute(); window.scrollTo(0,0); }

function renderDashboard(data) {
  const advisor=state.user.role === 'advisor';
  const completed=data.assignments.filter(a => a.completed).length;
  const latestScores=data.courses.map(c => data.grades.filter(g => g.course_id === c.id).at(-1)?.score).filter(v => v !== undefined);
  const average=latestScores.length ? `${Math.round(latestScores.reduce((a,b) => a+b,0)/latestScores.length)}%` : '—';
  const priority=data.assignments.filter(a => !a.completed).slice(0,4);
  const art='<div class="hero-art" aria-hidden="true"><svg viewBox="0 0 130 115"><circle cx="70" cy="57" r="47" fill="#d9e5cb"/><path d="M18 91C45 91 21 29 63 31s20 48 44 14" fill="none" stroke="#8aa172" stroke-width="2" stroke-dasharray="4 5"/><rect x="43" y="30" width="47" height="60" rx="7" fill="#fafbf4" transform="rotate(10 65 60)"/><path d="m56 47 5 5 11-12m-17 25h19m-21 10h14" fill="none" stroke="#719158" stroke-width="3" stroke-linecap="round"/><circle cx="101" cy="36" r="13" fill="#c0d5a7"/><path d="m95 36 4 4 7-8" fill="none" stroke="#48643a" stroke-width="2"/></svg></div>';
  shell(`${advisor ? '<a href="/advisor" data-nav class="back">'+icon('back')+' Back to my cohort</a>' : ''}${heading(advisor ? 'STUDENT OVERVIEW' : 'YOUR NEXT CHAPTER STARTS HERE',advisor ? data.student.name : `Hello, ${data.student.name.split(' ')[0]}.`,advisor ? data.student.program : 'Let’s make a little progress today.',`<span class="date-chip">${new Date().toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'})}</span>`)}${!advisor ? `<section class="hero"><div><p class="eyebrow">A CLEARER PATH AHEAD</p><h2>Small steps. Meaningful progress.</h2><p>You don’t need to do everything at once. Start with your next deadline, and make a plan that works for you.</p><a href="/assignments" data-nav class="button primary">See my priorities ${icon('arrow')}</a></div>${art}</section>` : ''}<div class="stats">${stat('Active courses',data.courses.length,`${data.courses.reduce((s,c) => s+c.credits,0)} credits in your record`,'book')}${stat('Due in 5 days',data.support.upcoming,'Upcoming, incomplete work','clock')}${stat('Completed',`${completed}/${data.assignments.length}`,'Demo completion tracking','check')}${stat('Assessment snapshot',average,latestScores.length ? 'Mean of latest scores · not a final grade' : 'Not enough data yet','chart')}</div><div class="dashboard-grid"><div class="stack"><section class="panel"><div class="panel-heading"><div><h2>Focus on what’s next</h2><p>Your earliest incomplete assignments</p></div>${!advisor ? '<a href="/assignments" data-nav class="text-link">View all →</a>' : ''}</div>${assignmentRows(priority)}<div class="panel-footer">Completion tracks study progress and does not submit coursework.</div></section><section class="panel"><div class="panel-heading"><div><h2>Your learning, at a glance</h2><p>Recorded assessments · no predictions</p></div>${!advisor ? '<a href="/courses" data-nav class="text-link">All courses →</a>' : ''}</div>${courseRows(data)}</section>${advisor ? alertPanel(data) : `<section class="panel"><div class="panel-heading"><h2>Resources for your next step</h2><a href="/resources" data-nav class="text-link">Explore →</a></div><div class="resources-mini">${data.resources.map(r => `<div class="resource-row">${icon('resource')}<div><h3>${resourceLink(r)}</h3><p>${esc(r.description)}</p></div></div>`).join('') || '<div class="empty">No recommended resources yet.</div>'}</div></section>`}</div><div class="stack">${supportPanel(data)}${miniAssistant()}${data.notes.length ? `<section class="panel"><div class="panel-heading"><h2>Advisor notes</h2></div><div class="panel-inner">${data.notes.map(n => `<div class="note">${esc(n.body)}${n.visibility === 'advisor' ? '<br><small>Advisor only</small>' : ''}</div>`).join('')}</div></section>` : ''}${!advisor && data.alerts.length ? alertPanel(data) : ''}</div></div>`,'Overview');
  bindAssignments(); bindSuggestions(); bindAlerts();
  const focus=document.createElement('div');focus.className='daily-focus';
  document.querySelector('.stats')?.after(focus);
  if(state.user.role==='advisor') {
    const p=data.planSummary;
    focus.innerHTML=p?'<section class="panel"><div class="panel-inner"><p class="eyebrow">STUDENT STUDY PLAN</p><h2>'+esc(p.goal)+'</h2><label>'+p.completed+' / '+p.total+' steps complete<progress value="'+p.completed+'" max="'+(p.total||1)+'" aria-label="Student study plan progress"></progress></label><p>'+esc(p.nextAction)+'</p><p>'+esc(p.risks.join(' '))+'</p></div></section>':'<div class="note">This student has not saved a study plan yet.</div>';
  } else attachPlanner(focus,true);

}

function renderAssignments(data) {
  const selected=data.assignments.filter(a => state.filter === 'all' || state.filter === 'completed' && a.completed || state.filter === 'pending' && !a.completed || state.filter === 'overdue' && !a.completed && Date.parse(a.due_at)<Date.now());
  shell(`${heading('ONE TASK AT A TIME','Make space for what’s next.','Review your deadlines and track your study progress.')}<div class="filter-row" aria-label="Filter assignments">${[['all','All assignments'],['pending','To do'],['overdue','Overdue'],['completed','Completed']].map(([key,label]) => `<button class="button small ${state.filter === key ? 'active' : ''}" data-filter="${key}" aria-pressed="${state.filter === key}">${label}</button>`).join('')}</div><section class="panel">${assignmentRows(selected)}<div class="panel-footer">Changes are saved to your authorized student record. Marking complete does not submit work or alter grades.</div></section>`,'Assignments');
  document.querySelectorAll('[data-filter]').forEach(button => button.onclick=() => {state.filter=button.dataset.filter; renderAssignments(state.data); document.querySelector(`[data-filter="${state.filter}"]`)?.focus();}); bindAssignments();
}
function renderCourses(data) {
  shell(`${heading('SEE THE BIGGER PICTURE','Your learning journey.','A view of your courses and recorded assessment results.')}<div class="course-grid">${data.courses.map(c => {
    const grades=data.grades.filter(g => g.course_id === c.id); const latest=grades.at(-1); const previous=grades.at(-2);
    const assignments=data.assignments.filter(a => a.course_id === c.id);
    return `<section class="panel course-card"><span class="course-symbol">${icon('book')}</span><h2>${esc(c.title)}</h2><p class="course-code">${esc(c.code)} · ${c.credits} credits</p><p>Latest recorded assessment</p><div class="course-grade">${latest ? `${latest.score}%` : '—'}</div>${latest ? `<progress value="${latest.score}" max="100" aria-label="Latest assessment score"></progress><p>Recorded ${esc(date(latest.observed_at))}</p>` : '<p>Not enough data yet</p>'}<div class="note">${previous ? `Previous assessment: ${previous.score}% (${esc(date(previous.observed_at))})<br>Change: ${latest.score-previous.score > 0 ? '+' : ''}${Math.round((latest.score-previous.score)*10)/10} percentage points.` : 'Trend: Not enough data yet'}<br>${assignments.filter(a => a.completed).length} of ${assignments.length} assignments marked complete.</div></section>`;
  }).join('') || '<div class="empty">Not enough data yet</div>'}</div><div class="note">These are recorded assessment scores, not official course averages or final grades. Your instructor is the authority for grading and course requirements.</div>`,'My courses');
}
function renderResources(data) {
  shell(`${heading('SUPPORT FOR YOUR NEXT STEP','You don’t have to do it alone.','A small collection of approved public learning resources.')}<div class="resource-grid">${data.resources.map(r => `<section class="panel resource-card"><span class="course-symbol">${icon('resource')}</span><h2>${esc(r.title)}</h2><p>${esc(r.description)}</p>${resourceLink(r,'Open resource')}</section>`).join('') || '<div class="empty">No recommended resources in this record.</div>'}</div><div class="note">These are public reference resources, not services verified to be available at your university. For official support, contact your advisor or student services.</div>`,'Resources');
}

function alertPanel(data) {
  return `<section class="panel"><div class="panel-heading"><div><h2>Support alerts</h2><p>Opportunities for a human check-in</p></div></div>${data.alerts.map(a => `<div class="alert"><div class="alert-top"><h3>${esc(a.title)}</h3>${pill(a.status)}</div><p>${esc(a.detail)}</p>${state.user.role === 'advisor' ? `<div class="alert-actions">${a.status !== 'resolved' ? `<button class="button small ${a.status === 'reviewed' ? '' : 'primary'}" data-alert="${a.id}" ${state.pending.has(`alert-${a.id}`) ? 'disabled' : ''}>${a.status === 'new' ? 'Mark reviewed' : 'Resolve alert'}</button>` : ''}<button class="text-link" data-history="${a.id}" aria-expanded="false">View activity</button></div><div id="history-${a.id}"></div>` : '<small class="muted">An advisor can review this alert with you.</small>'}</div>`).join('') || '<div class="empty">No alerts in this record.</div>'}</section>`;
}
function bindAlerts() {
  document.querySelectorAll('[data-alert]').forEach(button => button.onclick=async () => {
    const a=state.data?.alerts.find(item => item.id === Number(button.dataset.alert)); if(!a)return;
    const key=`alert-${a.id}`; if(state.pending.has(key))return;
    state.pending.add(key); button.disabled=true;
    try {
      const next=a.status === 'new' ? 'reviewed' : 'resolved';
      if(next === 'resolved' && !await confirmAction('Resolve this support alert?','Confirm that the appropriate follow-up is complete. This demo does not support reopening resolved alerts.','Resolve alert'))return;
      const body=validate(alertSchema,{status:next,version:a.version});
      await api(`/api/advisor/alerts/${a.id}`,{method:'PATCH',body});
      if(state.user)await renderRoute(); toast('Alert updated. The change is recorded in activity history.');
    } catch(err) {toast(err.message);if(err.status===409 && state.user)await renderRoute();}
    finally {state.pending.delete(key);document.querySelector(`[data-alert="${a.id}"]`)?.removeAttribute('disabled');}
  });
  document.querySelectorAll('[data-history]').forEach(button => button.onclick=async () => {
    const box=document.querySelector(`#history-${button.dataset.history}`);
    if(box.textContent){box.textContent='';button.textContent='View activity';button.setAttribute('aria-expanded','false');return;}
    button.disabled=true;
    try {
      const result=await api(`/api/advisor/alerts/${button.dataset.history}/history`);
      box.innerHTML=`<div class="history"><ol>${result.history.map(h => `<li>${esc(h.actor)} · ${h.previous_status ? `${esc(h.previous_status)} → ` : 'Created → '}${esc(h.new_status)}<br>${esc(new Date(h.occurred_at).toLocaleString())}</li>`).join('')}</ol></div>`;
      button.textContent='Hide activity';button.setAttribute('aria-expanded','true');
    } catch(err) {toast(err.message);} finally {button.disabled=false;}
  });
}
function renderAdvisor() {
  const students=state.students;
  shell(`${heading('HUMAN SUPPORT MAKES THE DIFFERENCE','A clearer view of your cohort.','Review assigned students, understand support signals, and follow up with care.')}<div class="stats">${stat('Assigned students',students.length,'Your authorized demo cohort','people')}${stat('Elevated support',students.filter(s => s.support.level === 'elevated').length,'Signals for human follow-up','chart')}${stat('Open alerts',students.reduce((sum,s) => sum+s.openAlerts,0),'New and reviewed alerts','list')}${stat('Overdue assignments',students.reduce((sum,s) => sum+s.support.overdue,0),'Across assigned students','clock')}</div><div class="student-list">${students.map(s => `<article class="student-item"><span class="avatar">${esc(s.name.split(' ').map(v => v[0]).join(''))}</span><div><h3>${esc(s.name)}</h3><p>${esc(s.program)} · ${s.openAlerts} open alert${s.openAlerts === 1 ? '' : 's'}</p><p>${esc(s.support.factors.join(' · ') || s.support.reasoning)}</p>${s.support.factors.length ? `<p>${esc(s.support.reasoning)}</p>` : ''}<p>Next step: ${esc(s.support.action)}</p></div>${pill(supportLabel(s.support.level),s.support.level)}<a href="/students/${s.id}" data-nav class="button small">Review ${icon('arrow')}</a></article>`).join('') || '<div class="empty">No students are assigned to this advisor.</div>'}</div><div class="note">Support indicators summarize recorded data. Review the evidence with each student before deciding on next steps. PathWise does not change grades or make institutional decisions.</div>`,'My cohort');
}

function renderPlan(){
  const advisor=state.user.role==='advisor';
  shell(heading('YOUR GOAL, ONE STEP AT A TIME','A plan you can work with.','Build, follow, and adjust a study plan using your available time.')+(advisor?'<label class="field">Authorized student<select id="plan-student">'+state.students.map(s=>'<option value="'+s.id+'" '+(s.id===state.selected?'selected':'')+'>'+esc(s.name)+'</option>').join('')+'</select></label>':'')+'<div id="planner-host"></div>','Study plan');
  document.querySelector('#plan-student')?.addEventListener('change',event=>{state.selected=Number(event.target.value);state.messages=[];renderRoute();});
  attachPlanner(document.querySelector('#planner-host'));
}
async function attachPlanner(host,compact=false){
  if(!state.selected||!host)return;
  try{const {mountPlanner}=await import('/planner.js');if(host.isConnected)await mountPlanner(host,{api,studentId:state.selected,confirmAction,toast,compact,advisor:state.user.role==='advisor'});}
  catch{if(host.isConnected)host.innerHTML='<p class="notice error">The planning panel could not load. Refresh this page to retry. Your academic dashboard is still available.</p>';}
}
function renderAssistant() {
  const advisor=state.user.role==='advisor';
  shell(`${heading('A LITTLE HELP, WHEN YOU NEED IT','Meet your academic copilot.','Grounded in your academic data. Build a study plan, or ask about your record.')}<div class="chat-layout"><section class="panel chat-panel"><div class="chat-toolbar"><span>${icon('spark')} PathWise Assistant · Structured demo</span><button class="text-link" id="clear-chat" ${!state.messages.length || state.busy ? 'disabled' : ''}>Clear conversation</button></div><div class="messages" id="messages" role="log" aria-live="polite" aria-label="Assistant conversation"></div><form class="chat-form" id="chat-form" novalidate><label for="message" class="sr-only">Ask about your academic progress</label><div class="chat-input-row"><textarea id="message" name="message" rows="2" maxlength="2000" aria-describedby="chat-error" placeholder="What should I focus on this week?" ${state.busy ? 'disabled' : ''}></textarea><button class="button primary" type="submit" aria-label="Send message" ${state.busy || !state.selected ? 'disabled' : ''}>${icon('send')}</button></div><small>Up to 2,000 characters · Use fictional information only · Conversation stays in this tab’s memory</small><div class="error-inline" id="chat-error" role="alert"></div></form></section><aside class="chat-sidebar stack"><section class="panel">${advisor ? `<label class="field" for="selected-student">Authorized student</label><select id="selected-student" ${state.busy ? 'disabled' : ''}>${state.students.map(s => `<option value="${s.id}" ${s.id === state.selected ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>` : '<p class="eyebrow">YOUR RECORD, YOUR CONTEXT</p>'}<a class="button primary" href="/plan">Build or revise my plan →</a><h3>A starting point</h3>${[['Help me plan my assignments','Plan my assignments'],['Show my grades','Review recorded grades'],['Show my academic resources','Find learning resources'],['Explain binary search','Practice a concept']].map(([prompt,label]) => `<button class="suggestion" data-chat-prompt="${esc(prompt)}" ${state.busy ? 'disabled' : ''}>${esc(label)} ${icon('arrow')}</button>`).join('')}</section><section class="panel"><h3>${icon('shield')} Clear boundaries</h3><p>The assistant uses only the selected authorized record. It can’t change academic data or make university decisions.</p><ul><li>No official policies or invented facts</li><li>Learning support, not graded exam answers</li><li>No medical or emergency care</li></ul><p>For official answers, contact your instructor, advisor, or student services.</p></section></aside></div>`,'AI assistant');
  drawMessages();
  document.querySelector('#chat-form').onsubmit=event => {event.preventDefault();sendMessage(document.querySelector('#message').value);};
  document.querySelectorAll('[data-chat-prompt]').forEach(button => button.onclick=() => sendMessage(button.dataset.chatPrompt));
  document.querySelector('#clear-chat').onclick=async () => { if(!state.busy && await confirmAction('Clear this conversation?','Messages will be removed from this tab. They are not saved on the server.','Clear conversation')) {state.messages=[];renderAssistant();} };
  document.querySelector('#selected-student')?.addEventListener('change',async event => {
    const studentId=Number(event.target.value);
    if(state.messages.length && !await confirmAction('Change student context?','The current conversation will be cleared before switching student records.','Switch student')){event.target.value=String(state.selected);return;}
    state.selected=studentId;state.messages=[];state.data=null;await renderRoute();
  });
}
function drawMessages() {
  const box=document.querySelector('#messages');if(!box)return;
  box.innerHTML=state.messages.length ? state.messages.map((m,index) => m.role === 'user' ? `<div class="message user">${esc(m.text)}</div>` : m.error ? `<div class="message error"><p>${esc(m.error)}</p><button class="button small" data-retry="${index}" ${state.busy ? 'disabled' : ''}>Retry</button></div>` : `<div class="message assistant"><div class="message-label">PATHWISE ASSISTANT</div><p>${esc(m.response.summary)}</p>${m.response.priorities.length ? `<ul>${m.response.priorities.map(p => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}${m.response.recommendedResources.map(id => { const resource=state.data?.resources.find(r => r.id === id);return resource ? `<p>${resourceLink(resource)}</p>` : '';}).join('')}${m.response.needsAdvisor ? '<p><small>Consider an advisor check-in about your next steps.</small></p>' : ''}</div>`).join('') : `<div class="chat-welcome"><span class="sparkle">${icon('spark')}</span><h2>Let’s find your next step.</h2><p>Ask about assignments, recorded grades, study planning, or available resources.</p></div>`;
  if(state.busy)box.insertAdjacentHTML('beforeend','<div class="message assistant" role="status">Reviewing authorized academic information…</div>');
  document.querySelectorAll('[data-retry]').forEach(button => button.onclick=() => {const m=state.messages[Number(button.dataset.retry)];sendMessage(m.prompt,true);});
  box.scrollTop=box.scrollHeight;
}
async function sendMessage(message,retry=false) {
  if(state.busy || !state.user || !state.selected)return;
  const context=state.selected;const userId=state.user.id;
  let body;
  try {body=validate(assistantSchema,{message,...(state.user.role === 'advisor' ? {studentId:state.selected} : {})});}
  catch(err) {
    const input=document.querySelector('#message');
    input?.setAttribute('aria-invalid','true');
    document.querySelector('#chat-error').textContent=err.message;
    input?.focus();return;
  }
  try {
    state.busy=true;if(!retry)state.messages.push({role:'user',text:body.message});
    renderAssistant();
    const response=validate(responseSchema,await api('/api/assistant',{method:'POST',body}));
    if(state.selected === context && state.user?.id === userId)state.messages.push({role:'assistant',response});
  } catch(err) {
    if(err.status === 401)return;
    if(state.selected === context && state.user?.id === userId)state.messages.push({role:'assistant',error:err.message,prompt:message});
  } finally {
    state.busy=false;
    if(state.user && location.pathname === '/assistant'){renderAssistant();document.querySelector('#message')?.focus();}
  }
}

function renderFailure(error) {
  if(!state.user)return;
  shell(`${heading(error.status === 403 ? '403 · ACCESS RESTRICTED' : 'LET’S TRY THAT AGAIN',error.status === 403 ? 'This information is private.' : 'We couldn’t load this view.',error.message)}<button class="button primary" id="retry-page">${error.status === 403 ? 'Return to my workspace' : 'Retry'} ${icon('arrow')}</button>`,'Unavailable');
  document.querySelector('#retry-page').onclick=() => error.status === 403 ? navigate(state.user.role === 'advisor' ? '/advisor' : '/dashboard') : renderRoute();
}
async function renderRoute() {
  if(!state.user){renderLogin();return;}
  const epoch=++state.epoch;const path=location.pathname;const advisor=state.user.role === 'advisor';
  if(path === '/login' || path === '/'){history.replaceState({},'',advisor ? '/advisor' : '/dashboard');return renderRoute();}
  shell('<div class="plan-skeleton" role="status" aria-label="Loading your workspace"><span></span><span></span><span></span></div>','Loading');
  try {
    if(path === '/advisor') {
      if(!advisor)throw new RequestError("You don't have permission to view this information.",403);
      const result=await api('/api/advisor/students');if(epoch!==state.epoch)return;
      state.students=result.students;state.data=null;renderAdvisor();return;
    }
    if(path === '/assistant' || path === '/plan') {
      if(advisor){const result=await api('/api/advisor/students');if(epoch!==state.epoch)return;state.students=result.students;state.selected=state.students.some(s => s.id === state.selected) ? state.selected : state.students[0]?.id || null;}
      else state.selected=state.user.studentId;
      if(state.selected){const data=await api(`/api/students/${state.selected}`);if(epoch!==state.epoch)return;state.data=data;}
      if(path === '/plan')renderPlan();else renderAssistant();return;
    }
    if(advisor && !/^\/students\/[1-9]\d{0,8}$/.test(path))throw new RequestError("You don't have permission to view this information.",403);
    const studentId=path.startsWith('/students/') ? path.split('/')[2] : state.user.studentId;
    if(!['/dashboard','/assignments','/courses','/resources'].includes(path) && !/^\/students\/[1-9]\d{0,8}$/.test(path))throw new RequestError('This page does not exist.',404);
    const data=await api(`/api/students/${studentId}`);if(epoch!==state.epoch)return;
    if(state.selected !== data.student.id){state.selected=data.student.id;state.messages=[];}
    state.data=data;
    if(path === '/assignments')renderAssignments(data);
    else if(path === '/courses')renderCourses(data);
    else if(path === '/resources')renderResources(data);
    else renderDashboard(data);
  } catch(err){if(epoch===state.epoch)renderFailure(err);}
  finally {
    if(epoch===state.epoch && state.user) {
      const heading=document.querySelector('#main-content h1');
      heading?.setAttribute('tabindex','-1');heading?.focus({preventScroll:true});
      document.title=`${heading?.textContent || 'Workspace'} · PathWise AI`;
    }
  }
}
window.addEventListener('popstate',() => renderRoute());
try {
  const session=await api('/api/auth/session',{auth:false});acceptSession(session);await renderRoute();
} catch(err) { if(err.status===401) {history.replaceState({},'','/login');renderLogin();} else renderLogin(err.message); }



