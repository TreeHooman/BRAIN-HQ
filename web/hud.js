// HUD layer (JARVIS): motion, effects, Command view, Mission Planner, palette, live ops feed.
// Loads after app.js and uses its globals (S, route, api, act, render, refresh, esc, md, ...). No build step.
"use strict";
const RM = matchMedia("(prefers-reduced-motion: reduce)");
const reduced = () => RM.matches;
const isHud = () => document.documentElement.dataset.theme === "hud";
const hstore = {
  get(k, d = null) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
const HUD = { asleep: false };

// ---------------- sound (Web Audio, muted by default) ----------------
const Snd = {
  ctx: null,
  on: () => hstore.get("hq-sound") === "1",
  ac() { return (Snd.ctx ||= new (window.AudioContext || window.webkitAudioContext)()); },
  blip(f = 880, d = .06, type = "sine", vol = .035) {
    if (!Snd.on()) return;
    try {
      const c = Snd.ac(), o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.value = f;
      g.gain.setValueAtTime(vol, c.currentTime); g.gain.exponentialRampToValueAtTime(.0001, c.currentTime + d);
      o.connect(g).connect(c.destination); o.start(); o.stop(c.currentTime + d + .02);
    } catch {}
  },
  hum(d = 1.8, from = 48, to = 110) {
    if (!Snd.on()) return;
    try {
      const c = Snd.ac(), o = c.createOscillator(), g = c.createGain();
      o.type = "sawtooth"; o.frequency.setValueAtTime(from, c.currentTime); o.frequency.exponentialRampToValueAtTime(to, c.currentTime + d);
      g.gain.setValueAtTime(.0001, c.currentTime); g.gain.exponentialRampToValueAtTime(.025, c.currentTime + d * .3); g.gain.exponentialRampToValueAtTime(.0001, c.currentTime + d);
      o.connect(g).connect(c.destination); o.start(); o.stop(c.currentTime + d + .05);
    } catch {}
  },
};

// ---------------- text effects ----------------
const GLYPHS = "!<>-_\\/[]{}=+*^?#%ABCDEFX0123456789";
function scrambleTo(el, text, ms = 420) {
  if (!el) return;
  text = String(text ?? "");
  if (reduced() || !isHud()) { el.textContent = text; return; }
  const token = (el._scr = (el._scr || 0) + 1), start = performance.now();
  const step = now => {
    if (el._scr !== token) return;
    const p = Math.min(1, (now - start) / ms), n = Math.floor(text.length * p);
    let s = text.slice(0, n);
    for (let i = n; i < text.length; i++) s += /\s/.test(text[i]) ? text[i] : GLYPHS[(Math.random() * GLYPHS.length) | 0];
    el.textContent = p < 1 ? s : text;
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function typeOut(el, text, cps = 70) {
  if (!el) return;
  text = String(text ?? "");
  if (reduced()) { el.textContent = text; return; }
  const token = (el._typ = (el._typ || 0) + 1), start = performance.now();
  el.classList.add("typing-caret");
  const step = now => {
    if (el._typ !== token) return;
    const n = Math.min(text.length, Math.floor((now - start) / 1000 * cps));
    el.textContent = text.slice(0, n);
    if (n < text.length) requestAnimationFrame(step); else el.classList.remove("typing-caret");
  };
  requestAnimationFrame(step);
}
/** Streaming-style reveal of already-rendered HTML: text nodes fill in, structure stays intact. */
function revealHTML(el, maxMs = 1800) {
  if (!el || reduced()) return;
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), nodes = [];
  let total = 0;
  while (w.nextNode()) { const n = w.currentNode; nodes.push([n, n.nodeValue]); total += n.nodeValue.length; n.nodeValue = ""; }
  const cps = Math.max(500, total / (maxMs / 1000)), start = performance.now();
  el.classList.add("revealing");
  const step = now => {
    let left = Math.floor((now - start) / 1000 * cps);
    for (const [n, full] of nodes) { n.nodeValue = full.slice(0, Math.max(0, left)); left -= full.length; }
    if (left < 0) requestAnimationFrame(step); else el.classList.remove("revealing");
  };
  requestAnimationFrame(step);
}
function countUp(el, to, ms = 900) {
  if (!el) return;
  const n = Number(to) || 0;
  if (reduced() || n === 0) { el.textContent = String(n); return; }
  const start = performance.now();
  const step = now => { const p = Math.min(1, (now - start) / ms), e = 1 - Math.pow(1 - p, 3); el.textContent = String(Math.round(n * e)); if (p < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

// ---------------- game-style notifications (replace plain toasts in the HUD theme) ----------------
function hudNotify(msg, ms) {
  let box = document.getElementById("hudNotes");
  if (!box) { box = document.createElement("div"); box.id = "hudNotes"; box.className = "hn-box"; box.setAttribute("role", "status"); box.setAttribute("aria-live", "polite"); document.body.appendChild(box); }
  const text = String(msg).replace(/^⚠\s*/, "");
  const kind = /^⚠/.test(msg) ? "err" : /queued|sorting|retrying|resuming|focus/i.test(msg) ? "info" : "ok";
  const head = { ok: "CONFIRMED", info: "ACKNOWLEDGED", err: "WARNING" }[kind];
  const n = document.createElement("div");
  n.className = `hn ${kind}`;
  n.innerHTML = `<i class="hn-ico" aria-hidden="true">${kind === "err" ? "!" : kind === "info" ? "»" : "✓"}</i><div class="hn-tx"><b>${head}</b><span></span></div><i class="hn-bar" style="animation-duration:${ms || (kind === "err" ? 5200 : 3200)}ms"></i>`;
  box.prepend(n);
  scrambleTo(n.querySelector("span"), text, 360);
  while (box.children.length > 4) box.lastChild.remove();
  kind === "err" ? (Snd.blip(220, .14, "square"), Snd.blip(180, .18, "square")) : (Snd.blip(1320, .05), setTimeout(() => Snd.blip(1760, .07), 70));
  const life = ms || (kind === "err" ? 5200 : 3200);
  setTimeout(() => { n.classList.add("out"); setTimeout(() => n.remove(), 400); }, life);
  n.onclick = () => n.remove();
}

// ---------------- clock + countdowns ----------------
function hudClock() {
  const d = new Date(), c = document.getElementById("clock");
  if (c) c.innerHTML = `<b>${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}</b>${DOW[d.getDay()].toUpperCase()} ${pad(d.getDate())} ${MON[d.getMonth()].toUpperCase()}`;
  for (const el of document.querySelectorAll("[data-countdown]")) {
    const ms = new Date(el.dataset.countdown) - d;
    if (ms <= 0) { el.textContent = "NOW"; continue; }
    const D = Math.floor(ms / 864e5), H = Math.floor(ms / 36e5) % 24, M = Math.floor(ms / 6e4) % 60, Sx = Math.floor(ms / 1e3) % 60;
    el.textContent = `${D ? D + "D " : ""}${pad(H)}:${pad(M)}:${pad(Sx)}`;
  }
}
setInterval(hudClock, 1000);

// ---------------- ticker (bottom log stream) ----------------
const ACT_LABEL = { queued: "QUEUED", started: "STARTED", done: "COMPLETE", failed: "FAILED", timeout: "TIME LIMIT", paused: "PAUSED", resumed: "RESUMED", skipped: "SKIPPED", reminder: "REMINDER", chat: "JARVIS", "approval-requested": "APPROVAL", approved: "APPROVED", rejected: "REJECTED", "needs-login": "SIGN-IN", "mission-created": "MISSION", cancelled: "CANCELLED", error: "ERROR" };
function hudTicker() {
  const t = document.getElementById("ticker");
  if (!t || !S) return;
  const items = S.activity.slice(0, 14).map(a => `<span><b>${ACT_LABEL[a.event] || esc(String(a.event).toUpperCase())}</b>${esc(a.title || (a.event === "chat" ? (a.ok ? "reply delivered" : "reply failed") : ""))} <i>${ago(a.at)}</i></span>`);
  const due = S.reminders.filter(r => !r.done && toDate(r.due) >= new Date()).slice(0, 4).map(r => `<span><b>DUE ${esc(fmtWhen(r.due).toUpperCase())}</b>${esc(r.title)}</span>`);
  const html = [...due, ...items].join("") || "<span>No activity yet</span>";
  if (t._html === html) return;
  t._html = html;
  t.innerHTML = `<div class="lbl"><i></i>LIVE</div><div class="track">${html}</div>`;
}

// ---------------- background: particles + grid (canvas) ----------------
const BG = { c: null, x: null, w: 0, h: 0, dpr: 1, pts: [], mx: -1e4, my: -1e4, raf: 0, frame: 0, grid: null };
function bgSize() {
  const c = BG.c; if (!c) return;
  BG.dpr = Math.min(1.5, window.devicePixelRatio || 1);
  BG.w = innerWidth; BG.h = innerHeight;
  c.width = BG.w * BG.dpr; c.height = BG.h * BG.dpr;
  BG.x.setTransform(BG.dpr, 0, 0, BG.dpr, 0, 0);
  const n = Math.min(90, Math.round(BG.w * BG.h / 21000));
  while (BG.pts.length < n) BG.pts.push({ x: Math.random() * BG.w, y: Math.random() * BG.h, vx: (Math.random() - .5) * .25, vy: (Math.random() - .5) * .25, r: Math.random() * 1.4 + .4 });
  BG.pts.length = n;
  // grid pattern rendered once
  const g = document.createElement("canvas"); g.width = 56; g.height = 56;
  const gx = g.getContext("2d"); gx.strokeStyle = "rgba(0,229,255,.045)"; gx.lineWidth = 1;
  gx.beginPath(); gx.moveTo(0, .5); gx.lineTo(56, .5); gx.moveTo(.5, 0); gx.lineTo(.5, 56); gx.stroke();
  gx.fillStyle = "rgba(0,229,255,.12)"; gx.fillRect(0, 0, 1.5, 1.5);
  BG.grid = BG.x.createPattern(g, "repeat");
}
function bgDraw() {
  const x = BG.x, busy = document.body.classList.contains("ops-busy");
  x.clearRect(0, 0, BG.w, BG.h);
  x.fillStyle = BG.grid; x.fillRect(0, 0, BG.w, BG.h);
  const sp = busy ? 2.2 : 1;
  for (const p of BG.pts) {
    const dx = BG.mx - p.x, dy = BG.my - p.y, d2 = dx * dx + dy * dy;
    if (d2 < 32000) { p.vx += dx / 9000; p.vy += dy / 9000; }
    p.vx *= .985; p.vy *= .985;
    if (Math.abs(p.vx) < .05) p.vx += (Math.random() - .5) * .04;
    if (Math.abs(p.vy) < .05) p.vy += (Math.random() - .5) * .04;
    p.x += p.vx * sp; p.y += p.vy * sp;
    if (p.x < -10) p.x = BG.w + 10; if (p.x > BG.w + 10) p.x = -10; if (p.y < -10) p.y = BG.h + 10; if (p.y > BG.h + 10) p.y = -10;
  }
  x.lineWidth = .6;
  for (let i = 0; i < BG.pts.length; i++) for (let j = i + 1; j < BG.pts.length; j++) {
    const a = BG.pts[i], b = BG.pts[j], dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
    if (d2 < 12000) { x.strokeStyle = `rgba(0,229,255,${(1 - d2 / 12000) * .16})`; x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke(); }
  }
  x.fillStyle = "rgba(120,240,255,.75)";
  for (const p of BG.pts) { x.beginPath(); x.arc(p.x, p.y, p.r, 0, 6.283); x.fill(); }
}
function bgLoop() {
  BG.raf = 0;
  if (!isHud() || document.hidden || HUD.asleep) return;
  if (++BG.frame % 2 === 0) bgDraw(); // ~30 fps is plenty for ambience
  if (!reduced()) BG.raf = requestAnimationFrame(bgLoop);
}
function bgStart() {
  BG.c = document.getElementById("bgfx"); if (!BG.c) return;
  BG.x = BG.c.getContext("2d"); bgSize();
  if (reduced()) { bgDraw(); return; }
  if (!BG.raf) BG.raf = requestAnimationFrame(bgLoop);
}
addEventListener("resize", () => { if (BG.c) { bgSize(); if (reduced()) bgDraw(); } navGlide(); });
addEventListener("mousemove", e => { BG.mx = e.clientX; BG.my = e.clientY; }, { passive: true });
document.addEventListener("visibilitychange", () => { if (!document.hidden) bgStart(); });

// ---------------- sidebar glide indicator ----------------
function navGlide() {
  const nav = document.getElementById("nav"); if (!nav) return;
  let g = nav.querySelector(".nav-glow");
  if (!g) { g = document.createElement("i"); g.className = "nav-glow"; g.setAttribute("aria-hidden", "true"); nav.prepend(g); nav.classList.add("glide"); }
  const on = nav.querySelector("a.on");
  if (!on) { g.style.opacity = "0"; return; }
  g.style.opacity = "1";
  g.style.height = on.offsetHeight + "px";
  g.style.transform = `translateY(${on.offsetTop}px)`;
}

// ---------------- view transitions + per-render hooks ----------------
let lastView = null;
function hudAfterRender(el, background) {
  navGlide();
  if (!background && route.view !== lastView) {
    lastView = route.view;
    if (!reduced()) {
      el.classList.remove("view-in"); void el.offsetWidth; el.classList.add("view-in");
      Snd.blip(660, .05, "triangle");
    }
  }
  bindTilt(el);
}
function bindTilt(root) {
  if (!isHud() || reduced() || !matchMedia("(pointer: fine)").matches) return;
  for (const c of root.querySelectorAll(".tilt")) {
    if (c._tilt) continue; c._tilt = 1;
    c.addEventListener("mousemove", e => { const r = c.getBoundingClientRect(), px = (e.clientX - r.left) / r.width - .5, py = (e.clientY - r.top) / r.height - .5; c.style.transform = `perspective(900px) rotateY(${px * 5}deg) rotateX(${-py * 5}deg)`; });
    c.addEventListener("mouseleave", () => { c.style.transform = ""; });
  }
}

// ---------------- active project focus + switcher ----------------
function activeProject() {
  const s = hstore.get("hq-project", "");
  return S && s && S.projects.some(p => p.slug === s) ? s : "";
}
function setActiveProject(slug, quiet) {
  hstore.set("hq-project", slug || "");
  try { sessionStorage.setItem("chatProject", slug || ""); } catch {}
  pswRender();
  if (!quiet) hudNotify(slug ? `Focus: ${projName(slug)}` : "Focus: all projects");
  if (["command", "assistant", "home", "planner"].includes(route.view)) { render.background = false; render(); }
}
const HEALTH_LED = { good: "", watch: "amber", risk: "red", unknown: "off" };
function pswRender() {
  const box = document.getElementById("psw"); if (!box || !S) return;
  const ap = activeProject(), p = S.projects.find(x => x.slug === ap);
  const list = S.projects.slice(0, 30);
  box.innerHTML = `<button type="button" class="psw-btn" aria-haspopup="listbox" aria-expanded="false" title="Switch project (Ctrl/Alt + 1–9)">
      <span class="led ${p ? HEALTH_LED[p.health] || "" : "off"}"></span><span class="psw-name">${p ? esc(p.name) : "All projects"}</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg></button>
    <div class="psw-menu" role="listbox" hidden>
      <button type="button" role="option" data-psw="" class="${ap ? "" : "on"}"><span class="led off"></span><span class="grow">All projects</span><kbd class="kbd">0</kbd></button>
      ${list.map((x, i) => `<button type="button" role="option" data-psw="${x.slug}" class="${x.slug === ap ? "on" : ""}"><span class="led ${HEALTH_LED[x.health] || ""}"></span><span class="grow">${esc(x.name)}<small>${esc(x.stage)}</small></span>${i < 9 ? `<kbd class="kbd">${i + 1}</kbd>` : ""}</button>`).join("")}
    </div>`;
  const btn = box.querySelector(".psw-btn"), menu = box.querySelector(".psw-menu");
  btn.onclick = e => { e.stopPropagation(); const open = menu.hidden; menu.hidden = !open; btn.setAttribute("aria-expanded", String(open)); if (open) Snd.blip(990, .04); };
  menu.querySelectorAll("[data-psw]").forEach(b => b.onclick = () => { menu.hidden = true; setActiveProject(b.dataset.psw); });
}
document.addEventListener("click", e => { const m = document.querySelector(".psw-menu"); if (m && !m.hidden && !e.target.closest("#psw")) m.hidden = true; });

// ---------------- model tier switch (Fast / Balanced / Opus) ----------------
const cap = s => String(s || "").charAt(0).toUpperCase() + String(s || "").slice(1);
function tierModel(t) { return S?.settings?.models?.tiers?.[t]?.model || { fast: "haiku", balanced: "sonnet", deep: "opus" }[t]; }
function currentTier() { const t = hstore.get("hq-tier", ""); return ["fast", "balanced", "deep"].includes(t) ? t : (S?.settings?.chatTier || "balanced"); }
function tierSwitch() {
  const cur = currentTier();
  const b = (t, label) => `<button type="button" data-tier="${t}" class="${cur === t ? "on" : ""}" aria-pressed="${cur === t}" title="${esc(S.settings.models.tiers?.[t]?.use || "")}">${label}</button>`;
  return `<div class="tiers" role="group" aria-label="Model">${b("fast", `Fast <small>${cap(tierModel("fast"))}</small>`)}${b("balanced", `Balanced <small>${cap(tierModel("balanced"))}</small>`)}${b("deep", cap(tierModel("deep")))}</div>
    <div class="tier-warn" ${cur === "deep" ? "" : "hidden"}>⚠ ${cap(tierModel("deep"))} uses your Pro usage limit much faster. Switch back when you're done.</div>`;
}
function bindTierSwitch(root) {
  root.querySelectorAll(".tiers [data-tier]").forEach(b => b.onclick = () => {
    hstore.set("hq-tier", b.dataset.tier);
    root.querySelectorAll(".tiers [data-tier]").forEach(x => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", String(x === b)); });
    root.querySelectorAll(".tier-warn").forEach(w => w.hidden = b.dataset.tier !== "deep");
    Snd.blip(b.dataset.tier === "deep" ? 520 : 880, .06, "triangle");
  });
}
const TIER_OPTS = () => [["fast", `Fast · ${cap(tierModel("fast"))}`], ["balanced", `Balanced · ${cap(tierModel("balanced"))}`], ["deep", `${cap(tierModel("deep"))} (uses limit fast)`]];

// ---------------- command palette (Ctrl+K) ----------------
const Pal = { items: [], shown: [], sel: 0, remote: [], timer: 0, q: "" };
const VIEWS = [["command", "Command", "◎"], ["home", "Today", "▦"], ["assistant", "JARVIS", "✦"], ["projects", "Projects", "▣"], ["planner", "Mission Planner", "⬡"], ["calendar", "Calendar", "▤"], ["roadmap", "Roadmap", "≡"], ["inbox", "Inbox", "⇩"], ["missions", "Missions", "➤"], ["settings", "Settings", "⚙"]];
function palBase() {
  const go = h => () => { location.hash = h; };
  const it = [];
  for (const [v, t, i] of VIEWS) it.push({ sec: "Go to", ico: i, t, run: go(v) });
  it.push(
    { sec: "Actions", ico: "✦", t: "Ask JARVIS…", sub: "Open the assistant and talk", run: go("assistant") },
    { sec: "Actions", ico: "🎙", t: "Talk to JARVIS (voice)", sub: "Alt+J", run: () => { sessionStorage.setItem("hq-listen", "1"); location.hash = "assistant"; } },
    { sec: "Actions", ico: "+", t: "New reminder", run: () => addOnDayModal(ymd(new Date())) },
    { sec: "Actions", ico: "+", t: "New goal", sub: "Mission Planner", run: () => { location.hash = "planner"; setTimeout(goalModal, 50); } },
    { sec: "Actions", ico: "+", t: "New project", run: () => { location.hash = "projects"; setTimeout(newProjectModal, 50); } },
    { sec: "Actions", ico: "◐", t: `Switch theme to ${isHud() ? "Calm" : "HUD"}`, run: () => setTheme(isHud() ? "calm" : "hud") },
    { sec: "Actions", ico: "♪", t: `Sound effects ${Snd.on() ? "off" : "on"}`, run: () => setSound(!Snd.on()) },
    { sec: "Actions", ico: "◎", t: `Model: ${cap(tierModel("deep"))} (deep)`, sub: "Uses your usage limit faster", run: () => { hstore.set("hq-tier", "deep"); hudNotify(`Model set to ${cap(tierModel("deep"))}`); render(); } },
    { sec: "Actions", ico: "◎", t: `Model: ${cap(tierModel("balanced"))} (balanced)`, run: () => { hstore.set("hq-tier", "balanced"); hudNotify(`Model set to ${cap(tierModel("balanced"))}`); render(); } },
    { sec: "Actions", ico: "↻", t: "Replay boot sequence", run: () => hudBoot(false) },
    { sec: "Actions", ico: "⏻", t: "Shut down HQ (screen)", sub: "Power-down sequence; click to wake", run: () => hudShutdown() },
  );
  if (!S) return it;
  S.projects.forEach((p, i) => {
    it.push({ sec: "Projects", ico: "▣", t: p.name, sub: `${p.stage} · ${p.nextStep || p.summary || ""}`, run: go("project/" + p.slug) });
    it.push({ sec: "Focus", ico: "◉", t: `Switch to ${p.name}`, sub: i < 9 ? `Ctrl+${i + 1}` : "Set the active project", run: () => setActiveProject(p.slug) });
  });
  it.push({ sec: "Focus", ico: "◉", t: "Switch to all projects", sub: "Ctrl+0", run: () => setActiveProject("") });
  S.reminders.filter(r => !r.done).forEach(r => it.push({ sec: "Reminders", ico: "⏰", t: r.title, sub: `${fmtWhen(r.due)}${r.project ? " · " + projName(r.project) : ""}`, run: go(r.project ? "project/" + r.project : "home") }));
  S.milestones.filter(m => !m.done).forEach(m => it.push({ sec: "Milestones", ico: "◆", t: m.title, sub: `${m.date}${m.project ? " · " + projName(m.project) : ""}`, run: go("roadmap") }));
  S.missions.forEach(m => it.push({ sec: "Missions", ico: "➤", t: m.title, sub: m.scheduleText, run: go("missions") }));
  (S.goals || []).forEach(g => it.push({ sec: "Goals", ico: "⬡", t: g.title, sub: g.project ? projName(g.project) : "", run: go("planner") }));
  S.inbox.forEach(n => it.push({ sec: "Inbox", ico: "⇩", t: n.text.slice(0, 90), run: go("inbox") }));
  (S.decisions || []).forEach(d => it.push({ sec: "Decisions", ico: "⚑", t: d.replace(/^-\s*/, "").replace(/\*\*/g, "").slice(0, 110), run: go("roadmap") }));
  return it;
}
function fuzzy(q, s) {
  s = s.toLowerCase(); let i = 0, score = 0, last = -2;
  const hits = [];
  for (let k = 0; k < s.length && i < q.length; k++) if (s[k] === q[i]) { score += last === k - 1 ? 3 : 1; if (k === 0 || s[k - 1] === " ") score += 2; hits.push(k); last = k; i++; }
  return i === q.length ? { score: score - s.length * .01, hits } : null;
}
function markHits(t, hits) { if (!hits?.length) return esc(t); const set = new Set(hits); return [...t].map((c, i) => set.has(i) ? `<mark>${esc(c)}</mark>` : esc(c)).join(""); }
function palFilter() {
  const q = Pal.q.trim().toLowerCase();
  let list;
  if (!q) list = Pal.items.filter(x => ["Go to", "Actions", "Focus"].includes(x.sec)).map(x => ({ ...x, hits: [] }));
  else {
    list = [];
    for (const x of [...Pal.items, ...Pal.remote]) {
      const m = fuzzy(q, x.t) || (x.sub ? fuzzy(q, x.sub) : null);
      if (m) list.push({ ...x, hits: fuzzy(q, x.t)?.hits || [], score: m.score + (fuzzy(q, x.t) ? 20 : 0) + (x.remote ? -1 : 0) });
    }
    list.sort((a, b) => b.score - a.score);
  }
  Pal.shown = list.slice(0, 60);
  Pal.sel = Math.min(Pal.sel, Math.max(0, Pal.shown.length - 1));
  const box = document.getElementById("palList");
  if (!Pal.shown.length) { box.innerHTML = `<div class="empty" style="padding:14px">No matches. ${q.length >= 3 ? "Searching the brain…" : ""}</div>`; return; }
  // keep sections grouped in score order of first appearance
  const order = [], groups = {};
  Pal.shown.forEach((x, i) => { x.i = i; (groups[x.sec] ||= (order.push(x.sec), [])).push(x); });
  Pal.shown = order.flatMap(s => groups[s]); Pal.shown.forEach((x, i) => x.i = i);
  box.innerHTML = order.map(s => `<div class="pal-sec">${esc(s)}</div>${groups[s].map(x => `<div class="pal-item ${x.i === Pal.sel ? "sel" : ""}" data-i="${x.i}" role="option" aria-selected="${x.i === Pal.sel}"><span class="ico">${esc(x.ico)}</span><span class="tx"><div>${markHits(x.t, x.hits)}</div>${x.sub ? `<small>${esc(x.sub)}</small>` : ""}</span></div>`).join("")}`).join("");
  box.querySelector(".pal-item.sel")?.scrollIntoView({ block: "nearest" });
}
function palOpen(q = "") {
  Pal.items = palBase(); Pal.remote = []; Pal.sel = 0; Pal.q = q;
  const p = document.getElementById("pal"); p.hidden = false;
  const inp = document.getElementById("palInput"); inp.value = q; inp.focus();
  palFilter(); Snd.blip(1180, .05);
}
function palClose() { document.getElementById("pal").hidden = true; }
function palRun(i) { const x = Pal.shown[i]; if (!x) return; palClose(); Snd.blip(1500, .05); x.run(); }
document.getElementById("palInput").addEventListener("input", e => {
  Pal.q = e.target.value; Pal.sel = 0; Pal.remote = []; palFilter();
  clearTimeout(Pal.timer);
  const q = Pal.q.trim();
  if (q.length >= 3) Pal.timer = setTimeout(async () => {
    const r = await api("/search?q=" + encodeURIComponent(q)).catch(() => []);
    if (Pal.q.trim() !== q || !Array.isArray(r)) return;
    Pal.remote = r.slice(0, 20).map(h => ({ sec: "In the brain", ico: "⌕", t: h.text.replace(/^[-*#>\s]+/, "").replace(/\*\*/g, ""), sub: `${h.file}:${h.line}`, remote: true, run: () => { location.hash = h.project ? "project/" + h.project : h.file.startsWith("briefs/") ? "home" : "roadmap"; } }));
    palFilter();
  }, 220);
});
document.getElementById("palInput").addEventListener("keydown", e => {
  if (e.key === "ArrowDown") { e.preventDefault(); Pal.sel = Math.min(Pal.shown.length - 1, Pal.sel + 1); palFilter(); }
  else if (e.key === "ArrowUp") { e.preventDefault(); Pal.sel = Math.max(0, Pal.sel - 1); palFilter(); }
  else if (e.key === "Enter") { e.preventDefault(); palRun(Pal.sel); }
  else if (e.key === "Escape") { e.preventDefault(); palClose(); }
});
document.getElementById("palList").addEventListener("mousemove", e => { const it = e.target.closest(".pal-item"); if (it && Number(it.dataset.i) !== Pal.sel) { Pal.sel = Number(it.dataset.i); document.querySelectorAll("#palList .pal-item").forEach(x => x.classList.toggle("sel", Number(x.dataset.i) === Pal.sel)); } });
document.getElementById("palList").addEventListener("click", e => { const it = e.target.closest(".pal-item"); if (it) palRun(Number(it.dataset.i)); });
document.getElementById("pal").addEventListener("click", e => { if (e.target.id === "pal") palClose(); });
document.getElementById("openPal").addEventListener("click", () => palOpen());

document.addEventListener("keydown", e => {
  if (HUD.asleep) return;
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "");
  if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) { e.preventDefault(); document.getElementById("pal").hidden ? palOpen() : palClose(); return; }
  if ((e.ctrlKey || e.altKey) && !e.shiftKey && /^[0-9]$/.test(e.key) && S && (!typing || e.altKey)) {
    const i = Number(e.key);
    if (i === 0) { e.preventDefault(); setActiveProject(""); return; }
    const p = S.projects[i - 1]; if (p) { e.preventDefault(); setActiveProject(p.slug); }
  }
  if (e.key === "Escape") { const m = document.querySelector(".psw-menu"); if (m) m.hidden = true; }
});

// ---------------- theme + sound toggles ----------------
function setTheme(t) {
  document.documentElement.dataset.theme = t; hstore.set("hq-theme", t);
  if (t === "hud") bgStart();
  render.background = false; render(); renderChrome(); hudNotify(`Theme: ${t === "hud" ? "HUD" : "Calm"}`);
}
function setSound(on) { hstore.set("hq-sound", on ? "1" : "0"); if (on) Snd.blip(1320, .08); hudNotify(`Sound effects ${on ? "on" : "off"}`); if (route.view === "settings") render(); }

// ---------------- boot + shutdown ----------------
const CORE_MINI = `<svg class="boot-core" viewBox="0 0 160 160" aria-hidden="true"><circle class="bc1" cx="80" cy="80" r="74" pathLength="100"/><circle class="bc2" cx="80" cy="80" r="58" pathLength="100" stroke-dasharray="4 3"/><circle class="bc3" cx="80" cy="80" r="42" pathLength="100"/><circle class="bc-orb" cx="80" cy="80" r="18"/></svg>`;
function hudBoot(short) {
  return new Promise(resolve => {
    const b = document.getElementById("boot");
    if (!b) return resolve();
    const lines = short
      ? ["REACTIVATING CORE", "RESTORING SESSION", "LINK TO HQ SERVER"]
      : ["INITIALIZING SYSTEMS…", "LOADING BRAIN INDEX", `MOUNTING ${S ? S.projects.length : "—"} PROJECT MODULES`, "SYNCING REMINDERS + MILESTONES", "CLAUDE CODE LINK " + (S?.status?.auth === "ok" ? "ESTABLISHED" : "STANDBY"), "CALIBRATING HUD"];
    const per = short ? 160 : 330;
    b.className = "boot" + (short ? " short" : "");
    b.innerHTML = `<div class="boot-inner">${CORE_MINI}<div class="boot-lines">${lines.map((l, i) => `<div style="animation-delay:${200 + i * per}ms" class="ok">&gt; ${esc(l)}</div>`).join("")}</div>
      <div class="boot-bar"><i style="animation-duration:${200 + lines.length * per}ms"></i></div><div class="boot-final" id="bootFinal"></div></div><div class="boot-skip">CLICK OR PRESS ANY KEY TO SKIP</div>`;
    b.hidden = false;
    Snd.hum(short ? 1 : 2.4);
    lines.forEach((_, i) => setTimeout(() => Snd.blip(700 + i * 90, .04, "square", .02), 200 + i * per));
    let done = false;
    const finish = () => {
      if (done) return; done = true;
      document.removeEventListener("keydown", finish, true);
      b.classList.add("out");
      setTimeout(() => { b.hidden = true; b.className = "boot"; b.innerHTML = ""; const v = document.getElementById("view"); v.classList.remove("view-in"); void v.offsetWidth; v.classList.add("view-in"); navGlide(); resolve(); }, 480);
    };
    const total = 200 + lines.length * per;
    setTimeout(() => { if (done) return; const f = document.getElementById("bootFinal"); if (f) { f.style.opacity = 1; scrambleTo(f, short ? "WELCOME BACK, SIR" : "ALL SYSTEMS ONLINE", 500); } Snd.blip(1760, .12); }, total);
    setTimeout(finish, total + (short ? 700 : 1100));
    b.onclick = finish;
    document.addEventListener("keydown", finish, true);
  });
}
function hudShutdown() {
  if (HUD.asleep) return;
  const b = document.getElementById("boot");
  Snd.blip(880, .08, "triangle"); setTimeout(() => Snd.blip(660, .1, "triangle"), 120); setTimeout(() => Snd.hum(1.4, 110, 40), 200);
  document.body.classList.add("pd");
  const fold = reduced() ? 0 : 650;
  setTimeout(() => {
    HUD.asleep = true;
    b.className = "boot shut"; b.hidden = false;
    b.innerHTML = `<div class="boot-inner">${CORE_MINI}<div class="boot-final" id="bootFinal" style="opacity:1"></div><div class="boot-sub">Missions and reminders keep running in the background.</div></div><div class="boot-skip">CLICK OR PRESS ANY KEY TO WAKE</div>`;
    scrambleTo(document.getElementById("bootFinal"), "JARVIS OFFLINE", 600);
    setTimeout(() => b.classList.add("black"), reduced() ? 0 : 2600);
    const wake = e => {
      if (e?.type === "keydown" && ["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
      document.removeEventListener("keydown", wake, true); b.onclick = null;
      HUD.asleep = false; document.body.classList.remove("pd");
      bgStart();
      if (reduced() || !isHud()) { b.hidden = true; b.innerHTML = ""; return; }
      hudBoot(true);
    };
    setTimeout(() => { b.onclick = wake; document.addEventListener("keydown", wake, true); }, 500);
  }, fold);
}

// ---------------- live operations feed (reel-style agent tiles) ----------------
const SPIN = ["·", "✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳", "✢"];
const VERBS = ["Spelunking", "Wrangling", "Grokking", "Pondering", "Schlepping", "Untangling", "Calibrating", "Triangulating", "Synthesizing", "Decrypting", "Cross-referencing", "Reticulating"];
const Ops = { timer: 0, tiles: new Map(), seen: new Map(), min: hstore.get("hq-ops-min") === "1", open: false, spin: 0, data: null, failCount: 0 };
const fmtDur = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return s >= 3600 ? `${Math.floor(s / 3600)}h ${pad(Math.floor(s / 60) % 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m ${pad(s % 60)}s` : `${s}s`; };
function opsEl() {
  let d = document.getElementById("ops");
  if (!d) return null;
  if (!d._init) {
    d._init = 1;
    d.innerHTML = `<div class="ops-head"><span class="ops-title"><i class="ops-dot"></i><b>OPERATIONS</b><span class="ops-sub"></span></span><button type="button" class="ops-min" aria-label="Collapse operations feed"></button></div><div class="ops-grid"></div><div class="ops-bar"></div>`;
    d.querySelector(".ops-min").onclick = () => {
      const folded = d.classList.contains("min");
      Ops.min = !folded; Ops.open = folded; hstore.set("hq-ops-min", Ops.min ? "1" : "0");
      d.classList.toggle("min", !folded);
    };
    d.querySelector(".ops-head").ondblclick = () => d.querySelector(".ops-min").click();
  }
  return d;
}
function stepHTML(s) {
  if (s.kind === "text") return `<div class="ol say"><span class="ob">✦</span><span class="otx"></span></div>`;
  const brainish = s.tool === "brain";
  const diff = (s.diff || []).slice(0, 5).map(l => `<div class="od ${l[0] === "+" ? "add" : "del"}">${esc(l[0])} ${esc(l.slice(1))}</div>`).join("");
  return `<div class="ol t-${esc(s.tool)}"><span class="ob">●</span>${brainish ? `<span class="otx"></span>` : `<span class="ov">${esc(s.verb)}</span><span class="otg">(<span class="otx"></span>)</span>`}</div>
    <div class="or" ${s.result ? "" : "hidden"}>⎿ <span class="orx ${s.ok === false ? "bad" : ""}">${esc(s.result || "")}</span></div>${diff}`;
}
function opsRender(d) {
  const box = opsEl(); if (!box) return;
  const list = Array.isArray(d?.ops) ? d.ops : [];
  Ops.data = list;
  const running = list.filter(o => o.status === "running");
  document.body.classList.toggle("ops-busy", running.length > 0);
  box.hidden = !list.length;
  document.body.classList.toggle("has-ops", list.length > 0);
  if (!list.length) { Ops.tiles.clear(); box.querySelector(".ops-grid").innerHTML = ""; coreState(); return; }
  // finished work folds down to the status bar so it doesn't cover the page
  box.classList.toggle("min", running.length ? Ops.min : !Ops.open);
  box.classList.toggle("busy", running.length > 0);
  const grid = box.querySelector(".ops-grid");
  const ids = new Set(list.map(o => o.id));
  for (const [id, t] of Ops.tiles) if (!ids.has(id)) { t.el.remove(); Ops.tiles.delete(id); }
  for (const o of list) {
    let t = Ops.tiles.get(o.id);
    if (!t) {
      const el = document.createElement("section");
      el.className = "op"; el.setAttribute("aria-label", o.title);
      el.innerHTML = `<header><span class="op-kind">${o.kind === "chat" ? "JARVIS" : "MISSION"}</span><b class="op-t"></b><small>${esc(cap(o.model))}${o.project ? " · " + esc(projName(o.project)) : ""}${o.level ? " · " + esc(o.level) : ""}</small></header><div class="op-body"></div><footer><span class="op-spin">✻</span> <span class="op-verb"></span> <span class="op-el"></span></footer>`;
      grid.appendChild(el);
      scrambleTo(el.querySelector(".op-t"), o.title, 500);
      t = { el, steps: new Map(), status: null };
      Ops.tiles.set(o.id, t);
      if (Ops.seen.get(o.id) !== "running" && o.status === "running") { Snd.blip(520, .1, "triangle"); setTimeout(() => Snd.blip(780, .1, "triangle"), 110); if (Ops.min && list.length === 1) { Ops.min = false; box.classList.remove("min"); } }
    }
    const body = t.el.querySelector(".op-body");
    let added = false;
    for (const s of o.steps) {
      const prev = t.steps.get(s.id);
      if (!prev) {
        const wrap = document.createElement("div");
        wrap.className = "ostep new"; wrap.innerHTML = stepHTML(s);
        body.appendChild(wrap);
        const tx = wrap.querySelector(".otx");
        if (s.kind === "text") typeOut(tx, s.target, 90); else scrambleTo(tx, s.target, 380);
        setTimeout(() => wrap.classList.remove("new"), 900);
        t.steps.set(s.id, { wrap, result: s.result });
        added = true;
        Snd.blip(s.tool === "edit" || s.tool === "write" ? 1480 : 1100, .03, "square", .015);
      } else if (s.result && prev.result !== s.result) {
        const r = prev.wrap.querySelector(".or"); r.hidden = false;
        const rx = r.querySelector(".orx"); rx.classList.toggle("bad", s.ok === false); scrambleTo(rx, s.result, 300);
        prev.result = s.result;
        added = true;
      }
    }
    // the active line glows: the newest step that hasn't returned yet
    const last = [...t.steps.values()].pop();
    body.querySelectorAll(".ostep.active").forEach(x => x.classList.remove("active"));
    if (o.status === "running" && last && !last.result && !last.wrap.querySelector(".say")) last.wrap.classList.add("active");
    while (body.children.length > 40) body.firstChild.remove();
    if (added) requestAnimationFrame(() => { body.scrollTop = body.scrollHeight; });
    if (t.status !== o.status) {
      t.el.classList.toggle("done", o.status === "done"); t.el.classList.toggle("failed", o.status === "failed");
      if (t.status === "running" && o.status !== "running") {
        hudNotify(o.status === "done" ? `Operation complete: ${o.title}` : `⚠ Operation failed: ${o.title}`);
        if (o.kind === "chat") onChatOpDone();
        refresh().then(() => { if (!["assistant", "command", "planner"].includes(route.view)) { render.background = true; render(); render.background = false; } });
      }
      t.status = o.status;
    }
    t.el.dataset.started = o.startedAt; t.el.dataset.ended = o.endedAt || "";
    Ops.seen.set(o.id, o.status);
  }
  const calls = list.reduce((n, o) => n + o.calls, 0), add = list.reduce((n, o) => n + o.added, 0), rem = list.reduce((n, o) => n + o.removed, 0);
  const first = Math.min(...list.map(o => o.startedAt));
  box.querySelector(".ops-sub").textContent = running.length ? ` · ${running.length > 1 ? "Orchestrating" : "In progress"}… (${fmtDur(Date.now() - first)} · ${running.length} op${running.length > 1 ? "s" : ""})` : " · Complete";
  box.querySelector(".ops-bar").innerHTML = `<span><b>${running.length}/${list.length}</b> operations running</span><span><b>${calls.toLocaleString()}</b> calls</span><span class="add">+${add.toLocaleString()}</span><span class="del">−${rem.toLocaleString()}</span>`;
  coreState();
}
function opsAnimate() {
  if (!Ops.tiles.size) return;
  Ops.spin++;
  const verb = VERBS[Math.floor(Ops.spin / 24) % VERBS.length];
  for (const t of Ops.tiles.values()) {
    const run = t.status === "running";
    const sp = t.el.querySelector(".op-spin"), vb = t.el.querySelector(".op-verb"), el = t.el.querySelector(".op-el");
    sp.textContent = run ? SPIN[Ops.spin % SPIN.length] : t.status === "done" ? "✓" : "✗";
    const want = run ? verb + "…" : t.status === "done" ? "Complete" : "Failed";
    if (vb.dataset.v !== want) { vb.dataset.v = want; scrambleTo(vb, want, 300); }
    const st = Number(t.el.dataset.started), en = Number(t.el.dataset.ended) || Date.now();
    el.textContent = `(${fmtDur(en - st)})`;
  }
}
setInterval(opsAnimate, 110);
async function opsTick() {
  clearTimeout(Ops.timer);
  let d = null;
  try { const r = await fetch("/api/live"); if (r.ok) d = await r.json(); } catch {}
  if (d) opsRender(d);
  const busy = Ops.data?.some(o => o.status === "running") || S?.status?.running || S?.status?.chatBusy || Cmd.waiting;
  Ops.timer = setTimeout(opsTick, busy ? 900 : 3500);
}
function opsKick() { clearTimeout(Ops.timer); Ops.timer = setTimeout(opsTick, 250); }

// ---------------- core state (orb reacts to work and voice) ----------------
function coreState() {
  const w = document.querySelector(".core-wrap"); if (!w) return;
  const busy = document.body.classList.contains("ops-busy") || !!S?.status?.chatBusy || Cmd.waiting;
  const listening = !!document.querySelector(".mic.live");
  w.classList.toggle("busy", busy && !listening); w.classList.toggle("listening", listening);
  const lbl = document.getElementById("coreState");
  const want = listening ? "LISTENING" : busy ? "PROCESSING" : S?.status?.running ? "WORKING" : "STANDBY";
  if (lbl && lbl.dataset.v !== want) { lbl.dataset.v = want; scrambleTo(lbl, want, 400); }
}
function corePing() {
  const w = document.querySelector(".core-wrap"); if (!w || reduced()) return;
  const p = document.createElement("i"); p.className = "ping"; w.appendChild(p); setTimeout(() => p.remove(), 2300);
}

// ---------------- Command view ----------------
const Cmd = { waiting: false, poll: 0, lastShown: null };
function projPct(p) {
  const ph = p.phases || [];
  if (ph.length) return Math.round(ph.reduce((n, x) => n + (x.status === "done" ? 1 : x.status === "active" ? .5 : 0), 0) / ph.length * 100);
  return { idea: 8, planned: 20, building: 50, live: 80, paused: 35, done: 100 }[p.stage] ?? 0;
}
const HCOL = { good: "var(--green)", watch: "var(--amber)", risk: "var(--red)", unknown: "var(--text3)" };
function coreSVG() {
  const g = (cls, delay, inner) => `<g class="ring-in" style="animation-delay:${delay}ms"><g class="ring ${cls}">${inner}</g></g>`;
  return `<svg viewBox="0 0 500 500" aria-hidden="true">
    <defs><radialGradient id="orbG"><stop offset="0" stop-color="#ffffff"/><stop offset=".25" style="stop-color:var(--accent)"/><stop offset=".7" style="stop-color:var(--accent);stop-opacity:.25"/><stop offset="1" style="stop-color:var(--accent);stop-opacity:0"/></radialGradient>
      <filter id="glowF" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
    <g fill="none" stroke="currentColor" filter="url(#glowF)">
      ${g("r4", 0, `<circle cx="250" cy="250" r="236" stroke-width="10" stroke-dasharray="1.2 11.1" opacity=".55"/><circle cx="250" cy="250" r="244" stroke-width="1" opacity=".35"/>`)}
      ${g("r1", 120, `<circle cx="250" cy="250" r="212" stroke-width="3" stroke-dasharray="190 36 70 36 330 28" opacity=".9"/>`)}
      ${g("r2", 240, `<circle cx="250" cy="250" r="184" stroke-width="7" stroke-dasharray="7 6" opacity=".38"/>`)}
      ${g("r3", 360, `<circle cx="250" cy="250" r="156" stroke-width="2.5" stroke-dasharray="300 190 120 370" /><circle cx="250" cy="250" r="146" stroke-width="1" opacity=".4"/>`)}
      ${g("r5", 480, `<circle cx="250" cy="250" r="122" stroke-width="12" stroke-dasharray="2 9" opacity=".32"/>`)}
      <g class="ring-in" style="animation-delay:600ms"><circle cx="250" cy="250" r="98" stroke-width="1.2" opacity=".5"/><path d="M250 140v22M250 338v22M140 250h22M338 250h22" stroke-width="1.5" opacity=".7"/></g>
    </g>
    <circle class="orb" cx="250" cy="250" r="70" fill="url(#orbG)"/>
  </svg>`;
}
async function vCommand(el) {
  const name = S.settings.assistantName || "JARVIS";
  const st = S.status;
  const health = st.auth === "needs-login" || !st.claudeBin ? ["red", "DEGRADED"] : st.pausedUntil && new Date(st.pausedUntil) > new Date() ? ["amber", "PAUSED"] : ["", "NOMINAL"];
  el.innerHTML = `<div class="cmd-head"><div><h1 class="glitch">Command</h1><div class="sys">SYSTEMS <b class="${health[0]}">${health[1]}</b> · CLAUDE LINK <b class="${st.auth === "ok" ? "" : "amber"}">${st.auth === "ok" ? "ONLINE" : st.auth === "needs-login" ? "SIGN-IN NEEDED" : "STANDBY"}</b> · FOCUS <b>${esc(activeProject() ? projName(activeProject()).toUpperCase() : "ALL")}</b></div></div>
      <div class="row"><button class="btn sm" id="cmdPal" type="button">⌕ Search <kbd class="kbd">Ctrl K</kbd></button><button class="btn sm" id="cmdPower" type="button" title="Power-down sequence">⏻ Power down</button></div></div>
    <div class="cmd">
      <div class="cmd-col" id="cmdLeft"></div>
      <div class="cmd-center">
        <div class="core-wrap" id="core">${coreSVG()}<div class="core-label"><div><b>${esc(name)}</b><span id="coreState" data-v="">STANDBY</span></div></div></div>
        <form class="cmd-ask" id="cmdAsk" autocomplete="off"><button type="button" class="btn mic" id="cmdMic" title="Talk (Alt+J)" aria-label="Talk">🎙</button><input id="cmdText" placeholder="How can I help, sir?" aria-label="Ask ${esc(name)}"><button class="btn primary">Send</button></form>
        <div class="cmd-tier">${tierSwitch()}</div>
        <div class="card cmd-reply" id="cmdReply"></div>
      </div>
      <div class="cmd-col" id="cmdRight"></div>
    </div>`;
  cmdFill(false);
  coreState();
  bindTierSwitch(el);
  document.getElementById("cmdPal").onclick = () => palOpen();
  document.getElementById("cmdPower").onclick = () => hudShutdown();
  document.getElementById("cmdAsk").onsubmit = e => { e.preventDefault(); cmdSend(document.getElementById("cmdText").value); };
  document.getElementById("cmdMic").onclick = () => listen((t, done) => { const i = document.getElementById("cmdText"); if (i) i.value = t; if (done) cmdSend(t); }, on => { document.getElementById("cmdMic")?.classList.toggle("live", on); coreState(); if (on) corePing(); });
  if (sessionStorage.getItem("hq-listen") === "1" && route.view === "command") { sessionStorage.removeItem("hq-listen"); document.getElementById("cmdMic").click(); }
  // last exchange
  const c = await api("/chat").catch(() => null);
  if (route.view !== "command") return;
  if (c) { Cmd.waiting = c.busy; cmdShowReply(c, false); if (c.busy) cmdPollStart(); }
}
function cmdShowReply(c, animate) {
  const box = document.getElementById("cmdReply"); if (!box) return;
  const name = S.settings.assistantName || "JARVIS";
  const msgs = c?.messages || [];
  const lastYou = [...msgs].reverse().find(m => m.role === "you");
  const lastHq = [...msgs].reverse().find(m => m.role === "hq");
  if (Cmd.waiting) {
    box.innerHTML = `${lastYou ? `<div class="you-said">› ${esc(lastYou.text)}</div>` : ""}<div class="who">${esc(name.toUpperCase())} · PROCESSING</div><div class="proc"><span class="op-spin">✻</span> <span id="cmdProc"></span></div>`;
    scrambleTo(document.getElementById("cmdProc"), "Working on it. Watch the operations feed below.", 600);
    return;
  }
  if (!lastHq) { box.innerHTML = `<div class="who">${esc(name.toUpperCase())}</div><div class="muted">Standing by. Ask anything: plans, reminders, “what should I focus on today?”</div>`; return; }
  box.innerHTML = `${lastYou ? `<div class="you-said">› ${esc(lastYou.text)}</div>` : ""}<div class="who">${esc(name.toUpperCase())} · ${esc(ago(lastHq.at).toUpperCase())}</div><div class="cmd-md">${md(lastHq.text)}</div>`;
  if (animate) { revealHTML(box.querySelector(".cmd-md")); corePing(); }
}
async function cmdSend(text) {
  text = String(text || "").trim(); if (!text || Cmd.waiting) return;
  const inp = document.getElementById("cmdText"); if (inp) inp.value = "";
  Cmd.waiting = true; Snd.blip(980, .06); corePing();
  cmdShowReply({ messages: [{ role: "you", text }] }, false); coreState();
  try { await api("/chat", "POST", { text, project: activeProject() || null, tier: currentTier() }); }
  catch (e) { Cmd.waiting = false; hudNotify("⚠ " + e.message); coreState(); return; }
  chatState = null; // the JARVIS screen reloads its log next time
  opsKick(); cmdPollStart();
}
function cmdPollStart() {
  clearTimeout(Cmd.poll);
  Cmd.poll = setTimeout(async () => {
    const c = await api("/chat").catch(() => null);
    if (!c) return cmdPollStart();
    if (c.busy) return cmdPollStart();
    const was = Cmd.waiting; Cmd.waiting = false; coreState();
    if (route.view === "command") cmdShowReply(c, was);
    const last = c.messages[c.messages.length - 1];
    if (was && last?.role === "hq") speak(last.text);
    refresh();
  }, 1300);
}
function onChatOpDone() { if (Cmd.waiting) cmdPollStart(); }
function cmdFill(quiet) {
  const L = document.getElementById("cmdLeft"), R = document.getElementById("cmdRight");
  if (!L || !R) return;
  const now = new Date(), st = S.status, ap = activeProject();
  const projs = S.projects.filter(p => p.stage !== "done");
  const C = 94.25;
  L.innerHTML = `<div class="card tilt"><div class="panel-title">Projects <small>${projs.length} tracked</small></div>
      ${projs.map(p => { const pct = projPct(p); return `<div class="ring-row ${p.slug === ap ? "on" : ""}" data-proj="${p.slug}" tabindex="0" role="link" aria-label="${esc(p.name)}, ${pct}%">
        <svg viewBox="0 0 38 38" aria-hidden="true"><circle cx="19" cy="19" r="15" fill="none" stroke="rgba(0,229,255,.12)" stroke-width="3"/><circle class="arc-fill" cx="19" cy="19" r="15" fill="none" stroke="${HCOL[p.health] || HCOL.unknown}" stroke-width="3" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${quiet ? C * (1 - pct / 100) : C}" data-to="${C * (1 - pct / 100)}"/></svg>
        <div class="grow" style="min-width:0"><div class="nm">${esc(p.name)}</div><small>${esc(p.stage)} · ${esc(p.nextStep || p.summary || "")}</small></div><span class="pct">${pct}%</span></div>`; }).join("")}</div>
    <div class="card tilt"><div class="panel-title">Missions <small>${st.queued} queued</small></div>
      ${st.running ? `<div class="alert-row"><span class="led"></span><div><a href="#missions">${esc(st.running.title)}</a><small>RUNNING · ${esc(ago(st.running.startedAt))}</small></div></div>` : ""}
      ${S.missions.filter(m => m.enabled).slice(0, 5).map(m => `<div class="alert-row"><span class="led off"></span><div><a href="#missions">${esc(m.title)}</a><small>${esc(m.scheduleText)} · ${esc(cap(tierModel(m.tier)))}</small></div></div>`).join("") || `<div class="empty">No missions.</div>`}</div>`;
  L.querySelectorAll("[data-proj]").forEach(r => { r.onclick = () => { location.hash = "project/" + r.dataset.proj; }; r.onkeydown = e => { if (e.key === "Enter") r.click(); }; });
  if (!quiet) requestAnimationFrame(() => requestAnimationFrame(() => L.querySelectorAll(".arc-fill").forEach(a => a.setAttribute("stroke-dashoffset", a.dataset.to))));

  const open = S.reminders.filter(r => !r.done);
  const overdue = open.filter(r => toDate(r.due) < now);
  const todayEnd = new Date(ymd(now) + "T23:59");
  const today = open.filter(r => toDate(r.due) >= now && toDate(r.due) <= todayEnd);
  const pend = S.approvals.filter(a => a.status === "pending");
  const alerts = [];
  if (st.auth === "needs-login" || !st.claudeBin) alerts.push(["red", "Claude isn't signed in", "MISSIONS + CHAT WAITING", "#settings"]);
  if (st.pausedUntil && new Date(st.pausedUntil) > now) alerts.push(["amber", `Paused until ${fmtWhen(st.pausedUntil)}`, "USAGE LIMIT", "#missions"]);
  pend.forEach(a => alerts.push(["amber", a.title, "NEEDS YOUR OK", "#missions"]));
  overdue.slice(0, 4).forEach(r => alerts.push(["red", r.title, `OVERDUE · ${fmtWhen(r.due)}`, r.project ? "#project/" + r.project : "#home"]));
  today.slice(0, 3).forEach(r => alerts.push(["", r.title, `TODAY · ${fmtWhen(r.due)}`, r.project ? "#project/" + r.project : "#home"]));
  S.projects.filter(p => p.health === "risk" && p.stage !== "done").forEach(p => alerts.push(["red", `${p.name} at risk`, esc(p.nextStep || "").slice(0, 60).toUpperCase(), "#project/" + p.slug]));
  S.projects.filter(p => p.health === "watch" && p.stage !== "done").forEach(p => alerts.push(["amber", `${p.name}: watch`, "HEALTH", "#project/" + p.slug]));

  // calendar feed: what's left today + the next few days
  const feedOn = (S.calendar?.feeds || []).length > 0;
  const evs = (S.calendar?.upcoming || []).map(e => ({ ...e, s: e.allDay ? toDate(e.start + "T00:00") : new Date(e.start), en: e.allDay ? toDate(e.end + "T00:00") : new Date(e.end) })).filter(e => e.en > now);
  evs.filter(e => !e.allDay && e.s > now && e.s - now <= 45 * 60e3).forEach(e => alerts.unshift(["amber", e.title, `STARTS IN ${Math.max(1, Math.round((e.s - now) / 60e3))} MIN${e.location ? " · " + esc(e.location).toUpperCase().slice(0, 40) : ""}`, "#calendar"]));
  const evTime = e => e.allDay ? "ALL DAY" : `${pad(e.s.getHours())}:${pad(e.s.getMinutes())}`;
  const sched = evs.slice(0, 6).map(e => { const live = !e.allDay && e.s <= now; const day = ymd(e.s) === ymd(now) || e.allDay && e.s <= now ? "" : fmtWhen(ymd(e.s)).toUpperCase() + " · ";
    return `<div class="alert-row"><span class="led ${live ? "" : "off"}"></span><div><a href="#calendar">${esc(e.title)}</a><small>${live ? "NOW · " : day}${evTime(e)}${e.location ? " · " + esc(e.location).toUpperCase().slice(0, 40) : ""}</small></div></div>`; }).join("");
  const upcoming = S.milestones.filter(m => !m.done && toDate(m.date + "T23:59") >= now).sort((a, b) => a.date.localeCompare(b.date));
  const nextDl = upcoming.find(m => m.kind === "deadline") || upcoming[0];
  const horizon = 60;
  const blips = [...upcoming.map(m => ({ d: toDate(m.date + "T12:00"), p: m.project, k: m.kind })), ...open.map(r => ({ d: toDate(r.due), p: r.project, k: "rem" })), ...evs.map(e => ({ d: e.s, p: e.feed, k: "rem" }))]
    .map(x => ({ ...x, days: (x.d - now) / 864e5 })).filter(x => x.days >= 0 && x.days <= horizon).slice(0, 18);
  const hash = s => [...String(s || "hq")].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const runsByDay = Array.from({ length: 14 }, (_, i) => { const d = ymd(new Date(now.getTime() - (13 - i) * 864e5)); return S.runs.filter(r => (r.createdAt || "").slice(0, 10) === d).length; });
  const mx = Math.max(1, ...runsByDay);
  const spark = runsByDay.map((v, i) => `${i ? "L" : "M"}${(i / 13 * 200).toFixed(1)} ${(30 - v / mx * 26).toFixed(1)}`).join(" ");
  const sys = [["runs", `${st.today}`, `RUNS TODAY / ${st.maxRunsPerDay}`], ["queued", st.queued, "QUEUED"], ["rem", open.length, "OPEN REMINDERS"], ["inbox", S.inbox.length, "INBOX"], ["ap", pend.length, "APPROVALS"], ["proj", projs.filter(p => ["building", "live"].includes(p.stage)).length, "ACTIVE PROJECTS"]];
  R.innerHTML = `<div class="card tilt"><div class="panel-title">Alerts <small>${alerts.length || "clear"}</small></div>
      ${alerts.slice(0, 8).map(a => `<div class="alert-row"><span class="led ${a[0]}"></span><div><a href="${a[3]}">${esc(a[1])}</a><small>${a[2]}</small></div></div>`).join("") || `<div class="alert-row"><span class="led"></span><div>All clear<small>NO ALERTS</small></div></div>`}</div>
    ${feedOn ? `<div class="card tilt"><div class="panel-title">Schedule <small>${evs.length ? evs.length + " upcoming" : "clear"}</small></div>${sched || `<div class="alert-row"><span class="led off"></span><div>Nothing scheduled<small>NEXT 14 DAYS</small></div></div>`}</div>` : ""}
    <div class="card tilt"><div class="panel-title">System <small>live</small></div>
      <div class="sysgrid">${sys.map(([k, v, l]) => `<div><b data-count="${v}">${quiet ? v : 0}</b><span>${l}</span></div>`).join("")}</div>
      <svg class="spark" viewBox="0 0 200 32" preserveAspectRatio="none" aria-label="Runs over the last 14 days"><path d="${spark}" ${quiet ? 'style="animation:none;stroke-dashoffset:0"' : ""}/></svg></div>
    ${nextDl ? `<div class="card tilt countdown"><div class="panel-title">Next ${nextDl.kind === "deadline" ? "deadline" : "milestone"} <small>${esc(nextDl.date)}</small></div><b data-countdown="${nextDl.date}T23:59:59">--:--:--</b><div>${esc(nextDl.title)}</div><small>${nextDl.project ? esc(projName(nextDl.project).toUpperCase()) : ""}</small></div>` : ""}
    <div class="card tilt"><div class="panel-title">Radar <small>next ${horizon} days</small></div>
      <div class="radar" role="img" aria-label="${blips.length} upcoming dates">${blips.map(b => { const a = (hash(b.p) % 360) * Math.PI / 180, r = 8 + b.days / horizon * 40; return `<i class="${b.k === "deadline" ? "red" : b.k === "rem" ? "" : "amber"}" style="left:${50 + Math.cos(a) * r}%;top:${50 + Math.sin(a) * r}%;animation-delay:${((hash(b.p) % 360) / 360 * 3.2).toFixed(2)}s"></i>`; }).join("")}</div></div>`;
  R.querySelectorAll("[data-count]").forEach(b => quiet ? (b.textContent = b.dataset.count) : countUp(b, b.dataset.count));
  hudClock();
  bindTilt(document.getElementById("view"));
}

// ---------------- Mission Planner ----------------
const Plan = { open: null, drag: null };
function goalPct(g) { return g.steps.length ? Math.round(g.steps.filter(s => s.done).length / g.steps.length * 100) : 0; }
function vPlanner(el) {
  const ap = activeProject();
  const goals = (S.goals || []).slice().sort((a, b) => (b.project === ap) - (a.project === ap));
  el.innerHTML = `<div class="between"><div><h1>Mission Planner</h1><p class="sub">Goals broken into steps. Drag a step to reorder, click it for details, tick it when it's done.</p></div>
      <div class="row"><button class="btn primary" id="newGoal">+ New goal</button></div></div>
    ${goals.length ? goals.map(g => { const pct = goalPct(g), C = 150.8; const next = g.steps.find(s => !s.done);
      return `<section class="card goal" data-goal="${g.id}">
        <div class="goal-head"><svg class="gring" viewBox="0 0 54 54" aria-hidden="true"><circle cx="27" cy="27" r="24" fill="none" stroke="rgba(0,229,255,.12)" stroke-width="4"/><circle class="arc-fill" cx="27" cy="27" r="24" fill="none" stroke="var(--accent)" stroke-width="4" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C}" data-to="${C * (1 - pct / 100)}" style="transition:stroke-dashoffset 1.4s cubic-bezier(.2,.8,.2,1)"/></svg>
          <div class="grow"><h3>${esc(g.title)}</h3><div class="small muted">${g.project ? `<a href="#project/${g.project}">${esc(projName(g.project))}</a> · ` : ""}${pct}% · ${g.steps.filter(s => s.done).length}/${g.steps.length} steps${g.due ? ` · due ${esc(fmtWhen(g.due))}` : ""}</div>${g.why ? `<div class="small faint" style="margin-top:4px">${esc(g.why)}</div>` : ""}</div>
          <div class="row"><button class="btn sm" data-break="${g.id}" title="Ask JARVIS to break this down">✦ Break down with JARVIS</button><button class="btn sm" data-addstep="${g.id}">+ Step</button><button class="btn sm ghost" data-delgoal="${g.id}" aria-label="Delete goal">✕</button></div></div>
        <div class="graph"><svg class="edges" aria-hidden="true"></svg><div class="nodes">${g.steps.map((s, i) => `<div class="node ${s.done ? "done" : ""} ${next && s.id === next.id ? "next" : ""} ${Plan.open === g.id + "/" + s.id ? "open" : ""}" draggable="true" tabindex="0" data-step="${s.id}" role="button" aria-label="Step ${i + 1}: ${esc(s.title)}${s.done ? " (done)" : ""}">
            <div class="num"><span>STEP ${pad(i + 1)}</span><button class="tick" data-tick="${s.id}" aria-label="${s.done ? "Mark not done" : "Mark done"}"></button></div><div class="nt">${esc(s.title)}</div><div class="nd">${s.due ? esc(fmtWhen(s.due)) : "no date"}</div></div>`).join("")}</div></div>
        <div class="node-detail" hidden></div></section>`; }).join("")
      : `<div class="card empty">No goals yet. Create one, or ask JARVIS to "make a goal for …".</div>`}`;
  document.getElementById("newGoal").onclick = () => goalModal();
  el.querySelectorAll(".goal").forEach(sec => bindGoal(sec, (S.goals || []).find(g => g.id === sec.dataset.goal)));
  requestAnimationFrame(() => requestAnimationFrame(() => {
    el.querySelectorAll(".gring .arc-fill").forEach(a => a.setAttribute("stroke-dashoffset", a.dataset.to));
    el.querySelectorAll(".goal").forEach(drawEdges);
    if (Plan.open) { const [gid, sid] = Plan.open.split("/"); const sec = el.querySelector(`[data-goal="${gid}"]`); if (sec) showStep(sec, (S.goals || []).find(g => g.id === gid), sid); }
  }));
  // the entrance animation scales panels, so measure again once it has settled
  const redraw = () => { if (route.view === "planner") el.querySelectorAll(".goal").forEach(drawEdges); };
  clearTimeout(Plan.t1); clearTimeout(Plan.t2);
  Plan.t1 = setTimeout(redraw, 900); Plan.t2 = setTimeout(redraw, 1600);
}
function drawEdges(sec) {
  const graph = sec.querySelector(".graph"), svg = sec.querySelector("svg.edges"), nodes = [...sec.querySelectorAll(".node")];
  if (!graph || !svg) return;
  svg.setAttribute("width", graph.scrollWidth); svg.setAttribute("height", graph.scrollHeight);
  const gr = graph.getBoundingClientRect();
  const box = n => { const r = n.getBoundingClientRect(); return { l: r.left - gr.left + graph.scrollLeft, t: r.top - gr.top + graph.scrollTop, w: r.width, h: r.height }; };
  let paths = "";
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = box(nodes[i]), b = box(nodes[i + 1]);
    const doneA = nodes[i].classList.contains("done"), nextB = nodes[i + 1].classList.contains("next"), doneB = nodes[i + 1].classList.contains("done");
    const cls = doneA && doneB ? "edge done" : (doneA || i === 0) && nextB ? "edge flow" : "edge";
    let d;
    if (Math.abs(a.t - b.t) < 10) { const x1 = a.l + a.w, y = a.t + a.h / 2, x2 = b.l; d = `M${x1} ${y} C${x1 + 20} ${y} ${x2 - 20} ${y} ${x2} ${y}`; }
    else { const x1 = a.l + a.w / 2, y1 = a.t + a.h, x2 = b.l + b.w / 2, y2 = b.t; d = `M${x1} ${y1} C${x1} ${y1 + 30} ${x2} ${y2 - 30} ${x2} ${y2}`; }
    paths += `<path class="${cls}" d="${d}"/>`;
  }
  svg.innerHTML = paths;
}
addEventListener("resize", () => { if (route.view === "planner") document.querySelectorAll(".goal").forEach(drawEdges); });
async function saveGoalSteps(g, steps, msg) {
  await act(() => api("/goals", "POST", { ...g, steps }), msg);
}
function bindGoal(sec, g) {
  if (!g) return;
  sec.querySelector("[data-break]").onclick = async () => {
    const text = `Break the Mission Planner goal "${g.title}" (id ${g.id}) into clear, ordered next steps with due dates where sensible. Keep the steps that are already done. Save it with goal_save (same id), then tell me the plan in 3 lines.`;
    await api("/chat", "POST", { text, project: g.project || null, tier: currentTier() }).then(() => { hudNotify("Queued for JARVIS: breaking down the goal"); chatState = null; opsKick(); location.hash = "assistant"; }).catch(e => hudNotify("⚠ " + e.message));
  };
  sec.querySelector("[data-addstep]").onclick = () => {
    modal(`<h3>Add a step to “${esc(g.title)}”</h3><form class="form" id="stepForm"><label class="f">Step<input name="title" required></label><label class="f">Due (optional)<input type="date" name="due"></label>
      <div class="row end"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Add step</button></div></form>`);
    document.getElementById("stepForm").onsubmit = async e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); closeModal(); await saveGoalSteps(g, [...g.steps, { title: f.title, due: f.due || undefined, done: false }], "Step added"); };
  };
  sec.querySelector("[data-delgoal]").onclick = () => confirm(`Delete the goal "${g.title}"?`) && act(() => api(`/goals/${g.id}`, "DELETE"), "Goal deleted");
  sec.querySelectorAll(".node").forEach(n => {
    const sid = n.dataset.step;
    n.onclick = e => { if (e.target.closest("[data-tick]")) return; Plan.open = Plan.open === g.id + "/" + sid ? null : g.id + "/" + sid; sec.querySelectorAll(".node").forEach(x => x.classList.toggle("open", Plan.open === g.id + "/" + x.dataset.step)); showStep(sec, g, Plan.open ? sid : null); Snd.blip(1240, .04); };
    n.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); n.click(); } };
    n.querySelector("[data-tick]").onclick = async e => { e.stopPropagation(); const s = g.steps.find(x => x.id === sid); await act(() => api(`/goals/${g.id}/steps/${sid}`, "PATCH", { done: !s.done }), s.done ? "Step reopened" : "Step complete"); };
    n.addEventListener("dragstart", e => { Plan.drag = sid; n.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", sid); });
    n.addEventListener("dragend", () => { n.classList.remove("dragging"); sec.querySelectorAll(".over").forEach(x => x.classList.remove("over")); });
    n.addEventListener("dragover", e => { if (!Plan.drag || Plan.drag === sid) return; e.preventDefault(); n.classList.add("over"); });
    n.addEventListener("dragleave", () => n.classList.remove("over"));
    n.addEventListener("drop", async e => {
      e.preventDefault(); n.classList.remove("over");
      const from = Plan.drag; Plan.drag = null;
      if (!from || from === sid || !g.steps.some(s => s.id === from)) return;
      const steps = g.steps.filter(s => s.id !== from);
      steps.splice(steps.findIndex(s => s.id === sid), 0, g.steps.find(s => s.id === from));
      await saveGoalSteps(g, steps, "Steps reordered");
    });
  });
}
function showStep(sec, g, sid) {
  const box = sec.querySelector(".node-detail");
  const s = sid && g?.steps.find(x => x.id === sid);
  if (!s) { box.hidden = true; box.innerHTML = ""; return; }
  box.hidden = false;
  box.innerHTML = `<form class="form" id="stepEdit"><div class="three"><label class="f" style="grid-column:span 2">Step<input name="title" value="${esc(s.title)}" required></label><label class="f">Due<input type="date" name="due" value="${esc(s.due || "")}"></label></div>
    <label class="f">Notes<textarea name="notes" placeholder="Details, links, what done looks like…">${esc(s.notes || "")}</textarea></label>
    <div class="row end"><button type="button" class="btn sm bad" id="stepDel">Delete step</button><button type="button" class="btn sm" id="stepDone">${s.done ? "Mark not done" : "Mark done"}</button><button class="btn sm primary">Save step</button></div></form>`;
  box.classList.remove("view-in"); void box.offsetWidth; box.classList.add("view-in");
  const f = box.querySelector("#stepEdit");
  f.onsubmit = async e => { e.preventDefault(); const v = Object.fromEntries(new FormData(f)); await saveGoalSteps(g, g.steps.map(x => x.id === sid ? { ...x, title: v.title, due: v.due || undefined, notes: v.notes || undefined } : x), "Step saved"); };
  box.querySelector("#stepDone").onclick = () => act(() => api(`/goals/${g.id}/steps/${sid}`, "PATCH", { done: !s.done }), s.done ? "Step reopened" : "Step complete");
  box.querySelector("#stepDel").onclick = async () => { if (!confirm("Delete this step?")) return; Plan.open = null; await saveGoalSteps(g, g.steps.filter(x => x.id !== sid), "Step deleted"); };
}
function goalModal() {
  modal(`<h3>New goal</h3><form class="form" id="goalForm">
    <label class="f">Goal<input name="title" required placeholder="e.g. Launch Borrow Fast beta"></label>
    <div class="two"><label class="f">Project<select name="project">${projOptions(activeProject(), "No project")}</select></label><label class="f">Target date<input type="date" name="due"></label></div>
    <label class="f">Why it matters<input name="why"></label>
    <label class="f">Steps (one per line, in order)<textarea name="steps" placeholder="Leave empty and ask JARVIS to break it down"></textarea></label>
    <div class="row end"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Create goal</button></div></form>`);
  document.getElementById("goalForm").onsubmit = async e => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
    const steps = String(f.steps || "").split("\n").map(x => x.trim()).filter(Boolean).map(title => ({ title, done: false }));
    closeModal();
    await act(() => api("/goals", "POST", { title: f.title, project: f.project || null, due: f.due || undefined, why: f.why || undefined, steps }), "Goal created");
  };
}

// ---------------- chrome hook (called by app.js after every state refresh) ----------------
function hudChrome() {
  hudTicker(); pswRender(); coreState();
  if (route.view === "command" && render.background) cmdFill(true);
}

// ---------------- start ----------------
(function hudStart() {
  const foot = document.getElementById("powerBtn");
  if (foot) foot.onclick = () => hudShutdown();
  bgStart(); hudClock(); navGlide();
  opsTick();
  RM.addEventListener?.("change", () => { bgStart(); });
  let booted = false; try { booted = sessionStorage.getItem("hq-booted") === "1"; sessionStorage.setItem("hq-booted", "1"); } catch {}
  if (isHud() && !booted && !reduced()) setTimeout(() => hudBoot(false), 0);
})();
