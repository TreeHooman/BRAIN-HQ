"use strict";
// Loads last. Layout polish that wraps earlier views:
//  - phone War Room: compact orb + one tabbed panel area instead of a 3,600px scroll
//  - model consoles fold to one small row (expand for the full cards)
//  - Code: a "Talk to LUTHUR" box on the page; clicking the orchestrator node focuses it
//  - status tiles that summarise something open the detail they summarise

// ---------- model console: one compact row by default ----------
function polishModels(root = document) {
  const open = hstore.get("hq-models-open", "0") === "1";
  // The War Room deck is prepended on each render; a refresh that keeps the stage can leave two.
  root.querySelectorAll?.(".nv-stage").forEach(st => [...st.querySelectorAll(":scope > .war-models")].slice(1).forEach(x => x.remove()));
  root.querySelectorAll(".model-console").forEach(mc => {
    mc.classList.toggle("mc-mini", !open);
    let t = mc.querySelector(".mc-toggle");
    if (!t) {
      t = document.createElement("button"); t.type = "button"; t.className = "mc-toggle";
      t.onclick = () => { hstore.set("hq-models-open", hstore.get("hq-models-open", "0") === "1" ? "0" : "1"); polishModels(); };
      (mc.querySelector(".model-engine") || mc).append(t);
    }
    t.textContent = open ? "Less ▴" : "Details ▾";
    t.setAttribute("aria-expanded", String(open));
  });
}

// ---------- phone War Room: tabs over the panels ----------
const PTAB = { key: "hq-m-tab" };
function polishPanels(el) {
  const cmd = el.querySelector(".nv-cmd");
  if (!cmd) return [];
  return [...cmd.querySelectorAll("#cmdLeft > .nv-panel, #nvScreen, #cmdRight > .nv-panel")].filter(p => !p.classList.contains("nv-quick"));
}
function polishLabel(p) {
  if (p.id === "nvScreen") return { name: "Screen", n: "" };
  const t = p.querySelector(".ttl");
  const name = (t?.firstChild?.textContent || t?.textContent || "Panel").trim();
  const n = (t?.querySelector("b")?.textContent || "").trim();
  return { name, n: /^\d+$/.test(n) ? n : "" };
}
function polishCommandTabs(el) {
  const cmd = el.querySelector(".nv-cmd");
  if (!cmd) return;
  if (!phone()) { cmd.classList.remove("m-tabs"); el.querySelector(".m-tabbar")?.remove(); return; }
  // Phone keeps only what needs attention near LUTHUR; Screen, Inbox etc. live in their own pages (More menu).
  const all = polishPanels(el), keep = ["Needs you", "Today", "Upcoming"];
  all.forEach(p => p.classList.toggle("m-off", !keep.includes(polishLabel(p).name)));
  const panels = all.filter(p => !p.classList.contains("m-off"));
  if (!panels.length) return;
  const labels = panels.map(polishLabel);
  polishModelChip(el);
  let want = hstore.get(PTAB.key, "");
  if (!labels.some(l => l.name === want)) want = (labels.find(l => l.name === "Needs you" && l.n) || labels.find(l => l.name === "Today") || labels[0]).name;
  cmd.classList.add("m-tabs");
  panels.forEach((p, i) => p.classList.toggle("m-on", labels[i].name === want));
  let bar = el.querySelector(".m-tabbar");
  if (!bar) {
    bar = document.createElement("div"); bar.className = "m-tabbar"; bar.setAttribute("role", "tablist"); bar.setAttribute("aria-label", "War Room panels");
    (el.querySelector("#cmdReply") || el.querySelector("#cmdAsk") || cmd.querySelector(".nv-mid") || cmd).after(bar);
  }
  const html = labels.map(l => `<button type="button" role="tab" data-mtab="${esc(l.name)}" aria-selected="${l.name === want}">${esc(l.name)}${l.n ? `<b>${esc(l.n)}</b>` : ""}</button>`).join("");
  if (bar.dataset.html !== html) {
    bar.dataset.html = html; bar.innerHTML = html;
    bar.querySelectorAll("[data-mtab]").forEach(b => b.onclick = () => { hstore.set(PTAB.key, b.dataset.mtab); polishCommandTabs(el); });
  }
}
// Phone: model controls hide behind one small chip next to the message box.
function polishModelChip(el) {
  const ask = el.querySelector("#cmdAsk"); if (!ask) return;
  let chip = el.querySelector(".m-model-chip");
  if (!chip) {
    chip = document.createElement("button"); chip.type = "button"; chip.className = "m-model-chip";
    chip.onclick = () => { const on = !el.classList.contains("m-models-open"); el.classList.toggle("m-models-open", on); chip.setAttribute("aria-expanded", String(on)); };
    ask.before(chip);
  }
  const eng = typeof modelEngine === "function" ? modelEngine() : "claude";
  const label = `${eng === "codex" ? "◈ ChatGPT" : "✦ Claude"} · ${typeof modelPicked === "function" ? modelPicked(eng).replace(/^gpt-[\d.]+-/, "").replace(/^auto$/, "Auto") : "Auto"} · ${typeof modelEffort === "function" ? modelEffort(eng) : ""} ▾`;
  if (chip.textContent !== label) chip.textContent = label;
  chip.setAttribute("aria-expanded", String(el.classList.contains("m-models-open")));
}
let polishObs = null;
function polishWatch(el) {
  polishObs?.disconnect();
  let queued = false;
  polishObs = new MutationObserver(() => {
    if (queued) return; queued = true;
    requestAnimationFrame(() => { queued = false; if (route.view !== "command") return; polishObs.disconnect(); polishCommandTabs(el); polishModels(el); polishObs.observe(el, { childList: true, subtree: true }); });
  });
  polishObs.observe(el, { childList: true, subtree: true });
}
addEventListener("resize", () => { if (route.view === "command") polishCommandTabs(document.getElementById("view")); });

// ---------- War Room vitals open what they report ----------
function polishVitals(el) {
  el.querySelectorAll("#nvVitals .nv-vital").forEach(v => {
    const t = v.textContent.toLowerCase();
    const go = t.startsWith("runs") ? "#missions" : t.startsWith("claude") || t.startsWith("codex") ? "#assistant" : "";
    if (!go || v.dataset.go) return;
    v.dataset.go = go; v.tabIndex = 0; v.setAttribute("role", "link"); v.classList.add("p-click");
    v.onclick = () => { location.hash = go; };
    v.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); location.hash = go; } };
  });
}

// ---------- tiles that summarise something open it ----------
function polishGoto(card, find, title) {
  card.classList.add("p-click"); card.tabIndex = 0; card.setAttribute("role", "button"); card.title = title;
  const go = () => {
    const h = [...document.querySelectorAll("#view h2")].find(x => x.textContent.trim().toLowerCase().startsWith(find));
    if (!h) return;
    h.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    const next = h.nextElementSibling; if (next) { next.classList.remove("p-flash"); void next.offsetWidth; next.classList.add("p-flash"); }
  };
  card.onclick = e => { if (e.target.closest("button,a,select,input")) return; go(); };
  card.onkeydown = e => { if ((e.key === "Enter" || e.key === " ") && e.target === card) { e.preventDefault(); go(); } };
}
function polishMissions(el) {
  const tiles = el.querySelectorAll(".grid > .card");
  const map = [["runs", "Open today's runs"], ["runs", "Open the run list (working and queued)"], ["autonomy", "Open autonomy & budget settings"], ["claude connection", "Open the Claude connection details"]];
  tiles.forEach((c, i) => { if (map[i] && c.querySelector(".stat")) polishGoto(c, map[i][0], map[i][1]); });
}

// ---------- Code: talk to LUTHUR right on the page ----------
function polishCode(el) {
  const head = el.querySelector(".tui-head");
  if (!head || el.querySelector(".cm-ask")) return;
  const projects = codeProjects();
  const form = document.createElement("form"); form.className = "cm-ask card"; form.autocomplete = "off";
  // The last project picked here sticks (also across page redraws); otherwise the focused project, else the first.
  const last = hstore.get("hq-code-ask-project", "");
  const pick = projects.some(p => p.slug === last) ? last : projects.some(p => p.slug === activeProject()) ? activeProject() : projects[0]?.slug;
  form.innerHTML = projects.length
    ? `<label class="cm-ask-l" for="cmAskText"><b>Talk to LUTHUR</b><span>Choose the model, permissions and limits before running. Your request opens as an editable draft.</span></label>
       <div class="cm-ask-row"><select name="project" aria-label="Project">${projects.map(p => `<option value="${esc(p.slug)}" ${p.slug === pick ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>
       <textarea id="cmAskText" name="text" rows="1" placeholder="What should LUTHUR build, fix or check?" required></textarea><button class="btn primary">Set up workroom</button></div>`
    : `<label class="cm-ask-l"><b>Talk to LUTHUR</b><span>Add a repository folder to a project (Project → Setup) and LUTHUR can manage coding work there.</span></label>`;
  head.after(form);
  const ta = form.querySelector("textarea");
  form.elements.project?.addEventListener("change", e => hstore.set("hq-code-ask-project", e.target.value));
  if (ta) {
    ta.addEventListener("input", () => { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 180) + "px"; });
    ta.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
  }
  form.onsubmit = async e => {
    e.preventDefault();
    const text = ta.value.trim(); if (!text) return;
    const btn = form.querySelector("button"); btn.disabled = true;
    try {
      const slug = form.elements.project.value, p = projects.find(x => x.slug === slug);
      const { id } = await api("/code/workroom/start", "POST", { project: slug, folder: (p?.paths || [])[0] });
      await api('/drafts/code:'+id,'PUT',{text,images:[]});
      if(typeof Att!=='undefined'){Att.state.set('code:'+id,{text,images:[]});Att.loaded.add('code:'+id);}hstore.set('hq-code-draft-'+id,text);
      ta.value = ""; ta.style.height = "";
      Live.code = await api("/code").catch(() => Live.code); codeGrid(); codeOpen(id); liveKick();await codeSettingsModal(id);
    } catch (x) { toast(x.message); } finally { btn.disabled = false; }
  };
  const hub = el.querySelector(".lv-hub");
  if (hub && !hub.dataset.ask) {
    hub.dataset.ask = "1"; hub.classList.add("p-click"); hub.tabIndex = 0; hub.setAttribute("role", "button"); hub.title = "Talk to LUTHUR";
    const focus = () => { form.scrollIntoView({ block: "nearest" }); (ta || form).focus?.(); form.classList.remove("p-flash"); void form.offsetWidth; form.classList.add("p-flash"); };
    hub.onclick = focus; hub.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); focus(); } };
  }
}

// ---------- hook every render ----------
const polishPrevAfter = typeof hudAfterRender === "function" ? hudAfterRender : null;
hudAfterRender = function (el, bg) {
  if (polishPrevAfter) polishPrevAfter(el, bg);
  try {
    polishModels(el);
    if (route.view === "command") { polishCommandTabs(el); polishVitals(el); polishWatch(el); } else { polishObs?.disconnect(); }
    if (route.view === "missions") polishMissions(el);
    if (route.view === "code") polishCode(el);
  } catch (x) { console.warn("polish", x); }
};

// Model consoles also appear outside page renders (Code chat drawer, side-by-side columns, work windows).
new MutationObserver(muts => {
  for (const m of muts) for (const n of m.addedNodes) {
    if (n.nodeType === 1 && (n.matches?.(".model-console:not([data-mc])") || n.querySelector?.(".model-console:not([data-mc])"))) {
      document.querySelectorAll(".model-console:not([data-mc])").forEach(mc => mc.dataset.mc = "1");
      polishModels(); return;
    }
  }
}).observe(document.body, { childList: true, subtree: true });
