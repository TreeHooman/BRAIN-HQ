// Roadmap: one timeline for every project. Phases are bars (the current one fills up as time passes), milestones and
// deadlines are labelled diamonds, Mission Planner steps with a due date are dots. Drag or scroll sideways, zoom 3/6/12
// months, click anything for details. Below: what's due in the next 30 days.
"use strict";
const RMV = { zoom: 6, sel: null, active: false };
try { const z = Number(localStorage.getItem("hq-rm-zoom")); if ([3, 6, 12].includes(z)) RMV.zoom = z; RMV.active = localStorage.getItem("hq-rm-active") === "1"; } catch {}
const RM_DAY = 864e5;
const rmD = s => toDate(String(s).length <= 10 ? s + "T12:00" : s);
const rmFmt = d => `${MON[d.getMonth()]} ${d.getDate()}${d.getFullYear() !== new Date().getFullYear() ? " " + d.getFullYear() : ""}`;
const rmLeft = d => { const n = Math.round((d - new Date(ymd(new Date()) + "T12:00")) / RM_DAY); return n === 0 ? "today" : n > 0 ? `in ${n} day${n > 1 ? "s" : ""}` : `${-n} day${n < -1 ? "s" : ""} ago`; };

function rmData() {
  const steps = S.goals.flatMap(g => g.steps.filter(s => s.due).map(s => ({ ...s, goal: g, project: g.project })));
  let projs = S.projects.filter(p => (p.phases || []).length || S.milestones.some(m => m.project === p.slug) || steps.some(s => s.project === p.slug));
  if (RMV.active) projs = projs.filter(p => !["paused", "done"].includes(p.stage));
  const now = new Date(), dates = [now, ...projs.flatMap(p => (p.phases || []).flatMap(ph => [ph.start, ph.end].filter(Boolean).map(rmD))), ...S.milestones.map(m => rmD(m.date)), ...steps.map(s => rmD(s.due))];
  let min = new Date(Math.min(...dates)), max = new Date(Math.max(...dates));
  min = new Date(Math.max(+min, +new Date(now.getFullYear(), now.getMonth() - 1, 1))); min = new Date(min.getFullYear(), min.getMonth(), 1);
  max = new Date(Math.max(+max, +new Date(now.getFullYear(), now.getMonth() + RMV.zoom, 1))); max = new Date(max.getFullYear(), max.getMonth() + 1, 1);
  return { projs, steps, min, max, unscheduled: S.projects.filter(p => !projs.includes(p) && !(RMV.active && ["paused", "done"].includes(p.stage))) };
}

function rmPct(p) {
  const st = S.goals.filter(g => g.project === p.slug).flatMap(g => g.steps); if (st.length) return Math.round(st.filter(s => s.done).length / st.length * 100);
  const ph = (p.phases || []); return ph.length ? Math.round(ph.filter(x => x.status === "done").length / ph.length * 100) : null;
}

function rmPaint(el) {
  const { projs, steps, min, max, unscheduled } = rmData(), now = new Date();
  const LW = matchMedia("(max-width: 760px)").matches ? 130 : 200;
  const vis = Math.max(600, (el.querySelector(".rm-scroll")?.clientWidth || Math.min(innerWidth - 300, 1500)) - LW);
  const ppd = vis / (RMV.zoom * 30.4), W = Math.ceil((max - min) / RM_DAY * ppd), X = d => Math.round((rmD(d) - min) / RM_DAY * ppd);
  const xNow = Math.round((now - min) / RM_DAY * ppd);
  const months = []; for (let d = new Date(min); d < max; d.setMonth(d.getMonth() + 1)) months.push(new Date(d));
  const row = p => {
    const col = `var(--h-${p.health || "unknown"}, var(--accent, #6ff2ff))`;
    const bars = (p.phases || []).filter(ph => ph.start && ph.end).map((ph, i) => {
      const s = rmD(ph.start), e = rmD(ph.end), on = s <= now && now <= e, done = ph.status === "done" || e < now && ph.status !== "active";
      const fill = on ? Math.round((now - s) / Math.max(1, e - s) * 100) : done ? 100 : 0, w = Math.max(10, X(ph.end) - X(ph.start));
      return `<button type="button" class="rm-bar ${on ? "on" : done ? "done" : "plan"}" style="left:${X(ph.start)}px;width:${w}px;--f:${fill}%" data-rm="ph|${esc(p.slug)}|${i}" title="${esc(ph.name)} · ${rmFmt(s)} → ${rmFmt(e)}"><span>${esc(ph.name)}</span></button>`;
    }).join("");
    const ms = S.milestones.filter(m => m.project === p.slug && rmD(m.date) >= min).sort((a, b) => a.date.localeCompare(b.date));
    const last = [-1e9, -1e9]; // two label lanes; a label that fits neither shows on hover only
    const marks = ms.map(m => { const x = X(m.date); let lvl = last.findIndex(l => x - l >= 150), nolab = lvl < 0; if (nolab) lvl = 0; else last[lvl] = x;
      return `<button type="button" class="rm-ms ${esc(m.kind || "milestone")} ${m.done ? "done" : ""} l${lvl} ${nolab ? "nolab" : ""}" style="left:${x}px" data-rm="ms|${esc(m.id)}" title="${esc(m.title)} · ${esc(m.date)}"><i></i><span>${esc(m.title)}</span></button>`; }).join("");
    const dots = steps.filter(s => s.project === p.slug && rmD(s.due) >= min).map(s => `<button type="button" class="rm-step ${s.done ? "done" : ""}" style="left:${X(s.due)}px" data-rm="st|${esc(s.goal.id)}|${esc(s.id)}" title="${esc(s.title)} · ${esc(s.due)}"></button>`).join("");
    const pct = rmPct(p);
    return `<div class="rm-row"><a class="rm-lab" href="#project/${esc(p.slug)}" style="--c:${col}"><b>${esc(p.name)}</b><small>${esc(p.stage)}${pct !== null ? ` · ${pct}%` : ""}</small>${pct !== null ? `<i class="rm-pc"><i style="width:${pct}%"></i></i>` : ""}</a>
      <div class="rm-track" style="width:${W}px">${bars}${dots}${marks}</div></div>`;
  };
  // next 30 days: milestones + plan steps
  const end = new Date(now.getTime() + 30 * RM_DAY), soon = [
    ...S.milestones.filter(m => !m.done && rmD(m.date) >= new Date(ymd(now) + "T00:00") && rmD(m.date) <= end).map(m => ({ d: rmD(m.date), t: m.title, k: m.kind || "milestone", p: m.project, ref: "ms|" + m.id })),
    ...steps.filter(s => !s.done && rmD(s.due) >= new Date(ymd(now) + "T00:00") && rmD(s.due) <= end).map(s => ({ d: rmD(s.due), t: s.title, k: "step", p: s.project, ref: `st|${s.goal.id}|${s.id}` })),
  ].sort((a, b) => a.d - b.d);
  const overdue = steps.filter(s => !s.done && rmD(s.due) < new Date(ymd(now) + "T00:00")).length + S.milestones.filter(m => !m.done && rmD(m.date) < new Date(ymd(now) + "T00:00")).length;
  el.innerHTML = `<div class="rm">
    <div class="between rm-head"><div><h1>Roadmap</h1><p class="sub">Where every project is headed. Drag sideways, click anything for details.${overdue ? ` <b class="rm-od">${overdue} past due</b>` : ""}</p></div>
      <div class="row"><div class="chips">${[3, 6, 12].map(z => `<button type="button" class="chip ${RMV.zoom === z ? "on" : ""}" data-rmz="${z}">${z} mo</button>`).join("")}</div>
        <button type="button" class="chip ${RMV.active ? "on" : ""}" id="rmActive" title="Hide paused projects">Active only</button><button type="button" class="btn sm" id="rmToday">Today</button></div></div>
    <div class="rm-legend small"><span><i class="lg bar on"></i>current phase</span><span><i class="lg bar"></i>planned</span><span><i class="lg dia"></i>milestone</span><span><i class="lg dia dl"></i>deadline</span><span><i class="lg dot"></i>plan step</span></div>
    <div class="rm-wrap card nv-panel no-fold">
      <div class="rm-scroll" id="rmScroll"><div class="rm-canvas" style="width:${W + LW}px;--lw:${LW}px">
        <div class="rm-months"><div class="rm-lab head">Project</div><div class="rm-mh" style="width:${W}px">${months.map(m => `<span class="${m.getMonth() === now.getMonth() && m.getFullYear() === now.getFullYear() ? "now" : ""}" style="left:${X(ymd(m))}px">${MON[m.getMonth()]}${m.getMonth() === 0 ? " " + m.getFullYear() : ""}</span>`).join("")}</div></div>
        <div class="rm-body">${projs.map(row).join("") || `<div class="empty">No phases or dates yet.</div>`}
          <div class="rm-now" style="left:${LW + xNow}px"><span>TODAY</span></div>
          ${months.map(m => `<div class="rm-grid" style="left:${LW + X(ymd(m))}px"></div>`).join("")}</div>
      </div></div>
      <div class="rm-detail" id="rmDetail" hidden></div>
    </div>
    <div class="td-cols two">
      <section class="card nv-panel"><div class="panel-title">Next 30 days <small>${soon.length || "clear"}</small></div>
        ${soon.length ? `<ul class="rm-soon">${soon.map(x => `<li><button type="button" data-rm="${esc(x.ref)}"><span class="when">${rmFmt(x.d)}</span><span class="rm-k ${esc(x.k)}"></span><div class="grow"><b>${esc(x.t)}</b><small>${x.p ? esc(projName(x.p)) + " · " : ""}${rmLeft(x.d)}</small></div></button></li>`).join("")}</ul>` : `<div class="empty small">Nothing dated in the next 30 days.</div>`}</section>
      <section class="card nv-panel"><div class="panel-title">Not on the timeline yet</div>
        ${unscheduled.length ? `<ul class="rm-un">${unscheduled.map(p => `<li><a href="#project/${esc(p.slug)}">${esc(p.name)}</a><small>${esc(p.stage)}</small><button type="button" class="btn sm ghost" data-rmplan="${esc(p.slug)}">✦ Plan with LUTHUR</button></li>`).join("")}</ul>` : `<div class="empty small">Every project has dates.</div>`}</section>
    </div></div>`;

  const sc = el.querySelector("#rmScroll");
  const toToday = smooth => sc.scrollTo({ left: Math.max(0, xNow - sc.clientWidth * .25), behavior: smooth ? "smooth" : "auto" });
  if (RMV.scroll == null) toToday(false); else sc.scrollLeft = RMV.scroll;
  sc.onscroll = () => { RMV.scroll = sc.scrollLeft; };
  // drag to pan (mouse); wheel → sideways
  let drag = null;
  sc.onpointerdown = e => { if (e.pointerType !== "mouse" || e.button !== 0 || e.target.closest("button, a")) return; drag = { x: e.clientX, l: sc.scrollLeft, moved: false }; sc.setPointerCapture(e.pointerId); sc.classList.add("drag"); };
  sc.onpointermove = e => { if (!drag) return; const dx = e.clientX - drag.x; if (Math.abs(dx) > 3) drag.moved = true; sc.scrollLeft = drag.l - dx; };
  sc.onpointerup = sc.onpointercancel = () => { drag = null; sc.classList.remove("drag"); };
  sc.onwheel = e => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && !e.shiftKey && sc.scrollWidth > sc.clientWidth) { sc.scrollLeft += e.deltaY; e.preventDefault(); } };
  el.querySelectorAll("[data-rmz]").forEach(b => b.onclick = () => { const keep = (sc.scrollLeft + sc.clientWidth / 2) / ppd; RMV.zoom = Number(b.dataset.rmz); try { localStorage.setItem("hq-rm-zoom", RMV.zoom); } catch {}
    RMV.scroll = null; rmPaint(el); const s2 = el.querySelector("#rmScroll"), p2 = (s2.clientWidth - LW) / (RMV.zoom * 30.4); s2.scrollLeft = Math.max(0, keep * p2 - s2.clientWidth / 2); });
  el.querySelector("#rmActive").onclick = () => { RMV.active = !RMV.active; try { localStorage.setItem("hq-rm-active", RMV.active ? "1" : "0"); } catch {} rmPaint(el); };
  el.querySelector("#rmToday").onclick = () => toToday(true);
  el.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => rmShow(el, b.dataset.rm));
  el.querySelectorAll("[data-rmplan]").forEach(b => b.onclick = async () => { const p = S.projects.find(x => x.slug === b.dataset.rmplan); try { await api("/chat", "POST", { text: `Draft roadmap phases (name, start, end) for ${p.name} and save them with project_update. If you don't know enough, say what you need.`, project: p.slug, tier: currentTier() }); toast("Asked LUTHUR to draft phases"); location.hash = "assistant"; } catch (e) { toast("⚠ " + e.message); } });
  if (RMV.sel) rmShow(el, RMV.sel);
}

function rmShow(el, ref) {
  const box = el.querySelector("#rmDetail"); if (!box) return;
  const [k, a, b] = ref.split("|"); let h = "";
  el.querySelectorAll(".rm-sel").forEach(x => x.classList.remove("rm-sel")); el.querySelectorAll(`.rm-track [data-rm="${CSS.escape(ref)}"]`).forEach(x => x.classList.add("rm-sel"));
  if (k === "ph") { const p = S.projects.find(x => x.slug === a), ph = p?.phases?.[Number(b)]; if (!ph) return;
    const s = rmD(ph.start), e = rmD(ph.end), now = new Date(), on = s <= now && now <= e, days = Math.round((e - s) / RM_DAY);
    h = `<div class="rm-dk">PHASE · ${esc(p.name)}</div><h3>${esc(ph.name)}</h3><p>${rmFmt(s)} → ${rmFmt(e)} · ${days} days</p><p class="rm-st">${on ? `Running · ends ${rmLeft(e)} · ${Math.round((now - s) / Math.max(1, e - s) * 100)}% of the time used` : s > now ? `Starts ${rmLeft(s)}` : `Ended ${rmLeft(e)}`}${ph.status ? ` · marked ${esc(ph.status)}` : ""}</p>
      <div class="row"><a class="btn sm" href="#project/${esc(p.slug)}">Open project</a></div>`; }
  if (k === "ms") { const m = S.milestones.find(x => x.id === a); if (!m) return;
    h = `<div class="rm-dk">${esc((m.kind || "milestone").toUpperCase())}${m.project ? " · " + esc(projName(m.project)) : ""}</div><h3>${esc(m.title)}</h3><p>${rmFmt(rmD(m.date))} · ${rmLeft(rmD(m.date))}</p>
      <div class="row">${m.done ? `<span class="pill green">Done</span>` : `<button type="button" class="btn sm primary" id="rmDone">Mark done</button>`}${m.project ? `<a class="btn sm ghost" href="#project/${esc(m.project)}">Open project</a>` : ""}</div>`; }
  if (k === "st") { const g = S.goals.find(x => x.id === a), s = g?.steps.find(x => x.id === b); if (!s) return;
    h = `<div class="rm-dk">PLAN STEP · ${esc(g.title)}</div><h3>${esc(s.title)}</h3><p>Due ${rmFmt(rmD(s.due))} · ${rmLeft(rmD(s.due))}</p>${s.notes ? `<p class="rm-st">${esc(s.notes)}</p>` : ""}
      <div class="row">${s.done ? `<span class="pill green">Done</span>` : `<button type="button" class="btn sm primary" id="rmDone">Mark done</button><button type="button" class="btn sm" id="rmToday2">Add to today</button>`}<a class="btn sm ghost" href="#planner">Open plan</a></div>`; }
  RMV.sel = ref; box.hidden = false;
  box.innerHTML = `<button type="button" class="icon-btn rm-x" aria-label="Close">×</button>${h}`;
  box.querySelector(".rm-x").onclick = () => { RMV.sel = null; box.hidden = true; el.querySelectorAll(".rm-sel").forEach(x => x.classList.remove("rm-sel")); };
  const d = box.querySelector("#rmDone"); if (d) d.onclick = () => act(() => k === "ms" ? api(`/milestones/${a}`, "PATCH", { done: true }) : api(`/goals/${a}/steps/${b}`, "PATCH", { done: true }), "Marked done");
  const t = box.querySelector("#rmToday2"); if (t) t.onclick = async () => { const g = S.goals.find(x => x.id === a), s = g.steps.find(x => x.id === b); try { await api("/today/items", "POST", { title: s.title, project: g.project, goalId: g.id, stepId: s.id }); toast("Added to today's goals"); } catch (e) { toast("⚠ " + e.message); } };
}

vRoadmap = function (el) { if (render.background && el.querySelector(".rm")) return; RMV.scroll = el.querySelector("#rmScroll")?.scrollLeft ?? RMV.scroll; rmPaint(el); };
