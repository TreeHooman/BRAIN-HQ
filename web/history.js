// LUTHUR answers and local Claude/Codex chats. External Codex transcripts are read on demand, never copied into brain.
"use strict";
const HIS = { q: "", kind: "", project: "", open: new Set(), data: null, tab: "all", all: null, chats: null, chatOpen: null, chatBody: null };
const HIS_LINK = e => /^code-/.test(e.ref) ? "#code" : /^chat-/.test(e.ref) ? "#assistant" : e.kind === "Mission" ? "#missions" : e.project ? "#project/" + e.project : "";
// Chats tab: LUTHUR chats plus locally accessible Claude and Codex sessions.
async function vHistoryChats(el, head) {
  if (!HIS.chats || !render.background) HIS.chats = await api(`/chats?q=${encodeURIComponent(HIS.q)}`).catch(e => ({ error: e.message }));
  const rows = Array.isArray(HIS.chats) ? HIS.chats : [];
  const resume = id => `cd "${S.settings?.hqDir || "HQ"}"; claude --resume ${id}`;
  el.innerHTML = head + `<div class="his-list">${HIS.chats?.error ? `<div class="card danger">${esc(HIS.chats.error)}</div>` : rows.map(c => {
    const on = HIS.chatOpen === c.id, body = on ? HIS.chatBody : null;
    return `<div class="card his-row ${on ? "open" : ""}"><button type="button" class="his-head" data-copen="${esc(c.id)}"><span class="pill his-k ${c.source === "claude" || c.source === "codex" ? "k-code" : ""}">${c.source === "claude" ? "Claude" : c.source === "codex" ? "Codex" : "LUTHUR"}</span><b>${esc(c.title)}</b>
        <span class="his-meta">${c.current ? "open now · " : ""}${c.count == null ? "" : c.count + " msgs · "}${esc(ago(c.at))}</span></button>
      ${on ? `<div class="his-body">${!body ? `<div class="scr-msg"><span class="scr-spin"></span>Loading…</div>` : body.messages.slice(-40).map(m => `<div class="his-msg ${m.role === "you" ? "you" : ""}"><span>${m.role === "you" ? "You" : "LUTHUR"}</span><div class="md">${md(m.text.slice(0, 6000))}</div></div>`).join("")}
        <div class="row end">${c.resumable ? `${c.source !== "codex" ? `<button type="button" class="btn sm ghost" data-ccopy="${esc(c.id)}" title="${esc(resume(c.id))}">Copy “claude --resume”</button>` : ""}<button type="button" class="btn sm primary" data-ccont="${esc(c.id)}">Continue in LUTHUR</button>` : `<span class="small muted">Read-only outside chat</span>`}</div></div>` : ""}</div>`;
  }).join("") || `<div class="wk-zero"><b>No chats yet</b><span class="small muted">LUTHUR and local Codex/Claude chats show up here.</span></div>`}</div>`;
  $$("[data-copen]", el).forEach(b => b.onclick = async () => { const id = b.dataset.copen; if (HIS.chatOpen === id) { HIS.chatOpen = null; return vHistory(el); } HIS.chatOpen = id; HIS.chatBody = null; render.background = true; await vHistory(el); render.background = false; HIS.chatBody = await api(`/chats/${encodeURIComponent(id)}`).catch(e => ({ messages: [{ role: "hq", text: "⚠ " + e.message }] })); render.background = true; await vHistory(el); render.background = false; });
  $$("[data-ccopy]", el).forEach(b => b.onclick = () => navigator.clipboard?.writeText(resume(b.dataset.ccopy)).then(() => toast("Copied. Paste it in PowerShell to open this chat in Claude Code"), () => toast("Couldn't copy")));
  $$("[data-ccont]", el).forEach(b => b.onclick = async () => { await act(() => api(`/chats/${encodeURIComponent(b.dataset.ccont)}/continue`, "POST"), "Continuing in LUTHUR"); chatState = null; if(el.closest("#nvScreen")){Cmd.waiting=false;cmdShowReply(await api("/chat"),false);}else location.hash = "assistant"; });
}
async function vHistory(el) {
  const tabs = `<div class="tabs his-tabs"><button type="button" data-htab="all" class="${HIS.tab === "all" ? "on" : ""}">Search all</button><button type="button" data-htab="answers" class="${HIS.tab === "answers" ? "on" : ""}">Answers</button><button type="button" data-htab="chats" class="${HIS.tab === "chats" ? "on" : ""}">Chats</button><button type="button" data-htab="memory" class="${HIS.tab === "memory" ? "on" : ""}">Memory & cleanup</button></div>`;
  // Inside the War Room screen panel, render() would redraw the main page instead, so redraw this element.
  const redraw = () => el.id === "view" ? render() : vHistory(el);
  const bindTabs = () => $$("[data-htab]", el).forEach(b => b.onclick = () => { HIS.tab = b.dataset.htab; redraw(); });
  if (HIS.tab === "all") {
    // Memory search: one ranked search over projects, decisions, goals, dates, briefs, past answers and chat memories.
    if (HIS.q && (!HIS.all || !render.background)) HIS.all = await api(`/memory/search?q=${encodeURIComponent(HIS.q)}&project=${encodeURIComponent(HIS.project)}`).catch(e => ({ error: e.message }));
    const rows = HIS.q && Array.isArray(HIS.all) ? HIS.all : [];
    const link = h => h.ref.startsWith("goal:") ? "#planner" : /^(date|reminder):/.test(h.ref) ? "#calendar" : h.project ? "#project/" + h.project : "";
    el.innerHTML = `<div class="between"><div><h1>History</h1><p class="sub">Search everything LUTHUR remembers: project notes and logs, decisions, goals, dates, briefs, past answers and chat memories. Best matches first.</p></div></div>${tabs}
      <div class="toolbar his-bar"><input id="hisQ" type="search" placeholder="What are you looking for? e.g. discord interest rate decision" value="${esc(HIS.q)}" aria-label="Search memory">
        <select id="hisP">${projOptions(HIS.project, "All projects")}</select></div>
      <div class="his-list">${HIS.all?.error ? `<div class="card danger">${esc(HIS.all.error)}</div>` : rows.map(h => `<div class="card his-row"><div class="his-head"><span class="pill his-k">${esc(h.source)}</span><b>${esc(h.title)}</b><span class="his-meta">${h.project ? esc(projName(h.project)) + " · " : ""}${h.at ? esc(h.at.slice(0, 10)) : ""}</span></div>
        <div class="his-snip">${esc(h.snippet)}</div>${link(h) ? `<div class="row end"><a class="btn sm ghost" href="${link(h)}">Open</a></div>` : ""}</div>`).join("") || `<div class="wk-zero"><b>${HIS.q ? "Nothing matches" : "Type to search"}</b><span class="small muted">${HIS.q ? "Try fewer or different words." : "Any words work; the closest matches come first."}</span></div>`}</div>`;
    bindTabs();
    const q = $("#hisQ"); let t; q.oninput = () => { clearTimeout(t); t = setTimeout(async () => { HIS.q = q.value.trim(); HIS.data = null; const pos = q.selectionStart; await redraw(); const n = $("#hisQ"); n?.focus(); n?.setSelectionRange(pos, pos); }, 300); };
    $("#hisP").onchange = e => { HIS.project = e.target.value; HIS.data = null; redraw(); };
    return;
  }
  if(HIS.tab === "memory") {
    const s=await api("/chat/retention"), memories=await api("/chat/memories");
    el.innerHTML=`<h1>Chat memory</h1>${tabs}<p class="sub">Old LUTHUR archives become Markdown notes containing decisions, findings and unfinished work. The original is removed only after the note is saved and verified. Active chats and outside Claude/Codex sessions are protected.</p><form id="chatRetention" class="form card"><label class="f">Keep full chats for this many days<input name="days" type="number" min="7" max="365" value="${s.days}" required></label><label><input name="enabled" type="checkbox" ${s.enabled?"checked":""}> Automatically clean old archives while idle</label><div class="row"><button class="btn sm">Save settings</button><button type="button" id="chatClean" class="btn sm ghost" ${s.busy?"disabled":""}>Save memory & clean old chats</button></div><p class="small muted">${s.memories} Markdown memories · up to two chats per daily cleanup · no chat is removed when extraction fails.</p>${s.last?`<p class="small">Last cleanup: ${esc(ago(s.last.at))} · ${s.last.removed} removed · ${s.last.kept} kept for review</p>`:""}</form>${memories.map(m=>`<details class="card"><summary>${esc(m.file)}</summary><div class="md">${md(m.text)}</div></details>`).join("")||"<p>No distilled chat memories yet.</p>"}`;
    bindTabs();$("#chatRetention").onsubmit=async e=>{e.preventDefault();const f=e.currentTarget;await act(()=>api("/chat/retention","PUT",{days:Number(f.days.value),enabled:f.enabled.checked}),"Chat cleanup settings saved");};
    $("#chatClean").onclick=async e=>{e.currentTarget.disabled=true;try{const r=await api("/chat/cleanup","POST",{});toast(`${r.removed} chats distilled and removed · ${r.kept} kept`);HIS.chats=null;await vHistory(el);}catch(err){toast(err.message);e.target.disabled=false;}};
    return;
  }
  if (HIS.tab === "chats") {
    const head = `<div class="between"><div><h1>History</h1><p class="sub">Search LUTHUR chats and local Claude/Codex chats. Outside Codex chats are read-only here.</p></div></div>${tabs}
      <div class="toolbar his-bar"><input id="hisQ" type="search" placeholder="Filter chats…" value="${esc(HIS.q)}" aria-label="Filter chats"></div>`;
    await vHistoryChats(el, head); bindTabs();
    const q = $("#hisQ"); let t; q.oninput = () => { clearTimeout(t); t = setTimeout(async () => { HIS.q = q.value.trim(); HIS.chats = null; const pos = q.selectionStart; render.background = true; await vHistory(el); render.background = false; const n = $("#hisQ"); n?.focus(); n?.setSelectionRange(pos, pos); }, 350); };
    return;
  }
  const load = async () => { try { HIS.data = await api(`/history?q=${encodeURIComponent(HIS.q)}&kind=${encodeURIComponent(HIS.kind)}&project=${encodeURIComponent(HIS.project)}&limit=80`); } catch (e) { HIS.data = { items: [], kinds: {}, error: e.message }; } };
  if (!HIS.data || !render.background) await load();
  const d = HIS.data, kinds = Object.entries(d.kinds || {}).sort((a, b) => b[1] - a[1]);
  el.innerHTML = `<div class="between"><div><h1>History</h1><p class="sub">Every answer LUTHUR got from Claude: chats, Code, ✦ explanations, briefings, missions, email drafts. Also saved in <code>HQ\\brain\\history\\</code>, so Claude can find it too.</p></div></div>${tabs}
    <div class="toolbar his-bar"><input id="hisQ" type="search" placeholder="Search everything… (all words must match)" value="${esc(HIS.q)}" aria-label="Search history">
      <select id="hisP">${projOptions(HIS.project, "All projects")}</select></div>
    <div class="chips his-kinds"><button type="button" class="chip ${HIS.kind ? "" : "on"}" data-hk="">All</button>${kinds.map(([k, n]) => `<button type="button" class="chip ${HIS.kind === k ? "on" : ""}" data-hk="${esc(k)}">${esc(k)} <span class="faint">${n}</span></button>`).join("")}</div>
    <div class="his-list">${d.error ? `<div class="card danger">${esc(d.error)}</div>` : (d.items || []).map(e => {
      const on = HIS.open.has(e.id), link = HIS_LINK(e);
      return `<div class="card his-row ${on ? "open" : ""} ${e.ok ? "" : "bad"}" data-hid="${esc(e.id)}">
        <button type="button" class="his-head" data-htog="${esc(e.id)}"><span class="pill his-k k-${esc(e.kind.toLowerCase())}">${esc(e.kind)}</span><b>${esc(e.title)}</b>
          <span class="his-meta">${e.project ? esc(projName(e.project)) + " · " : ""}${esc(e.model)}${e.model ? " · " : ""}${esc(ago(e.at))}</span></button>
        ${on ? `<div class="his-body">${e.ask && e.ask !== e.title ? `<div class="his-ask"><span>You asked</span>${esc(e.ask)}</div>` : ""}<div class="md">${md(e.answer)}</div>
          <div class="row end"><button type="button" class="btn sm ghost" data-hcopy="${esc(e.id)}">Copy</button>${link ? `<a class="btn sm ghost" href="${link}">Open where it happened</a>` : ""}</div></div>`
        : `<div class="his-snip">${esc(e.answer.replace(/[*#`>_]+/g, "").replace(/\s+/g, " ").slice(0, 180))}</div>`}</div>`;
    }).join("") || `<div class="wk-zero"><b>${HIS.q || HIS.kind || HIS.project ? "Nothing matches" : "Nothing saved yet"}</b><span class="small muted">Answers appear here as you use LUTHUR.</span></div>`}</div>`;
  bindTabs();
  let t; const q = $("#hisQ");
  q.oninput = () => { clearTimeout(t); t = setTimeout(async () => { HIS.q = q.value.trim(); await load(); const pos = q.selectionStart; await redraw(); const n = $("#hisQ"); n?.focus(); n?.setSelectionRange(pos, pos); }, 250); };
  $("#hisP").onchange = async e => { HIS.project = e.target.value; await load(); redraw(); };
  $$("[data-hk]", el).forEach(b => b.onclick = async () => { HIS.kind = b.dataset.hk; await load(); redraw(); });
  $$("[data-htog]", el).forEach(b => b.onclick = () => { const id = b.dataset.htog; HIS.open.has(id) ? HIS.open.delete(id) : HIS.open.add(id); render.background = true; redraw(); render.background = false; });
  $$("[data-hcopy]", el).forEach(b => b.onclick = () => { const e = d.items.find(x => x.id === b.dataset.hcopy); navigator.clipboard?.writeText(e.answer).then(() => toast("Copied"), () => toast("Couldn't copy")); });
}
