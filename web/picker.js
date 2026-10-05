// Wheel picker: replaces every date / time / date-time box with scrolling wheels (like phone alarm apps),
// plus quick picks. Also keeps half-filled forms: the dashboard refreshes in the background, which used to
// wipe what you were typing or picking.
"use strict";
const WP = { open: null };
const WP_H = 40; // row height (px)
const MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const wpPad = n => String(n).padStart(2, "0");
const wpYmd = d => `${d.getFullYear()}-${wpPad(d.getMonth() + 1)}-${wpPad(d.getDate())}`;

function wpParse(type, v) {
  const now = new Date();
  if (type === "time") { const m = /^(\d{2}):(\d{2})/.exec(v || ""); const d = new Date(now); d.setSeconds(0, 0); if (m) d.setHours(+m[1], +m[2]); else d.setHours(9, 0); return d; }
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(v || "");
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 9, m[5] ? +m[5] : 0);
  const d = new Date(now); d.setSeconds(0, 0);
  if (type === "date") d.setHours(9, 0); else { d.setHours(d.getHours() + 1, 0); }
  return d;
}
const wpValue = (type, d) => type === "time" ? `${wpPad(d.getHours())}:${wpPad(d.getMinutes())}` : type === "date" ? wpYmd(d) : `${wpYmd(d)}T${wpPad(d.getHours())}:${wpPad(d.getMinutes())}`;
function wpLabel(type, v) {
  if (!v) return type === "time" ? "Pick a time" : "Pick a date";
  const d = wpParse(type, v), t = `${d.getHours() % 12 || 12}:${wpPad(d.getMinutes())} ${d.getHours() < 12 ? "am" : "pm"}`;
  if (type === "time") return t;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - today) / 864e5);
  const day = diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : diff === -1 ? "Yesterday" : `${DOW[d.getDay()]} ${d.getDate()} ${MON3[d.getMonth()]}${d.getFullYear() !== today.getFullYear() ? " " + d.getFullYear() : ""}`;
  return type === "date" ? day : `${day}, ${t}`;
}

// ---- enhance inputs ----
function wpEnhance(root = document) {
  root.querySelectorAll('input[type="datetime-local"], input[type="date"], input[type="time"]').forEach(inp => {
    if (inp.dataset.wp || inp.disabled) return;
    inp.dataset.wp = "1"; inp.classList.add("wp-native"); inp.tabIndex = -1; inp.setAttribute("aria-hidden", "true");
    const b = document.createElement("button"); b.type = "button"; b.className = "wp-btn";
    const sync = () => { b.innerHTML = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">${inp.type === "time" ? `<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>` : `<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>`}</svg><span>${esc(wpLabel(inp.type, inp.value))}</span>`; b.classList.toggle("empty", !inp.value); };
    sync(); inp._wpSync = sync;
    b.onclick = () => wpOpen(inp, b);
    inp.addEventListener("invalid", e => { e.preventDefault(); wpOpen(inp, b); });
    inp.after(b);
  });
}

// ---- the picker ----
function wpOpen(inp, anchor) {
  wpClose();
  const type = inp.type, d = wpParse(type, inp.value);
  const now = new Date(), base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const minD = inp.min ? wpParse("date", inp.min) : new Date(base.getTime() - 30 * 864e5);
  const days = [];
  const start = new Date(Math.min(minD.getTime(), new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()));
  for (let i = 0; i < 800; i++) { const x = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i); days.push(x); }
  const dayIdx = Math.max(0, days.findIndex(x => wpYmd(x) === wpYmd(d)));
  const hours = Array.from({ length: 12 }, (_, i) => i + 1), mins = Array.from({ length: 12 }, (_, i) => i * 5);
  const hasDate = type !== "time", hasTime = type !== "date";
  const dayName = x => { const diff = Math.round((x - base) / 864e5); return diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : `${DOW[x.getDay()]} ${x.getDate()} ${MON3[x.getMonth()]}`; };
  const col = (key, items, sel, cls = "") => `<div class="wp-col ${cls}" data-col="${key}" tabindex="0" role="listbox" aria-label="${key}"><div class="wp-pad"></div>${items.map((t, i) => `<div class="wp-it ${i === sel ? "on" : ""}" data-i="${i}" role="option">${t}</div>`).join("")}<div class="wp-pad"></div></div>`;
  const h12 = d.getHours() % 12 || 12, mi = Math.round(d.getMinutes() / 5) % 12;
  const quick = hasDate ? (hasTime ? [["In 1 hour", () => { const x = new Date(); x.setMinutes(Math.ceil(x.getMinutes() / 5) * 5 + 60, 0, 0); return x; }], ["Tonight 8 pm", () => { const x = new Date(base); x.setHours(20); return x; }], ["Tomorrow 9 am", () => { const x = new Date(base); x.setDate(x.getDate() + 1); x.setHours(9); return x; }], ["Next Mon 9 am", () => { const x = new Date(base); x.setDate(x.getDate() + ((8 - x.getDay()) % 7 || 7)); x.setHours(9); return x; }]]
    : [["Today", () => new Date(base)], ["Tomorrow", () => { const x = new Date(base); x.setDate(x.getDate() + 1); return x; }], ["Next week", () => { const x = new Date(base); x.setDate(x.getDate() + 7); return x; }], ["In a month", () => { const x = new Date(base); x.setMonth(x.getMonth() + 1); return x; }]])
    : [["9 am", () => { const x = new Date(base); x.setHours(9); return x; }], ["12 pm", () => { const x = new Date(base); x.setHours(12); return x; }], ["5 pm", () => { const x = new Date(base); x.setHours(17); return x; }], ["8 pm", () => { const x = new Date(base); x.setHours(20); return x; }]];
  const el = document.createElement("div"); el.className = "wp-sheet"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Pick date and time");
  el.innerHTML = `<div class="wp-scrim" data-wp-x></div><div class="wp-card">
    <div class="wp-head"><b id="wpNow"></b><button type="button" class="wp-x" data-wp-x aria-label="Close">✕</button></div>
    <div class="wp-quick">${quick.map(([l], i) => `<button type="button" data-q="${i}">${l}</button>`).join("")}</div>
    <div class="wp-wheels">${hasDate ? col("day", days.map(dayName), dayIdx, "wide") : ""}${hasTime ? col("hour", hours, hours.indexOf(h12)) + `<div class="wp-colon">:</div>` + col("min", mins.map(wpPad), mi) + col("ampm", ["am", "pm"], d.getHours() < 12 ? 0 : 1) : ""}<div class="wp-band" aria-hidden="true"></div></div>
    <div class="wp-acts">${inp.required ? "" : `<button type="button" class="btn ghost" id="wpClear">Clear</button>`}<button type="button" class="btn primary" id="wpDone">Set</button></div></div>`;
  document.body.appendChild(el);
  WP.open = { el, inp, anchor };
  const cols = [...el.querySelectorAll(".wp-col")];
  const sel = c => Math.max(0, Math.min(c.querySelectorAll(".wp-it").length - 1, Math.round(c.scrollTop / WP_H)));
  const read = () => {
    const g = k => { const c = el.querySelector(`[data-col="${k}"]`); return c ? sel(c) : null; };
    const day = hasDate ? days[g("day")] : base;
    const x = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0);
    if (hasTime) { let h = hours[g("hour")] % 12; if (g("ampm") === 1) h += 12; x.setHours(h, mins[g("min")]); }
    return x;
  };
  const show = () => { el.querySelector("#wpNow").textContent = wpLabel(type, wpValue(type, read())); cols.forEach(c => { const i = sel(c); c.querySelectorAll(".wp-it").forEach((it, j) => it.classList.toggle("on", j === i)); }); };
  const setTo = x => {
    const put = (k, i, smooth) => { const c = el.querySelector(`[data-col="${k}"]`); if (c) c.scrollTop = i * WP_H; };
    if (hasDate) { let i = days.findIndex(y => wpYmd(y) === wpYmd(x)); if (i < 0) i = 0; put("day", i, true); }
    if (hasTime) { put("hour", hours.indexOf(x.getHours() % 12 || 12), true); put("min", Math.round(x.getMinutes() / 5) % 12, true); put("ampm", x.getHours() < 12 ? 0 : 1, true); }
  };
  requestAnimationFrame(() => {
    cols.forEach(c => { const on = c.querySelector(".wp-it.on"); c.scrollTop = (on ? +on.dataset.i : 0) * WP_H; });
    show();
  });
  cols.forEach(c => {
    let t = 0; c.addEventListener("scroll", () => { clearTimeout(t); t = setTimeout(show, 60); }, { passive: true });
    c.addEventListener("click", e => { const it = e.target.closest(".wp-it"); if (it) c.scrollTo({ top: +it.dataset.i * WP_H, behavior: "smooth" }); });
    c.addEventListener("keydown", e => { if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); c.scrollTo({ top: (sel(c) + (e.key === "ArrowDown" ? 1 : -1)) * WP_H, behavior: "smooth" }); } if (e.key === "Enter") el.querySelector("#wpDone").click(); });
    // mouse wheel: one row per notch
    c.addEventListener("wheel", e => { if (Math.abs(e.deltaY) < 1) return; e.preventDefault(); c.scrollTo({ top: (sel(c) + Math.sign(e.deltaY)) * WP_H, behavior: "smooth" }); }, { passive: false });
  });
  el.querySelectorAll("[data-q]").forEach(b => b.onclick = () => { setTo(quick[+b.dataset.q][1]()); show(); });
  el.querySelectorAll("[data-wp-x]").forEach(b => b.onclick = () => wpClose());
  const commit = v => { inp.value = v; inp._wpSync?.(); inp.dispatchEvent(new Event("input", { bubbles: true })); inp.dispatchEvent(new Event("change", { bubbles: true })); wpClose(); anchor?.focus(); };
  el.querySelector("#wpDone").onclick = () => commit(wpValue(type, read()));
  el.querySelector("#wpClear")?.addEventListener("click", () => commit(""));
  el.addEventListener("keydown", e => { if (e.key === "Escape") { e.stopPropagation(); wpClose(); anchor?.focus(); } });
  (el.querySelector(".wp-col.wide") || cols[0])?.focus({ preventScroll: true });
}
function wpClose() { if (WP.open) { WP.open.el.remove(); WP.open = null; } }

// ---- keep unfinished forms through background refreshes ----
const Draft = {
  key: el => { const f = el.form || el.closest("form"); const fid = f?.id || f?.className?.split(" ")[0] || ""; const n = el.name || el.id; return fid && n ? `${route.view}/${route.arg || ""}/${fid}/${n}` : null; },
  get() { try { return JSON.parse(sessionStorage.getItem("hq-drafts") || "{}"); } catch { return {}; } },
  set(o) { try { sessionStorage.setItem("hq-drafts", JSON.stringify(o)); } catch {} },
  save(el) { const k = this.key(el); if (!k || el.type === "password" || el.type === "file") return; const o = this.get(); if (el.type === "checkbox") o[k] = el.checked ? "1" : "0"; else o[k] = el.value; this.set(o); },
  restore(root) {
    const o = this.get(); if (!Object.keys(o).length) return;
    root.querySelectorAll("form input, form textarea, form select").forEach(el => {
      const k = this.key(el); if (!k || !(k in o) || el.type === "password" || el.type === "hidden") return;
      if (el.type === "checkbox") el.checked = o[k] === "1"; else if (el.value !== o[k]) el.value = o[k];
      el._wpSync?.();
    });
  },
  clear(form) { const o = this.get(); for (const el of form.querySelectorAll("input, textarea, select")) { const k = this.key(el); if (k) delete o[k]; } this.set(o); },
};
document.addEventListener("input", e => { if (e.target.closest?.("#view form, #modal form")) Draft.save(e.target); }, true);
document.addEventListener("change", e => { if (e.target.closest?.("#view form, #modal form")) Draft.save(e.target); }, true);
document.addEventListener("submit", e => { if (e.target.closest?.("#view, #modal")) Draft.clear(e.target); }, true);
document.addEventListener("reset", e => Draft.clear(e.target), true);

// While you're typing or picking, the background refresh waits (it redraws the screen).
const _renderWP = render;
render = function () {
  if (render.background) {
    const a = document.activeElement;
    if (WP.open || (a && a.closest?.("#view") && /INPUT|TEXTAREA|SELECT/.test(a.tagName))) return;
  }
  wpClose();
  _renderWP();
  const v = document.getElementById("view"); if (v) { wpEnhance(v); Draft.restore(v); }
};
// modals: enhance when opened
new MutationObserver(() => { const m = document.getElementById("modal"); if (m && !m.hidden) { wpEnhance(m); } }).observe(document.getElementById("modalBody") || document.body, { childList: true, subtree: true });
