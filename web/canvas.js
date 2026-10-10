// Canvas: one pan/zoom board per project with cards you arrange freely: live agent chats (Code sessions),
// the project overview, goal checklists and notes. Tabs across the top; drag an agent card to the right edge
// (or press ⇥) to focus it in a column beside the board. Layouts are saved on the server (data/canvas).
"use strict";
VIEWS.splice(1, 0, ["canvas", "Canvas", "▦"]);
const CV = { list: [], data: null, hist: [], fut: [], saveT: 0, poll: 0, sess: new Map(), seen: new Map(), loading: new Set(), drag: null, el: null };
const CARD = { agent: [380, 470], project: [360, 470], checklist: [320, 300], note: [280, 220] };
const cvTint = sid => { let h = 0; for (const ch of String(sid)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return PC[h % PC.length]; };
const cvTabs = () => { try { return JSON.parse(hstore.get("hq-cv-tabs", "[]")).filter(id => CV.list.some(c => c.id === id)); } catch { return []; } };
const cvSetTabs = ids => hstore.set("hq-cv-tabs", JSON.stringify([...new Set(ids)].slice(-10)));
const cvFocus = () => { try { return JSON.parse(hstore.get("hq-cv-focus", "[]")).slice(0, 3); } catch { return []; } };
const cvSetFocus = ids => { hstore.set("hq-cv-focus", JSON.stringify([...new Set(ids)].slice(-3))); cvFocusRender(); };
const cvSess = sid => (Live.code?.sessions || []).find(s => s.id === sid);
const cvStack = () => phone();
const FOLDER = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;

async function vCanvas(el) {
  CV.el = el;
  const [list, code] = await Promise.all([api("/canvas").catch(() => []), api("/code").catch(() => null)]);
  CV.list = list; if (code) Live.code = code;
  let id = route.arg && list.some(c => c.id === route.arg) ? route.arg : null;
  const ap = activeProject();
  if (!id) { const last = hstore.get("hq-canvas", ""); id = (ap && list.filter(c => c.project === ap).at(-1)?.id) || (list.some(c => c.id === last) ? last : list.at(-1)?.id) || null; }
  if (!id) { const c = await cvCreateDefault(ap); if (!c) { el.innerHTML = `<h1>Canvas</h1><div class="card lv-emptyt"><b>No projects yet.</b> Add a project first.</div>`; return; } id = c.id; }
  CV.data = await api(`/canvas/${id}`).catch(() => null);
  if (!CV.data) { hstore.set("hq-canvas", ""); location.hash = "canvas"; return; }
  hstore.set("hq-canvas", id); cvSetTabs([...cvTabs(), id]); CV.hist = []; CV.fut = [];
  history.replaceState(null, "", "#canvas/" + id); route.arg = id;
  el.innerHTML = `<div class="cv ${cvStack() ? "stack" : ""}">
    <div class="cv-tabs" id="cvTabs"></div>
    <div class="cv-main"><div class="cv-area" id="cvArea" tabindex="-1">
        <div class="cv-crumb" id="cvCrumb"></div>
        <div class="cv-board" id="cvBoard"></div>
        <div class="cv-tools"><button type="button" data-t="add" title="Add a card" aria-label="Add a card">+</button><span></span><button type="button" data-t="in" title="Zoom in" aria-label="Zoom in">⊕</button><button type="button" data-t="out" title="Zoom out" aria-label="Zoom out">⊖</button><button type="button" data-t="fit" title="Fit everything" aria-label="Fit">⤢</button><span></span><button type="button" data-t="undo" title="Undo (Ctrl+Z)" aria-label="Undo">↶</button><button type="button" data-t="redo" title="Redo" aria-label="Redo">↷</button></div>
        <div class="cv-mini" id="cvMini" aria-hidden="true"></div>
        <div class="cv-drop" id="cvDrop"><span>Open to the right</span></div>
      </div><div class="cv-focus" id="cvFocus"></div></div></div>`;
  el.querySelectorAll("[data-t]").forEach(b => b.onclick = () => cvTool(b.dataset.t));
  cvTabsRender(); cvCrumb(); cvBind();
  cvDraw(true);
  if (!CV.data.view || (CV.data.view.x === 0 && CV.data.view.y === 0 && CV.data.view.z === 1)) cvFit(false);
  cvFocusRender(); cvPoll();
}

async function cvCreateDefault(slug, name) {
  const p = S.projects.find(x => x.slug === slug) || S.projects.find(x => (Live.code?.sessions || []).some(s => s.project === x.slug)) || S.projects[0];
  if (!p) return null;
  const cards = [{ id: "c-p", type: "project", x: 0, y: 0, w: CARD.project[0], h: CARD.project[1], ref: p.slug }];
  (Live.code?.sessions || []).filter(s => s.project === p.slug).slice(0, 4).forEach((s, i) => cards.push({ id: "c-a" + i, type: "agent", x: 400 + i * 410, y: 0, w: CARD.agent[0], h: CARD.agent[1], ref: s.id }));
  (S.goals || []).filter(g => g.project === p.slug).slice(0, 2).forEach((g, i) => cards.push({ id: "c-g" + i, type: "checklist", x: 0, y: 500 + i * 330, w: CARD.checklist[0], h: CARD.checklist[1], ref: g.id }));
  const c = await api("/canvas", "POST", { name: name || "Main canvas", project: p.slug, cards }).catch(e => { toast(e.message); return null; });
  if (c) CV.list.push({ id: c.id, name: c.name, project: c.project, cards: c.cards.length, updatedAt: c.updatedAt });
  return c;
}

// ---------------- tabs + breadcrumb ----------------
function cvTabsRender() {
  const box = document.getElementById("cvTabs"); if (!box) return;
  const ids = cvTabs();
  box.innerHTML = ids.map(id => { const c = CV.list.find(x => x.id === id); return `<div class="cv-tab ${id === CV.data.id ? "on" : ""}" style="--pc:${c.project ? projColor(c.project) : "var(--accent)"}"><button type="button" data-tab-go="${id}"><i></i>${esc(c.project ? projName(c.project) + " · " : "")}${esc(c.name)}</button><button type="button" class="x" data-tab-x="${id}" aria-label="Close tab">✕</button></div>`; }).join("")
    + `<button type="button" class="cv-tab-add" id="cvTabAdd" title="New or open a canvas" aria-label="New or open a canvas">+</button><span class="g"></span>`
    + (cvStack() ? "" : `<div class="cv-modes" role="group" aria-label="View"><button type="button" data-mode="0" class="${cvCols() ? "" : "on"}">Canvas</button><button type="button" data-mode="1" class="${cvCols() ? "on" : ""}">Columns</button></div>`);
  box.querySelectorAll("[data-tab-go]").forEach(b => b.onclick = () => { location.hash = "canvas/" + b.dataset.tabGo; });
  box.querySelectorAll("[data-tab-x]").forEach(b => b.onclick = () => { const left = cvTabs().filter(x => x !== b.dataset.tabX); cvSetTabs(left); if (b.dataset.tabX === CV.data.id) location.hash = "canvas/" + (left.at(-1) || ""); else cvTabsRender(); });
  document.getElementById("cvTabAdd").onclick = cvOpenModal;
  box.querySelectorAll("[data-mode]").forEach(b => b.onclick = () => {
    hstore.set("hq-cv-cols", b.dataset.mode);
    if (b.dataset.mode === "1" && !cvFocus().filter(id => cvSess(id)).length) cvSetFocus(CV.data.cards.filter(c => c.type === "agent" && cvSess(c.ref)).slice(0, 3).map(c => c.ref));
    cvTabsRender(); cvFocusRender(); if (b.dataset.mode === "0") setTimeout(() => { cvApplyView(); }, 50);
  });
}
function cvCrumb() {
  const c = document.getElementById("cvCrumb"); if (!c) return;
  c.innerHTML = `${CV.data.project ? `<a href="#project/${esc(CV.data.project)}">${esc(projName(CV.data.project))}</a><span>/</span>` : ""}<b title="Double-click to rename">${esc(CV.data.name)}</b>`;
  c.querySelector("b").ondblclick = () => { const n = prompt("Rename canvas", CV.data.name); if (n && n.trim()) { CV.data.name = n.trim().slice(0, 40); cvSave({ name: CV.data.name }); const l = CV.list.find(x => x.id === CV.data.id); if (l) l.name = CV.data.name; cvCrumb(); cvTabsRender(); } };
}
function cvOpenModal() {
  const ap = CV.data?.project || activeProject() || "";
  modal(`<h2>Canvases</h2><form class="form" id="cvNewF"><div class="two"><label class="f">Name<input name="name" maxlength="40" placeholder="e.g. Launch, Bugs, Ideas"></label><label class="f">Project<select name="project">${projOptions(ap, "None")}</select></label></div>
      <div class="row end"><button class="btn primary">Create canvas</button></div></form>
    <div class="cv-list">${CV.list.slice().reverse().map(c => `<div class="row"><span class="dot" style="background:${c.project ? projColor(c.project) : "var(--text3)"}"></span><a class="grow" href="#canvas/${c.id}" onclick="closeModal()">${esc(c.project ? projName(c.project) + " · " : "")}${esc(c.name)} <span class="faint small">${c.cards} cards</span></a><button type="button" class="btn sm ghost" data-cvdel="${c.id}">Delete</button></div>`).join("")}</div>`);
  document.getElementById("cvNewF").onsubmit = async e => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
    const c = f.project ? await cvCreateDefault(f.project, f.name) : await api("/canvas", "POST", { name: f.name, cards: [] }).catch(x => { toast(x.message); return null; });
    if (c) { closeModal(); location.hash = "canvas/" + c.id; }
  };
  document.querySelectorAll("[data-cvdel]").forEach(b => b.onclick = async () => {
    if (!(await uiConfirm("Delete this canvas? Sessions, goals and notes elsewhere are kept; only this layout (and its notes) goes."))) return;
    await api(`/canvas/${b.dataset.cvdel}`, "DELETE").catch(() => {}); CV.list = CV.list.filter(x => x.id !== b.dataset.cvdel); cvSetTabs(cvTabs());
    closeModal(); if (b.dataset.cvdel === CV.data.id) { hstore.set("hq-canvas", ""); location.hash = "canvas"; render(); } else cvTabsRender();
  });
}

// ---------------- board: transform, cards, minimap ----------------
function cvApplyView() {
  const v = CV.data.view, b = document.getElementById("cvBoard"), a = document.getElementById("cvArea"); if (!b || !a) return;
  if (cvStack()) { b.style.transform = ""; return; }
  b.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.z})`;
  a.style.backgroundPosition = `${v.x}px ${v.y}px`; a.style.backgroundSize = `${24 * v.z}px ${24 * v.z}px`;
  cvMini();
}
function cvDraw(full) {
  const b = document.getElementById("cvBoard"); if (!b) return;
  if (full) b.innerHTML = "";
  const have = new Set();
  for (const c of CV.data.cards) {
    have.add(c.id);
    let el = b.querySelector(`[data-c="${c.id}"]`);
    if (!el) { el = document.createElement("div"); el.className = `cv-card t-${c.type}`; el.dataset.c = c.id; el.innerHTML = cvCardHTML(c); b.appendChild(el); cvCardBind(el, c); }
    el.style.left = c.x + "px"; el.style.top = c.y + "px"; el.style.width = c.w + "px"; el.style.height = cvStack() ? "" : c.h + "px";
    el.style.setProperty("--tint", c.type === "agent" ? cvTint(c.ref) : c.type === "project" || c.type === "checklist" ? projColor(cvCardProject(c)) : "var(--text3)");
  }
  b.querySelectorAll(".cv-card").forEach(el => { if (!have.has(el.dataset.c)) el.remove(); });
  if (!CV.data.cards.length) b.innerHTML = `<div class="cv-empty"><b>Empty canvas</b><span>Press + to add an agent chat, the project overview, a checklist or a note.</span></div>`;
  cvApplyView(); cvRefresh();
}
function cvCardProject(c) { return c.type === "project" ? c.ref : c.type === "checklist" ? (S.goals || []).find(g => g.id === c.ref)?.project : c.type === "agent" ? cvSess(c.ref)?.project : CV.data.project; }
function cvMini() {
  const m = document.getElementById("cvMini"), a = document.getElementById("cvArea"); if (!m || !a || cvStack()) return;
  const cs = CV.data.cards; if (!cs.length) { m.innerHTML = ""; return; }
  const v = CV.data.view, vw = { x: -v.x / v.z, y: -v.y / v.z, w: a.clientWidth / v.z, h: a.clientHeight / v.z };
  const xs = [...cs.map(c => c.x), vw.x], ys = [...cs.map(c => c.y), vw.y], xe = [...cs.map(c => c.x + c.w), vw.x + vw.w], ye = [...cs.map(c => c.y + c.h), vw.y + vw.h];
  const X = Math.min(...xs), Y = Math.min(...ys), Wd = Math.max(...xe) - X, Ht = Math.max(...ye) - Y, k = Math.min(150 / Wd, 90 / Ht);
  m.innerHTML = cs.map(c => `<i style="left:${(c.x - X) * k}px;top:${(c.y - Y) * k}px;width:${Math.max(3, c.w * k)}px;height:${Math.max(3, c.h * k)}px;background:${c.type === "agent" ? cvTint(c.ref) : "rgba(150,210,255,.4)"}"></i>`).join("")
    + `<b style="left:${(vw.x - X) * k}px;top:${(vw.y - Y) * k}px;width:${vw.w * k}px;height:${vw.h * k}px"></b>`;
  m.style.width = Wd * k + "px"; m.style.height = Ht * k + "px";
}
function cvFit(save = true) {
  const a = document.getElementById("cvArea"), cs = CV.data.cards; if (!a || !cs.length || cvStack()) return;
  const X = Math.min(...cs.map(c => c.x)), Y = Math.min(...cs.map(c => c.y)), W = Math.max(...cs.map(c => c.x + c.w)) - X, H = Math.max(...cs.map(c => c.y + c.h)) - Y;
  const z = Math.max(.3, Math.min(1, (a.clientWidth - 80) / W, (a.clientHeight - 110) / H));
  CV.data.view = { z, x: (a.clientWidth - W * z) / 2 - X * z, y: 56 + (a.clientHeight - 56 - H * z) / 2 - Y * z };
  cvApplyView(); if (save) cvSave({ view: CV.data.view });
}
function cvZoom(f, cx, cy) {
  const a = document.getElementById("cvArea"), v = CV.data.view; if (!a) return;
  const r = a.getBoundingClientRect(); cx = cx ?? r.width / 2; cy = cy ?? r.height / 2;
  const z = Math.max(.25, Math.min(2, v.z * f)); const k = z / v.z;
  CV.data.view = { z, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k }; cvApplyView(); cvSaveSoon();
}

// ---------------- history + saving ----------------
function cvSnap() { CV.hist.push(JSON.stringify(CV.data.cards)); if (CV.hist.length > 50) CV.hist.shift(); CV.fut = []; }
function cvTool(t) {
  if (t === "in") cvZoom(1.2); else if (t === "out") cvZoom(1 / 1.2); else if (t === "fit") cvFit();
  else if (t === "undo" && CV.hist.length) { CV.fut.push(JSON.stringify(CV.data.cards)); CV.data.cards = JSON.parse(CV.hist.pop()); cvDraw(); cvSave({ cards: CV.data.cards }); }
  else if (t === "redo" && CV.fut.length) { CV.hist.push(JSON.stringify(CV.data.cards)); CV.data.cards = JSON.parse(CV.fut.pop()); cvDraw(); cvSave({ cards: CV.data.cards }); }
  else if (t === "add") cvAddMenu();
}
function cvSave(patch) { const id = CV.data.id; return api(`/canvas/${id}`, "PUT", patch).catch(e => toast(e.message)); }
function cvSaveSoon() { clearTimeout(CV.saveT); CV.saveT = setTimeout(() => cvSave({ cards: CV.data.cards, view: CV.data.view }), 500); }

// ---------------- pointer: pan, drag cards, resize, drop to the right ----------------
function cvBind() {
  const a = document.getElementById("cvArea"); if (!a || cvStack()) return;
  a.addEventListener("pointerdown", e => {
    if (e.button !== 0 || e.target.closest(".cv-tools, .cv-crumb, .cv-mini, .cv-empty")) return;
    const card = e.target.closest(".cv-card"), head = e.target.closest(".cv-h"), rs = e.target.closest(".cv-rs");
    if (card && !head && !rs) return; // inside a card: let it work normally
    if (head && e.target.closest("button, select, input, a")) return;
    const v = CV.data.view;
    if (rs || head) {
      const c = CV.data.cards.find(x => x.id === card.dataset.c); if (!c) return;
      cvSnap(); CV.drag = { mode: rs ? "resize" : "move", c, el: card, sx: e.clientX, sy: e.clientY, x: c.x, y: c.y, w: c.w, h: c.h };
      card.classList.add("lift"); card.parentElement.appendChild(card);
    } else CV.drag = { mode: "pan", sx: e.clientX, sy: e.clientY, x: v.x, y: v.y };
    a.setPointerCapture(e.pointerId); a.classList.add("grabbing"); e.preventDefault();
  });
  a.addEventListener("pointermove", e => {
    const d = CV.drag; if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy, z = CV.data.view.z;
    if (d.mode === "pan") { CV.data.view.x = d.x + dx; CV.data.view.y = d.y + dy; cvApplyView(); return; }
    if (d.mode === "move") {
      d.c.x = Math.round((d.x + dx / z) / 8) * 8; d.c.y = Math.round((d.y + dy / z) / 8) * 8; d.el.style.left = d.c.x + "px"; d.el.style.top = d.c.y + "px";
      const r = a.getBoundingClientRect(), near = d.c.type === "agent" && e.clientX > r.right - 130;
      document.getElementById("cvDrop").classList.toggle("on", d.c.type === "agent"); document.getElementById("cvDrop").classList.toggle("hot", near); d.near = near;
    } else { d.c.w = Math.max(220, Math.round((d.w + dx / z) / 8) * 8); d.c.h = Math.max(160, Math.round((d.h + dy / z) / 8) * 8); d.el.style.width = d.c.w + "px"; d.el.style.height = d.c.h + "px"; }
  });
  const up = () => {
    const d = CV.drag; if (!d) return; CV.drag = null; a.classList.remove("grabbing");
    document.getElementById("cvDrop")?.classList.remove("on", "hot");
    if (d.mode === "pan") { cvSaveSoon(); cvMini(); return; }
    d.el.classList.remove("lift");
    if (d.near) { d.c.x = d.x; d.c.y = d.y; d.el.style.left = d.x + "px"; d.el.style.top = d.y + "px"; CV.hist.pop(); cvSetFocus([...cvFocus(), d.c.ref]); Snd.blip(1100, .05); return; }
    if (d.c.x === d.x && d.c.y === d.y && d.c.w === d.w && d.c.h === d.h) { CV.hist.pop(); return; }
    cvMini(); cvSaveSoon();
  };
  a.addEventListener("pointerup", up); a.addEventListener("pointercancel", up);
  a.addEventListener("wheel", e => {
    const scroller = e.target.closest(".cv-log, .cv-scroll, textarea");
    if (scroller && !e.ctrlKey && scroller.scrollHeight > scroller.clientHeight) return;
    e.preventDefault();
    const r = a.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) cvZoom(Math.exp(-e.deltaY * .0025), e.clientX - r.left, e.clientY - r.top);
    else { CV.data.view.x -= e.deltaX; CV.data.view.y -= e.deltaY; cvApplyView(); cvSaveSoon(); }
  }, { passive: false });
  a.addEventListener("keydown", e => { if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return; if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); cvTool(e.shiftKey ? "redo" : "undo"); } });
  addEventListener("resize", cvMini);
}

// ---------------- cards ----------------
const cvX = (id, extra = "") => `${extra}<button type="button" class="x" data-cx="${id}" title="Remove from canvas" aria-label="Remove from canvas">✕</button>`;
function cvCardHTML(c) {
  const rs = `<span class="cv-rs" aria-hidden="true"></span>`;
  if (c.type === "agent") {
    const s = cvSess(c.ref);
    if (!s) return `<div class="cv-h"><i></i><b>Closed session</b><span class="g"></span>${cvX(c.id)}</div><div class="cv-b cv-pad muted small">This session was closed. Remove the card, or bring it back from Code.</div>${rs}`;
    return `<div class="cv-h"><i></i><b>${esc(s.name)}</b><em>Claude</em><span class="g"></span><span class="chip" title="${esc(s.projectName)}">${FOLDER}${esc(cvFolder(s.id))}</span>${cvX(c.id, `<button type="button" class="x" data-cf="${esc(s.id)}" title="Open to the right" aria-label="Open to the right">⇥</button>`)}</div>${cvAgentBody(s.id, c.id)}${rs}`;
  }
  if (c.type === "project") return `<div class="cv-h"><i></i><b>${esc(projName(c.ref))}</b><span class="g"></span><em>PROJECT</em>${cvX(c.id)}</div><div class="cv-b cv-scroll" id="cvP-${c.id}"></div>${rs}`;
  if (c.type === "checklist") return `<div class="cv-h"><i></i><b>Checklist</b><span class="g"></span>${cvX(c.id)}</div><div class="cv-b cv-scroll" id="cvG-${c.id}"></div>${rs}`;
  return `<div class="cv-h"><i></i><b>Note</b><span class="g"></span>${cvX(c.id)}</div><div class="cv-b"><textarea class="cv-note" placeholder="Write anything…" aria-label="Note">${esc(c.text || "")}</textarea></div>${rs}`;
}
function cvAgentBody(sid, key) {
  const tier = hstore.get("hq-cv-tier-" + sid, currentTier()), ro = hstore.get("hq-cv-ro-" + sid, "0") === "1";
  return `<div class="cv-b"><div class="cv-log" id="cvLog-${key}" data-sid="${esc(sid)}"><div class="cd-empty"><b>Loading…</b></div></div>
    <div class="cv-use" data-use></div>
    <form class="cv-ask" data-ask="${esc(sid)}"><textarea rows="2" placeholder="Ask Claude…" aria-label="Message"></textarea>
      <div class="cv-askrow"><select data-tier aria-label="Model">${["fast", "balanced", "deep"].map(k => `<option value="${k}" ${k === tier ? "selected" : ""}>${esc(cvModel(k))}</option>`).join("")}</select>
        <select data-eff aria-label="Thinking" title="Thinking level (Haiku has none)">${[["auto", "think: auto"], ["low", "think: low"], ["medium", "think: med"], ["high", "think: high"]].map(([k, l]) => `<option value="${k}" ${k === hstore.get("hq-cv-eff-" + sid, currentEffort()) ? "selected" : ""}>${l}</option>`).join("")}</select>
        <select data-mode aria-label="Permissions" title="Safe: only allow-listed commands. Auto: edits + any command except the blocked list. Bypass: Claude Code bypass mode. Push, deploy and secrets stay blocked in every mode.">${[["safe", "perms: safe"], ["auto", "perms: auto"], ["bypass", "perms: bypass"]].map(([k, l]) => `<option value="${k}" ${k === hstore.get("hq-cv-mode-" + sid, "safe") ? "selected" : ""}>${l}</option>`).join("")}</select>
        <button type="button" class="cv-lock ${ro ? "on" : ""}" data-lock aria-pressed="${ro}" title="${ro ? "Look only: it can't change files (click to allow edits)" : "Can edit files (click to make it look only)"}">${LOCK(ro)}<span>${ro ? "look only" : "can edit"}</span></button>
        <span class="cv-st" data-st></span><button type="button" class="cv-stop" data-stop hidden aria-label="Stop">■</button><button class="cv-send" aria-label="Send"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg></button></div></form></div>`;
}
function cvBindAsk(root) {
  root.querySelectorAll("form[data-ask]").forEach(f => {
    if (f.dataset.bound) return; f.dataset.bound = "1";
    const sid = f.dataset.ask, ta = f.querySelector("textarea");
    f.querySelector("[data-tier]").onchange = e => hstore.set("hq-cv-tier-" + sid, e.target.value);
    const ef = f.querySelector("[data-eff]"), md = f.querySelector("[data-mode]");
    const effSync = () => { const fast = f.querySelector("[data-tier]").value === "fast"; ef.disabled = fast; ef.title = fast ? "Haiku has no thinking levels. Pick Sonnet or Opus." : "Thinking level"; };
    effSync(); f.querySelector("[data-tier]").addEventListener("change", effSync);
    ef.onchange = () => hstore.set("hq-cv-eff-" + sid, ef.value);
    md.onchange = async () => { if (md.value === "bypass" && !(await uiConfirm("Bypass mode lets this agent run any command and edit any file in the project folders without asking.\nPush, deploy, delete-repo and secrets stay blocked.\n\nTurn it on for this chat?"))) { md.value = hstore.get("hq-cv-mode-" + sid, "safe"); return; } hstore.set("hq-cv-mode-" + sid, md.value); f.closest(".cv-card, .cv-fcol")?.classList.toggle("mode-bypass", md.value === "bypass"); };
    f.closest(".cv-card, .cv-fcol")?.classList.toggle("mode-bypass", md.value === "bypass");
    const lk = f.querySelector("[data-lock]");
    lk.onclick = () => { const on = hstore.get("hq-cv-ro-" + sid, "0") !== "1"; hstore.set("hq-cv-ro-" + sid, on ? "1" : "0"); lk.classList.toggle("on", on); lk.setAttribute("aria-pressed", String(on)); lk.innerHTML = `${LOCK(on)}<span>${on ? "look only" : "can edit"}</span>`; lk.title = on ? "Look only: it can't change files (click to allow edits)" : "Can edit files (click to make it look only)"; };
    f.querySelector("[data-stop]").onclick = () => api(`/code/${sid}/stop`, "POST").catch(x => toast(x.message));
    const go = async () => {
      const text = ta.value.trim(); if (!text) return;
      try { await api(`/code/${sid}`, "POST", { text, tier: f.querySelector("[data-tier]").value, effort: ef.value === "auto" || ef.disabled ? null : ef.value, readOnly: hstore.get("hq-cv-ro-" + sid, "0") === "1", mode: md.value }); ta.value = ""; Snd.blip(980, .06); CV.seen.delete(sid); setTimeout(cvPoll, 300); }
      catch (e) { toast(e.message, 5000); }
    };
    f.onsubmit = e => { e.preventDefault(); go(); };
    ta.onkeydown = e => { if (e.key === "Enter" && !e.shiftKey && !touchDev()) { e.preventDefault(); go(); } };
    ta.oninput = () => { ta.style.height = "auto"; ta.style.height = Math.min(160, ta.scrollHeight) + "px"; };
  });
}
function cvCardBind(el, c) {
  el.querySelector("[data-cx]")?.addEventListener("click", () => { cvSnap(); CV.data.cards = CV.data.cards.filter(x => x.id !== c.id); cvDraw(); cvSave({ cards: CV.data.cards }); });
  el.querySelector("[data-cf]")?.addEventListener("click", e => cvSetFocus([...cvFocus(), e.currentTarget.dataset.cf]));
  const note = el.querySelector(".cv-note");
  if (note) { let t = 0; note.oninput = () => { c.text = note.value; clearTimeout(t); t = setTimeout(() => cvSave({ cards: CV.data.cards }), 700); }; }
  cvBindAsk(el);
}

// project + checklist bodies (re-rendered when their data changes)
function cvProjectHTML(slug) {
  const p = S.projects.find(x => x.slug === slug); if (!p) return `<div class="cv-pad muted small">Project not found.</div>`;
  const ss = (Live.code?.sessions || []).filter(s => s.project === slug);
  const need = S.approvals.filter(a => a.status === "pending" && a.project === slug).length + (S.outbox || []).filter(x => x.project === slug && (x.status === "draft" || x.status === "failed")).length + ss.filter(s => s.error && !s.busy).length;
  const shipped = (Live.tasks || []).filter(t => t.project === slug && t.status === "done").length + S.runs.filter(r => r.project === slug && r.status === "done").length;
  const onCanvas = new Set(CV.data.cards.filter(c => c.type === "agent").map(c => c.ref));
  return `<div class="cv-pad"><div class="cv-path">${esc((p.paths || [])[0] || "no folder set")}</div>
    <div class="cv-stats"><div><b>${ss.filter(s => s.busy).length}<small>/${ss.length}</small></b><span>Working</span></div><div><b>${need}</b><span>Need you</span></div><div><b>${CV.list.filter(c => c.project === slug).length}</b><span>Canvases</span></div><div><b>${shipped}</b><span>Shipped</span></div></div>
    <div class="cv-btns"><button type="button" class="btn sm" data-pnew="${esc(slug)}">New chat</button><button type="button" class="btn sm" data-pcv="${esc(slug)}">New canvas</button></div>
    <div class="cv-lbl">Agents <span>${ss.length}</span></div>
    ${ss.map(s => `<button type="button" class="cv-agent" data-pa="${esc(s.id)}"><i style="background:${cvTint(s.id)}" class="${s.busy ? "run" : ""}"></i><span><b>${esc(s.name)}</b><small>Claude · ${s.busy ? "working" : s.error ? "needs a look" : "idle"}${onCanvas.has(s.id) ? "" : " · not on canvas"}</small></span></button>`).join("") || `<div class="muted small">No sessions yet. Press New chat.</div>`}
    ${p.nextStep ? `<div class="cv-lbl">Next step</div><div class="small">${esc(p.nextStep)}</div>` : ""}</div>`;
}
function cvGoalHTML(c) {
  const g = (S.goals || []).find(x => x.id === c.ref);
  if (!g) return `<div class="cv-pad"><div class="small muted" style="margin-bottom:8px">Pick a goal from the Planner to track here.</div><select data-gpick aria-label="Goal"><option value="">Choose…</option>${(S.goals || []).map(x => `<option value="${esc(x.id)}">${esc(x.title)}</option>`).join("")}</select></div>`;
  const done = g.steps.filter(s => s.done).length;
  return `<div class="cv-pad"><div class="cv-gt"><b>${esc(g.title)}</b><span class="pill">${done} / ${g.steps.length}</span></div>
    ${g.steps.map(s => `<label class="cv-step ${s.done ? "done" : ""}"><input type="checkbox" data-gs="${esc(s.id)}" ${s.done ? "checked" : ""}><span>${esc(s.title)}</span></label>`).join("")}
    <div class="cv-prog"><i style="width:${g.steps.length ? done / g.steps.length * 100 : 0}%"></i></div></div>`;
}
function cvRefresh() {
  for (const c of CV.data.cards) {
    const el = document.querySelector(`.cv-card[data-c="${c.id}"]`); if (!el) continue;
    if (c.type === "agent") { if (cvSess(c.ref) && !el.querySelector(".cv-log")) { el.innerHTML = cvCardHTML(c); cvCardBind(el, c); } cvAgentFill(c.ref, c.id); continue; }
    const box = el.querySelector(c.type === "project" ? `#cvP-${c.id}` : `#cvG-${c.id}`); if (!box) continue;
    if (box.contains(document.activeElement) && document.activeElement.tagName === "SELECT") continue;
    const html = c.type === "project" ? cvProjectHTML(c.ref) : cvGoalHTML(c);
    if (box.dataset.h === html) continue; box.dataset.h = html; box.innerHTML = html;
    box.querySelectorAll("[data-pnew]").forEach(b => b.onclick = () => cvNewChat(b.dataset.pnew, c));
    box.querySelectorAll("[data-pcv]").forEach(b => b.onclick = async () => { const n = await cvCreateDefault(b.dataset.pcv, "Canvas " + (CV.list.filter(x => x.project === b.dataset.pcv).length + 1)); if (n) location.hash = "canvas/" + n.id; });
    box.querySelectorAll("[data-pa]").forEach(b => b.onclick = () => cvShowAgent(b.dataset.pa, c));
    box.querySelector("[data-gpick]")?.addEventListener("change", e => { if (!e.target.value) return; cvSnap(); c.ref = e.target.value; cvSave({ cards: CV.data.cards }); box.dataset.h = ""; cvDraw(); });
    box.querySelectorAll("[data-gs]").forEach(i => i.onchange = () => api(`/goals/${c.ref}/steps/${i.dataset.gs}`, "PATCH", { done: i.checked }).then(refresh).then(() => { box.dataset.h = ""; cvRefresh(); }).catch(x => toast(x.message)));
  }
  for (const sid of cvFocus()) cvAgentFill(sid, "f-" + sid);
}
// agent log: load the session when it changes, show live steps while it works
async function cvAgentFill(sid, key) {
  const log = document.getElementById("cvLog-" + key); if (!log) return;
  const s = cvSess(sid); if (!s) return;
  const stale = CV.seen.get(sid) !== s.messages + (s.busy ? "b" : "");
  if ((stale || !CV.sess.has(sid)) && !CV.loading.has(sid)) {
    CV.loading.add(sid);
    try { const d = await api(`/code/${sid}`).catch(() => null); if (d) { CV.sess.set(sid, d); CV.seen.set(sid, s.messages + (s.busy ? "b" : "")); } }
    finally { CV.loading.delete(sid); }
    document.querySelectorAll(`.cv-log[data-sid="${CSS.escape(sid)}"]`).forEach(l => cvAgentPaint(sid, l));
    return;
  }
  cvAgentPaint(sid, log);
}
function cvAgentPaint(sid, log) {
  const d = CV.sess.get(sid), s = cvSess(sid); if (!d || !s) return;
  const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  if (log.dataset.n !== String(d.messages.length)) {
    log.innerHTML = (d.messages.length ? d.messages.slice(-24).map(codeMsgHTML).join("") : `<div class="cd-empty"><b>${esc(d.name)}</b>Ask for a feature, a fix or an explanation.</div>`) + `<div class="cv-live"></div>`;
    log.dataset.n = String(d.messages.length); log.scrollTop = log.scrollHeight;
  }
  const op = s.busy ? Live.ops.find(o => o.id === s.opId) : null, live = log.querySelector(".cv-live");
  if (live) live.innerHTML = s.busy ? `<div class="cd-msg hq"><div class="cd-steps">${(op?.steps || []).filter(x => x.kind === "tool" || x.kind === "text").slice(-3).map(x => stepLine(x, true)).join("")}<div class="s run"><b>${op ? "Working" : "Starting"}</b><span>${op ? `${op.calls} steps · ${fmtDur(Date.now() - op.startedAt)}` : ""}</span></div></div></div>` : "";
  if (stick && s.busy) log.scrollTop = log.scrollHeight;
  const use = log.parentElement.querySelector("[data-use]"); if (use) use.innerHTML = usageHTML(d.usage);
  const f = log.parentElement.querySelector("form[data-ask]");
  if (f) { f.querySelector("[data-st]").textContent = s.busy ? "working…" : d.level === "build" ? "" : "read-only"; f.querySelector("[data-stop]").hidden = !s.busy; f.querySelector(".cv-send").disabled = s.busy; }
}

// ---------------- adding things ----------------
function cvSpot(w, h) {
  const a = document.getElementById("cvArea"), v = CV.data.view;
  const cx = ((a?.clientWidth || 1200) / 2 - v.x) / v.z, cy = ((a?.clientHeight || 700) / 2 - v.y) / v.z;
  let x = Math.round((cx - w / 2) / 8) * 8, y = Math.round((cy - h / 2) / 8) * 8;
  for (let i = 0; i < 20 && CV.data.cards.some(c => Math.abs(c.x - x) < 40 && Math.abs(c.y - y) < 40); i++) { x += 32; y += 32; }
  return { x, y };
}
function cvAddCard(type, ref, at) {
  const [w, h] = CARD[type], p = at || cvSpot(w, h);
  cvSnap(); const c = { id: "c-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), type, x: p.x, y: p.y, w, h, ref: ref || null, ...(type === "note" ? { text: "" } : {}) };
  CV.data.cards.push(c); cvDraw(); cvSave({ cards: CV.data.cards });
  setTimeout(() => document.querySelector(`.cv-card[data-c="${c.id}"]`)?.classList.add("pop"), 10);
  return c;
}
function cvShowAgent(sid, near) {
  const c = CV.data.cards.find(x => x.type === "agent" && x.ref === sid);
  if (c) { const a = document.getElementById("cvArea"), v = CV.data.view; CV.data.view = { z: v.z, x: a.clientWidth / 2 - (c.x + c.w / 2) * v.z, y: a.clientHeight / 2 - (c.y + c.h / 2) * v.z }; cvApplyView(); cvSaveSoon(); const el = document.querySelector(`.cv-card[data-c="${c.id}"]`); el?.classList.remove("pop"); void el?.offsetWidth; el?.classList.add("pop"); return; }
  cvAddCard("agent", sid, near ? { x: near.x + near.w + 24, y: near.y } : null);
}
async function cvNewChat(slug, near, name) {
  try {
    const { id } = await api("/code", "POST", { project: slug, name });
    Live.code = await api("/code"); const c = cvAddCard("agent", id, near ? { x: near.x + near.w + 24 + CV.data.cards.filter(x => x.type === "agent").length * 16, y: near.y + 16 } : null);
    setTimeout(() => document.querySelector(`.cv-card[data-c="${c.id}"] textarea`)?.focus(), 400);
  } catch (e) { toast(e.message, 5000); }
}
function cvAddMenu(selected) {
  const projs = codeProjects(), on = new Set(CV.data.cards.filter(c => c.type === "agent").map(c => c.ref));
  const free = (Live.code?.sessions || []).filter(s => !on.has(s.id));
  const def = selected || (CV.data.project && projs.some(p => p.slug === CV.data.project) ? CV.data.project : projs[0]?.slug);
  modal(`<h2>Add to canvas</h2><div class="cv-addg">
    <div><div class="cv-lbl">New LUTHUR chat</div>${projs.length ? `<label class="f">Reason / chat name<input id="cvChatName" maxlength="40" placeholder="e.g. Fix login, build dashboard…"></label><div class="row"><select id="cvNp" aria-label="Chat project">${projs.map(p => `<option value="${esc(p.slug)}" ${p.slug === def ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select><button type="button" class="btn primary" id="cvNpGo">Start</button></div>` : `<div class="small muted">Create a project below and add its repository folder to start a coding chat.</div>`}</div>
    <details id="cvNewProject"><summary class="btn">+ New project</summary><form class="form" id="cvProjectForm"><label class="f">Project name<input name="name" required maxlength="80" placeholder="Name your project"></label><label class="f">What is it for?<input name="summary" maxlength="300" placeholder="A short description or goal"></label><label class="f">Repository folder (optional)<input name="folder" placeholder="C:\\Projects\\MyProject"></label><p class="small muted">A folder enables coding chats. Without one, we'll add a project overview to your canvas.</p><p class="small" data-project-error role="alert" hidden></p><button class="btn primary">Create project</button></form></details>
    ${free.length ? `<div><div class="cv-lbl">Existing sessions</div>${free.slice(0, 12).map(s => `<button type="button" class="cv-agent" data-addag="${esc(s.id)}"><i style="background:${cvTint(s.id)}"></i><span><b>${esc(s.name)}</b><small>${esc(s.projectName)}${s.busy ? " · working" : ""}</small></span></button>`).join("")}</div>` : ""}
    <div><div class="cv-lbl">Other cards</div><div class="row" style="flex-wrap:wrap"><button type="button" class="btn" id="cvAddP">Project overview</button><button type="button" class="btn" id="cvAddG">Checklist</button><button type="button" class="btn" id="cvAddN">Note</button><button type="button" class="btn" id="cvAddI">Bring in a Claude Code session</button></div></div></div>`);
  document.getElementById("cvNpGo")?.addEventListener("click", () => { const slug=document.getElementById('cvNp')?.value||def,name=document.getElementById('cvChatName')?.value.trim();closeModal();cvNewChat(slug,null,name); });
  const form=document.getElementById('cvProjectForm');let created=null;
  form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('button'),error=form.querySelector('[data-project-error]');button.disabled=true;error.hidden=true;
    try{const values=Object.fromEntries(new FormData(form)),name=values.name.trim(),folder=values.folder.trim();if(!name)throw Error('Enter a project name.');
      if(!created)created=await api('/projects','POST',{name,summary:values.summary.trim(),kind:'product',stage:'idea'});
      if(folder)await api('/project/'+created.slug,'PUT',{paths:[folder]});
      await refresh();closeModal();
      if(folder){cvAddMenu(created.slug);toast('Project created · name your chat and press Start.');}
      else{cvAddCard('project',created.slug);toast('Project created and added to canvas.');}
    }catch(e){error.textContent=e.message;error.hidden=false;button.disabled=false;}
  };
  document.querySelectorAll("[data-addag]").forEach(b => b.onclick = () => { closeModal(); cvAddCard("agent", b.dataset.addag); });
  document.getElementById("cvAddP").onclick = () => { closeModal(); cvAddCard("project", selected || CV.data.project || def || S.projects[0]?.slug); };
  document.getElementById("cvAddG").onclick = () => { closeModal(); const g = (S.goals || []).find(x => x.project === CV.data.project); cvAddCard("checklist", g?.id || null); };
  document.getElementById("cvAddN").onclick = () => { closeModal(); const c = cvAddCard("note"); setTimeout(() => document.querySelector(`.cv-card[data-c="${c.id}"] textarea`)?.focus(), 300); };
  document.getElementById("cvAddI").onclick = () => { closeModal(); codeImportModal(CV.data.project); };
}

// ---------------- focus columns (right side) ----------------
function cvFocusRender() {
  const box = document.getElementById("cvFocus"); if (!box) return;
  const ids = cvFocus().filter(id => cvSess(id));
  box.classList.toggle("on", (ids.length > 0 || cvCols()) && !cvStack());
  document.querySelector(".cv")?.classList.toggle("cols", cvCols());
  const key = ids.join(",") + (cvCols() ? "|c" : "");
  if (box.dataset.k === key) return; box.dataset.k = key;
  box.innerHTML = ids.map(sid => { const s = cvSess(sid); return `<section class="cv-fcol" style="--tint:${cvTint(sid)}"><div class="cv-h"><i></i><b>${esc(s.name)}</b><em>Claude</em><span class="g"></span><span class="chip">${FOLDER}${esc(cvFolder(sid))}</span><button type="button" class="x" data-funf="${esc(sid)}" title="Close" aria-label="Close">✕</button></div>${cvAgentBody(sid, "f-" + sid)}</section>`; }).join("");
  if (cvCols()) {
    const free = CV.data.cards.filter(c => c.type === "agent" && cvSess(c.ref) && !ids.includes(c.ref));
    if (ids.length < 3) box.insertAdjacentHTML("beforeend", `<div class="cv-fadd"><span>Add a column</span>${free.map(c => { const s = cvSess(c.ref); return `<button type="button" data-fadd="${esc(s.id)}" style="--tint:${cvTint(s.id)}"><i></i>${esc(s.name)}</button>`; }).join("")}<button type="button" data-fnew>+ New chat</button></div>`);
    box.querySelectorAll("[data-fadd]").forEach(b => b.onclick = () => cvSetFocus([...cvFocus(), b.dataset.fadd]));
    box.querySelector("[data-fnew]")?.addEventListener("click", async () => { const slug = CV.data.project || codeProjects()[0]?.slug; if (!slug) return toast("Give a project a folder first."); const before = new Set(CV.data.cards.map(c => c.id)); await cvNewChat(slug); const nc = CV.data.cards.find(c => !before.has(c.id)); if (nc) cvSetFocus([...cvFocus(), nc.ref]); });
  }
  box.querySelectorAll("[data-funf]").forEach(b => b.onclick = () => cvSetFocus(cvFocus().filter(x => x !== b.dataset.funf)));
  cvBindAsk(box);
  ids.forEach(sid => { const l = document.getElementById("cvLog-f-" + sid); if (l) { l.dataset.n = ""; cvAgentFill(sid, "f-" + sid); } });
  setTimeout(cvMini, 50);
}

// ---------------- polling ----------------
async function cvPoll() {
  clearTimeout(CV.poll); if (route.view !== "canvas" || !CV.data) return;
  const [code, live] = await Promise.all([api("/code").catch(() => null), api("/live").catch(() => null)]);
  if (route.view !== "canvas") return;
  if (code) Live.code = code; if (live) { Live.ops = live.ops || []; Live.now = live.now || Date.now(); }
  cvRefresh(); cvFocusRender();
  const busy = (Live.code?.sessions || []).some(s => s.busy);
  CV.poll = setTimeout(cvPoll, busy ? 1300 : 5000);
}
// Chat messages: steps fold into one line ("› 3 steps · Edited app/page.tsx"), the answer stays clean.
codeMsgHTML = function (m) {
  if (m.role === "you") return `<div class="cd-msg you">${esc(m.text)}</div>`;
  const steps = (m.steps || []).filter(s => s.kind === "tool"), last = steps.at(-1);
  const sum = last ? `${esc(last.verb || last.tool || "")} ${esc(last.target || "")}` : "";
  const fold = steps.length ? `<details class="cm-fold"><summary><span class="cm-n">${steps.length} step${steps.length > 1 ? "s" : ""}</span><span class="cm-l">${sum}</span>${m.added || m.removed ? `<span class="cm-d"><span class="a">+${m.added || 0}</span> <span class="d">−${m.removed || 0}</span></span>` : ""}</summary><div class="cd-steps">${steps.map(x => stepLine(x)).join("")}</div></details>` : "";
  let txt = String(m.text || "");
  if (/^\s*[\[{]?\s*"?(type|role|content|usage|id)"?\s*:/.test(txt) || /[A-Za-z0-9+/=]{200,}/.test(txt)) txt = txt.replace(/[A-Za-z0-9+/=]{200,}/g, "[…]").replace(/\{"[\s\S]*$/, "").trim() || "_The run ended without an answer. Ask again, or say “continue”._";
  return `<div class="cd-msg hq ${m.error ? "err" : ""}">${fold}<div class="md">${md(txt)}</div>${m.ms ? `<div class="cm-t">${fmtDur(m.ms)}</div>` : ""}${cmAgents(m.agents)}</div>`;
};
// Which model each agent of the turn used (manager, workers, review), from the model the CLI reported.
const cmModel = id => { const x = String(id || "").replace(/^claude-/, ""), c = x.match(/^(haiku|sonnet|opus|fable)(?:-(\d+)-(\d+))?/i); return c ? c[1][0].toUpperCase() + c[1].slice(1).toLowerCase() + (c[2] ? ` ${c[2]}.${c[3]}` : "") : x; };
const cmAgents = list => !(list || []).length ? "" : `<div class="cm-agents">${list.map(a => `<span class="${a.ok === false ? "bad" : ""}" title="${esc(a.engine)} · ${esc(a.model)}${a.effort ? " · effort " + esc(a.effort) : ""}"><b>${esc(a.role)}</b> ${esc(cmModel(a.model))}${a.effort ? ` <em>${esc(a.effort)}</em>` : ""}</span>`).join("")}</div>`;
const cvFolder = sid => { const s = cvSess(sid), p = S.projects.find(x => x.slug === s?.project); const f = (p?.paths || [])[0] || ""; return f.split(/[\\/]/).filter(Boolean).pop() || s?.projectName || ""; };
const cvModel = t => { const n = ({ fast: "Haiku", balanced: "Sonnet", deep: "Opus" })[t], m = String(tierModel(t) || ""); return m && m.toLowerCase() !== n.toLowerCase() ? `${n} · ${m}` : n; };
const LOCK = on => `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="${on ? "M8 11V8a4 4 0 0 1 8 0v3" : "M8 11V8a4 4 0 0 1 7.5-2"}"/></svg>`;
const cvCols = () => !cvStack() && hstore.get("hq-cv-cols", "0") === "1";

/** Context used of the window, plan limit (when Claude reports it) and the session's API-equivalent value. */
function usageHTML(u) {
  if (!u) return "";
  const k = n => n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "k" : String(n || 0);
  const win = u.win || 200000, pct = Math.min(100, Math.round((u.ctx || 0) / win * 100));
  const r = u.rate, rp = typeof r?.utilization === "number" ? Math.round(r.utilization * (r.utilization <= 1 ? 100 : 1)) : null;
  const reset = r?.resetsAt ? new Date(r.resetsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
  return `<span class="cu-ctx ${pct > 80 ? "hot" : pct > 60 ? "warm" : ""}" title="Context: ${(u.ctx || 0).toLocaleString()} of ${win.toLocaleString()} tokens. Near full, it summarises older messages."><i style="--w:${pct}%"></i>ctx ${k(u.ctx)}/${k(win)} · ${pct}%</span>`
    + (r ? `<span class="cu-rate ${r.status && r.status !== "allowed" ? "hot" : ""}" title="Your Claude plan limit${r.type ? " (" + esc(String(r.type).replace(/_/g, " ")) + ")" : ""}">${rp != null ? `limit ${rp}%` : r.status === "allowed" ? "limit ok" : esc(r.status || "")}${reset ? " · resets " + esc(reset) : ""}</span>` : "")
    + (u.cost ? `<span class="cu-cost" title="What this session would cost on the pay-per-use API. On your subscription it counts toward your plan limit instead.">≈$${u.cost.toFixed(2)} API value · ${u.turns} run${u.turns === 1 ? "" : "s"}</span>` : "");
}

const _renderCV = render;
render = function () {
  if (render.background && route.view === "canvas") return; // the canvas updates itself; a full redraw would reset the board
  _renderCV(); if (route.view !== "canvas") clearTimeout(CV.poll);
};

