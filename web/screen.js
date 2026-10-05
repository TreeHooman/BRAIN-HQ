// Command "Screen": tell LUTHUR to pull something up and it shows here. Say or type "pull up loancentral.net",
// "show me my calendar", "open emails from Sam", "pull up the budget sheet", "search ntfy setup", or a project name.
// "Brief me on this" / "look over this" turns what's on screen into a quest card (objective, intel, steps, risks, reward).
// Everything external is shown as escaped text (reader view); a live view is offered only when the site allows framing.
"use strict";
const Scr = { stack: [], cur: null, busy: false, quest: null };
const SCR_VERB = /^(?:(?:hey|ok|yo)\s+luth[ou]r[,!.]?\s+)?(?:can you\s+|please\s+)?(pull up|bring up|put up|show me|show|open|display|look up|search(?: for)?|google|find)\s+(.+)$/i;
const SCR_BRIEF = /^(?:(?:hey|ok|yo)\s+luth[ou]r[,!.]?\s+)?(?:can you\s+|please\s+)?(?:brief me(?: on)?|give me a briefing(?: on)?|look over|go over|review|break down|quest(?: me)?(?: on)?)\b\s*(.*)$/i;
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
  Scr.cur = v; Scr.quest = null; Scr.data = null; Scr.err = ""; scrPaint();
  try {
    if (v.k === "page") Scr.data = await api("/screen/read?url=" + encodeURIComponent(v.url));
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
  return v.k === "page" ? (d?.title || scrHost(v.url)) : v.k === "search" ? `Search: ${v.q}` : v.k === "mail" ? (v.q ? `Email: ${v.q}` : "Inbox") : v.k === "mailone" ? (d?.subject || "Email")
    : v.k === "drive" ? (v.q ? `Drive: ${v.q}` : "Drive") : v.k === "file" ? (d?.file?.name || "File") : v.k === "project" ? projName(v.slug) : v.k === "agenda" ? (v.days === 1 ? "Today" : "Next 7 days") : v.k === "yt" ? "YouTube" : "Screen";
}
function scrOpenUrl() {
  const v = Scr.cur, d = Scr.data; if (!v) return "";
  return v.k === "page" ? d?.url || v.url : v.k === "yt" ? v.url : v.k === "mailone" ? d?.link : v.k === "file" ? d?.file?.link : v.k === "search" ? "https://duckduckgo.com/?q=" + encodeURIComponent(v.q) : v.k === "project" ? "#project/" + v.slug : "";
}
// The text a briefing is made from: whatever is on screen right now.
function scrMaterial() {
  const v = Scr.cur, d = Scr.data || {};
  if (!v) return null;
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
  const m = scrMaterial(); if (!m || !(m.text || "").trim()) { hudNotify?.("Pull something up first, then say “brief me”."); return; }
  Scr.quest = { loading: true }; scrPaint();
  try { const r = await api("/screen/brief", "POST", { ...m, ask, project: m.project || activeProject() || "" }); Scr.quest = r.quest; if (typeof speak === "function") speak(`${r.quest.title}. ${r.quest.objective} First step: ${r.quest.steps[0] || ""}`); }
  catch (e) { Scr.quest = { error: e.message }; }
  scrPaint();
}
function scrAgenda(days) {
  const now = new Date(), end = new Date(now.getTime() + days * 864e5), out = [];
  (S.calendar?.upcoming || []).forEach(e => { const s = e.allDay ? toDate(e.start + "T00:00") : new Date(e.start); if (s >= new Date(ymd(now)) && s < end) out.push({ s, t: e.title, sub: e.location || "", when: e.allDay ? fmtWhen(e.start) : fmtWhen(e.start) }); });
  S.reminders.filter(r => !r.done).forEach(r => { const s = toDate(r.due); if (s < end) out.push({ s, t: r.title, sub: r.project ? projName(r.project) : "", when: fmtWhen(r.due), rem: true }); });
  S.milestones.filter(m => !m.done).forEach(m => { const s = toDate(m.date); if (s >= new Date(ymd(now)) && s < end) out.push({ s, t: m.title, sub: m.kind === "deadline" ? "deadline" : "milestone", when: fmtWhen(m.date) }); });
  return out.sort((a, b) => a.s - b.s).slice(0, 40);
}

function scrBody() {
  const v = Scr.cur, d = Scr.data;
  if (!v) return `<div class="scr-idle"><b>Tell me what to pull up.</b>
    <div class="scr-ex">${["pull up loancentral.net", "show me my calendar", "open emails from Sam", "pull up the budget sheet", "search ntfy iphone setup", "brief me on this"].map(x => `<button type="button" data-scrx="${esc(x)}">“${esc(x)}”</button>`).join("")}</div></div>`;
  if (Scr.err) return `<div class="scr-msg bad">${esc(Scr.err)}</div>`;
  if (!d && v.k !== "agenda" && v.k !== "yt") return `<div class="scr-msg"><span class="scr-spin"></span>Pulling up ${esc(scrTitle(v))}…</div>`;
  if (v.k === "yt") return `<iframe class="scr-frame" src="https://www.youtube-nocookie.com/embed/${esc(v.id)}" title="YouTube" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
  if (v.k === "page") {
    if (Scr.live && d.frame) return `<iframe class="scr-frame" src="${esc(d.url)}" title="${esc(d.title)}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" referrerpolicy="no-referrer"></iframe>`;
    return `<article class="scr-read"><div class="scr-src">${esc(d.host)}</div><h2>${esc(d.title)}</h2>${d.desc ? `<p class="scr-desc">${esc(d.desc)}</p>` : ""}
      ${(d.blocks || []).map(b => b.t === "h" ? `<h3>${esc(b.x)}</h3>` : b.t === "li" ? `<p class="li">• ${esc(b.x)}</p>` : b.t === "pre" ? `<pre>${esc(b.x)}</pre>` : `<p>${esc(b.x)}</p>`).join("") || `<p class="faint">This page has little readable text. Use “Open in Chrome”.</p>`}
      ${(d.links || []).length ? `<div class="scr-links"><div class="pd-sub">Links</div>${d.links.slice(0, 30).map(l => `<button type="button" data-scrurl="${esc(l.url)}">${esc(l.text)} <span>${esc(scrHost(l.url))}</span></button>`).join("")}</div>` : ""}</article>`;
  }
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
  if (v.k === "project") { const p = d.project || {}; return `<article class="scr-read"><div class="scr-src">${esc(p.stage)} · ${esc(p.health)}</div><h2>${esc(p.name)}</h2><p>${esc(p.summary || "")}</p><p><b>Next:</b> ${esc(p.nextStep || "—")}</p><div class="md small">${md(String(d.log || "").split(/^## /m).slice(1, 4).map(x => "## " + x).join(""))}</div></article>`; }
  if (v.k === "agenda") { const it = scrAgenda(v.days); return `<div class="scr-list">${it.map(i => `<div class="scr-item static"><b>${esc(i.t)}</b><span class="scr-src">${esc(i.when)}${i.sub ? " · " + esc(i.sub) : ""}</span></div>`).join("") || `<div class="scr-msg">Nothing scheduled.</div>`}</div>`; }
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
  const v = Scr.cur, open = scrOpenUrl();
  box.classList.toggle("on", !!v);
  box.innerHTML = `<div class="scr-bar"><span class="scr-tag">SCREEN</span>
      <button type="button" class="icon-btn" id="scrBack" ${Scr.stack.length ? "" : "disabled"} aria-label="Back">←</button>
      <form id="scrF" class="scr-go" autocomplete="off"><input id="scrQ" placeholder="${v ? esc(scrTitle(v)) : "Pull up a site, project, email, file…"}" aria-label="What to pull up"></form>
      ${v ? `<button type="button" class="btn sm" id="scrBrief" title="Turn this into a quest briefing">⚔ Brief me</button>` : ""}
      ${v?.k === "page" && Scr.data?.frame ? `<button type="button" class="btn sm ghost" id="scrLive">${Scr.live ? "Reader" : "Live"}</button>` : ""}
      ${open ? `<a class="btn sm ghost" href="${esc(open)}" ${open.startsWith("#") ? "" : 'target="_blank" rel="noopener"'}>${open.startsWith("#") ? "Open" : "Open in Chrome ↗"}</a>` : ""}
      ${v ? `<button type="button" class="icon-btn" id="scrX" aria-label="Clear screen">✕</button>` : ""}</div>
    ${scrQuest()}<div class="scr-body">${scrBody()}</div>`;
  box.querySelector("#scrF").onsubmit = e => { e.preventDefault(); const t = box.querySelector("#scrQ").value.trim(); if (!t) return; if (!scrCommand(t)) scrGo(scrResolve(t)); };
  box.querySelector("#scrBack").onclick = () => { const p = Scr.stack.pop(); if (p) scrGo(p, false); };
  const x = box.querySelector("#scrX"); if (x) x.onclick = () => { Scr.cur = null; Scr.stack = []; Scr.quest = null; scrPaint(); };
  const br = box.querySelector("#scrBrief"); if (br) br.onclick = () => scrBrief("", "");
  const lv = box.querySelector("#scrLive"); if (lv) lv.onclick = () => { Scr.live = !Scr.live; scrPaint(); };
  const qx = box.querySelector("#scrQx"); if (qx) qx.onclick = () => { Scr.quest = null; scrPaint(); };
  const qr = box.querySelector("#scrQrem"); if (qr) qr.onclick = async () => {
    const q = Scr.quest, base = new Date(); base.setDate(base.getDate() + 1); base.setHours(10, 0, 0, 0);
    for (const [i, s] of q.steps.entries()) { const d = new Date(base.getTime() + i * 864e5); await api("/reminders", "POST", { title: `${q.title}: ${s}`.slice(0, 200), due: `${ymd(d)} 10:00`, project: Scr.cur?.k === "project" ? Scr.cur.slug : activeProject() || undefined }).catch(() => {}); }
    toast(`Added ${q.steps.length} reminders (one a day from tomorrow)`); refresh();
  };
  box.querySelectorAll("[data-scrx]").forEach(b => b.onclick = () => { const t = b.dataset.scrx; if (/^brief/.test(t)) return toast("Pull something up first, then press ⚔ Brief me"); scrCommand(t); });
  box.querySelectorAll("[data-scrurl]").forEach(b => b.onclick = () => { const u = b.dataset.scrurl; scrGo(scrYT(u) ? { k: "yt", id: scrYT(u), url: u } : { k: "page", url: u }); });
  box.querySelectorAll("[data-scrmail]").forEach(b => b.onclick = () => { const [acct, id] = b.dataset.scrmail.split("|"); scrGo({ k: "mailone", acct, id }); });
  box.querySelectorAll("[data-scrfile]").forEach(b => b.onclick = () => { const [acct, id] = b.dataset.scrfile.split("|"); scrGo({ k: "file", acct, id }); });
}

// mount under the Command chat box; keep what's on screen across re-renders
const _vCommandScr = vCommand;
vCommand = async function (el) {
  await _vCommandScr(el);
  const mid = el.querySelector(".nv-mid"); if (!mid || document.getElementById("nvScreen")) return;
  const s = document.createElement("section"); s.className = "card nv-screen"; s.id = "nvScreen";
  (mid.querySelector("#cmdReply") || mid.lastElementChild).after(s);
  scrPaint();
};
// typed or spoken "pull up …" / "brief me …" goes to the screen instead of chat
if (typeof cmdSend === "function") { const _cmdSendScr = cmdSend; cmdSend = function (t) { if (route.view === "command" && scrCommand(t)) { const i = document.getElementById("cmdText"); if (i) i.value = ""; return; } return _cmdSendScr(t); }; }
