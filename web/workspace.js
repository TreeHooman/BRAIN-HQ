// Workspace: every connected Google account (one per company) in one place. Mail and Drive (Sheets, Docs, Forms,
// Slides, PDFs). Switch accounts with the chips at the top, or pick "All" to see them merged. Accounts are read-only
// until "Allow writing" is turned on for them; then: compose/reply (always through the Outbox: you press Send),
// new Docs/Sheets, edit Sheet cells, add to / find-and-replace in Docs (each confirmed first).
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

async function wsStatus() { WS.st = await api("/google").catch(e => { WS.err = e.message; return WS.st; }); if (WS.st && WS.acct !== "all" && !wsAcc(WS.acct)) WS.acct = "all"; return WS.st; }

async function vWorkspace(el) {
  WS.el = el;
  // back from Google's sign-in page
  const back = String(route.arg || "").match(/^auth\?(ok|error)=(.*)$/);
  if (back) { history.replaceState(null, "", "#workspace"); route.arg = null; toast(back[1] === "ok" ? `${decodeURIComponent(back[2])} connected` : decodeURIComponent(back[2]), 6000); if (back[1] === "error") WS.manage = true; }
  const deep = String(route.arg || "").match(/^mail\/(g-[a-f0-9]{10})\/([A-Za-z0-9]{8,40})$/);
  await wsStatus();
  if (!WS.st) { el.innerHTML = `<h1>Workspace</h1><div class="card">${/no such endpoint/i.test(WS.err || "") ? "LUTHUR is still running the old version. Run <b>scripts\\STOP-HQ.cmd</b>, then <b>scripts\\START-HQ.cmd</b>, then press Ctrl+F5." : "LUTHUR server not reachable" + (WS.err ? ": " + esc(WS.err) : ".")}</div>`; return; }
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
    <li>Turn on 5 APIs (open each, press <b>Enable</b>): <a href="https://console.cloud.google.com/apis/library/gmail.googleapis.com" target="_blank" rel="noopener noreferrer">Gmail API</a>, <a href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noopener noreferrer">Google Drive API</a>, <a href="https://console.cloud.google.com/apis/library/sheets.googleapis.com" target="_blank" rel="noopener noreferrer">Google Sheets API</a>, <a href="https://console.cloud.google.com/apis/library/docs.googleapis.com" target="_blank" rel="noopener noreferrer">Google Docs API</a>, <a href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com" target="_blank" rel="noopener noreferrer">Google Calendar API</a>.</li>
    <li>Open <a href="https://console.cloud.google.com/auth/overview" target="_blank" rel="noopener noreferrer">Google Auth Platform</a> → <b>Get started</b>. App name <b>LUTHUR</b>, your email, Audience <b>External</b>, finish.</li>
    <li>Go to <b>Audience</b> → <b>Publish app</b> → Confirm. (If you leave it in “Testing”, Google signs you out every 7 days.)</li>
    <li>Go to <b>Clients</b> → <b>Create client</b> → Application type <b>Desktop app</b>, name <b>LUTHUR</b> → <b>Create</b>. Copy the <b>Client ID</b> and <b>Client secret</b> into the boxes below.</li></ol>`;
  const rows = st.accounts.map(a => `<div class="ws-acc" data-id="${esc(a.id)}">
      <i class="ws-dot" style="--c:${esc(a.color)}"></i>
      <input class="ws-lbl" value="${esc(a.label)}" maxlength="24" aria-label="Label for ${esc(a.email)}">
      <span class="ws-mail">${esc(a.email)}${a.ok ? "" : ` <b class="ws-warn">signed out</b>`}${a.write ? ` <b class="ws-wr">writing on</b>` : ""}${a.ok && !a.cal ? ` <b class="ws-warn">calendar off: press Reconnect</b>` : ""}</span>
      <span class="ws-sw">${PC.map(c => `<button type="button" data-c="${c}" style="--c:${c}" class="${c === a.color ? "on" : ""}" aria-label="Colour"></button>`).join("")}</span>
      ${a.write ? "" : `<button type="button" class="btn sm" data-wr ${here ? "" : "disabled"} title="Send email (after you approve), create and edit Docs and Sheets">Allow writing</button>`}
      <button type="button" class="btn sm ghost" data-re ${here ? "" : "disabled"}>${a.ok ? "Reconnect" : "Sign in again"}</button>
      <button type="button" class="btn sm ghost danger" data-rm>Remove</button></div>`).join("");
  box.innerHTML = `<div class="card ws-mg">
    ${!st.configured ? `<div class="ws-mg-h"><b>Connect Google accounts</b><span class="small muted">One-time setup, about 10 minutes. After that, adding each company's account takes 20 seconds.</span></div>${steps}
      <div class="ws-grid2"><label class="f">Client ID<input id="wsCid" placeholder="…apps.googleusercontent.com" autocomplete="off" spellcheck="false" maxlength="120"></label>
      <label class="f">Client secret<input id="wsSec" type="text" class="masked" placeholder="GOCSPX-…" autocomplete="new-password" data-lpignore="true" data-1p-ignore spellcheck="false" maxlength="90"></label></div>
      <div class="row end"><button type="button" class="btn primary" id="wsSaveC">Save</button></div>`
    : `<div class="ws-mg-h"><b>Accounts</b><span class="small muted">Label each one by company. The colour marks its mail and files everywhere in LUTHUR.</span></div>
      ${rows || `<div class="small muted">No accounts yet.</div>`}
      ${here ? "" : `<div class="note amber small">Add and reconnect accounts on the PC (http://127.0.0.1:8800). Google only sends sign-ins back there. After that they work on your phone too.</div>`}
      <div class="row end"><button type="button" class="btn ghost sm" id="wsResetC">Change Client ID</button><button type="button" class="btn primary" id="wsAdd" ${here ? "" : "disabled"}>+ Add Google account</button></div>
      <div class="small muted">On Google's page: pick the account, then if it says <b>“Google hasn't verified this app”</b> press <b>Advanced → Go to LUTHUR</b> (it's your own app). Tick every box. Company (Workspace) accounts: if it's blocked, the company's Google admin must allow your Client ID.</div>`}
    <div class="note blue small">Accounts start read-only. <b>Allow writing</b> lets LUTHUR send email (only after you press Send in the Outbox) and create/edit Docs and Sheets (only when you confirm). It can never delete mail or files, or share anything. Sign-in keys stay on this PC in <code>config/hq.local.json</code>. Remove an account here, or any time at myaccount.google.com/permissions.</div></div>`;
  const $w = id => document.getElementById(id);
  if ($w("wsSaveC")) $w("wsSaveC").onclick = async () => { try { await api("/google/client", "POST", { clientId: $w("wsCid").value, clientSecret: $w("wsSec").value }); toast("Saved. Now add your accounts."); await wsStatus(); wsShell(); } catch (e) { toast(e.message, 5000); } };
  if ($w("wsResetC")) $w("wsResetC").onclick = () => { WS.st.configured = false; wsManage(); };
  if ($w("wsAdd")) $w("wsAdd").onclick = () => wsLogin();
  box.querySelectorAll(".ws-acc").forEach(r => {
    const id = r.dataset.id, inp = r.querySelector(".ws-lbl");
    inp.onchange = async () => { await api(`/google/acct/${id}`, "PUT", { label: inp.value }).catch(e => toast(e.message)); await wsStatus(); wsShell(); wsLoad(); };
    r.querySelectorAll("[data-c]").forEach(b => b.onclick = async () => { await api(`/google/acct/${id}`, "PUT", { color: b.dataset.c }).catch(e => toast(e.message)); await wsStatus(); wsShell(); wsLoad(); });
    r.querySelector("[data-re]").onclick = () => wsLogin(id, a => a.write);
    r.querySelector("[data-wr]")?.addEventListener("click", () => wsLogin(id, () => true));
    r.querySelector("[data-rm]").onclick = async () => { const a = wsAcc(id); if (!confirm(`Remove ${a.label} (${a.email}) from LUTHUR?`)) return; await api(`/google/acct/${id}`, "DELETE").catch(e => toast(e.message)); if (WS.acct === id) WS.acct = "all"; await wsStatus(); wsShell(); wsLoad(); };
  });
}
async function wsLogin(reconnect, write) { try { const a = reconnect && wsAcc(reconnect); const { url } = await api("/google/login", "POST", { ...(reconnect ? { reconnect } : {}), write: !!(a && write?.(a)) }); location.href = url; } catch (e) { toast(e.message, 5000); } }

// ---------------- lists ----------------
function wsErrors(errs) { return (errs || []).map(e => `<div class="ws-err">${wsDot(e.acct)}<b>${esc(wsAcc(e.acct)?.label || "")}</b> ${esc(e.error)}</div>`).join(""); }

async function wsLoad() {
  const body = document.getElementById("wsBody"); if (!body || !WS.st?.accounts.length) { if (body) body.innerHTML = ""; return; }
  const seq = ++WS.seq;
  if (WS.tab === "mail") {
    body.innerHTML = `<div class="ws-bar">
        <select id="wsBox" aria-label="Folder">${[["inbox", "Inbox"], ["unread", "Unread"], ["starred", "Starred"], ["sent", "Sent"], ["any", "All mail"]].map(([k, l]) => `<option value="${k}" ${WS.box === k ? "selected" : ""}>${l}</option>`).join("")}</select>
        <input id="wsQ" type="search" placeholder="Search mail (Gmail search works: from:  has:attachment  invoice)" value="${esc(WS.q)}" maxlength="200">
        <button type="button" class="btn sm ghost" id="wsRef">Refresh</button>${wsWriters().length ? `<button type="button" class="btn sm primary" id="wsNew">Compose</button>` : ""}</div>
      <div class="ws-split ${WS.msg ? "reading" : ""}"><div class="ws-list" id="wsList"><div class="ws-empty">Loading…</div></div><div class="ws-read" id="wsRead">${WS.msg ? "" : `<div class="ws-empty">Pick an email.</div>`}</div></div>`;
    body.querySelector("#wsBox").onchange = e => { WS.box = e.target.value; wsSave(); wsLoad(); };
  } else {
    const crumbs = WS.folders.length ? `<div class="ws-crumb"><button type="button" data-crumb="-1">${esc(wsAcc(WS.acct)?.label || "Drive")}</button>${WS.folders.map((f, i) => `<span>›</span><button type="button" data-crumb="${i}">${esc(f.name)}</button>`).join("")}</div>` : "";
    body.innerHTML = `<div class="ws-bar"><div class="ws-kinds">${WS_KINDS.map(([k, l]) => `<button type="button" data-kind="${k}" class="${WS.kind === k && !WS.folders.length ? "on" : ""}">${l}</button>`).join("")}</div>
        <input id="wsQ" type="search" placeholder="Search files and contents" value="${esc(WS.q)}" maxlength="120">
        <button type="button" class="btn sm ghost" id="wsRef">Refresh</button>${wsWriters().length ? `<button type="button" class="btn sm primary" id="wsNew">+ New</button>` : ""}</div>${crumbs}
      <div class="ws-split ${WS.prev ? "reading" : ""}"><div class="ws-list" id="wsList"><div class="ws-empty">Loading…</div></div><div class="ws-read" id="wsRead">${WS.prev ? "" : `<div class="ws-empty">Pick a file to preview it here, or ${WS_EXT} to open it in Google.</div>`}</div></div>`;
    body.querySelectorAll("[data-kind]").forEach(b => b.onclick = () => { WS.kind = b.dataset.kind; WS.folders = []; WS.q = ""; wsSave(); wsLoad(); });
    body.querySelectorAll("[data-crumb]").forEach(b => b.onclick = () => { WS.folders = WS.folders.slice(0, Number(b.dataset.crumb) + 1); wsLoad(); });
  }
  const q = body.querySelector("#wsQ"); let t = 0;
  q.oninput = () => { clearTimeout(t); t = setTimeout(() => { WS.q = q.value.trim(); wsFetch(); }, 450); };
  q.onkeydown = e => { if (e.key === "Enter") { clearTimeout(t); WS.q = q.value.trim(); wsFetch(); } };
  body.querySelector("#wsRef").onclick = () => wsFetch(true);
  body.querySelector("#wsNew")?.addEventListener("click", () => WS.tab === "mail" ? wsCompose({}) : wsNewFile());
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
  else el.innerHTML = `<div class="ws-rh"><button type="button" class="btn sm ghost ws-back">‹ Back</button><span class="ws-acctag" style="--c:${esc(a?.color || "#888")}"><i class="ws-dot"></i>${esc(a?.label || "")}</span>${m.write ? `<button type="button" class="btn sm primary" id="wsReply">Reply</button>` : ""}<a class="btn sm ghost" href="${esc(m.link)}" target="_blank" rel="noopener noreferrer">Open in Gmail ${WS_EXT}</a></div>
    <div class="ws-subj">${esc(m.subject)}</div>
    <div class="ws-meta"><div><span>From</span>${esc(m.from)}</div>${m.to ? `<div><span>To</span>${esc(m.to)}</div>` : ""}${m.cc ? `<div><span>Cc</span>${esc(m.cc)}</div>` : ""}<div><span>Date</span>${esc(new Date(m.date).toLocaleString())}</div></div>
    ${m.files?.length ? `<div class="ws-files">${m.files.map(f => `<span>${esc(f.name)}${f.size ? ` <small>${f.size > 1e6 ? (f.size / 1e6).toFixed(1) + " MB" : Math.ceil(f.size / 1e3) + " KB"}</small>` : ""}</span>`).join("")}</div>` : ""}
    <pre class="ws-text">${esc(m.body || "(no text)")}</pre>`;
  el.querySelector("#wsReply")?.addEventListener("click", () => wsReply(m));
  el.querySelector(".ws-back").onclick = () => { WS.msg = null; wsSplit(false); el.innerHTML = `<div class="ws-empty">Pick an email.</div>`; document.querySelectorAll(".ws-mrow.on").forEach(r => r.classList.remove("on")); };
}
function wsSplit(on) { document.querySelector(".ws-split")?.classList.toggle("reading", on); if (on && matchMedia("(max-width: 760px)").matches) window.scrollTo({ top: 0 }); }

async function wsOpenFile(f, tab) {
  if (!f) return;
  if (f.mime === "application/vnd.google-apps.folder") {
    if (WS.acct === "all") { WS.acct = f.acct; wsSave(); document.querySelectorAll("[data-acct]").forEach(x => x.classList.toggle("on", x.dataset.acct === f.acct)); }
    WS.folders.push({ id: f.id, name: f.name }); WS.q = ""; WS.prev = null; wsLoad(); return;
  }
  if (WS.prev?.file?.id !== f.id) WS.edit = false;
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
    const rows = [...(p.rows || [])], w = Math.max(1, ...rows.map(r => r.length)) + (WS.edit ? 1 : 0);
    if (WS.edit) rows.push(...Array.from({ length: 3 }, () => []));
    const col = i => { let s = ""; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
    inner = `${p.tabs?.length > 1 ? `<div class="ws-stabs">${p.tabs.map(x => `<button type="button" data-st="${esc(x)}" class="${x === p.tab ? "on" : ""}">${esc(x)}</button>`).join("")}</div>` : ""}
      ${p.note ? `<div class="small muted">${esc(p.note)}</div>` : ""}
      ${f.write ? `<div class="ws-edbar" id="wsEdBar">${WS.edit ? `<span id="wsEdN">No changes yet. Click a cell to type; =formulas work.</span><button type="button" class="btn sm ghost" id="wsEdX">Cancel</button><button type="button" class="btn sm primary" id="wsEdSave" disabled>Save changes</button>` : `<button type="button" class="btn sm" id="wsEdOn">Edit cells</button>`}</div>` : ""}
      ${rows.length || WS.edit ? `<div class="ws-sheet ${WS.edit ? "editing" : ""}"><table><thead><tr><th></th>${Array.from({ length: w }, (_, i) => `<th>${col(i)}</th>`).join("")}</tr></thead><tbody>${rows.map((r, i) => `<tr><th>${i + 1}</th>${Array.from({ length: w }, (_, j) => `<td${WS.edit ? ` contenteditable="plaintext-only" data-rc="${i},${j}"` : ""}>${esc(r[j] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : `<div class="ws-empty">This tab is empty.</div>`}
      ${p.cut ? `<div class="small muted">Showing the first 500 rows. Open in Google for the rest.</div>` : ""}`;
  } else if (p.kind === "pdf") inner = `<iframe class="ws-pdf" src="/api/google/raw/${esc(f.acct)}/${esc(f.id)}" title="${esc(f.name)}"></iframe>`;
  else if (p.kind === "image") inner = `<img class="ws-img" src="/api/google/raw/${esc(f.acct)}/${esc(f.id)}" alt="${esc(f.name)}">`;
  else if (p.kind === "text") inner = `${f.write && f.mime === "application/vnd.google-apps.document" ? `<div class="ws-edbar"><button type="button" class="btn sm" id="wsDocAdd">Add text at the end</button><button type="button" class="btn sm" id="wsDocRep">Find &amp; replace</button></div>` : ""}<pre class="ws-text">${esc(p.text || "(empty)")}</pre>`;
  else inner = `<div class="ws-empty">${f.mime === "application/vnd.google-apps.form" ? "Forms open in Google. Responses are on the form's <b>Responses</b> tab (and in its linked Sheet, which you can preview here)." : "LUTHUR can preview Sheets, Docs, Slides, PDFs, images and CSV/TXT files. This one (" + esc(wsType(f.mime)[0]) + ") opens in Google."}${f.link ? `<br><br><a class="btn primary" href="${esc(f.link)}" target="_blank" rel="noopener noreferrer">Open in Google ${WS_EXT}</a>` : ""}</div>`;
  el.innerHTML = head + inner;
  el.querySelector(".ws-back").onclick = () => { WS.prev = null; WS.edit = false; wsSplit(false); el.innerHTML = `<div class="ws-empty">Pick a file to preview it here.</div>`; document.querySelectorAll(".ws-frow.on").forEach(r => r.classList.remove("on")); };
  el.querySelectorAll("[data-st]").forEach(b => b.onclick = () => { if (WS.edit && Object.keys(WS.edits || {}).length && !confirm("Drop your unsaved cell changes?")) return; WS.edit = false; wsOpenFile(f, b.dataset.st); });
  if (p.kind === "sheet") wsSheetEdit(el, p);
  el.querySelector("#wsDocAdd")?.addEventListener("click", () => wsDocAdd(f));
  el.querySelector("#wsDocRep")?.addEventListener("click", () => wsDocRep(f));
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
  const ph = matchMedia("(max-width: 760px)").matches;
  const rows = m.items.slice(0, ph ? 3 : 7).map(x => `<a class="nv-row ml-row ${x.unread ? "unread" : ""}" href="#workspace/mail/${esc(x.acct)}/${esc(x.id)}" style="--c:${esc(wsAcc(x.acct)?.color || "#888")}">${wsDot(x.acct)}<div style="min-width:0"><div class="t"><b>${esc(wsFrom(x.from)).slice(0, 40)}</b>${esc(x.subject)}</div><small>${esc(wsAcc(x.acct)?.label || "")} · ${esc(x.snippet).slice(0, 90)} · ${esc(wsWhen(x.date))}</small></div></a>`).join("");
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

// ---------------- writing ----------------
const wsWriters = () => (WS.st?.accounts || []).filter(a => a.write && a.ok);
const wsAddr = s => (String(s || "").match(/[^\s<>"',;]+@[^\s<>"',;]+\.[a-z]{2,}/i) || [""])[0];
const wsMid = s => { const t = String(s || "").trim(); return /^<[^<>\s]{3,300}>$/.test(t) ? t : ""; };

/** Compose / reply. Always goes through the Outbox; "Send" is the approval. */
function wsCompose(d, outboxItem) {
  const ws = wsWriters();
  if (!ws.length) { toast("Turn on writing for an account first: Workspace → Accounts → Allow writing", 5000); return; }
  const from = d.from && ws.some(a => a.id === d.from) ? d.from : (WS.acct !== "all" && ws.some(a => a.id === WS.acct) ? WS.acct : ws[0].id);
  modal(`<h3>${outboxItem ? "Edit email" : d.threadId ? "Reply" : "New email"}</h3><form class="form ws-comp" id="wsComp">
    <label class="f">From<select name="from">${ws.map(a => `<option value="${esc(a.id)}" ${a.id === from ? "selected" : ""}>${esc(a.label)} · ${esc(a.email)}</option>`).join("")}</select></label>
    <label class="f">To (comma separated)<input name="to" value="${esc(d.to || "")}" required autocomplete="off"></label>
    <label class="f">Cc<input name="cc" value="${esc(d.cc || "")}" autocomplete="off"></label>
    <label class="f">Subject<input name="subject" value="${esc(d.subject || "")}" required maxlength="300"></label>
    <div class="ws-ai"><input id="wsAiQ" placeholder="Tell LUTHUR what to say, e.g. “yes, Thursday 2pm works, send the deck after”" maxlength="2000"><button type="button" class="btn sm" id="wsAiGo">Write with LUTHUR</button></div>
    <label class="f">Message<textarea name="body" rows="11" required>${esc(d.body || "")}</textarea></label>
    ${d.original ? `<details class="ws-orig"><summary>Original email</summary><pre class="ws-text">${esc(d.original.body).slice(0, 4000)}</pre></details>` : ""}
    <div class="row end"><button type="button" class="btn ghost" data-close>Cancel</button><button type="button" class="btn" id="wsToOb">${outboxItem ? "Save" : "Save to Outbox"}</button><button class="btn primary">Send</button></div></form>`);
  const form = document.getElementById("wsComp");
  const payload = () => { const f = Object.fromEntries(new FormData(form)); return { from: f.from, to: f.to, cc: f.cc, subject: f.subject, body: f.body, ...(d.threadId ? { threadId: d.threadId, inReplyTo: d.inReplyTo, references: d.references } : {}) }; };
  const save = async () => outboxItem ? (await api(`/outbox/${outboxItem.id}`, "PUT", { payload: payload() }), outboxItem) : api("/outbox", "POST", { kind: "email", payload: payload(), project: activeProject() || null });
  document.getElementById("wsAiGo").onclick = async e => {
    const q = document.getElementById("wsAiQ").value.trim(); if (!q) return toast("Type what the email should say");
    const b = e.target; b.disabled = true; b.textContent = "Writing…";
    try {
      const f = Object.fromEntries(new FormData(form));
      const r = await api("/google/write-ai", "POST", { instructions: q, from: f.from, to: f.to, subject: f.subject, draft: f.body, original: d.original || null });
      if (r.subject && !form.subject.value.trim()) form.subject.value = r.subject; else if (r.subject && !d.threadId) form.subject.value = r.subject;
      form.body.value = r.body + (d.quote ? "\n\n" + d.quote : "");
    } catch (err) { toast(err.message, 5000); }
    finally { b.disabled = false; b.textContent = "Write with LUTHUR"; }
  };
  document.getElementById("wsToOb").onclick = async () => { if (!form.reportValidity()) return; try { await save(); closeModal(); toast("Saved in the Outbox"); await refresh(); if (route.view === "outbox") render(); } catch (e) { toast(e.message, 5000); } };
  form.onsubmit = async e => {
    e.preventDefault();
    const p = payload(), a = wsAcc(p.from);
    if (!confirm(`Send from ${a.label} (${a.email}) to ${p.to}?`)) return;
    const btn = form.querySelector("button.primary"); btn.disabled = true; btn.textContent = "Sending…";
    try {
      const it = await save(); await api(`/outbox/${it.id}/send`, "POST");
      closeModal(); toast("Sending…");
      setTimeout(async () => { await refresh(); const x = S.outbox?.find(o => o.id === it.id); toast(x?.status === "sent" ? "Sent" : x?.status === "failed" ? "Not sent: " + (x.result || "") : "Sending… check the Outbox", 5000); if (route.view === "outbox") render(); }, 2500);
    } catch (err) { toast(err.message, 6000); btn.disabled = false; btn.textContent = "Send"; }
  };
}
function wsReply(m) {
  const re = /^re:/i.test(m.subject) ? m.subject : "Re: " + m.subject;
  const when = new Date(m.date).toLocaleString();
  const quote = `On ${when}, ${m.from} wrote:\n` + String(m.body || "").split("\n").slice(0, 60).map(l => "> " + l).join("\n");
  wsCompose({ from: m.acct, to: wsAddr(m.replyTo) || wsAddr(m.from), subject: re, body: "\n\n" + quote, quote, threadId: m.thread, inReplyTo: wsMid(m.messageId), references: m.references, original: { from: m.from, subject: m.subject, body: m.body } });
  const ta = document.querySelector("#wsComp textarea"); if (ta) { ta.setSelectionRange(0, 0); ta.scrollTop = 0; }
}
// the Outbox's "New email" / "Edit" use this composer when a Google account can send
const _outboxComposeWs = outboxCompose;
outboxCompose = function (kind, x) {
  if (kind !== "email" || !wsWriters().length || (x && !x.payload.from && x.by !== "you")) return _outboxComposeWs(kind, x);
  const p = x?.payload || {};
  wsCompose({ from: p.from, to: (p.to || []).join(", "), cc: (p.cc || []).join(", "), subject: p.subject, body: p.body, threadId: p.threadId, inReplyTo: p.inReplyTo, references: p.references }, x);
};

function wsNewFile() {
  const ws = wsWriters(); if (!ws.length) return;
  const def = WS.acct !== "all" && ws.some(a => a.id === WS.acct) ? WS.acct : ws[0].id;
  modal(`<h3>New Google file</h3><form class="form" id="wsNF">
    <div class="two"><label class="f">Type<select name="kind"><option value="doc">Google Doc</option><option value="sheet" ${WS.kind === "sheets" ? "selected" : ""}>Google Sheet</option></select></label>
    <label class="f">Account<select name="acct">${ws.map(a => `<option value="${esc(a.id)}" ${a.id === def ? "selected" : ""}>${esc(a.label)} · ${esc(a.email)}</option>`).join("")}</select></label></div>
    <label class="f">Title<input name="title" required maxlength="200" placeholder="e.g. Q4 plan"></label>
    <label class="f" id="wsNFt">Starting text (optional)<textarea name="text" rows="6"></textarea></label>
    <div class="row end"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Create</button></div></form>`);
  const f = document.getElementById("wsNF");
  const sync = () => { document.getElementById("wsNFt").hidden = f.kind.value !== "doc"; }; f.kind.onchange = sync; sync();
  f.onsubmit = async e => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(f));
    const b = f.querySelector("button.primary"); b.disabled = true; b.textContent = "Creating…";
    try { const r = await api("/google/create", "POST", d); closeModal(); toast(`Created “${r.name}”`); WS.acct = r.acct; WS.folders = []; WS.q = ""; wsSave(); wsShell(); await wsLoad(); wsOpenFile({ ...r, modified: new Date().toISOString() }); }
    catch (err) { toast(err.message, 6000); b.disabled = false; b.textContent = "Create"; }
  };
}

function wsSheetEdit(el, p) {
  const f = p.file;
  el.querySelector("#wsEdOn")?.addEventListener("click", () => { WS.edit = true; WS.edits = {}; wsPaintPrev(); });
  if (!WS.edit) return;
  WS.edits = WS.edits || {};
  const orig = (r, c) => String(p.rows?.[r]?.[c] ?? "");
  const n = el.querySelector("#wsEdN"), save = el.querySelector("#wsEdSave");
  const upd = () => { const k = Object.keys(WS.edits).length; n.textContent = k ? `${k} cell${k > 1 ? "s" : ""} changed` : "No changes yet. Click a cell to type; =formulas work."; save.disabled = !k; };
  el.querySelectorAll("td[data-rc]").forEach(td => {
    const [r, c] = td.dataset.rc.split(",").map(Number), key = `${r},${c}`;
    if (key in WS.edits) { td.textContent = WS.edits[key]; td.classList.add("chg"); }
    td.addEventListener("input", () => { const v = td.textContent; if (v === orig(r, c)) delete WS.edits[key]; else WS.edits[key] = v; td.classList.toggle("chg", key in WS.edits); upd(); });
    td.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); const next = el.querySelector(`td[data-rc="${r + 1},${c}"]`); (next || td).focus(); } if (e.key === "Escape") td.blur(); });
  });
  upd();
  el.querySelector("#wsEdX").onclick = () => { if (Object.keys(WS.edits).length && !confirm("Drop your changes?")) return; WS.edit = false; WS.edits = {}; wsPaintPrev(); };
  save.onclick = async () => {
    const col = i => { let s = ""; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
    const cells = Object.entries(WS.edits).map(([k, v]) => { const [r, c] = k.split(",").map(Number); return { r, c, v }; });
    const list = cells.slice(0, 12).map(x => `${col(x.c)}${x.r + 1}: "${orig(x.r, x.c).slice(0, 30)}" → "${String(x.v).slice(0, 30)}"`).join("\n");
    if (!confirm(`Save ${cells.length} change${cells.length > 1 ? "s" : ""} to “${f.name}” › ${p.tab || "first tab"} (${wsAcc(f.acct)?.label})?\n\n${list}${cells.length > 12 ? "\n…" : ""}`)) return;
    save.disabled = true; save.textContent = "Saving…";
    try {
      let tab = p.tab;
      if (!tab) { const pr = await api(`/google/preview/${f.acct}/${f.id}`); tab = pr.tab || pr.tabs?.[0]; }
      if (!tab) throw new Error("Turn on the Google Sheets API to edit this sheet.");
      await api(`/google/sheet/${f.acct}/${f.id}`, "POST", { tab, cells });
      toast("Saved to Google Sheets"); WS.edit = false; WS.edits = {}; wsOpenFile(f, tab);
    } catch (e) { toast(e.message, 6000); save.disabled = false; save.textContent = "Save changes"; }
  };
}
function wsDocAdd(f) {
  modal(`<h3>Add to “${esc(f.name)}”</h3><form class="form" id="wsDA"><label class="f">Text to add at the end<textarea name="text" rows="9" required></textarea></label>
    <div class="row end"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Add to doc</button></div></form>`);
  document.getElementById("wsDA").onsubmit = async e => {
    e.preventDefault(); const text = e.target.text.value;
    if (!confirm(`Add this text to the end of “${f.name}” (${wsAcc(f.acct)?.label})?`)) return;
    try { await api(`/google/doc/${f.acct}/${f.id}/append`, "POST", { text }); closeModal(); toast("Added to the doc"); wsOpenFile(f); } catch (err) { toast(err.message, 6000); }
  };
}
function wsDocRep(f) {
  modal(`<h3>Find &amp; replace in “${esc(f.name)}”</h3><form class="form" id="wsDR">
    <label class="f">Find<input name="find" required maxlength="2000"></label><label class="f">Replace with<input name="replace" maxlength="20000"></label>
    <label class="row small"><input type="checkbox" name="matchCase"> Match case</label>
    <div class="row end"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Replace all</button></div></form>`);
  document.getElementById("wsDR").onsubmit = async e => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(e.target));
    if (!confirm(`Replace every “${d.find.slice(0, 60)}” with “${d.replace.slice(0, 60)}” in “${f.name}”?`)) return;
    try { const r = await api(`/google/doc/${f.acct}/${f.id}/replace`, "POST", { find: d.find, replace: d.replace, matchCase: !!d.matchCase }); closeModal(); toast(r.changed ? `Replaced ${r.changed}` : "Not found in the doc"); wsOpenFile(f); } catch (err) { toast(err.message, 6000); }
  };
}
window.addEventListener("DOMContentLoaded", () => { wsStatus(); });
