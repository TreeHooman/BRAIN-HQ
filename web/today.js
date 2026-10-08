// Today: the schedule as a timeline (with free time), and a short list of realistic goals for the day. Ticking a goal
// updates its project and goal step and pulls in what's next; LUTHUR also ticks goals itself when a Claude Code session
// finishes the work. "Plan my day" asks LUTHUR (Haiku) for a few goals that fit the free time.
"use strict";
const TD = { sched: null, planning: false };
const tdHM = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const tdDur = m => m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? " " + (m % 60) + "m" : ""}` : `${m}m`;

async function tdLoad(el) {
  try { const r = await api("/today"); TD.sched = r.schedule; S.today = r.plan; TD.planning = r.planning; } catch {}
  TD.at = Date.now(); if (route.view === "home" && el.isConnected) tdPaint(el);
}

function tdTimeline() {
  const now = new Date(), d0 = new Date(ymd(now) + "T00:00"), d1 = new Date(d0.getTime() + 864e5), rows = [], allDay = [];
  for (const e of S.calendar?.upcoming || []) {
    if (e.allDay) { if (e.start.slice(0, 10) === ymd(now)) allDay.push({ t: e.title, k: "cal" }); continue; }
    const s = new Date(e.start), en = new Date(e.end || e.start); if (s >= d1 || en < d0) continue;
    if (rows.some(x => x.k === "cal" && +x.s === +s && x.t === e.title)) continue; // same event on two calendars
    rows.push({ s, en, t: e.title, sub: e.location || "calendar", k: "cal" });
  }
  for (const r of S.reminders.filter(r => !r.done)) { const s = toDate(r.due); if (s >= d0 && s < d1) rows.push({ s, t: r.title, sub: r.project ? projName(r.project) : "reminder", k: "rem", id: r.id }); }
  for (const m of S.milestones.filter(m => !m.done && m.date.slice(0, 10) === ymd(now))) allDay.push({ t: m.title, k: m.kind === "deadline" ? "dl" : "ms" });
  for (const g of TD.sched?.gaps || []) if (g.mins >= 30) rows.push({ s: new Date(g.s), en: new Date(g.e), t: `Free · ${tdDur(g.mins)}`, k: "free" });
  rows.sort((a, b) => a.s - b.s || (a.k === "free") - (b.k === "free"));
  const overdue = S.reminders.filter(r => !r.done && toDate(r.due) < d0);
  let nowPut = false; const out = [];
  for (const r of rows) {
    if (!nowPut && r.s > now) { out.push(`<li class="td-now"><span>${tdHM(now)}</span><i></i></li>`); nowPut = true; }
    const past = (r.en || r.s) < now && r.k !== "free";
    out.push(`<li class="td-ev k-${r.k} ${past ? (r.k === "rem" ? "late" : "past") : ""}"${r.k === "rem" ? ` data-tdopen="${esc(r.id)}" tabindex="0" title="Edit reminder"` : ""}><span class="td-t">${tdHM(r.s)}${r.en && r.k !== "rem" ? `<small>${tdHM(r.en)}</small>` : ""}</span><div><b>${esc(r.t)}</b>${r.sub ? `<small>${esc(r.sub)}</small>` : ""}</div>${r.k === "rem" ? `<button type="button" class="icon-btn" data-tdrem="${esc(r.id)}" title="Done" aria-label="Mark done">✓</button>` : ""}</li>`);
  }
  if (!nowPut) out.push(`<li class="td-now"><span>${tdHM(now)}</span><i></i></li>`);
  return `${overdue.length ? `<div class="td-over"><b>${overdue.length} overdue</b> ${overdue.slice(0, 3).map(r => `<button type="button" data-tdrem="${esc(r.id)}" title="Mark done">✓ ${esc(r.title)}</button>`).join("")}</div>` : ""}
    ${allDay.length ? `<div class="td-all">${allDay.map(a => `<span class="k-${a.k}">${esc(a.t)}</span>`).join("")}</div>` : ""}
    <ul class="td-line">${out.join("")}</ul>
    ${rows.some(r => r.k !== "free") ? "" : `<div class="empty small">Nothing scheduled today.</div>`}`;
}

function tdGoals() {
  const p = S.today || { items: [] }, items = p.items || [];
  const open = items.filter(i => !i.done), done = items.filter(i => i.done);
  const left = open.reduce((a, i) => a + (i.mins || 30), 0), free = TD.sched?.free ?? null;
  const tight = free !== null && left > free * .85;
  const badge = i => i.src === "next" ? `<span class="td-b next">next</span>` : i.src === "carried" ? `<span class="td-b">from yesterday</span>` : i.src === "luthur" || i.src === "plan" ? `<span class="td-b ai">LUTHUR</span>` : "";
  const row = i => `<li class="td-g ${i.done ? "done" : ""}"><button type="button" class="td-chk" data-tdg="${esc(i.id)}" aria-pressed="${!!i.done}" aria-label="${i.done ? "Undo" : "Done"}: ${esc(i.title)}"></button>
    <div class="grow"><b>${esc(i.title)}</b><small>${i.project ? `<a href="#project/${esc(i.project)}">${esc(projName(i.project))}</a> · ` : ""}${tdDur(i.mins || 30)}${i.done ? ` · done ${i.doneBy === "sync" ? "by Claude" : i.doneBy === "luthur" ? "by LUTHUR" : ""} ${esc(ago(i.doneAt))}` : i.why ? ` · ${esc(i.why)}` : ""}</small></div>
    ${i.done ? "" : badge(i)}<button type="button" class="icon-btn td-x" data-tdx="${esc(i.id)}" aria-label="Remove">×</button></li>`;
  const pct = items.length ? Math.round(done.length / items.length * 100) : 0;
  return `<div class="td-prog"><div class="td-bar"><i style="width:${pct}%"></i></div><span>${done.length} of ${items.length} done</span></div>
    ${p.note ? `<p class="td-note">${esc(p.note)}</p>` : ""}
    ${items.length ? "" : `<div class="empty">No goals yet. Press <b>Plan my day</b> and LUTHUR picks a few that fit your free time, or add your own.</div>`}
    <ul class="td-gl">${open.map(row).join("")}</ul>
    ${open.length ? `<div class="td-load ${tight ? "bad" : ""}">≈ ${tdDur(left)} of work${free !== null ? ` · ${tdDur(free)} free today${tight ? " · too much, drop or move something" : ""}` : ""}</div>` : items.length ? `<div class="td-load good">All done. Nice.</div>` : ""}
    <form class="td-add" id="tdAdd" autocomplete="off"><input name="t" placeholder="Add a goal for today…" aria-label="New goal"><select name="m" aria-label="Time">${[15, 30, 45, 60, 90, 120].map(m => `<option value="${m}" ${m === 30 ? "selected" : ""}>${tdDur(m)}</option>`).join("")}</select><button class="btn sm">Add</button></form>
    ${done.length ? `<details class="td-done"><summary>Done (${done.length})</summary><ul class="td-gl">${done.map(row).join("")}</ul></details>` : ""}`;
}

function tdSync() {
  const ev = (S.activity || []).filter(a => a.event === "brain-sync" || a.event === "today-done").slice(0, 6);
  if (!ev.length) return `<div class="empty small">When you finish work in Claude Code (here or in your project folders), LUTHUR updates the project and ticks today's goals. It shows here.</div>`;
  const what = c => (c || []).map(x => ({ log: "logged", nextStep: "next step", stage: "stage", health: "health", step: "goal step", milestone: "milestone", note: "plan note", today: "today's goal" }[x] || x)).filter((x, i, a) => a.indexOf(x) === i).join(", ");
  return `<ul class="td-sync">${ev.map(a => `<li><span class="when">${esc(ago(a.at))}</span><div>${a.event === "brain-sync" ? `Updated <b>${esc(projName(a.project))}</b> from ${String(a.session || "").startsWith("ext-") ? "your Claude Code session" : "a Code session"}<small>${esc(what(a.changed))}</small>` : `Goal done: <b>${esc(a.title || "")}</b><small>${a.by === "sync" ? "ticked by Claude from your session" : a.by === "luthur" ? "ticked by LUTHUR" : "by you"}</small>`}</div></li>`).join("")}</ul>`;
}

// Evening debrief (src/lib/debrief.ts): tonight's (or, until noon, last night's) report; "So far today" previews it.
function tdDebrief() {
  const d = S.debrief, now = new Date(), fresh = d && (d.date === ymd(now) || (d.date === ymd(new Date(now - 864e5)) && now.getHours() < 12));
  const body = TD.debriefNow != null ? `<div class="md">${md(TD.debriefNow)}</div>` : fresh ? `<div class="md">${md(d.text.replace(/^# .*\n/, ""))}</div>`
    : `<div class="empty small">Arrives at 21:00: what LUTHUR did today, what waits for you, and what's due tomorrow.</div>`;
  const stamp = TD.debriefNow != null ? "so far today" : fresh ? d.date : "";
  return `<section class="card nv-panel td-debrief" style="grid-column:1/-1"><div class="panel-title between"><span>Evening debrief ${stamp ? `<small>${esc(stamp)}</small>` : ""}</span><button type="button" class="btn sm ghost" data-tddeb>${TD.debriefNow != null ? "Hide" : "So far today"}</button></div>${body}</section>`;
}

function tdPaint(el) {
  const now = new Date(), h = now.getHours(), hello = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  const st = S.status, pend = S.approvals.filter(a => a.status === "pending");
  const alerts = [];
  if (st.auth === "needs-login" || !st.claudeBin) alerts.push(`<div class="card danger small"><b>Claude isn't signed in.</b> Run <code>scripts\\SIGN-IN-CLAUDE.cmd</code> on the HQ PC.</div>`);
  if (pend.length) alerts.push(`<a class="td-alert" href="#missions"><b>${pend.length}</b> waiting for your OK: ${esc(pend[0].title)}${pend.length > 1 ? ` +${pend.length - 1}` : ""} →</a>`);
  el.innerHTML = `<div class="td">
    <div class="between td-head"><div><h1>${hello}</h1><p class="sub">${DOW[now.getDay()]}, ${MON[now.getMonth()]} ${now.getDate()}${TD.sched ? ` · ${tdDur(TD.sched.free)} free in your workday` : ""}</p></div>
      <div class="row"><button type="button" class="btn primary" id="tdPlan" ${TD.planning ? "disabled" : ""}>${TD.planning ? "Planning…" : "✦ Plan my day"}</button></div></div>
    ${alerts.join("")}
    <div class="td-cols">
      <section class="card nv-panel td-sched"><div class="panel-title between">Schedule <button type="button" class="btn sm ghost" data-tdsched>Open ↗</button></div>${tdTimeline()}
        <form id="quickRem" class="td-add" autocomplete="off"><input name="title" placeholder="Add a reminder…" aria-label="Reminder"><input type="time" name="at" value="${pad(Math.min(23, h + 1))}:00" aria-label="Time"><button class="btn sm">Add</button></form></section>
      <section class="card nv-panel td-goals"><div class="panel-title">Today's goals</div>${tdGoals()}</section>
    </div>
    <div class="td-cols two">
      <section class="card nv-panel"><div class="panel-title">Kept in sync</div>${tdSync()}</section>
      <section class="card nv-panel"><div class="panel-title">Morning brief ${S.brief ? `<small>${esc(S.brief.date)}</small>` : ""}</div>${S.brief ? `<details class="td-brief"><summary>${esc(String(S.brief.text).replace(/[#*_>`]/g, "").trim().split("\n").find(Boolean)?.slice(0, 120) || "Read")}</summary><div class="md">${md(S.brief.text)}</div></details>` : `<div class="empty small">Written every day at 8:00.</div>`}</section>
      ${tdDebrief()}
    </div></div>`;

  el.querySelector("#tdPlan").onclick = async e => {
    const b = e.currentTarget; b.disabled = true; b.textContent = "Planning…"; TD.planning = true;
    try { const r = await api("/today/plan", "POST", {}); S.today = r.plan; TD.sched = r.schedule; toast("Day planned"); } catch (er) { toast("⚠ " + er.message, 6000); }
    TD.planning = false; if (el.isConnected) tdPaint(el);
  };
  el.querySelectorAll("[data-tdg]").forEach(b => b.onclick = async () => {
    const it = (S.today?.items || []).find(i => i.id === b.dataset.tdg); if (!it) return;
    b.classList.add("busy");
    try { const r = await api(`/today/items/${it.id}`, "PATCH", { done: !it.done }); if (!it.done) { Snd?.blip?.(1320, .05); const c = r.changed || []; toast(c.includes("next added") ? "Done. Next one added." : c.length ? `Done · ${c.join(", ")}` : "Done"); } await refresh(); } catch (er) { toast("⚠ " + er.message); }
    TD.at = 0; tdLoad(el);
  });
  el.querySelectorAll("[data-tdx]").forEach(b => b.onclick = async () => { try { S.today = await api(`/today/items/${b.dataset.tdx}`, "DELETE"); } catch {} tdPaint(el); });
  const sched = el.querySelector(".td-sched");
  sched.onclick = e => {
    if (typeof upOpen !== "function" || e.target.closest("form, [data-tdrem], [data-upopen]")) return;
    const row = e.target.closest("[data-tdopen]");
    upOpen(row ? { kind: "reminder", id: row.dataset.tdopen } : { kind: "schedule" });
  };
  el.querySelector("[data-tddeb]").onclick = async () => {
    if (TD.debriefNow != null) TD.debriefNow = null;
    else try { TD.debriefNow = (await api("/debrief")).now.text.replace(/^# .*\n/, ""); } catch (er) { return toast("⚠ " + er.message); }
    tdPaint(el);
  };
  sched.onkeydown = e => { if (e.key === "Enter" && e.target.matches("[data-tdopen]")) e.target.click(); };
  el.querySelectorAll("[data-tdrem]").forEach(b => b.onclick = () => act(() => api(`/reminders/${b.dataset.tdrem}`, "PATCH", { complete: true }), "Done"));
  el.querySelector("#tdAdd").onsubmit = async e => {
    e.preventDefault(); const f = new FormData(e.target), t = String(f.get("t") || "").trim(); if (!t) return;
    const p = typeof activeProject === "function" ? activeProject() || null : null;
    try { await api("/today/items", "POST", { title: t, mins: Number(f.get("m")), project: p }); } catch (er) { return toast("⚠ " + er.message); }
    tdLoad(el);
  };
  el.querySelector("#quickRem").onsubmit = e => {
    e.preventDefault(); const f = new FormData(e.target); if (!f.get("title")) return;
    act(() => api("/reminders", "POST", { title: f.get("title"), due: `${ymd(new Date())} ${f.get("at") || "17:00"}` }), "Reminder added");
  };
}

vHome = function (el) { tdPaint(el); if (Date.now() - (TD.at || 0) > 60e3) { TD.at = Date.now(); tdLoad(el); } };
