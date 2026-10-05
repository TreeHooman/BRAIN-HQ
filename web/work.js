// Work pages polish (Projects, Calendar, Roadmap, Inbox): progress + health at a glance, relative dates, tidier timelines.
"use strict";
const WK_HEALTH = { good: "On track", watch: "Watch", risk: "At risk" };
const wkAgo = d => { const t = toDate(d); if (isNaN(t)) return d || ""; const n = Math.floor((Date.now() - t) / 864e5); return n <= 0 ? "today" : n === 1 ? "yesterday" : n < 30 ? n + "d ago" : d; };
function wkSteps(slug) {
  const st = (S.goals || []).filter(g => g.project === slug).flatMap(g => g.steps || []);
  return st.length ? { n: st.length, done: st.filter(s => s.done).length } : null;
}

projectCard = function (p) {
  const st = wkSteps(p.slug), pct = st ? Math.round(st.done / st.n * 100) : null;
  return `<div class="card click proj wk-proj h-${esc(p.health)}" data-open="${p.slug}" data-stage="${esc(p.stage)}" data-q="${esc((p.name + " " + p.summary + " " + (p.tags || []).join(" ") + " " + p.kind).toLowerCase())}" tabindex="0" role="link">
    <div class="meta"><span class="kind">${esc(p.kind)}</span>${stagePill(p.stage)}</div>
    <h3><span class="dot ${esc(p.health)}"></span> ${esc(p.name)}</h3>
    <div class="sum">${esc(p.summary)}</div>
    <div class="next"><b>Next</b>${esc(p.nextStep || "—")}</div>
    ${st ? `<div class="wk-prog" title="${st.done} of ${st.n} goal steps done"><i style="width:${pct}%"></i><span>${pct}%</span></div>` : ""}
    <div class="meta"><span title="${esc(p.updated)}">Updated ${esc(wkAgo(p.updated))}</span><span class="wk-h ${esc(p.health)}">${WK_HEALTH[p.health] || "No signal"}</span></div></div>`;
};

const _vCalendarWk = vCalendar;
vCalendar = function (el) {
  _vCalendarWk(el);
  el.querySelectorAll(".cal .day[data-day]").forEach(d => { const w = new Date(d.dataset.day + "T12:00").getDay(); if (w === 0 || w === 6) d.classList.add("we"); });
};

const _vRoadmapWk = vRoadmap;
vRoadmap = function (el) {
  _vRoadmapWk(el);
  const head = el.querySelector(".road-head .road-months"), now = new Date();
  head?.querySelectorAll("span").forEach(s => { if (s.textContent.startsWith(MON[now.getMonth()])) s.classList.add("now"); });
};

const _vInboxWk = vInbox;
vInbox = function (el) {
  _vInboxWk(el);
  const e = el.querySelector(".empty");
  if (e && !S.inbox.length) e.outerHTML = `<div class="wk-zero"><b>Inbox zero</b><span class="small muted">Type anything above (one thought per line). LUTHUR files it into the right project.</span></div>`;
};
