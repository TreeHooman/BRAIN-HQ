// History: every answer LUTHUR got from Claude, searchable. Also saved as Markdown in brain\history\ (any Claude session
// in the HQ folder can read it) and searchable by LUTHUR itself (hq-brain history_search).
"use strict";
const HIS = { q: "", kind: "", project: "", open: new Set(), data: null, tab: "answers", chats: null, chatOpen: null, chatBody: null };
const HIS_LINK = e => /^code-/.test(e.ref) ? "#code" : /^chat-/.test(e.ref) ? "#assistant" : e.kind === "Mission" ? "#missions" : e.project ? "#project/" + e.project : "";
// Chats tab: LUTHUR chats + sessions started in the Claude app / terminal on the HQ folder (one shared store: Claude Code's
// own session files). Open to read, continue it in LUTHUR, or copy the command to resume it in Claude Code.
async function vHistoryChats(el, head) {
  if (!HIS.chats || !render.background) HIS.chats = await api("/chats").catch(e => ({ error: e.message }));
  const rows = Array.isArray(HIS.chats) ? HIS.chats.filter(c => !HIS.q || c.title.toLowerCase().includes(HIS.q.toLowerCase())) : [];
  const resume = id => `cd "${S.settings?.hqDir || "HQ"}"; claude --resume ${id}`;
  el.innerHTML = head + `<div class="his-list">${HIS.chats?.error ? `<div class="card danger">${esc(HIS.chats.error)}</div>` : rows.map(c => {
    const on = HIS.chatOpen === c.id, body = on ? HIS.chatBody : null;
    return `<div class="card his-row ${on ? "open" : ""}"><button type="button" class="his-head" data-copen="${esc(c.id)}"><span class="pill his-k ${c.source === "claude" ? "k-code" : ""}">${c.source === "claude" ? "Claude" : "LUTHUR"}</span><b>${esc(c.title)}</b>
        <span class="his-meta">${c.current ? "open now · " : ""}${c.count} msgs · ${esc(ago(c.at))}</span></button>
      ${on ? `<div class="his-body">${!body ? `<div class="scr-msg"><span class="scr-spin"></span>Loading…</div>` : body.messages.slice(-40).map(m => `<div class="his-msg ${m.role === "you" ? "you" : ""}"><span>${m.role === "you" ? "You" : "LUTHUR"}</span><div class="md">${md(m.text.slice(0, 6000))}</div></div>`).join("")}
        <div class="row end">${c.resumable ? `<button type="button" class="btn sm ghost" data-ccopy="${esc(c.id)}" title="${esc(resume(c.id))}">Copy “claude --resume”</button><button type="button" class="btn sm primary" data-ccont="${esc(c.id)}">Continue in LUTHUR</button>` : ""}</div></div>` : ""}</div>`;
  }).join("") || `<div class="wk-zero"><b>No chats yet</b><span class="small muted">LUTHUR chats and Claude Code sessions in the HQ folder show up here.</span></div>`}</div>`;
  $$("[data-copen]", el).forEach(b => b.onclick = async () => { const id = b.dataset.copen; if (HIS.chatOpen === id) { HIS.chatOpen = null; return vHistory(el); } HIS.chatOpen = id; HIS.chatBody = null; render.background = true; await vHistory(el); render.background = false; HIS.chatBody = await api(`/chats/${encodeURIComponent(id)}`).catch(e => ({ messages: [{ role: "hq", text: "⚠ " + e.message }] })); render.background = true; await vHistory(el); render.background = false; });
  $$("[data-ccopy]", el).forEach(b => b.onclick = () => navigator.clipboard?.writeText(resume(b.dataset.ccopy)).then(() => toast("Copied. Paste it in PowerShell to open this chat in Claude Code"), () => toast("Couldn't copy")));
  $$("[data-ccont]", el).forEach(b => b.onclick = async () => { await act(() => api(`/chats/${encodeURIComponent(b.dataset.ccont)}/continue`, "POST"), "Continuing in LUTHUR"); chatState = null; location.hash = "assistant"; });
}
async function vHistory(el) {
  const tabs = `<div class="tabs his-tabs"><button type="button" data-htab="answers" class="${HIS.tab === "answers" ? "on" : ""}">Answers</button><button type="button" data-htab="chats" class="${HIS.tab === "chats" ? "on" : ""}">Chats (LUTHUR + Claude)</button></div>`;
  const bindTabs = () => $$("[data-htab]", el).forEach(b => b.onclick = () => { HIS.tab = b.dataset.htab; render(); });
  if (HIS.tab === "chats") {
    const head = `<div class="between"><div><h1>History</h1><p class="sub">Chats are shared with Claude Code: chats you have here also show in the Claude app's Code tab (HQ folder), and sessions you start there show here.</p></div></div>${tabs}
      <div class="toolbar his-bar"><input id="hisQ" type="search" placeholder="Filter chats…" value="${esc(HIS.q)}" aria-label="Filter chats"></div>`;
    await vHistoryChats(el, head); bindTabs();
    const q = $("#hisQ"); let t; q.oninput = () => { clearTimeout(t); t = setTimeout(async () => { HIS.q = q.value.trim(); const pos = q.selectionStart; render.background = true; await vHistory(el); render.background = false; const n = $("#hisQ"); n?.focus(); n?.setSelectionRange(pos, pos); }, 200); };
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
  q.oninput = () => { clearTimeout(t); t = setTimeout(async () => { HIS.q = q.value.trim(); await load(); const pos = q.selectionStart; render(); const n = $("#hisQ"); n?.focus(); n?.setSelectionRange(pos, pos); }, 250); };
  $("#hisP").onchange = async e => { HIS.project = e.target.value; await load(); render(); };
  $$("[data-hk]", el).forEach(b => b.onclick = async () => { HIS.kind = b.dataset.hk; await load(); render(); });
  $$("[data-htog]", el).forEach(b => b.onclick = () => { const id = b.dataset.htog; HIS.open.has(id) ? HIS.open.delete(id) : HIS.open.add(id); render.background = true; render(); render.background = false; });
  $$("[data-hcopy]", el).forEach(b => b.onclick = () => { const e = d.items.find(x => x.id === b.dataset.hcopy); navigator.clipboard?.writeText(e.answer).then(() => toast("Copied"), () => toast("Couldn't copy")); });
}
