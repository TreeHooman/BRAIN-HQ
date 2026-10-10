"use strict";
// Shared item editing and modeless windows. Existing routes remain usable as deep links.
const UPG = { windows:new Map(), front:101, active:null, seq:0, conversation:false, turn:false, lastChat:null, pending:[] };
const upBus = typeof BroadcastChannel === "function" ? new BroadcastChannel("luthur-changes") : null;
const upHost = document.createElement("div"); upHost.className="up-windows"; document.body.append(upHost);
const upKey = v => [v.kind,v.id || v.slug || "",v.step || "",v.acct || ""].join(":");
const upButton = (text, action, cls="") => `<button type="button" class="btn sm ${cls}" data-upaction="${action}">${text}</button>`;
const upField = (label,name,value,type="text") => `<label class="f">${label}<input name="${name}" type="${type}" value="${esc(value || "")}" ${name==="title" ? "required maxlength=200" : ""}></label>`;
function upFront(w) { UPG.active=w.ref;if(w.ref.kind!=="process")UPG.workTarget=w.ref; w.el.style.zIndex=++UPG.front; }
async function upClose(w) { if (w.dirty && !(await uiConfirm("Close this window and discard your unsaved edits?"))) return; w.el.remove(); UPG.windows.delete(upKey(w.ref)); UPG.active=[...UPG.windows.values()].at(-1)?.ref || null; }
async function upOpen(ref) {
  if(route.view==="command"&&document.activeElement?.closest("#nvScreen"))return upScreen(ref);
  const key=upKey(ref); let w=UPG.windows.get(key);
  if(w) { upFront(w); return w; }
  w={ref,el:document.createElement("section"),dirty:false}; w.el.className="up-window"; w.el.setAttribute("role","dialog"); w.el.setAttribute("aria-label","Work window");
  const offset=(UPG.seq++ % 5)*28; w.el.style.left=Math.min(innerWidth-580,90+offset)+"px"; w.el.style.top=(80+offset)+"px";
  w.el.innerHTML=`<header class="up-window-head"><strong>Loading…</strong><button type="button" class="icon-btn" aria-label="Close window">×</button></header><div class="up-window-body">Loading…</div><footer class="up-window-foot"><input placeholder="Ask LUTHUR about this…" aria-label="Message about this window"><button type="button" class="btn sm">Send</button></footer>`;
  UPG.windows.set(key,w); upHost.append(w.el); upFront(w);
  w.el.addEventListener("pointerdown",()=>upFront(w));
  w.el.querySelector("header button").onclick=()=>upClose(w);
  w.el.querySelector("footer button").onclick=()=>{ const i=w.el.querySelector("footer input"); if(!i.value.trim())return; const text=i.value; i.value=""; upFront(w); cmdSend(text); };
  w.el.querySelector("footer input").onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();w.el.querySelector("footer button").click();}};
  const head=w.el.querySelector("header");
  head.onpointerdown=e=>{if(e.target.closest("button")||innerWidth<761)return; e.preventDefault(); const r=w.el.getBoundingClientRect(), x=e.clientX,y=e.clientY; head.setPointerCapture(e.pointerId); head.onpointermove=ev=>{w.el.style.left=Math.max(0,Math.min(innerWidth-80,r.left+ev.clientX-x))+"px";w.el.style.top=Math.max(0,Math.min(innerHeight-60,r.top+ev.clientY-y))+"px";};head.onpointerup=()=>{head.onpointermove=null;};};
  await upPaint(w); return w;
}
async function upMutate(path,method,body,message="Saved") {
  const result=await api(path,method,body); projCache={}; TD.at=0; HIS.data=null; HIS.chats=null;
  await refresh(); Live.tasks=(await api("/tasks")).tasks; upBus?.postMessage("changed");
  render(); await Promise.all([...UPG.windows.values()].filter(w=>!w.dirty).map(upPaint)); toast(message); return result;
}
upBus?.addEventListener("message",async()=>{await refresh(); if(!document.activeElement?.matches("input,textarea,[contenteditable=true]"))render(); for(const w of UPG.windows.values())if(!w.dirty)upPaint(w);});
function upFind(ref) {
  return ref.kind==="reminder" ? S.reminders.find(i=>i.id===ref.id) : ref.kind==="milestone" ? S.milestones.find(i=>i.id===ref.id) : ref.kind==="daily" ? S.today?.items.find(i=>i.id===ref.id) : ref.kind==="routine" ? S.routines?.find(i=>i.id===ref.id) : ref.kind==="goal" ? S.goals.find(i=>i.id===ref.id) : ref.kind==="step" ? S.goals.find(i=>i.id===ref.id)?.steps.find(i=>i.id===ref.step) : null;
}
async function upPaint(w) {
  if(w.dirty||!w.el.isConnected)return; const r=w.ref, box=w.el.querySelector(".up-window-body"); let title="Work window", html="";
  try {
    if(["reminder","milestone","daily","routine","step","goal"].includes(r.kind)) {
      const item=upFind(r); if(!item){box.innerHTML="This item was removed.";return;} title=item.title;
      if(r.kind==="goal") {
        const work=(S.goalWork||[]).find(x=>x.goalId===item.id), done=item.steps.filter(s=>s.done).length;
        html=`<p>${esc(item.why||"")}</p><div class="up-status">${done}/${item.steps.length} complete · ${work?.active?"Agents working":"Ready to plan"}</div><div class="up-toolbar">${upButton("Edit goal","edit")}${item.project?upButton("Project plan","projectplan"):""}${upButton("+ Workstream","addstep")}${upButton("Run ready workstreams","run")}${work?.active?upButton("Stop agents","stop"):""}${upButton("Delete goal","delete","danger")}</div><div class="up-goals">${item.steps.map(s=>{const blocked=(s.dependsOn||[]).filter(id=>!item.steps.find(st=>st.id===id)?.done), tid=work?.steps?.[s.id];return `<div class="up-row ${s.done?"done":""}"><button class="btn sm" type="button" data-upstepdone="${esc(s.id)}" aria-label="${s.done?"Reopen":"Complete"} step">${s.done?"✓":"○"}</button><div class="grow"><button type="button" class="up-item" data-upstep="${esc(s.id)}"><b>${esc(s.title)}</b></button><small>${esc(s.lane||"General")} · ${esc(s.agent||"Unassigned")}${blocked.length?` · waiting on ${blocked.length} step(s)`:" · ready"}</small>${tid?`<button type="button" class="up-item" data-uptask="${esc(tid)}">View agent task →</button>`:""}</div></div>`;}).join("")}</div>`;
      } else {
        const done=r.kind==="routine" ? item.completed.includes(ymd(new Date())) : !!item.done;
        html=`<div class="up-status">${esc(cap(r.kind))} · ${done?"Complete":"Open"}${item.project?" · "+esc(projName(item.project)):""}</div><form class="form" data-upform>${upField("Title","title",item.title)}${r.kind==="reminder"?upField("Due","due",String(item.due).replace(" ","T"),"datetime-local"):r.kind==="milestone"?upField("Date","date",item.date,"date"):r.kind==="daily"?upField("Minutes","mins",item.mins,"number"):r.kind==="routine"?upField("Time","time",item.time,"time")+`<div class="up-days">${DOW.map((day,i)=>`<label><input type="checkbox" name="days" value="${i}" ${item.days.includes(i)?"checked":""}>${day}</label>`).join("")}</div>`:r.kind==="step"?upStepFields(S.goals.find(g=>g.id===r.id),item):""}<div class="row"><button class="btn sm primary">Save edits</button>${upButton(done?"Reopen":"Complete","done")}${upButton("Delete","delete","danger")}</div></form>`;
      }
    } else if(r.kind==="project") {
      const data=await api(`/project/${r.slug}`); w.data=data; title=data.project.name+" · Plan";
      w.el.style.setProperty("--wc",projColor(r.slug));
      html=`<div class="up-toolbar">${upButton("Edit plan","editplan")}<a class="btn sm" href="#project/${esc(r.slug)}" data-upnavigate>Project details</a></div><p><b>Next:</b> ${esc(data.project.nextStep)}</p><div class="up-document">${md(data.plan)}</div><div class="up-evidence" data-upchanged></div>`;
    } else if(r.kind==="task") {
      const data=await api("/tasks"), t=data.tasks.find(t=>t.id===r.id); if(!t){box.innerHTML="Task removed from the list. Its run history is retained.";return;} w.data=t; title=t.title;
      const active=["running","queued","paused"].includes(t.status);
      html=`<div class="up-status">${esc(t.status)} · ${t.runs.length} agent run(s)</div><form class="form" data-upform>${upField("Title","title",t.title)}${t.editablePrompt?`<label class="f">Task instructions<textarea name="prompt" rows="6" maxlength="8000" required>${esc(t.prompt)}</textarea></label>`:`<details><summary>Original instructions</summary><div class="md">${md(t.prompt)}</div></details>`}<div class="row"><button class="btn sm">Save task</button>${active?upButton("Stop work","stop"):upButton("Mark complete","done")}${!active?upButton("Remove task","delete","danger"):""}</div></form><div class="up-live-lines" data-uplive></div>${t.runs.map(run=>`<details ${run.output?"open":""}><summary>${esc(run.title)} · ${esc(run.status)}</summary>${md(run.output||run.error||"Waiting for agent…")}</details>`).join("")}`;
    } else if(r.kind==="agenda"||r.kind==="dailies") {
      title="Upcoming & Daily";
      const rem=S.reminders.filter(i=>!i.done).sort((a,b)=>a.due.localeCompare(b.due));
      const milestones=S.milestones.filter(i=>!i.done).sort((a,b)=>a.date.localeCompare(b.date));
      html=`<h3>Daily work</h3>${(S.today?.items||[]).map(i=>upListItem("daily",i)).join("")}<h3>Reminders</h3>${rem.slice(0,20).map(i=>upListItem("reminder",i)).join("")}<h3>Milestones & deadlines</h3>${milestones.slice(0,12).map(i=>upListItem("milestone",i)).join("")}<h3>Calendar</h3>${(S.calendar?.upcoming||[]).slice(0,12).map(e=>`<div class="up-row"><div><b>${esc(e.title)}</b><small>${esc(fmtWhen(e.start))}</small></div></div>`).join("")}`;
    } else if(r.kind==="schedule") {
      title="Schedule";
      const now=new Date(), d0=new Date(ymd(now)+"T00:00"), end=new Date(d0.getTime()+864e5), soon=new Date(d0.getTime()+15*864e5);
      const rem=S.reminders.filter(i=>!i.done).sort((a,b)=>toDate(a.due)-toDate(b.due));
      const over=rem.filter(i=>toDate(i.due)<now), today=rem.filter(i=>toDate(i.due)>=now&&toDate(i.due)<end), later=rem.filter(i=>toDate(i.due)>=end&&toDate(i.due)<soon);
      const cal=(S.calendar?.upcoming||[]).filter(e=>!e.allDay&&new Date(e.start)>=d0&&new Date(e.start)<end);
      const row=i=>`<div class="up-row"><button type="button" class="btn sm" data-upremdone="${esc(i.id)}" aria-label="Complete ${esc(i.title)}">○</button><button type="button" class="up-item grow" data-upitem="reminder|${esc(i.id)}"><b>${esc(i.title)}</b><small>${esc(fmtWhen(i.due))}${i.project?" · "+esc(projName(i.project)):""}</small></button></div>`;
      const sec=(h,list,cls="")=>list.length?`<h3 class="${cls}">${h}</h3>${list.map(row).join("")}`:"";
      html=`<form class="form up-addrem" data-upaddrem>${upField("New reminder","title","")}<div class="row">${upField("When","due",`${ymd(now)}T${pad(Math.min(23,now.getHours()+1))}:00`,"datetime-local")}<label class="f">Project<select name="project"><option value="">None</option>${S.projects.map(p=>`<option value="${esc(p.slug)}">${esc(p.name)}</option>`).join("")}</select></label></div><button class="btn sm primary">Add reminder</button></form>
        ${sec(`Overdue (${over.length})`,over,"up-late")}${sec("Later today",today)}${cal.length?`<h3>Calendar today</h3>${cal.map(e=>`<div class="up-row"><div><b>${esc(e.title)}</b><small>${esc(fmtWhen(e.start))}</small></div></div>`).join("")}`:""}${sec("Next 2 weeks",later)}${over.length+today.length+later.length+cal.length?"":`<p class="muted">Nothing scheduled.</p>`}`;
    } else if(r.kind==="process") {
      title="LUTHUR · Work process";
      const live=await api("/live"), chat=await api("/chat"), tasks=(await api("/tasks")).tasks;
      const target=UPG.workTarget, project=target?.slug||upFind(target||{})?.project;
      const ops=(live.ops||[]).filter(o=>o.kind==="chat"||!project||o.project===project).slice(-8);
      html=`<p class="muted">${esc(UPG.workRequest||"Discuss, inspect, fix and report on the selected work.")}</p><div class="up-status">${chat.busy?"LUTHUR is working":"Ready for your next instruction"}</div><div class="up-toolbar">${["Tell me what the issue is","What are the possible fixes?","Fix it and verify the change","Do a review pass and give me a report"].map(t=>`<button type="button" class="btn sm" data-upwork="${esc(t)}">${esc(t)}</button>`).join("")}</div>${ops.map(o=>`<details open><summary>${esc(o.title)} · ${esc(o.status)}</summary>${(o.steps||[]).slice(-12).map(s=>`<p class="small">${esc(s.verb||s.kind)} ${esc(s.target||"")}</p>`).join("")}</details>`).join("")||"<p>No tool activity yet. Progress will appear when LUTHUR starts inspecting or changing things.</p>"}<h3>Delegated work</h3>${tasks.filter(t=>!project||t.project===project).slice(0,8).map(t=>`<button type="button" class="up-item" data-uptask="${esc(t.id)}">${esc(t.title)} · ${esc(t.status)}</button>`).join("")||"No delegated tasks."}<h3>Latest report</h3>${md(chat.messages.filter(m=>m.role==="hq").at(-1)?.text||"Your report will appear here.")}`;
    } else if(r.kind==="tasks"||r.kind==="missions") {
      title=r.kind==="tasks"?"Delegated tasks":"Missions & approvals"; const ts=(await api("/tasks")).tasks;
      html=`${ts.map(t=>`<div class="up-row"><button type="button" class="up-item" data-uptask="${esc(t.id)}"><b>${esc(t.title)}</b><small>${esc(t.status)}</small></button></div>`).join("")||"No delegated tasks yet."}${r.kind==="missions"?`<h3>Approvals</h3>${S.approvals.filter(a=>a.status==="pending").map(a=>`<div class="up-row"><div class="grow"><b>${esc(a.title)}</b><small>${esc(a.detail)}</small></div><button type="button" class="btn sm" data-upapprove="${esc(a.id)}">Approve</button><button type="button" class="btn sm" data-upreject="${esc(a.id)}">Reject</button></div>`).join("")}<h3>Scheduled missions</h3>${S.missions.map(m=>`<div class="up-row"><div class="grow"><b>${esc(m.title)}</b><small>${esc(m.scheduleText)}</small></div><button class="btn sm" type="button" data-upmission="${esc(m.id)}">Run now</button></div>`).join("")}`:""}`;
    } else if(r.kind==="goals") {
      title="Goals & workstreams"; html=S.goals.map(g=>upListItem("goal",g)).join("")||"Create a goal in Planner to get started.";
    } else if(r.kind==="file"||r.kind==="mail") {
      const data=await api(r.kind==="file"?`/google/preview/${r.acct}/${r.id}${r.tab?"?tab="+encodeURIComponent(r.tab):""}`:`/google/mail/${r.acct}/${r.id}`); w.data=data; title=data.file?.name||data.subject||"File";
      if(r.kind==="mail")html=`<p>${esc(data.from)}</p><pre class="scr-mail">${esc(data.body||"")}</pre>`;
      else if(data.kind==="sheet") {
        const width=Math.max(1,...(data.rows||[]).map(row=>row.length));
        html=`<div class="up-toolbar">${(data.tabs||[]).map(tab=>`<button type="button" class="btn sm" data-uptab="${esc(typeof tab==="string"?tab:tab.title)}">${esc(typeof tab==="string"?tab:tab.title)}</button>`).join("")}${data.file?.write?upButton("Save cells","savecells","primary"):"<small>Read-only · enable writing in Workspace Accounts to edit.</small>"}</div><div class="up-sheet"><table>${[...(data.rows||[]),...(data.file?.write?[[],[],[]]:[])].map((row,i)=>`<tr>${Array.from({length:width+(data.file?.write?1:0)},(_,j)=>`<td ${data.file?.write?'contenteditable="plaintext-only"':""} data-upcell="${i},${j}">${esc(row[j]??"")}</td>`).join("")}</tr>`).join("")}</table></div>`;
      } else html=`<pre class="scr-mail">${esc(data.text||"Preview available in Workspace.")}</pre>${data.file?.write?`<form class="form" data-updoc>${upField("Find text","find","")}<label class="f">Replace with<textarea name="replace"></textarea></label><button class="btn sm primary">Replace matching text</button></form>`:""}`;
      if(data.file?.link) html+=`<a class="btn sm" href="${esc(data.file.link)}" target="_blank" rel="noopener">Open in Google ↗</a>`;
    } else if(r.kind==="timer") {
      title="Focus timer"; html=`<p>Your timer keeps running in War Room.</p><div class="up-toolbar">${[15,25,45,60].map(m=>`<button class="btn" data-uptimer="${m}">${m} min</button>`).join("")}</div><button class="btn" type="button" data-uptimer="0">Reset timer</button>`;
    }
    w.el.querySelector("header strong").textContent=title; w.el.setAttribute("aria-label",title); box.innerHTML=html;
    upBind(w);
  } catch(e) { box.innerHTML=`<p>${esc(e.message)}</p><button class="btn sm" data-upretry>Retry</button>`; box.querySelector("[data-upretry]").onclick=()=>upPaint(w); }
}
function upListItem(kind,i) { return `<div class="up-row ${i.done?"done":""}"><button type="button" class="up-item" data-upitem="${kind}|${esc(i.id)}"><b>${esc(i.title)}</b><small>${esc(i.due||i.date||i.why||"")}</small></button></div>`; }
function upStepFields(goal,step) { return `${upField("Workstream","lane",step.lane)}${upField("Agent role","agent",step.agent)}${upField("Due date","due",step.due,"date")}<label class="f">Instructions<textarea name="notes">${esc(step.notes||"")}</textarea></label><label class="f">Wait for these steps<select name="dependsOn" multiple size="${Math.min(5,Math.max(2,goal.steps.length))}">${goal.steps.filter(s=>s.id!==step.id).map(s=>`<option value="${esc(s.id)}" ${(step.dependsOn||[]).includes(s.id)?"selected":""}>${esc(s.title)}</option>`).join("")}</select></label>`; }
function upBind(w) {
  const box=w.el.querySelector(".up-window-body"), r=w.ref;
  box.querySelectorAll("input,textarea,select,[contenteditable]").forEach(i=>i.addEventListener("input",()=>{w.dirty=true;}));
  box.querySelectorAll("[data-upaction]").forEach(b=>b.onclick=()=>upAction(w,b.dataset.upaction).catch(e=>toast(e.message,6000)));
  box.querySelectorAll("[data-upitem]").forEach(b=>b.onclick=()=>{const [kind,id]=b.dataset.upitem.split("|");upOpen({kind,id});});
  box.querySelectorAll("[data-upstep]").forEach(b=>b.onclick=()=>upOpen({kind:"step",id:r.id,step:b.dataset.upstep}));
  box.querySelectorAll("[data-upstepdone]").forEach(b=>b.onclick=async()=>{const step=upFind({kind:"step",id:r.id,step:b.dataset.upstepdone});try{await upMutate(`/goals/${r.id}/steps/${step.id}`,"PATCH",{done:!step.done},step.done?"Reopened":"Complete");}catch(e){toast(e.message);}});
  box.querySelectorAll("[data-uptask]").forEach(b=>b.onclick=()=>upOpen({kind:"task",id:b.dataset.uptask}));
  box.querySelectorAll("[data-upremdone]").forEach(b=>b.onclick=()=>upMutate(`/reminders/${b.dataset.upremdone}`,"PATCH",{complete:true},"Done").catch(e=>toast(e.message)));
  box.querySelector("[data-upaddrem]")?.addEventListener("submit",async e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.target));if(!f.title.trim())return;w.dirty=false;try{await upMutate("/reminders","POST",{title:f.title.trim(),due:f.due,project:f.project||undefined},"Reminder added");}catch(er){toast(er.message,6000);}});
  box.querySelectorAll("[data-upwork]").forEach(b=>b.onclick=()=>cmdSend(b.dataset.upwork));
  box.querySelectorAll("[data-upapprove],[data-upreject]").forEach(b=>b.onclick=()=>upMutate(`/approvals/${b.dataset.upapprove||b.dataset.upreject}`,"POST",{approve:!!b.dataset.upapprove}).catch(e=>toast(e.message)));
  box.querySelectorAll("[data-upmission]").forEach(b=>b.onclick=()=>upMutate(`/missions/${b.dataset.upmission}/run`,"POST",{}).catch(e=>toast(e.message)));
  box.querySelectorAll("[data-uptab]").forEach(b=>b.onclick=async()=>{if(w.dirty&&!(await uiConfirm("Discard unsaved cell edits to change tabs?")))return;w.dirty=false;r.tab=b.dataset.uptab;upPaint(w);});
  box.querySelectorAll("[data-uptimer]").forEach(b=>b.onclick=()=>{const m=Number(b.dataset.uptimer); Gap.timer=Gap.timer||gapTimerLoad();Gap.timer.remaining=Gap.timer.duration=(m||25)*60;Gap.timer.endAt=m?Date.now()+m*60000:0;gapTimerSave();gapTimerPaint();toast(m?`Timer started · ${m} min`:"Timer reset");});
  box.querySelector("[data-updoc]")?.addEventListener("submit",async e=>{e.preventDefault();try{const f=Object.fromEntries(new FormData(e.target));if(!f.find.trim())return;await upMutate(`/google/doc/${r.acct}/${r.id}/replace`,"POST",f,"Document updated");w.dirty=false;upPaint(w);}catch(e){toast(e.message);}});
  box.querySelector("[data-upform]")?.addEventListener("submit",async e=>{e.preventDefault();const f=new FormData(e.target), patch=Object.fromEntries(f); if(r.kind==="routine")patch.days=f.getAll("days").map(Number); if(r.kind==="step")patch.dependsOn=f.getAll("dependsOn"); const path=r.kind==="step"?"/goals":r.kind==="daily"?`/today/items/${r.id}`:r.kind==="task"?`/tasks/${r.id}`:`/${r.kind}s/${r.id}`;
    try { if(r.kind==="step"){const goal=structuredClone(S.goals.find(g=>g.id===r.id));Object.assign(goal.steps.find(s=>s.id===r.step),patch);await upMutate(path,"POST",goal);}else await upMutate(path,r.kind==="routine"?"PUT":"PATCH",patch);w.dirty=false;upPaint(w); }catch(e){toast(e.message,6000);} });
}
async function upAction(w,action) {
  const r=w.ref, item=upFind(r);
  if(action==="editplan") { const box=w.el.querySelector(".up-window-body");box.innerHTML=`<form class="form"><label class="f">Project plan<textarea class="up-plan">${esc(w.data.plan)}</textarea></label><div class="row"><button class="btn primary">Save plan</button>${upButton("Cancel","cancel")}</div></form>`;box.querySelector("textarea").oninput=()=>w.dirty=true;box.querySelector("[data-upaction]").onclick=()=>{w.dirty=false;upPaint(w);};box.querySelector("form").onsubmit=async e=>{e.preventDefault();try{await upMutate(`/project/${r.slug}/doc/plan`,"PUT",{content:box.querySelector("textarea").value},"Plan saved");w.dirty=false;upPaint(w);}catch(e){toast(e.message);}};return; }
  if(action==="savecells") { const cells=[...w.el.querySelectorAll("[data-upcell]")].filter(c=>{const [row,col]=c.dataset.upcell.split(",").map(Number);return c.textContent!==String(w.data.rows?.[row]?.[col]??"");}).map(c=>{const [r,cx]=c.dataset.upcell.split(",").map(Number);return {r,c:cx,v:c.textContent};});if(!cells.length)return toast("No cell changes");await upMutate(`/google/sheet/${r.acct}/${r.id}`,"POST",{tab:w.data.tab,cells},"Cells saved");w.dirty=false;return upPaint(w); }
  if(action==="edit"&&r.kind==="goal")return upGoalEditor(item);
  if(action==="projectplan"&&item?.project)return upOpen({kind:"project",slug:item.project});
  if(action==="addstep")return upGoalEditor(item,true);
  if(action==="run") { modal(`<h2>Run goal workstreams</h2><p>Independent steps can run together. Each dependent step waits for its prerequisites to finish.</p><form class="form" id="upRunGoal"><label class="f">Agents may<select name="permission"><option value="read">Research and report only</option><option value="plan" selected>Update notes and plans</option><option value="build">Edit code in project folders</option></select></label><div class="row"><button class="btn primary">Run ready workstreams</button><button class="btn" type="button" data-close>Cancel</button></div></form>`);document.getElementById("upRunGoal").onsubmit=async e=>{e.preventDefault();try{await upMutate(`/goals/${r.id}/work`,"POST",{permission:new FormData(e.target).get("permission"),tier:currentTier()},"Ready workstreams queued");closeModal();}catch(e){toast(e.message);}};return; }
  if(action==="stop")return upMutate(r.kind==="goal"?`/goals/${r.id}/stop`:`/tasks/${r.id}/cancel`,"POST",{},"Stopped");
  const path=r.kind==="step"?"/goals":r.kind==="goal"?`/goals/${r.id}`:r.kind==="daily"?`/today/items/${r.id}`:`/${r.kind}s/${r.id}`;
  if(action==="delete") {if(!(await uiConfirm(`Delete “${item?.title||w.data?.title}”?`)))return;
    if(r.kind==="step"){const goal=structuredClone(S.goals.find(g=>g.id===r.id));goal.steps=goal.steps.filter(s=>s.id!==r.step);goal.steps.forEach(s=>s.dependsOn=(s.dependsOn||[]).filter(id=>id!==r.step));await upMutate("/goals","POST",goal,"Step deleted");}else{if(r.kind==="goal")await api(`/goals/${r.id}/stop`,"POST",{});await upMutate(path,"DELETE",undefined,"Removed");}w.dirty=false;upClose(w);return;
  }
  if(action==="done") {if(r.kind==="step"){const step=upFind(r);await upMutate(`/goals/${r.id}/steps/${r.step}`,"PATCH",{done:!step.done});}
    else await upMutate(path,"PATCH",r.kind==="reminder"?(!item.done?{complete:true}:{done:false}):{done:r.kind==="routine"?!item.completed.includes(ymd(new Date())):!item?.done},"Status updated");w.dirty=false;upPaint(w);}
}
function upGoalEditor(goal,add=false) {
  modal(`<h2>${add?"Add workstream":"Edit goal"}</h2><form class="form" id="upGoalForm">${upField("Title","title",add?"":goal.title)}${add?upField("Workstream","lane","")+upField("Agent role","agent","")+`<label class="f">Instructions<textarea name="notes"></textarea></label>`:`${upField("Due","due",goal.due,"date")}<label class="f">Purpose<textarea name="why">${esc(goal.why||"")}</textarea></label>`}<div class="row"><button class="btn primary">Save</button><button type="button" class="btn" data-close>Cancel</button></div></form>`);
  document.getElementById("upGoalForm").onsubmit=async e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.target)), g=structuredClone(S.goals.find(x=>x.id===goal.id));if(add)g.steps.push({id:"s-"+Date.now().toString(36),...f,done:false,dependsOn:[]});else Object.assign(g,f);try{await upMutate("/goals","POST",g);closeModal();}catch(e){toast(e.message);}};
}

// Dailies: a reusable routine with completion stored by date, alongside today's linked goals.
const upHome= vHome;
vHome=function(el){upHome(el);upDailiesMount(el);};
const upTdPaint=tdPaint;
tdPaint=function(el){upTdPaint(el);upDailiesMount(el);};
function upDailiesMount(el) {
  if(!S||el.querySelector(".up-routines"))return;
  const heading=el.querySelector(".td-head h1"); if(heading)heading.textContent="Daily";
  const section=document.createElement("section"); section.className="card nv-panel up-routines";
  const now=new Date(), date=ymd(now), routines=S.routines||[], todays=routines.filter(r=>r.days.includes(now.getDay())), done=todays.filter(r=>r.completed.includes(date)).length;
  section.innerHTML=`<div class="between"><div class="panel-title">Daily routine <small>${done}/${todays.length} complete</small></div><button type="button" class="btn sm" data-upnewroutine>+ Routine</button></div>${todays.map(r=>`<div class="up-row ${r.completed.includes(date)?"done":""}"><button type="button" class="btn sm" data-uprt="${esc(r.id)}" aria-label="${r.completed.includes(date)?"Reopen":"Complete"} ${esc(r.title)}">${r.completed.includes(date)?"✓":"○"}</button><div class="grow"><button type="button" class="up-item" data-upitem="routine|${esc(r.id)}"><b>${esc(r.title)}</b></button><small>${esc(r.time)}</small></div></div>`).join("")||`<p class="small muted">Add repeatable checks and habits to give your workday a rhythm.</p>`}${routines.length>todays.length?`<details><summary>Other days (${routines.length-todays.length})</summary>${routines.filter(r=>!todays.includes(r)).map(r=>upListItem("routine",r)).join("")}</details>`:""}`;
  (el.querySelector(".td-head")||el.firstElementChild)?.after(section);
  section.querySelector("[data-upnewroutine]").onclick=upNewRoutine;
  section.querySelectorAll("[data-uprt]").forEach(b=>b.onclick=()=>{const r=routines.find(r=>r.id===b.dataset.uprt);upMutate(`/routines/${r.id}`,"PATCH",{done:!r.completed.includes(date)},r.completed.includes(date)?"Reopened":"Routine complete").catch(e=>toast(e.message));});
  section.querySelectorAll("[data-upitem]").forEach(b=>b.onclick=()=>upOpen({kind:"routine",id:b.dataset.upitem.split("|")[1]}));
}
function upNewRoutine() {
  modal(`<h2>New daily routine</h2><form class="form" id="upRoutineForm">${upField("What to check or do","title","")}${upField("Time","time","09:00","time")}<div class="up-days">${DOW.map((d,i)=>`<label><input type="checkbox" name="days" value="${i}" ${i>0&&i<6?"checked":""}>${d}</label>`).join("")}</div><div class="row"><button class="btn primary">Add routine</button><button class="btn" type="button" data-close>Cancel</button></div></form>`);
  document.getElementById("upRoutineForm").onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);try{await upMutate("/routines","POST",{title:f.get("title"),time:f.get("time"),days:f.getAll("days").map(Number)});closeModal();}catch(e){toast(e.message);}};
}

// Merge navigation into hubs while preserving routes and the existing tools.
const upProjects=vProjects,upRoadmap=vRoadmap,upAssistant=vAssistant,upMissions=vMissions;
function upHubNav(el,kind,current) {
  const nav=document.createElement("nav");nav.className="up-nav";nav.setAttribute("aria-label",kind==="projects"?"Project views":"LUTHUR views");
  nav.innerHTML=kind==="projects"?`<a class="btn sm ${current==="projects"?"on":""}" href="#projects">Projects</a><a class="btn sm ${current==="roadmap"?"on":""}" href="#projects/roadmap">Roadmap</a>`:`<a class="btn sm ${current==="assistant"?"on":""}" href="#assistant">Conversation</a><a class="btn sm ${current==="missions"?"on":""}" href="#assistant/missions">Missions & approvals</a><a class="btn sm" href="#history/chats">Saved chats</a><a class="btn sm" href="#tasks">Delegated tasks</a>`;
  el.prepend(nav);
}
vProjects=async function(el){if(route.arg==="roadmap"){await upRoadmap(el);upHubNav(el,"projects","roadmap");}else{await upProjects(el);upHubNav(el,"projects","projects");}};
vAssistant=async function(el){if(route.arg==="missions"){await upMissions(el);upHubNav(el,"assistant","missions");}else{await upAssistant(el);upHubNav(el,"assistant","assistant");const note=document.createElement("p");note.className="small muted";note.textContent="War Room and this conversation share one chat. Find older conversations in Saved chats; coding chats stay under Code.";el.querySelector(".up-nav").after(note);}};
const upHistory=vHistory;
// #history/chats opens on Chats once per visit; later tab clicks must not snap back.
vHistory=async function(el){if(route.arg==="chats"&&HIS.entered!==location.hash)HIS.tab="chats";HIS.entered=location.hash;await upHistory(el);};window.addEventListener("hashchange",()=>{HIS.entered=null;});
for(const [k] of VIEWS){const v=VIEWS.find(x=>x[0]===k);if(k==="home")v[1]="Daily";if(k==="command")v[1]="War Room";}
document.querySelector('#nav [data-view="home"] span')?.replaceChildren("Daily");
for(const view of ["missions","roadmap"]){const a=document.querySelector(`#nav a[data-view="${view}"]`);if(a){a.hidden=true;a.style.display="none";}}

// Repository picker: scopes a coding chat to one registered local folder, with associated GitHub links.
codeNewModal=function(){
  const projects=codeProjects();if(!projects.length)return toast("Add a repository folder in Project → Setup first.");
  modal(`<h2>New coding chat</h2><p class="small muted">Choose the project and repository this agent will work in.</p><form class="form" id="upCodeForm"><label class="f">Project<select name="project">${projects.map(p=>`<option value="${esc(p.slug)}" ${activeProject()===p.slug?"selected":""}>${esc(p.name)}</option>`).join("")}</select></label><label class="f">Repository / local folder<select name="folder"></select></label><div data-uprepos></div>${upField("Chat name","name","")}<label class="f">First job (optional)<textarea name="text"></textarea></label><div class="row"><button class="btn primary">Start chat</button><button class="btn" type="button" data-close>Cancel</button></div></form>`);
  const f=document.getElementById("upCodeForm"), sync=()=>{const p=projects.find(p=>p.slug===f.elements.project.value);f.elements.folder.innerHTML=(p.paths||[]).map(path=>`<option value="${esc(path)}">${esc(path)}</option>`).join("");f.querySelector("[data-uprepos]").innerHTML=(p.repos||[]).map(upRepoLink).join(" ")+` <button class="btn sm" type="button" data-uplinkrepo>Link GitHub repository</button>`;f.querySelector("[data-uplinkrepo]").onclick=()=>upRepoModal(p,sync);};f.elements.project.onchange=sync;sync();
  f.onsubmit=async e=>{e.preventDefault();const values=Object.fromEntries(new FormData(f));try{const {id}=await api("/code","POST",values);if(values.text.trim())await api(`/code/${id}`,"POST",{text:values.text,tier:currentTier()});closeModal();Live.code=await api("/code");codeGrid();codeOpen(id);liveKick();}catch(e){toast(e.message,6000);}};
};
function upRepoLink(repo){const match=String(repo).match(/^(?:https:\/\/github\.com\/)?([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/);return match?`<a class="btn sm" href="https://github.com/${esc(match[1])}" target="_blank" rel="noopener">GitHub · ${esc(match[1])}</a>`:"";}
function upRepoModal(p,after){const raw=prompt("GitHub repository (owner/repo or https://github.com/owner/repo)");if(!raw)return;const m=raw.trim().match(/^(?:https:\/\/github\.com\/)?([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/);if(!m)return toast("Enter a GitHub repository such as owner/repo.");upMutate(`/project/${p.slug}`,"PUT",{repos:[...new Set([...(p.repos||[]),m[1]])]},"Repository linked").then(()=>{p.repos=S.projects.find(x=>x.slug===p.slug).repos;after?.();}).catch(e=>toast(e.message));}

// Context follows the foreground window, so a follow-up 'change this' has an exact target.
const upContext=cmdContext;
cmdContext=function(){const c=upContext(),r=UPG.active?.kind==="process"?UPG.workTarget:UPG.active;if(!r)return c;const w=(UPG.screenW&&upKey(UPG.screenW.ref)===upKey(r)?UPG.screenW:UPG.windows.get(upKey(r)));c.screen={k:r.kind==="step"?"goal":r.kind,title:w?.el.querySelector("header strong")?.textContent||"",slug:r.slug||upFind(r)?.project||"",id:r.id||"",step:r.step||"",acct:r.acct||""};return c;};
function upPlanTarget(text){
  const norm=s=>String(s).toLowerCase().replace(/\b(?:scale|scaling|growth|grow)\b/g,"growth").replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim();
  const q=norm(text),terms=q.split(" ").filter(t=>!["the","my","plan","specifically"].includes(t));
  if(!terms.length)return null;
  const exactProject=S.projects.find(p=>norm(p.name)===terms.join(" ")||norm(p.slug)===terms.join(" "));
  if(exactProject)return{kind:"project",slug:exactProject.slug};
  const goals=S.goals.filter(g=>terms.every(t=>norm(g.title+" "+(g.why||"")).includes(t)));
  if(goals.length===1)return{kind:"goal",id:goals[0].id};
  const projects=S.projects.filter(p=>terms.every(t=>norm(p.name+" "+p.summary+" "+(p.tags||[]).join(" ")).includes(t)));
  return projects.length===1?{kind:"project",slug:projects[0].slug}:null;
}
const upScrResolve=scrResolve;
scrResolve=function(text){const target=/\b(plan|scale|scaling|growth)\b/i.test(text)&&upPlanTarget(text);if(target)return target.kind==="goal"?{k:"goal",id:target.id}:{k:"project",slug:target.slug};const normalized=String(text).toLowerCase().replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim();const goal=S.goals.find(g=>g.title.toLowerCase()===normalized);if(goal)return{k:"goal",id:goal.id};return upScrResolve(text);};
const upScrGo=scrGo;
scrGo=async function(v,push=true){if(v.k==="work"||v.k==="view"){if(push&&Scr.cur)Scr.stack.push(Scr.cur);Scr.cur=v;Scr.data={};scrPaint();return;}const open=route.view==="command"?(ref=>upScreen(ref,push)):upOpen;if(v.k==="goal")return open({kind:"goal",id:v.id});if(v.k==="project")return open({kind:"project",slug:v.slug});if(v.k==="file"||v.k==="mailone")return open({kind:v.k==="file"?"file":"mail",acct:v.acct,id:v.id});return upScrGo(v,push);};
const upMaterial=scrMaterial;
scrMaterial=function(){const r=UPG.active,w=r&&(UPG.screenW&&upKey(UPG.screenW.ref)===upKey(r)?UPG.screenW:UPG.windows.get(upKey(r)));if(!w)return upMaterial();const d=w.data||{},item=upFind(r),title=w.el.querySelector("header strong")?.textContent||"";if(r.kind==="project")return{kind:"project",title,project:r.slug,text:d.plan||""};if(r.kind==="file")return{kind:"file",title,text:d.kind==="sheet"?(d.rows||[]).map(row=>row.join(" | ")).join("\n"):d.text||""};if(r.kind==="mail")return{kind:"email",title,text:d.body||""};if(item)return{kind:r.kind,title,text:r.kind==="goal"?item.steps.map(s=>`${s.done?"Done":"Open"}: ${s.title}`).join("\n"):item.notes||item.title};return upMaterial();};
function upLocalCommand(raw){
  const text=String(raw||"").trim().replace(/^(?:hey\s+)?luth[ou]r[, ]+/i,"");
  if(/^(?:end|stop|exit) (?:the )?conversation$/i.test(text)){upConversation(false);return true;}
  if(/^(?:start|begin) (?:a )?conversation$/i.test(text)){upConversation(true);return true;}
  if(/^(?:show|open|pull up) (?:the )?(?:work |live )?process$/i.test(text)){upOpen({kind:"process"});return true;}
  if(/^(?:pull|bring) (?:this|that|it) up$/i.test(text)&&UPG.workTarget){upOpen(UPG.workTarget);return true;}
  const vol=text.match(/^(?:set )?(?:luth[ou]r |voice |your )?volume(?: to)? (\d{1,3})(?: percent|%)?$/i);if(vol){localStorage.setItem("hq-voice-volume",String(Math.max(0,Math.min(100,Number(vol[1])))/100));toast("Voice volume updated");return true;}
  const m=text.match(/^(?:edit|open|show|pull up)\s+(?:the\s+)?(.+?\bplan)[.!?]*$/i);
  if(m){const target=upPlanTarget(m[1]);if(target){upOpen(target);return true;}}
  return false;
}
const upCmdSend=cmdSend;
cmdSend=function(text){if(upLocalCommand(text))return;const target=UPG.active?.kind==="process"?UPG.workTarget:UPG.active;if((Cmd.waiting||chatState?.busy)&&String(text||"").trim()){if(UPG.pending.length>=5)return toast("Five follow-ups are already queued. Let me finish these first.");UPG.pending.push({text,ref:target?{...target}:null,voice:Date.now()-(window.hqVoiceAt||window.hqVoiceTurn||0)<15000});const input=document.getElementById("cmdText");if(input)input.value="";return toast("Follow-up queued · I’ll continue after this reply.");}if(/\b(issue|bug|broken|fix|check|review|report|pass|diagnos|inspect)\b/i.test(text)){UPG.workRequest=text;if(!target&&route.view==="project")UPG.workTarget={kind:"project",slug:route.arg};upOpen({kind:"process"});}return upCmdSend(text);};
async function upDrain(){if(UPG.draining||Cmd.waiting||!UPG.pending.length)return;UPG.draining=true;try{const chat=await api("/chat");if(chat.busy)return;const next=UPG.pending.shift();if(next.ref)await upOpen(next.ref);if(next.voice)window.hqVoiceAt=Date.now();chatState=null;window.hqQueuedModelChoice=next.modelChoice?{...next.modelChoice,text:next.text}:null;cmdSend(next.text);}catch(e){toast(e.message);}finally{UPG.draining=false;}}
setInterval(upDrain,1500);
const upVoiceCommand=voiceCommand;
voiceCommand=function(text){window.hqVoiceAt=Date.now();window.hqVoiceTurn=Date.now();if(upLocalCommand(text))return;if(musicCommand(text))return;if(typeof scrVoice==="function"&&scrVoice(text))return;if(/^(stop|cancel|never ?mind|be quiet|shut up)$/i.test(text.trim()))return upVoiceCommand(text);UPG.turn=true;cmdSend(text);};
function upConversation(on){UPG.conversation=on;window.hqConversation=on;UPG.turn=false;if(on&&WAKE_PHONE)Wake.toggle();if(on&&!WAKE_PHONE&&!Wake.on)Wake.toggle();if(!on&&Wake.on)Wake.toggle();document.getElementById("upConversation")?.setAttribute("aria-pressed",String(on));toast(on?WAKE_PHONE?"Conversation on. Tap the mic for each turn on mobile.":"Conversation on. Speak naturally; use End conversation when finished.":"Conversation ended");}
const upHeard=Wake.heard;
Wake.heard=function(txt,final,snapshot=false){if(UPG.conversation&&!this.armed&&!window.speechSynthesis?.speaking){this.armed=Date.now();this.buf="";this.committed="";}return upHeard.call(this,txt,final,snapshot);};

// Show the conversation history on War Room, preserving the same server session as the LUTHUR page.
const upShowReply=cmdShowReply;
cmdShowReply=function(c,animate){const prevLog=document.querySelector("#cmdReply .up-chat-log"),prevCount=document.getElementById("cmdReply")?.dataset.chatCount,prevEnd=!prevLog||prevLog.scrollHeight-prevLog.scrollTop-prevLog.clientHeight<40,prevTop=prevLog?.scrollTop||0;upShowReply(c,animate);UPG.lastChat=c;const box=document.getElementById("cmdReply");if(Cmd.waiting&&c?.partial&&box){const partial=String(c.partial).replace(/<spoken>[\s\S]*?<\/spoken>\s*/g,"").replace(/<spoken>[\s\S]*$/g,"");box.innerHTML=`<div class="who">LUTHUR · REPLYING</div><div class="cmd-md up-stream">${esc(partial)}</div>`;}if(c?.messages?.length&&!Cmd.waiting&&box){const html=`<div class="between"><div class="who">LUTHUR · CONVERSATION</div><a href="#history/chats" class="small">Saved chats →</a></div><div class="up-chat-log chat-log">${c.messages.slice(-60).map(m=>`<div class="msg ${m.role} ${m.error?"err":""}">${m.role==="you"?esc(m.text):md(m.text)}<div class="t">${ago(m.at)}</div></div>`).join("")}</div>`;
    // Land on the newest message; keep the owner's place only if they scrolled up and nothing new arrived.
    box.innerHTML=html;box.dataset.chatCount=String(c.messages.length);const log=box.querySelector(".up-chat-log");if(log)log.scrollTop=prevCount!==String(c.messages.length)||prevEnd?log.scrollHeight:prevTop;}if(animate&&!Cmd.waiting){corePing();refresh().then(()=>{for(const w of UPG.windows.values())if(!w.dirty)upPaint(w);});if(UPG.pending.length)setTimeout(upDrain,750);}};

// War Room shows the same conversation as the LUTHUR tab, so pick up messages sent from there or the phone.
setInterval(async()=>{if(route.view!=="command"||Cmd.waiting||document.hidden)return;const c=await api("/chat").catch(()=>null);if(!c||route.view!=="command"||Cmd.waiting)return;const box=document.getElementById("cmdReply");if(!c.busy&&box&&box.dataset.chatCount!==String(c.messages.length))cmdShowReply(c,false);},4000);

// Global quick access and HUD immersion controls.
const hudToggle=document.createElement("button");hudToggle.className="btn sm up-hud-toggle";hudToggle.type="button";hudToggle.title="Show or hide the top HUD (Alt+H)";document.body.append(hudToggle);
function upHudToggle(){document.body.classList.toggle("up-hud-hidden");hudToggle.textContent=document.body.classList.contains("up-hud-hidden")?"Show HUD":"Hide HUD";hudToggle.setAttribute("aria-expanded",String(!document.body.classList.contains("up-hud-hidden")));}hudToggle.textContent="Hide HUD";hudToggle.onclick=upHudToggle;
document.addEventListener("keydown",e=>{if(e.altKey&&e.key.toLowerCase()==="h"){e.preventDefault();upHudToggle();}if(e.altKey&&e.key.toLowerCase()==="w"){e.preventDefault();location.hash="command";}if(e.key==="Escape"&&document.getElementById("modal").hidden){const w=[...UPG.windows.values()].sort((a,b)=>Number(b.el.style.zIndex)-Number(a.el.style.zIndex))[0];if(w)upClose(w);}});
const upChrome=renderChrome;
renderChrome=function(){upChrome();upChromeMount();};
function upChromeMount(){
  const top=document.querySelector(".top");if(!top||!S)return;
  top.classList.toggle("up-command-top",route.view==="command");
  if(!document.getElementById("upWarRoom")){const a=document.createElement("a");a.id="upWarRoom";a.className="up-eye-link";a.setAttribute("aria-label","War Room");a.href="#command";a.title="War Room (Alt+W)";a.innerHTML='<img src="eye.svg" width="34" height="26" alt="">';const menu=document.getElementById("sideBtn");if(menu)menu.after(a);else top.prepend(a);}
  if(!document.getElementById("upConversation")){const b=document.createElement("button");b.id="upConversation";b.className="btn sm";b.type="button";b.textContent="Conversation";b.setAttribute("aria-pressed",String(UPG.conversation));b.onclick=()=>upConversation(!UPG.conversation);top.querySelector("#openPal")?.after(b);}
  if(!document.getElementById("upVolume")){const l=document.createElement("label");l.className="up-volume";l.innerHTML=`Voice <input id="upVolume" type="range" min="0" max="100" value="${Number(localStorage.getItem("hq-voice-volume")??1)*100}" aria-label="LUTHUR voice volume">`;top.append(l);l.querySelector("input").oninput=e=>localStorage.setItem("hq-voice-volume",String(Number(e.target.value)/100));}
  if(!document.getElementById("upVoiceControls")){const d=document.createElement("details");d.id="upVoiceControls";d.className="up-voice-controls";d.innerHTML='<summary title="Voice conversation and volume">Voice</summary><div class="up-voice-panel"></div>';top.querySelector(".brief-btn")?.after(d);if(!d.parentElement)top.append(d);const panel=d.querySelector("div");panel.append(document.getElementById("upConversation"),document.getElementById("upVolume").closest("label"));}
  const home=document.querySelector('#tabbar [data-tab="home"] span');if(home&&home.textContent!=="Daily")home.textContent="Daily";
  const ball=document.querySelector(".tab-core i");if(ball){const img=document.createElement("img");img.src="icon.svg";img.alt="LUTHUR";ball.replaceWith(img);}
}

// Known item ids always win over fuzzy title matching. War Room clicks keep the screen in place.
document.addEventListener("click",e=>{
  const target=e.target instanceof Element?e.target:null;if(!target||target.closest(".up-window"))return;
  const open=target.closest("[data-upopen]");if(open){e.preventDefault();e.stopImmediatePropagation();upOpen(JSON.parse(open.dataset.upopen));return;}
  const node=target.closest(".node[data-step]");if(node&&!target.closest("[data-tick]")){const id=node.closest("[data-goal]")?.dataset.goal;if(id){e.preventDefault();e.stopImmediatePropagation();upOpen({kind:"step",id,step:node.dataset.step});return;}}
  const rm=target.closest("[data-rm]");if(rm){const [kind,id,step]=rm.dataset.rm.split("|");if(kind==="ms"||kind==="st"){e.preventDefault();e.stopImmediatePropagation();upOpen({kind:kind==="ms"?"milestone":"step",id,step});return;}}
  if(route.view!=="command")return;
  const music=target.closest(".mus-hud");if(music&&!target.closest("button,.mus-seek,input")){e.preventDefault();e.stopImmediatePropagation();musicToggle(true);return;}
  const widget=target.closest("#gapLive,#gapCalendar");if(widget){e.preventDefault();e.stopImmediatePropagation();upOpen({kind:widget.id==="gapLive"?"agentloop":"agenda"});return;}
  const satellite=target.closest(".nv-sat");if(satellite){const sat=Orb.sats.find(s=>s.n===satellite);if(sat&&!Orb.dragMoved){e.preventDefault();e.stopImmediatePropagation();upOpen({kind:"project",slug:sat.p.slug});}return;}
  const a=target.closest('a[href^="#"]');if(!a||a.closest(".top,#tabbar,.side,.up-nav"))return;
  const hash=a.getAttribute("href").slice(1),text=a.querySelector(".t,.gap-event-title")?.textContent?.trim();
  let ref;const reminder=S.reminders.find(r=>r.title===text),milestone=S.milestones.find(m=>m.title===text);
  if(reminder)ref={kind:"reminder",id:reminder.id};else if(milestone)ref={kind:"milestone",id:milestone.id};
  else if(hash.startsWith("project/"))ref={kind:"project",slug:hash.slice(8)};else if(hash==="calendar"||hash==="home")ref={kind:"agenda"};else if(hash==="tasks"||hash==="missions")ref={kind:hash};else if(hash==="planner"||hash==="roadmap")ref={kind:"goals"};else if(hash.startsWith("workspace/mail/")){const [,,acct,id]=hash.split("/");ref={kind:"mail",acct,id};}
  if(ref){e.preventDefault();e.stopImmediatePropagation();upOpen(ref);}
},true);
function upAnnotate(){
  if(!S)return;
  const view=document.getElementById("view");
  const attach=(row,ref)=>{if(!row||row.querySelector("[data-upopen]"))return;const b=document.createElement("button");b.type="button";b.className="btn sm ghost";b.textContent="Edit / details";b.dataset.upopen=JSON.stringify(ref);row.append(b);};
  view.querySelectorAll("[data-done],[data-delrem],[data-tdrem],[data-remdone]").forEach(b=>attach(b.closest("li,.td-ev"),{kind:"reminder",id:b.dataset.done||b.dataset.delrem||b.dataset.tdrem||b.dataset.remdone}));
  view.querySelectorAll("[data-tdg]").forEach(b=>attach(b.closest("li"),{kind:"daily",id:b.dataset.tdg}));
  view.querySelectorAll("[data-delms]").forEach(b=>attach(b.closest("li"),{kind:"milestone",id:b.dataset.delms}));
  view.querySelectorAll("[data-pdstep]").forEach(b=>{const [id,step]=b.dataset.pdstep.split("|");attach(b.closest("li"),{kind:"step",id,step});});
  view.querySelectorAll("[data-gs]").forEach(b=>{const card=CV.data?.cards?.find(c=>c.id===b.closest(".cv-card")?.dataset.c);if(card?.ref)attach(b.closest(".cv-step"),{kind:"step",id:card.ref,step:b.dataset.gs});});
  view.querySelectorAll(".goal[data-goal]").forEach(g=>attach(g.querySelector(".goal-head .row"),{kind:"goal",id:g.dataset.goal}));
  view.querySelectorAll(".lv-task[data-task]").forEach(t=>attach(t.querySelector(".h"),{kind:"task",id:t.dataset.task}));
  if(route.view==="project"){const p=S.projects.find(p=>p.slug===route.arg);const toolbar=view.querySelector(".between");if(p&&toolbar&&!toolbar.querySelector("[data-upgithub]")){const b=document.createElement("button");b.type="button";b.className="btn sm";b.dataset.upgithub="1";b.textContent="GitHub repositories";b.onclick=()=>upRepoModal(p,()=>render());toolbar.append(b);}}
  upChromeMount();
}
let upAnnotationTimer;
new MutationObserver(()=>{clearTimeout(upAnnotationTimer);upAnnotationTimer=setTimeout(upAnnotate,80);}).observe(document.getElementById("view"),{childList:true,subtree:true});
setInterval(async()=>{
  if(document.hidden||!UPG.windows.size&&!UPG.screenW)return;
  try{const live=await api("/live");for(const w of [...UPG.windows.values(),...(UPG.screenW?[UPG.screenW]:[])]){const lines=w.el.querySelector("[data-uplive]");if(lines){const ops=(live.ops||[]).filter(o=>w.data?.runs?.some(r=>r.id===o.id));lines.innerHTML=ops.flatMap(o=>(o.steps||[]).slice(-6).map(s=>`<p>${esc(s.verb||"")} ${esc(s.target||"")}</p>`)).join("");}
    if(w.ref.kind==="project"&&!w.dirty&&Cmd.waiting){const next=await api(`/project/${w.ref.slug}`);if(next.plan!==w.data?.plan){w.data=next;const doc=w.el.querySelector(".up-document");if(doc)doc.innerHTML=md(next.plan);const stamp=w.el.querySelector("[data-upchanged]");if(stamp)stamp.textContent="Updated by LUTHUR · "+new Date().toLocaleTimeString();}}
    if(!w.dirty&&!w.el.querySelector(".up-window-body").contains(document.activeElement)&&(["goal","tasks","task","process"].includes(w.ref.kind)||w.ref.kind==="file"&&Cmd.waiting))await upPaint(w);
  }}catch{}
},2000);

// Screen-local work: launcher choices stay in the Command panel, with its own Back/Home stack.
const upScreenCache=new Map();
function upScreen(ref,push=true){return scrGo({k:'work',ref},push);}
function upScreenView(view){if(view==='missions')return upScreen({kind:'missions'});return scrGo({k:'view',view});}
const upScreenBody=scrBody;
scrBody=function(){return ['work','view'].includes(Scr.cur?.k)?'<div id="upScreenSlot"></div>':upScreenBody();};
const upScreenTitle=scrTitle;
scrTitle=function(v){return v?.k==='work'?(upFind(v.ref)?.title|| (v.ref.slug?projName(v.ref.slug):cap(v.ref.kind))):v?.k==='view'?cap(v.view):upScreenTitle(v);};
const upScreenPaint=scrPaint;
scrPaint=function(){
  upScreenPaint();const slot=document.getElementById('upScreenSlot'),v=Scr.cur;
  if(!slot){if(UPG.screenW&&UPG.active===UPG.screenW.ref)UPG.active=null;UPG.screenW=null;return;}
  if(v.k==='view'){
    UPG.active=null;UPG.screenW=null;
    const fn={history:vHistory,outbox:vOutbox}[v.view];
    if(fn)Promise.resolve(fn(slot)).catch(e=>{slot.textContent=e.message;});
    else slot.textContent='Choose an item from the screen home.';
    return;
  }
  const key=upKey(v.ref);let w=upScreenCache.get(key);
  if(!w){w={ref:v.ref,el:document.createElement('section'),dirty:false};w.el.className='up-inline';w.el.innerHTML='<header><strong>Loading…</strong></header><div class="up-window-body"></div>';upScreenCache.set(key,w);}
  slot.append(w.el);UPG.screenW=w;UPG.active=w.ref;UPG.workTarget=w.ref;
  w.el.onpointerdown=()=>{UPG.active=w.ref;UPG.workTarget=w.ref;};
  upPaint(w);
};
// Screen links and detail controls also stay local, including links rendered by embedded views.
document.getElementById('view').addEventListener('click',e=>{
  const t=e.target instanceof Element?e.target:null;if(route.view!=='command'||!t?.closest('#nvScreen'))return;
  const edit=t.closest('[data-upopen]');if(edit){e.preventDefault();e.stopImmediatePropagation();upScreen(JSON.parse(edit.dataset.upopen));return;}
  const a=t.closest('a[href^="#"]');if(!a)return;
  const hash=a.getAttribute('href').slice(1);e.preventDefault();e.stopImmediatePropagation();
  if(hash.startsWith('project/'))upScreen({kind:'project',slug:hash.slice(8)});
  else if(hash==='home'||hash==='calendar')scrGo({k:'agenda',days:1});
  else if(hash==='tasks'||hash==='missions')upScreen({kind:hash});
  else if(hash==='planner'||hash==='roadmap')upScreen({kind:'goals'});
  else if(hash==='history'||hash==='history/chats'){HIS.tab=hash.endsWith('/chats')?'chats':'all';upScreenView('history');}
  else if(hash==='outbox')upScreenView('outbox');
},true);


