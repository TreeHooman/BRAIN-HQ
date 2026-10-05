// Background playlist: cycles the built-in space vistas (nova.js shader) and, optionally, the owner's own wallpapers
// (images/videos dropped in HQ\backgrounds\, served at /bg/<file>). Crossfades between them; per-viewer choices in localStorage.
"use strict";
const SPACE_SCENES = ["Ringed giant", "Planet sunrise", "Black hole", "Galaxy"];
const Space = { list: [], i: 0, start: performance.now(), fade: 0, fadeFrom: null, walls: [], wallEl: null, timer: 0 };
const spacePref = () => { try { return { every: 60, scenes: [0, 1, 2, 3], walls: true, ...JSON.parse(hstore.get("hq-space", "{}")) }; } catch { return { every: 60, scenes: [0, 1, 2, 3], walls: true }; } };
const spaceSave = p => hstore.set("hq-space", JSON.stringify(p));

function spaceBuild() {
  const p = spacePref();
  Space.list = [...p.scenes.filter(n => n >= 0 && n < SPACE_SCENES.length).map(n => ({ k: "scene", n })), ...(p.walls ? Space.walls.map(f => ({ k: "wall", f })) : [])];
  if (!Space.list.length) Space.list = [{ k: "scene", n: 0 }];
  Space.i = Math.min(Space.i, Space.list.length - 1);
}
/** For the shader: current scene id, next scene id, crossfade 0..1, slow zoom. */
function spaceView() {
  const cur = Space.list[Space.i] || { k: "scene", n: 0 }, nxt = Space.list[(Space.i + 1) % Space.list.length] || cur;
  const every = Math.max(15, spacePref().every) * 1000, el = performance.now() - Space.start;
  const x = reduced() ? 0 : Math.max(0, Math.min(1, (el - (every - 4000)) / 4000));
  if (el >= every && !reduced()) spaceNext(true);
  const a = cur.k === "scene" ? cur.n : (Space.lastScene ?? 0);
  return { a, n: nxt.k === "scene" && cur.k === "scene" ? nxt.n : a, x: nxt.k === "scene" && cur.k === "scene" ? x * x * (3 - 2 * x) : 0, z: (el / every) };
}
function spaceNext(auto) {
  const cur = Space.list[Space.i]; if (cur?.k === "scene") Space.lastScene = cur.n;
  Space.i = (Space.i + 1) % Space.list.length; Space.start = performance.now();
  spaceWall(); if (!auto) sceneKick?.();
}
function spaceWall() {
  const it = Space.list[Space.i];
  let w = Space.wallEl;
  if (!w) { w = Space.wallEl = document.createElement("div"); w.id = "nova-wall"; w.setAttribute("aria-hidden", "true"); document.getElementById("nova-bg")?.after(w) || document.body.prepend(w); }
  const old = [...w.children];
  if (it?.k === "wall") {
    const src = "/bg/" + encodeURIComponent(it.f), vid = /\.(mp4|webm)$/i.test(it.f);
    const m = document.createElement(vid ? "video" : "img");
    if (vid) Object.assign(m, { muted: true, loop: true, autoplay: true, playsInline: true }); else m.alt = "";
    m.src = src; m.className = "nw"; m.style.setProperty("--dur", Math.max(15, spacePref().every) + "s");
    m.onerror = () => { m.remove(); Space.walls = Space.walls.filter(f => f !== it.f); spaceBuild(); };
    w.append(m); requestAnimationFrame(() => requestAnimationFrame(() => m.classList.add("on")));
  }
  old.forEach(o => { o.classList.remove("on"); setTimeout(() => o.remove(), 2500); });
}
async function spaceLoad() {
  Space.walls = await api("/backgrounds").then(r => r.files || []).catch(() => []);
  spaceBuild(); spaceWall();
}

// Settings card
function spaceCard() {
  const p = spacePref();
  return `<h2>Background</h2><div class="card form" id="spCard">
    <div class="small muted">The space views cycle behind LUTHUR. Move the mouse to look around.</div>
    <div class="chips">${SPACE_SCENES.map((n, i) => `<button type="button" class="chip ${p.scenes.includes(i) ? "on" : ""}" data-sp="${i}">${esc(n)}</button>`).join("")}</div>
    <div class="row"><span class="small muted" style="min-width:110px">Change every</span><select id="spEvery">${[[30, "30 seconds"], [60, "1 minute"], [180, "3 minutes"], [600, "10 minutes"], [3600, "1 hour"]].map(([v, l]) => `<option value="${v}" ${p.every == v ? "selected" : ""}>${l}</option>`).join("")}</select><button type="button" class="btn sm ghost" id="spNext">Next view</button></div>
    <label class="row small"><input type="checkbox" id="spWalls" ${p.walls ? "checked" : ""}> Include my wallpapers (${Space.walls.length} found)</label>
    <div class="note blue small">Your own views: put images (.jpg .png .webp) or looping videos (.mp4 .webm) in the <code>HQ\\backgrounds</code> folder, then reload. They cycle with the space views.</div></div>`;
}
const _vSettingsSp = vSettings;
vSettings = function (el) {
  _vSettingsSp(el);
  const anchor = document.getElementById("musWrap") || el.querySelector("h2");
  const wrap = document.createElement("div"); wrap.id = "spWrap"; anchor?.before(wrap);
  const draw = () => {
    wrap.innerHTML = spaceCard();
    wrap.querySelectorAll("[data-sp]").forEach(b => b.onclick = () => { const p = spacePref(), n = Number(b.dataset.sp); p.scenes = p.scenes.includes(n) ? p.scenes.filter(x => x !== n) : [...p.scenes, n].sort(); if (!p.scenes.length && !(p.walls && Space.walls.length)) return toast("Keep at least one view"); spaceSave(p); spaceBuild(); draw(); });
    wrap.querySelector("#spEvery").onchange = e => { const p = spacePref(); p.every = Number(e.target.value); spaceSave(p); Space.start = performance.now(); };
    wrap.querySelector("#spWalls").onchange = e => { const p = spacePref(); p.walls = e.target.checked; spaceSave(p); spaceBuild(); spaceWall(); };
    wrap.querySelector("#spNext").onclick = () => spaceNext();
  };
  draw();
};
window.addEventListener("DOMContentLoaded", () => { spaceBuild(); setTimeout(spaceLoad, 1500); });
