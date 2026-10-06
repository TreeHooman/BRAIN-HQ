// Compact War Room instruments. They only occupy the stage's existing inner gaps.
"use strict";
const Gap = { tick: 0, liveTick: 0, liveBusy: false, timer: null };
const gapKey = "hq-focus-timer-v1";
function gapTimerLoad() {
  try { return { remaining: 25 * 60, duration: 25 * 60, endAt: 0, objective: "DEEP WORK", ...JSON.parse(localStorage.getItem(gapKey) || "{}") }; }
  catch { return { remaining: 25 * 60, duration: 25 * 60, endAt: 0, objective: "DEEP WORK" }; }
}
function gapTimerSave() { try { localStorage.setItem(gapKey, JSON.stringify(Gap.timer)); } catch {} }
function gapRemaining() { return Math.max(0, Gap.timer.endAt ? Math.ceil((Gap.timer.endAt - Date.now()) / 1000) : Gap.timer.remaining); }
function gapTimerPaint() {
  const box = document.getElementById("gapTimer"); if (!box || !Gap.timer) return;
  const t = Gap.timer, left = gapRemaining();
  if (t.endAt && !left) { t.endAt = 0; t.remaining = 0; gapTimerSave(); box.classList.add("finished"); }
  const mins = String(Math.floor(left / 60)).padStart(2, "0"), secs = String(left % 60).padStart(2, "0");
  box.querySelector("#gapClock").textContent = `${mins}:${secs}`;
  box.querySelector("#gapArc").style.setProperty("--progress", `${Math.max(0, Math.min(100, (1 - left / Math.max(1, t.duration)) * 100))}%`);
  box.querySelector("#gapToggle").textContent = t.endAt ? "Ⅱ PAUSE" : left ? "▶ START" : "↻ RESTART";
  box.querySelector("#gapStatus").textContent = t.endAt ? "SPRINT RUNNING" : left ? "READY TO FOCUS" : "SPRINT COMPLETE";
}
function gapTimerMount() {
  const box = document.getElementById("gapTimer"); if (!box) return;
  Gap.timer = gapTimerLoad();
  box.innerHTML = `<div class="gap-head"><span>⏳ FOCUS SPRINT</span><span id="gapStatus"></span></div>
    <div class="gap-timer-body"><button type="button" class="gap-arc" id="gapArc" aria-label="Set custom focus time" title="Click to set a custom time"><strong id="gapClock">25:00</strong></button>
      <div class="gap-timer-side"><button type="button" class="gap-objective" id="gapObjective" title="Change sprint objective"></button><div class="gap-add"><button type="button" data-add="5">+5m</button><button type="button" data-add="10">+10m</button><button type="button" data-add="25">+25m</button></div></div></div>
    <div class="gap-controls"><button type="button" id="gapToggle">▶ START</button><button type="button" id="gapReset">↻ RESET</button></div>
    <form class="gap-custom" id="gapCustom" hidden><label for="gapMinutes">CUSTOM FOCUS TIME</label><div class="gap-custom-row"><input id="gapMinutes" type="number" min="1" max="999" step="1" inputmode="numeric" required><span>minutes</span></div><div class="gap-custom-actions"><button type="button" id="gapCancel">Cancel</button><button type="submit">Set time</button></div></form>`;
  const custom = box.querySelector("#gapCustom"), minutes = box.querySelector("#gapMinutes");
  box.querySelector("#gapArc").onclick = () => { minutes.value = String(Math.max(1, Math.ceil(gapRemaining() / 60))); custom.hidden = false; minutes.focus(); minutes.select(); };
  box.querySelector("#gapCancel").onclick = () => { custom.hidden = true; box.querySelector("#gapArc").focus(); };
  custom.onkeydown = e => { if (e.key === "Escape") { e.preventDefault(); custom.hidden = true; box.querySelector("#gapArc").focus(); } };
  custom.onsubmit = e => {
    e.preventDefault();
    const value = Number(minutes.value);
    if (!Number.isInteger(value) || value < 1 || value > 999) { minutes.reportValidity(); return; }
    const seconds = value * 60, running = !!Gap.timer.endAt;
    Gap.timer.duration = Gap.timer.remaining = seconds;
    Gap.timer.endAt = running ? Date.now() + seconds * 1000 : 0;
    box.classList.remove("finished"); custom.hidden = true;
    gapTimerSave(); gapTimerPaint(); box.querySelector("#gapArc").focus();
  };
  box.querySelector("#gapObjective").textContent = Gap.timer.objective;
  box.querySelector("#gapObjective").onclick = () => {
    const value = prompt("Sprint objective", Gap.timer.objective);
    if (value !== null && value.trim()) { Gap.timer.objective = value.trim().slice(0, 80); box.querySelector("#gapObjective").textContent = Gap.timer.objective; gapTimerSave(); }
  };
  box.querySelectorAll("[data-add]").forEach(b => b.onclick = () => {
    const add = Number(b.dataset.add) * 60, t = Gap.timer;
    if (t.endAt) t.endAt += add * 1000;
    else t.remaining += add;
    t.duration += add; gapTimerSave(); gapTimerPaint();
  });
  box.querySelector("#gapToggle").onclick = () => {
    const t = Gap.timer;
    if (t.endAt) { t.remaining = gapRemaining(); t.endAt = 0; }
    else { if (!t.remaining) { t.remaining = 25 * 60; t.duration = t.remaining; } t.endAt = Date.now() + t.remaining * 1000; box.classList.remove("finished"); }
    gapTimerSave(); gapTimerPaint();
  };
  box.querySelector("#gapReset").onclick = () => { Gap.timer.endAt = 0; Gap.timer.remaining = Gap.timer.duration = 25 * 60; box.classList.remove("finished"); gapTimerSave(); gapTimerPaint(); };
  gapTimerPaint();
  clearInterval(Gap.tick); Gap.tick = setInterval(() => { if (document.getElementById("gapTimer")) gapTimerPaint(); }, 1000);
}
function gapWorker(op) {
  const kind = String(op.kind || "").toLowerCase(), model = String(op.model || "").toLowerCase();
  if (kind === "code" || /codex|coder/.test(model)) return ["💻", "CODER", "code"];
  if (/test|check|review/.test(kind + " " + op.title)) return ["🧪", "TESTER", "test"];
  if (/research|search/.test(kind + " " + op.title)) return ["🔎", "RESEARCH", "research"];
  return ["🤖", (op.agent || "AGENT").replace(/[^a-z0-9_-]/gi, "_").slice(0, 18).toUpperCase(), "agent"];
}
function gapLivePaint(ops) {
  const box = document.getElementById("gapLive"); if (!box) return;
  const rows = [];
  for (const op of ops || []) {
    const worker = gapWorker(op), steps = (op.steps || []).slice(-5);
    for (const step of steps) {
      const at = new Date(step.at || op.startedAt || Date.now());
      rows.push({ at: at.getTime(), time: `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`, worker,
        message: String(step.target || step.verb || op.title || "Working…").slice(0, 100) });
    }
    if (!steps.length && op.status === "running") {
      const at = new Date(op.startedAt || Date.now());
      rows.push({ at: at.getTime(), time: `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`, worker, message: String(op.title || "Starting…").slice(0, 100) });
    }
  }
  rows.sort((a, b) => b.at - a.at);
  box.querySelector("#gapLiveStatus").textContent = ops?.some(o => o.status === "running") ? "● LIVE" : "STANDBY";
  box.querySelector("#gapLiveStream").innerHTML = rows.length ? rows.slice(0, 12).map(r => `<div class="gap-log-row"><time>[${r.time}]</time> ${r.worker[0]} <b class="worker-${r.worker[2]}">[${esc(r.worker[1])}]</b>: ${esc(r.message)}</div>`).join("") : `<div class="gap-quiet">Agents standing by. Activity appears here when work starts.</div>`;
}
async function gapLivePoll() {
  clearTimeout(Gap.liveTick);
  if (route.view !== "command" || !document.getElementById("gapLive")) return;
  if (Gap.liveBusy) return;
  Gap.liveBusy = true;
  try { const result = await api("/live"); if (route.view === "command") gapLivePaint(result.ops || []); }
  catch { const status = document.getElementById("gapLiveStatus"); if (status) status.textContent = "OFFLINE"; }
  finally { Gap.liveBusy = false; if (route.view === "command") Gap.liveTick = setTimeout(gapLivePoll, 4000); }
}
function gapCalendarPaint() {
  const box = document.getElementById("gapCalendar"); if (!box?.querySelector("#gapCalendarList") || !S) return;
  const now = Date.now(), entries = [];
  for (const e of S.calendar?.upcoming || []) {
    const when = new Date(e.allDay ? `${e.start}T00:00:00` : e.start).getTime();
    const end = new Date(e.allDay ? `${e.end}T00:00:00` : e.end).getTime();
    if (Number.isFinite(when) && (end || when) >= now) entries.push({ when, title: e.title, allDay: e.allDay, kind: "event" });
  }
  for (const r of S.reminders || []) {
    if (r.done || !r.due) continue;
    const when = new Date(String(r.due).length <= 10 ? `${r.due}T23:59:00` : r.due).getTime();
    if (Number.isFinite(when) && when >= now) entries.push({ when, title: r.title, allDay: String(r.due).length <= 10, kind: "reminder" });
  }
  entries.sort((a, b) => a.when - b.when);
  const date = new Date();
  box.querySelector("#gapCalendarDate").textContent = `${MON[date.getMonth()].toUpperCase()} ${date.getDate()}`;
  box.querySelector("#gapCalendarList").innerHTML = entries.slice(0, 2).map(e => {
    const d = new Date(e.when), day = d.toDateString() === date.toDateString() ? "TODAY" : `${MON[d.getMonth()].slice(0, 3).toUpperCase()} ${d.getDate()}`;
    return `<a class="gap-event" href="#calendar"><span class="gap-event-time">${day}<small>${e.allDay ? "ALL DAY" : `${pad(d.getHours())}:${pad(d.getMinutes())}`}</small></span><span class="gap-event-title">${esc(e.title || "Untitled")}</span><i class="${e.kind}"></i></a>`;
  }).join("") || `<div class="gap-quiet">No upcoming events.<br><a href="#calendar">Open calendar →</a></div>`;
}
function gapWidgetsMount() {
  gapTimerMount();
  const live = document.getElementById("gapLive");
  if (live) live.innerHTML = `<div class="gap-head"><span>📡 MULTI-AGENT LOOP</span><span id="gapLiveStatus">CONNECTING</span></div><div class="gap-log" id="gapLiveStream"></div>`;
  const calendar = document.getElementById("gapCalendar");
  if (calendar) calendar.innerHTML = `<div class="gap-head"><span>📅 NEXT UP</span><span id="gapCalendarDate"></span></div><div class="gap-calendar-list" id="gapCalendarList"></div>`;
  gapCalendarPaint(); gapLivePoll();
}
