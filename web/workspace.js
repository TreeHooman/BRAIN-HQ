// Workspace: every connected Google account (one per company) in one place. Mail and Drive (Sheets, Docs, Forms,
// Slides, PDFs), read-only. Switch accounts with the chips at the top, or pick "All" to see them merged.
// Email/file content is untrusted: it is always shown as escaped plain text (no HTML, no clickable links inside mail).
"use strict";
const WS = { st: null, el: null, list: null, msg: null, prev: null, folders: [], busy: false, manage: false, cmd: null, cmdAt: 0, seq: 0 };
const wsPref = (() => { try { return JSON.parse(hstore.get("hq-ws", "{}")) || {}; } catch { return {}; } })();
WS.acct = wsPref.acct || "all"; WS.tab = wsPref.tab === "drive" ? "drive" : "mail"; WS.box = wsPref.box || "inbox"; WS.kind = wsPref.kind || ""; WS.q = "";
const wsSave = () => hstore.set("hq-ws", JSON.stringify({ acct: WS.acct, tab: WS.tab, box: WS.box, kind: WS.kind }));
const wsAcc = id => WS.st?.accounts.find(a => a.id === id);
const wsDot = id => { const a = wsAcc(id); return `<i class="ws-dot" style="--c:${esc(a?.color || "#888")}" title="${esc(a ? a.label + " · " + a.email : "")}"></i>`; };
const wsWhen = ms => { if (!ms) return ""; const d = new Date(ms), n = new Date(); return d.toDateString() === n.toDateString() ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : `${d.getDate()} ${MON[d.getMonth()]}${d.getFullYear() !== n.getFullYear() ? " " + d.getFullYear() : ""}`; };
const wsFrom = f => String(f || "").replace(/<[^>]*>/g, "").replace(/"/g, "").trim() || String(f || "").replace(/[<>]/g, "");
const WS_KINDS = [["", "Recent"], ["sheets", "Sheets"], ["docs", "Docs"], ["forms", "Forms"], ["slides", "Slides"], ["pdfs", "PDFs"], ["folders", "Folders"], ["shared", "Shared with me"]];
const WS_TYPE = { "application/vnd.google-apps.spreadsheet": ["SHEET", "#34d399"], "application/vnd.google-apps.document": ["DOC", "#60a5fa"], "application/vnd.google-apps.form": ["FORM", "#a78bfa"], "application/vnd.google-apps.presentation": ["SLIDE", "#f59e0b"], "application/vnd.google-apps.folder": ["DIR", "#94a3b8"], "application/pdf": ["PDF", "#fb7185"] };
const wsType = m => WS_TYPE[m] || [/^image\//.test(m) ? "IMG" : /^video\//.test(m) ? "VID" : /csv|excel|spreadsheet/.test(m) ? "XLS" : "FILE", "#6c7581"];
const WS_EXT = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>`;

async function wsStatus() { WS.st = await api("/google").catch(() => WS.st); if (WS.st && WS.acct !== "all" && !wsAcc(WS.acct)) WS.acct = "all"; return WS.st; }

async function vWorkspace(el) {
  WS.el = el;
  // back from Google's sign-in page
  const back = String(route.arg || "").match(/^auth\?(ok|error)=(.*)$/);
  if (back) { history.replaceState(null, "", "#workspace"); route.arg = null; toast(back[1] === "ok" ? `${decodeURIComponent(back[2])} connected` : decodeURIComponent(back[2]), 6000); if (back[1] === "error") WS.manage = true; }
  const deep = String(route.arg || "").match(/^mail\/(g-[a-f0-9]{10})\/([A-Za-z0-9]{8,40})$/);
  await wsStatus();
  if (!WS.st) { el.innerHTML = `<h1>Workspace</h1><div class="card">LUTHUR server not reachable.</div>`; return; }
  if (deep) { WS.tab = "mail"; history.replaceState(null, "", "#workspace"); route.arg = null; }
  wsShell();
  if (!WS.st.configured || !WS.st.accounts.length) { WS.manage = true; wsManage(); return; }
  if (deep) wsOpenMail(deep[1], deep[2]);
  wsLoad();
}

function wsShell() {
  const st = WS.st, el = WS.el;
  el.innerHTML = `<div class="ws">
    <div class="ws-head"><h1>Workspace</h1>
      ${st.accounts.length ? `<div class="ws-tabs" role="tablist"><button type="button" data-tab="mail" class="${WS.tab === "mail" ? "on" : ""}">Mail</button><button type="button" data-tab="drive" class="${WS.tab === "drive" ? "on" : ""}">Drive</button></div>` : ""}
      <button type="button" class="btn sm ghost ws-mgbtn ${WS.manage ? "on" : ""}" id="wsMg">${st.accounts.length ? "Accounts" : "Setup"}</button></div>
    ${st.accounts.length ? `<div class="ws-accts">${[{ id: "all", label: "All", color: "", email: `${st.accounts.length} account${st.accounts.length > 1 ? "s" : ""}` }, ...st.accounts].map(a =>
      `<button type="button" class="ws-chip ${WS.acct === a.id ? "on" : ""} ${a.ok === false ? "bad" : ""}" data-acct="${esc(a.id)}" style="--c:${esc(a.color || "var(--accent)")}">${a.id === "all" ? "" : `<i class="ws-dot"></i>`}<b>${esc(a.label)}</b><small>${a.ok === false ? "reconnect" : esc(a.email)}</small></button>`).join("")}</div>` : ""}
    <div id="wsMgBox"></div><div id="wsBody"></div></div>`;
  el.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { WS.tab = b.dataset.tab; WS.q = ""; WS.folders = []; wsSave(); wsShell(); wsLoad(); });
  el.querySelectorAll("[data-acct]").forEach(b => b.onclick = () => { WS.acct = b.dataset.acct; WS.folders = []; wsSave(); el.querySelectorAll("[data-acct]").forEach(x => x.classList.toggle("on", x === b)); wsLoad(); });
  el.querySelector("#wsMg").onclick = () => { WS.manage = !WS.manage; el.querySelector("#wsMg").classList.toggle("on", WS.manage); wsManage(); };
  if (WS.manage) wsManage();
}

// ---------------- accounts + setup ----------------
function wsManage() {
  const box = document.getElementById("wsMgBox"); if (!box) return;
  if (!WS.manage) { box.innerHTML = ""; return; }
  const st = WS.st, here = onPC();
  const steps = `<ol class="ws-steps">
    <li>Open <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noopener noreferrer">Google Cloud → New project</a>, name it <b>LUTHUR</b>, press <b>Create</b>. Free; no billing needed.</li>
    <li>Turn on 3 APIs (open each, press <b>Enable</b>): <a href="https://console.cloud.google.com/apis/library/gmail.googleapis.com" target="_blank" rel="noopener noreferrer">Gmail API</a>, <a href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noopener noreferrer">Google Drive API</a>, <a href="https://console.cloud.google.com/apis/library/sheets.googleapis.com" target="_blank" rel="noopener noreferrer">Google Sheets API</a>.</li>
    <li>Open <a href="https://console.cloud.google.com/auth/overview" target="_blank" rel="noopener noreferrer">Google Auth Platform</a> → <b>Get started</b>. App name <b>LUTHUR</b>, your email, Audience <b>External</b>, finish.</li>
    <li>Go to <b>Audience</b> → <b>Publish app</b> → Confirm. (If you leave it in “Testing”, Google signs you out every 7 days.)</li>
    <li>Go to <b>Clients</b> → <b>Create client</b> → Application type <b>Desktop app</b>, name <b>LUTHUR</b> → <b>Create</b>. Copy the <b>Client ID</b> and <b>Client secret</b> into the boxes below.</li></ol>`;
  const rows = st.accounts.map(a => `<div class="ws-acc" data-id="${esc(a.id)}">
      <i class="ws-dot" style="--c:${esc(a.color)}"></i>
      <input class="ws-lbl" value="${esc(a.label)}" maxlength="24" aria-label="Label for ${esc(a.email)}">
      <span class="ws-mail">${esc(a.email)}${a.ok ? "" : ` <b class="ws-warn">signed out</b>`}</span>
      <span class="ws-sw">${PC.map(c => `<button type="button" data-c="${c}" style="--c:${c}" class="${c === a.color ? "on" : ""}" aria-label="Colour"></button>`).join("")}</span>
      <button type="button" class="btn sm ghost" data-re ${here ? "" : "disabled"}>${a.ok ? "Reconnect" : "Sign in again"}</button>
      <button type="button" class="btn sm ghost danger" data-rm>Remove</button></div>`).join("");
  box.innerHTML = `<div class="card ws-mg">
    ${!st.configured ? `<div class="ws-mg-h"><b>Connect Google accounts</b><span class="small muted">One-time setup, about 10 minutes. After that, adding each company's account takes 20 seconds.</span></div>${steps}
      <div class="ws-grid2"><label class="f">Client ID<input id="wsCid" placeholder="…apps.googleusercontent.com" autocomplete="off" spellcheck="false" maxlength="120"></label>
      <label class="f">Client secret<input id="wsSec" type="password" placeholder="GOCSPX-…" autocomplete="off" spellcheck="false" maxlength="90"></label></div>
      <div class="row end"><button type="button" class="btn primary" id="wsSaveC">Save</button></div>`
    : `<div class="ws-mg-h"><b>Accounts</b><span class="small muted">Label each one by company. The colour marks its mail and files everywhere in LUTHUR.</span></div>
      ${rows || `<div class="small muted">No accounts yet.</div>`}
      ${here ? "" : `<div class="note amber small">Add and reconnect accounts on the PC (http://127.0.0.1:8800). Google only sends sign-ins back there. After that they work on your phone too.</div>`}
      <div class="row end"><button type="button" class="btn ghost sm" id="wsResetC">Change Client ID</button><button type="button" class="btn primary" id="wsAdd" ${here ? "" : "disabled"}>+ Add Google account</button></div>
      <div class="small muted">On Google's page: pick the account, then if it says <b>“Google hasn't verified this app”</b> press <b>Advanced → Go to LUTHUR</b> (it's your own app). Tick every box. Company (Workspace) accounts: if it's blocked, the company's Google admin must allow your Client ID.</div>`}
    <div class="note blue small">Read-only: LUTHUR can see mail and files but can't send, edit, share or delete anything. Sign-in keys stay on this PC in <code>config/hq.local.json</code>. Remove an account here, or any time at myaccount.google.com/permissions.</div></div>`;
  const $w = id => document.getElementById(id);
  if ($w("wsSaveC")) $w("wsSaveC").onclick = async () => { try { await api("/google/client", "POST", { clientId: $w("wsCid").value, clientSecret: $w("wsSec").value }); toast("Saved. Now add your accounts."); await wsStatus(); wsShell(); } catch (e) { toast(e.message, 5000); } };
  if ($w("wsResetC")) $w("wsResetC").onclick = () => { WS.st.configured = false; wsManage(); };
  if ($w("wsAdd")) $w("wsAdd").onclick = () => wsLogin();
  box.querySelectorAll(".ws-acc").forEach(r => {
    const id = r.dataset.id, inp = r.querySelector(".ws-lbl");
    inp.onchange = async () => { await api(`/google/acct/${id}`, "PUT", { label: inp.value }).catch(e => toast(e.message)); await wsStatus(); wsShell(); wsLoad(); };
    r.querySelectorAll("[data-c]").forEach(b => b.onclick = async () => { await api(`/google/acct/${id}`, "PUT", { color: b.dataset.c }).catch(e => toast(e.message)); await wsStatus(); wsShell(); wsLoad(); });
    r.querySelector("[data-re]").onclick = () => wsLogin(id);
    r.querySelector("[data-rm]").onclick = async () => { const a = wsAcc(id); if (!confirm(`Remove ${a.label} (${a.email}) from LUTHUR?`)) return; await api(`/google/acct/${id}`, "DELETE").catch(e => toast(e.message)); if (WS.acct === id) WS.acct = "all"; await wsStatus(); wsShell(); wsLoad(); };
  });
}
async function wsLogin(reconnect) { try { const { url } = await api("/google/login", "POST", reconnect ? { reconnect } : {}); location.href = url; } catch (e) { toast(e.message, 5000); } }

// ---------------- lists ----------------
function wsErrors(errs) { return (errs || []).map(e => `<div class="ws-err">${wsDot(e.acct)}<b>${esc(wsAcc(e.acct)?.label || "")}</b> ${esc(e.error)}</div>`).join(""); }

async function wsLoad() {
  const body = document.getElementById("wsBody"); if (!body || !WS.st?.accounts.length) { if (body) body.innerHTML = ""; return; }
  const seq = ++WS.seq;
  if (WS.tab === "mail") {
    body.innerHTML = `<div class="ws-bar">
        <select id="wsBox" aria-label="Folder">${[["inbox", "Inbox"], ["unread", "Unread"], ["starred", "Starred"], ["sent", "Sent"], ["any", "All mail"]].map(([k, l]) => `<option value="${k}" ${WS.box === k ? "selected" : ""}>${l}</option>`).join("")}</select>
        <input id="wsQ" type="search" placeholder="Search mail (Gmail search works: from:  has:attachment  invoice)" value="${esc(WS.q)}" maxlength="200">
        <button type="button" class="btn sm ghost" id="wsRef">Refresh</button></div>
      <div class="ws-split ${WS.msg ? "reading" : ""}"><div class="ws-list" id="wsList"><div class="ws-empty">Loading…</div></div><div class="ws-read" id="wsRead">${WS.msg ? "" : `<div class="ws-empty">Pick an email.</div>`}</div></div>`;
    body.querySelector("#wsBox").onchange = e => { WS.box = e.target.value; wsSave(); wsLoad(); };
  } else {
    const crumbs = WS.folders.length ? `<div class="ws-crumb"><button type="button" data-crumb="-1">${esc(wsAcc(WS.acct)?.label || "Drive")}</button>${WS.folders.map((f, i) => `<span>›</span><button type="button" data-crumb="${i}">${esc(f.name)}</button>`).join("")}</div>` : "";
    body.innerHTML = `<div class="ws-bar"><div class="ws-kinds">${WS_KINDS.map(([k, l]) => `<button type="button" data-kind="${k}" class="${WS.kind === k && !WS.folders.length ? "on" : ""}">${l}</button>`).join("")}</div>
        <input id="wsQ" type="search" placeholder="Search files and contents" value="${esc(WS.q)}" maxlength="120">
        <button type="button" class="btn sm ghost" id="wsRef">Refresh</button></div>${crumbs}
      <div class="ws-split ${WS.prev ? "reading" : ""}"><div class="ws-list" id="wsList"><div class="ws-empty">Loading…</div></div><div class="ws-read" id="wsRead">${WS.prev ? "" : `<div class="ws-empty">Pick a file to preview it here, or ${WS_EXT} to open it in Google.</div>`}</div></div>`;
    body.querySelectorAll("[data-kind]").forEach(b => b.onclick = () => { WS.kind = b.dataset.kind; WS.folders = []; WS.q = ""; wsSave(); wsLoad(); });
    body.querySelectorAll("[data-crumb]").forEach(b => b.onclick = () => { WS.folders = WS.folders.slice(0, Number(b.dataset.crumb) + 1); wsLoad(); });
  }
  const q = body.querySelector("#wsQ"); let t = 0;
  q.oninput = () => { clearTimeout(t); t = setTimeout(() => { WS.q = q.value.trim(); wsFetch(); }, 450); };
  q.onkeydown = e => { if (e.key === "Enter") { clearTimeout(t); WS.q = q.value.trim(); wsFetch(); } };
  body.querySelector("#wsRef").onclick = () => wsFetch(true);
  if (WS.msg && WS.tab === "mail") wsPaintMail(); if (WS.prev && WS.tab === "drive") wsPaintPrev();
  if (seq === WS.seq) wsFetch();
}

async function wsFetch(force) {
  const box = document.getElementById("wsList"); if (!box) return;
  const seq = ++WS.seq, folder = WS.folders.at(-1)?.id || "";
  const url = WS.tab === "mail" ? `/google/mail?${new URLSearchParams({ acct: WS.acct, q: WS.q, box: WS.box, ...(force ? { fresh: "1" } : {}) })}`
    : `/google/drive?${new URLSearchParams({ acct: WS.acct, q: WS.q, kind: folder ? "" : WS.kind, folder })}`;
  box.classList.add("dim");
  const r = await api(url).catch(e => ({ items: [], errors: [{ acct: WS.acct, error: e.message }] }));
  if (seq !== WS.seq || !document.getElementById("wsList")) return;
  WS.list = r; box.classList.remove("dim"); wsPaintList(r, folder);
}
function wsPaintList(r, folder) {
  const box = document.getElementById("wsList"); if (!box) return;
  box.innerHTML = wsErrors(r.errors) + (WS.tab === "mail" ? wsMailRows(r.items) : wsFileRows(r.items)) + (r.next ? `<button type="button" class="btn sm ghost ws-more" id="wsMore">Load more</button>` : "");
  box.querySelectorAll("[data-m]").forEach(b => b.onclick = () => { const [a, id] = b.dataset.m.split("/"); b.classList.remove("unread"); wsOpenMail(a, id); });
  box.querySelectorAll("[data-f]").forEach(b => b.onclick = e => { if (e.target.closest("a")) return; wsOpenFile(r.items[Number(b.dataset.f)]); });
  box.querySelector("#wsMore")?.addEventListener("click", async e => {
    e.target.disabled = true; const seq = WS.seq;
    const more = await api(`/google/drive?${new URLSearchParams({ acct: WS.acct, q: WS.q, kind: folder ? "" : WS.kind, folder, page: r.next })}`).catch(err => { toast(err.message); return null; });
    if (more && seq === WS.seq) { r.items.push(...more.items); r.next = more.next; wsPaintList(r, folder); }
  });
}

function wsMailRows(items) {
  if (!items.length) return `<div class="ws-empty">${WS.q ? "No emails match." : "Nothing here."}</div>`;
  return items.map(m => `<button type="button" class="ws-row ws-mrow ${m.unread ? "unread" : ""} ${WS.msg?.id === m.id ? "on" : ""}" data-m="${esc(m.acct)}/${esc(m.id)}" style="--c:${esc(wsAcc(m.acct)?.color || "#888")}">
      <div class="ws-r1">${wsDot(m.acct)}<b>${esc(wsFrom(m.from)).slice(0, 60)}</b><span>${esc(wsWhen(m.date))}</span></div>
      <div class="ws-r2">${m.important && m.unread ? `<i class="ws-imp">!</i>` : ""}${esc(m.subject)}</div><small>${esc(m.snippet)}</small></button>`).join("");
}
function wsFileRows(items) {
  if (!items.length) return `<div class="ws-empty">${WS.q ? "No files match." : WS.folders.length ? "This folder is empty." : "No files here."}</div>`;
  return items.map((f, i) => { const [t, c] = wsType(f.mime); return `<div class="ws-row ws-frow ${WS.prev?.file?.id === f.id ? "on" : ""}" data-f="${i}" role="button" tabindex="0" style="--c:${esc(wsAcc(f.acct)?.color || "#888")}">
      <span class="ws-ft" style="--t:${c}">${t}</span>
      <div class="ws-fn"><b>${esc(f.name)}</b><small>${wsDot(f.acct)}${esc(wsAcc(f.acct)?.label || "")}${f.modified ? " · " + esc(ago(f.modified)) : ""}${f.owner && f.owner !== "me" ? " · " + esc(f.owner) : ""}</small></div>
      ${f.link ? `<a class="ws-open" href="${esc(f.link)}" target="_blank" rel="noopener noreferrer" title="Open in Google">${WS_EXT}</a>` : ""}</div>`; }).join("");
}

// ---------------- reading ----------------
async function wsOpenMail(acct, id) {
  WS.msg = { id, acct, loading: true }; wsSplit(true); wsPaintMail();
  document.querySelectorAll(".ws-mrow").forEach(r => r.classList.toggle("on", r.dataset.m === `${acct}/${id}`));
  const m = await api(`/google/mail/${acct}/${id}`).catch(e => ({ id, acct, error: e.message }));
  if (WS.msg?.id !== id) return;
  WS.msg = m; wsPaintMail();
}
function wsPaintMail() {
  const el = document.getElementById("wsRead"), m = WS.msg; if (!el || !m) return;
  const a = wsAcc(m.acct);
  if (m.loading) { el.innerHTML = `<div class="ws-empty">Opening…</div>`; return; }
  if (m.error) { el.innerHTML = `<div class="ws-rh"><button type="button" class="btn sm ghost ws-back">‹ Back</button></div><div class="ws-err">${esc(m.error)}</div>`; }
  else el.innerHTML = `<div class="ws-rh"><button type="button" class="btn sm ghost ws-back">‹ Back</button><span class="ws-acctag" style="--c:${esc(a?.color || "#888")}"><i class="ws-dot"></i>${esc(a?.label || "")}</span><a class="btn sm ghost" href="${esc(m.link)}" target="_blank" rel="noopener noreferrer">Open in Gmail ${WS_EXT}</a></div>
    <div class="ws-subj">${esc(m.subject)}</div>
    <div class="ws-meta"><div><span>From</span>${esc(m.from)}</div>${m.to ? `<div><span>To</span>${esc(m.to)}</div>` : ""}${m.cc ? `<div><span>Cc</span>${esc(m.cc)}</div>` : ""}<div><span>Date</span>${esc(new Date(m.date).toLocaleString())}</div></div>
    ${m.files?.length ? `<div class="ws-files">${m.files.map(f => `<span>${esc(f.name)}${f.size ? ` <small>${f.size > 1e6 ? (f.size / 1e6).toFixed(1) + " MB" : Math.ceil(f.size / 1e3) + " KB"}</small>` : ""}</span>`).join("")}</div>` : ""}
    <pre class="ws-text">${esc(m.body || "(no text)")}</pre>`;
  el.querySelector(".ws-back").onclick = () => { WS.msg = null; wsSplit(false); el.innerHTML = `<div class="ws-empty">Pick an email.</div>`; document.querySelectorAll(".ws-mrow.on").forEach(r => r.classList.remove("on")); };
}
function wsSplit(on) { document.querySelector(".ws-split")?.classList.toggle("reading", on); if (on && matchMedia("(max-width: 760px)").matches) window.scrollTo({ top: 0 }); }

async function wsOpenFile(f, tab) {
  if (!f) return;
  if (f.mime === "application/vnd.google-apps.folder") {
    if (WS.acct === "all") { WS.acct = f.acct; wsSave(); document.querySelectorAll("[data-acct]").forEach(x => x.classList.toggle("on", x.dataset.acct === f.acct)); }
    WS.folders.push({ id: f.id, name: f.name }); WS.q = ""; WS.prev = null; wsLoad(); return;
  }
  WS.prev = { file: f, loading: true }; wsSplit(true); wsPaintPrev();
  document.querySelectorAll(".ws-frow").forEach(r => r.classList.toggle("on", WS.list?.items[Number(r.dataset.f)]?.id === f.id));
  const p = await api(`/google/preview/${f.acct}/${f.id}${tab ? "?tab=" + encodeURIComponent(tab) : ""}`).catch(e => ({ file: f, kind: "error", error: e.message }));
  if (WS.prev?.file?.id !== f.id) return;
  p.file = { ...f, ...p.file, acct: f.acct }; WS.prev = p; wsPaintPrev();
}
function wsPaintPrev() {
  const el = document.getElementById("wsRead"), p = WS.prev; if (!el || !p) return;
  const f = p.file, a = wsAcc(f.acct), [t, c] = wsType(f.mime);
  const head = `<div class="ws-rh"><button type="button" class="btn sm ghost ws-back">‹ Back</button><span class="ws-acctag" style="--c:${esc(a?.color || "#888")}"><i class="ws-dot"></i>${esc(a?.label || "")}</span>${f.link ? `<a class="btn sm primary" href="${esc(f.link)}" target="_blank" rel="noopener noreferrer">Open in Google ${WS_EXT}</a>` : ""}</div>
    <div class="ws-subj"><span class="ws-ft" style="--t:${c}">${t}</span>${esc(f.name)}</div>`;
  let inner = "";
  if (p.loading) inner = `<div class="ws-empty">Loading preview…</div>`;
  else if (p.kind === "error") inner = `<div class="ws-err">${esc(p.error)}</div>`;
  else if (p.kind === "sheet") {
    const rows = p.rows || [], w = Math.max(1, ...rows.map(r => r.length));
    const col = i => { let s = ""; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
    inner = `${p.tabs?.length > 1 ? `<div class="ws-stabs">${p.tabs.map(x => `<button type="button" data-st="${esc(x)}" class="${x === p.tab ? "on" : ""}">${esc(x)}</button>`).join("")}</div>` : ""}
      ${p.note ? `<div class="small muted">${esc(p.note)}</div>` : ""}
      ${rows.length ? `<div class="ws-sheet"><table><thead><tr><th></th>${Array.from({ length: w }, (_, i) => `<th>${col(i)}</th>`).join("")}</tr></thead><tbody>${rows.map((r, i) => `<tr><th>${i + 1}</th>${Array.from({ length: w }, (_, j) => `<td>${esc(r[j] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : `<div class="ws-empty">This tab is empty.</div>`}
      ${p.cut ? `<div class="small muted">Showing the first 500 rows. Open in Google for the rest.</div>` : ""}`;
  } else if (p.kind === "text") inner = `<pre class="ws-text">${esc(p.text || "(empty)")}</pre>`;
  else inner = `<div class="ws-empty">${f.mime === "application/vnd.google-apps.form" ? "Forms open in Google. Responses are on the form's <b>Responses</b> tab (and in its linked Sheet, which you can preview here)." : "No preview for this type."}${f.link ? `<br><br><a class="btn primary" href="${esc(f.link)}" target="_blank" rel="noopener noreferrer">Open in Google ${WS_EXT}</a>` : ""}</div>`;
  el.innerHTML = head + inner;
  el.querySelector(".ws-back").onclick = () => { WS.prev = null; wsSplit(false); el.innerHTML = `<div class="ws-empty">Pick a file to preview it here.</div>`; document.querySelectorAll(".ws-frow.on").forEach(r => r.classList.remove("on")); };
  el.querySelectorAll("[data-st]").forEach(b => b.onclick = () => wsOpenFile(f, b.dataset.st));
}
document.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.classList?.contains("ws-frow")) e.target.click(); });

// ---------------- Command screen inbox: all Google accounts, no Claude runs ----------------
async function wsCmdMail(force) {
  if (!WS.st) await wsStatus();
  if (!WS.st?.accounts?.length) return false;
  if (!force && WS.cmd && Date.now() - WS.cmdAt < 90e3) return true;
  WS.cmdAt = Date.now();
  WS.cmd = await api("/google/mail?acct=all&box=inbox").catch(e => ({ items: WS.cmd?.items || [], errors: [{ acct: "all", error: e.message }] }));
  return true;
}
const _inboxHTMLws = inboxHTML;
inboxHTML = function () {
  if (!WS.st?.accounts?.length) return _inboxHTMLws();
  const m = WS.cmd;
  if (!m) return `<div class="card nv-panel" id="nvMail"><div class="ttl">Inbox</div><div class="nv-empty">Loading…</div></div>`;
  const unread = m.items.filter(x => x.unread).length;
  const rows = m.items.slice(0, 7).map(x => `<a class="nv-row ml-row ${x.unread ? "unread" : ""}" href="#workspace/mail/${esc(x.acct)}/${esc(x.id)}" style="--c:${esc(wsAcc(x.acct)?.color || "#888")}">${wsDot(x.acct)}<div style="min-width:0"><div class="t"><b>${esc(wsFrom(x.from)).slice(0, 40)}</b>${esc(x.subject)}</div><small>${esc(wsAcc(x.acct)?.label || "")} · ${esc(x.snippet).slice(0, 90)} · ${esc(wsWhen(x.date))}</small></div></a>`).join("");
  return `<div class="card nv-panel" id="nvMail"><div class="ttl">Inbox <b>${unread ? unread + " unread" : m.items.length ? "read" : ""}</b></div>
    ${(m.errors || []).length ? `<div class="nv-empty" style="color:var(--amber)">${esc(m.errors.map(e => (wsAcc(e.acct)?.label ? wsAcc(e.acct).label + ": " : "") + e.error).join(" · ")).slice(0, 220)}</div>` : ""}
    ${rows || `<div class="nv-empty">Inbox clear.</div>`}
    <div class="ml-foot"><span>${WS.st.accounts.length} account${WS.st.accounts.length > 1 ? "s" : ""}</span><a class="btn sm ghost" href="#workspace">Open Workspace</a></div></div>`;
};
const _cmdFillWs = cmdFill;
cmdFill = function (q) {
  _cmdFillWs(q);
  wsCmdMail().then(on => { if (on && route.view === "command") cmdExtras(); });
};

const _renderWs = render;
render = function () {
  if (route.view === "workspace" && render.background) return; // the page loads its own data; don't wipe it on the 6s refresh
  _renderWs();
};
