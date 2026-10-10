// Command "Screen": tell LUTHUR to pull something up and it shows here. Say or type "pull up loancentral.net",
// "show me my calendar", "open emails from Sam", "pull up the budget sheet", "search ntfy setup", or a project name.
// "Brief me on this" / "look over this" turns what's on screen into a quest card (objective, intel, steps, risks, reward).
// Everything external is shown as escaped text (reader view); a live view is offered only when the site allows framing.
"use strict";
const Scr = { stack: [], cur: null, busy: false, quest: null };
const SCR_VERB = /^(?:(?:hey|ok|yo)\s+luth[ou]r[,!.]?\s+)?(?:can you\s+|please\s+)?(pull up|bring up|put up|show me|show|open|display|look up|search(?: for)?|google|find)\s+(.+)$/i;
const SCR_BRIEF = /^(?:(?:hey|ok|yo)\s+luth[ou]r[,!.]?\s+)?(?:can you\s+|please\s+)?(?:brief me(?: on)?|give me a briefing(?: on)?|look over|go over|review|break down|quest(?: me)?(?: on)?)\b\s*(.*)$/i;
const SCR_ACT = /^(?:update|set|change|mark|rename|move|add|log|note|check|do a check|status|what'?s (?:broken|wrong|stuck)|fix|delete|remove|finish|complete)\b/i;
// Google refuses sign-in inside a remote-controlled browser (by design; not something to work around). So Google links
// open through HQ's own connected views instead: Gmail → the mail list, Docs/Sheets/Drive → the file preview.
const SCR_GSIGN = /^(accounts\.google\.com|accounts\.youtube\.com)$/i;
async function scrGoogle(u) {
  let h = ""; try { h = new URL(/^https?:/i.test(u) ? u : "https://" + u).hostname.toLowerCase(); } catch { return null; }
  if (SCR_GSIGN.test(h)) return { k: "gblock", url: u };
  if (h === "mail.google.com" || h === "gmail.com") return { k: "mail", q: "" };
  if (!/^(docs|drive|sheets|slides)\.google\.com$/.test(h)) return null;
  const id = (String(u).match(/\/d\/([\w-]{20,})/) || String(u).match(/[?&]id=([\w-]{20,})/) || [])[1];
  if (id) { const g = await api("/google").catch(() => null);
    for (const a of g?.accounts || []) { if (!a.ok) continue; try { await api(`/google/preview/${a.id}/${id}`); return { k: "file", acct: a.id, id }; } catch {} } }
  return id ? { k: "gblock", url: u } : { k: "drive", q: "" };
}
const scrHost = u => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
const scrYT = u => { const m = String(u).match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/); return m ? m[1] : ""; };

/** Returns true when the text was a screen command (so it doesn't also go to chat). */
function scrCommand(text) {
  const t = String(text || "").trim();
  const b = t.match(SCR_BRIEF);
  if (b && (Scr.cur || b[1])) { const what = b[1].replace(/^(this|that|it|the screen|what'?s on (the )?screen)\.?$/i, "").trim(); scrBrief(what, t); return true; }
  const m = t.match(SCR_VERB); if (!m) return false;
  const verb = m[1].toLowerCase(), what = m[2].replace(/^(up|the|my|a)\s+/i, "").replace(/\s+(for me|please|on (the )?screen)\.?$/i, "").replace(/[.?!]+$/, "").trim();
  if (!what) return false;
  if (/^(search|look up|google|find)/.test(verb) && !/\.\w{2,}(\/|$)/.test(what) && !/^(email|mail|inbox|drive|file|doc|sheet)/i.test(what)) { scrGo({ k: "search", q: what }); return true; }
  scrGo(scrResolve(what)); return true;
}
function scrResolve(w) {
  const lw = w.toLowerCase();
  if (/^https?:\/\//i.test(w) || /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(w)) return scrYT(w) ? { k: "yt", id: scrYT(w), url: w } : { k: "page", url: w };
  if (/^(calendar|schedule|agenda|today|this week|week|my day|what'?s (on|coming up))/.test(lw)) return { k: "agenda", days: /week/.test(lw) ? 7 : /today|my day/.test(lw) ? 1 : 7 };
  const mail = lw.match(/^(?:emails?|mail|inbox|gmail)(?:\s+(?:from|about|with|re|on)\s+(.+))?$/); if (mail) return { k: "mail", q: mail[1] ? (/from/.test(lw) ? "from:" + mail[1] : mail[1]) : "" };
  const drv = lw.match(/^(?:(?:google\s+)?(?:drive|file|files|doc|docs|document|sheet|sheets|spreadsheet|slides|pdf)s?)\s*(?:called|named|for|about)?\s*(.*)$/); if (drv) return { k: "drive", q: drv[1] || "" };
  const p = S.projects.find(x => lw === x.name.toLowerCase() || lw === x.slug || lw.includes(x.name.toLowerCase()) || x.name.toLowerCase().includes(lw) && lw.length >= 4);
  if (p) return { k: "project", slug: p.slug };
  const sheetish = lw.match(/^(.+?)\s+(sheet|spreadsheet|doc|document|file|pdf|deck|slides)$/); if (sheetish) return { k: "drive", q: sheetish[1] };
  return { k: "search", q: w };
}
async function scrGo(v, push = true) {
  if (Scr.cur && push) Scr.stack.push(Scr.cur);
  if (v.k === "page" && !v.gok) { const g = await scrGoogle(v.url); if (g) v = g; }
  if (v.k === "page") v.reader = true; // reader view only: fast, and nothing from the site runs
  Scr.cur = v; Scr.quest = null; Scr.data = null; Scr.err = ""; scrPaint();
  try {
    if (v.k === "page" && !v.reader) { const u = /^https?:\/\//i.test(v.url) ? v.url : "https://" + v.url; Scr.data = await api("/browser/go", "POST", { url: u }); scrLiveStart(); }
    else if (v.k === "page") Scr.data = await api("/screen/read?url=" + encodeURIComponent(v.url));
    else if (v.k === "search") Scr.data = await api("/screen/search?q=" + encodeURIComponent(v.q));
    else if (v.k === "mail") Scr.data = await api("/google/mail?acct=all&box=" + (v.q ? "any" : "inbox") + "&q=" + encodeURIComponent(v.q || ""));
    else if (v.k === "mailone") Scr.data = await api(`/google/mail/${v.acct}/${v.id}`);
    else if (v.k === "drive") Scr.data = await api("/google/drive?acct=all&q=" + encodeURIComponent(v.q || ""));
    else if (v.k === "file") Scr.data = await api(`/google/preview/${v.acct}/${v.id}`);
    else if (v.k === "project") Scr.data = await api(`/project/${v.slug}`);
    else Scr.data = {};
  } catch (e) { Scr.err = e.message; }
  if (Scr.cur === v) scrPaint();
  if (typeof hudNotify === "function" && push) hudNotify("On screen: " + scrTitle(v));
}
function scrTitle(v) {
  const d = Scr.cur === v ? Scr.data : null;
  return v.k === "page" ? (d?.title && d.title !== "about:blank" ? d.title : scrHost(d?.url || v.url)) : v.k === "search" ? `Search: ${v.q}` : v.k === "mail" ? (v.q ? `Email: ${v.q}` : "Inbox") : v.k === "mailone" ? (d?.subject || "Email")
    : v.k === "drive" ? (v.q ? `Drive: ${v.q}` : "Drive") : v.k === "file" ? (d?.file?.name || "File") : v.k === "project" ? projName(v.slug) : v.k === "agenda" ? (v.days === 1 ? "Today" : "Next 7 days") : v.k === "yt" ? "YouTube" : v.k === "gblock" ? "Google sign-in" : "Screen";
}
function scrOpenUrl() {
  const v = Scr.cur, d = Scr.data; if (!v) return "";
  return v.k === "page" ? d?.url || v.url : v.k === "yt" ? v.url : v.k === "mailone" ? d?.link : v.k === "file" ? d?.file?.link : v.k === "search" ? "https://duckduckgo.com/?q=" + encodeURIComponent(v.q) : v.k === "project" ? "#project/" + v.slug : "";
}
// The text a briefing is made from: whatever is on screen right now.
function scrMaterial() {
  const v = Scr.cur, d = Scr.data || {};
  if (!v) return null;
  if (v.k === "page" && !v.reader) return null; // live page: text is fetched from the browser in scrBrief
  if (v.k === "page") return { kind: "web page", title: d.title, text: [d.desc, ...(d.blocks || []).map(b => (b.t === "h" ? "## " : b.t === "li" ? "- " : "") + b.x)].filter(Boolean).join("\n") };
  if (v.k === "mailone") return { kind: "email", title: d.subject, text: `From: ${d.from}\n\n${d.body || ""}` };
  if (v.k === "mail") return { kind: "inbox", title: scrTitle(v), text: (d.items || []).map(m => `${m.from}: ${m.subject} — ${m.snippet}`).join("\n") };
  if (v.k === "file") return { kind: "file", title: d.file?.name, text: d.kind === "sheet" ? (d.rows || []).slice(0, 80).map(r => r.join(" | ")).join("\n") : d.text || "" };
  if (v.k === "project") return { kind: "project", title: d.project?.name, project: v.slug, text: [d.project?.summary, "Next: " + d.project?.nextStep, d.plan, (d.log || "").slice(0, 3000)].filter(Boolean).join("\n\n") };
  if (v.k === "search") return { kind: "search results", title: scrTitle(v), text: (d.results || []).map(r => `${r.title} (${r.host}): ${r.snippet}`).join("\n") };
  if (v.k === "agenda") return { kind: "schedule", title: scrTitle(v), text: scrAgenda(v.days).map(i => `${i.when}: ${i.t}${i.sub ? " (" + i.sub + ")" : ""}`).join("\n") };
  return null;
}
async function scrBrief(what, ask) {
  if (what) { await scrGo(scrResolve(what)); }
  let m = scrMaterial();
  if (!m && Scr.cur?.k === "page") { try { const t = await api("/browser/text"); m = { kind: "web page", title: t.title, text: t.text }; } catch {} }
  if (!m || !(m.text || "").trim()) { hudNotify?.("Pull something up first, then say “brief me”."); return; }
  Scr.quest = { loading: true }; scrPaint();
  try { const r = await api("/screen/brief", "POST", { ...m, ask, project: m.project || activeProject() || "" }); Scr.quest = r.quest; if (typeof speak === "function") speak(`${r.quest.title}. ${r.quest.objective} First step: ${r.quest.steps[0] || ""}`); }
  catch (e) { Scr.quest = { error: e.message }; }
  scrPaint();
}
function scrAgenda(days) {
  // Same colours as the Calendar page: reminders blue, milestones violet, deadlines red, Google events in their calendar's colour.
  const now = new Date(), end = new Date(now.getTime() + days * 864e5), out = [], day0 = new Date(ymd(now));
  const named = { teal: "var(--green)", green: "var(--green)", amber: "var(--amber)", violet: "var(--violet)", blue: "var(--accent)" };
  const fcol = Object.fromEntries((S.calendar?.feeds || []).map(f => [f.id, /^#/.test(f.color || "") ? f.color : named[f.color] || "var(--green)"]));
  const hm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  (S.calendar?.upcoming || []).forEach(e => { const s = e.allDay ? toDate(e.start + "T00:00") : new Date(e.start); if (s >= day0 && s < end) out.push({ s, t: e.title, sub: e.location || "", when: fmtWhen(e.start), time: e.allDay ? "" : hm(s), type: "event", color: fcol[e.feed] || "var(--green)" }); });
  S.reminders.filter(r => !r.done).forEach(r => { const s = toDate(r.due); if (s < end) out.push({ s, t: r.title, sub: r.project ? projName(r.project) : "", when: fmtWhen(r.due), time: r.due.length > 10 ? hm(s) : "", rem: true, type: "reminder", color: "var(--accent)", overdue: s < now }); });
  S.milestones.filter(m => !m.done).forEach(m => { const s = toDate(m.date); if (s >= day0 && s < end) out.push({ s, t: m.title, sub: projName(m.project) || "", when: fmtWhen(m.date), time: "", type: m.kind === "deadline" ? "deadline" : "milestone", color: m.kind === "deadline" ? "var(--red)" : "var(--violet)" }); });
  return out.sort((a, b) => a.s - b.s).slice(0, 40);
}
function scrAgendaHtml(days) {
  const it = scrAgenda(days); if (!it.length) return `<div class="scr-msg">Nothing scheduled.</div>`;
  const today = ymd(new Date()), tmr = ymd(new Date(Date.now() + 864e5)), groups = new Map();
  for (const i of it) { const k = i.overdue ? "overdue" : ymd(i.s); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); }
  const head = k => k === "overdue" ? "Overdue" : k === today ? "Today" : k === tmr ? "Tomorrow" : toDate(k + "T00:00").toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
  const label = { event: "event", reminder: "reminder", milestone: "milestone", deadline: "deadline" };
  return `<div class="scr-agenda"><div class="ag-legend"><span style="--c:var(--accent)">Reminder</span><span style="--c:var(--violet)">Milestone</span><span style="--c:var(--red)">Deadline</span><span style="--c:var(--green)">Calendar</span></div>
    ${[...groups].map(([k, l]) => `<section class="ag-day ${k === "overdue" ? "ag-overdue" : ""}"><h4>${esc(head(k))}<em>${l.length}</em></h4>${l.map(i => `<div class="ag-item" style="--c:${i.color}"><span class="ag-time">${i.overdue ? esc(i.when) : i.time || "all day"}</span><b>${esc(i.t)}</b><span class="ag-tag">${label[i.type]}${i.sub ? " · " + esc(i.sub) : ""}</span></div>`).join("")}</section>`).join("")}</div>`;
}

// The home screen: tiles for everything worth pulling up, one click each (no browser, so it's instant).
function scrLauncher() {
  const now = new Date(), endDay = new Date(ymd(now) + "T23:59"), wk = new Date(now.getTime() + 7 * 864e5);
  const today = scrAgenda(1).length, week = scrAgenda(7).length;
  const overdue = S.reminders.filter(r => !r.done && toDate(r.due) < now).length, dueToday = S.reminders.filter(r => !r.done && toDate(r.due) >= now && toDate(r.due) <= endDay).length;
  const pend = S.approvals.filter(a => a.status === "pending").length, drafts = (S.outbox || []).filter(x => x.status === "draft").length;
  const dates = S.milestones.filter(m => !m.done && toDate(m.date) >= new Date(ymd(now)) && toDate(m.date) < wk).length;
  const T = (go, ico, t, n, sub, hot) => `<button type="button" class="scr-tile ${hot ? "hot" : ""}" ${go}><i aria-hidden="true">${ico}</i><b>${esc(t)}</b>${n !== "" ? `<em>${esc(String(n))}</em>` : ""}<small>${esc(sub)}</small></button>`;
  const projs = S.projects.filter(p => p.stage !== "done");
  const links = projs.flatMap(p => (p.links || []).filter(l => /^https?:/i.test(l.url)).map(l => ({ ...l, p: p.name }))).slice(0, 8);
  return `<div class="scr-home">
    <div class="scr-grid">
      ${T('data-scrv="agenda1"', "◷", "Today", today, today ? "events & reminders" : "nothing scheduled", overdue)}
      ${T('data-scrv="agenda7"', "▦", "This week", week, dates ? `${dates} key date${dates > 1 ? "s" : ""}` : "next 7 days")}
      ${T('data-scrv="mail"', "✉", "Email", "", "inbox, all accounts")}
      ${T('data-scrv="drive"', "▤", "Drive", "", "docs, sheets, files")}
      ${T('data-hash="missions"', "⚑", "Needs you", pend, pend ? "approvals waiting" : "all clear", pend)}
      ${T('data-hash="outbox"', "➤", "Outbox", drafts, drafts ? "drafts to send" : "nothing waiting")}
      ${T('data-scrx="do a check"', "✓", "Run a check", "", "what's stale or broken")}
      ${T('data-hash="history"', "↺", "History", "", "past answers & chats")}
    </div>
    ${overdue || dueToday ? `<div class="scr-note">${overdue ? `<b>${overdue} overdue</b>` : ""}${overdue && dueToday ? " · " : ""}${dueToday ? `${dueToday} due today` : ""}</div>` : ""}
    <div class="pd-sub">Projects</div>
    <div class="scr-grid sm">${projs.map(p => `<button type="button" class="scr-tile proj h-${esc(p.health)}" data-scrp="${esc(p.slug)}"><b>${esc(p.name)}</b><small>${esc(p.nextStep || p.summary || p.stage)}</small></button>`).join("")}</div>
    ${links.length ? `<div class="pd-sub">Links</div><div class="scr-ex left">${links.map(l => `<button type="button" data-scrurl="${esc(l.url)}" title="${esc(l.p)}">${esc(l.label)}${l.label.toLowerCase() === scrHost(l.url) ? "" : ` <span class="faint">${esc(scrHost(l.url))}</span>`}</button>`).join("")}</div>` : ""}
  </div>`;
}
function scrBody() {
  const v = Scr.cur, d = Scr.data;
  if (!v) return scrLauncher();
  if (Scr.err) return `<div class="scr-msg bad">${esc(Scr.err)}</div>`;
  if (!d && v.k !== "agenda" && v.k !== "yt") return `<div class="scr-msg"><span class="scr-spin"></span>Pulling up ${esc(scrTitle(v))}…</div>`;
  if (v.k === "yt") return `<iframe class="scr-frame" src="https://www.youtube-nocookie.com/embed/${esc(v.id)}" title="YouTube" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
  if (v.k === "page" && !v.reader) return `<div class="scr-cr" id="scrCr" tabindex="0" aria-label="Live browser: click, scroll and type here"><img id="scrImg" alt="" draggable="false" src="/api/browser/live?v=${Scr.liveN || 0}"><div class="scr-crload" id="scrCrLoad" ${d.loading === false ? "hidden" : ""}><span class="scr-spin"></span></div></div>`;
  if (v.k === "page") {
    if (Scr.live && d.frame) return `<iframe class="scr-frame" src="${esc(d.url)}" title="${esc(d.title)}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" referrerpolicy="no-referrer"></iframe>`;
    return `<article class="scr-read"><div class="scr-src">${esc(d.host)}</div><h2>${esc(d.title)}</h2>${d.desc ? `<p class="scr-desc">${esc(d.desc)}</p>` : ""}
      ${(d.blocks || []).map(b => b.t === "h" ? `<h3>${esc(b.x)}</h3>` : b.t === "li" ? `<p class="li">• ${esc(b.x)}</p>` : b.t === "pre" ? `<pre>${esc(b.x)}</pre>` : `<p>${esc(b.x)}</p>`).join("") || `<p class="faint">This page has little readable text. Use “Open in Chrome”.</p>`}
      ${(d.links || []).length ? `<div class="scr-links"><div class="pd-sub">Links</div>${d.links.slice(0, 30).map(l => `<button type="button" data-scrurl="${esc(l.url)}">${esc(l.text)} <span>${esc(scrHost(l.url))}</span></button>`).join("")}</div>` : ""}</article>`;
  }
  if (v.k === "gblock") return `<div class="scr-msg scr-gb"><b>Google doesn't allow signing in here.</b><p>It blocks sign-in in any browser HQ controls, and that's a good thing: your Google password never goes through LUTHUR. Your connected accounts still work:</p>
    <div class="row scr-act"><button type="button" class="btn sm" data-scrx="pull up my inbox">✉ My emails</button><button type="button" class="btn sm" data-scrx="pull up drive">📄 My Drive files</button><a class="btn sm ghost" href="${esc(/^https?:/i.test(v.url) ? v.url : "https://accounts.google.com")}" target="_blank" rel="noopener">Open in Chrome ↗</a></div>
    <p class="small muted">Or say “pull up the budget sheet”, “read me the latest email from Sam”.</p></div>`;
  if (v.k === "search") return `<div class="scr-list">${(d.results || []).map(r => `<button type="button" class="scr-item" data-scrurl="${esc(r.url)}"><b>${esc(r.title)}</b><span class="scr-src">${esc(r.host)}</span><span class="small muted">${esc(r.snippet)}</span></button>`).join("") || `<div class="scr-msg">No results.</div>`}</div>`;
  if (v.k === "mail") return `<div class="scr-list">${(d.items || []).map(m => `<button type="button" class="scr-item" data-scrmail="${esc(m.acct)}|${esc(m.id)}"><b>${esc(m.subject)}</b><span class="scr-src">${esc(m.from)} · ${esc(ago(new Date(m.date).toISOString()))}</span><span class="small muted">${esc(m.snippet)}</span></button>`).join("") || `<div class="scr-msg">${(d.errors || []).length ? esc(d.errors[0].error) : "Nothing found."}</div>`}</div>`;
  if (v.k === "mailone") return `<article class="scr-read"><div class="scr-src">${esc(d.from)}</div><h2>${esc(d.subject)}</h2><pre class="scr-mail">${esc(d.body || "")}</pre>${(d.files || []).length ? `<div class="small muted">📎 ${d.files.map(f => esc(f.name)).join(", ")}</div>` : ""}</article>`;
  if (v.k === "drive") return `<div class="scr-list">${(d.items || []).map(f => `<button type="button" class="scr-item" data-scrfile="${esc(f.acct)}|${esc(f.id)}"><b>${esc(f.name)}</b><span class="scr-src">${esc(f.mime.split(".").pop().replace("application/", ""))} · ${esc(f.owner || "")}${f.modified ? " · " + esc(ago(f.modified)) : ""}</span></button>`).join("") || `<div class="scr-msg">${(d.errors || []).length ? esc(d.errors[0].error) : "No files found."}</div>`}</div>`;
  if (v.k === "file") {
    const f = d.file || {};
    if (d.kind === "sheet") return `<div class="scr-sheet"><table>${(d.rows || []).slice(0, 200).map((r, i) => `<tr>${r.slice(0, 26).map(c => i ? `<td>${esc(c)}</td>` : `<th>${esc(c)}</th>`).join("")}</tr>`).join("")}</table></div>`;
    if (d.kind === "text") return `<article class="scr-read"><h2>${esc(f.name)}</h2><pre class="scr-mail">${esc(String(d.text || "").slice(0, 60000))}</pre></article>`;
    if (d.kind === "pdf") return `<iframe class="scr-frame" src="/api/google/raw/${esc(f.acct)}/${esc(f.id)}" title="${esc(f.name)}"></iframe>`;
    if (d.kind === "image") return `<img class="scr-img" src="/api/google/raw/${esc(f.acct)}/${esc(f.id)}" alt="${esc(f.name)}">`;
    return `<div class="scr-msg">This file type opens in Google. Use “Open in Chrome”.</div>`;
  }
  if (v.k === "project") { const p = d.project || {}; return `<article class="scr-read"><div class="scr-src">${esc(p.stage)} · ${esc(p.health)}</div><h2>${esc(p.name)}</h2><p>${esc(p.summary || "")}</p><p><b>Next:</b> ${esc(p.nextStep || "—")}</p><div class="row scr-act"><button type="button" class="btn sm" data-scract="check">✓ Check it</button><button type="button" class="btn sm" data-scract="update">✎ Update</button><button type="button" class="btn sm ghost" data-scract="log">+ Log note</button></div><div class="md small">${md(String(d.log || "").split(/^## /m).slice(1, 4).map(x => "## " + x).join(""))}</div></article>`; }
  if (v.k === "agenda") return scrAgendaHtml(v.days);
  return "";
}
function scrQuest() {
  const q = Scr.quest; if (!q) return "";
  if (q.loading) return `<div class="scr-quest loading"><span class="scr-spin"></span>Preparing your briefing…</div>`;
  if (q.error) return `<div class="scr-quest"><div class="scr-msg bad">${esc(q.error)}</div></div>`;
  const li = a => a.map(x => `<li>${esc(x)}</li>`).join("");
  return `<div class="scr-quest d-${esc(q.difficulty)}"><div class="sq-top"><span class="sq-tag">NEW QUEST</span><span class="sq-diff">${esc(q.difficulty.toUpperCase())}</span><button type="button" class="icon-btn" id="scrQx" aria-label="Close briefing">✕</button></div>
    <h3>${esc(q.title)}</h3><p class="sq-obj">${esc(q.objective)}</p>
    ${q.intel.length ? `<div class="sq-h">Intel</div><ul>${li(q.intel)}</ul>` : ""}
    ${q.steps.length ? `<div class="sq-h">Objectives</div><ol>${q.steps.map((s, i) => `<li><label><input type="checkbox" data-sqs="${i}"><span>${esc(s)}</span></label></li>`).join("")}</ol>` : ""}
    ${q.risks.length ? `<div class="sq-h warn">Watch out</div><ul>${li(q.risks)}</ul>` : ""}
    ${q.reward ? `<div class="sq-reward"><span>REWARD</span>${esc(q.reward)}</div>` : ""}
    <div class="row end"><button type="button" class="btn sm" id="scrQrem">+ Add steps as reminders</button></div></div>`;
}
function scrPaint() {
  const box = document.getElementById("nvScreen"); if (!box) return;
  const oldImg = box.querySelector("#scrImg"); if (oldImg) oldImg.src = ""; // close the old live stream before redrawing
  const v = Scr.cur, open = scrOpenUrl();
  box.classList.toggle("on", !!v);
  box.innerHTML = `<div class="scr-bar"><span class="scr-tag">SCREEN</span>
      ${v ? `<button type="button" class="btn sm scr-nav" id="scrBack" aria-label="Back">← Back</button><button type="button" class="btn sm ghost scr-nav" id="scrX" aria-label="Home" title="Home: all tiles">⌂</button>` : ""}
      <form id="scrF" class="scr-go" autocomplete="off"><input id="scrQ" placeholder="${v ? esc(scrTitle(v)) : "Search, or type a site, project, email, file…"}" aria-label="What to pull up"></form>
      ${v ? `<button type="button" class="btn sm" id="scrBrief" title="Turn this into a quest briefing">⚔ Brief me</button>` : ""}
      ${v?.k === "page" && !v.reader ? `<button type="button" class="icon-btn" id="scrFwd" aria-label="Forward">→</button><button type="button" class="icon-btn" id="scrReload" aria-label="Reload">↻</button><button type="button" class="btn sm ghost" id="scrReader" title="Plain text version">Reader</button>` : ""}
      ${open ? `<a class="btn sm ghost" href="${esc(open)}" ${open.startsWith("#") ? "" : 'target="_blank" rel="noopener"'}>${open.startsWith("#") ? "Open" : "Open in Chrome ↗"}</a>` : ""}
      </div>
    ${scrQuest()}<div class="scr-body">${scrBody()}</div>`;
  // the bar also takes commands: "update next step to X", "check this", "mark it done" go to LUTHUR about what's on screen
  box.querySelector("#scrF").onsubmit = e => { e.preventDefault(); const q = box.querySelector("#scrQ"), t = q.value.trim(); if (!t) return;
    if (v && SCR_ACT.test(t)) { q.value = ""; return cmdSend(t); }
    if (!scrCommand(t)) scrGo(scrResolve(t)); };
  box.querySelectorAll("[data-scract]").forEach(b => b.onclick = async () => {
    const p = Scr.data?.project; if (!p) return; const a = b.dataset.scract;
    if (a === "check") return cmdSend(`Do a check on ${p.slug}`);
    if (a === "update") { const i = document.getElementById("cmdText"); if (i) { i.value = `Update ${p.name}: `; i.focus(); i.setSelectionRange(i.value.length, i.value.length); } return; }
    const note = prompt(`Log note for ${p.name}`); if (!note?.trim()) return;
    try { await api(`/project/${p.slug}/log`, "POST", { text: note.trim() }); hudNotify("Logged to " + p.name); scrGo(v, false); } catch (e) { hudNotify("⚠ " + e.message); }
  });
  const bk = box.querySelector("#scrBack"); if (bk) bk.onclick = () => { const p = Scr.stack.pop(); if (p) scrGo(p, false); else { Scr.cur = null; Scr.quest = null; scrPaint(); } }; // nothing earlier → the tiles
  const fw = box.querySelector("#scrFwd"); if (fw) fw.onclick = () => api("/browser/input", "POST", { type: "forward" }).catch(() => {});
  const rl = box.querySelector("#scrReload"); if (rl) rl.onclick = () => api("/browser/input", "POST", { type: "reload" }).catch(() => {});
  const rd = box.querySelector("#scrReader"); if (rd) rd.onclick = () => scrGo({ k: "page", url: Scr.data?.url || v.url, reader: true });
  const tl = box.querySelector("#scrToLive"); if (tl) tl.onclick = () => scrGo({ k: "page", url: Scr.data?.url || v.url });
  scrLiveBind(box);
  const x = box.querySelector("#scrX"); if (x) x.onclick = () => { if (v?.k === "page") api("/browser/stop", "POST").catch(() => {}); scrLiveStop(); Scr.cur = null; Scr.stack = []; Scr.quest = null; scrPaint(); };
  const br = box.querySelector("#scrBrief"); if (br) br.onclick = () => scrBrief("", "");
  const lv = box.querySelector("#scrLive"); if (lv) lv.onclick = () => { Scr.live = !Scr.live; scrPaint(); };
  const qx = box.querySelector("#scrQx"); if (qx) qx.onclick = () => { Scr.quest = null; scrPaint(); };
  const qr = box.querySelector("#scrQrem"); if (qr) qr.onclick = async () => {
    const q = Scr.quest, base = new Date(); base.setDate(base.getDate() + 1); base.setHours(10, 0, 0, 0);
    for (const [i, s] of q.steps.entries()) { const d = new Date(base.getTime() + i * 864e5); await api("/reminders", "POST", { title: `${q.title}: ${s}`.slice(0, 200), due: `${ymd(d)} 10:00`, project: Scr.cur?.k === "project" ? Scr.cur.slug : activeProject() || undefined }).catch(() => {}); }
    toast(`Added ${q.steps.length} reminders (one a day from tomorrow)`); refresh();
  };
  box.querySelectorAll("[data-scrv]").forEach(b => b.onclick = () => { const k = b.dataset.scrv; scrGo(k === "agenda1" ? { k: "agenda", days: 1 } : k === "agenda7" ? { k: "agenda", days: 7 } : { k, q: "" }); });
  box.querySelectorAll("[data-scrp]").forEach(b => b.onclick = () => scrGo({ k: "project", slug: b.dataset.scrp }));
  box.querySelectorAll("[data-hash]").forEach(b => b.onclick = () => { if (route.view === "command" && typeof upScreenView === "function") upScreenView(b.dataset.hash); else location.hash = b.dataset.hash; });
  box.querySelectorAll("[data-scrx]").forEach(b => b.onclick = () => { const t = b.dataset.scrx; if (/^brief/.test(t)) return toast("Pull something up first, then press ⚔ Brief me"); if (!scrCommand(t)) cmdSend(t); });
  box.querySelectorAll("[data-scrurl]").forEach(b => b.onclick = () => { const u = b.dataset.scrurl; scrGo(scrYT(u) ? { k: "yt", id: scrYT(u), url: u } : { k: "page", url: u }); });
  box.querySelectorAll("[data-scrmail]").forEach(b => b.onclick = () => { const [acct, id] = b.dataset.scrmail.split("|"); scrGo({ k: "mailone", acct, id }); });
  box.querySelectorAll("[data-scrfile]").forEach(b => b.onclick = () => { const [acct, id] = b.dataset.scrfile.split("|"); scrGo({ k: "file", acct, id }); });
}

// ---------------- live Chrome view: input forwarding + state polling ----------------
function scrLiveStart() {
  clearInterval(Scr.poll);
  Scr.poll = setInterval(async () => {
    if (!document.getElementById("scrImg")) { if (!document.getElementById("nvScreen")) scrLiveStop(); return; }
    const st = await api("/browser").catch(() => null); if (!st || Scr.cur?.k !== "page") return;
    if (!st.running) { scrLiveStop(); return; }
    // a YouTube video inside the browser → the normal player (with sound)
    const yt = scrYT(st.url); if (yt) { scrGo({ k: "yt", id: yt, url: st.url }); return; }
    try { if (SCR_GSIGN.test(new URL(st.url).hostname)) { scrGo({ k: "gblock", url: st.url }, false); return; } } catch {}
    const changed = st.url !== Scr.data?.url || st.title !== Scr.data?.title; Scr.data = st;
    const ld = document.getElementById("scrCrLoad"); if (ld) ld.hidden = !st.loading;
    if (changed) { const q = document.getElementById("scrQ"); if (q && document.activeElement !== q) q.placeholder = scrTitle(Scr.cur); const o = document.querySelector("#nvScreen a.btn[target]"); if (o) o.href = st.url; }
  }, 1200);
}
function scrLiveStop() { clearInterval(Scr.poll); Scr.poll = 0; }
function scrLiveBind(box) {
  const cr = box.querySelector("#scrCr"), img = box.querySelector("#scrImg"); if (!cr || !img) return;
  const fit = () => { const w = cr.clientWidth, h = cr.clientHeight; if (w > 50 && h > 50 && (Math.abs(w - (Scr.data?.w || 0)) > 4 || Math.abs(h - (Scr.data?.h || 0)) > 4)) api("/browser/resize", "POST", { w, h }).then(st => { Scr.data = { ...Scr.data, ...st }; }).catch(() => {}); };
  fit(); if (!cr._ro) { cr._ro = new ResizeObserver(() => { clearTimeout(cr._rt); cr._rt = setTimeout(fit, 250); }); cr._ro.observe(cr); }
  // the stream is drawn at panel width from the top (any extra strip at the bottom is cropped): scale is width-based
  const pt = e => {
    const r = img.getBoundingClientRect(), nw = img.naturalWidth || Scr.data?.dw || r.width, k = r.width / nw;
    const W = Scr.data?.dw || nw, sx = W / nw;
    return { x: Math.round((e.clientX - r.left) / k * sx), y: Math.round((e.clientY - r.top) / k * sx - (Scr.data?.top || 0)) };
  };
  const inp = b => api("/browser/input", "POST", b).catch(() => {});
  img.onclick = e => { cr.focus({ preventScroll: true }); inp({ type: "click", ...pt(e), ctrl: e.ctrlKey, shift: e.shiftKey }); };
  let mv = 0; img.onmousemove = e => { const n = Date.now(); if (n - mv < 90) return; mv = n; inp({ type: "move", ...pt(e) }); };
  cr.addEventListener("wheel", e => { e.preventDefault(); inp({ type: "wheel", ...pt(e), dx: e.deltaX, dy: e.deltaY }); }, { passive: false });
  // phones: swipe to scroll, tap to click
  let ty = null; img.ontouchstart = e => { ty = e.touches[0].clientY; }; img.ontouchmove = e => { if (ty == null) return; const y = e.touches[0].clientY; e.preventDefault(); inp({ type: "wheel", ...pt(e.touches[0]), dy: (ty - y) * 2 }); ty = y; };
  cr.onkeydown = e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") { e.preventDefault(); navigator.clipboard?.readText().then(t => t && inp({ type: "text", text: t })).catch(() => {}); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key.length === 1) { e.preventDefault(); inp({ type: "text", text: e.key }); }
    else if (["Enter", "Backspace", "Tab", "Escape", "Delete", "ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(e.key)) { e.preventDefault(); inp({ type: "key", key: e.key, shift: e.shiftKey }); }
  };
}

// ---------------- reading aloud + commands from LUTHUR's chat ----------------
function scrSay(t) { if (typeof speakAlways === "function") speakAlways(String(t || "").replace(/\s+/g, " ").slice(0, 2400)); }
async function scrReadAloud() {
  let m = scrMaterial();
  if (!m && Scr.cur?.k === "page") { try { const t = await api("/browser/text"); m = { title: t.title, text: t.text }; } catch {} }
  if (!m || !(m.text || "").trim()) return scrSay("There's nothing on the screen to read.");
  scrSay(`${m.title ? m.title + ". " : ""}${m.text}`);
}
async function scrSummary() {
  await scrBrief("", "Summarise this for me out loud");
  const q = Scr.quest; if (q && !q.error && !q.loading) scrSay(`${q.objective} ${q.intel.join(". ")}`);
}
// wait until the screen has loaded what it's showing (or ~12 s)
const scrLoaded = async () => { for (let i = 0; i < 40 && Scr.cur && !Scr.data && !Scr.err; i++) await new Promise(r => setTimeout(r, 300)); };
/** LUTHUR (the chat agent) asked to show something: open it here; optionally read it out or summarise it. */
async function scrFromChat(c) {
  if (!c?.id || c.id === Scr.lastCmd || Date.now() - c.at > 5 * 60e3) return;
  Scr.lastCmd = c.id;
  if (route.view !== "command") { location.hash = "command"; for (let i = 0; i < 20 && !document.getElementById("nvScreen"); i++) await new Promise(r => setTimeout(r, 150)); }
  const v = c.kind === "url" ? (scrYT(c.url) ? { k: "yt", id: scrYT(c.url), url: c.url } : { k: "page", url: c.url }) : c.kind === "email" ? { k: "mailone", acct: c.acct, id: c.id2 } : c.kind === "file" ? { k: "file", acct: c.acct, id: c.id2 }
    : c.kind === "search" ? { k: "search", q: c.query || "" } : c.kind === "project" ? { k: "project", slug: c.slug } : c.kind === "calendar" ? { k: "agenda", days: 7 } : { k: "mail", q: c.query || "" };
  await scrGo(v); await scrLoaded();
  if (c.read_aloud) await scrReadAloud(); else if (c.summarize) await scrSummary();
}
/** Hands-free sentences the screen can handle itself. Returns true if handled. */
function scrVoice(cmd) {
  const c = String(cmd || "").trim();
  if (/^(read|say|speak)( it| this| that| the (email|doc|document|page|file|sheet))?( out| aloud| to me)?\.?$/i.test(c)) { scrReadAloud(); return true; }
  if (/^(summari[sz]e|sum up)( it| this| that)?\.?$/i.test(c)) { scrSummary(); return true; }
  if (!SCR_VERB.test(c) && !SCR_BRIEF.test(c)) return false;
  const run = () => scrCommand(c);
  if (route.view !== "command") { location.hash = "command"; setTimeout(run, 700); } else run();
  return true;
}

// mount under the Command chat box; keep what's on screen across re-renders
const _vCommandScr = vCommand;
vCommand = async function (el) {
  await _vCommandScr(el);
  const mid = el.querySelector(".nv-mid"); if (!mid || document.getElementById("nvScreen")) return;
  const s = document.createElement("section"); s.className = "card nv-screen no-fold"; s.id = "nvScreen";
  (mid.querySelector("#cmdReply") || mid.lastElementChild).after(s);
  scrPaint();
};
// typed or spoken "pull up …" / "brief me …" goes to the screen instead of chat
if (typeof cmdSend === "function") { const _cmdSendScr = cmdSend; cmdSend = function (t) { if (route.view === "command" && scrVoice(t)) { const i = document.getElementById("cmdText"); if (i) i.value = ""; return; } return _cmdSendScr(t); }; }
