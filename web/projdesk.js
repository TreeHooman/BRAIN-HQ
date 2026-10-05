// Project "Work" desk: opening a project lands on a work-ready screen, not a long page.
// Compact header with the next step editable in place, then three panels that fill the screen and scroll on their own:
// Focus (goals + reminders) · Do (tell LUTHUR what to do, recent work) · Notes (quick log, recent entries, dates).
// The full documents (Summary, Plan, Log, Missions & dates, Setup) stay one tab away.
"use strict";
projTab = "desk";
let pdLast = "";

function pdLogEntries(log, n) {
  return String(log || "").split(/^## /m).slice(1, n + 1).map(e => { const nl = e.indexOf("\n"); return { h: e.slice(0, nl < 0 ? e.length : nl).trim(), body: nl < 0 ? "" : e.slice(nl + 1).trim() }; });
}
function pdHeader(p, slug, tab) {
  const health = { good: "green", watch: "amber", risk: "red" }[p.health] || "";
  const tabs = [["desk", "Work"], ["summary", "Summary"], ["plan", "Plan"], ["log", "Log"], ["work", "Missions & dates"], ["setup", "Setup"]];
  return `<div class="pd-head">
    <a class="pd-back" href="#projects" title="All projects" aria-label="All projects">←</a>
    <div class="pd-title"><span class="dot ${esc(p.health)}"></span><h1>${esc(p.name)}</h1><span class="pill">${esc(p.stage)}</span><span class="pill ${health}">${esc(p.health)}</span></div>
    <div class="pd-acts">
      <a class="btn sm" href="#assistant" id="pdAsk">✦ Ask</a>
      ${(p.paths || []).length ? `<button type="button" class="btn sm" id="pdCode">⌨ Code</button>` : ""}
      ${(p.links || []).slice(0, 3).map(l => `<a class="btn sm ghost" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a>`).join("")}
      ${(p.repos || []).slice(0, 1).map(r => `<a class="btn sm ghost" href="https://github.com/${esc(r)}" target="_blank" rel="noopener">GitHub ↗</a>`).join("")}
    </div></div>
    <div class="tabs pd-tabs">${tabs.map(([k, t]) => `<button type="button" data-pdtab="${k}" class="${tab === k ? "on" : ""}">${t}</button>`).join("")}</div>`;
}

const _vProjectPd = vProject;
vProject = async function (el) {
  const slug = route.arg;
  if (pdLast !== slug) { pdLast = slug; projTab = "desk"; editing = null; }
  if (projTab !== "desk") {
    await _vProjectPd(el);
    // same compact header + tabs on the document tabs; the old big summary block goes away
    const p = projCache[slug]?.project; if (!p) return;
    el.querySelectorAll(":scope > .small:first-child, :scope > .between, .proj-sum, :scope > .tabs").forEach(n => n.remove());
    el.insertAdjacentHTML("afterbegin", pdHeader(p, slug, projTab));
    pdBindHead(el, p, slug);
    return;
  }
  let d = projCache[slug];
  if (!d || !render.background) { try { d = projCache[slug] = await api(`/project/${slug}`); } catch { el.innerHTML = `<h1>Not found</h1>`; return; } }
  const p = d.project, now = new Date();
  const goals = (S.goals || []).filter(g => g.project === slug);
  const rems = S.reminders.filter(r => r.project === slug && !r.done).sort((a, b) => toDate(a.due) - toDate(b.due));
  const runs = S.runs.filter(r => r.project === slug).slice(0, 10);
  const mss = S.milestones.filter(m => m.project === slug && !m.done && toDate(m.date) >= new Date(ymd(now))).sort((a, b) => toDate(a.date) - toDate(b.date)).slice(0, 6);
  const logs = pdLogEntries(d.log, 6);
  const goalHTML = goals.map(g => {
    const st = g.steps || [], done = st.filter(s => s.done).length, pct = st.length ? Math.round(done / st.length * 100) : 0;
    const open = st.filter(s => !s.done), shown = [...open.slice(0, 5), ...st.filter(s => s.done).slice(-2)];
    return `<div class="pd-goal"><div class="between"><b>${esc(g.title)}</b><span class="small faint">${done}/${st.length}${g.due ? " · due " + esc(fmtWhen(g.due)) : ""}</span></div>
      <div class="wk-prog"><i style="width:${pct}%"></i></div>
      <ul class="pd-steps">${shown.map(s => `<li class="${s.done ? "done" : ""}"><label><input type="checkbox" data-pdstep="${esc(g.id)}|${esc(s.id)}" ${s.done ? "checked" : ""}><span>${esc(s.title)}</span></label>${s.due && !s.done ? `<span class="when">${esc(fmtWhen(s.due))}</span>` : ""}</li>`).join("")}
      ${open.length > 5 ? `<li class="small faint">+${open.length - 5} more in <a href="#planner">Planner</a></li>` : ""}</ul></div>`;
  }).join("");
  el.innerHTML = `${pdHeader(p, slug, "desk")}
    <div class="pd-next"><span>Next</span><input id="pdNext" value="${esc(p.nextStep || "")}" placeholder="What's the very next thing to do?" aria-label="Next step"><button type="button" class="btn sm ghost" id="pdNextSave" hidden>Save</button></div>
    <div class="pd-grid">
      <section class="card pd-col"><h3>Focus</h3>
        ${goalHTML || `<div class="pd-empty">No goal yet. <a href="#planner">Plan one</a> and its steps show up here.</div>`}
        <div class="pd-sub">Reminders <span class="faint">${rems.length || ""}</span></div>
        ${reminderList(rems.slice(0, 8), "Nothing due.")}
        <form id="pdRem" class="pd-inline"><input name="title" placeholder="Remind me to…" required><input type="datetime-local" name="due" required><button class="btn sm">Add</button></form>
      </section>
      <section class="card pd-col"><h3>Do</h3>
        <form id="pdRun" class="pd-run"><textarea name="prompt" rows="3" required placeholder="Tell LUTHUR what to do on ${esc(p.name)}… (it works in the background and reports back)"></textarea>
          <div class="row"><select name="tier" title="Model">${opts(TIER_OPTS(), "balanced")}</select><select name="permission" title="What it may do">${opts([["read", "Look & report"], ["plan", "Update the brain"], ["build", "Edit code (dev)"]], "plan")}</select><button class="btn primary sm">Run</button></div></form>
        <div class="pd-sub">Recent work</div>
        <div class="pd-runs">${runs.length ? runs.map(runRow).join("") : `<div class="pd-empty">Nothing run yet.</div>`}</div>
      </section>
      <section class="card pd-col"><h3>Notes</h3>
        <form id="pdLog" class="pd-inline"><input name="text" placeholder="Log a note: what happened, what you decided…" required><button class="btn sm">Log</button></form>
        <div class="pd-logs">${logs.map(l => `<div class="pd-log"><div class="when">${esc(l.h)}</div><div class="md small">${md(l.body.slice(0, 600))}</div></div>`).join("") || `<div class="pd-empty">No notes yet.</div>`}
          ${logs.length ? `<button type="button" class="btn sm ghost" data-pdtab="log">Full log →</button>` : ""}</div>
        ${mss.length ? `<div class="pd-sub">Coming up</div><ul class="list">${mss.map(m => `<li><span class="when">${esc(fmtWhen(m.date))}</span><div class="grow">${esc(m.title)}</div>${m.kind === "deadline" ? '<span class="pill red">deadline</span>' : ""}</li>`).join("")}</ul>` : ""}
      </section>
    </div>`;
  pdBindHead(el, p, slug);
  const reload = async msg => { delete projCache[slug]; if (msg) toast(msg); await refresh(); render(); };
  const nx = $("#pdNext"), nb = $("#pdNextSave");
  const saveNext = async () => { if (nx.value.trim() === (p.nextStep || "")) return; await api(`/project/${slug}`, "PUT", { nextStep: nx.value.trim() }).catch(x => toast(x.message)); reload("Next step saved"); };
  nx.oninput = () => { nb.hidden = nx.value.trim() === (p.nextStep || ""); };
  nx.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); saveNext(); } if (e.key === "Escape") { nx.value = p.nextStep || ""; nb.hidden = true; nx.blur(); } };
  nb.onclick = saveNext;
  $$("[data-pdstep]", el).forEach(i => i.onchange = () => { const [g, s] = i.dataset.pdstep.split("|"); act(() => api(`/goals/${g}/steps/${s}`, "PATCH", { done: i.checked }), i.checked ? "Step done ✓" : "Step reopened").then(() => delete projCache[slug]); });
  $("#pdRem").onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target); await api("/reminders", "POST", { title: f.get("title"), due: String(f.get("due")).replace("T", " "), project: slug }).catch(x => toast(x.message)); reload("Reminder added"); };
  $("#pdLog").onsubmit = async e => { e.preventDefault(); const t = new FormData(e.target).get("text"); if (!t) return; await api(`/project/${slug}/log`, "POST", { text: t }); reload("Logged"); };
  $("#pdRun").onsubmit = async e => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); const prompt = String(f.prompt).trim(); if (!prompt) return;
    await act(() => api("/runs", "POST", { title: prompt.split("\n")[0].slice(0, 70), prompt, project: slug, tier: f.tier, permission: f.permission }), "On it: LUTHUR is working on this");
    if (typeof opsKick === "function") opsKick();
  };
  bindReminders(el); bindRuns(el);
};

function pdBindHead(el, p, slug) {
  $$("[data-pdtab]", el).forEach(b => b.onclick = () => { projTab = b.dataset.pdtab; editing = null; render(); });
  const ask = $("#pdAsk"); if (ask) ask.onclick = () => sessionStorage.setItem("chatProject", slug);
  const code = $("#pdCode"); if (code) code.onclick = () => { setActiveProject(slug, true); location.hash = "code"; setTimeout(() => typeof codeNewModal === "function" && codeNewModal(), 400); };
}
