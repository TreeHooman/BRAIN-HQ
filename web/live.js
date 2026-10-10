// Live agents: the agent network (who's working, what they do and decide), the multi-session Code grid,
// the Tasks tab (delegate → watch → report back), "Hey JARVIS" hands-free voice, the guided briefing tour
// and the phone tab bar. Loads last; overrides vCode/stepLine from views.js.
"use strict";
VIEWS.splice(0, 0, ["tasks", "Tasks", "◈"]);
const touchDev = () => matchMedia("(pointer: coarse)").matches;
const phone = () => matchMedia("(max-width: 760px)").matches;
const hhmmss = t => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };

// ---------------- project colours: every project gets one, used to outline anything that belongs to it ----------------
const PC = ["#38bdf8", "#a78bfa", "#f59e0b", "#f472b6", "#34d399", "#fb7185", "#60a5fa", "#facc15", "#2dd4bf", "#c084fc", "#fb923c", "#4ade80"];
function projColor(slug) {
  const p = S?.projects?.find(x => x.slug === slug); if (!p) return "var(--border2)";
  if (/^#[0-9a-f]{6}$/i.test(p.color || "")) return p.color;
  const i = [...S.projects].sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.slug.localeCompare(b.slug)).findIndex(x => x.slug === slug);
  return PC[(i < 0 ? 0 : i) % PC.length];
}
/** Tags every link/card that points at a project with that project's colour (CSS draws the outline or dot). */
function paintProjects(root = document) {
  root.querySelectorAll('a[href^="#project/"], [data-slug], [data-project]').forEach(el => {
    const slug = (el.getAttribute("href") || "").replace(/^#project\//, "").split(/[/?]/)[0] || el.dataset.slug || el.dataset.project;
    if (!slug || !S.projects.some(p => p.slug === slug)) return;
    el.style.setProperty("--pc", projColor(slug)); el.classList.add("pc");
  });
}

// ---------------- live data (one poller for the Code and Tasks screens) ----------------
const Live = { ops: [], now: 0, code: null, tasks: null, timer: 0, names: new Map(), n: 0, taskSeen: new Map() };
function agentName(op) {
  if (op.agent) return op.agent;
  if (!Live.names.has(op.id)) Live.names.set(op.id, `agent-${++Live.n}`);
  return Live.names.get(op.id);
}
async function livePoll() {
  clearTimeout(Live.timer);
  const v = route.view; if (v !== "code" && v !== "tasks") return;
  const [l, extra] = await Promise.all([api("/live").catch(() => ({ ops: [] })), api(v === "code" ? "/code" : "/tasks").catch(() => null)]);
  if (route.view !== v) return;
  Live.ops = l.ops || []; Live.now = l.now || Date.now();
  if (v === "code" && extra) { Live.code = extra; codeGrid(); }
  if (v === "tasks" && extra) { Live.tasks = extra.tasks; taskList(); }
  netUpdate(document.getElementById("lvNet"), v);
  feedUpdate(document.getElementById("lvFeed"), v);
  const busy = Live.ops.some(o => o.status === "running") || (v === "code" ? Live.code?.running : (Live.tasks || []).some(t => ["running", "queued"].includes(t.status)));
  Live.timer = setTimeout(livePoll, busy ? 1200 : 5000);
}
const liveKick = () => { clearTimeout(Live.timer); Live.timer = setTimeout(livePoll, 250); };

// ---------------- agent network: orchestrator in the middle, agents around it, packets on the wires ----------------
function netNodes(scope) {
  const nodes = [];
  const ops = Live.ops.filter(o => scope === "code" ? o.kind === "code" : o.kind !== "code");
  for (const o of ops) {
    const tools = o.steps.filter(s => s.kind === "tool"), last = o.steps.at(-1);
    nodes.push({ id: o.id, name: agentName(o), sub: o.title.replace(/^[^:]+:\s*/, ""), run: o.status === "running", st: o.status, steps: tools.length,
      t: (o.endedAt || Live.now) - o.startedAt, act: last ? (last.kind === "text" ? "“" + last.target + "”" : `${last.verb} ${last.target}`) : "starting…", parent: o.parent && ops.some(x => x.id === o.parent) ? o.parent : null, kind: o.kind, project: o.project });
  }
  if (scope === "code") for (const s of Live.code?.sessions || []) if (!s.busy && nodes.length < 10) nodes.push({ id: "idle-" + s.id, name: s.name, sub: s.projectName, run: false, st: s.error ? "failed" : "idle", steps: 0, t: 0, act: s.task ? "last: " + s.task : "ready", parent: null, kind: "code", session: s.id, project: s.project });
  if (scope === "tasks") for (const t of Live.tasks || []) if (t.status === "queued" && nodes.length < 10) nodes.push({ id: "q-" + t.id, name: "queued", sub: t.title, run: false, st: "queued", steps: 0, t: 0, act: "waiting for a free agent", parent: null, kind: "mission" });
  return nodes.slice(0, 10);
}
function netShell(scope) {
  return `<div class="card lv-panel"><div class="lv-ttl"><span>◆ Agent network</span><b id="lvNetCount"></b></div><div class="lv-net" id="lvNet" data-scope="${scope}"><svg class="lv-wires" aria-hidden="true"></svg><div class="lv-node lv-hub" data-id="hub"></div></div></div>
    <div class="card lv-panel lv-comms"><div class="lv-ttl"><span>Comms</span><b>live</b></div><div class="lv-feed" id="lvFeed"><div class="lv-quiet">Quiet. Agent actions and decisions stream here.</div></div><div class="lv-bar" id="lvBar"></div></div>`;
}
function netUpdate(box, scope) {
  if (!box) return;
  const nodes = netNodes(scope), W = box.clientWidth, H = box.clientHeight, tree = W < 560;
  const running = nodes.filter(n => n.run).length;
  const cnt = document.getElementById("lvNetCount"); if (cnt) cnt.textContent = `${running} working · ${nodes.length} total`;
  const hub = box.querySelector(".lv-hub");
  const name = S.settings.assistantName || "LUTHUR";
  hub.innerHTML = `<div class="h"><i>◆</i><b>${esc(name.toLowerCase())}</b><em>orchestrator</em></div><div class="b"><span>${running ? `${running}/${nodes.length} agents` : "status?"}</span><span class="${running ? "on" : ""}">${running ? "● directing" : "○ waiting"}</span></div>`;
  const hx = tree ? 16 : W / 2, hy = tree ? 34 : H / 2;
  hub.style.transform = tree ? `translate(8px, 8px)` : `translate(${hx}px, ${hy}px) translate(-50%, -50%)`;
  const seen = new Set(["hub"]), pos = new Map();
  const n = nodes.length, step = 360 / Math.max(1, n), start = -90 - (n > 1 ? step / 2 : 0);
  nodes.forEach((nd, i) => {
    seen.add(nd.id);
    let el = box.querySelector(`.lv-node[data-id="${CSS.escape(nd.id)}"]`);
    if (!el) { el = document.createElement("div"); el.className = "lv-node"; el.dataset.id = nd.id; el.style.opacity = "0"; box.appendChild(el); requestAnimationFrame(() => { el.style.opacity = ""; }); }
    el.className = `lv-node st-${nd.st} ${nd.run ? "run" : ""}`;
    if (nd.project) el.style.setProperty("--pc", projColor(nd.project)); else el.style.removeProperty("--pc");
    const stat = nd.run ? `<span class="s run">⋮ ${nd.steps} · ${fmtDur(nd.t)}</span>` : nd.st === "done" ? `<span class="s ok">✓ done</span>` : nd.st === "failed" ? `<span class="s bad">✕ failed</span>` : nd.st === "queued" ? `<span class="s">◌ queued</span>` : `<span class="s">○ idle</span>`;
    el.innerHTML = `<div class="h"><i>✱</i><b>${esc(nd.name)}</b></div><div class="b"><span class="sub">${esc(nd.sub)}</span>${stat}</div><div class="a">${esc(nd.act)}</div>`;
    el.onclick = nd.session ? () => codeOpen(nd.session) : nd.kind === "code" ? () => { const s = (Live.code?.sessions || []).find(x => x.opId === nd.id); if (s) codeOpen(s.id); } : null;
    let x, y;
    if (!tree && scope === "code") {
      // octagon: up to 8 slots around the orchestrator, like a terminal agent map
      const slots = n <= 2 ? [[-1, 0], [1, 0]] : n <= 4 ? [[-1, -1], [1, -1], [1, 1], [-1, 1]] : n <= 6 ? [[-.62, -1], [.62, -1], [1, 0], [.62, 1], [-.62, 1], [-1, 0]] : [[-.42, -1], [.42, -1], [1, -.42], [1, .42], [.42, 1], [-.42, 1], [-1, .42], [-1, -.42]];
      const [sx, sy] = slots[i % slots.length], rx = Math.max(140, W / 2 - 118), ry = Math.max(110, H / 2 - 62);
      x = hx + sx * rx; y = hy + 8 + sy * ry;
      el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`; pos.set(nd.id, [x, y]);
    } else if (tree) { x = 34; y = 92 + i * 74; el.style.transform = `translate(${x}px, ${y}px)`; pos.set(nd.id, [x, y + 26]); }
    else {
      const a = (start + i * step) * Math.PI / 180, rx = W * .36, ry = H * .37;
      x = hx + Math.cos(a) * rx; y = hy + Math.sin(a) * ry;
      el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`; pos.set(nd.id, [x, y]);
    }
  });
  if (tree) box.style.height = `${110 + n * 74}px`; else box.style.height = "";
  box.querySelectorAll(".lv-node:not(.lv-hub)").forEach(el => { if (!seen.has(el.dataset.id)) el.remove(); });
  // wires (+ a travelling packet on the busy ones); sub-agents hang off their parent
  const svg = box.querySelector(".lv-wires");
  svg.setAttribute("viewBox", `0 0 ${W} ${box.clientHeight}`);
  const ring = !tree && scope === "code" && n > 2 ? nodes.map((nd, i) => { const [ax, ay] = pos.get(nd.id), [bx, by] = pos.get(nodes[(i + 1) % n].id); return `<path class="ring" d="M${ax} ${ay} L${bx} ${by}"/>`; }).join("") : "";
  svg.innerHTML = ring + nodes.map((nd, i) => {
    const [x, y] = pos.get(nd.id), [px, py] = nd.parent && pos.has(nd.parent) ? pos.get(nd.parent) : tree ? [24, 58] : [hx, hy];
    const d = tree ? `M${px} ${py} V${y} H${x}` : scope === "code" ? `M${px} ${py} L${x} ${y}` : `M${px} ${py} Q${(px + x) / 2 + (y - py) * .12} ${(py + y) / 2 - (x - px) * .12} ${x} ${y}`;
    return `<path id="w${i}" class="${nd.run ? "run" : nd.st === "done" ? "ok" : ""}" d="${d}"/>${nd.run ? `<circle r="2.6" class="pk"><animateMotion dur="${1.4 + (i % 3) * .35}s" repeatCount="indefinite" keyPoints="${i % 2 ? "1;0" : "0;1"}" keyTimes="0;1" calcMode="linear"><mpath href="#w${i}"/></animateMotion></circle>` : ""}`;
  }).join("");
}
function feedUpdate(box, scope) {
  if (!box) return;
  const ops = Live.ops.filter(o => scope === "code" ? o.kind === "code" : o.kind !== "code");
  const rows = [];
  for (const o of ops) for (const s of o.steps) rows.push({ k: o.id + "/" + s.id, at: s.at || o.startedAt, who: agentName(o), s });
  rows.sort((a, b) => a.at - b.at);
  const have = new Set([...box.children].map(c => c.dataset.k));
  if (rows.length && box.querySelector(".lv-quiet")) box.innerHTML = "";
  const stick = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  for (const r of rows.slice(-60)) {
    const html = r.s.kind === "text" ? `<span class="tm">${hhmmss(r.at)}</span><b>${esc(r.who)}</b><span class="ar">→</span><span class="say">${esc(r.s.target)}</span>`
      : `<span class="tm">${hhmmss(r.at)}</span><b>${esc(r.who)}</b><span class="ar">→</span><span class="v ${r.s.ok === false ? "bad" : ""}">${esc(r.s.verb)}</span> <span class="tg">${esc(r.s.target || "")}</span>${r.s.result ? ` <span class="rs ${r.s.ok === false ? "bad" : ""}">${r.s.ok === false ? "✕" : "✓"} ${esc(r.s.result)}</span>` : ""}`;
    let el = have.has(r.k) ? box.querySelector(`[data-k="${CSS.escape(r.k)}"]`) : null;
    if (!el) { el = document.createElement("div"); el.className = "lv-line in"; el.dataset.k = r.k; box.appendChild(el); }
    if (el._html !== html) { el.innerHTML = html; el._html = html; }
  }
  while (box.children.length > 60) box.firstElementChild.remove();
  if (stick) box.scrollTop = box.scrollHeight;
  const live = ops.filter(o => o.status === "running").length;
  const bar = document.getElementById("lvBar");
  if (bar) { bar.className = "lv-bar" + (live ? " on" : ""); bar.textContent = live > 1 ? `${live} agents working in parallel` : live ? "1 agent working" : "channel idle"; }
}

// ---------------- Code: session grid + session drawer ----------------
function stepLine(s, live) {
  if (s.kind === "text") return `<div class="s say"><b>says</b><span>${esc(s.target || "")}</span></div>`;
  if (s.kind !== "tool") return "";
  const diff = (s.diff || []).length ? `<div class="cd-diff">${s.diff.map(l => `<span class="${l[0] === "+" ? "a" : "d"}">${esc(l)}</span>`).join("\n")}</div>` : "";
  return `<div class="s ${s.ok === false ? "bad" : ""} ${live && !s.done && s.result === undefined ? "run" : ""}"><b>${esc(s.verb || s.tool)}</b><span>${esc(s.target || "")}</span>${s.result ? `<em>· ${esc(s.result)}</em>` : ""}</div>${diff}`;
}
async function vCode(el) {
  const filt = hstore.get("hq-code-filter", "all"), net = hstore.get("hq-code-net", phone() ? "0" : "1") === "1";
  el.innerHTML = `<div class="tui">
    <div class="tui-head"><div><h1>Code · LUTHUR</h1><p class="sub">Talk to LUTHUR, your coding manager. Focused workers share Markdown handoffs; simple requests stay with him.</p></div>
      <div class="tui-acts"><span class="tui-cap" id="lvCap"></span><button class="btn primary" id="lvManager" type="button">Talk to LUTHUR</button><button class="btn" id="lvImport" type="button">Bring in session</button><button class="btn" id="lvNew" type="button">+ Workroom</button></div></div>
    <div class="tui-bar"><div class="tui-chips" role="group" aria-label="Show">${[["all", "All"], ["run", "Working"], ["bad", "Needs a look"]].map(([k, l]) => `<button type="button" data-cf="${k}" class="${filt === k ? "on" : ""}">${l}</button>`).join("")}</div>
      <div class="tui-chips" role="group" aria-label="Layout"><button type="button" data-lay="grid" class="${codeLayout() === "grid" ? "on" : ""}">Grid</button><button type="button" data-lay="split" class="${codeLayout() === "split" ? "on" : ""}">Side by side</button></div>
      <button type="button" class="tui-tog" id="lvNetTog" aria-pressed="${net}">${net ? "Hide" : "Show"} agent map</button></div>
    <div class="lv-top" id="lvTop" ${net ? "" : "hidden"}>${netShell("code")}</div>
    <div class="lv-grid" id="lvGrid"></div><div class="sp-wrap" id="lvSplit" hidden></div></div>
    <div class="lv-drawer" id="lvDrawer" hidden><div class="lv-dscrim" data-close></div><div class="card lv-dpanel tui-d"><div class="cd-main" id="cdMain"></div></div></div>`;
  document.getElementById("lvNew").onclick = codeNewModal;
  document.getElementById('lvManager').onclick=codeManagerModal;
  document.getElementById("lvImport").onclick = () => codeImportModal();
  el.querySelectorAll("[data-cf]").forEach(b => b.onclick = () => { hstore.set("hq-code-filter", b.dataset.cf); el.querySelectorAll("[data-cf]").forEach(x => x.classList.toggle("on", x === b)); codeGrid(); });
  document.getElementById("lvNetTog").onclick = e => { const on = hstore.get("hq-code-net", phone() ? "0" : "1") !== "1"; hstore.set("hq-code-net", on ? "1" : "0"); document.getElementById("lvTop").hidden = !on; e.target.textContent = `${on ? "Hide" : "Show"} agent map`; e.target.setAttribute("aria-pressed", String(on)); if (on) netUpdate(document.getElementById("lvNet"), "code"); };
  el.querySelectorAll("[data-lay]").forEach(b => b.onclick = () => { hstore.set("hq-code-layout", b.dataset.lay); el.querySelectorAll("[data-lay]").forEach(x => x.classList.toggle("on", x === b)); codeGrid(); });
  el.querySelector("[data-close]").onclick = codeClose;
  if (!Live.code) Live.code = await api("/code").catch(() => ({ sessions: [], max: 4, running: 0 }));
  codeGrid(); livePoll();
  if (route.arg) codeOpen(route.arg);
}
function codeGrid() {
  const g = document.getElementById("lvGrid"); if (!g || !Live.code) return;
  const { sessions, max, running } = Live.code;
  const cap = document.getElementById("lvCap"); if (cap) { cap.innerHTML = `<i class="${running ? "on" : ""}"></i>${running}/${max} running`; }
  const split = codeLayout() === "split";
  g.hidden = split; const sp = document.getElementById("lvSplit"); if (sp) { sp.hidden = !split; if (split) splitRender(); }
  if (split) return;
  const filt = hstore.get("hq-code-filter", "all");
  const shown = sessions.filter(s => filt === "run" ? s.busy : filt === "bad" ? s.error && !s.busy : true);
  const tile = s => {
    const op = s.busy ? Live.ops.find(o => o.id === s.opId) : null;
    const steps = op ? op.steps.slice(-6) : s.steps.map(x => ({ kind: "tool", ...x, done: true })).slice(-5);
    const lines = steps.map(x => x.kind === "text" ? `<div class="ln say">${esc(x.target)}</div>`
      : `<div class="ln ${x.ok === false ? "bad" : x.result !== undefined || x.done ? "ok" : "run"}"><b>${esc(x.verb || "")}</b>(${esc(x.target || "")})${x.result ? `<div class="rs">└ ${x.ok === false ? "✕" : "✓"} ${esc(x.result)}</div>` : ""}</div>`).join("");
    const foot = s.busy ? `<span class="run">✱ Working ${fmtDur(Live.now - (op?.startedAt || Live.now))}</span><span>${op ? `${op.calls} steps · <span class="a">+${op.added}</span> <span class="d">−${op.removed}</span>` : ""}</span>`
      : s.messages ? `<span class="${s.error ? "bad" : "ok"}">${s.error ? "✕ Needs a look" : "✓ Done"}${s.ms ? ` (${fmtDur(s.ms)})` : ""}</span><span>${s.added || s.removed ? `<span class="a">+${s.added}</span> <span class="d">−${s.removed}</span>` : ""}</span>` : `<span>○ Ready</span><span></span>`;
    return `<div class="lv-tile ${s.busy ? "run" : s.error ? "bad" : ""}" style="--pc:${projColor(s.project)}" data-open-s="${esc(s.id)}" tabindex="0" role="button" aria-label="Open ${esc(s.name)}">
      <div class="h"><i>✱</i><b>${esc(s.name)}</b><span class="pj">${esc(s.projectName)}</span><span class="rule"></span><button class="x" data-side="${esc(s.id)}" title="Open side by side" aria-label="Open side by side" type="button">⇥</button>${s.busy ? `<button class="x" data-stop="${esc(s.id)}" title="Stop" aria-label="Stop" type="button">■</button>` : `<button class="x" data-closes="${esc(s.id)}" title="Close session" aria-label="Close session" type="button">✕</button>`}</div>
      ${s.task ? `<div class="task">↳ ${esc(s.task)}</div>` : ""}
      <div class="lines">${lines || `<div class="ln dim">${s.reply ? esc(s.reply) : "Click to give it a job."}</div>`}</div>
      <div class="f">${foot}</div></div>`;
  };
  const empty = !sessions.length ? `<div class="tui-empty"><b>No sessions yet.</b><span>Start a new one, or bring in a Claude Code session you already have open in the terminal or VS Code.</span></div>` : !shown.length ? `<div class="tui-empty"><span>Nothing here. <a href="javascript:void 0" data-cf-all>Show all</a></span></div>` : "";
  const html = empty + shown.map(tile).join("") + `<button class="lv-tile lv-add" type="button" id="lvAdd"><span>+</span>New session<small>runs in parallel with the others</small></button>`;
  if (g._html !== html) {
    g.innerHTML = html; g._html = html;
    g.querySelectorAll("[data-open-s]").forEach(t => { t.onclick = e => { if (!e.target.closest("button")) codeOpen(t.dataset.openS); }; t.onkeydown = e => { if (e.key === "Enter") codeOpen(t.dataset.openS); }; });
    g.querySelectorAll("[data-stop]").forEach(b => b.onclick = () => api(`/code/${b.dataset.stop}/stop`, "POST").then(liveKick).catch(x => toast(x.message)));
    g.querySelectorAll("[data-closes]").forEach(b => b.onclick = async () => { if (!(await uiConfirm("Close this session? Its history is archived."))) return; await api(`/code/${b.dataset.closes}`, "DELETE").catch(x => toast(x.message)); Live.code = await api("/code").catch(() => Live.code); codeGrid(); });
    g.querySelectorAll("[data-side]").forEach(b => b.onclick = () => splitAdd(b.dataset.side));
    g.querySelector("[data-cf-all]")?.addEventListener("click", () => document.querySelector('[data-cf="all"]')?.click());
    document.getElementById("lvAdd").onclick = codeNewModal;
  }
}
// ---------------- side by side: several sessions as full chat columns, each with its own box ----------------
const Split = { data: new Map(), seen: new Map(), busy: new Set() };
function codeLayout() { return phone() ? "grid" : hstore.get("hq-code-layout", "grid") === "split" ? "split" : "grid"; }
function splitIds() {
  let ids = []; try { ids = JSON.parse(hstore.get("hq-code-split", "[]")); } catch {}
  const have = new Set((Live.code?.sessions || []).map(s => s.id));
  ids = ids.filter(id => have.has(id));
  if (!ids.length) ids = (Live.code?.sessions || []).slice(0, 2).map(s => s.id);
  return ids.slice(0, 3);
}
function splitAdd(id) {
  const ids = splitIds().filter(x => x !== id); ids.push(id);
  hstore.set("hq-code-split", JSON.stringify(ids.slice(-3))); hstore.set("hq-code-layout", "split");
  document.querySelectorAll("[data-lay]").forEach(x => x.classList.toggle("on", x.dataset.lay === "split"));
  codeGrid();
}
function splitDrop(id) { hstore.set("hq-code-split", JSON.stringify(splitIds().filter(x => x !== id))); Split.data.delete(id); splitRender(); }
function splitRender() {
  const wrap = document.getElementById("lvSplit"); if (!wrap) return;
  const ids = splitIds(), sess = id => (Live.code?.sessions || []).find(s => s.id === id);
  if (!ids.length) { wrap.innerHTML = `<div class="tui-empty"><b>No sessions yet.</b><span>Start one with + New session.</span></div>`; return; }
  const keyNow = ids.join(",") + "|" + (Live.code?.sessions || []).filter(s => ids.includes(s.id)).length;
  if (wrap.dataset.k !== keyNow) {
    wrap.dataset.k = keyNow;
    const others = (Live.code?.sessions || []).filter(s => !ids.includes(s.id));
    wrap.innerHTML = ids.map(id => { const s = sess(id); return `<section class="sp-col" data-sp="${esc(id)}" style="--pc:${projColor(s.project)}">
        <header><i></i><b>${esc(s.name)}</b><span>${esc(s.projectName)}</span><button type="button" class="x" data-sp-open="${esc(id)}" title="Open full" aria-label="Open full">⤢</button><button type="button" class="x" data-sp-drop="${esc(id)}" title="Remove from side by side" aria-label="Remove">✕</button></header>
        <div class="sp-log" id="spLog-${esc(id)}"><div class="cd-empty"><b>Loading…</b></div></div>
        <form class="sp-in" data-sp-form="${esc(id)}"><textarea rows="2" placeholder="Ask ${esc(s.name)}… (Ctrl+Enter)"></textarea><div class="sp-row"><span class="sp-st" id="spSt-${esc(id)}"></span><button type="button" class="btn sm" onclick="codeSettingsModal('${id}')">Agent & limits</button><button type="button" class="btn sm" data-sp-stop="${esc(id)}" hidden>■ Stop</button><button class="btn sm primary">Run</button></div></form></section>`; }).join("")
      + (ids.length < 3 && others.length ? `<div class="sp-add"><span>Add a session</span>${others.slice(0, 8).map(o => `<button type="button" data-sp-add="${esc(o.id)}" style="--pc:${projColor(o.project)}"><i></i>${esc(o.name)}</button>`).join("")}</div>` : "");
    wrap.querySelectorAll("[data-sp-drop]").forEach(b => b.onclick = () => splitDrop(b.dataset.spDrop));
    wrap.querySelectorAll("[data-sp-open]").forEach(b => b.onclick = () => codeOpen(b.dataset.spOpen));
    wrap.querySelectorAll("[data-sp-add]").forEach(b => b.onclick = () => splitAdd(b.dataset.spAdd));
    wrap.querySelectorAll("[data-sp-stop]").forEach(b => b.onclick = () => api(`/code/${b.dataset.spStop}/stop`, "POST").then(liveKick).catch(x => toast(x.message)));
    wrap.querySelectorAll("[data-sp-form]").forEach(f => {
      const id = f.dataset.spForm, ta = f.querySelector("textarea");
      const go = async () => {
        const text = ta.value.trim(); if (!text) return;
        try { await api(`/code/${id}`, "POST", { text, tier: currentTier(), effort: currentEffort() === "auto" ? null : currentEffort(), mode: hstore.get("hq-cv-mode-" + id, cvDefaultMode()) }); ta.value = ""; Split.seen.delete(id); Snd.blip(980, .06); liveKick(); splitLoad(id); }
        catch (e) { toast(e.message, 5000); }
      };
      f.onsubmit = e => { e.preventDefault(); go(); };
      ta.onkeydown = e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); go(); } };
    });
    Split.seen.clear();
  }
  for (const id of ids) { const s = sess(id); if (s && (s.busy || Split.seen.get(id) !== s.messages)) splitLoad(id); else splitLive(id); }
}
async function splitLoad(id) {
  if (Split.busy.has(id)) return; Split.busy.add(id);
  try {
    const d = await api(`/code/${id}`).catch(() => null); if (!d) return;
    Split.data.set(id, d); Split.seen.set(id, (Live.code?.sessions || []).find(s => s.id === id)?.messages);
    const log = document.getElementById("spLog-" + id); if (!log) return;
    const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    const html = d.messages.length ? d.messages.slice(-30).map(codeMsgHTML).join("") : `<div class="cd-empty"><b>${esc(d.name)}</b>Ask for a feature, a fix or an explanation.</div>`;
    if (log.dataset.n !== String(d.messages.length)) { log.innerHTML = html + `<div class="sp-live" id="spLive-${esc(id)}"></div>`; log.dataset.n = String(d.messages.length); log.scrollTop = log.scrollHeight; }
    else if (stick) log.scrollTop = log.scrollHeight;
    splitLive(id);
  } finally { Split.busy.delete(id); }
}
function splitLive(id) {
  const d = Split.data.get(id), s = (Live.code?.sessions || []).find(x => x.id === id); if (!d || !s) return;
  const op = s.busy ? Live.ops.find(o => o.id === s.opId) : null;
  const live = document.getElementById("spLive-" + id), st = document.getElementById("spSt-" + id), stop = document.querySelector(`[data-sp-stop="${CSS.escape(id)}"]`);
  if (live) live.innerHTML = s.busy ? `<div class="cd-msg hq"><div class="cd-steps">${(op?.steps || []).filter(x => x.kind === "tool" || x.kind === "text").slice(-10).map(x => stepLine(x, true)).join("")}<div class="s run"><b>${op ? "Working" : "Starting"}</b><span>${op ? `${op.calls} steps · ${fmtDur(Date.now() - op.startedAt)}` : ""}</span></div></div></div>` : "";
  if (st) st.innerHTML = s.busy ? `<span class="run">✱ working</span>` : s.error ? `<span class="bad">needs a look</span>` : d.level === "build" ? "can edit" : "read-only";
  if (stop) stop.hidden = !s.busy;
  const log = document.getElementById("spLog-" + id); if (s.busy && log && log.scrollHeight - log.scrollTop - log.clientHeight < 120) log.scrollTop = log.scrollHeight;
}

// Bring in a Claude Code session started elsewhere (terminal, VS Code) for one of the project's folders.
async function codeImportModal(slug) {
  const projs = codeProjects();
  if (!projs.length) { toast("Add a folder to a project first (project, then Setup)."); return; }
  slug = slug || (activeProject() && projs.some(p => p.slug === activeProject()) ? activeProject() : projs[0].slug);
  modal(`<h2>Bring in a session</h2><p class="small muted" style="margin-top:-4px">Pick up a Claude Code conversation you started in the terminal or VS Code. LUTHUR continues from a copy, so the original stays as it is.</p>
    <label class="f">Project<select id="ciProj">${projs.map(p => `<option value="${p.slug}" ${p.slug === slug ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>
    <div class="ci-list" id="ciList"><div class="small muted">Looking…</div></div>
    <div class="row" style="justify-content:flex-end;margin-top:8px"><button type="button" class="btn" onclick="closeModal()">Close</button></div>`);
  document.getElementById("ciProj").onchange = e => codeImportModal(e.target.value);
  const list = await api(`/code/external/${slug}`).catch(e => ({ error: e.message }));
  const box = document.getElementById("ciList"); if (!box) return;
  if (list.error) { box.innerHTML = `<div class="small">${esc(list.error)}</div>`; return; }
  box.innerHTML = list.length ? list.map(x => `<button type="button" class="ci-row" data-ci="${esc(x.id)}" ${x.imported ? "disabled" : ""}>
      <b>${esc(x.title || x.ask.slice(0, 70))}</b><span>${x.title && x.ask ? esc(x.ask) : ""}</span>
      <small>${esc(ago(x.updatedAt))}${x.folder ? " · " + esc(x.folder) : ""} · ${x.sizeKb > 1024 ? (x.sizeKb / 1024).toFixed(1) + " MB" : x.sizeKb + " KB"}${x.imported ? " · already in LUTHUR" : ""}</small></button>`).join("")
    : `<div class="small muted">No Claude Code sessions found for this project's folders on this PC.</div>`;
  box.querySelectorAll("[data-ci]").forEach(b => b.onclick = async () => {
    b.disabled = true;
    try { const { id } = await api("/code/import", "POST", { project: slug, session: b.dataset.ci }); closeModal(); Live.code = await api("/code"); codeGrid(); codeOpen(id); toast("Session brought in"); }
    catch (x) { b.disabled = false; toast(x.message, 5000); }
  });
}
function codeNewModal() {
  const projs = codeProjects();
  if (!projs.length) { toast("Add a folder to a project first (project → Setup)."); return; }
  const def = activeProject() && projs.some(p => p.slug === activeProject()) ? activeProject() : projs[0].slug;
  modal(`<h2>New code session</h2><form class="form" id="lvNewF"><label class="f">Project<select name="project">${projs.map(p => `<option value="${p.slug}" ${p.slug === def ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>
    <label class="f">Name (optional)<input name="name" maxlength="40" placeholder="e.g. billing, tests, UI"></label>
    <label class="f">First job (optional)<textarea name="text" rows="3" placeholder="What should this session do?"></textarea></label>
    <div class="row" style="justify-content:flex-end;margin-top:6px"><button type="button" class="btn" onclick="closeModal()">Cancel</button><button class="btn primary">Start</button></div></form>`);
  document.getElementById("lvNewF").onsubmit = async e => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
    try {
      const { id } = await api("/code", "POST", { project: f.project, name: f.name });
      if (String(f.text || "").trim()) await api(`/code/${id}`, "POST", { text: f.text, tier: currentTier() });
      closeModal(); Live.code = await api("/code"); codeGrid(); codeOpen(id); liveKick(); corePing?.();
    } catch (x) { toast("⚠ " + x.message, 5000); }
  };
}
function codeOpen(id) {
  const d = document.getElementById("lvDrawer"); if (!d) return;
  Code.slug = id; Code.data = null; d.hidden = false; requestAnimationFrame(() => d.classList.add("on"));
  history.replaceState(null, "", "#code/" + encodeURIComponent(id)); route.arg = id;
  document.getElementById("cdMain").innerHTML = `<div class="cd-empty"><b>Loading…</b></div>`;
  codeLoad(true);
}
function codeClose() {
  const d = document.getElementById("lvDrawer"); if (!d) return;
  d.classList.remove("on"); setTimeout(() => { if (!d.classList.contains("on")) d.hidden = true; }, 300); clearTimeout(Code.poll); Code.slug = null;
  history.replaceState(null, "", "#code"); route.arg = null;
}
// The session pane (inside the drawer). Same chat as before, keyed by session id.
async function codeLoad(full) {
  const id = Code.slug; if (!id) return;
  const d = await api(`/code/${id}`).catch(e => ({ error: e.message }));
  if (route.view !== "code" || Code.slug !== id) return;
  const prevLen = Code.data?.id === id ? Code.data.messages.length : -1;
  Code.data = d;
  const main = document.getElementById("cdMain"); if (!main) return;
  if (d.error) { main.innerHTML = `<div class="cd-empty"><b>Can't open</b>${esc(d.error)}<button class="btn" type="button" onclick="codeClose()">Close</button></div>`; return; }
  if(!d.settings){main.innerHTML=`<div class="cd-empty"><b>Restart LUTHUR to activate Code settings</b><p>Run RESTART-LUTHUR, then refresh this window.</p><button class="btn" onclick="codeClose()">Close</button></div>`;return;}
  if (full || !main.querySelector(".cd-log")) {
    const ro = d.effectiveLevel !== "build";
    main.innerHTML = `<div class="cd-bar"><button class="btn sm ghost" type="button" id="cdBack" aria-label="Back">←</button><b>LUTHUR · ${esc(d.name)}</b><span class="pill ${ro ? "amber" : "green"}">${ro ? "read-only" : "can edit"}</span><span class="path" title="${esc(d.folders.join("; "))}">${esc(d.found.join(" · ") || "folder not found on this PC")}</span>
        <button class="btn sm" id="cdSettings" type="button">Agent & limits</button>${phone() ? "" : `<button class="btn sm" id="cdSide" type="button" title="Show next to other sessions">Open side by side</button>`}<button class="btn sm" id="cdStop" type="button" ${d.busy ? "" : "hidden"}>■ Stop</button></div>
      ${d.sameProject ? `<div class="cd-warn">${d.sameProject} other session${d.sameProject > 1 ? "s are" : " is"} working in this project right now. Keep their jobs on different files.</div>` : ""}
      <div class="code-settings-summary">${esc(d.settings.provider)} · ${esc(d.settings.model)} · ${esc(d.settings.permission)} · ${esc(d.settings.orchestration)} · ${d.effectiveMinutes} min · ${d.settings.maxCalls} calls · ceiling: ${esc(d.level)}</div><details class="code-workroom"><summary>LUTHUR · workroom notes</summary><div id="cdWorkroom"></div></details>
      <div class="cv-use cd-use" id="cdUse"></div>
      <div class="cd-log" id="cdLog"></div>
      <form class="cd-in" id="cdForm"><textarea id="cdText" rows="2" placeholder="${ro ? "Talk to LUTHUR about the code (read-only here)…" : "Tell LUTHUR what to build or fix… (Ctrl+Enter)"}"></textarea><button class="btn primary" id="cdSend">Send to LUTHUR</button></form>`;
    document.getElementById("cdSettings").onclick = () => codeSettingsModal(id);
    codeComposerRestore(id);
    const ta = document.getElementById("cdText");
    ta.oninput = () => { ta.style.height = "auto"; ta.style.height = Math.min(220, ta.scrollHeight) + "px"; };
    ta.onkeydown = e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); codeSend(); } };
    document.getElementById("cdForm").onsubmit = e => { e.preventDefault(); codeSend(); };
    document.getElementById("cdStop").onclick = () => api(`/code/${id}/stop`, "POST").catch(x => toast(x.message));
    document.getElementById("cdBack").onclick = codeClose;
    document.getElementById("cdMode")?.addEventListener("change", async e => { if (e.target.value === "bypass" && !(await uiConfirm("Bypass mode lets this session run any command and edit any file in the project folders without asking.\nPush, deploy, delete-repo and secrets stay blocked.\n\nTurn it on?"))) { e.target.value = hstore.get("hq-cv-mode-" + id, "safe"); return; } hstore.set("hq-cv-mode-" + id, e.target.value); });
    document.getElementById("cdSide")?.addEventListener("click", () => { codeClose(); splitAdd(id); });
  }
  const cu = document.getElementById("cdUse"); if (cu && typeof usageHTML === "function") cu.innerHTML = usageHTML(d.usage);
  const notes=document.getElementById('cdWorkroom');if(notes)notes.innerHTML=Object.entries(d.workroom||{}).map(([kind,text])=>`<section><b>${esc(kind.toUpperCase())}.md</b> <button type="button" class="btn sm" onclick="codeNoteEdit('${kind}')" ${d.busy?'disabled':''}>Edit</button><div class="md">${md(text)}</div></section>`).join('')||'Markdown notes appear after your first request.';
  const log = document.getElementById("cdLog");
  const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  if (full || prevLen !== d.messages.length) {
    log.innerHTML = d.messages.length ? d.messages.map(codeMsgHTML).join("") : `<div class="cd-empty"><b>${esc(d.name)}</b>Ask for a feature, a fix, a refactor or an explanation. You'll see every file it reads and edits, and why, live.</div>`;
    if (!full && d.messages.at(-1)?.role === "hq") { const last = log.lastElementChild; if (last) revealHTML(last.querySelector(".md"), 1200); Snd.blip(1320, .06); }
  }
  let liveBox = document.getElementById("cdLive");
  if (d.busy) {
    if (!liveBox) { liveBox = document.createElement("div"); liveBox.id = "cdLive"; liveBox.className = "cd-msg hq"; log.appendChild(liveBox); }
    const op = Live.ops.find(o => o.id === d.opId) || (await api("/live").catch(() => ({ ops: [] }))).ops?.find(o => o.id === d.opId);
    const steps = (op?.steps || []).filter(s => s.kind === "tool" || s.kind === "text");
    liveBox.innerHTML = `<div class="cd-steps">${steps.slice(-16).map(s => stepLine(s, true)).join("")}<div class="s run"><b>${steps.length ? "Working" : "Starting"}</b><span>${op ? `${op.calls} steps · <span class="a">+${op.added}</span> <span class="d">−${op.removed}</span> · ${fmtDur(Date.now() - op.startedAt)}` : ""}</span></div></div>`;
  } else liveBox?.remove();
  if (stick || full) log.scrollTop = log.scrollHeight;
  const stop = document.getElementById("cdStop"); if (stop) stop.hidden = !d.busy;
  const send = document.getElementById("cdSend"); if (send) send.disabled = d.busy;
  clearTimeout(Code.poll);
  if (d.busy || Date.now() - Code.sentAt < 3000) Code.poll = setTimeout(() => codeLoad(false), 1100);
}
async function codeSend() {
  const ta = document.getElementById("cdText"); const text = ta?.value.trim(); if (!text || Code.data?.busy) return;
  const sendButton=document.getElementById("cdSend"); if(sendButton?.disabled)return; if(sendButton)sendButton.disabled=true;
  try { await api(`/code/${Code.slug}`, "POST", { text, tier: currentTier(), effort: currentEffort() === "auto" ? null : currentEffort(), mode: hstore.get("hq-cv-mode-" + Code.slug, "safe") }); }
  catch (e) { if(sendButton)sendButton.disabled=false;toast("⚠ " + e.message, 5000); return; }
  hstore.set("hq-code-draft-"+Code.slug, "");
  ta.value = ""; ta.style.height = ""; Code.sentAt = Date.now(); Snd.blip(980, .06); corePing?.(); opsKick?.(); liveKick();
  codeLoad(false);
}

// ---------------- Tasks: delegate → watch the agents → report back ----------------
const TK_ST = { queued: ["", "queued"], running: ["blue", "working"], paused: ["amber", "paused"], done: ["green", "done"], issue: ["red", "needs a look"], partly: ["amber", "partly done"], cancelled: ["", "cancelled"] };
const CAN = [["read", "Just look and tell me"], ["plan", "Can update my notes"], ["build", "Can write code"]];
async function vTasks(el) {
  const can = hstore.get("hq-task-can", "plan"), name = esc(S.settings.assistantName || "LUTHUR");
  el.innerHTML = `<div class="between"><div><h1>Tasks</h1><p class="sub">Give ${name} a job. It works on it in the background and tells you here (and on your phone) when it's done.</p></div></div>
    <form class="card lv-ask" id="tkForm" autocomplete="off">
      <textarea id="tkText" rows="2" placeholder="What do you need done? e.g. Find 3 cheaper hosting options for Borrow Fast"></textarea>
      <div class="lv-ask-row">
        <button type="button" class="btn mic" id="tkMic" aria-label="Talk">${MIC_SVG}</button>
        <button type="button" class="tk-opt" id="tkOptBtn" aria-expanded="false"><span id="tkSum"></span><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg></button>
        <button class="btn primary lv-go">Send to ${name}</button>
      </div>
      <div class="tk-opts" id="tkOpts" hidden>
        <label class="tk-o"><span>Which project?</span><select id="tkProj" aria-label="Project">${projOptions(activeProject(), "Any / all of LUTHUR")}</select></label>
        <div class="tk-o"><span>What's it allowed to do?</span><div class="tiers lv-can" role="group" aria-label="Allowed to">${CAN.map(([k, l]) => `<button type="button" data-can="${k}" class="${k === can ? "on" : ""}">${l}</button>`).join("")}</div></div>
        <div class="tk-o"><span>Speed and brain power</span>${tierSwitch()}</div>
        <p class="small muted" style="margin:0">Fast is quick and cheap. Opus is the smartest but uses your limit faster. Effort = how hard it thinks; Auto is fine for most jobs.</p>
      </div>
    </form>
    <div class="tk-how" id="tkHow"><div><b>1</b><span>Tell it the job</span><small>Type or talk. Big jobs get split between several helpers.</small></div><div><b>2</b><span>It works on it</span><small>You can watch live below, or leave and do something else.</small></div><div><b>3</b><span>You get a report</span><small>Result, what it did, and anything it needs from you. Reply to ask for changes.</small></div></div>
    <div class="lv-top" id="tkLive" hidden>${netShell("tasks")}</div>
    <div id="tkList"></div>`;
  bindTierSwitch(el);
  const sum = () => { const c = CAN.find(x => x[0] === hstore.get("hq-task-can", "plan")) || CAN[1], pj = document.getElementById("tkProj"); document.getElementById("tkSum").textContent = `${pj?.value ? pj.selectedOptions[0].textContent : "All of LUTHUR"} · ${c[1].replace(/^Can /, "")} · ${cap(currentTier() === "deep" ? "Opus" : currentTier())}`; };
  el.querySelectorAll("[data-can]").forEach(b => b.onclick = () => { hstore.set("hq-task-can", b.dataset.can); el.querySelectorAll("[data-can]").forEach(x => x.classList.toggle("on", x === b)); sum(); });
  document.getElementById("tkProj").onchange = sum;
  el.querySelector("#tkOpts").addEventListener("click", () => setTimeout(sum, 50));
  document.getElementById("tkOptBtn").onclick = e => { const o = document.getElementById("tkOpts"); o.hidden = !o.hidden; e.currentTarget.setAttribute("aria-expanded", String(!o.hidden)); };
  sum();
  const ta = document.getElementById("tkText");
  ta.onkeydown = e => { if (e.key === "Enter" && !e.shiftKey && !touchDev()) { e.preventDefault(); taskSend(); } };
  document.getElementById("tkForm").onsubmit = e => { e.preventDefault(); taskSend(); };
  document.getElementById("tkMic").onclick = () => voiceOnce(t => { ta.value = t; }, t => { ta.value = t; taskSend(); }, document.getElementById("tkMic"));
  if (!Live.tasks) { const r = await api("/tasks").catch(() => null); Live.tasks = r?.tasks || []; for (const t of Live.tasks) Live.taskSeen.set(t.id, t.status); }
  taskList(); livePoll();
}
async function taskSend(text) {
  const ta = document.getElementById("tkText"); text = (text ?? ta?.value ?? "").trim(); if (!text) return;
  try { await api("/tasks", "POST", { text, project: document.getElementById("tkProj")?.value || null, permission: hstore.get("hq-task-can", "plan"), tier: currentTier() }); }
  catch (e) { toast("⚠ " + e.message, 5000); return; }
  if (ta) ta.value = ""; Snd.blip(980, .06); corePing?.(); liveKick();
  Cine.show([[".lv-task.st-queued, .lv-task.st-running", "Sent · it reports back when done"]]);
}
function taskList() {
  const box = document.getElementById("tkList"); if (!box) return;
  const ts = Live.tasks || [];
  const open = ts.filter(t => ["running", "queued", "paused"].includes(t.status)), rest = ts.filter(t => !open.includes(t));
  const card = t => {
    const [cls, lbl] = TK_ST[t.status] || ["", t.status];
    const agents = t.runs.filter(r => !r.reply);
    const chain = agents.map((r, i) => `<span class="lv-chip st-${r.status}" title="${esc(r.title)}"><i></i>${i ? `agent-${i + 1}` : "lead"}</span>`).join(`<span class="lv-link"></span>`);
    const liveOp = Live.ops.find(o => t.runs.some(r => r.id === o.id && o.status === "running"));
    const last = liveOp?.steps.at(-1);
    const lastOut = [...t.runs].reverse().find(r => r.output || r.error);
    const thread = t.runs.filter(r => r.reply).map(r => `<div class="lv-you">↳ ${esc(r.prompt || r.title)}</div>`).join("");
    const subs = agents.slice(1).filter(r => r.output);
    return `<div class="card lv-task st-${t.status}" data-task="${t.id}" ${t.project ? `style="--pc:${projColor(t.project)}"` : ""}>
      <div class="h"><span class="pill ${cls}">${lbl}</span><b>${esc(t.title)}</b><span class="faint small">${t.project ? esc(projName(t.project)) + " · " : ""}${ago(t.createdAt)}</span>
        ${open.includes(t) ? `<button class="btn sm ghost" data-tcancel="${t.id}" type="button">Cancel</button>` : ""}<button type="button" class="btn sm ghost" data-upopen="${esc(JSON.stringify({ kind: "task", id: t.id }))}">Edit / details</button></div>
      ${agents.length > 1 || open.includes(t) ? `<div class="lv-chain">${chain}</div>` : ""}
      ${liveOp ? `<div class="lv-now"><span class="dot pulse"></span>${esc(agentName(liveOp))} · ${last ? (last.kind === "text" ? "“" + esc(last.target) + "”" : `${esc(last.verb)} ${esc(last.target)}`) : "starting…"}</div>` : ""}
      ${thread}
      ${!open.includes(t) && lastOut ? `<div class="lv-report"><div class="lbl">Report</div><div class="md-wrap">${md(lastOut.output || lastOut.error || "")}</div>
        ${subs.length ? `<details><summary class="small muted">${subs.length} sub-agent report${subs.length > 1 ? "s" : ""}</summary>${subs.map(r => `<div class="lv-sub"><b>${esc(r.title)}</b>${md(r.output)}</div>`).join("")}</details>` : ""}</div>
        <form class="lv-reply" data-treply="${t.id}"><input placeholder="Reply or ask for changes…" aria-label="Reply"><button class="btn sm">Send</button></form>` : ""}
    </div>`;
  };
  const html = (open.length ? `<h2 class="lv-h">Working on</h2>${open.map(card).join("")}` : "")
    + (rest.length ? `<h2 class="lv-h">Reports</h2>${rest.slice(0, 3).map(card).join("")}${rest.length > 3 ? `<details class="lv-older"><summary>${rest.length - 3} older report${rest.length > 4 ? "s" : ""}</summary>${rest.slice(3, 20).map(card).join("")}</details>` : ""}` : "")
    + (!ts.length ? `<div class="card lv-emptyt"><b>No tasks yet.</b> Type one above, tap the mic, or say “Hey ${esc(S.settings.assistantName || "LUTHUR")}, …” with hands-free on.</div>` : "");
  const lv = document.getElementById("tkLive"); if (lv) { const was = lv.hidden; lv.hidden = !open.length; if (was && !lv.hidden) netUpdate(document.getElementById("lvNet"), "tasks"); }
  const how = document.getElementById("tkHow"); if (how) how.hidden = ts.length > 2;
  const typing = box.contains(document.activeElement) && document.activeElement.tagName === "INPUT";
  // Compare with what was last drawn, not box.innerHTML: the browser re-serializes attributes, so that never matched
  // and the whole list (open reports, the Edit buttons) was redrawn on every poll, which flickered.
  if (box._html !== html && !typing) {
    box.innerHTML = html; box._html = html;
    box.querySelectorAll("[data-tcancel]").forEach(b => b.onclick = () => api(`/tasks/${b.dataset.tcancel}/cancel`, "POST").then(liveKick).catch(x => toast(x.message)));
    box.querySelectorAll("[data-treply]").forEach(f => f.onsubmit = async e => {
      e.preventDefault(); const v = f.querySelector("input").value.trim(); if (!v) return;
      await api(`/tasks/${f.dataset.treply}/reply`, "POST", { text: v }).then(() => { f.querySelector("input").value = ""; liveKick(); }).catch(x => toast(x.message));
    });
  }
  // report back: a task that just finished speaks up
  for (const t of ts) {
    const was = Live.taskSeen.get(t.id);
    if (was && ["running", "queued", "paused"].includes(was) && ["done", "issue", "partly"].includes(t.status)) {
      const out = [...t.runs].reverse().find(r => r.output)?.output || "";
      const first = out.replace(/\*\*Result\*\*:?/i, "").replace(/[#*_`>]/g, "").split(/\n+/).map(x => x.trim()).filter(Boolean)[0] || "";
      toast(`${t.status === "done" ? "Done" : t.status === "partly" ? "Partly done" : "Needs a look"}: ${t.title}`, 6000); Snd.blip(1320, .08);
      speakAlways(`${t.status === "done" ? "Task complete" : t.status === "partly" ? "Task partly done" : "A task needs your attention"}: ${t.title}. ${first}`);
    }
    Live.taskSeen.set(t.id, t.status);
  }
}

// ---------------- voice: one-shot listen, speech, and "Hey JARVIS" hands-free ----------------
function speakAlways(text, onEnd) {
  if (!window.speechSynthesis || hstore.get("hq-mute", "0") === "1") { onEnd?.(); return; }
  const plain = String(text).replace(/```[\s\S]*?```/g, " ").replace(/[#*_`>|]/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\n+/g, ". ").slice(0, 600);
  const u = new SpeechSynthesisUtterance(plain), vs = speechSynthesis.getVoices();
  u.voice = vs.find(v => /en-GB/i.test(v.lang) && /(Ryan|George|Thomas|Male|Daniel|Arthur)/i.test(v.name)) || vs.find(v => /en-GB/i.test(v.lang)) || vs.find(v => /^en/i.test(v.lang)) || null;
  u.rate = 1.04; u.pitch = .95; if(typeof configureVoice==="function")configureVoice(u);
  u.volume = Math.max(0, Math.min(1, Number(hstore.get("hq-voice-volume", "1"))));
  let done = false; const fin = () => { if (!done) { done = true; onEnd?.(); } };
  u.onend = fin; u.onerror = fin; setTimeout(fin, 1500 + plain.length * 85); // Safari sometimes never fires onend
  speechSynthesis.cancel(); if(typeof speechPlaybackStart==='function')speechPlaybackStart(u);if(typeof ForceStop==='undefined'||!ForceStop.stopped)speechSynthesis.speak(u);
}
function voiceOnce(onInterim, onFinal, btn) {
  Wake.pause();
  listen((t, done) => done ? onFinal(t) : onInterim(t), on => { btn?.classList.toggle("live", on); if (!on) Wake.resume(); try { coreState(); } catch {} });
}
// Phones play a system beep every time speech recognition starts or stops, and their recognisers end after a few
// seconds, so always-on listening would beep forever. On phones the hands-free button listens once per tap instead.
const WAKE_PHONE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (matchMedia("(pointer: coarse)").matches && !matchMedia("(pointer: fine)").matches);
const Wake = {
  rec: null, ready:false, on: false, paused: false, armed: 0, buf: "", committed: "", t: 0, fails: 0, turnId:0,
  supported: () => !!SR,
  init() { this.on = !WAKE_PHONE && hstore.get("hq-wake", "1") === "1" && !!SR; this.btn(); if (this.on) this.start(); document.addEventListener("visibilitychange", () => { if (document.hidden) this.stop(true); else if (this.on) this.start(); }); },
  toggle() {
    if (!SR) { toast("Hands-free needs Safari, Chrome or Edge."); return; }
    if (WAKE_PHONE) { // one sentence per tap: no restart loop, so no repeated beeps
      if (typeof listen !== "function") return;
      return listen((t, done) => { if (done && t.trim()) { const m = t.match(/^\s*(?:hey|hi|ok|okay|yo)?\s*(?:jarvis|luthur|luther|luthor)\b[\s,.!?]*(.*)$/i); voiceCommand((m ? m[1] : t).trim() || t); } },
        on => { document.querySelectorAll(".wake-btn").forEach(b => b.classList.toggle("on", on)); try { coreState(); if (on) corePing(); } catch {} });
    }
    this.denied=false; this.on = !this.on; hstore.set("hq-wake", this.on ? "1" : "0"); this.btn();
    if (this.on) { this.start(); toast(`Hands-free on. Say “Hey ${S.settings.assistantName || "LUTHUR"}” then what you need.`, 4500); } else { this.stop(true); toast("Hands-free off"); }
  },
  btn() { document.querySelectorAll(".wake-btn").forEach(b => { b.classList.toggle("on", this.on); b.setAttribute("aria-pressed", String(this.on)); b.title = this.on ? "Hands-free on: say “Hey JARVIS”" : "Turn on hands-free (“Hey JARVIS”)"; }); document.body.classList.toggle("wake-on", this.on); },
  pause() { this.paused = true; this.stop(true); },
  resume() { this.paused = false; if (this.on) setTimeout(() => this.start(), 400); },
  start() {
    if (this.denied || !SR || WAKE_PHONE || this.rec || this.paused || !this.on || document.hidden || (typeof speechPlaybackBlocked==='function'&&speechPlaybackBlocked())) return;
    const r = new SR(); this.rec = r;
    const segments=new Map();let epoch=this.turnId,carry=this.buf.trim();
    r.lang = "en-US"; r.continuous = true; r.interimResults = true;
    r.onresult = e => {
      if (this.rec!==r||this.paused||!this.on||(typeof speechPlaybackBlocked==='function'&&speechPlaybackBlocked())) return;
      if(epoch!==this.turnId){segments.clear();carry="";epoch=this.turnId;}
      for (let i = e.resultIndex; i < e.results.length; i++) { const res=e.results[i],t=res[0].transcript.trim(); if(speechNoise(t,res.isFinal?res[0].confidence:0)) segments.delete(i); else segments.set(i,t); }
      if(!segments.size&&!carry) return;
      const txt=speechJoin([carry,...[...segments].sort((a,b)=>a[0]-b[0]).map(x=>x[1])]);
      const final = e.results[e.results.length - 1].isFinal;
      this.heard(txt.trim(), final, true);
    };
    r.onstart=()=>{if(this.rec!==r||this.paused)return;this.ready=true;if(typeof speechStatus==='function')speechStatus('listening');};
    // No "hearing" on onspeechstart: fans and wind fire it too. The status changes when real words arrive.
    r.onerror = e => { if(this.rec!==r)return;if(!['no-speech','aborted'].includes(e.error))this.ready=false;if(typeof speechStatus==='function'&&!['no-speech','aborted'].includes(e.error))speechStatus('mic-error',e.error);if (e.error === "not-allowed" || e.error === "service-not-allowed") { this.denied = true; this.on = false; hstore.set("hq-wake", "0"); this.btn(); toast("Mic blocked. Allow the microphone for this site, then turn hands-free on again.", 6000); } else if(!['no-speech','aborted'].includes(e.error))this.fails++; };
    r.onend = () => { if(this.rec!==r)return;this.ready=false;this.rec = null; if (this.on && !this.paused && !document.hidden) setTimeout(() => this.start(), Math.min(4000, 250 + this.fails * 600)); };
    try { r.start(); this.fails = 0; } catch { this.ready=false;this.rec = null;if(typeof speechStatus==='function')speechStatus('mic-error','Microphone could not start. Press Retry mic.'); }
  },
  stop(hard) { this.ready=false;const r = this.rec; this.rec = null; if (r) { r.onend = null; try { hard ? r.abort() : r.stop(); } catch {} } },
  heard(txt, final, snapshot=false) {
    if(typeof speechPlaybackBlocked==='function'&&speechPlaybackBlocked())return;
    if(!txt.trim())return;
    const m = txt.match(/^\s*(?:hey|hi|ok|okay|yo)?\s*(?:jarvis|jervis|travis|luthur|luther|luthor|lutha|lothar)\b[\s,.!?]*(.*)$/i);
    const name = (S.settings.assistantName || "LUTHUR").toLowerCase();
    const m2 = name !== "jarvis" ? txt.toLowerCase().match(new RegExp(`^\\s*${name.replace(/[^a-z0-9 ]/g, "")}\\b[\\s,.!?]*(.*)$`)) : null;
    const hit = m || m2;
    if (Brief.on && !hit) { if (final) Brief.voice(txt); return; }
    if (hit) { this.armed = Date.now(); this.buf = (hit[1] || "").trim(); this.committed = final ? this.buf : ""; document.body.classList.add("wake-heard"); try { coreState(); corePing(); } catch {} }
    else if (this.armed && Date.now() - this.armed < 8000) {
      this.buf = snapshot ? txt : [this.committed, txt].filter(Boolean).join(" ").trim();
      if (final) this.committed = this.buf;
      this.armed = Date.now();
    }
    else return;
    clearTimeout(this.t);
    const go = () => { const cmd = speechTidy(this.buf); this.turnId++;this.armed = 0; this.buf = ""; this.committed = ""; document.body.classList.remove("wake-heard"); if (cmd) voiceCommand(cmd); };
    this.t = setTimeout(() => { if (this.buf) go(); else { this.armed = Date.now(); } }, this.buf ? turnPauseFor(this.buf, turnPauseBase()) : 1600);
  },
};
/** Joins recognizer chunks. Chrome sometimes repeats the end of one chunk at the start of the next ("give me a briefing" + "briefing"), and a mic restart carries the turn so far: drop that overlap. */
function speechJoin(parts) {
  let out = [];
  for (const part of parts) {
    const w = String(part || "").trim().split(/\s+/).filter(Boolean), key = x => x.toLowerCase().replace(/[^a-z0-9']/g, "");
    let skip = 0;
    for (let n = Math.min(4, out.length, w.length); n > 0; n--) if (out.slice(-n).map(key).join(" ") === w.slice(0, n).map(key).join(" ")) { skip = n; break; }
    out = out.concat(w.slice(skip));
  }
  return out.join(" ");
}
/** Fan, wind and room noise: the recognizer turns it into lone fillers ("uh", "the", "you") or low-confidence scraps. */
const SPEECH_FILLER = new Set(["uh", "um", "umm", "hmm", "hm", "mm", "mhm", "ah", "oh", "huh", "eh", "the", "a", "an", "you", "i", "it", "and", "so", "in", "of", "to", "is", "ha", "shh"]);
function speechNoise(text, confidence = 0) {
  const words = String(text || "").toLowerCase().match(/[a-z0-9']+/g) || [];
  if (!words.length || words.every(w => SPEECH_FILLER.has(w))) return true;
  return confidence > 0 && confidence < 0.45 && words.length <= 3; // 0 = the browser gave no score
}
/** The turn as sent: a doubled final word ("briefing briefing") is a recognizer echo, not speech. */
function speechTidy(text) { return String(text || "").trim().replace(/\b(\w+)(?:[\s,]+\1)+([.!?]*)$/i, "$1$2"); }
/** Silence before a voice turn is sent. Trailing off on "and", "so", "um", a comma… means the owner is mid-thought: wait longer. */
const TRAILING=/(?:,|\b(?:and|but|or|so|because|cause|like|um+|uh+|er+|hmm+|the|a|an|to|of|with|for|if|then|which|that|my|your|is|are|was|i|we|maybe|also|plus|just|actually))\s*$/i;
/** Silence that ends a spoken turn (Settings → Voice). Was 1.8 s, and 3.2 s after "Hey LUTHUR": most of the wait before a reply. */
function turnPauseBase(){return Math.max(700,Math.min(2400,Number(localStorage.getItem("hq-turn-pause2")||1000)));}
// Context clues for "is the owner done?" (owner ask, 2026-10-08), judged from the words so far, no model call:
// - unfinished: ends on a joining/filler word (TRAILING), or on a phrase that needs more ("remind me to", "can you",
//   "set an alarm for", "I want", "what about"), or is just a name/one word → wait long (base + 2 s, up to 6 s)
// - finished: a full question or request that ends on a natural closer (please, thanks, now, today, tomorrow, a time,
//   a number) or a complete "what time is it" style question → answer sooner (70% of base, at least 0.6 s)
const NEEDS_MORE=/\b(?:can you|could you|would you|will you|can we|i want|i need|i'?d like|let'?s|remind me|tell me|show me|set (?:an? |the )?(?:alarm|reminder|timer)|what about|how about|what if|in|on|at|about|from|into|than|as|when|where|while|until|before|after|and then|not|don'?t|didn'?t|isn'?t|it'?s|there'?s|i'?m|you'?re|we'?re|gonna|wanna|going to|want to|need to|have to|kind of|sort of)\s*$/i;
const CLOSES=/\b(?:please|thanks|thank you|now|today|tonight|tomorrow|yesterday|this week|next week|right now|for me|o'?clock|am|pm|a\.m\.|p\.m\.|\d+)\s*$/i;
const FULL_Q=/^(?:hey |ok |okay )?(?:luth\w* )?(?:what|what'?s|when|where|who|why|how|which|is|are|do|does|did|can|could|should|will|would)\b.{8,}$/i;
function turnPauseFor(buf,base){
  const t=String(buf||'').trim().replace(/[.!?]+$/,''),words=t.split(/\s+/).filter(Boolean).length;
  if(/^(?:yes|yeah|yep|no|nope|nah|okay|ok|sure|thanks|thank you|stop|cancel|done|go ahead|do it)$/i.test(t))return Math.max(600,Math.round(base*0.7));
  if(TRAILING.test(t)||NEEDS_MORE.test(t)||words<=1)return Math.min(6000,Math.max(base*2,base+2000));
  if(words>=3&&(CLOSES.test(t)||FULL_Q.test(t)))return Math.max(600,Math.round(base*0.7));
  return base;
}
/** What a hands-free sentence does: navigation, briefing, or a message to JARVIS (big jobs it delegates as Tasks). */
function voiceCommand(cmd) {
  const c = cmd.toLowerCase().replace(/[.!?]+$/, "").trim();
  if (Brief.on && Brief.voice(c)) return;
  if (/^(brief me|briefing|overview|give me (an |the )?(overview|rundown|briefing)|catch me up|what('s| is) (up|on|next)|what do (we|i) (need|have) to do|run me through|walk me through|guide me|show me what to do|what should (we|i) do|where (do|should) i (go|start))/.test(c) || /\b(overview|briefing|rundown)\b/.test(c)) {
    const p = S.projects.find(p => c.includes(p.name.toLowerCase()) || c.includes(p.slug.replace(/-/g, " ")));
    return Brief.start(p?.slug);
  }
  const nav = c.match(/^(?:open|go to|show(?: me)?)\s+(?:the\s+)?(.+)$/);
  if (nav) {
    const want = nav[1].trim(), v = VIEWS.find(([k, t]) => want.startsWith(t.toLowerCase()) || want.startsWith(k));
    const p = S.projects.find(p => want.includes(p.name.toLowerCase()));
    if (v) { location.hash = v[0]; speakAlways(v[1]); setTimeout(() => Cine.show([["#view h1", v[1]]]), 700); return; }
    if (p) { location.hash = "project/" + p.slug; speakAlways(p.name); return; }
  }
  if (/^(stop|cancel|never ?mind|be quiet|shut up)$/.test(c)) { speechSynthesis?.cancel(); return; }
  // "pull up …", "read it out", "brief me on this": the Command screen handles it directly (fast, no tokens)
  if (typeof scrVoice === "function" && scrVoice(cmd)) return;
  toast(`Heard: “${cmd}”`);
  window.hqVoiceTurn = Date.now();
  api("/chat", "POST", { text: cmd, tier: currentTier(), voice: true }).then(() => { opsKick?.(); jarvisReplyWatch(); }).catch(e => toast(e.message));
}
// speak JARVIS's chat answer when it lands (hands-free mode doesn't need the JARVIS screen open)
async function jarvisReplyWatch() {
  const start = (await api("/chat").catch(() => null))?.messages?.length || 0;
  for (let i = 0; i < 90; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const c = await api("/chat").catch(() => null); if (!c) continue;
    if (!c.busy && c.messages.length > start) {
      if (typeof scrFromChat === "function") scrFromChat(c.screen);
      const last = c.messages.at(-1); if (last?.role !== "hq") return;
      if (!voiceOn() || route.view !== "assistant") speakChatReply(c, true); // shared short spoken reply; avoids duplicate playback
      toast(last.text.replace(/[#*_`>]/g, "").slice(0, 160), 7000);
      if (route.view === "tasks") liveKick();
      return;
    }
  }
}

const SPK_SVG = on => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/>${on ? `<path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>` : `<path d="M17 9l5 6M22 9l-5 6"/>`}</svg>`;
// ---------------- guided briefing: JARVIS walks you through what needs doing, screen by screen ----------------
const Brief = {
  on: false, steps: [], i: 0, paused: false, t: 0, el: null,
  build(slug) {
    const now = new Date(), name = S.settings.assistantName || "LUTHUR";
    const open = S.reminders.filter(r => !r.done), over = open.filter(r => toDate(r.due) < now);
    const drafts = (S.outbox || []).filter(x => x.status === "draft" || x.status === "failed");
    const pend = S.approvals.filter(a => a.status === "pending");
    const endDay = new Date(now); endDay.setHours(23, 59, 59);
    const evs = (S.calendar?.upcoming || []).filter(e => { const s = e.allDay ? toDate(e.start + "T00:00") : new Date(e.start); return s <= endDay && (e.allDay ? toDate(e.end + "T00:00") : new Date(e.end)) >= now; });
    const remToday = open.filter(r => { const d = toDate(r.due); return d >= now && d <= endDay; });
    const list = (a, f, n = 3) => a.slice(0, n).map(f).join(", ") + (a.length > n ? `, and ${a.length - n} more` : "");
    const tm = e => e.allDay ? "all day" : new Date(e.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const S2 = [];
    if (slug) {
      const p = S.projects.find(x => x.slug === slug);
      const pr = open.filter(r => r.project === slug), ms = S.milestones.filter(m => !m.done && m.project === slug).sort((a, b) => a.date.localeCompare(b.date));
      S2.push({ view: "project/" + slug, sel: "#view h1", title: p.name, say: `${p.name}. Stage: ${p.stage || "not set"}. Health: ${p.health || "unknown"}${p.progress != null ? `, about ${p.progress} percent done` : ""}.` });
      S2.push({ view: "project/" + slug, sel: "#view h1", title: "Next step", say: p.nextStep ? `The next step is: ${p.nextStep}.` : "There's no next step set. Worth deciding one." });
      if (pr.length) S2.push({ view: "project/" + slug, title: "Reminders", say: `Open reminders: ${list(pr, r => r.title)}.` });
      if (ms.length) S2.push({ view: "project/" + slug, title: "Dates", say: `Next date: ${ms[0].title}, ${fmtWhen(ms[0].date)}.` });
      S2.push({ view: "project/" + slug, title: "That's it", say: `That's ${p.name}. Say “Hey ${name}” and tell me what to do next, or I can delegate it as a task.`, end: true });
      return S2;
    }
    const hr = now.getHours(), urgent = over.length + drafts.filter(d => d.status === "failed").length + S.projects.filter(p => p.health === "risk" && p.stage !== "done").length;
    S2.push({ view: "command", sel: "#core", title: "Briefing", say: `${hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening"}. ${urgent ? `${urgent} urgent item${urgent > 1 ? "s" : ""}` : "Nothing urgent"}, ${drafts.length + pend.length} waiting on you, and ${evs.length + remToday.length} thing${evs.length + remToday.length === 1 ? "" : "s"} on today.` });
    if (over.length) S2.push({ view: "command", sel: "#cmdRight .nv-panel", title: "Overdue", say: `Overdue: ${list(over, r => r.title)}.` });
    const risk = S.projects.filter(p => p.health === "risk" && p.stage !== "done");
    if (risk.length) S2.push({ view: "command", sel: "#cmdRight .nv-panel", title: "At risk", say: `At risk: ${list(risk, p => `${p.name}${p.nextStep ? `, next: ${p.nextStep}` : ""}`, 2)}.` });
    if (drafts.length) S2.push({ view: "outbox", sel: "#view .ob-card, #view .card", title: "Outbox", say: `${drafts.length} ${drafts.length > 1 ? "drafts are" : "draft is"} waiting for your OK: ${list(drafts, d => d.kind === "email" ? `email, ${d.payload.subject}` : `event, ${d.payload.title}`)}. Nothing is sent until you press Send.` });
    if (pend.length) S2.push({ view: "missions", sel: "#view .card", title: "Approvals", say: `${pend.length} approval${pend.length > 1 ? "s" : ""}: ${list(pend, a => a.title)}.` });
    if (evs.length || remToday.length) S2.push({ view: "command", sel: "#cmdLeft .nv-panel", title: "Today", say: `Today: ${list([...evs.map(e => `${e.title} at ${tm(e)}`), ...remToday.map(r => r.title)], x => x, 4)}.` });
    const running = (S.status.active || []).length, ts = (Live.tasks || []).filter(t => t.status === "issue" && !t.seenBrief);
    if (running || ts.length) S2.push({ view: "tasks", sel: "#lvNet", title: "Agents", say: `${running ? `${running} agent${running > 1 ? "s are" : " is"} working right now.` : ""} ${ts.length ? `${ts.length} task${ts.length > 1 ? "s need" : " needs"} a look.` : ""}`.trim() });
    const next = S.projects.filter(p => p.stage !== "done" && p.nextStep).sort((a, b) => ({ risk: 0, watch: 1 }[a.health] ?? 2) - ({ risk: 0, watch: 1 }[b.health] ?? 2)).slice(0, 3);
    if (next.length) S2.push({ view: "projects", sel: `[data-open="${next[0].slug}"]`, title: "Next moves", say: `Next moves: ${next.map(p => `${p.name}: ${p.nextStep}`).join(". ")}.` });
    S2.push({ view: "command", sel: "#core", title: "Done", say: `That's the briefing. Say “Hey ${name}” with anything, or ask for an overview of a project.`, end: true });
    return S2;
  },
  start(slug) {
    if (!S) return;
    this.steps = this.build(slug); this.i = 0; this.on = true; this.paused = false;
    if (!this.el) {
      this.el = document.createElement("div"); this.el.id = "brief"; this.el.className = "brief";
      this.el.innerHTML = `<div class="cine-bars"></div><div class="brief-spot"></div><div class="brief-way"><b>▼</b><span>HERE</span></div><div class="brief-card" role="dialog" aria-live="polite"><div class="brief-top"><span class="brief-k">◆ BRIEFING</span><span class="brief-n"></span></div><div class="brief-t"></div><div class="brief-s"></div><div class="brief-dots"></div>
        <div class="brief-ctl"><button type="button" data-b="prev" aria-label="Back">◀</button><button type="button" data-b="pause" aria-label="Pause">❚❚</button><button type="button" data-b="next" aria-label="Next">▶</button><button type="button" data-b="mute" aria-label="Mute"></button><button type="button" data-b="exit" aria-label="Close">✕</button></div>
        <div class="brief-hint">Say “next”, “back”, “pause” or “stop”${Wake.on ? "" : " (with hands-free on)"}</div></div>`;
      document.body.appendChild(this.el);
      this.el.querySelector(".brief-ctl").onclick = e => { const b = e.target.closest("[data-b]")?.dataset.b; if (b) this.ctl(b); };
      this.el.querySelector(".brief-spot").onclick = () => this.ctl("next");
    }
    this.el.hidden = false; document.body.classList.add("briefing"); requestAnimationFrame(() => this.el.classList.add("on"));
    this.el.querySelector('[data-b="mute"]').innerHTML = SPK_SVG(hstore.get("hq-mute", "0") !== "1");
    this.show();
  },
  ctl(b) {
    if (b === "next") this.go(1); else if (b === "prev") this.go(-1);
    else if (b === "pause") { this.paused = !this.paused; this.el.querySelector('[data-b="pause"]').textContent = this.paused ? "▶︎" : "❚❚"; if (this.paused) { clearTimeout(this.t); speechSynthesis?.cancel(); } else this.show(); }
    else if (b === "mute") { const m = hstore.get("hq-mute", "0") === "1"; hstore.set("hq-mute", m ? "0" : "1"); this.el.querySelector('[data-b="mute"]').innerHTML = SPK_SVG(m); if (!m) speechSynthesis?.cancel(); }
    else if (b === "exit") this.end();
  },
  voice(c) {
    c = c.toLowerCase();
    if (/\b(next|continue|go on|skip)\b/.test(c)) this.go(1);
    else if (/\b(back|previous|again|repeat)\b/.test(c)) this.go(/again|repeat/.test(c) ? 0 : -1);
    else if (/\b(pause|wait|hold on)\b/.test(c)) { if (!this.paused) this.ctl("pause"); }
    else if (/\b(resume|play)\b/.test(c)) { if (this.paused) this.ctl("pause"); }
    else if (/\b(stop|exit|close|done|that's all|cancel)\b/.test(c)) this.end();
    else return false;
    return true;
  },
  place(low) {
    if (this.el.classList.contains("low") === low) return;
    const c = this.el.querySelector(".brief-card"); c.classList.add("swap");
    setTimeout(() => { this.el.classList.toggle("low", low); requestAnimationFrame(() => c.classList.remove("swap")); }, 220);
  },
  go(d) { clearTimeout(this.t); const n = this.i + d; if (n >= this.steps.length) return this.end(); this.i = Math.max(0, n); this.paused = false; this.el.querySelector('[data-b="pause"]').textContent = "❚❚"; this.show(); },
  async show() {
    const st = this.steps[this.i]; if (!st || !this.on) return;
    const want = st.view.split("/")[0], arg = st.view.split("/")[1] || null;
    if (route.view !== want || (arg && route.arg !== arg)) { location.hash = st.view; await new Promise(r => setTimeout(r, 650)); }
    if (!this.on || this.steps[this.i] !== st) return;
    const tgt = st.sel ? [...document.querySelectorAll(st.sel)].find(e => e.offsetParent !== null) : null;
    const spot = this.el.querySelector(".brief-spot");
    if (tgt) {
      await Cine.settle(tgt);
      if (!this.on || this.steps[this.i] !== st) return;
      const r = Cine.aim(tgt, spot, this.el.querySelector(".brief-way"));
      this.place(r.top + r.height / 2 < innerHeight / 2);
    } else { Cine.zoom(null); Object.assign(spot.style, { left: innerWidth / 2 + "px", top: innerHeight * .4 + "px", width: "0px", height: "0px", opacity: 1 }); this.el.querySelector(".brief-way").classList.remove("on"); this.place(false); }
    this.el.querySelector(".brief-n").textContent = `${this.i + 1} / ${this.steps.length}`;
    this.el.querySelector(".brief-t").textContent = st.title;
    const s = this.el.querySelector(".brief-s"); s.textContent = "";
    this.el.querySelector(".brief-dots").innerHTML = this.steps.map((_, j) => `<i class="${j < this.i ? "p" : j === this.i ? "c" : ""}"></i>`).join("");
    // type the line while it's spoken, then move on by itself
    const txt = st.say; s.textContent = txt; s.classList.remove("reveal"); void s.offsetWidth; s.classList.add("reveal");
    const t = this.el.querySelector(".brief-t"); t.classList.remove("reveal"); void t.offsetWidth; t.classList.add("reveal");
    try { corePing(); } catch {}
    const next = () => { if (!this.on || this.paused || this.steps[this.i] !== st) return; clearTimeout(this.t); this.t = setTimeout(() => st.end ? this.end(true) : this.go(1), st.end ? 2500 : 900); };
    if (hstore.get("hq-mute", "0") === "1" || !window.speechSynthesis) this.t = setTimeout(next, 2200 + txt.length * 45);
    else speakAlways(txt, next);
  },
  end(natural) {
    this.on = false; clearTimeout(this.t); clearInterval(this.typer); if (!natural) speechSynthesis?.cancel(); Cine.zoom(null);
    if (!this.el) return; this.el.classList.remove("on"); document.body.classList.remove("briefing"); setTimeout(() => { if (!this.on) this.el.hidden = true; }, 400);
  },
};
document.addEventListener("keydown", e => {
  if (!Brief.on) return;
  if (e.key === "Escape") Brief.end(); else if (e.key === "ArrowRight") Brief.go(1); else if (e.key === "ArrowLeft") Brief.go(-1); else if (e.key === " " && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName)) { e.preventDefault(); Brief.ctl("pause"); }
});

// ---------------- chrome: hands-free + brief buttons, phone tab bar ----------------
function liveChrome() {
  const top = document.querySelector(".top");
  if (top && !top.querySelector(".wake-btn")) {
    const w = document.createElement("button"); w.type = "button"; w.className = "wake-btn"; w.setAttribute("aria-label", "Hands-free");
    w.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg><span>Hey ${esc(S?.settings?.assistantName || "LUTHUR")}</span>`;
    w.onclick = () => Wake.toggle();
    const b = document.createElement("button"); b.type = "button"; b.className = "brief-btn"; b.title = "Guided briefing"; b.innerHTML = `▶<span> Brief me</span>`; b.onclick = () => Brief.start();
    top.querySelector("#openPal")?.after(w, b);
  }
  if (!document.getElementById("tabbar")) {
    const t = document.createElement("nav"); t.id = "tabbar"; t.className = "tabbar"; t.setAttribute("aria-label", "Main");
    const ico = { code: `<path d="M8 7l-5 5 5 5M16 7l5 5-5 5"/>`, tasks: `<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/>`, home: `<rect x="3.5" y="4.5" width="17" height="16" rx="2.5"/><path d="M3.5 9.5h17M8 2.5v4M16 2.5v4"/>`, menu: `<path d="M4 7h16M4 12h16M4 17h16"/>` };
    const a = (v, l) => `<a href="#${v}" data-tab="${v}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">${ico[v]}</svg><span>${l}</span></a>`;
    t.innerHTML = `${a("code", "Code")}${a("tasks", "Tasks")}<a href="#command" data-tab="command" class="tab-core"><i></i><span>War Room</span></a>${a("home", "Today")}<button type="button" data-tab="menu"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">${ico.menu}</svg><span>More</span></button>`;
    document.body.appendChild(t);
    t.querySelector('[data-tab="menu"]').onclick = () => sideSet(!document.body.classList.contains("side-open"));
    // any other tab closes the menu (even when it's the page you're already on)
    t.querySelectorAll('a[data-tab]').forEach(x => x.addEventListener("click", () => sideSet(false)));
    t.querySelector(".tab-core").addEventListener("dblclick", e => { e.preventDefault(); Wake.toggle(); });
  }
  const nt = document.getElementById("nTasks"); if (nt) nt.textContent = (S?.status?.active || []).length || "";
  const v = route.view === "project" ? "projects" : route.view;
  document.querySelectorAll("#tabbar [data-tab]").forEach(x => x.classList.toggle("on", x.dataset.tab === v));
  Wake.btn();
}

// ---------------- Command: when a project is in focus, show what's coming up and important for it ----------------
function focusPanel() {
  const R = document.getElementById("cmdRight"); if (!R) return;
  document.getElementById("nvFocus")?.remove();
  const ap = activeProject(), p = S.projects.find(x => x.slug === ap); if (!p) return;
  const now = new Date(), soon = new Date(now.getTime() + 30 * 864e5), day = d => Math.ceil((d - now) / 864e5);
  const rows = [];
  S.reminders.filter(r => !r.done && r.project === ap).forEach(r => { const d = toDate(r.due); if (d <= soon) rows.push({ d, t: r.title, k: d < now ? "red" : day(d) <= 2 ? "amber" : "", s: d < now ? `OVERDUE · ${fmtWhen(r.due)}` : `REMINDER · ${fmtWhen(r.due)}`, h: "#project/" + ap }); });
  S.milestones.filter(m => !m.done && m.project === ap).forEach(m => { const d = toDate(m.date + "T23:59"); if (d >= now && d <= new Date(now.getTime() + 60 * 864e5)) rows.push({ d, t: m.title, k: m.kind === "deadline" && day(d) <= 7 ? "red" : m.kind === "deadline" ? "amber" : "", s: `${m.kind === "deadline" ? "DEADLINE" : "MILESTONE"} · IN ${day(d)} DAY${day(d) === 1 ? "" : "S"}`, h: "#roadmap" }); });
  S.approvals.filter(a => a.status === "pending" && a.project === ap).forEach(a => rows.push({ d: now, t: a.title, k: "amber", s: "NEEDS YOUR OK", h: "#missions" }));
  (S.outbox || []).filter(x => (x.status === "draft" || x.status === "failed") && x.project === ap).forEach(x => rows.push({ d: now, t: x.kind === "email" ? `Email: ${x.payload?.subject || ""}` : `Event: ${x.payload?.title || ""}`, k: "amber", s: "WAITING TO SEND", h: "#outbox" }));
  rows.sort((a, b) => (a.k === "red" ? 0 : a.k === "amber" ? 1 : 2) - (b.k === "red" ? 0 : b.k === "amber" ? 1 : 2) || a.d - b.d);
  const goals = S.goals.filter(g => g.project === ap && g.steps?.some(x => !x.done)).slice(0, 3);
  const working = (S.status?.active || []).filter(r => r.project === ap);
  const codes = (Live.code?.sessions || []).filter(x => x.project === ap && x.busy);
  const el = document.createElement("div");
  el.className = "card nv-panel nv-focus"; el.id = "nvFocus"; el.style.setProperty("--pc", projColor(ap));
  el.innerHTML = `<div class="ttl">Focus <b>${esc(p.name)}</b></div>
    <div class="fx-meta"><span class="pill">${esc(p.stage)}</span><span class="pill ${p.health === "good" ? "green" : p.health === "watch" ? "amber" : p.health === "risk" ? "red" : ""}">${esc(p.health)}</span>${working.length + codes.length ? `<span class="pill blue">${working.length + codes.length} working</span>` : ""}</div>
    ${p.nextStep ? `<a class="fx-next" href="#project/${esc(ap)}"><small>NEXT STEP</small>${esc(p.nextStep)}</a>` : ""}
    ${rows.slice(0, 6).map(r => `<a class="nv-row sev-${r.k || "blue"}" href="${r.h}"><span class="led ${r.k}"></span><div style="min-width:0"><div class="t">${esc(r.t)}</div><small>${esc(r.s)}</small></div></a>`).join("") || `<div class="nv-empty">Nothing due for ${esc(p.name)} in the next 30 days.</div>`}
    ${goals.map(g => { const done = g.steps.filter(x => x.done).length, pct = Math.round(done / g.steps.length * 100); return `<a class="fx-goal" href="#planner"><span>${esc(g.title)}</span><i style="--w:${pct}%"></i><small>${done}/${g.steps.length} · next: ${esc(g.steps.find(x => !x.done)?.title || "")}</small></a>`; }).join("")}
    <div class="fx-acts"><a class="btn sm" href="#project/${esc(ap)}">Open project</a><button class="btn sm" type="button" id="fxAsk">Ask what's next</button><button class="btn sm ghost" type="button" id="fxAll">Clear focus</button></div>`;
  const L = document.getElementById("cmdLeft");
  if (phone() && L) L.prepend(el); else R.prepend(el); // phone: right under the ask box
  el.querySelector("#fxAll").onclick = () => setActiveProject("");
  el.querySelector("#fxAsk").onclick = () => { const i = document.getElementById("cmdText"); if (i) { i.value = `What's most important for ${p.name} right now?`; document.getElementById("cmdAsk")?.requestSubmit(); } };
}
const _cmdFill = cmdFill;
cmdFill = function (q) { _cmdFill(q); try { focusPanel(); } catch (e) { console.warn(e); } };

// ---------------- hooks into the existing app ----------------
const _render = render;
render = function () { _render(); document.body.dataset.view = route.view; liveChrome(); try { paintProjects(document.getElementById("view")); paintProjects(document.getElementById("nav")); } catch {} const pv = document.getElementById("view"); if (pv) { if (route.view === "project" && route.arg) pv.style.setProperty("--pc", projColor(route.arg)); else pv.style.removeProperty("--pc"); } if (route.view !== "code" && route.view !== "tasks") clearTimeout(Live.timer); if (route.view !== "code") clearTimeout(Code.poll); };
// phones: changing page always closes the menu drawer
addEventListener("hashchange", () => { if (phone() && document.body.classList.contains("side-open")) sideSet(false); });
// the sidebar button: on phones it's always a drawer (never "unpins" the desktop setting)
document.getElementById("sideBtn")?.addEventListener("click", e => { if (!phone()) return; e.stopImmediatePropagation(); sideSet(!document.body.classList.contains("side-open")); }, true);
window.addEventListener("resize", () => { if (route.view === "code" || route.view === "tasks") netUpdate(document.getElementById("lvNet"), route.view); });
window.addEventListener("DOMContentLoaded", () => { Wake.init(); });

// ---------------- effort (Claude Code --effort): Auto / Low / Medium / High next to every model switch ----------------
const EFFORTS = [["auto", "Auto"], ["low", "Low"], ["medium", "Med"], ["high", "High"]];
function currentEffort() { const e = hstore.get("hq-effort", "auto"); return EFFORTS.some(x => x[0] === e) ? e : "auto"; }
const _tierSwitch = tierSwitch, _bindTierSwitch = bindTierSwitch;
tierSwitch = function () {
  const cur = currentEffort(), fast = currentTier() === "fast";
  return `<div class="lv-tiers">${_tierSwitch()}<div class="tiers effort ${fast ? "na" : ""}" role="group" aria-label="Effort" title="${fast ? "Haiku has no effort setting" : "How hard it thinks: higher is smarter but slower and uses more of your limit"}"><span class="ef-l">Effort</span>${EFFORTS.map(([k, l]) => `<button type="button" data-effort="${k}" class="${cur === k ? "on" : ""}" aria-pressed="${cur === k}">${l}</button>`).join("")}</div></div>`;
};
bindTierSwitch = function (root) {
  _bindTierSwitch(root);
  root.querySelectorAll(".tiers [data-tier]").forEach(b => b.addEventListener("click", () => root.querySelectorAll(".tiers.effort").forEach(x => x.classList.toggle("na", b.dataset.tier === "fast"))));
  root.querySelectorAll(".tiers [data-effort]").forEach(b => b.onclick = () => {
    hstore.set("hq-effort", b.dataset.effort);
    root.querySelectorAll(".tiers [data-effort]").forEach(x => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", String(x === b)); });
  });
};
// Every request that picks a model also carries the effort (chat, Command ask box, Code, Tasks).
const _api = api;
api = function (path, method, body) {
  if (body && typeof body === "object" && "tier" in body && !("effort" in body) && currentEffort() !== "auto") body = { ...body, effort: currentEffort() };
  return _api(path, method, body);
};

// ---------------- cinematic camera: letterbox, spotlight, zoom toward the target, waypoint marker ----------------
const Cine = {
  el: null, t: 0,
  still: () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  /** Points the spotlight + waypoint at an element and leans the camera toward it. Returns its rect. */
  aim(tgt, spot, way) {
    const r0 = tgt.getBoundingClientRect(), m = 10;
    this.zoom(tgt);
    const r = { left: r0.left, top: r0.top, width: r0.width, height: Math.min(r0.height, innerHeight * .68) };
    Object.assign(spot.style, { left: r.left - m + "px", top: r.top - m + "px", width: r.width + m * 2 + "px", height: r.height + m * 2 + "px", opacity: 1 });
    if (way) { way.style.left = r.left + r.width / 2 + "px"; way.style.top = Math.max(8, r.top - m - 44) + "px"; way.classList.remove("on"); void way.offsetWidth; way.classList.add("on"); }
    return r;
  },
  /** Gentle push-in on #view toward the target (skipped with reduced motion or an open drawer). */
  zoom(tgt) { const v = document.getElementById("view"); if (v) { v.style.transform = ""; v.classList.remove("cine-cam"); } document.querySelectorAll(".cine-lit").forEach(e => e.classList.remove("cine-lit")); if (tgt && !this.still()) tgt.classList.add("cine-lit"); },
  /** Scroll the target into view and resolve once it has stopped moving (so the highlight lands exactly on it). */
  settle(tgt) {
    return new Promise(res => {
      const r0 = tgt.getBoundingClientRect(), off = r0.top < 70 || r0.bottom > innerHeight - 90;
      if (off) tgt.scrollIntoView({ block: "center", behavior: this.still() ? "auto" : "smooth" });
      let last = "", same = 0, n = 0;
      const tick = () => { const r = tgt.getBoundingClientRect(), k = `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)}`; same = k === last ? same + 1 : 0; last = k; if (same >= 4 || ++n > 70) res(); else requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
  },
  /** A short guided sequence: [[selector, caption], ...], ~2.6 s each. */
  async show(steps) {
    if (Brief.on) return;
    if (!this.el) {
      this.el = document.createElement("div"); this.el.className = "brief cine"; this.el.innerHTML = `<div class="cine-bars"></div><div class="brief-spot"></div><div class="brief-way"><b>▼</b><span></span></div>`;
      document.body.appendChild(this.el); this.el.onclick = () => this.end();
    }
    clearTimeout(this.t); this.el.hidden = false; requestAnimationFrame(() => this.el.classList.add("on"));
    for (const [sel, cap] of steps) {
      await new Promise(r => setTimeout(r, 350));
      const tgt = [...document.querySelectorAll(sel)].find(e => e.offsetParent !== null); if (!tgt || this.el.hidden) continue;
      await this.settle(tgt);
      const way = this.el.querySelector(".brief-way"); way.querySelector("span").textContent = cap;
      this.aim(tgt, this.el.querySelector(".brief-spot"), way); try { corePing(); } catch {}
      await new Promise(r => { this.t = setTimeout(r, 2600); });
    }
    this.end();
  },
  end() { if (!this.el) return; clearTimeout(this.t); this.el.classList.remove("on"); this.zoom(null); setTimeout(() => { if (!this.el.classList.contains("on")) this.el.hidden = true; }, 400); },
};

// ---------------- boot: an AI eye opens, scans the room, locks on, then you dive through the pupil ----------------
hudBoot = function (short) {
  return new Promise(resolve => {
    const b = document.getElementById("boot"); if (!b) return resolve();
    const name = (S?.settings?.assistantName || "LUTHUR").toUpperCase();
    const lines = short ? ["REACTIVATING CORE", "RESTORING SESSION"] : ["OPTICS ONLINE", S ? `${S.projects.length} PROJECT MODULES` : "PROJECT MODULES", S ? "CLAUDE LINK " + (S.status?.auth === "ok" ? "ESTABLISHED" : "STANDBY") : "CLAUDE LINK", "SCANNING ENVIRONMENT"];
    b.className = "boot eyeboot"; b.hidden = false;
    b.innerHTML = `<canvas class="eye-cv"></canvas><div class="eye-txt"><div class="eye-name">${esc(name)}</div><div class="eye-lines">${lines.map((l, i) => `<div style="animation-delay:${(short ? 500 : 1300) + i * (short ? 220 : 380)}ms">${esc(l)}</div>`).join("")}</div><div class="eye-final" id="bootFinal"></div></div><div class="boot-skip">CLICK OR PRESS ANY KEY TO SKIP</div>`;
    window.hqBooting = true; // background scene/orb/stars wait until the scan is done (smooth opening)
    document.documentElement.classList.add("hq-booting"); // the page stays hidden under the scan, then enters once
    const cv = b.querySelector("canvas"), x = cv.getContext("2d", { alpha: true, desynchronized: true }), dpr = Math.min(1.25, devicePixelRatio || 1);
    const size = () => { cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; cv.style.width = innerWidth + "px"; cv.style.height = innerHeight + "px"; };
    size(); addEventListener("resize", size);
    const T = short ? { open: [150, 650], scan: [650, 1500], lock: [1500, 1900], dive: [1900, 2400] } : { open: [350, 1350], scan: [1350, 3000], lock: [3000, 3600], dive: [3600, 4200] };
    const ease = t => t < 0 ? 0 : t > 1 ? 1 : 1 - Math.pow(1 - t, 3);
    const ph = (t, [a, z]) => ease((t - a) / (z - a));
    const dots = Array.from({ length: 48 }, (_, i) => i / 48 * Math.PI * 2);
    let t0 = performance.now(), raf = 0, done = false;
    // Opening scan stays silent: the rising oscillator sounded like an engine rev.
    const C = (a = 1) => `rgba(111,242,255,${a})`, Wt = (a = 1) => `rgba(220,252,255,${a})`;
    const poly = (n, r, rot) => { x.beginPath(); for (let i = 0; i <= n; i++) { const a = rot + i / n * Math.PI * 2; i ? x.lineTo(Math.cos(a) * r, Math.sin(a) * r) : x.moveTo(Math.cos(a) * r, Math.sin(a) * r); } x.closePath(); };
    const draw = now => {
      const t = now - t0, W = cv.width, H = cv.height, cx = W / 2, cy = H * .42, R = Math.min(W, H) * .15;
      x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, W, H);
      const open = ph(t, T.open), scan = ph(t, T.scan), lock = ph(t, T.lock), dive = ph(t, T.dive);
      const gx = scan > 0 && lock < 1 ? Math.sin(scan * Math.PI * 2.2) * R * .22 * (1 - lock) : 0, gy = scan > 0 && lock < 1 ? Math.sin(scan * Math.PI * 1.1) * R * .1 * (1 - lock) : 0;
      x.save(); x.translate(cx, cy); const z = 1 + dive * dive * 9; x.scale(z, z); x.globalAlpha = 1 - dive * .85;
      x.lineCap = "round"; x.lineJoin = "round";
      // octagon frame draws itself in, then a slow counter-rotating outer ring of ticks
      const fr = R * 1.9; x.strokeStyle = C(.55); x.lineWidth = 1.4 * dpr;
      x.setLineDash([fr * 6.2 * Math.min(1, t / 700), fr * 7]); poly(8, fr, Math.PI / 8); x.stroke(); x.setLineDash([]);
      x.save(); x.rotate(t / 2600); x.strokeStyle = C(.6 * Math.min(1, t / 500)); x.lineWidth = 1.1 * dpr;
      for (let i = 0; i < 72; i++) { const a = i / 72 * Math.PI * 2, l = i % 6 ? .04 : .1; x.beginPath(); x.moveTo(Math.cos(a) * R * 1.55, Math.sin(a) * R * 1.55); x.lineTo(Math.cos(a) * R * (1.55 + l), Math.sin(a) * R * (1.55 + l)); x.stroke(); }
      x.restore();
      x.save(); x.rotate(-t / 1100); x.strokeStyle = C(.9); x.lineWidth = 2.4 * dpr;
      for (let i = 0; i < 4; i++) { x.beginPath(); x.arc(0, 0, R * 1.32, i * Math.PI / 2, i * Math.PI / 2 + .7); x.stroke(); }
      x.restore();
      // the eye: lids open into an almond, a circuit iris with a breathing pupil looks around, blinks once, locks on
      const blink = short ? 0 : Math.max(0, 1 - Math.abs(t - (T.scan[0] + 700)) / 110);
      const o = open * open * (3 - 2 * open) * (1 - blink * .96), ew = R * 1.25, eh = R * .7 * o;
      const lids = () => { x.beginPath(); x.moveTo(-ew, 0); x.quadraticCurveTo(0, -eh * 2, ew, 0); x.quadraticCurveTo(0, eh * 2, -ew, 0); x.closePath(); };
      if (o > .02) {
        x.save(); lids(); x.clip();
        const sg = x.createRadialGradient(0, 0, R * .1, 0, 0, ew); sg.addColorStop(0, "#06283a"); sg.addColorStop(1, "#010a12");
        x.fillStyle = sg; x.fillRect(-ew, -R, ew * 2, R * 2);
        x.translate(gx, gy);
        const ri = R * .6, rp = ri * (.36 + .1 * (1 - scan) + Math.sin(t / 420) * .015 - lock * .12);
        // the iris texture is drawn once to an offscreen canvas and just rotated each frame (cheap)
        if (!cv._iris || cv._iris.r !== Math.round(ri)) {
          const S2 = Math.ceil(ri * 2 + 4), ic = document.createElement("canvas"); ic.width = ic.height = S2; const y = ic.getContext("2d"); y.translate(S2 / 2, S2 / 2);
          const rp0 = ri * .3, ig = y.createRadialGradient(0, 0, rp0, 0, 0, ri); ig.addColorStop(0, "rgba(111,242,255,.95)"); ig.addColorStop(.55, "rgba(40,150,210,.75)"); ig.addColorStop(1, "rgba(150,110,255,.9)");
          y.fillStyle = ig; y.beginPath(); y.arc(0, 0, ri, 0, Math.PI * 2); y.fill();
          for (let i = 0; i < 96; i++) { const a = i / 96 * Math.PI * 2, k = Math.abs((Math.sin(i * 12.9898) * 43758.5453) % 1), l = .55 + k * .45;
            y.strokeStyle = `rgba(${i % 3 ? "2,20,34" : "220,252,255"},${i % 3 ? .55 : .35})`; y.lineWidth = (i % 3 ? .9 : .7) * dpr;
            y.beginPath(); y.moveTo(Math.cos(a) * rp0 * 1.08, Math.sin(a) * rp0 * 1.08); y.lineTo(Math.cos(a) * (rp0 + (ri - rp0) * l), Math.sin(a) * (rp0 + (ri - rp0) * l)); y.stroke(); }
          y.fillStyle = "rgba(220,252,255,.9)"; for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; y.fillRect(Math.cos(a) * ri * .8 - 1.2 * dpr, Math.sin(a) * ri * .8 - 1.2 * dpr, 2.4 * dpr, 2.4 * dpr); }
          ic.r = Math.round(ri); cv._iris = ic;
        }
        x.save(); x.rotate(t / 5200); x.drawImage(cv._iris, -cv._iris.width / 2, -cv._iris.height / 2); x.restore();
        x.strokeStyle = "rgba(2,14,24,.8)"; x.lineWidth = 3 * dpr; x.beginPath(); x.arc(0, 0, ri, 0, Math.PI * 2); x.stroke();
        x.strokeStyle = C(.5); x.lineWidth = dpr; x.beginPath(); x.arc(0, 0, ri * 1.06, 0, Math.PI * 2); x.stroke();
        x.fillStyle = C(.6); for (const a of dots) { x.beginPath(); x.arc(Math.cos(a - t / 3000) * ri * 1.18, Math.sin(a - t / 3000) * ri * 1.18, 1.1 * dpr, 0, Math.PI * 2); x.fill(); }
        if (scan > 0 && lock < 1) { const sa = t / 380; x.fillStyle = "rgba(220,252,255,.14)"; x.beginPath(); x.moveTo(0, 0); x.arc(0, 0, ri, sa - .6, sa); x.closePath(); x.fill(); }
        // pupil: deep black with a glowing hex lens ring
        x.fillStyle = "#00040a"; x.beginPath(); x.arc(0, 0, rp, 0, Math.PI * 2); x.fill();
        x.strokeStyle = C(.25); x.lineWidth = 6 * dpr; poly(6, rp * .62, t / 1500); x.stroke(); // glow
        x.strokeStyle = lock > 0 ? Wt(1) : C(.95); x.lineWidth = 1.8 * dpr; poly(6, rp * .62, t / 1500); x.stroke();
        x.fillStyle = Wt(.9); x.beginPath(); x.arc(0, 0, rp * (.12 + lock * .1), 0, Math.PI * 2); x.fill();
        x.fillStyle = "rgba(255,255,255,.75)"; x.beginPath(); x.ellipse(-ri * .34, -ri * .38, ri * .13, ri * .08, -.6, 0, Math.PI * 2); x.fill();
        x.restore();
      }
      // lid edges: bright lash line + a faint second contour
      if (o > .02) { x.strokeStyle = C(.18); x.lineWidth = 9 * dpr; lids(); x.stroke(); x.strokeStyle = C(.3); x.lineWidth = 5 * dpr; lids(); x.stroke(); // glow
        x.strokeStyle = Wt(.95); x.lineWidth = 2.2 * dpr; lids(); x.stroke();
        x.strokeStyle = C(.35); x.lineWidth = dpr; x.beginPath(); x.moveTo(-ew * 1.12, 0); x.quadraticCurveTo(0, -eh * 2.5 - R * .08, ew * 1.12, 0); x.stroke(); x.beginPath(); x.moveTo(-ew * 1.12, 0); x.quadraticCurveTo(0, eh * 2.4 + R * .06, ew * 1.12, 0); x.stroke(); }
      else { const L = ew * (.3 + t / 1400); x.strokeStyle = C(.3); x.lineWidth = 8 * dpr; x.beginPath(); x.moveTo(-L, 0); x.lineTo(L, 0); x.stroke(); x.strokeStyle = Wt(.95); x.lineWidth = 2.4 * dpr; x.stroke(); }
      x.restore();
      // scanning beam: a lit band sweeps the screen top → bottom with a grid in its wake
      if (scan > 0 && scan < 1) {
        const y = scan * H, g = x.createLinearGradient(0, y - 140 * dpr, 0, y + 6 * dpr);
        g.addColorStop(0, "rgba(111,242,255,0)"); g.addColorStop(.9, "rgba(111,242,255,.10)"); g.addColorStop(1, "rgba(180,250,255,.9)");
        x.fillStyle = g; x.fillRect(0, y - 140 * dpr, W, 146 * dpr);
        x.strokeStyle = "rgba(111,242,255,.07)"; x.lineWidth = dpr;
        for (let gy2 = 0; gy2 < y; gy2 += 36 * dpr) { x.beginPath(); x.moveTo(0, gy2); x.lineTo(W, gy2); x.stroke(); }
        for (let gx2 = (W / 2) % (36 * dpr); gx2 < W; gx2 += 36 * dpr) { x.beginPath(); x.moveTo(gx2, 0); x.lineTo(gx2, y); x.stroke(); }
      }
      // lock-on brackets
      if (lock > 0 && dive < .3) {
        const s = R * (2.2 - lock * .7), k = R * .35; x.strokeStyle = `rgba(111,242,255,${lock})`; x.lineWidth = 2 * dpr;
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { x.beginPath(); x.moveTo(cx + sx * s, cy + sy * (s - k)); x.lineTo(cx + sx * s, cy + sy * s); x.lineTo(cx + sx * (s - k), cy + sy * s); x.stroke(); }
      }
      if (lock >= 1 && !b.dataset.locked) { b.dataset.locked = "1"; const f = document.getElementById("bootFinal"); if (f) { f.style.opacity = 1; scrambleTo(f, short ? "WELCOME BACK" : "ALL SYSTEMS ONLINE", 420); } }
      if (t < T.dive[1] + 60) raf = requestAnimationFrame(draw); else finish();
    };
    raf = requestAnimationFrame(draw);
    const finish = () => {
      if (done) return; done = true; cancelAnimationFrame(raf); removeEventListener("resize", size); window.hqBooting = false; try { sceneStart?.(); starsStart?.(); } catch {}
      document.removeEventListener("keydown", finish, true);
      b.classList.add("out");
      // one entrance, started as the scan fades (before, the finished page showed for a moment and then re-animated)
      { const v = document.getElementById("view"); window.nvAssembleLater = false; document.documentElement.classList.remove("hq-booting");
        if (!(typeof nvAssemble === "function" && nvAssemble(v))) { v.classList.remove("view-in"); void v.offsetWidth; v.classList.add("view-in"); } }
      setTimeout(() => { b.hidden = true; b.className = "boot"; b.innerHTML = ""; delete b.dataset.locked; try { navGlide(); } catch {} resolve(); }, 420);
    };
    b.onclick = finish;
    document.addEventListener("keydown", finish, true);
  });
};






