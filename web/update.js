// One-click updates: Settings → Updates card, a dot on Settings when a new version is out, and a restart overlay that
// reloads the page once HQ is back on the new version. The GitHub key is write-only from here (the server never returns it).
"use strict";
const UP = { s: null };
const upShort = sha => sha ? sha.slice(0, 7) : "unknown";
const upWhen = d => { const t = Date.parse(d); return t ? new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""; };

async function upCheck(fresh) {
  try { UP.s = await api("/update" + (fresh ? "?fresh=1" : "")); } catch (e) { UP.s = { error: e.message }; }
  upDot(); return UP.s;
}
function upDot() { document.querySelectorAll('#nav a[data-view="settings"], [data-view="settings"]').forEach(a => a.classList.toggle("up-dot", !!UP.s?.available)); }

function upCard() {
  const s = UP.s || {};
  const state = s.busy ? `<span class="pill amber">${esc(s.busy)}</span>`
    : s.error ? `<span class="pill red">${esc(s.error)}</span>`
    : s.available ? `<span class="pill green">Update available</span>`
    : s.latest ? `<span class="pill">Up to date</span>` : `<span class="pill">Not checked</span>`;
  const notes = (s.notes || []).length ? `<ul class="up-notes">${s.notes.map(n => `<li>${esc(n)}</li>`).join("")}</ul>` : s.available && s.latest ? `<div class="small">${esc(s.latest.msg)}</div>` : "";
  return `<h2>Updates</h2><div class="card form" id="upCard">
    <div class="between"><div>${state}</div><button type="button" class="btn sm ghost" id="upChk">Check now</button></div>
    <div class="small muted">Installed <code>${esc(upShort(s.installed?.sha))}</code>${s.installed?.at ? " · " + esc(upWhen(s.installed.at)) : ""}${s.latest ? ` · newest <code>${esc(upShort(s.latest.sha))}</code> · ${esc(upWhen(s.latest.date))}` : ""}${s.behind ? ` · ${s.behind} change${s.behind > 1 ? "s" : ""} behind` : ""}</div>
    ${s.available ? `${notes}<div class="row"><button type="button" class="btn primary" id="upGo" ${s.canApply ? "" : "disabled"}>Update now</button><span class="small muted">${s.canApply ? "Backs up first, keeps your brain, data and keys. Takes about 20 seconds." : "Run the update on the HQ PC."}</span></div>` : ""}
    <details class="up-key" ${s.hasToken ? "" : "open"}><summary class="small">GitHub key ${s.hasToken ? "· saved ✓" : "· needed (private repo)"}</summary>
      <ol class="small muted">
        <li>Open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">GitHub → New fine-grained token</a>.</li>
        <li>Name <b>LUTHUR updates</b>, expiration up to you (1 year is fine).</li>
        <li>Repository access: <b>Only select repositories</b> → <code>${esc(s.repo || "")}</code>.</li>
        <li>Permissions → Repository → <b>Contents: Read-only</b>. Nothing else.</li>
        <li>Generate, copy, paste below, Save. It stays on this PC only.</li>
      </ol>
      <form class="row" id="upKeyF" autocomplete="off"><input class="masked grow" id="upKey" type="text" autocomplete="new-password" spellcheck="false" placeholder="${s.hasToken ? "Saved (paste a new one to replace)" : "github_pat_…"}">
        <button class="btn sm primary">Save</button>${s.hasToken ? `<button type="button" class="btn sm ghost" id="upKeyDel">Remove</button>` : ""}</form>
      <div class="small muted">Updates from <code>${esc(s.repo || "")}</code> · branch <code>${esc(s.branch || "")}</code></div>
    </details></div>`;
}

function upDraw(wrap) {
  wrap.innerHTML = upCard();
  const busy = (b, on) => { if (b) { b.disabled = on; b.classList.toggle("busy", on); } };
  const chk = wrap.querySelector("#upChk");
  chk.onclick = async () => { busy(chk, true); await upCheck(true); upDraw(wrap); };
  const f = wrap.querySelector("#upKeyF");
  f.onsubmit = async e => {
    e.preventDefault(); const v = f.querySelector("#upKey").value.trim(); if (!v) return;
    try { UP.s = await api("/update", "PUT", { token: v }); toast(UP.s.error ? "⚠ " + UP.s.error : "Key saved"); } catch (er) { toast("⚠ " + er.message, 5000); }
    upDot(); upDraw(wrap);
  };
  const del = wrap.querySelector("#upKeyDel");
  if (del) del.onclick = async () => { if (!confirm("Remove the saved GitHub key?")) return; try { UP.s = await api("/update", "PUT", { token: "" }); } catch {} upDraw(wrap); };
  const go = wrap.querySelector("#upGo");
  if (go) go.onclick = async () => {
    if (!confirm("Update LUTHUR now? It restarts and this page reloads by itself.")) return;
    const sha = UP.s.latest.sha; busy(go, true);
    try { await api("/update/apply", "POST", { sha }); upWait(sha); } catch (e) { toast("⚠ " + e.message, 6000); busy(go, false); }
  };
}

// Restart overlay: wait for the server to go away and come back on the new commit, then reload.
function upWait(sha) {
  const o = document.createElement("div"); o.className = "up-over";
  o.innerHTML = `<div class="up-box"><div class="up-spin"></div><b>Updating LUTHUR…</b><div class="small muted" id="upMsg">Downloading and installing</div></div>`;
  document.body.append(o);
  const t0 = Date.now(); let down = false;
  const tick = async () => {
    try {
      const r = await fetch("/api/update", { headers: { "X-HQ": "1" }, cache: "no-store" }); const j = await r.json();
      if (j.installed?.sha === sha) { o.querySelector("#upMsg").textContent = "Done. Reloading…"; return setTimeout(() => location.reload(), 600); }
      if (down) o.querySelector("#upMsg").textContent = "Starting back up…";
    } catch { down = true; o.querySelector("#upMsg").textContent = "Restarting…"; }
    if (Date.now() - t0 > 180000) { o.querySelector("#upMsg").innerHTML = "Taking too long. Check <code>HQ\\data\\update.log</code>, or run START-HQ."; return; }
    setTimeout(tick, 2000);
  };
  setTimeout(tick, 3000);
}

const _vSettingsUp = vSettings;
vSettings = function (el) {
  _vSettingsUp(el);
  const wrap = document.createElement("div"); wrap.id = "upWrap";
  (el.querySelector("h2") || el.lastElementChild)?.before(wrap);
  upDraw(wrap);
  if (!UP.s || Date.now() - (UP.s.checkedAt || 0) > 15 * 60e3) upCheck(false).then(() => wrap.isConnected && upDraw(wrap));
};

// Quiet check shortly after start, then every 6 hours; one notice per session when something new is out.
setTimeout(async function loop() {
  const s = await upCheck(false);
  let told = false; try { told = sessionStorage.getItem("hq-up-told") === s?.latest?.sha; } catch {}
  if (s?.available && !told) { toast("Update available · Settings → Updates", 6000); try { sessionStorage.setItem("hq-up-told", s.latest.sha); } catch {} }
  setTimeout(loop, 6 * 3600e3);
}, 8000);
