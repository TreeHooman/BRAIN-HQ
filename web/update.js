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
    ${s.log ? `<details class="up-log" open><summary class="small">What the installer said</summary><pre>${esc(s.log)}</pre></details>` : ""}
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
    try { const r = await api("/update/apply", "POST", { sha }); upWait(r.latest?.sha || sha); } catch (e) { toast("⚠ " + e.message, 6000); busy(go, false); }
  };
}

// Restart overlay: a sci-fi "core update" sequence. Stages follow what's really happening: the installer is fetching →
// HQ goes down (installing/restarting) → HQ answers again (online) → reload. If the installer reports a problem, it says so.
function upWait(sha) {
  const from = (UP.s?.installed?.sha || "").slice(0, 7) || "current", to = String(sha).slice(0, 7);
  const ticks = Array.from({ length: 60 }, (_, i) => { const a = i * 6 * Math.PI / 180, r1 = i % 5 ? 92 : 88; return `<line x1="${(100 + Math.cos(a) * r1).toFixed(1)}" y1="${(100 + Math.sin(a) * r1).toFixed(1)}" x2="${(100 + Math.cos(a) * 96).toFixed(1)}" y2="${(100 + Math.sin(a) * 96).toFixed(1)}"/>`; }).join("");
  const o = document.createElement("div"); o.className = "up-over"; o.setAttribute("role", "status");
  o.innerHTML = `<div class="up-grid"></div><div class="up-scan"></div>
    <div class="up-core">
      <svg viewBox="0 0 200 200" aria-hidden="true">
        <g class="uc-ticks">${ticks}</g>
        <circle class="uc-ring a" cx="100" cy="100" r="80"/><circle class="uc-ring b" cx="100" cy="100" r="70"/><circle class="uc-ring c" cx="100" cy="100" r="58"/>
        <circle class="uc-prog" cx="100" cy="100" r="80" pathLength="100"/>
        <path class="uc-eye" d="M52 100 Q100 62 148 100 Q100 138 52 100Z"/><circle class="uc-iris" cx="100" cy="100" r="17"/><circle class="uc-pupil" cx="100" cy="100" r="7"/>
      </svg>
      <div class="up-pct" id="upPct">0%</div>
    </div>
    <div class="up-title" data-t="UPDATING LUTHUR">UPDATING LUTHUR</div>
    <div class="up-ver"><span>${esc(from)}</span><i></i><b>${esc(to)}</b></div>
    <ol class="up-stages">${["Download", "Install", "Restart", "Online"].map((t, i) => `<li data-st="${i}"><span>${String(i + 1).padStart(2, "0")}</span>${t}</li>`).join("")}</ol>
    <div class="up-bar"><i id="upBar"></i></div>
    <div class="up-msg" id="upMsg">Downloading the new version…</div>
    <div class="up-log" id="upLog" hidden></div>`;
  document.body.append(o);
  const $o = q => o.querySelector(q);
  let pct = 0, target = 30, stage = 0;
  const set = (st, msg, tgt) => { stage = Math.max(stage, st); if (msg) $o("#upMsg").textContent = msg; if (tgt) target = Math.max(target, tgt);
    o.querySelectorAll("[data-st]").forEach(li => { const i = +li.dataset.st; li.classList.toggle("done", i < stage); li.classList.toggle("on", i === stage); }); };
  set(0);
  // smooth progress that creeps toward the current stage's target, never claims 100% until it's really back
  const anim = setInterval(() => { pct += Math.max(.08, (target - pct) * .04); pct = Math.min(pct, target); const v = Math.round(pct);
    $o("#upPct").textContent = v + "%"; $o("#upBar").style.width = v + "%"; o.style.setProperty("--p", v); }, 60);
  const done = () => { set(3, "Online. Reloading…", 100); pct = 99.5; o.classList.add("ok"); setTimeout(() => location.reload(), 1100); };
  const t0 = Date.now(); let down = false, up = 0, failed = false;
  setTimeout(() => { if (!down && !failed) set(1, "Installing: backing up and copying files…", 55); }, 4000);
  const tick = async () => {
    try {
      const r = await fetch("/api/update", { headers: { "X-HQ": "1" }, cache: "no-store" }); const j = await r.json();
      if (j.installed?.sha === sha) return done();
      if (down && ++up >= 2) return done();
      if (!down && j.error && !j.busy && /installer|stopped partway/i.test(j.error)) { // the installer reported a problem before restarting
        failed = true; clearInterval(anim); o.classList.add("bad"); $o("#upMsg").textContent = j.error;
        const lg = $o("#upLog"); lg.hidden = false; lg.innerHTML = `${j.log ? `<pre>${esc(j.log)}</pre>` : ""}<button type="button" class="btn sm" id="upClose">Close</button>`;
        $o("#upClose").onclick = () => o.remove(); return;
      }
    } catch { if (!down) { down = true; set(2, "Restarting the core…", 85); } }
    if (Date.now() - t0 > 180000) { clearInterval(anim); o.classList.add("bad"); $o("#upMsg").innerHTML = "Taking too long. Check <code>HQ\\data\\update.log</code>, or start LUTHUR again."; return; }
    setTimeout(tick, 1500);
  };
  setTimeout(tick, 2500);
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
