// Extra screens: Code (live coding sessions per project) and Outbox (emails + calendar changes
// that wait for the owner's OK). Loads after hud.js; uses app.js/hud.js globals.
"use strict";
VIEWS.splice(3, 0, ["code", "Code", "⌨"], ["outbox", "Outbox", "✉"]);

// ---------------- Code ----------------
const Code = { slug: null, data: null, poll: 0, live: null, sentAt: 0 };
const codeProjects = () => S.projects.filter(p => (p.paths || []).length);
function stepLine(s, live) {
  if (s.kind !== "tool") return "";
  const diff = (s.diff || []).length ? `<div class="cd-diff">${s.diff.map(l => `<span class="${l[0] === "+" ? "a" : "d"}">${esc(l)}</span>`).join("\n")}</div>` : "";
  return `<div class="s ${s.ok === false ? "bad" : ""} ${live && !s.done && s.result === undefined ? "run" : ""}"><b>${esc(s.verb || s.tool)}</b><span>${esc(s.target || "")}</span>${s.result ? `<em>· ${esc(s.result)}</em>` : ""}</div>${diff}`;
}
function codeMsgHTML(m) {
  if (m.role === "you") return `<div class="cd-msg you">${esc(m.text)}</div>`;
  const steps = (m.steps || []).filter(s => s.kind === "tool");
  const list = steps.map(s => stepLine(s)).join("");
  const stepsBlock = !steps.length ? "" : steps.length > 6 ? `<details><summary class="small muted">${steps.length} steps</summary><div class="cd-steps">${list}</div></details>` : `<div class="cd-steps">${list}</div>`;
  const meta = m.ms || m.added || m.removed ? `<div class="cd-meta">${m.added ? `<span class="a">+${m.added}</span> ` : ""}${m.removed ? `<span class="d">−${m.removed}</span> · ` : ""}${m.ms ? Math.round(m.ms / 1000) + "s" : ""}</div>` : "";
  return `<div class="cd-msg hq ${m.error ? "err" : ""}">${stepsBlock}<div class="md">${md(m.text || "")}</div>${meta}</div>`;
}
async function vCode(el) {
  const projs = codeProjects();
  if (!Code.slug || !projs.some(p => p.slug === Code.slug)) Code.slug = (projs.find(p => p.slug === activeProject()) || projs.find(p => p.slug === hstore.get("hq-code", "")) || projs[0])?.slug || null;
  el.innerHTML = `<div class="between"><div><h1>Code</h1><p class="sub">Work on a project with Claude Code, right here. Same engine and usage as Claude Code desktop; each project keeps one resumable session.</p></div></div>
    <div class="cd">
      <div class="cd-side">${projs.map(p => `<button class="cd-proj ${p.slug === Code.slug ? "on" : ""}" data-slug="${p.slug}" type="button"><i class="${(Code.data?.project === p.slug && Code.data.busy) ? "busy" : p.health === "good" ? "ok" : ""}"></i><span>${esc(p.name)}</span></button>`).join("") || `<div class="small muted">No project has a folder yet. Add one under a project's Setup tab.</div>`}</div>
      <div class="card cd-main" id="cdMain">${Code.slug ? `<div class="cd-empty"><b>Loading…</b></div>` : `<div class="cd-empty"><b>No code folders</b>Open a project → Setup → add its folder path, then come back.</div>`}</div>
    </div>`;
  el.querySelectorAll("[data-slug]").forEach(b => b.onclick = () => { Code.slug = b.dataset.slug; hstore.set("hq-code", Code.slug); Code.data = null; render(); });
  if (Code.slug) await codeLoad(true);
}
async function codeLoad(full) {
  const slug = Code.slug; if (!slug) return;
  const d = await api(`/code/${slug}`).catch(e => ({ error: e.message }));
  if (route.view !== "code" || Code.slug !== slug) return;
  const prevLen = Code.data?.project === slug ? Code.data.messages.length : -1;
  Code.data = d;
  const main = document.getElementById("cdMain"); if (!main) return;
  if (d.error) { main.innerHTML = `<div class="cd-empty"><b>Can't open</b>${esc(d.error)}</div>`; return; }
  if (full || !main.querySelector(".cd-log")) {
    const ro = d.level !== "build";
    main.innerHTML = `<div class="cd-bar"><b>${esc(d.name)}</b><span class="pill ${ro ? "amber" : "green"}">${ro ? "read-only" : "can edit"}</span><span class="path" title="${esc(d.folders.join("; "))}">${esc(d.found.join(" · ") || "folder not found on this PC")}</span>
        ${tierSwitch()}<button class="btn sm" id="cdStop" type="button" ${d.busy ? "" : "hidden"}>■ Stop</button><button class="btn sm ghost" id="cdNew" type="button" title="Start a fresh session (clears context)">New session</button></div>
      <div class="cd-log" id="cdLog"></div>
      <form class="cd-in" id="cdForm"><textarea id="cdText" rows="2" placeholder="${ro ? "Ask about the code (this project is read-only here)…" : "What should we build or fix? (Ctrl+Enter to send)"}"></textarea><button class="btn primary" id="cdSend">Run</button></form>
      <div class="cd-hint">Edits stay in your dev folder. Commits, pushes and deploys are blocked: review the diff, then commit yourself.</div>`;
    bindTierSwitch(main);
    const ta = document.getElementById("cdText");
    ta.oninput = () => { ta.style.height = "auto"; ta.style.height = Math.min(220, ta.scrollHeight) + "px"; };
    ta.onkeydown = e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); codeSend(); } };
    document.getElementById("cdForm").onsubmit = e => { e.preventDefault(); codeSend(); };
    document.getElementById("cdStop").onclick = () => api(`/code/${slug}/stop`, "POST").catch(x => toast(x.message));
    document.getElementById("cdNew").onclick = async () => { if (!confirm("Start a fresh session? The current one is archived.")) return; await api(`/code/${slug}/new`, "POST").then(() => codeLoad(true)).catch(x => toast(x.message)); };
  }
  const log = document.getElementById("cdLog");
  const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  if (full || prevLen !== d.messages.length) {
    log.innerHTML = d.messages.length ? d.messages.map(codeMsgHTML).join("") : `<div class="cd-empty"><b>${esc(d.name)}</b>Ask for a feature, a fix, a refactor or an explanation. You'll see every file it reads and edits, live.</div>`;
    if (!full && d.messages.at(-1)?.role === "hq") { const last = log.lastElementChild; if (last && typeof revealHTML === "function") revealHTML(last.querySelector(".md"), 1200); Snd.blip(1320, .06); }
  }
  let liveBox = document.getElementById("cdLive");
  if (d.busy) {
    if (!liveBox) { liveBox = document.createElement("div"); liveBox.id = "cdLive"; liveBox.className = "cd-msg hq"; log.appendChild(liveBox); }
    const op = (await api("/live").catch(() => ({ ops: [] }))).ops?.find(o => o.id === d.opId);
    const steps = (op?.steps || []).filter(s => s.kind === "tool");
    liveBox.innerHTML = `<div class="cd-steps">${steps.slice(-14).map(s => stepLine(s, true)).join("")}<div class="s run"><b>${steps.length ? "Working" : "Starting"}</b><span>${op ? `${op.calls} steps · <span class="a">+${op.added}</span> <span class="d">−${op.removed}</span> · ${Math.round((Date.now() - op.startedAt) / 1000)}s` : ""}</span></div></div>`;
  } else liveBox?.remove();
  if (stick || full) log.scrollTop = log.scrollHeight;
  const stop = document.getElementById("cdStop"); if (stop) stop.hidden = !d.busy;
  const send = document.getElementById("cdSend"); if (send) send.disabled = d.busy;
  document.querySelectorAll(".cd-proj i").forEach(i => { if (i.parentElement.dataset.slug === slug) i.className = d.busy ? "busy" : "ok"; });
  clearTimeout(Code.poll);
  if (d.busy || Date.now() - Code.sentAt < 3000) Code.poll = setTimeout(() => codeLoad(false), 1100);
}
async function codeSend() {
  const ta = document.getElementById("cdText"); const text = ta?.value.trim(); if (!text || Code.data?.busy) return;
  try { await api(`/code/${Code.slug}`, "POST", { text, tier: currentTier() }); }
  catch (e) { toast("⚠ " + e.message, 5000); return; }
  ta.value = ""; ta.style.height = ""; Code.sentAt = Date.now(); Snd.blip(980, .06); corePing?.(); opsKick?.();
  codeLoad(false);
}

// ---------------- Outbox ----------------
const OB_ST = { draft: ["amber", "waiting for you"], sending: ["blue", "sending…"], sent: ["green", "sent"], drafted: ["violet", "saved as Gmail draft"], failed: ["red", "not sent"] };
const fmtDT = s => s ? s.length <= 10 ? fmtWhen(s) : fmtWhen(s.replace("T", " ").slice(0, 16)) : "";
function obCard(x) {
  const p = x.payload, [cls, lbl] = OB_ST[x.status] || ["", x.status], editable = x.status === "draft" || x.status === "failed";
  const by = x.by === "you" ? "you" : (S.settings.assistantName || "LUTHUR");
  const body = x.kind === "email"
    ? `${p.from ? `<div class="ob-field"><span>From</span><div>${typeof wsAcc === "function" && wsAcc(p.from) ? `<b>${esc(wsAcc(p.from).label)}</b> ${esc(wsAcc(p.from).email)}` : "Google account"}</div></div>` : ""}<div class="ob-field"><span>To</span><div>${esc(p.to.join(", "))}</div></div>${p.cc?.length ? `<div class="ob-field"><span>Cc</span><div>${esc(p.cc.join(", "))}</div></div>` : ""}<div class="ob-field"><span>Subject</span><div><b>${esc(p.subject)}</b></div></div><div class="ob-body">${esc(p.body)}</div>`
    : `<div class="ob-field"><span>Action</span><div><b>${esc(cap(p.action))}</b> event</div></div><div class="ob-field"><span>Title</span><div><b>${esc(p.title)}</b></div></div>${p.start ? `<div class="ob-field"><span>When</span><div>${esc(fmtDT(p.start))}${p.end ? " → " + esc(fmtDT(p.end)) : ""}</div></div>` : ""}${p.location ? `<div class="ob-field"><span>Where</span><div>${esc(p.location)}</div></div>` : ""}${p.attendees?.length ? `<div class="ob-field"><span>Guests</span><div>${esc(p.attendees.join(", "))}</div></div>` : ""}${p.eventRef ? `<div class="ob-field"><span>Find</span><div>${esc(p.eventRef)}</div></div>` : ""}${p.description ? `<div class="ob-body">${esc(p.description)}</div>` : ""}`;
  return `<section class="card ob ${x.status}" data-ob="${x.id}"><div class="ob-head"><span class="ic ${x.kind === "calendar" ? "cal" : ""}">${x.kind === "email" ? "✉" : "◷"}</span><div class="grow"><b>${x.kind === "email" ? "Email" : "Calendar"}</b><div class="small faint">by ${by} · ${esc(ago(x.createdAt))}${x.project ? " · " + esc(projName(x.project)) : ""}</div></div><span class="pill ${cls}">${esc(lbl)}</span></div>
    ${x.note ? `<div class="ob-note">“${esc(x.note)}”</div>` : ""}${body}${x.result ? `<div class="ob-res">${esc(x.result)}</div>` : ""}
    ${editable ? `<div class="row end"><button class="btn ghost sm" data-obx="discard">Discard</button><button class="btn sm" data-obx="edit">Edit</button><button class="btn primary sm" data-obx="send">${x.kind === "email" ? "Approve & send" : "Approve & apply"}</button></div>` : ""}</section>`;
}
function vOutbox(el) {
  const all = S.outbox || [];
  const open = all.filter(x => ["draft", "failed", "sending"].includes(x.status)), done = all.filter(x => !open.includes(x));
  el.innerHTML = `<div class="between"><div><h1>Outbox</h1><p class="sub">Emails and calendar changes wait here until you approve them. Nothing leaves LUTHUR without your click.</p></div>
      <div class="row"><button class="btn" id="obEv" type="button">＋ Event</button><button class="btn primary" id="obEm" type="button">New email</button></div></div>
    ${open.length ? `<div class="ob-grid">${open.map(obCard).join("")}</div>` : `<div class="card"><div class="empty">Nothing waiting. Ask LUTHUR “email Sam that…” or “move my dentist to Friday 3pm” and it lands here for your OK.</div></div>`}
    ${done.length ? `<h2>History</h2><div class="ob-grid">${done.slice(0, 20).map(obCard).join("")}</div>` : ""}`;
  document.getElementById("obEm").onclick = () => outboxCompose("email");
  document.getElementById("obEv").onclick = () => outboxCompose("calendar");
  el.querySelectorAll("[data-ob]").forEach(c => {
    const x = all.find(i => i.id === c.dataset.ob);
    c.querySelectorAll("[data-obx]").forEach(b => b.onclick = async () => {
      const a = b.dataset.obx;
      if (a === "edit") return outboxCompose(x.kind, x);
      if (a === "discard") return act(() => api(`/outbox/${x.id}`, "DELETE"), "Discarded");
      const what = x.kind === "email" ? `Send this email to ${x.payload.to.join(", ")}?` : `${cap(x.payload.action)} "${x.payload.title}" on your Google Calendar?`;
      if (!confirm(what)) return;
      b.disabled = true; b.textContent = "Sending…";
      await act(() => api(`/outbox/${x.id}/send`, "POST"), "Sending… you'll get a notification");
      setTimeout(async () => { await refresh(); if (route.view === "outbox") render(); }, 4000);
    });
  });
  if (open.some(x => x.status === "sending")) { clearTimeout(vOutbox.t); vOutbox.t = setTimeout(async () => { await refresh(); if (route.view === "outbox") render(); }, 3000); }
}
function outboxCompose(kind, x) {
  const p = x?.payload || {};
  const local = s => s ? String(s).slice(0, 16) : "";
  modal(kind === "email" ? `<h3>${x ? "Edit email" : "New email"}</h3><form class="form" id="obForm">
      <label class="f">To (comma separated)<input name="to" value="${esc((p.to || []).join(", "))}" required autocomplete="off"></label>
      <label class="f">Cc<input name="cc" value="${esc((p.cc || []).join(", "))}" autocomplete="off"></label>
      <label class="f">Subject<input name="subject" value="${esc(p.subject || "")}" required></label>
      <label class="f">Message<textarea name="body" rows="9" required>${esc(p.body || "")}</textarea></label>
      <div class="row end"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">${x ? "Save" : "Save to Outbox"}</button></div></form>`
    : `<h3>${x ? "Edit calendar change" : "New calendar event"}</h3><form class="form" id="obForm">
      <div class="two"><label class="f">Action<select name="action">${opts([["create", "Create"], ["update", "Update"], ["delete", "Delete"]], p.action || "create")}</select></label><label class="f">Title<input name="title" value="${esc(p.title || "")}" required></label></div>
      <div class="two"><label class="f">Start<input type="datetime-local" name="start" value="${esc(local(p.start))}"></label><label class="f">End<input type="datetime-local" name="end" value="${esc(local(p.end))}"></label></div>
      <label class="f">Location<input name="location" value="${esc(p.location || "")}"></label>
      <label class="f">Guests (emails, optional)<input name="attendees" value="${esc((p.attendees || []).join(", "))}"></label>
      <label class="f">Which event (for update/delete)<input name="eventRef" value="${esc(p.eventRef || "")}" placeholder="e.g. Dentist on Oct 8 at 2pm"></label>
      <label class="f">Notes<textarea name="description" rows="3">${esc(p.description || "")}</textarea></label>
      <div class="row end"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">${x ? "Save" : "Save to Outbox"}</button></div></form>`);
  document.getElementById("obForm").onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const payload = kind === "email" ? { to: f.to, cc: f.cc, subject: f.subject, body: f.body }
      : { action: f.action, title: f.title, start: f.start, end: f.end, location: f.location, attendees: f.attendees, eventRef: f.eventRef, description: f.description };
    const ok = await act(() => x ? api(`/outbox/${x.id}`, "PUT", { payload }) : api("/outbox", "POST", { kind, payload, project: activeProject() || null }), x ? "Saved" : "In the Outbox: approve it when ready");
    if (ok) { closeModal(); if (route.view !== "outbox") location.hash = "outbox"; }
  };
}

// ---------------- Settings: Gmail + Calendar sending (connectors) ----------------
async function connCardFill(force) {
  const box = document.getElementById("connCard"); if (!box) return;
  box.innerHTML = `<div class="small muted">${force ? "Checking your Claude connectors (can take ~20 s)…" : "Loading…"}</div>`;
  const c = await api("/connectors" + (force ? "?force=1" : "")).catch(e => ({ error: e.message, list: [] }));
  if (!document.getElementById("connCard")) return;
  const row = (label, name) => { const it = c.list?.find(x => x.name === name); return `<div class="row"><span class="dot ${it?.ok ? "good" : name ? "unknown" : "risk"}"></span><b style="min-width:80px">${label}</b><span class="small ${name ? "" : "muted"}">${name ? esc(name) + (it ? ` · ${esc(it.status)}` : "") : "not found"}</span></div>`; };
  box.innerHTML = `${row("Gmail", c.email)}${row("Calendar", c.calendar)}${c.error ? `<div class="small muted">${esc(c.error)}</div>` : ""}
    <div class="note blue small">Sending uses the <b>Gmail</b> and <b>Google Calendar</b> connectors on your Claude account (claude.ai → Settings → Connectors). Every email or calendar change waits in the <a href="#outbox">Outbox</a> until you press Approve. If Gmail's connector can only make drafts, LUTHUR saves a draft for you to send.</div>
    <div class="row end"><button type="button" class="btn" id="connCheck">Check connectors</button></div>`;
  document.getElementById("connCheck").onclick = () => connCardFill(true);
}
