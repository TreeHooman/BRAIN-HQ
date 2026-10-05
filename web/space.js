// Background playlist: cycles the built-in space vistas (nova.js shader) and, optionally, the owner's own wallpapers
// (images/videos dropped in HQ\backgrounds\, served at /bg/<file>). Crossfades between them; per-viewer choices in localStorage.
"use strict";
const SPACE_SCENES = ["", "", "", "", "Nebula"]; // ids 0-3 (planets) were removed; ids kept so saved choices still map
const Space = { list: [], i: 0, start: performance.now(), fade: 0, fadeFrom: null, walls: [], wallEl: null, timer: 0 };
const SPACE_DEF = { every: 60, scenes: [4], walls: true }; // default: just the nebula
// Phones keep their own choice (default: nebula only, no planets), so a desktop pick never lands on the phone.
const SPACE_KEY = matchMedia("(max-width: 760px), (pointer: coarse)").matches ? "hq-space2-phone" : "hq-space2";
const spacePref = () => { try { return { ...SPACE_DEF, ...JSON.parse(hstore.get(SPACE_KEY, "{}")) }; } catch { return { ...SPACE_DEF }; } };
const spaceSave = p => hstore.set(SPACE_KEY, JSON.stringify(p));

function spaceBuild() {
  const p = spacePref();
  Space.list = [...p.scenes.filter(n => n === 4).map(n => ({ k: "scene", n })), ...(p.walls ? Space.walls.map(f => ({ k: "wall", f })) : [])];
  if (!Space.list.length) Space.list = [{ k: "scene", n: 4 }];
  Space.i = Math.min(Space.i, Space.list.length - 1);
}
/** For the shader: current scene id, next scene id, crossfade 0..1, slow zoom. */
function spaceView() {
  const cur = Space.list[Space.i] || { k: "scene", n: 4 }, nxt = Space.list[(Space.i + 1) % Space.list.length] || cur;
  const every = Math.max(15, spacePref().every) * 1000, el = performance.now() - Space.start;
  const x = reduced() ? 0 : Math.max(0, Math.min(1, (el - (every - 4000)) / 4000));
  if (el >= every && !reduced()) spaceNext(true);
  const a = cur.k === "scene" ? cur.n : (Space.lastScene ?? 4);
  if (typeof sceneRes === "function") sceneRes(a < 3.5 || (x > 0 && nxt.k === "scene" && nxt.n < 3.5));
  return { a, n: nxt.k === "scene" && cur.k === "scene" ? nxt.n : a, x: nxt.k === "scene" && cur.k === "scene" ? x * x * (3 - 2 * x) : 0, z: Space.list.length > 1 || cur.n !== 4 ? el / every : 0 };
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
  starsShow();
}
async function spaceLoad() {
  Space.walls = await api("/backgrounds").then(r => r.files || []).catch(() => []);
  spaceBuild(); spaceWall(); starsShow();
}

// Settings card
function spaceCard() {
  const p = spacePref();
  return `<h2>Background</h2><div class="card form" id="spCard">
    <div class="small muted">Pick one view, or several to cycle. Move the mouse to look around.</div>
    <div class="chips">${SPACE_SCENES.map((n, i) => !n ? "" : `<button type="button" class="chip ${p.scenes.includes(i) ? "on" : ""}" data-sp="${i}">${esc(n)}</button>`).join("")}</div>
    <div class="row"><span class="small muted" style="min-width:110px">Change every</span><select id="spEvery">${[[30, "30 seconds"], [60, "1 minute"], [180, "3 minutes"], [600, "10 minutes"], [3600, "1 hour"]].map(([v, l]) => `<option value="${v}" ${p.every == v ? "selected" : ""}>${l}</option>`).join("")}</select><button type="button" class="btn sm ghost" id="spNext">Next view</button></div>
    <div class="row"><span class="small muted" style="min-width:110px">Motion</span><select id="spPow"><option value="auto">Automatic (saver on phones)</option><option value="full">Full motion</option><option value="saver">Battery saver</option></select></div>
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
    const pw = wrap.querySelector("#spPow"); try { pw.value = localStorage.getItem("hq-power") || "auto"; } catch {}
    pw.onchange = () => { try { pw.value === "auto" ? localStorage.removeItem("hq-power") : localStorage.setItem("hq-power", pw.value); } catch {} Scene.scale = .6; sceneSize?.(); Stars.still = false; starsStart(); toast(pw.value === "saver" ? "Battery saver on" : "Saved"); };
  };
  draw();
};
window.addEventListener("DOMContentLoaded", () => { spaceBuild(); setTimeout(spaceLoad, 1500); });

/** The 2D star layer shows on the nebula; planet views draw their own stars (so planets cover them) and wallpapers have none. */
function starsShow() { const it = Space.list[Space.i], st = document.getElementById("nova-stars"); if (st) st.style.opacity = it?.k === "scene" && it.n === 4 ? "" : "0"; }

// ---------------- crisp star layer (2D, full resolution) ----------------
// Real-looking stars: most are faint pinpricks, a few are bright with a soft halo, the brightest few get diffraction
// spikes. Colours follow star temperatures (blue-white to orange). Three depths parallax with the mouse.
const Stars = { c: null, x: null, list: [], spr: [], w: 0, h: 0, d: 1, raf: 0, f: 0, mx: 0, my: 0 };
const STAR_COL = ["#9bb0ff", "#aabfff", "#cad7ff", "#f8f7ff", "#fff4ea", "#ffd2a1", "#ffcc6f"];
function starSprite(col, spikes) {
  const S = 64, c = document.createElement("canvas"); c.width = c.height = S; const x = c.getContext("2d"), h = S / 2;
  const g = x.createRadialGradient(h, h, 0, h, h, h);
  g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(.06, col); g.addColorStop(.16, col + "55"); g.addColorStop(.45, col + "10"); g.addColorStop(1, col + "00");
  x.fillStyle = g; x.fillRect(0, 0, S, S);
  if (spikes) { x.globalCompositeOperation = "lighter"; for (const [w, hh] of [[S, 1.2], [1.2, S]]) { const lg = x.createLinearGradient(w > hh ? 0 : h, w > hh ? h : 0, w > hh ? S : h, w > hh ? h : S); lg.addColorStop(0, col + "00"); lg.addColorStop(.5, col + "cc"); lg.addColorStop(1, col + "00"); x.fillStyle = lg; x.fillRect(h - w / 2, h - hh / 2, w, hh); } }
  return c;
}
function starsSize() {
  const c = Stars.c; if (!c) return;
  Stars.d = Math.min(2, devicePixelRatio || 1); Stars.w = innerWidth; Stars.h = innerHeight;
  c.width = Math.round(Stars.w * Stars.d); c.height = Math.round(Stars.h * Stars.d);
  Stars.x.setTransform(Stars.d, 0, 0, Stars.d, 0, 0);
  const n = Math.min(1400, Math.round(Stars.w * Stars.h / 1500)), rnd = (() => { let a = 1337; return () => (a = (a * 16807) % 2147483647) / 2147483647; })();
  Stars.list = Array.from({ length: n }, () => {
    const m = Math.pow(rnd(), 7); // magnitude: mostly faint
    return { x: rnd() * (Stars.w + 80) - 40, y: rnd() * (Stars.h + 80) - 40, m, z: .2 + rnd() * .8, c: Math.min(6, Math.floor(rnd() * rnd() * 7 + (rnd() < .5 ? 2 : 3))), tw: rnd() * 6.28, ts: .4 + rnd() * 1.6 };
  });
}
function starsDraw(t) {
  const { x, w, h } = Stars; x.clearRect(0, 0, w, h);
  const ox = (NV.sx - .5) * -26, oy = ((NV.sy ?? .5) - .5) * -18;
  for (const s of Stars.list) {
    const px = s.x + ox * s.z, py = s.y + oy * s.z, tw = .78 + .22 * Math.sin(t * s.ts + s.tw);
    if (s.m < .08) { x.globalAlpha = (.25 + s.m * 6) * tw; x.fillStyle = STAR_COL[s.c]; x.fillRect(px, py, s.m < .02 ? .7 : 1, s.m < .02 ? .7 : 1); continue; }
    const big = s.m > .82, r = big ? 7 + s.m * 13 : 1.6 + s.m * 9; x.globalAlpha = Math.min(1, .35 + s.m) * tw;
    x.drawImage(Stars.spr[s.c + (big ? 7 : 0)], px - r, py - r, r * 2, r * 2);
  }
  x.globalAlpha = 1;
}
function starsLoop(now) {
  Stars.raf = 0;
  if (!Stars.c || !isHud() || document.hidden || HUD.asleep || window.hqBooting) return; // restarted when the opening scan ends
  const lp = typeof lowPower === "function" && lowPower();
  if (lp) { if (!Stars.still) { starsDraw(0); Stars.still = true; } return; } // saver: draw once, no twinkle loop
  Stars.still = false;
  // twinkle is slow: ~15 fps is plenty. Hidden behind a planet scene → don't draw at all (re-checked every few frames).
  if (++Stars.f % 4 === 0 && Stars.c.style.opacity !== "0") starsDraw(now / 1000);
  if (!reduced()) Stars.raf = requestAnimationFrame(starsLoop);
}
function starsStart() {
  if (!Stars.c) {
    const c = Stars.c = document.createElement("canvas"); c.id = "nova-stars"; c.setAttribute("aria-hidden", "true");
    (document.getElementById("nova-wall") || document.getElementById("nova-bg"))?.after(c) || document.body.prepend(c);
    Stars.x = c.getContext("2d");
    Stars.spr = [...STAR_COL.map(col => starSprite(col, false)), ...STAR_COL.map(col => starSprite(col, true))];
    starsSize(); addEventListener("resize", () => { starsSize(); Stars.still = false; if (!Stars.raf) Stars.raf = requestAnimationFrame(starsLoop); });
  }
  if (reduced()) { starsDraw(0); return; }
  if (!Stars.raf) Stars.raf = requestAnimationFrame(starsLoop);
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) starsStart(); });
new MutationObserver(() => { if (!HUD.asleep) starsStart(); }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
window.addEventListener("DOMContentLoaded", () => setTimeout(() => { starsStart(); starsShow(); }, 300));

// ---------------- Settings: every section folds into a drop-down (remembered per viewer) ----------------
const _vSettingsFold = vSettings;
vSettings = function (el) {
  _vSettingsFold(el);
  let open; try { open = new Set(JSON.parse(hstore.get("hq-set-open", "[]"))); } catch { open = new Set(); }
  [...el.querySelectorAll("h2")].forEach(h => {
    if (h.closest(".card") || h.dataset.fold) return;
    const key = h.textContent.trim().toLowerCase().slice(0, 40); h.dataset.fold = key;
    const parts = []; for (let n = h.nextElementSibling; n && n.tagName !== "H2" && !n.querySelector?.(":scope > h2"); n = n.nextElementSibling) parts.push(n);
    if (!parts.length) return;
    const set = on => { h.classList.toggle("open", on); h.setAttribute("aria-expanded", on); parts.forEach(p => p.hidden = !on); };
    h.classList.add("fold"); h.tabIndex = 0; h.setAttribute("role", "button");
    const flip = () => { const on = !h.classList.contains("open"); set(on); on ? open.add(key) : open.delete(key); hstore.set("hq-set-open", JSON.stringify([...open])); };
    h.onclick = flip; h.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(); } };
    set(open.has(key) || /spotify\?|#settings\/spotify/.test(location.hash) && /spotify/.test(key));
  });
  // wrappers (Spotify, Background) redraw their own h2 + card: fold them, and again after each redraw
  const foldWrap = w => {
    const h = w.querySelector(":scope > h2"); if (!h || h.dataset.fold) return;
    const key = h.textContent.trim().toLowerCase(); h.dataset.fold = key; h.classList.add("fold"); h.tabIndex = 0; h.setAttribute("role", "button");
    const set = on => { h.classList.toggle("open", on); h.setAttribute("aria-expanded", on); w.querySelectorAll(":scope > :not(h2)").forEach(c => c.hidden = !on); };
    h.onclick = () => { const on = !h.classList.contains("open"); set(on); on ? open.add(key) : open.delete(key); hstore.set("hq-set-open", JSON.stringify([...open])); };
    set(open.has(key));
  };
  el.querySelectorAll("#musWrap, #spWrap, #upWrap").forEach(w => { foldWrap(w); new MutationObserver(() => foldWrap(w)).observe(w, { childList: true }); });
};

// Command desk panels lean slightly with the mouse (CSS reads --dx/--dy, -1..1)
addEventListener("mousemove", e => { const d = document.querySelector(".nv-desk"); if (!d) return; d.style.setProperty("--dx", ((e.clientX / innerWidth) * 2 - 1).toFixed(3)); d.style.setProperty("--dy", ((e.clientY / innerHeight) * 2 - 1).toFixed(3)); }, { passive: true });

// ---------------- long panels fold: anything taller than the screen allows gets "Show more ▾" ----------------
// Works on every page after each render. Skips views that manage their own scrolling (Code, Canvas, Workspace lists)
// and forms (so you never lose a field). Expanded state is remembered per panel title for this visit.
const Folds = { open: new Set(), t: 0 };
const FOLD_SKIP = /^(code|canvas|workspace|tasks)$/;
function foldKey(el) { return (route.view || "") + "|" + (el.querySelector(".ttl, h2, h3, b")?.textContent || "").trim().slice(0, 40); }
function foldPanels() {
  const view = document.getElementById("view"); if (!view || FOLD_SKIP.test(route.view || "")) return;
  const base = Math.max(320, Math.round(innerHeight * (matchMedia("(max-width: 760px)").matches ? .62 : .55)));
  const desk = route.view === "command" && !matchMedia("(max-width: 1099px)").matches; // Command desktop: everything fits on one screen
  view.querySelectorAll(".card, .nv-panel").forEach(c => {
    const top = c.getBoundingClientRect().top + (document.scrollingElement?.scrollTop || 0);
    const max = desk ? Math.max(200, Math.round(innerHeight - top - 28)) : base;
    if (c.closest(".fold-in") !== c && c.parentElement?.closest(".card.fold-on, .nv-panel.fold-on")) return; // nested
    if (c.querySelector("form, input, textarea, select") || c.closest(".modal")) return;
    if (c.classList.contains("fold-on")) { if (!c.classList.contains("fold-open")) c.style.maxHeight = max + "px"; return; }
    if (c.scrollHeight <= max + (desk ? 0 : 60)) return;
    const key = foldKey(c);
    c.classList.add("fold-on"); c.style.setProperty("--fold-max", max + "px");
    const b = document.createElement("button"); b.type = "button"; b.className = "fold-btn";
    const set = on => { c.classList.toggle("fold-open", on); c.style.maxHeight = on ? "" : max + "px"; b.innerHTML = on ? "Show less ▴" : "Show more ▾"; on ? Folds.open.add(key) : Folds.open.delete(key); };
    b.onclick = e => { e.stopPropagation(); const on = !c.classList.contains("fold-open"); set(on); if (!on) c.scrollIntoView({ block: "nearest", behavior: "smooth" }); };
    c.append(b); set(Folds.open.has(key));
  });
}
new MutationObserver(() => { clearTimeout(Folds.t); Folds.t = setTimeout(foldPanels, 120); }).observe(document.getElementById("view") || document.body, { childList: true, subtree: true });
addEventListener("resize", () => { clearTimeout(Folds.t); Folds.t = setTimeout(() => { document.querySelectorAll(".fold-on").forEach(c => { c.classList.remove("fold-on"); c.style.maxHeight = ""; c.querySelector(":scope > .fold-btn")?.remove(); }); foldPanels(); }, 250); });
