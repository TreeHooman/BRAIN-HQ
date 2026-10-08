// Code page: background tasks and missions that change code (build level, Claude or Codex) show as live tiles
// above the workrooms. Clicking one opens a live feed of every step with the changed lines. Loads after live.js.
"use strict";
const liveBuilds = () => (Live.ops || []).filter(o => o.kind === "mission" && o.level === "build");
const buildEngine = op => /^gpt|codex|o\d/i.test(op.model || "") ? "Codex" : "Claude";

function buildTiles() {
  const grid = document.getElementById("lvGrid"); if (!grid) return;
  let box = document.getElementById("lvBuilds");
  // Above the agent map, so a running change is the first thing on the page.
  if (!box) { box = document.createElement("div"); box.id = "lvBuilds"; (document.getElementById("lvTop") || grid).before(box); }
  const ops = liveBuilds();
  const tile = op => {
    const run = op.status === "running", lines = op.steps.slice(-5).map(x => x.kind === "text" ? `<div class="ln say">${esc(x.target)}</div>`
      : `<div class="ln ${x.ok === false ? "bad" : x.done || x.result !== undefined ? "ok" : "run"}"><b>${esc(x.verb || "")}</b>(${esc(x.target || "")})${(x.diff || []).slice(0, 3).map(l => `<div class="rs ${l[0] === "+" ? "a" : "d"}">${esc(l)}</div>`).join("")}</div>`).join("");
    const end = run ? `<span class="run">✱ Working ${fmtDur(Live.now - op.startedAt)}</span>` : `<span class="${op.status === "done" ? "ok" : "bad"}">${op.status === "done" ? "✓ Finished" : "✕ " + esc(op.status)}</span>`;
    return `<div class="lv-tile ${run ? "run" : op.status === "done" ? "" : "bad"}" style="--pc:${projColor(op.project)}" data-open-op="${esc(op.id)}" tabindex="0" role="button" aria-label="Watch ${esc(op.title)}">
      <div class="h"><i>✱</i><b>${esc(op.title)}</b><span class="pj">${esc(op.project ? projName(op.project) : "HQ")} · ${buildEngine(op)}</span></div>
      <div class="task">↳ background task · changes code</div>
      <div class="lines">${lines || `<div class="ln dim">Starting…</div>`}</div>
      <div class="f">${end}<span>${op.calls} steps · <span class="a">+${op.added}</span> <span class="d">−${op.removed}</span></span></div></div>`;
  };
  const html = ops.length ? `<div class="lb-label">Background code changes · live</div><div class="lv-grid lb-grid">${ops.map(tile).join("")}</div>` : "";
  if (box.innerHTML !== html) {
    box.innerHTML = html;
    box.querySelectorAll("[data-open-op]").forEach(t => { t.onclick = () => buildOpen(t.dataset.openOp); t.onkeydown = e => { if (e.key === "Enter") buildOpen(t.dataset.openOp); }; });
  }
}

function buildOpen(id) {
  const d = document.getElementById("lvDrawer"); if (!d) return;
  Code.slug = null; Code.op = id; Code.opLast = null; Code.opHtml = "";
  d.hidden = false; requestAnimationFrame(() => d.classList.add("on"));
  buildDrawer();
}
function buildDrawer() {
  const main = document.getElementById("cdMain"); if (!main || !Code.op) return;
  const op = Live.ops.find(o => o.id === Code.op) || Code.opLast;
  if (!op) { main.innerHTML = `<div class="cd-empty"><b>This task already finished.</b><span>Its report is under LUTHUR → Missions & approvals → Runs.</span></div>`; return; }
  Code.opLast = op;
  const run = op.status === "running";
  const html = `<div class="lb-head"><div><b>${esc(op.title)}</b><div class="small muted">${esc(op.project ? projName(op.project) : "HQ")} · ${buildEngine(op)} (${esc(op.model || "")}) · ${run ? `working ${fmtDur(Live.now - op.startedAt)}` : esc(op.status === "done" ? "finished" : op.status)} · ${op.calls} steps · <span class="a">+${op.added}</span> <span class="d">−${op.removed}</span></div></div>
      <div class="row"><a class="btn sm ghost" href="#assistant/missions">Report in Missions</a><button type="button" class="btn sm" data-close-op>Close</button></div></div>
    <div class="cd-steps lb-steps">${op.steps.map(s => stepLine(s, run)).join("") || `<div class="s"><span>Starting…</span></div>`}</div>
    ${run ? "" : `<p class="small muted lb-done">${op.status === "done" ? "Done. The full report is in Missions & approvals." : "This run stopped. See its report in Missions & approvals."}</p>`}`;
  if (html === Code.opHtml) return;
  const prev = main.querySelector(".lb-steps"), atEnd = !prev || prev.scrollHeight - prev.scrollTop - prev.clientHeight < 60, top = prev?.scrollTop || 0;
  main.innerHTML = html; Code.opHtml = html;
  const box = main.querySelector(".lb-steps"); box.scrollTop = atEnd ? box.scrollHeight : top;
  main.querySelector("[data-close-op]").onclick = codeClose;
}

const _codeGridBuilds = codeGrid;
codeGrid = function () {
  _codeGridBuilds(); buildTiles();
  if (!Code.op) return;
  // A full page redraw (e.g. when the task finishes) recreates the drawer closed; keep the one being watched open.
  const d = document.getElementById("lvDrawer");
  if (d?.hidden) { d.hidden = false; d.classList.add("on"); Code.opHtml = ""; }
  buildDrawer();
};
const _codeCloseBuilds = codeClose;
const _codeOpenBuilds = codeOpen;
codeOpen = function (id) { Code.op = null; Code.opLast = null; Code.opHtml = ""; _codeOpenBuilds(id); };
codeClose = function () { Code.op = null; Code.opLast = null; Code.opHtml = ""; _codeCloseBuilds(); };
