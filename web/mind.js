// LUTHUR page = chat + mind dump. Dump anything (thoughts, ideas, worries, to-dos), one line each; it lands in the brain's
// inbox right away (no Claude call), and "Save & sort" has LUTHUR file every note: reminders, project logs, decisions, dates.
"use strict";
const MIND = { draft: "" };
try { MIND.draft = sessionStorage.getItem("hq-mind") || ""; } catch {}
const mindSave = () => { try { sessionStorage.setItem("hq-mind", MIND.draft); } catch {} };

function mindPanel() {
  const inbox = [...(S.inbox || [])].reverse(), dec = (S.decisions || []).slice(0, 5);
  return `<aside class="mind card nv-panel" aria-label="Mind dump">
    <div class="panel-title">Mind dump <small>one thought per line</small></div>
    <textarea id="mindText" rows="6" placeholder="Empty your head here…&#10;call the bank friday&#10;idea: referral bonus for LoanCentral&#10;worried the Reddit review stalls">${esc(MIND.draft)}</textarea>
    <div class="row mind-act"><button type="button" class="btn mic sm" id="mindMic" aria-label="Dump by voice" title="Talk it out">${MIC_SVG}</button>
      <span class="grow"></span><button type="button" class="btn sm" id="mindSave">Save</button><button type="button" class="btn sm primary" id="mindSort" title="Save, then LUTHUR files each note where it belongs">Save &amp; sort</button></div>
    <div class="pd-sub">Waiting to be filed <span class="faint">${inbox.length || ""}</span></div>
    ${inbox.length ? `<ul class="mind-list">${inbox.slice(0, 30).map(i => `<li><div class="grow">${esc(i.text)}<small>${esc(i.at || "")}${i.project ? " · " + esc(projName(i.project)) : ""}</small></div><button type="button" class="icon-btn" data-mindx="${esc(i.id)}" aria-label="Delete note">×</button></li>`).join("")}</ul>
      ${inbox.length > 1 ? `<button type="button" class="btn sm ghost" id="mindSortAll">Have LUTHUR file these ${inbox.length}</button>` : ""}` : `<div class="empty small">All filed.</div>`}
    ${dec.length ? `<div class="pd-sub">Recent decisions</div><ul class="mind-dec">${dec.map(d => `<li>${md(d.replace(/^- /, ""))}</li>`).join("")}</ul>` : ""}
  </aside>`;
}

async function mindStore(sort) {
  const lines = MIND.draft.split("\n").map(x => x.replace(/^\s*[-*•]\s*/, "").trim()).filter(Boolean).slice(0, 40);
  if (!lines.length && !sort) return toast("Write something first");
  const project = (typeof activeProject === "function" && activeProject()) || undefined;
  try {
    for (const t of lines) await api("/inbox", "POST", { text: t.slice(0, 2000), project });
    MIND.draft = ""; mindSave();
    if (sort) await api("/inbox/sort", "POST");
    toast(sort ? `Saved ${lines.length || "the"} note${lines.length === 1 ? "" : "s"}. LUTHUR is filing them.` : `Saved ${lines.length} note${lines.length > 1 ? "s" : ""} to the brain`);
    if (sort && typeof opsKick === "function") opsKick();
  } catch (e) { return toast("⚠ " + e.message); }
  await refresh(); render.background = false; render();
}

function mindBind(el) {
  const ta = el.querySelector("#mindText"); if (!ta) return;
  ta.oninput = () => { MIND.draft = ta.value; mindSave(); };
  ta.onkeydown = e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); mindStore(false); } };
  el.querySelector("#mindSave").onclick = () => mindStore(false);
  el.querySelector("#mindSort").onclick = () => mindStore(true);
  const all = el.querySelector("#mindSortAll"); if (all) all.onclick = () => mindStore(true);
  el.querySelector("#mindMic").onclick = () => listen((t, done) => { if (done && t.trim()) { MIND.draft = (MIND.draft.trim() ? MIND.draft.trimEnd() + "\n" : "") + t.trim(); mindSave(); ta.value = MIND.draft; } },
    on => el.querySelector("#mindMic")?.classList.toggle("live", on));
  el.querySelectorAll("[data-mindx]").forEach(b => b.onclick = () => act(() => api(`/inbox/${b.dataset.mindx}`, "DELETE")));
}

if (typeof vAssistant === "function") {
  const _vAssistantMind = vAssistant;
  vAssistant = async function (el) {
    const focusMind = document.activeElement?.id === "mindText", pos = focusMind ? document.activeElement.selectionStart : 0;
    await _vAssistantMind(el);
    const chat = el.querySelector(".chat"); if (!chat) return;
    const wrap = document.createElement("div"); wrap.className = "mind-wrap";
    chat.replaceWith(wrap); wrap.appendChild(chat); wrap.insertAdjacentHTML("beforeend", mindPanel());
    const sub = chat.querySelector(".sub"); if (sub) sub.textContent = "Your chief of staff. Talk or type on the left; dump loose thoughts on the right and LUTHUR files them.";
    mindBind(wrap);
    // Moving the chat into the wrapper resets its scroll; keep the newest message in view.
    const log = chat.querySelector("#chatLog"); if (log) log.scrollTop = log.scrollHeight;
    if (focusMind) { const t = wrap.querySelector("#mindText"); t.focus(); t.setSelectionRange(pos, pos); }
    else if (!chatState?.busy && !render.background) chat.querySelector("#chatText")?.focus({ preventScroll: true }); // moving the chat drops its focus
  };
}
