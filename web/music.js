// Music: Spotify now-playing + controls in the top bar, a setup card in Settings, and voice/typed commands
// ("play my gym playlist", "skip", "pause", "volume up", "what's playing"). The server holds the tokens; this page never sees them.
"use strict";
const Music = { st: null, now: null, t: 0, open: false, busy: false };
const NOTE_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>`;
const MI = {
  prev: `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M6 5h2v14H6zM20 5v14L9 12z"/></svg>`,
  next: `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M16 5h2v14h-2zM4 5v14l11-7z"/></svg>`,
  play: `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M7 4v16l13-8z"/></svg>`,
  pause: `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>`,
};
const onPC = () => /^(127\.0\.0\.1|localhost)$/.test(location.hostname);

async function musicStatus() { Music.st = await api("/spotify").catch(() => null); return Music.st; }
async function musicPoll() {
  clearTimeout(Music.t);
  if (document.hidden || !Music.st?.connected) return;
  const n = await api("/spotify/now").catch(e => ({ error: e.message }));
  if (n.connected === false) { Music.st.connected = false; Music.now = null; musicChrome(); return; }
  if (!n.error) Music.now = n;
  musicChrome();
  Music.t = setTimeout(musicPoll, Music.open || (route.view === "command" && Music.now?.playing) ? 3000 : Music.now?.playing ? 6000 : 15000);
}
async function musicDo(action, value) {
  if (Music.busy) return; Music.busy = true;
  try { await api("/spotify/control", "POST", { action, value }); }
  catch (e) { toast(e.message, 4500); }
  finally { Music.busy = false; setTimeout(musicPoll, 350); }
}
async function musicPlay(query) {
  try { const r = await api("/spotify/play", "POST", { query }); toast(`Playing ${r.playing}`); speakAlways?.(`Playing ${r.playing}`); setTimeout(musicPoll, 600); return true; }
  catch (e) { toast(e.message, 5000); speakAlways?.(e.message); return true; }
}

// top-bar button + popover
function musicChrome() {
  const top = document.querySelector(".top"); if (!top) return;
  let b = document.getElementById("musBtn");
  if (!Music.st?.connected) { b?.remove(); document.getElementById("musPop")?.remove(); return; }
  if (!b) {
    b = document.createElement("button"); b.type = "button"; b.id = "musBtn"; b.className = "mus-btn"; b.setAttribute("aria-label", "Music");
    b.onclick = e => { e.stopPropagation(); musicToggle(); };
    (top.querySelector(".wake-btn") || top.querySelector("#openPal"))?.before(b);
  }
  const n = Music.now;
  const html = n?.active ? `${n.art ? `<img src="${esc(n.art)}" alt="" referrerpolicy="no-referrer">` : NOTE_SVG}<span class="mus-t"><b>${esc(n.track)}</b><small>${esc(n.artist)}</small></span>${n.playing ? `<i class="mus-eq"><s></s><s></s><s></s></i>` : ""}` : `${NOTE_SVG}<span class="mus-t"><b>Music</b><small>nothing playing</small></span>`;
  if (b.innerHTML !== html) b.innerHTML = html;
  b.classList.toggle("on", !!n?.playing);
  if (Music.open) musicPopFill();
  musicHud();
}
// Command screen: a floating HUD "now playing" readout next to the core
function musicHud() {
  const stage = document.getElementById("nvStage"), n = Music.now;
  let h = document.getElementById("musHud");
  if (!stage || route.view !== "command" || !Music.st?.connected || !n?.active) { h?.remove(); return; }
  if (!h) {
    h = document.createElement("div"); h.id = "musHud"; h.className = "mus-hud";
    h.innerHTML = `<div class="mh-lbl"><i class="mus-eq"><s></s><s></s><s></s></i><span id="mhSt"></span></div>
      <div class="mh-row"><button type="button" class="mh-art" id="mhArt" aria-label="Open music"></button><div class="mh-txt"><b id="mhT"></b><small id="mhA"></small></div></div>
      <div class="mh-bar"><i id="mhP"></i></div>
      <div class="mh-ctl"><button type="button" data-mh="previous" aria-label="Previous">${MI.prev}</button><button type="button" data-mh="toggle" id="mhPlay" aria-label="Play or pause"></button><button type="button" data-mh="next" aria-label="Next">${MI.next}</button><span id="mhD"></span></div>`;
    stage.appendChild(h);
    h.querySelectorAll("[data-mh]").forEach(x => x.onclick = e => { e.stopPropagation(); musicDo(x.dataset.mh); });
    h.querySelector("#mhArt").onclick = e => { e.stopPropagation(); musicToggle(true); };
    h.addEventListener("click", e => e.stopPropagation());
  }
  h.classList.toggle("on", !!n.playing);
  h.querySelector("#mhSt").textContent = n.playing ? "NOW PLAYING" : "PAUSED";
  h.querySelector("#mhArt").innerHTML = n.art ? `<img src="${esc(n.art)}" alt="" referrerpolicy="no-referrer">` : NOTE_SVG;
  h.querySelector("#mhT").textContent = n.track; h.querySelector("#mhA").textContent = n.artist;
  h.querySelector("#mhP").style.width = n.duration ? `${Math.min(100, n.progress / n.duration * 100)}%` : "0";
  h.querySelector("#mhPlay").innerHTML = n.playing ? MI.pause : MI.play;
  h.querySelector("#mhD").textContent = n.device?.name ? "· " + n.device.name.toUpperCase() : "";
}
function musicToggle(force) {
  Music.open = force ?? !Music.open;
  let p = document.getElementById("musPop");
  if (!Music.open) { p?.remove(); return; }
  if (!p) { p = document.createElement("div"); p.id = "musPop"; p.className = "mus-pop"; p.setAttribute("role", "dialog"); p.setAttribute("aria-label", "Music"); document.body.appendChild(p); p.addEventListener("click", e => e.stopPropagation()); }
  musicPopFill(true); musicPoll();
}
document.addEventListener("click", () => { if (Music.open) musicToggle(false); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && Music.open) musicToggle(false); });

async function musicPopFill(full) {
  const p = document.getElementById("musPop"); if (!p) return;
  const n = Music.now || {};
  if (full || !p.querySelector(".mp-ctl")) {
    p.innerHTML = `<div class="mp-head"><div class="mp-art" id="mpArt"></div><div class="mp-txt"><b id="mpT"></b><small id="mpA"></small><small id="mpD" class="faint"></small></div></div>
      <div class="mp-bar"><i id="mpP"></i></div>
      <div class="mp-ctl"><button type="button" data-m="previous" aria-label="Previous">${MI.prev}</button><button type="button" class="mp-play" data-m="toggle" aria-label="Play or pause"></button><button type="button" data-m="next" aria-label="Next">${MI.next}</button></div>
      <label class="mp-vol"><span>Volume</span><input type="range" min="0" max="100" step="5" id="mpVol" aria-label="Volume"></label>
      <form class="mp-ask" id="mpAsk"><input id="mpQ" placeholder="Play… a song, artist or playlist" aria-label="What to play" autocomplete="off"><button class="btn sm primary">Play</button></form>
      <div class="mp-dev" id="mpDev"></div>`;
    p.querySelectorAll("[data-m]").forEach(x => x.onclick = () => musicDo(x.dataset.m));
    const vol = p.querySelector("#mpVol"); vol.onchange = () => musicDo("volume", Number(vol.value));
    p.querySelector("#mpAsk").onsubmit = e => { e.preventDefault(); const q = p.querySelector("#mpQ").value.trim(); if (q) { musicPlay(q); p.querySelector("#mpQ").value = ""; } };
    musicDevices();
  }
  p.querySelector("#mpArt").innerHTML = n.art ? `<img src="${esc(n.art)}" alt="" referrerpolicy="no-referrer">` : NOTE_SVG;
  p.querySelector("#mpT").textContent = n.active ? n.track : "Nothing playing";
  p.querySelector("#mpA").textContent = n.active ? n.artist : "Pick something below, or say “Hey JARVIS, play …”";
  p.querySelector("#mpD").textContent = n.device ? `on ${n.device.name}` : "";
  p.querySelector("#mpP").style.width = n.duration ? `${Math.min(100, n.progress / n.duration * 100)}%` : "0";
  p.querySelector(".mp-play").innerHTML = n.playing ? MI.pause : MI.play;
  const vol = p.querySelector("#mpVol"); if (document.activeElement !== vol && n.device?.volume != null) vol.value = n.device.volume;
}
async function musicDevices() {
  const box = document.getElementById("mpDev"); if (!box) return;
  const ds = await api("/spotify/devices").catch(() => []);
  if (!document.getElementById("mpDev")) return;
  box.innerHTML = ds.length ? `<small class="faint">PLAY ON</small>${ds.map(d => `<button type="button" class="mp-d ${d.active ? "on" : ""}" data-dev="${esc(d.id)}">${esc(d.name)}<small>${esc(d.type)}</small></button>`).join("")}` : `<small class="faint">Open Spotify on your PC or phone to control it here.</small>`;
  box.querySelectorAll("[data-dev]").forEach(x => x.onclick = () => musicDo("transfer", x.dataset.dev).then(musicDevices));
}

// typed or spoken commands. Returns true when handled (so it doesn't go to JARVIS as a chat message).
function musicCommand(raw) {
  if (!Music.st?.connected) return false;
  const c = String(raw || "").toLowerCase().replace(/[.!?]+$/, "").replace(/^(can you|could you|please|jarvis,?)\s+/, "").trim();
  if (/^(pause|stop|stop the music|pause the music|pause music|stop music|mute the music)$/.test(c)) { if (c === "stop" && !Music.now?.playing) return false; musicDo("pause"); return true; }
  if (/^(resume|unpause|play|play music|resume music|keep playing)$/.test(c)) { musicDo("play"); return true; }
  if (/^(skip|next|next song|next track|skip (this )?(song|track))$/.test(c)) { musicDo("next"); return true; }
  if (/^(previous|go back|last song|previous song|previous track|back)$/.test(c)) { musicDo("previous"); return true; }
  if (/^(volume up|turn it up|louder|turn (the )?music up)$/.test(c)) { musicDo("volume-step", 15); return true; }
  if (/^(volume down|turn it down|quieter|turn (the )?music down)$/.test(c)) { musicDo("volume-step", -15); return true; }
  const v = c.match(/^(?:set )?volume (?:to )?(\d{1,3})(?: ?%| percent)?$/); if (v) { musicDo("volume", Number(v[1])); return true; }
  if (/^(shuffle( on)?|turn on shuffle)$/.test(c)) { musicDo("shuffle", true); return true; }
  if (/^(shuffle off|turn off shuffle|stop shuffling)$/.test(c)) { musicDo("shuffle", false); return true; }
  if (/^(what('s| is) (this|playing|this song)|what song is this|who is this|what am i listening to)$/.test(c)) {
    const n = Music.now; const say = n?.active ? `${n.track} by ${n.artist}` : "Nothing is playing right now.";
    toast(say, 5000); speakAlways?.(say); return true;
  }
  const m = c.match(/^(?:play|put on|start playing|throw on)\s+(.+?)(?:\s+on spotify)?$/);
  if (m && !/\b(game|video|movie|reel|round)\b/.test(m[1])) { musicPlay(m[1]); return true; }
  return false;
}

// hooks: voice (hands-free), Command input, JARVIS chat
const _voiceCommand = voiceCommand;
voiceCommand = function (cmd) { if (musicCommand(cmd)) return; _voiceCommand(cmd); };
if (typeof cmdSend === "function") { const _cmdSend = cmdSend; cmdSend = function (t) { if (musicCommand(t)) { const i = document.getElementById("cmdText"); if (i) i.value = ""; return; } return _cmdSend(t); }; }

// Settings card
function musicCard() {
  const st = Music.st || {}, here = onPC();
  const steps = `<ol class="mus-steps">
      <li>Open <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener">developer.spotify.com/dashboard</a>, log in with your Spotify account and press <b>Create app</b>.</li>
      <li>Name it <b>LUTHUR</b> and type anything for the description. Under <b>Redirect URIs</b> paste this exactly, then press <b>Add</b>:<div class="mus-copy"><code id="musRedir">${esc(st.redirectUri || "")}</code><button type="button" class="btn sm" id="musCopy">Copy</button></div></li>
      <li>Tick <b>Web API</b>, agree to the terms, press <b>Save</b>.</li>
      <li>On the app page, open <b>Settings</b>, copy the <b>Client ID</b> and paste it below.</li></ol>`;
  return `<h2>Spotify</h2><div class="card form" id="musCard">
    ${st.connected ? `<div class="row"><span class="dot good"></span><div class="grow"><b>Connected</b>${st.user ? ` <span class="small muted">as ${esc(st.user)}</span>` : ""}<div class="small muted">Use the music button at the top, or say “Hey JARVIS, play …”, “skip”, “pause”, “volume up”.</div></div><button type="button" class="btn sm ghost" id="musOff">Disconnect</button></div>`
    : st.configured ? `<div class="row"><span class="dot unknown"></span><div class="grow"><b>One step left</b><div class="small muted">Client ID saved (${esc(st.clientId)}). Press Connect and approve on Spotify's page.</div></div></div>
        ${here ? "" : `<div class="note amber small">Do this step on the PC (at <b>http://127.0.0.1:8800</b>). After that it works on your phone too.</div>`}
        <div class="row end"><button type="button" class="btn ghost" id="musReset">Change Client ID</button><button type="button" class="btn primary" id="musGo" ${here ? "" : "disabled"}>Connect Spotify</button></div>`
    : `<div class="small muted">Play, pause and skip from LUTHUR and by voice. Takes about 3 minutes, once. Needs Spotify Premium to control playback.</div>${steps}
        <label class="f">Client ID<input id="musId" placeholder="32 letters and numbers" autocomplete="off" spellcheck="false" maxlength="40"></label>
        <div class="row end"><button type="button" class="btn primary" id="musSave">Save</button></div>`}
    <div class="note blue small">Private: you sign in on Spotify's own page and LUTHUR only gets permission to see and control playback (and read your playlist names). The sign-in key stays on this PC in <code>config/hq.local.json</code>. Disconnect any time, here or at spotify.com/account/apps.</div></div>`;
}
const _vSettings = vSettings;
vSettings = function (el) {
  _vSettings(el);
  const anchor = [...el.querySelectorAll("h2")].find(h => /^Email/.test(h.textContent)) || el.querySelector("h2");
  const wrap = document.createElement("div"); wrap.id = "musWrap"; anchor?.before(wrap);
  const draw = () => {
    wrap.innerHTML = musicCard();
    const $m = id => document.getElementById(id);
    if ($m("musCopy")) $m("musCopy").onclick = () => navigator.clipboard?.writeText($m("musRedir").textContent).then(() => toast("Copied"), () => toast("Select it and copy"));
    if ($m("musSave")) $m("musSave").onclick = async () => { try { await api("/spotify/client", "POST", { clientId: $m("musId").value }); toast("Saved. Now press Connect."); fill(); } catch (e) { toast(e.message, 5000); } };
    if ($m("musReset")) $m("musReset").onclick = () => { Music.st.configured = false; draw(); };
    if ($m("musGo")) $m("musGo").onclick = async () => { try { const { url } = await api("/spotify/login", "POST"); location.href = url; } catch (e) { toast(e.message, 5000); } };
    if ($m("musOff")) $m("musOff").onclick = async () => { if (!confirm("Disconnect Spotify from LUTHUR?")) return; await api("/spotify/disconnect", "POST").catch(() => {}); Music.now = null; toast("Spotify disconnected"); fill(); musicChrome(); };
  };
  const fill = async () => { await musicStatus(); if (document.getElementById("musWrap")) draw(); };
  fill();
  // back from Spotify's sign-in page
  const q = location.hash.match(/spotify\?(ok=1|error=([^&]*))/);
  if (q) {
    history.replaceState(null, "", "#settings");
    if (q[2]) toast(decodeURIComponent(q[2]), 6000); else { toast("Spotify connected"); musicStatus().then(() => { musicChrome(); musicPoll(); }); }
    setTimeout(() => document.getElementById("musWrap")?.scrollIntoView({ behavior: "smooth", block: "start" }), 400);
  }
};

const _renderM = render;
render = function () { _renderM(); musicChrome(); };
document.addEventListener("visibilitychange", () => { if (!document.hidden) musicPoll(); });
window.addEventListener("DOMContentLoaded", async () => { await musicStatus(); musicChrome(); musicPoll(); });
