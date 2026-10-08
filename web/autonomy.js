// Autonomy panel on Missions & approvals: brain changes with Undo, the owner's fast-approve rules, and
// LUTHUR's suggestions. Server: src/lib/brain-audit.ts + src/lib/autonomy.ts. Rendered by vMissions (app.js).
"use strict";
const AUTO = { data: null, changes: [], init: null, at: 0, loading: null };
const autonomyStale = () => Date.now() - AUTO.at > 15000;

/** One request at a time; resolves true when it fetched (so the caller re-renders once). */
function autonomyLoad(force) {
  if (AUTO.loading) return AUTO.loading.then(() => false);
  if (!force && !autonomyStale()) return Promise.resolve(false);
  AUTO.loading = Promise.all([api("/autonomy"), api("/brain-changes?limit=30"), api("/initiative").catch(() => null)])
    .then(([d, c, i]) => { AUTO.data = d; AUTO.changes = c.changes || []; AUTO.init = i; AUTO.error = null; })
    .catch(e => { AUTO.error = e.message; })
    .then(() => { AUTO.at = Date.now(); AUTO.loading = null; return true; }); // errors wait 15 s too
  return AUTO.loading;
}

function autonomyRuleRow(r) {
  const state = r.state === "off" ? `<span class="pill">off</span>${r.offReason ? ` <span class="small faint">${esc(r.offReason)}</span>` : ""}`
    : r.state === "live" ? `<span class="pill green">live</span>`
    : `<span class="pill amber">trial until ${esc(fmtWhen(r.trialUntil))}</span>${r.trialFailed ? ` <span class="small faint">stays on trial: ${esc(r.trialFailed)}</span>` : ""}`;
  const scope = [r.project ? projName(r.project) : "any project", `up to ${r.maxPermission}`, r.engine ? `${r.engine} only` : "", r.titleMatch ? `title has “${r.titleMatch}”` : ""].filter(Boolean).map(esc).join(" · ");
  return `<li><div class="grow"><b>${esc(r.title)}</b> ${state}<div class="small faint">${scope} · matched ${r.matches || 0}×${r.source === "suggested" ? " · from a LUTHUR suggestion" : ""}</div></div>
    ${r.state === "off" ? `<button class="btn sm" data-arule="${r.id}" data-astate="trial">Turn on (trial)</button>` : `<button class="btn sm" data-arule="${r.id}" data-astate="off">Turn off</button>`}
    ${r.state === "trial" ? `<button class="btn sm" data-arule="${r.id}" data-astate="live">Go live now</button>` : ""}
    <button class="icon-btn" data-adel="${r.id}" title="Delete rule">✕</button></li>`;
}

function autonomyChangeRow(c) {
  const files = c.files.map(f => f.file.replace(/^brain\//, "")).join(", ");
  return `<li><div class="grow"><b>${esc(c.summary)}</b>${c.undone ? ' <span class="pill">undone</span>' : ""}
    <div class="small faint">${esc(fmtWhen(c.at))} · ${esc(c.actor)}${c.approvedBy ? " · you approved" : ""} · ${esc(files)}</div></div>
    ${c.undone ? "" : `<button class="btn sm" data-aundo="${c.id}">Undo</button>`}</li>`;
}

// The initiative loop (src/lib/initiative.ts): LUTHUR picks small jobs from the brain every few hours.
function initiativeHtml() {
  const i = AUTO.init; if (!i) return "";
  const c = i.settings, on = c.enabled;
  const opt = (v, cur, label) => `<option value="${v}" ${+cur === v ? "selected" : ""}>${label}</option>`;
  const outcome = { started: '<span class="pill green">started</span>', asked: '<span class="pill amber">asked you</span>', rejected: '<span class="pill">you said no</span>' };
  return `<h2>LUTHUR's initiative</h2>
    <p class="small muted">Every few hours LUTHUR reads each project's deadlines, reminders, goal steps and next step (no AI cost to look) and picks up to ${c.maxPerScan} small jobs, one per project. Your rules decide which start on their own; the rest wait here for your OK. It never builds on HQ itself, and code work only happens on projects ticked for build rules below.</p>
    <div class="card tight"><div class="between" style="padding:8px 2px;flex-wrap:wrap;gap:8px">
      <div class="grow"><b>${on ? "On" : "Off"}</b> <span class="small faint">· ${i.lastScan ? "last looked " + esc(fmtWhen(i.lastScan)) : "hasn't looked yet"}${on && i.nextScan ? " · next " + esc(fmtWhen(i.nextScan)) : ""} · ${i.today}/${c.maxPerDay} today · ${c.fromHour}:00–${c.toHour}:00</span></div>
      <span class="row" style="gap:6px"><select data-iset="everyHours" title="How often">${[2, 4, 6, 12, 24].map(h => opt(h, c.everyHours, "every " + h + " h")).join("")}</select>
        <select data-iset="maxPerDay" title="Most jobs per day">${[2, 4, 6, 10].map(n => opt(n, c.maxPerDay, n + " a day")).join("")}</select>
        <button class="btn sm" data-ilook>Look now</button>
        <button class="btn sm ${on ? "" : "primary"}" data-ion="${on ? "" : "1"}">${on ? "Turn off" : "Turn on"}</button></span></div>
      <ul class="list">${(i.recent || []).slice(0, 6).map(e => `<li><div class="grow">${esc(e.title.replace(/^Initiative · /, ""))} ${outcome[e.outcome] || ""}<div class="small faint">${esc(fmtWhen(e.at))} · why: ${esc(e.why)}</div></div></li>`).join("") || '<div class="empty">Nothing picked yet.</div>'}</ul></div>`;
}

function autonomyHtml() {
  const d = AUTO.data;
  if (!d) return `<div class="card"><div class="small muted">${AUTO.error ? "⚠ " + esc(AUTO.error) : "Loading autonomy…"}</div></div>`;
  const projects = (S.projects || []);
  return `${initiativeHtml()}<h2>What LUTHUR may do on its own</h2>
    <p class="small muted">Rules let LUTHUR start matching tasks without asking. A new rule is on trial for ${d.trialDays} days: it only notes “would have started this”. Then it goes live, unless you rejected a task it matched. Undoing a rule-started task's brain change turns that rule off at once. Hard limits (push, deploy, public posts, live LoanCentral, secrets, money, sending) never change.</p>
    ${d.suggestions.length ? `<div class="card alert" style="margin-bottom:10px"><b>LUTHUR noticed</b>${d.suggestions.map(s => `<div class="between" style="margin-top:8px"><div class="grow"><div>${esc(s.title)}?</div><div class="small faint">You approved ${s.approvals} like this in 30 days, none rejected · e.g. ${esc(s.examples.join("; ")).slice(0, 200)}</div></div>
      <span class="row"><button class="btn sm good" data-asug="${esc(s.key)}" data-ayes="1">Allow (trial)</button><button class="btn sm" data-asug="${esc(s.key)}">Not now</button></span></div>`).join("")}</div>` : ""}
    <div class="card tight"><ul class="list">${d.rules.map(autonomyRuleRow).join("") || `<div class="empty">No rules yet. Every new task asks you first.</div>`}</ul>
      <form class="row" id="aRuleForm" style="padding:8px 2px;flex-wrap:wrap;gap:6px">
        <select name="project"><option value="">Any project</option>${projects.map(p => `<option value="${esc(p.slug)}">${esc(p.name)}</option>`).join("")}</select>
        <select name="maxPermission"><option value="read">read</option><option value="plan" selected>plan</option><option value="build">build</option></select>
        <input name="titleMatch" placeholder="title contains (optional)" style="max-width:190px">
        <button class="btn sm primary">+ Add rule</button></form>
      <div class="small faint" style="padding:0 2px 8px">Build-level rules only work for these projects:
        ${projects.map(p => `<label style="margin-right:8px"><input type="checkbox" data-abuild="${esc(p.slug)}" ${d.buildProjects.includes(p.slug) ? "checked" : ""}> ${esc(p.name)}</label>`).join("")}</div></div>
    <h2>Brain changes</h2>
    <p class="small muted">Everything LUTHUR changed in the brain. Undo puts the files back as they were (a file edited again since then is left alone).</p>
    <div class="card tight"><ul class="list">${AUTO.changes.map(autonomyChangeRow).join("") || `<div class="empty">No changes recorded yet.</div>`}</ul></div>`;
}

async function autonomyDo(fn, ok) {
  try { const r = await fn(); if (ok) toast(typeof ok === "function" ? ok(r) : ok); await autonomyLoad(true); await refresh(); render(); }
  catch (e) { toast("⚠ " + e.message, 5000); }
}

function autonomyMount(box) {
  if (!box) return;
  box.innerHTML = autonomyHtml();
  if (!AUTO.loading && autonomyStale()) autonomyLoad().then(fetched => { if (fetched && box.isConnected) autonomyMount(box); });
  $$("[data-aundo]", box).forEach(b => b.onclick = async () => (await uiConfirm("Undo this brain change?", b)) && autonomyDo(() => api(`/brain-changes/${b.dataset.aundo}/undo`, "POST"),
    r => r.conflicts?.length ? `Undid ${r.restored.length} file(s); ${r.conflicts.length} changed since, left alone` : `Undone${r.ruleTurnedOff ? " · that rule is now off" : ""}`));
  $$("[data-arule]", box).forEach(b => b.onclick = () => autonomyDo(() => api(`/autonomy/rules/${b.dataset.arule}`, "PATCH", { state: b.dataset.astate }), "Rule updated"));
  $$("[data-adel]", box).forEach(b => b.onclick = async () => (await uiConfirm("Delete this rule?", b)) && autonomyDo(() => api(`/autonomy/rules/${b.dataset.adel}`, "DELETE"), "Rule deleted"));
  $$("[data-asug]", box).forEach(b => b.onclick = () => autonomyDo(() => api("/autonomy/suggestion", "POST", { key: b.dataset.asug, accept: !!b.dataset.ayes }), b.dataset.ayes ? "Rule added on trial" : "OK, not now"));
  $$("[data-abuild]", box).forEach(c => c.onchange = () => autonomyDo(() => api("/autonomy/build-projects", "POST", { projects: $$("[data-abuild]", box).filter(x => x.checked).map(x => x.dataset.abuild) }), "Saved"));
  $$("[data-iset]", box).forEach(sel => sel.onchange = () => autonomyDo(() => api("/initiative/settings", "POST", { [sel.dataset.iset]: +sel.value }), "Saved"));
  $$("[data-ion]", box).forEach(b => b.onclick = () => autonomyDo(() => api("/initiative/settings", "POST", { enabled: !!b.dataset.ion }), b.dataset.ion ? "Initiative on" : "Initiative off"));
  $$("[data-ilook]", box).forEach(b => b.onclick = () => { b.disabled = true; autonomyDo(() => api("/initiative/scan", "POST"), r => r.picks.length ? `Picked ${r.picks.length}: ${r.started} started, ${r.asked} waiting for you` : "Nothing new to pick right now"); });
  const f = $("#aRuleForm", box);
  if (f) f.onsubmit = e => { e.preventDefault(); const v = Object.fromEntries(new FormData(f)); autonomyDo(() => api("/autonomy/rules", "POST", { project: v.project || null, maxPermission: v.maxPermission, titleMatch: v.titleMatch || null }), "Rule added on trial"); };
}
