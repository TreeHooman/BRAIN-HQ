// LUTHUR dashboard. Plain JS, no build step. Talks to the local LUTHUR server (/api/*).
"use strict";
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const MIC_SVG = `<svg class="i-mic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>`;
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
let S = null;            // latest /api/state snapshot
let route = { view: "command", arg: null };
const homeView = () => "command";
let calMonth = null;     // Date for the calendar view
let calFeed = { key: "", events: [], at: 0 }; // calendar-feed events for the shown month
let projTab = "summary";
let editing = null;      // "summary" | "plan" while editing a doc
let projCache = {};      // slug -> /api/project/:slug

// ---------------- api ----------------
async function api(path, method = "GET", body) {
  if (method === "POST" && body && (path === "/chat" || /^\/code\/[a-z0-9-]+$/.test(path)) && Date.now() - (window.hqVoiceAt || 0) < 6000) { body = { ...body, voice: true }; window.hqVoiceAt = 0; window.hqVoiceTurn = Date.now(); }
  if (method === "POST" && body && path === "/chat" && typeof cmdContext === "function") { try { body = { ...body, context: cmdContext() }; } catch {} }
  const res = await fetch("/api" + path, { method, headers: { "Content-Type": "application/json", "X-HQ": "1" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}
async function refresh() {
  try { S = await api("/state"); renderChrome(); return S; }
  catch (e) { $("#pills").innerHTML = `<span class="pill red">LUTHUR server not reachable</span>`; return null; }
}
function toast(msg, ms = 2600) {
  if (typeof hudNotify === "function" && document.documentElement.dataset.theme === "hud") return hudNotify(msg, ms > 2600 ? ms : undefined);
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms);
}
// Confirmation belongs beside the action, without blocking the whole browser.
function uiConfirm(message, anchor = document.activeElement) {
  uiConfirm.cancel?.();
  return new Promise(resolve => {
    const box=document.createElement('div');box.className='inline-confirm';box.setAttribute('role','alertdialog');box.setAttribute('aria-modal','false');
    const id='confirm-'+Date.now();box.innerHTML=`<p id="${id}"></p><div class="row"><button type="button" class="btn sm primary" data-confirm>Confirm</button><button type="button" class="btn sm" data-cancel>Cancel</button></div>`;
    box.querySelector('p').textContent=String(message);box.setAttribute('aria-labelledby',id);
    const region=anchor?.closest?.('.up-window-body,.up-window,.modal-box,.card,form,.nv-panel') || document.getElementById('view');
    const row=anchor?.closest?.('.row');
    if(row&&region?.contains(row))row.after(box);else if(region)region.append(box);else document.body.append(box);
    const wasDisabled=anchor?.disabled;if(anchor&&'disabled' in anchor)anchor.disabled=true;
    let settled=false;
    const observer=new MutationObserver(()=>{if(!box.isConnected)finish(false);});
    const finish=value=>{if(settled)return;settled=true;observer.disconnect();document.removeEventListener('keydown',key,true);box.remove();if(anchor?.isConnected){if('disabled' in anchor)anchor.disabled=wasDisabled;anchor.focus?.({preventScroll:true});}if(uiConfirm.cancel===cancel)uiConfirm.cancel=null;resolve(value);};
    const cancel=()=>finish(false),key=e=>{if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();cancel();}};
    uiConfirm.cancel=cancel;document.addEventListener('keydown',key,true);observer.observe(document.body,{childList:true,subtree:true});
    box.querySelector('[data-confirm]').onclick=()=>finish(true);box.querySelector('[data-cancel]').onclick=cancel;
    box.querySelector('[data-cancel]').focus({preventScroll:true});box.scrollIntoView({block:'nearest',behavior:'smooth'});
  });
}
async function act(fn, ok) {
  try { const r = await fn(); if (ok) toast(ok); await refresh(); render(); return r; }
  catch (e) { toast("⚠ " + e.message, 5000); }
}

// ---------------- helpers ----------------
const pad = n => String(n).padStart(2, "0");
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toDate = s => new Date(String(s).length <= 10 ? s + "T09:00" : s);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function fmtWhen(s) {
  const d = toDate(s), now = new Date();
  const t = String(s).length > 10 ? ` ${pad(d.getHours())}:${pad(d.getMinutes())}` : "";
  const days = Math.round((new Date(ymd(d)) - new Date(ymd(now))) / 864e5);
  if (days === 0) return "Today" + t;
  if (days === 1) return "Tomorrow" + t;
  if (days === -1) return "Yesterday" + t;
  if (days > 1 && days < 7) return DOW[d.getDay()] + t;
  return `${MON[d.getMonth()]} ${d.getDate()}${d.getFullYear() !== now.getFullYear() ? " " + d.getFullYear() : ""}${t}`;
}
function ago(iso) {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return "just now"; if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago"; return Math.floor(s / 86400) + "d ago";
}
const projName = slug => S?.projects.find(p => p.slug === slug)?.name || slug;
const STAGE_PILL = { idea: "violet", planned: "", building: "blue", live: "green", paused: "amber", done: "" };
const stagePill = s => `<span class="pill ${STAGE_PILL[s] || ""}">${esc(s)}</span>`;
const STATUS_PILL = { queued: "", running: "blue", done: "green", failed: "red", paused: "amber", skipped: "", timeout: "amber", cancelled: "" };
const projOptions = (sel, none = "No project") => `<option value="">${none}</option>` + S.projects.map(p => `<option value="${p.slug}" ${p.slug === sel ? "selected" : ""}>${esc(p.name)}</option>`).join("");
const opts = (list, sel) => list.map(v => Array.isArray(v) ? `<option value="${v[0]}" ${v[0] === sel ? "selected" : ""}>${esc(v[1])}</option>` : `<option ${v === sel ? "selected" : ""}>${v}</option>`).join("");

// Small markdown renderer (headings, lists, tables, code, bold/italic, links).
function md(src) {
  const lines = String(src || "").replace(/\r/g, "").split("\n");
  let html = "", list = null, para = [], inCode = false, code = [], table = [];
  const inline = s => esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|[\s(])_([^_]+)_(?=[\s).,:;!?]|$)/g, "$1<i>$2</i>")
    .replace(/(^|[\s(])\*([^*]+)\*(?=[\s).,:;!?]|$)/g, "$1<i>$2</i>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, u) => /^(https?:|\/|#|file:)/.test(u.replace(/&amp;/g, "&")) ? `<a href="${u}" target="_blank" rel="noopener">${t}</a>` : t)
    .replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  const flushPara = () => { if (para.length) { html += `<p>${para.map(inline).join("<br>")}</p>`; para = []; } };
  const flushList = () => { if (list) { html += `<${list.t}>${list.items.map(i => `<li>${inline(i)}</li>`).join("")}</${list.t}>`; list = null; } };
  const flushTable = () => {
    if (!table.length) return;
    const rows = table.filter(r => !/^\|?\s*:?-{2,}/.test(r)).map(r => r.replace(/^\||\|$/g, "").split("|").map(c => c.trim()));
    html += `<table><thead><tr>${rows[0].map(c => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows.slice(1).map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    table = [];
  };
  for (const raw of lines) {
    const l = raw;
    if (l.trim().startsWith("```")) { if (inCode) { html += `<pre><code>${esc(code.join("\n"))}</code></pre>`; code = []; inCode = false; } else { flushPara(); flushList(); flushTable(); inCode = true; } continue; }
    if (inCode) { code.push(l); continue; }
    if (/^\s*\|.*\|\s*$/.test(l)) { flushPara(); flushList(); table.push(l.trim()); continue; } else flushTable();
    let m;
    if ((m = l.match(/^(#{1,4})\s+(.*)/))) { flushPara(); flushList(); const n = Math.min(3, m[1].length); html += `<h${n}>${inline(m[2])}</h${n}>`; continue; }
    if ((m = l.match(/^\s*[-*]\s+(?:\[( |x)\]\s+)?(.*)/))) { flushPara(); if (!list || list.t !== "ul") { flushList(); list = { t: "ul", items: [] }; } list.items.push((m[1] === "x" ? "✓ " : m[1] === " " ? "☐ " : "") + m[2]); continue; }
    if ((m = l.match(/^\s*\d+[.)]\s+(.*)/))) { flushPara(); if (!list || list.t !== "ol") { flushList(); list = { t: "ol", items: [] }; } list.items.push(m[1]); continue; }
    if (/^>\s?/.test(l)) { flushPara(); flushList(); html += `<blockquote>${inline(l.replace(/^>\s?/, ""))}</blockquote>`; continue; }
    if (/^---+$/.test(l.trim())) { flushPara(); flushList(); html += "<hr>"; continue; }
    if (!l.trim()) { flushPara(); flushList(); continue; }
    if (list && /^\s{2,}\S/.test(l)) { list.items[list.items.length - 1] += " " + l.trim(); continue; }
    flushList(); para.push(l);
  }
  if (inCode) html += `<pre><code>${esc(code.join("\n"))}</code></pre>`;
  flushPara(); flushList(); flushTable();
  return `<div class="md">${html}</div>`;
}

// ---------------- chrome (nav counts, status pills) ----------------
function renderChrome() {
  if (!S) return;
  const st = S.status;
  const navA = $('#nav a[data-view="assistant"] span'); if (navA) navA.textContent = S.settings.assistantName;
  const ni = $("#nInbox"); if (ni) ni.textContent = S.inbox.length || "";
  $("#nApprovals").textContent = st.pendingApprovals || "";
  const nOb = $("#nOutbox"); if (nOb) nOb.textContent = (S.outbox || []).filter(x => x.status === "draft" || x.status === "failed").length || "";
  const pills = [];
  if (st.auth === "needs-login" || !st.claudeBin) pills.push(`<a class="pill red" href="#settings">Claude not signed in</a>`);
  if (st.pausedUntil && new Date(st.pausedUntil) > new Date()) pills.push(`<a class="pill amber" href="#missions">${st.backupActive ? "Codex backup active" : `Paused until ${fmtWhen(st.pausedUntil)}`}</a>`);
  if (st.running) pills.push(`<a class="pill blue" href="#tasks"><span class="dot pulse" style="background:var(--blue)"></span> ${(st.active || []).length > 1 ? `${st.active.length} agents working` : esc(st.running.title)}</a>`);
  if (st.chatBusy) pills.push(`<a class="pill blue" href="#assistant">Assistant thinking…</a>`);
  if (st.queued) pills.push(`<a class="pill" href="#missions">${st.queued} queued</a>`);
  if (st.pendingApprovals) pills.push(`<a class="pill amber" href="#missions">${st.pendingApprovals} need your OK</a>`);
  const over = S.reminders.filter(r => !r.done && toDate(r.due) < new Date()).length;
  if (over) pills.push(`<a class="pill red" href="#home" data-upopen='{"kind":"schedule"}'>${over} overdue</a>`);
  $("#pills").innerHTML = pills.join("");
  const authTxt = !st.claudeBin ? "CLI not found" : st.auth === "ok" ? "connected" : st.auth === "needs-login" ? "needs sign-in" : "not checked yet";
  $("#engine").innerHTML = `
    <div class="row"><span class="dot ${st.auth === "ok" ? "good" : st.auth === "needs-login" || !st.claudeBin ? "risk" : "unknown"}"></span>Claude: ${authTxt}</div>
    <div class="row"><span class="dot ${st.codexBin ? "good" : "unknown"}"></span>Codex: ${st.backupActive ? "handling new work" : st.codexBin ? "ready as backup" : "CLI not found"}</div>
    <div class="row"><span class="dot ${st.running ? "good pulse" : "unknown"}"></span>${st.running ? "Working" : "Idle"} · ${st.today}/${st.maxRunsPerDay} runs today</div>
    <div class="row faint">Budget: ${esc(st.budget)}${st.awake ? " · keeping PC awake" : ""}</div>`;
  if (typeof hudChrome === "function") hudChrome();
}

// ---------------- router ----------------
function parseHash() {
  const [view, ...rest] = (location.hash.slice(1) || homeView()).split("/");
  route = { view, arg: rest.length ? decodeURIComponent(rest.join("/")) : null };
}
function render() {
  if (!S) return;
  $$("#nav a").forEach(a => a.classList.toggle("on", a.dataset.view === (route.view === "project" ? "projects" : route.view)));
  const views = { command: vCommand, planner: vPlanner, home: vHome, projects: vProjects, project: vProject, calendar: vCalendar, roadmap: vRoadmap, inbox: vInbox, assistant: vAssistant, missions: vMissions, settings: vSettings, code: vCode, outbox: vOutbox, tasks: vTasks, canvas: vCanvas, workspace: vWorkspace, history: typeof vHistory === "function" ? vHistory : vCommand };
  if (route.view === "inbox") { location.replace("#assistant"); return; } // notes live in LUTHUR's mind dump now
  const fn = views[route.view] || vCommand;
  // Don't clobber a field the user is typing in during background refreshes.
  const active = document.activeElement;
  if (render.background && active && $("#view").contains(active) && /INPUT|TEXTAREA|SELECT/.test(active.tagName)) return;
  if (render.background && $("#calUrl")?.value) return; // keep a pasted calendar address
  const el = $("#view"), bg = !!render.background;
  el.dataset.view = route.view;
  Promise.resolve(fn(el)).then(() => { if (render.nav && !bg) { render.nav = false; scrollTopAll(); } if (typeof hudAfterRender === "function") hudAfterRender(el, bg); });
}
// A new page starts at the top. The body is the scroll box in the HUD layout, and the view renders async, so reset now and once it has drawn.
const scrollTopAll = () => { $("#view").scrollTop = 0; document.body.scrollTop = 0; document.documentElement.scrollTop = 0; window.scrollTo(0, 0); };
window.addEventListener("hashchange", () => { parseHash(); editing = null; render.nav = true; render(); scrollTopAll(); });

// ---------------- views ----------------
function reminderList(items, empty = "Nothing here.") {
  if (!items.length) return `<div class="empty">${empty}</div>`;
  const now = new Date(), today = ymd(now);
  return `<ul class="list">${items.map(r => {
    const d = toDate(r.due), cls = d < now ? "over" : ymd(d) === today ? "today" : "";
    return `<li><button class="check" title="Done" data-done="${r.id}"></button>
      <div class="grow"><div>${esc(r.title)}</div><div class="small faint">${r.project ? `<a href="#project/${r.project}">${esc(projName(r.project))}</a>` : ""}${r.repeat ? ` · repeats ${r.repeat}` : ""}</div></div>
      <span class="when ${cls}">${fmtWhen(r.due)}</span>
      <button class="icon-btn" title="Delete" data-delrem="${r.id}">✕</button></li>`;
  }).join("")}</ul>`;
}
function bindReminders(root) {
  $$("[data-done]", root).forEach(b => b.onclick = () => act(() => api(`/reminders/${b.dataset.done}`, "PATCH", { complete: true }), "Done ✓"));
  $$("[data-delrem]", root).forEach(b => b.onclick = async () => (await uiConfirm("Delete this reminder?")) && act(() => api(`/reminders/${b.dataset.delrem}`, "DELETE"), "Deleted"));
}
function projectCard(p) {
  return `<div class="card click proj h-${esc(p.health)}" data-open="${p.slug}" data-stage="${esc(p.stage)}" data-q="${esc((p.name + " " + p.summary + " " + (p.tags || []).join(" ") + " " + p.kind).toLowerCase())}" tabindex="0" role="link">
    <div class="meta"><span class="kind">${esc(p.kind)}</span>${stagePill(p.stage)}</div>
    <h3><span class="dot ${p.health}" title="health: ${p.health}"></span> ${esc(p.name)}</h3>
    <div class="sum">${esc(p.summary)}</div>
    <div class="next"><b>Next</b>${esc(p.nextStep || "—")}</div>
    <div class="meta"><span>Updated ${esc(p.updated)}</span><span>${esc(p.health)}</span></div></div>`;
}
function bindProjectCards(root) { $$("[data-open]", root).forEach(c => { c.onclick = () => { location.hash = "project/" + c.dataset.open; }; c.onkeydown = e => { if (e.key === "Enter") c.click(); }; }); }

function vHome(el) {
  const now = new Date(), weekEnd = new Date(now.getTime() + 7 * 864e5);
  const open = S.reminders.filter(r => !r.done);
  const urgent = open.filter(r => toDate(r.due) <= new Date(ymd(now) + "T23:59"));
  const week = open.filter(r => toDate(r.due) > new Date(ymd(now) + "T23:59") && toDate(r.due) <= weekEnd);
  const ms = S.milestones.filter(m => !m.done && toDate(m.date + "T23:59") >= now).slice(0, 6);
  const pend = S.approvals.filter(a => a.status === "pending");
  const st = S.status;
  const hour = now.getHours();
  const hello = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const active = S.projects.filter(p => !["paused", "done"].includes(p.stage));
  const needs = [];
  if (st.auth === "needs-login" || !st.claudeBin) needs.push(`<div class="card danger"><b>Claude isn't signed in for background work.</b><div class="small muted">Double-click <code>HQ\\scripts\\SIGN-IN-CLAUDE.cmd</code>, sign in once, then press <a href="#settings">Retry</a>. Until then reminders work, but missions and chat wait.</div></div>`);
  for (const a of pend) needs.push(`<div class="card alert"><div class="between"><b>Needs your OK: ${esc(a.title)}</b><span class="row"><button class="btn sm good" data-ap="${a.id}" data-yes="1">Approve</button><button class="btn sm" data-ap="${a.id}">Reject</button></span></div><div class="small muted" style="margin-top:6px">${esc(a.detail).slice(0, 400)}</div></div>`);
  el.innerHTML = `
    <div class="between"><div><h1>${hello}</h1><p class="sub">${DOW[now.getDay()]}, ${MON[now.getMonth()]} ${now.getDate()} · ${active.length} active projects · ${open.length} open reminders</p></div>
      <div class="row"><a class="btn primary" href="#assistant"><img src="icon.svg" class="eye-logo sm" alt=""> Talk to ${esc(S.settings.assistantName)}</a></div></div>
    ${needs.join("")}
    <div class="tiles">
      <a class="tile ${urgent.some(r => toDate(r.due) < now) ? "red" : "amber"}" href="#calendar"><b>${urgent.length}</b><span>Due today${urgent.some(r => toDate(r.due) < now) ? " (some overdue)" : ""}</span></a>
      <a class="tile blue" href="#calendar"><b>${week.length}</b><span>Later this week</span></a>
      <a class="tile ${S.inbox.length ? "amber" : ""}" href="#assistant"><b>${S.inbox.length}</b><span>Inbox to sort</span></a>
      <a class="tile ${pend.length ? "amber" : "green"}" href="#missions"><b>${pend.length}</b><span>Need your OK</span></a>
    </div>
    <div class="cols">
      <div>
        <h2>Today</h2>
        <div class="card">${reminderList(urgent, "Nothing due today.")}
          <form id="quickRem" class="row" style="margin-top:10px"><input class="grow" name="title" placeholder="Add a reminder…"><input type="datetime-local" name="due" value="${ymd(now)}T${pad(Math.min(23, now.getHours() + 1))}:00"><button class="btn">Add</button></form></div>
        <h2>Morning brief ${S.brief ? `<span class="faint">· ${esc(S.brief.date)}</span>` : ""}</h2>
        <div class="card">${S.brief ? md(S.brief.text) : `<div class="empty">No brief yet. It's written every day at 8:00 once Claude is signed in. <a href="#missions">Run it now</a></div>`}</div>
        <h2>Projects</h2>
        <div class="grid">${active.map(projectCard).join("")}</div>
      </div>
      <div>
        <h2>This week</h2>
        <div class="card">${reminderList(week, "Nothing else this week.")}</div>
        <h2>Coming up</h2>
        <div class="card"><ul class="list">${ms.map(m => `<li><span class="when">${fmtWhen(m.date)}</span><div class="grow">${esc(m.title)}<div class="small faint">${m.project ? esc(projName(m.project)) : ""}</div></div>${m.kind === "deadline" ? '<span class="pill red">deadline</span>' : ""}</li>`).join("") || `<div class="empty">No milestones.</div>`}</ul></div>
        <h2>Recent activity</h2>
        <div class="card tight">${activityList(S.activity.slice(0, 10))}</div>
      </div>
    </div>`;
  bindReminders(el); bindProjectCards(el); bindApprovals(el);
  $("#quickRem").onsubmit = e => { e.preventDefault(); const f = new FormData(e.target); if (!f.get("title")) return; act(() => api("/reminders", "POST", { title: f.get("title"), due: String(f.get("due")).replace("T", " "), project: activeProject() || undefined }), "Reminder added"); };
}
function activityList(items) {
  const label = { queued: "Queued", started: "Started", done: "Finished", failed: "Failed", timeout: "Hit time limit", paused: "Paused (usage limit)", resumed: "Resumed", skipped: "Skipped (nothing changed)", reminder: "Reminder fired", chat: "Assistant replied", "approval-requested": "Asked for approval", approved: "You approved", rejected: "You rejected", "needs-login": "Needs Claude sign-in", "mission-created": "Mission created", cancelled: "Cancelled", error: "Error" };
  if (!items.length) return `<div class="empty">Nothing yet.</div>`;
  return `<ul class="list">${items.map(a => `<li><span class="when">${ago(a.at)}</span><div class="grow small">${esc(label[a.event] || a.event)}${a.title ? `: ${esc(a.title)}` : ""}</div></li>`).join("")}</ul>`;
}
function bindApprovals(root) {
  $$("[data-ap]", root).forEach(b => b.onclick = () => act(() => api(`/approvals/${b.dataset.ap}`, "POST", { approve: !!b.dataset.yes }), b.dataset.yes ? "Approved: queued" : "Rejected"));
}

const projFilter = { q: "", stage: "" };
function vProjects(el) {
  const groups = [["Active", p => ["building", "live"].includes(p.stage)], ["Planned & ideas", p => ["planned", "idea"].includes(p.stage)], ["Paused & done", p => ["paused", "done"].includes(p.stage)]];
  el.innerHTML = `<div class="between"><div><h1>Projects</h1><p class="sub">${S.projects.length} projects. Each lives in <code>brain/projects/&lt;name&gt;/</code>.</p></div><button class="btn primary" id="newProj">+ New project</button></div>
    <div class="toolbar"><input id="projQ" type="search" placeholder="Filter projects…" aria-label="Filter projects" value="${esc(projFilter.q)}">
      <div class="chips">${[["", "All"], ["building", "Building"], ["live", "Live"], ["planned", "Planned"], ["idea", "Ideas"], ["paused", "Paused"]].map(([k, t]) => `<button type="button" class="chip ${projFilter.stage === k ? "on" : ""}" data-stage-f="${k}">${t}</button>`).join("")}</div></div>
    ${groups.map(([t, f]) => { const ps = S.projects.filter(f); return ps.length ? `<section class="pgroup"><h2>${t}</h2><div class="grid">${ps.map(projectCard).join("")}</div></section>` : ""; }).join("")}
    <div class="empty" id="projNone" hidden>No projects match.</div>`;
  bindProjectCards(el);
  const applyFilter = () => {
    const q = projFilter.q.trim().toLowerCase();
    $$(".proj", el).forEach(c => { c.hidden = !!((projFilter.stage && c.dataset.stage !== projFilter.stage) || (q && !c.dataset.q.includes(q))); });
    $$(".pgroup", el).forEach(g => { g.hidden = !$$(".proj", g).some(c => !c.hidden); });
    $("#projNone").hidden = $$(".proj", el).some(c => !c.hidden);
  };
  $("#projQ").oninput = e => { projFilter.q = e.target.value; applyFilter(); };
  $$("[data-stage-f]", el).forEach(b => b.onclick = () => { projFilter.stage = b.dataset.stageF; $$("[data-stage-f]", el).forEach(x => x.classList.toggle("on", x === b)); applyFilter(); });
  applyFilter();
  $("#newProj").onclick = newProjectModal;
}
function newProjectModal() {
  modal(`<h3>New project</h3><form class="form" id="np">
    <label class="f">Name<input name="name" required placeholder="e.g. Borrow Fast"></label>
    <div class="two"><label class="f">Kind<select name="kind">${opts(["business", "product", "workstream", "strategy", "research", "frontier", "tool"], "product")}</select></label>
    <label class="f">Stage<select name="stage">${opts(["idea", "planned", "building", "live", "paused"], "idea")}</select></label></div>
    <label class="f">One-line summary<input name="summary" placeholder="What is it?"></label>
    <div class="row end"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Create</button></div></form>`);
  $("#np").onsubmit = async e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); const p = await act(() => api("/projects", "POST", f), "Project created"); closeModal(); if (p?.slug) location.hash = "project/" + p.slug; };
}

async function vProject(el) {
  const slug = route.arg;
  let d = projCache[slug];
  if (!d || !render.background) { try { d = projCache[slug] = await api(`/project/${slug}`); } catch { el.innerHTML = `<h1>Not found</h1>`; return; } }
  const p = d.project;
  const tabs = [["summary", "Summary"], ["plan", "Plan"], ["log", "Log"], ["work", "Missions & dates"], ["setup", "Setup"]];
  const doc = part => editing === part
    ? `<textarea class="code" id="docText">${esc(d[part])}</textarea><div class="row end" style="margin-top:8px"><button class="btn ghost" id="docCancel">Cancel</button><button class="btn primary" id="docSave">Save</button></div>`
    : `<div class="row end"><button class="btn sm" id="docEdit">Edit</button></div>${md(d[part])}`;
  const rems = S.reminders.filter(r => r.project === slug && !r.done);
  const mss = S.milestones.filter(m => m.project === slug);
  const runs = S.runs.filter(r => r.project === slug).slice(0, 8);
  let body = "";
  if (projTab === "summary" || projTab === "plan") body = `<div class="card">${doc(projTab)}</div>`;
  else if (projTab === "log") body = `<div class="card"><form id="logForm" class="row"><input class="grow" name="text" placeholder="Add a log entry: what happened, what you learned…"><button class="btn">Add</button></form></div><div class="card" style="margin-top:12px">${md(d.log)}</div>`;
  else if (projTab === "work") body = `
    <div class="cols"><div>
      <h2 style="margin-top:0">Run a mission on this project</h2>
      <div class="card">${missionForm({ project: slug, tier: "balanced", permission: p.maxPermission === "plan" ? "plan" : "plan" }, true)}</div>
      <h2>Recent runs</h2><div class="card tight">${runs.length ? runs.map(runRow).join("") : `<div class="empty">No runs yet.</div>`}</div>
    </div><div>
      <h2 style="margin-top:0">Reminders</h2><div class="card">${reminderList(rems)}
        <form id="pRem" class="row" style="margin-top:10px"><input class="grow" name="title" placeholder="Reminder…"><input type="datetime-local" name="due" required><button class="btn">Add</button></form></div>
      <h2>Milestones</h2><div class="card"><ul class="list">${mss.map(m => `<li><span class="when">${esc(m.date)}</span><div class="grow ${m.done ? "faint" : ""}">${esc(m.title)}</div>${m.kind === "deadline" ? '<span class="pill red">deadline</span>' : ""}<button class="icon-btn" data-delms="${m.id}">✕</button></li>`).join("") || `<div class="empty">None.</div>`}</ul>
        <form id="pMs" class="row" style="margin-top:10px"><input class="grow" name="title" placeholder="Milestone…"><input type="date" name="date" required><select name="kind"><option>milestone</option><option>deadline</option></select><button class="btn">Add</button></form></div>
      <h2>Decisions</h2><div class="card">${d.decisions.length ? md(d.decisions.join("\n")) : `<div class="empty">None logged.</div>`}</div>
    </div></div>`;
  else if (projTab === "setup") body = `<div class="card"><form class="form" id="setupForm">
      <div class="three"><label class="f">Kind<select name="kind">${opts(["business", "product", "workstream", "strategy", "research", "frontier", "tool"], p.kind)}</select></label>
        <label class="f">Agent permission ceiling<select name="maxPermission">${opts([["read", "read: look only"], ["plan", "plan: update the brain"], ["build", "build: edit code in dev"]], p.maxPermission || "build")}</select></label>
        <label class="f">Sort order<input name="order" type="number" value="${p.order ?? ""}"></label></div>
      <label class="f">Folders on this PC (one per line). Missions get access to these.<textarea name="paths">${esc((p.paths || []).join("\n"))}</textarea></label>
      <div class="two"><label class="f">GitHub repos (owner/name, one per line)<textarea name="repos">${esc((p.repos || []).join("\n"))}</textarea></label>
        <label class="f">Links (label | url, one per line)<textarea name="links">${esc((p.links || []).map(l => `${l.label} | ${l.url}`).join("\n"))}</textarea></label></div>
      <div class="two"><label class="f">Tags (comma separated)<input name="tags" value="${esc((p.tags || []).join(", "))}"></label>
        <label class="f">Notes for agents<input name="notes" value="${esc(p.notes || "")}"></label></div>
      <div class="f"><div class="small muted" style="margin-bottom:6px">Colour (outlines everything from this project)</div><div class="swatches" id="swatches">${PC.map(c => `<button type="button" class="sw ${projColor(slug) === c ? "on" : ""}" data-color="${c}" style="--c:${c}" aria-label="Colour ${c}"></button>`).join("")}</div></div>
      <div><div class="f small muted" style="margin-bottom:6px">Roadmap phases</div><div id="phases">${(p.phases || []).map(phaseRow).join("")}</div><button type="button" class="btn sm" id="addPhase">+ Phase</button></div>
      <div class="row end"><button class="btn primary">Save setup</button></div></form></div>`;
  el.innerHTML = `
    <div class="small"><a href="#projects">← Projects</a></div>
    <div class="between" style="margin-top:6px"><div><span class="kind">${esc(p.kind)}</span><h1><span class="dot ${p.health}"></span> ${esc(p.name)}</h1></div>
      <div class="row"><a class="btn" href="#assistant" id="askAbout">✦ Ask about this</a></div></div>
    <div class="card proj-sum" style="margin-top:12px"><div class="ps-row"><span class="pill">${esc(p.stage)}</span><span class="pill ${p.health === "good" ? "green" : p.health === "watch" ? "amber" : p.health === "risk" ? "red" : ""}">${esc(p.health)}</span><span class="faint small grow">updated ${esc(p.updated)}</span><button class="btn sm ghost" type="button" id="headEdit">Edit</button></div>
      ${p.summary ? `<div class="ps-sum">${esc(p.summary)}</div>` : ""}${p.nextStep ? `<div class="ps-next"><b>Next</b>${esc(p.nextStep)}</div>` : ""}
      ${(p.links || []).length || (p.repos || []).length ? `<div class="small ps-links">${(p.links || []).map(l => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join(" · ")}${(p.repos || []).map(r => ` · <a href="https://github.com/${esc(r)}" target="_blank" rel="noopener">${esc(r)}</a>`).join("")}</div>` : ""}</div>
    <div class="card" style="margin-top:12px" id="headCard" hidden><form id="headForm" class="form">
      <div class="three"><label class="f">Stage<select name="stage">${opts(["idea", "planned", "building", "live", "paused", "done"], p.stage)}</select></label>
      <label class="f">Health<select name="health">${opts([["good", "good"], ["watch", "watch"], ["risk", "risk"], ["unknown", "unknown"]], p.health)}</select></label>
      <label class="f">Updated<input value="${esc(p.updated)}" disabled></label></div>
      <label class="f">One-line summary<input name="summary" value="${esc(p.summary)}"></label>
      <label class="f">Next step<input name="nextStep" value="${esc(p.nextStep)}"></label>
      <div class="between"><div class="small">${(p.links || []).map(l => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join(" · ")}${(p.repos || []).map(r => ` · <a href="https://github.com/${esc(r)}" target="_blank" rel="noopener">${esc(r)}</a>`).join("")}</div><button class="btn primary">Save</button></div>
    </form></div>
    <div class="tabs">${tabs.map(([k, t]) => `<button data-tab="${k}" class="${projTab === k ? "on" : ""}">${t}</button>`).join("")}</div>
    ${body}`;
  const reload = async msg => { delete projCache[slug]; if (msg) toast(msg); await refresh(); render(); };
  $$("[data-tab]", el).forEach(b => b.onclick = () => { projTab = b.dataset.tab; editing = null; render(); });
  $("#headEdit").onclick = () => { const c = $("#headCard"); c.hidden = !c.hidden; $("#headEdit").textContent = c.hidden ? "Edit" : "Done"; };
  $("#headForm").onsubmit = async e => { e.preventDefault(); await api(`/project/${slug}`, "PUT", Object.fromEntries(new FormData(e.target))).catch(x => toast(x.message)); reload("Saved"); };
  $("#askAbout").onclick = () => { sessionStorage.setItem("chatProject", slug); };
  const de = $("#docEdit"); if (de) de.onclick = () => { editing = projTab; render(); };
  const dc = $("#docCancel"); if (dc) dc.onclick = () => { editing = null; render(); };
  const ds = $("#docSave"); if (ds) ds.onclick = async () => { await api(`/project/${slug}/doc/${projTab}`, "PUT", { content: $("#docText").value }); editing = null; reload("Saved"); };
  const lf = $("#logForm"); if (lf) lf.onsubmit = async e => { e.preventDefault(); const t = new FormData(e.target).get("text"); if (!t) return; await api(`/project/${slug}/log`, "POST", { text: t }); reload("Logged"); };
  const pr = $("#pRem"); if (pr) pr.onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target); await api("/reminders", "POST", { title: f.get("title"), due: String(f.get("due")).replace("T", " "), project: slug }).catch(x => toast(x.message)); reload("Reminder added"); };
  const pm = $("#pMs"); if (pm) pm.onsubmit = async e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); await api("/milestones", "POST", { ...f, project: slug }).catch(x => toast(x.message)); reload("Milestone added"); };
  $$("[data-delms]", el).forEach(b => b.onclick = async () => { if (!(await uiConfirm("Delete milestone?"))) return; await api(`/milestones/${b.dataset.delms}`, "DELETE"); reload("Deleted"); });
  bindReminders(el); bindMissionForm(el); bindRuns(el);
  const sf = $("#setupForm");
  if (sf) {
    $$("[data-color]", el).forEach(b => b.onclick = async () => { await api(`/project/${slug}`, "PUT", { color: b.dataset.color }).catch(x => toast(x.message)); reload("Colour saved"); });
    $("#addPhase").onclick = () => $("#phases").insertAdjacentHTML("beforeend", phaseRow({ name: "", status: "planned" }));
    el.addEventListener("click", e => { if (e.target.matches("[data-rmphase]")) e.target.closest(".phase-row").remove(); });
    sf.onsubmit = async e => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(sf));
      const lines = s => String(s || "").split("\n").map(x => x.trim()).filter(Boolean);
      const patch = {
        kind: f.kind, maxPermission: f.maxPermission, order: f.order === "" ? undefined : Number(f.order), notes: f.notes,
        paths: lines(f.paths), repos: lines(f.repos), tags: String(f.tags || "").split(",").map(x => x.trim()).filter(Boolean),
        links: lines(f.links).map(l => { const [label, ...u] = l.split("|"); return { label: label.trim(), url: (u.join("|") || label).trim() }; }),
        phases: $$(".phase-row", sf).map(r => ({ name: $("[name=pn]", r).value.trim(), start: $("[name=ps]", r).value, end: $("[name=pe]", r).value, status: $("[name=pst]", r).value })).filter(x => x.name),
      };
      await api(`/project/${slug}`, "PUT", patch).catch(x => toast(x.message));
      reload("Setup saved");
    };
  }
}
const phaseRow = ph => `<div class="phase-row"><input name="pn" placeholder="Phase name" value="${esc(ph.name)}"><input type="date" name="ps" value="${esc(ph.start || "")}"><input type="date" name="pe" value="${esc(ph.end || "")}"><select name="pst">${opts(["planned", "active", "done"], ph.status || "planned")}</select><button type="button" class="icon-btn" data-rmphase>✕</button></div>`;

function vCalendar(el) {
  if (!calMonth) { const n = new Date(); calMonth = new Date(n.getFullYear(), n.getMonth(), 1); }
  const first = new Date(calMonth), start = new Date(first); start.setDate(1 - first.getDay());
  const today = ymd(new Date());
  const events = {};
  // the same event on several calendars (holidays on every account) shows once
  const add = (k, e) => { const l = events[k] = events[k] || []; if (!l.some(x => x.t === e.t && (x.time || "") === (e.time || ""))) l.push(e); };
  S.reminders.forEach(r => add(r.due.slice(0, 10), { t: r.title, cls: r.done ? "done" : "", time: r.due.slice(11, 16), rem: r }));
  S.milestones.forEach(m => add(m.date, { t: m.title, cls: `${m.kind || "milestone"} ${m.done ? "done" : ""}`, ms: m }));
  const feeds = S.calendar?.feeds || [], fcol = Object.fromEntries(feeds.map(f => [f.id, f.color || "teal"]));
  const fcls = id => /^#/.test(fcol[id] || "") ? "gcal c-acct" : `gcal c-${fcol[id]}`, fsty = id => /^#/.test(fcol[id] || "") ? fcol[id] : "";
  const key = ymd(start);
  if (feeds.length && (calFeed.key !== key || Date.now() - calFeed.at > 120e3)) {
    const end = new Date(start); end.setDate(start.getDate() + 42);
    calFeed = { key, events: calFeed.key === key ? calFeed.events : [], at: Date.now() };
    api(`/calendar?from=${key}&to=${ymd(end)}`).then(r => { if (calFeed.key !== key) return; calFeed.events = r.events || []; if (route.view === "calendar") render(); }).catch(() => {});
  }
  if (feeds.length) calFeed.events.forEach(e => {
    if (e.allDay) { for (let d = toDate(e.start); ymd(d) < e.end; d.setDate(d.getDate() + 1)) add(ymd(d), { t: e.title, cls: fcls(e.feed), c: fsty(e.feed), ev: e }); }
    else { const d = new Date(e.start); add(ymd(d), { t: e.title, cls: fcls(e.feed), c: fsty(e.feed), time: `${pad(d.getHours())}:${pad(d.getMinutes())}`, ev: e }); }
  });
  Object.values(events).forEach(l => l.sort((a, b) => (a.time || "").localeCompare(b.time || ""))); // all-day first, then by time
  calDays = events;
  let cells = "";
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const k = ymd(d), ev = events[k] || [];
    cells += `<div class="day ${d.getMonth() !== first.getMonth() ? "out" : ""} ${k === today ? "today" : ""}" data-day="${k}">
      <div class="num">${d.getDate()}</div>${ev.slice(0, ev.length > 4 ? 3 : 4).map(e => `<div class="ev ${e.cls}"${e.c ? ` style="--gc:${esc(e.c)}"` : ""} title="${esc(e.t + (e.ev?.location ? " @ " + e.ev.location : ""))}">${e.time ? e.time + " " : ""}${esc(e.t)}</div>`).join("")}${ev.length > 4 ? `<div class="small faint day-more">+${ev.length - 3} more</div>` : ""}</div>`;
  }
  const evWhen = e => e.allDay ? e.start : (d => `${ymd(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`)(new Date(e.start));
  const upcoming = [...S.reminders.filter(r => !r.done).map(r => ({ d: r.due, t: r.title, k: "reminder", p: r.project })), ...S.milestones.filter(m => !m.done).map(m => ({ d: m.date, t: m.title, k: m.kind, p: m.project })),
    ...(S.calendar?.upcoming || []).map(e => ({ d: evWhen(e), t: e.title, k: "event", p: null, loc: e.location }))]
    .filter(x => toDate(x.d.length <= 10 ? x.d + "T23:59" : x.d) >= new Date()).sort((a, b) => toDate(a.d.length <= 10 ? a.d + "T00:00" : a.d.replace(" ", "T")) - toDate(b.d.length <= 10 ? b.d + "T00:00" : b.d.replace(" ", "T"))).slice(0, 14);
  el.innerHTML = `<div class="between"><div><h1>${MON[first.getMonth()]} ${first.getFullYear()}</h1><p class="sub">Reminders (blue), milestones (violet), deadlines (red)${S.calendar?.feeds?.length ? ", calendar events (green)" : ` · <a href="#settings">connect your calendar</a>`}. Click a day to add a reminder.</p></div>
      <div class="row"><button class="btn" id="calPrev">←</button><button class="btn" id="calToday">Today</button><button class="btn" id="calNext">→</button></div></div>
    <div class="cal">${DOW.map(d => `<div class="dow">${d}</div>`).join("")}${cells}</div>
    <h2>Next up</h2><div class="card"><ul class="list">${upcoming.map(x => `<li><span class="when">${fmtWhen(x.d)}</span><div class="grow">${esc(x.t)}<div class="small faint">${x.p ? esc(projName(x.p)) : esc(x.loc || "")}</div></div><span class="pill ${x.k === "deadline" ? "red" : x.k === "milestone" ? "violet" : x.k === "event" ? "green" : "blue"}">${x.k}</span></li>`).join("") || `<div class="empty">Nothing coming up.</div>`}</ul></div>`;
  $("#calPrev").onclick = () => { calMonth.setMonth(calMonth.getMonth() - 1); render(); };
  $("#calNext").onclick = () => { calMonth.setMonth(calMonth.getMonth() + 1); render(); };
  $("#calToday").onclick = () => { calMonth = null; render(); };
  $$("[data-day]", el).forEach(c => c.onclick = () => dayModal(c.dataset.day));
}
let calDays = {};
/** A day's full list (time order) with done buttons for reminders, then the add form. */
function dayModal(day) {
  const items = calDays[day] || [], feeds = Object.fromEntries((S.calendar?.feeds || []).map(f => [f.id, f.name]));
  const src = e => e.rem ? (e.rem.project ? projName(e.rem.project) + " · reminder" : "reminder") : e.ms ? (e.ms.project ? projName(e.ms.project) + " · " : "") + (e.ms.kind || "milestone") : (feeds[e.ev?.feed] || "calendar") + (e.ev?.location ? " · " + e.ev.location : "");
  const list = items.length ? `<ul class="day-list">${items.map(e => `<li class="${e.cls}"${e.c ? ` style="--gc:${esc(e.c)}"` : ""}><span class="when">${e.time || "all day"}</span><div class="grow"><b>${esc(e.t)}</b><small>${esc(src(e))}</small></div>${e.rem && !e.rem.done ? `<button type="button" class="btn sm ghost" data-remdone="${esc(e.rem.id)}">Done</button>` : ""}${(e.rem && !e.rem.done) || (e.ms && !e.ms.done) || e.ev ? `<button type="button" class="btn sm ghost danger" data-daycancel="${items.indexOf(e)}">Cancel</button>` : ""}</li>`).join("")}</ul>` : `<div class="empty small">Nothing on this day yet.</div>`;
  addOnDayModal(day, `<h3>${(d => `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`)(new Date(day + "T12:00"))} <span class="faint small">${items.length || ""}</span></h3>${list}<div class="pd-sub" style="margin-top:12px">Add</div>`);
  $$("[data-remdone]").forEach(b => b.onclick = async () => { await act(() => api(`/reminders/${b.dataset.remdone}`, "PATCH", { complete: true }), "Done"); closeModal(); dayModal(day); });
  // Cancel (owner ask, 2026-10-08): reminders and milestones are removed from HQ; a Google Calendar event becomes a
  // "delete" draft in the Outbox, which only happens when the owner presses Send there (calendar changes always wait).
  $$("[data-daycancel]").forEach(b => b.onclick = async () => {
    const e = items[+b.dataset.daycancel]; if (!e) return;
    if (!(await uiConfirm(e.ev ? `Cancel "${e.t}" in your calendar? It waits in the Outbox until you press Send.` : `Cancel "${e.t}"?`, b))) return;
    if (e.rem) await act(() => api(`/reminders/${e.rem.id}`, "DELETE"), "Cancelled");
    else if (e.ms) await act(() => api(`/milestones/${e.ms.id}`, "DELETE"), "Cancelled");
    else {
      const d = new Date(e.ev.start), start = e.ev.allDay ? e.ev.start.slice(0, 10) : `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      try { await api("/outbox", "POST", { kind: "calendar", payload: { action: "delete", title: e.t, start } }); toast("Cancellation ready in the Outbox. Press Send there to remove it from your calendar.", 6000); }
      catch (er) { return toast("⚠ " + er.message, 6000); }
    }
    closeModal(); dayModal(day);
  });
}
function addOnDayModal(day, head) {
  modal(`${head || `<h3>Add on ${fmtWhen(day)}</h3>`}<form class="form" id="dayForm">
    <label class="f">What<input name="title" required ${head ? "" : "autofocus"}></label>
    <div class="three"><label class="f">Type<select name="type"><option value="reminder">Reminder (alerts you)</option><option value="milestone">Milestone</option><option value="deadline">Deadline</option></select></label>
    <label class="f">Time (reminders)<input type="time" name="time" value="09:00"></label>
    <label class="f">Repeat<select name="repeat"><option value="">No</option><option>daily</option><option>weekly</option><option>monthly</option></select></label></div>
    <label class="f">Project<select name="project">${projOptions(activeProject())}</select></label>
    <div class="row end"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Add</button></div></form>`);
  $("#dayForm").onsubmit = async e => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
    if (f.type === "reminder") await act(() => api("/reminders", "POST", { title: f.title, due: `${day} ${f.time || "09:00"}`, project: f.project, repeat: f.repeat || null }), "Reminder added");
    else await act(() => api("/milestones", "POST", { title: f.title, date: day, project: f.project, kind: f.type }), "Added");
    closeModal();
  };
}

function vRoadmap(el) {
  const now = new Date();
  const rows = S.projects.filter(p => (p.phases || []).length || S.milestones.some(m => m.project === p.slug));
  const dates = [now, ...rows.flatMap(p => (p.phases || []).flatMap(ph => [ph.start, ph.end].filter(Boolean).map(d => toDate(d)))), ...S.milestones.map(m => toDate(m.date))];
  let min = new Date(Math.min(...dates)), max = new Date(Math.max(...dates));
  min = new Date(Math.max(min, new Date(now.getFullYear(), now.getMonth() - 1, 1))); min = new Date(min.getFullYear(), min.getMonth(), 1);
  max = new Date(max.getFullYear(), max.getMonth() + 1, 1);
  const span = max - min || 1, x = d => Math.max(0, Math.min(100, (toDate(d) - min) / span * 100));
  const months = []; for (let d = new Date(min); d < max; d.setMonth(d.getMonth() + 1)) months.push(new Date(d));
  const unscheduled = S.projects.filter(p => !rows.includes(p));
  el.innerHTML = `<h1>Roadmap</h1><p class="sub">Phases from each project's Setup tab; ◆ milestones and deadlines. The amber line is today.</p>
    <div class="road"><div class="road-inner">
      <div class="road-head"><div class="road-label muted small">Project</div><div class="road-months">${months.map(m => `<span style="left:${x(ymd(m))}%">${MON[m.getMonth()]}${m.getMonth() === 0 ? " " + m.getFullYear() : ""}</span>`).join("")}</div></div>
      ${rows.map(p => `<div class="road-row"><div class="road-label"><a href="#project/${p.slug}">${esc(p.name)}</a><div class="small faint">${esc(p.stage)}</div></div>
        <div class="road-track"><div class="road-today" style="left:${x(ymd(now))}%"></div>
          ${(p.phases || []).filter(ph => ph.start && ph.end).map(ph => `<div class="road-bar ${ph.status || ""}" style="left:${x(ph.start)}%;width:${Math.max(1.2, x(ph.end) - x(ph.start))}%" title="${esc(ph.name)}: ${ph.start} → ${ph.end}">${esc(ph.name)}</div>`).join("")}
          ${S.milestones.filter(m => m.project === p.slug && toDate(m.date) >= min).map(m => `<div class="road-ms ${m.kind || ""} ${m.done ? "done" : ""}" style="left:${x(m.date)}%" title="${esc(m.date)}: ${esc(m.title)}"></div>`).join("")}
        </div></div>`).join("")}
    </div></div>
    ${unscheduled.length ? `<h2>Not on the timeline yet</h2><div class="card small muted">${unscheduled.map(p => `<a href="#project/${p.slug}">${esc(p.name)}</a>`).join(" · ")}. Add phases in each project's <b>Setup</b> tab, or ask the assistant to draft them.</div>` : ""}`;
}

function vInbox(el) {
  el.innerHTML = `<div class="between"><div><h1>Inbox</h1><p class="sub">Dump anything here: ideas, tasks, worries. The assistant files each note into the right project as a reminder, decision, log entry or mission.</p></div>
      <button class="btn primary" id="sortNow" ${S.inbox.length ? "" : "disabled"}>✦ Sort with assistant</button></div>
    <div class="card"><form id="inboxForm" class="form"><textarea name="text" placeholder="One thought per line works best. Ctrl+Enter to save."></textarea>
      <div class="row end"><select name="project">${projOptions("", "Let the assistant decide")}</select><button class="btn">Save to inbox</button></div></form></div>
    <h2>${S.inbox.length} unsorted</h2>
    <div class="card">${S.inbox.length ? `<ul class="list">${S.inbox.slice().reverse().map(i => `<li><span class="when">${esc(i.at.slice(5))}</span><div class="grow" style="white-space:pre-wrap">${esc(i.text)}${i.project ? `<div class="small faint">→ ${esc(projName(i.project))}</div>` : ""}</div><button class="icon-btn" data-delin="${i.id}">✕</button></li>`).join("")}</ul>` : `<div class="empty">Inbox zero.</div>`}</div>`;
  const form = $("#inboxForm");
  const save = async () => {
    const f = Object.fromEntries(new FormData(form)); if (!String(f.text).trim()) return;
    const parts = String(f.text).split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
    for (const t of parts) await api("/inbox", "POST", { text: t, project: f.project || undefined });
    toast(`Saved ${parts.length} note${parts.length > 1 ? "s" : ""}`); await refresh(); render();
  };
  form.onsubmit = e => { e.preventDefault(); save(); };
  $("textarea", form).onkeydown = e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); } };
  $("#sortNow").onclick = () => act(() => api("/inbox/sort", "POST"), "Sorting queued: watch Missions");
  $$("[data-delin]", el).forEach(b => b.onclick = () => act(() => api(`/inbox/${b.dataset.delin}`, "DELETE"), "Removed"));
}

// ---------------- voice (JARVIS mode) ----------------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const voiceOn = () => { try { return localStorage.getItem("hq-voice") === "1"; } catch { return false; } };
function speak(text) {
  if (!voiceOn() || !window.speechSynthesis) return;
  const plain = String(text).replace(/```[\s\S]*?```/g, " ").replace(/[#*_`>|]/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\n+/g, ". ").slice(0, 700);
  const u = new SpeechSynthesisUtterance(plain);
  const voices = speechSynthesis.getVoices();
  u.voice = voices.find(v => /en-GB/i.test(v.lang) && /(Ryan|George|Thomas|Male|Daniel)/i.test(v.name)) || voices.find(v => /en-GB/i.test(v.lang)) || voices.find(v => /^en/i.test(v.lang)) || null;
  u.rate = 1.05; u.pitch = 0.95; if(typeof configureVoice==="function")configureVoice(u);
  u.volume = Math.max(0, Math.min(1, Number(localStorage.getItem("hq-voice-volume") ?? 1)));
  speechSynthesis.cancel(); if(typeof speechPlaybackStart==='function')speechPlaybackStart(u);if(typeof ForceStop==='undefined'||!ForceStop.stopped)speechSynthesis.speak(u);
}
const VoiceReply = { last: "" };
function spokenReplyText(c) {
  const msg = c?.messages?.at(-1); if (msg?.role !== "hq") return "";
  const source = String(msg.speech || msg.text || "");
  const plain = source.replace(/```[\s\S]*?```/g, " ").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<[^>]+>/g, " ").replace(/[#*_`>|]/g, "").replace(/^\s*[-•]\s*/gm, "")
    .split(/\n\s*\n/).map(x => x.replace(/\s+/g, " ").trim()).find(Boolean) || "";
  if (msg.speech) return plain.split(/\s+/).slice(0, 35).join(" ").slice(0, 260);
  const sentences = plain.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
  let short = "";
  for (const sentence of sentences) {
    if (short && short.split(/\s+/).length >= 9) break;
    short += sentence.trim() + " ";
    if (short.split(/\s+/).length >= 32) break;
  }
  const words = (short.trim() || plain).split(/\s+/).slice(0, 35);
  const result = words.join(" ").slice(0, 260).trim();
  return result && !/[.!?]$/.test(result) ? result + "." : result;
}
function speakChatReply(c, force = false) {
  if (!force && !voiceOn()) return;
  const last = c?.messages?.at(-1), text = spokenReplyText(c); if (!text || !last) return;
  const key = `${c.id || "chat"}:${last.at || last.text}`;
  if (VoiceReply.last === key) return;
  VoiceReply.last = key;
  if (force && typeof speakAlways === "function") speakAlways(text);
  else speak(text);
}
let rec = null;
function listen(onText, onState) {
  if(typeof speechPlaybackBlocked==='function'&&speechPlaybackBlocked()){toast('Wait for Listening before speaking.');return;}
  if (!SR) { toast("Voice input needs Edge or Chrome"); return; }
  if (rec) { rec.finish(); return; }
  const pauseMs = 3200;
  const started = Date.now();
  let saved = "", sessionFinal = "", interim = "", lastHeard = 0, timer, startTimer, active, finished = false;
  const text = () => [saved, sessionFinal, interim].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  const finish = () => {
    if (finished) return;
    finished = true; clearTimeout(timer); clearTimeout(startTimer);
    const result = text();
    active.onend = null; try { active.stop(); } catch {}
    rec = null; onState(false);
    if (result) { window.hqVoiceAt = Date.now(); onText(result, true); }
  };
  const arm = () => { clearTimeout(timer); timer = setTimeout(finish, pauseMs); };
  const start = () => {
    if (finished) return;
    const r = new SR(); active = r; rec = { finish };
    r.lang = "en-US"; r.interimResults = true; r.continuous = true;
    r.onresult = e => {
      if(finished||active!==r||(typeof speechPlaybackBlocked==='function'&&speechPlaybackBlocked()))return;
      sessionFinal = ""; interim = "";
      for (const item of e.results) (item.isFinal ? sessionFinal += item[0].transcript + " " : interim += item[0].transcript + " ");
      if (text()) { lastHeard = Date.now(); onText(text(), false); arm(); }
    };
    r.onend = () => {
      if (finished || active !== r) return;
      saved = text(); sessionFinal = ""; interim = "";
      if ((lastHeard && Date.now() - lastHeard >= pauseMs) || (!lastHeard && Date.now() - started >= 12000)) finish();
      else start(); // Browsers can end recognition after a brief pause; keep the turn open.
    };
    r.onerror = e => { if (e.error === "not-allowed" || e.error === "service-not-allowed") { toast("Mic: " + e.error); finish(); } else if (e.error !== "no-speech" && e.error !== "aborted") toast("Mic: " + e.error); };
    try { r.start(); } catch { finish(); }
  };
  speechSynthesis?.cancel();
  start(); if (!finished) { onState(true); startTimer = setTimeout(() => { if (!lastHeard) finish(); }, 12000); }
}

let chatState = null;
async function vAssistant(el) {
  if (!render.background || !chatState) chatState = await api("/chat").catch(() => ({ messages: [] }));
  const c = chatState;
  const focus = activeProject();
  const examples = ["What should I focus on today?", "Plan the next 2 weeks for LoanCentral", "Remind me Friday at 3pm to call the bank", "Turn my inbox into tasks", "Every Monday 9am, review Borrow Fast and suggest next steps"];
  el.innerHTML = `<div class="chat">
    <div class="between"><div><h1><img src="icon.svg" class="eye-logo" alt="">${esc(S.settings.assistantName)}</h1><p class="sub" style="margin:0">Your chief of staff. Claude is primary; Codex handles new work when Claude is limited. Both use the same brain.</p></div>
      <div class="row"><select id="chatProj" title="Focus">${projOptions(focus, "All projects")}</select>
      <select id="personality" title="Personality"><option value="normal" ${c.personality !== "challenger" ? "selected" : ""}>LUTHUR</option><option value="challenger" ${c.personality === "challenger" ? "selected" : ""}>Challenger</option></select>
      <button class="btn ${voiceOn() ? "primary" : ""}" id="voiceToggle" title="Speak replies aloud">${voiceOn() ? "Voice on" : "Voice off"}</button>
      <button class="btn" id="newChat">New chat</button></div></div>
    <div class="chat-tier">${tierSwitch()} <span class="small muted">${c.provider === "codex" ? "Codex backup" : "Claude"}${c.personality === "challenger" ? " · Challenger" : ""}</span></div>
    <div id="chatClaudeUsage" class="chat-claude-usage" role="status">Claude · Context unavailable · Usage unavailable</div>
    <div class="chat-log" id="chatLog">
      ${c.messages.length ? c.messages.map(m => `<div class="msg ${m.role} ${m.error ? "err" : ""}">${m.role === "you" ? esc(m.text) : md(m.text)}<div class="t">${ago(m.at)}</div></div>`).join("")
        : `<div class="card" style="margin-top:20px"><b>Try:</b><div class="row" style="margin-top:8px">${examples.map(x => `<button class="btn sm" data-ex="${esc(x)}">${esc(x)}</button>`).join("")}</div></div>`}
      ${c.busy ? `<div class="typing"><span class="dot pulse" style="background:var(--blue)"></span> Thinking… (reading only what it needs)</div>` : ""}
    </div>
    <form class="chat-in" id="chatForm"><button type="button" class="btn mic" id="micBtn" title="Talk (Alt+J)" ${c.busy ? "disabled" : ""} aria-label="Talk">${MIC_SVG}</button><textarea id="chatText" placeholder="Message ${esc(S.settings.assistantName)}… (Enter to send, Shift+Enter for a new line)" ${c.busy ? "disabled" : ""}></textarea><button class="btn primary" ${c.busy ? "disabled" : ""}>Send</button></form>
  </div>`;
  const log = $("#chatLog"); log.scrollTop = log.scrollHeight;
  if (vAssistant.fresh) { vAssistant.fresh = false; const lastHq = $$(".msg.hq", log).pop(); if (lastHq) revealHTML(lastHq.querySelector(".md") || lastHq); }
  const send = async text => {
    if (!text.trim()) return;
    const project = $("#chatProj").value; sessionStorage.setItem("chatProject", project);
    const personality = $("#personality").value;
    chatState.personality = personality;
    chatState.messages.push({ role: "you", text, at: new Date().toISOString() }); chatState.busy = true; render.background = false; vAssistant(el);
    await api("/chat", "POST", { text, project: project || null, tier: currentTier(), personality }).catch(e => toast(e.message));
    opsKick();
    pollChat();
  };
  bindTierSwitch(el);
  $("#chatProj").onchange = e => setActiveProject(e.target.value, true);
  $("#chatForm").onsubmit = e => { e.preventDefault(); send($("#chatText").value); };
  $("#chatText").onkeydown = e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(e.target.value); } };
  $$("[data-ex]", el).forEach(b => b.onclick = () => send(b.dataset.ex));
  $("#newChat").onclick = async () => { await api("/chat/new", "POST"); chatState = null; render(); };
  $("#voiceToggle").onclick = () => { try { localStorage.setItem("hq-voice", voiceOn() ? "0" : "1"); } catch {} if (voiceOn()) speak(`Voice on. At your service.`); else speechSynthesis?.cancel(); render.background = false; vAssistant(el); };
  $("#micBtn").onclick = () => listen((t, done) => { $("#chatText").value = t; if (done) send(t); }, on => $("#micBtn")?.classList.toggle("live", on));
  if (sessionStorage.getItem("hq-listen") === "1") { sessionStorage.removeItem("hq-listen"); $("#micBtn").click(); }
  if (!c.busy) $("#chatText").focus({ preventScroll: true }); // focusing must not scroll the page past the header
  if (c.busy) pollChat();
  if (typeof usageRingPoll === "function") usageRingPoll();
}
let chatPoll = null;
function pollChat() {
  clearTimeout(chatPoll);
  chatPoll = setTimeout(async () => {
    const c = await api("/chat").catch(() => null);
    if (!c) return pollChat();
    const changed = !chatState || c.messages.length !== chatState.messages.length || c.busy !== chatState.busy;
    const last = c.messages[c.messages.length - 1];
    if (chatState && c.messages.length > chatState.messages.length && last?.role === "hq") { speakChatReply(c); vAssistant.fresh = true; }
    chatState = c;
    if (changed && route.view === "assistant") { render.background = false; vAssistant($("#view")); }
    if (c.busy) pollChat(); else refresh();
  }, 1500);
}

function missionForm(m = {}, compact = false) {
  const sch = m.schedule || null;
  return `<form class="form mform" data-id="${m.id || ""}">
    ${compact ? "" : `<label class="f">Title<input name="title" value="${esc(m.title || "")}" required placeholder="e.g. Research competitors for Borrow Fast"></label>`}
    ${compact ? `<label class="f">Title<input name="title" required placeholder="Short title"></label>` : ""}
    <label class="f">Instructions (be specific: what to do, what to produce)<textarea name="prompt" required>${esc(m.prompt || "")}</textarea></label>
    <div class="three">
      ${compact ? `<input type="hidden" name="project" value="${esc(m.project || "")}">` : `<label class="f">Project scope<select name="project">${projOptions(m.id || m.title ? (m.project || "") : activeProject(), "HQ-wide")}</select></label>`}
      <label class="f">Model<select name="tier" data-tierwarn>${opts(TIER_OPTS(), m.tier || "balanced")}</select></label>
      <label class="f">Permission<select name="permission">${opts([["read", "Read: look & report"], ["plan", "Plan: update brain"], ["build", "Build: edit code (dev)"]], m.permission || "plan")}</select></label>
      ${compact ? "" : `<label class="f">Schedule<select name="stype">${opts([["", "Manual only"], ["daily", "Daily"], ["weekly", "Weekly"], ["every", "Every N hours"], ["once", "Once"]], sch?.type || "")}</select></label>`}
    </div>
    ${compact ? "" : `<div class="three">
      <label class="f">Time (daily/weekly)<input type="time" name="time" value="${esc(sch?.time || "09:00")}"></label>
      <label class="f">Day (weekly)<select name="day">${DOW.map((d, i) => `<option value="${i}" ${sch?.day === i ? "selected" : ""}>${d}</option>`).join("")}</select></label>
      <label class="f">Hours (every) / date-time (once)<input name="extra" value="${esc(sch?.type === "every" ? sch.hours : sch?.type === "once" ? sch.at : "")}" placeholder="6  or  2026-10-12T09:00"></label></div>
      <div class="row"><label class="row small"><input type="checkbox" name="skipIfUnchanged" ${m.skipIfUnchanged ? "checked" : ""}> Skip when nothing in the brain changed (saves tokens)</label>
      <label class="row small"><input type="checkbox" name="enabled" ${m.enabled !== false ? "checked" : ""}> Enabled</label>
      <label class="f small" style="flex-direction:row;align-items:center">Max minutes <input name="maxMinutes" type="number" min="1" max="120" value="${m.maxMinutes || ""}" style="width:80px"></label></div>`}
    <div class="tier-warn" ${m.tier === "deep" ? "" : "hidden"}>${cap(tierModel("deep"))} uses your Pro usage limit much faster.</div>
    <div class="row end">${compact ? `<button class="btn primary" name="go" value="run">Run now</button>` : `<button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Save mission</button>`}</div>
  </form>`;
}
function bindMissionForm(root) {
  $$(".mform [data-tierwarn]", root).forEach(s => s.onchange = () => { const w = s.closest(".mform").querySelector(".tier-warn"); if (w) w.hidden = s.value !== "deep"; });
  $$(".mform", root).forEach(form => form.onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    if (form.querySelector("[name=go]")) {
      await act(() => api("/runs", "POST", { title: f.title, prompt: f.prompt, project: f.project || null, tier: f.tier, permission: f.permission }), "Mission queued");
      opsKick();
      return;
    }
    let schedule = null;
    if (f.stype === "daily") schedule = { type: "daily", time: f.time };
    if (f.stype === "weekly") schedule = { type: "weekly", day: Number(f.day), time: f.time };
    if (f.stype === "every") schedule = { type: "every", hours: Number(f.extra) || 6 };
    if (f.stype === "once") schedule = { type: "once", at: f.extra };
    const m = { id: form.dataset.id || undefined, title: f.title, prompt: f.prompt, project: f.project || null, tier: f.tier, permission: f.permission, schedule,
      enabled: !!f.enabled, skipIfUnchanged: !!f.skipIfUnchanged, maxMinutes: f.maxMinutes ? Number(f.maxMinutes) : undefined };
    await act(() => api("/missions", "POST", m), "Mission saved");
    closeModal();
  });
}
function runRow(r) {
  const dur = r.durationMs ? ` · ${Math.max(1, Math.round(r.durationMs / 60000))} min` : "";
  return `<details class="run"><summary><span class="pill ${STATUS_PILL[r.status] || ""}">${r.status}</span><b>${esc(r.title)}</b>
      <span class="small faint">${r.project ? esc(projName(r.project)) + " · " : ""}${esc(r.trigger)} · ${esc(r.model || r.tier)} · ${esc(r.level || r.permission)}${dur} · ${ago(r.createdAt)}</span>
      ${["queued", "running", "paused"].includes(r.status) ? `<button class="btn sm" data-cancel="${r.id}">Cancel</button>` : ""}</summary>
    <div class="out">${r.output ? md(r.output) : r.error ? `<div class="muted">${esc(r.error)}</div>` : `<div class="faint small">${r.status === "queued" ? "Waiting its turn." : r.status === "running" ? "Working…" : "No output."}</div>`}
      <details style="margin-top:8px"><summary class="small faint">Instructions</summary><div class="small muted" style="white-space:pre-wrap;margin-top:6px">${esc(r.prompt)}</div></details></div></details>`;
}
function bindRuns(root) { $$("[data-cancel]", root).forEach(b => b.onclick = e => { e.preventDefault(); act(() => api(`/runs/${b.dataset.cancel}/cancel`, "POST"), "Cancelled"); }); }

function vMissions(el) {
  const st = S.status;
  const paused = st.pausedUntil && new Date(st.pausedUntil) > new Date();
  const pend = S.approvals.filter(a => a.status === "pending");
  const tmpl = S.templates.filter(t => !S.missions.some(m => m.id === t.id));
  el.innerHTML = `<div class="between"><div><h1>Missions</h1><p class="sub">Background work Claude does without you. Each run is a fresh, scoped session that writes results back into the brain.</p></div>
      <button class="btn primary" id="newMission">+ New mission</button></div>
    <div class="grid">
      <div class="card"><div class="stat">${st.today}/${st.maxRunsPerDay}<small>runs today (${esc(st.budget)} budget)</small></div></div>
      <div class="card"><div class="stat ${st.running ? "blue" : ""}">${st.running ? "Working" : "Idle"}<small>${st.running ? esc(st.running.title) : `${st.queued} queued`}</small></div></div>
      <div class="card ${paused ? "alert" : ""}"><div class="stat">${paused ? "Paused" : "Ready"}<small>${paused ? `Usage limit · resumes ${fmtWhen(st.pausedUntil)} <button class="btn sm" id="unpause">Resume now</button>` : "Pauses and resumes itself at usage limits"}</small></div></div>
      <div class="card ${st.auth === "needs-login" ? "danger" : ""}"><div class="stat">${st.auth === "ok" ? "Connected" : st.auth === "needs-login" ? "Sign-in needed" : "Not checked"}<small>Claude CLI ${st.claudeBin ? "found" : "missing"}</small></div></div>
    </div>
    ${pend.length ? `<h2>Needs your OK</h2>${pend.map(a => `<div class="card alert" style="margin-bottom:10px"><div class="between"><b>${esc(a.title)}</b><span class="row"><button class="btn sm good" data-ap="${a.id}" data-yes="1">Approve</button><button class="btn sm bad" data-ap="${a.id}">Reject</button></span></div>
      <div class="small muted" style="white-space:pre-wrap;margin-top:6px">${esc(a.detail)}</div>
      ${a.proposed ? `<div class="small" style="margin-top:8px">If approved, runs at <b>${esc(a.proposed.permission || "build")}</b> level${a.proposed.extraAllow?.length ? ` with extra access: <code>${a.proposed.extraAllow.map(esc).join("</code> <code>")}</code>` : ""}.</div>` : a.brainOp ? `<div class="small" style="margin-top:8px">If approved, LUTHUR applies this brain change exactly as proposed (you can Undo it below).</div>` : `<div class="small faint" style="margin-top:8px">Approving just records your OK (nothing runs).</div>`}</div>`).join("")}` : ""}
    <div id="autonomyBox"></div>
    <h2>Scheduled & saved</h2>
    <div class="card tight"><ul class="list">${S.missions.map(m => `<li><div class="grow"><b>${esc(m.title)}</b> ${m.enabled ? "" : '<span class="pill">off</span>'}
        <div class="small faint">${esc(m.scheduleText)} · ${esc(m.tier)} · ${esc(m.permission)}${m.project ? " · " + esc(projName(m.project)) : ""}${m.skipIfUnchanged ? " · skips if unchanged" : ""}</div></div>
        <button class="btn sm" data-run="${m.id}">Run now</button><button class="btn sm ghost" data-edit="${m.id}">Edit</button><button class="icon-btn" data-del="${m.id}">✕</button></li>`).join("") || `<div class="empty">No missions yet.</div>`}</ul>
      ${tmpl.length ? `<div class="small muted" style="padding:8px 2px">Add from template: ${tmpl.map(t => `<button class="btn sm" data-tmpl="${t.id}">${esc(t.title)}</button>`).join(" ")}</div>` : ""}</div>
    <h2>Runs</h2>
    <div class="card tight">${S.runs.length ? S.runs.map(runRow).join("") : `<div class="empty">No runs yet.</div>`}</div>`;
  bindApprovals(el); bindRuns(el);
  if (typeof autonomyMount === "function") autonomyMount($("#autonomyBox", el));
  $("#newMission").onclick = () => { modal(`<h3>New mission</h3>${missionForm({})}`); bindMissionForm($("#modal")); };
  const up = $("#unpause"); if (up) up.onclick = () => act(() => api("/pause/clear", "POST"), "Resuming");
  $$("[data-run]", el).forEach(b => b.onclick = () => act(() => api(`/missions/${b.dataset.run}/run`, "POST"), "Queued"));
  $$("[data-del]", el).forEach(b => b.onclick = async () => (await uiConfirm("Delete this mission?")) && act(() => api(`/missions/${b.dataset.del}`, "DELETE"), "Deleted"));
  $$("[data-edit]", el).forEach(b => b.onclick = () => { const m = S.missions.find(x => x.id === b.dataset.edit); modal(`<h3>Edit mission</h3>${missionForm(m)}`); bindMissionForm($("#modal")); });
  $$("[data-tmpl]", el).forEach(b => b.onclick = () => { const t = S.templates.find(x => x.id === b.dataset.tmpl); modal(`<h3>${esc(t.title)}</h3>${missionForm({ ...t, id: undefined })}`); const f = $("#modal .mform"); f.dataset.id = t.id; bindMissionForm($("#modal")); });
}

function vSettings(el) {
  const s = S.settings, st = S.status;
  const tiers = Object.entries(s.models.tiers || {});
  el.innerHTML = `<h1>Settings</h1><p class="sub">Saved to <code>config/hq.local.json</code>. Deeper options live in <code>config/*.json</code> (models, permissions, MCP servers).</p>
    <div class="cols"><div>
      <h2>Claude connection</h2>
      <div class="card ${st.auth === "needs-login" || !st.claudeBin ? "danger" : ""}">
        <div class="row"><span class="dot ${st.auth === "ok" ? "good" : st.auth === "needs-login" ? "risk" : "unknown"}"></span><b>${st.auth === "ok" ? "Connected" : st.auth === "needs-login" ? "Needs sign-in" : "Not checked yet"}</b></div>
        <div class="small muted" style="margin-top:6px">CLI: <code>${esc(st.claudeBin || "not found")}</code></div>
        <ol class="small" style="margin:10px 0 0;padding-left:18px"><li>Double-click <code>HQ\\scripts\\SIGN-IN-CLAUDE.cmd</code>.</li><li>Sign in with your Claude account in the window that opens, then close it.</li><li>Press Retry. Missions and chat start right away.</li></ol>
        <div class="row end"><button class="btn primary" id="retry">Retry now</button></div></div>
      <h2>Autonomy & budget</h2>
      <div class="card form">
        <div class="three"><label class="f">Budget<select id="budget">${opts(s.budgets, s.budget)}</select></label>
          <label class="f">Permission ceiling<select id="autonomy">${opts([["read", "read"], ["plan", "plan"], ["build", "build (dev only)"]], s.autonomy)}</select></label>
          <label class="f">Default chat model<select id="chatTier">${opts(TIER_OPTS(), s.chatTier)}</select></label></div>
        <div class="small muted">${esc(s.budget)}: up to ${s.budgetNow.maxRunsPerDay} missions/day, ${s.budgetNow.maxMinutesPerRun} min each, ${s.budgetNow.maxFollowupsPerRun} follow-ups per run. Chat doesn't count.</div>
        <label class="row small"><input type="checkbox" id="taskApproval" ${s.taskApproval !== false ? "checked" : ""}> Ask me before LUTHUR starts a task on its own (unless I say “just do it”)</label>
        <label class="row small"><input type="checkbox" id="voiceFull" ${s.voiceFull !== false ? "checked" : ""}> When I talk by voice, LUTHUR gets full permission (Code sessions run without asking). Typing stays on confirmations.</label>
        <div class="small muted">Hard limits always apply: no pushing, deploying, posting publicly, sending email without the Outbox, or touching secrets.</div>
        <label class="f">Keep the PC awake<select id="keepAwake">${opts([["busy", "While missions are queued or running"], ["always", "Always while LUTHUR runs (multi-day autonomy)"], ["off", "Never"]], s.keepAwake)}</select></label>
        <div class="row end"><button class="btn primary" id="saveAuto">Save</button></div></div>
      <h2>Models</h2>
      <div class="card"><ul class="list">${tiers.map(([k, t]) => `<li><b style="min-width:90px">${esc(k)}</b><code>${esc(t.model)}</code><span class="small muted grow">${esc(t.use || "")}</span></li>`).join("")}</ul>
        <div class="small muted" style="margin-top:8px">Aliases always use the newest model in each family. Edit <code>config/models.json</code> to pin or swap models; every mission follows.</div></div>
      <h2>What LUTHUR remembers about you</h2>
      <div class="card form" id="prefCard"><span class="small muted">Loading preferences…</span></div>
    </div><div>
      <h2>Look &amp; feel</h2>
      <div class="card form">
        <div class="row"><span class="small muted" style="min-width:110px">Theme</span><div class="chips"><button type="button" class="chip ${document.documentElement.dataset.theme === "hud" ? "on" : ""}" data-theme-set="hud">HUD</button><button type="button" class="chip ${document.documentElement.dataset.theme === "calm" ? "on" : ""}" data-theme-set="calm">Calm</button></div></div>
        <div class="row"><span class="small muted" style="min-width:110px">Sidebar</span><div class="chips"><button type="button" class="chip ${hstore.get("hq-side", "hide") === "pin" ? "" : "on"}" data-side="hide">Hidden (☰ top left)</button><button type="button" class="chip ${hstore.get("hq-side", "hide") === "pin" ? "on" : ""}" data-side="pin">Always shown</button></div></div>
        <div class="row"><span class="small muted" style="min-width:110px">Sound effects</span><div class="chips"><button type="button" class="chip ${Snd.on() ? "on" : ""}" data-sound="1">On</button><button type="button" class="chip ${Snd.on() ? "" : "on"}" data-sound="0">Off</button></div></div>
        <div class="small muted">Animations follow your Windows “reduce motion” setting. Shortcuts: <kbd class="kbd">Ctrl K</kbd> search, <kbd class="kbd">Ctrl 1–9</kbd> switch project (<kbd class="kbd">Ctrl 0</kbd> all), <kbd class="kbd">Alt J</kbd> talk, <kbd class="kbd">/</kbd> capture.</div>
        <div class="row end"><button type="button" class="btn" id="replayBoot">Replay boot</button><button type="button" class="btn" id="powerDown">Power down</button></div></div>
      <h2>Calendar</h2>
      <div class="card form" id="calCard">
        ${(S.calendar?.feeds || []).map(f => `<div class="row"><span class="dot ${f.ok === false ? "risk" : f.ok ? "good" : "unknown"}" ${f.google ? `style="background:${esc(f.color)}"` : ""}></span><div class="grow"><b>${esc(f.name)}</b> <span class="small faint">${esc(f.host)}${f.google ? " · Google account" : ""}</span>
          <div class="small ${f.ok === false ? "" : "muted"}">${f.ok === false ? esc(f.error || "Sync failed") : f.lastSync ? `Synced ${esc(ago(f.lastSync))} · ${f.count} events` : "Syncing…"}</div></div>${f.google ? (f.needsReconnect ? `<button type="button" class="btn sm primary" data-greco="${esc(String(f.id).slice(2))}">Reconnect</button>` : `<a class="btn sm ghost" href="#workspace">Manage</a>`) : `<button type="button" class="btn sm ghost" data-calrm="${esc(f.id)}">Remove</button>`}</div>`).join("") || `<div class="small muted">No calendar connected.</div>`}
        <div class="two"><label class="f">Name<input id="calName" placeholder="Personal" maxlength="40" autocomplete="off"></label>
          <label class="f">Secret address (iCal)<input id="calUrl" type="text" class="masked" placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" autocomplete="new-password" data-lpignore="true" data-1p-ignore spellcheck="false"></label></div>
        <div class="note blue small"><b>Google Calendar:</b> calendar.google.com → Settings → click your calendar on the left → <b>Integrate calendar</b> → copy <b>Secret address in iCal format</b>. Outlook and iCloud .ics links work too.<br>Read-only. The address stays on this PC (<code>config/hq.local.json</code>) and is never shown again. If it leaks, press “Reset” next to it in Google and add the new one.</div>
        <div class="row end">${S.calendar?.feeds?.length ? `<button type="button" class="btn" id="calSync">Sync now</button>` : ""}<button type="button" class="btn primary" id="calAdd">Connect</button></div></div>
      <h2>Email &amp; calendar sending</h2>
      <div class="card form" id="connCard"></div>
      <h2>Notifications</h2>
      <div class="card form">
        <label class="row"><input type="checkbox" id="toastOn" ${s.toast ? "checked" : ""}> Windows pop-ups</label>
        <label class="row"><input type="checkbox" id="ntfyOn" ${s.ntfy.enabled ? "checked" : ""}> Phone push via ntfy</label>
        <label class="f">Phone detail<select id="ntfyDetail">${opts([["title", "Headline only (private)"], ["full", "Headline + details"]], s.ntfy.detail || "title")}</select></label>
        <div class="note blue small"><b>Phone setup (2 min):</b> install the free <b>ntfy</b> app (iPhone/Android) → tap <b>+</b> → subscribe to topic<br><code style="user-select:all">${esc(s.ntfy.topic)}</code><br>Keep it secret: anyone with the topic name can read your alerts. With "Headline only", details stay on this PC.</div>
        <div class="row end"><button class="btn" id="testNotify">Send test</button><button class="btn primary" id="saveNotify">Save</button></div></div>
      <h2>iPhone Clock alarms</h2>
      <div class="card small"><b>One-time iPhone setup</b><ol class="list">
        <li>In Shortcuts, create a shortcut named <code>LUTHUR Alarm</code>.</li>
        <li>Make it accept text input. Split the input at <code>|</code>: the first part is the local date/time, the second is the label.</li>
        <li>Add Clock’s <b>Create Alarm</b> action using that time and label. Test the shortcut on your iPhone before relying on it.</li>
      </ol><div class="note amber small">When you ask LUTHUR for an alarm within 24 hours, tap its immediate ntfy notification to run this shortcut. Until you tap, only a due reminder is saved; the Clock alarm is not set. iOS 26 cannot silently create it from a PC chat.</div></div>
      <h2>Start with Windows</h2>
      <div class="card"><div class="row"><span class="dot ${s.startup ? "good" : "unknown"}"></span>${s.startup ? "LUTHUR opens when you sign in to Windows." : "Not installed."}</div>
        <div class="small muted" style="margin-top:6px">Run <code>scripts\\INSTALL-STARTUP.cmd</code> to turn it on, or <code>scripts\\REMOVE-STARTUP.cmd</code> to turn it off.</div></div>
      <h2>Where things live</h2>
      <div class="card small"><ul class="list">
        <li><b style="min-width:90px">Brain</b><code>${esc(s.hqDir)}\\brain</code></li>
        <li><b style="min-width:90px">Rules</b><code>config\\agent-rules.md</code></li>
        <li><b style="min-width:90px">Permissions</b><code>config\\permissions.json</code></li>
        <li><b style="min-width:90px">Old HQ</b><a href="/legacy/loancentral-hq.html" target="_blank">LoanCentral HQ (archived page)</a></li></ul></div>
    </div></div>`;
  $$("[data-theme-set]", el).forEach(b => b.onclick = () => setTheme(b.dataset.themeSet));
  $$("[data-sound]", el).forEach(b => b.onclick = () => setSound(b.dataset.sound === "1"));
  $$("[data-side]", el).forEach(b => b.onclick = () => { sidePin(b.dataset.side === "pin"); render(); });
  $("#calAdd").onclick = async () => {
    const url = $("#calUrl").value.trim(); if (!url) return toast("Paste the secret address first");
    const b = $("#calAdd"); b.disabled = true; b.textContent = "Checking…";
    const r = await act(() => api("/calendar/feeds", "POST", { name: $("#calName").value, url }));
    if (r) { toast(`Calendar connected · ${r.count} events`); calFeed.key = ""; }
    else { b.disabled = false; b.textContent = "Connect"; }
  };
  if ($("#calSync")) $("#calSync").onclick = () => act(() => api("/calendar/sync", "POST").then(r => { calFeed.key = ""; return r; }), "Calendar synced");
  // Google calendars: Reconnect goes straight to Google's sign-in (adds the Calendar permission, keeps the rest)
  $$("[data-greco]", el).forEach(b => b.onclick = async () => { try { const { url } = await api("/google/login", "POST", { reconnect: b.dataset.greco }); location.href = url; } catch (e) { toast("⚠ " + e.message, 5000); } });
  $$("[data-calrm]", el).forEach(b => b.onclick = async () => { if ((await uiConfirm("Remove this calendar from LUTHUR?"))) act(() => api(`/calendar/feeds/${b.dataset.calrm}`, "DELETE"), "Calendar removed"); });
  connCardFill(false);
  prefCardFill();
  $("#replayBoot").onclick = () => hudBoot(false);
  $("#powerDown").onclick = () => hudShutdown();
  $("#retry").onclick = () => act(() => api("/claude/retry", "POST"), "Retrying: watch the status");
  $("#saveAuto").onclick = () => act(() => api("/settings", "POST", { budget: $("#budget").value, autonomy: $("#autonomy").value, keepAwake: $("#keepAwake").value, chatTier: $("#chatTier").value, taskApproval: $("#taskApproval").checked, voiceFull: $("#voiceFull").checked }), "Saved");
  $("#saveNotify").onclick = () => act(() => api("/settings", "POST", { toast: $("#toastOn").checked, ntfy: { enabled: $("#ntfyOn").checked, detail: $("#ntfyDetail").value } }), "Saved");
  $("#testNotify").onclick = async () => { const r = await api("/notify/test", "POST").catch(e => ({ error: e.message })); toast(r.error ? r.error : `Sent. Windows pop-up${r.phone ? " + phone" : " (phone not reached: check the ntfy setting)"}`, 4000); };
}

async function prefCardFill() {
  const root = $("#prefCard"); if (!root) return;
  const data = await api("/preferences").catch(e => ({ confirmed: [], suggestions: [], error: e.message }));
  if (!$("#prefCard")) return;
  root.innerHTML = `${data.error ? `<div class="small">${esc(data.error)}</div>` : ""}
    <div class="small muted">LUTHUR learns these as you talk. Learned ones work right away; Forget any that are wrong. Full chats stay in History.</div>
    <div class="small" style="margin-top:10px"><b>Confirmed</b></div>
    ${(data.confirmed || []).map(p => `<div class="row small" style="margin-top:6px"><span class="grow"><b>${esc(p.scope === "project" ? p.project : p.scope)}</b> · ${esc(p.text)}${p.id.startsWith("p-l-") ? ` <span class="faint">(learned)</span>` : ""}</span><button class="btn sm ghost" data-pref-remove="${esc(p.id)}">Forget</button></div>`).join("") || `<div class="small faint">No preferences saved yet.</div>`}
    <div class="small" style="margin-top:12px"><b>Suggestions</b></div>
    ${(data.suggestions || []).map(p => `<div class="row small" style="margin-top:6px"><span class="grow">${esc(p.text)} <span class="faint">(${esc(p.reason)})</span></span><button class="btn sm" data-pref-review="${esc(p.id)}" data-accept="1">Keep</button><button class="btn sm ghost" data-pref-review="${esc(p.id)}">Dismiss</button></div>`).join("") || `<div class="small faint">No suggestions waiting.</div>`}
    <div class="two" style="margin-top:12px"><label class="f">Scope<select id="prefScope"><option value="global">Everywhere</option><option value="challenger">Challenger</option><option value="project">Project</option></select></label><label class="f">Project<select id="prefProject">${projOptions("", "Choose project")}</select></label></div>
    <label class="f">Add a preference<input id="prefText" maxlength="220" placeholder="For example: lead with a short recommendation"></label>
    <div class="row end"><button class="btn primary" id="prefSave">Remember</button></div>`;
  $$('[data-pref-remove]', root).forEach(b => b.onclick = async () => { await api(`/preferences/${b.dataset.prefRemove}`, "DELETE").catch(e => toast(e.message)); prefCardFill(); });
  $$('[data-pref-review]', root).forEach(b => b.onclick = async () => { await api(`/preferences/${b.dataset.prefReview}/review`, "POST", { accept: b.dataset.accept === "1" }).catch(e => toast(e.message)); prefCardFill(); });
  $("#prefSave").onclick = async () => { const text = $("#prefText").value.trim(), scope = $("#prefScope").value, project = $("#prefProject").value; if (!text) return; await api("/preferences", "POST", { text, scope, project }).then(() => toast("Preference saved")).catch(e => toast(e.message)); prefCardFill(); };
}

// ---------------- modal ----------------
function modal(html) { $("#modalBody").innerHTML = html; $("#modal").hidden = false; const f = $("#modal input, #modal textarea"); if (f) f.focus(); }
function closeModal() { $("#modal").hidden = true; $("#modalBody").innerHTML = ""; }
$("#modal").addEventListener("click", e => { if (e.target.id === "modal" || e.target.matches("[data-close]")) closeModal(); });
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && !$("#modal").hidden) closeModal();
  if (e.altKey && (e.key === "j" || e.key === "J")) { e.preventDefault(); if (route.view === "assistant") $("#micBtn")?.click(); else if (route.view === "command") $("#cmdMic")?.click(); else { sessionStorage.setItem("hq-listen", "1"); location.hash = "assistant"; } }
  if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); (route.view === "command" ? $("#cmdText") : $("#captureText"))?.focus(); }
});

// ---------------- quick capture ----------------
$("#capture").onsubmit = async e => {
  e.preventDefault();
  const t = $("#captureText").value.trim(); if (!t) return;
  // goes straight to the LUTHUR chat (and opens it so the reply shows)
  if (chatState?.busy) return toast("LUTHUR is still answering. Try again in a moment.");
  try { await api("/chat", "POST", { text: t, project: activeProject() || null, tier: currentTier() }); } catch (x) { return toast(x.message); }
  $("#captureText").value = ""; $("#captureText").blur(); chatState = null; opsKick?.();
  if (route.view !== "assistant") location.hash = "assistant"; else render();
};

// ---------------- boot (after hud.js has loaded) ----------------
window.addEventListener("DOMContentLoaded", async () => {
  parseHash();
  await refresh();
  try { render(); } finally { requestAnimationFrame(() => document.documentElement.classList.add("hq-ready")); }
  setInterval(async () => { if (HUD.asleep) return; await refresh(); render.background = true; if (!["assistant", "project", "command", "planner", "code", "tasks", "canvas"].includes(route.view) || route.view === "project" && editing === null && projTab === "work") render(); render.background = false; }, 6000);
});

