// "Explain" anywhere: hover any item (task, reminder, approval, email, event, project…) and press ✦, long-press it on
// a phone, or Alt+click it. LUTHUR (Haiku, no tools, cached) says what it is, why it matters and the next step.
"use strict";
const XP = { btn: null, pop: null, cur: null, hold: 0 };
const XP_SEL = ".nv-row, .list li, .ws-row, .ob, .lv-tile, .cal .ev, .nv-sat, .proj-card, .card.proj, .ob-card, .tk-row, .tk-card, .gl-step, [data-explain]";
const xpItem = t => { const el = t?.closest?.(XP_SEL); return el && document.getElementById("view")?.contains(el) && !el.closest("#xpPop") ? el : null; };
const xpKind = el => el.matches(".ws-mrow, .ml-row") ? "email" : el.matches(".ws-frow") ? "file" : el.matches(".cal .ev, .t-ev") ? "calendar event" : el.matches(".ob") ? "outbox draft" : el.matches(".lv-tile") ? "agent task" : el.closest("#nvMail") ? "email" : route.view === "roadmap" ? "milestone" : "item";
function xpProject(el) {
  const a = el.matches("a[href^='#project/']") ? el : el.querySelector("a[href^='#project/']");
  const m = (a?.getAttribute("href") || "").match(/^#project\/([a-z0-9-]+)/); if (m) return m[1];
  if (route.view === "project" && route.arg) return route.arg;
  return typeof activeProject === "function" ? activeProject() || null : null;
}
function xpButton() {
  if (XP.btn) return XP.btn;
  const b = XP.btn = document.createElement("button"); b.type = "button"; b.id = "xpBtn"; b.className = "xp-btn"; b.title = "Explain this (Alt+click)"; b.setAttribute("aria-label", "Explain this");
  b.innerHTML = "✦";
  b.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); if (XP.cur) xpOpen(XP.cur); });
  b.addEventListener("pointerdown", e => e.stopPropagation());
  document.body.appendChild(b);
  return b;
}
function xpPlace(el) {
  const b = xpButton(), r = el.getBoundingClientRect();
  if (r.width < 60 || r.height < 14) { b.hidden = true; return; }
  XP.cur = el; b.hidden = false;
  b.style.left = Math.min(innerWidth - 30, r.right - 26) + "px"; b.style.top = Math.max(4, r.top + 4) + "px";
}
async function xpOpen(el) {
  const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 900);
  if (text.length < 3) return;
  let p = XP.pop;
  if (!p) { p = XP.pop = document.createElement("div"); p.id = "xpPop"; p.className = "xp-pop"; p.setAttribute("role", "dialog"); document.body.appendChild(p); p.addEventListener("click", e => e.stopPropagation()); }
  const r = el.getBoundingClientRect(), w = Math.min(360, innerWidth - 24);
  p.style.width = w + "px"; p.style.left = Math.max(12, Math.min(innerWidth - w - 12, r.left + r.width / 2 - w / 2)) + "px";
  const below = r.bottom + 220 < innerHeight; p.style.top = (below ? r.bottom + 8 : Math.max(12, r.top - 8)) + "px"; p.classList.toggle("up", !below);
  p.innerHTML = `<div class="xp-h"><span>✦ LUTHUR <small>HAIKU</small></span><button type="button" class="xp-x" aria-label="Close">✕</button></div><div class="xp-q">${esc(text.slice(0, 120))}${text.length > 120 ? "…" : ""}</div><div class="xp-a"><i class="xp-dots"><s></s><s></s><s></s></i></div>`;
  p.hidden = false; requestAnimationFrame(() => p.classList.add("on"));
  p.querySelector(".xp-x").onclick = xpClose;
  const seq = (XP.seq = (XP.seq || 0) + 1);
  try {
    const res = await api("/explain", "POST", { text, kind: xpKind(el), project: xpProject(el) });
    if (seq !== XP.seq) return;
    p.querySelector(".xp-a").innerHTML = esc(res.text).replace(/\n/g, "<br>");
  } catch (e) { if (seq === XP.seq) p.querySelector(".xp-a").innerHTML = `<span class="xp-err">${esc(e.message)}</span>`; }
}
function xpClose() { if (XP.pop) { XP.pop.classList.remove("on"); XP.seq++; setTimeout(() => { if (!XP.pop.classList.contains("on")) XP.pop.hidden = true; }, 200); } }

// desktop: hover shows ✦; Alt+click explains straight away
document.addEventListener("pointerover", e => { if (e.pointerType !== "mouse") return; const el = xpItem(e.target); if (el && el !== XP.cur) xpPlace(el); else if (!el && !e.target.closest?.("#xpBtn") && XP.btn) { XP.btn.hidden = true; XP.cur = null; } }, { passive: true });
document.addEventListener("click", e => {
  if (e.altKey) { const el = xpItem(e.target); if (el) { e.preventDefault(); e.stopPropagation(); xpOpen(el); return; } }
  if (XP.pop && !XP.pop.hidden && !e.target.closest("#xpPop")) xpClose();
}, true);
// phone: long-press an item
document.addEventListener("touchstart", e => {
  const el = xpItem(e.target); if (!el) return; const t0 = e.touches[0], x = t0.clientX, y = t0.clientY;
  clearTimeout(XP.hold); XP.hold = setTimeout(() => { XP.held = Date.now(); navigator.vibrate?.(12); xpOpen(el); }, 550);
  const mv = ev => { const t = ev.touches[0]; if (Math.hypot(t.clientX - x, t.clientY - y) > 10) clearTimeout(XP.hold); };
  el.addEventListener("touchmove", mv, { passive: true, once: true });
}, { passive: true });
document.addEventListener("touchend", () => clearTimeout(XP.hold), { passive: true });
document.addEventListener("click", e => { if (XP.held && Date.now() - XP.held < 700) { e.preventDefault(); e.stopPropagation(); XP.held = 0; } }, true); // the long-press shouldn't also open the link
document.addEventListener("contextmenu", e => { if (XP.held && Date.now() - XP.held < 1500) e.preventDefault(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") xpClose(); });
addEventListener("scroll", () => { if (XP.btn) XP.btn.hidden = true; XP.cur = null; }, { passive: true, capture: true });
window.addEventListener("hashchange", () => { xpClose(); if (XP.btn) XP.btn.hidden = true; });
