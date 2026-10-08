"use strict";
// Level 4 in the dashboard (docs/L4-PROGRESS.md). Loads last.
// 1. Speed: the reply streams over /api/chat/stream (SSE), so the first spoken sentence starts as soon as it is complete,
//    not on the next poll. Voice requests carry the speaking rate so the server can make the audio early (tts.prefetch).
// 2. Interruptions: barge-in and "stop" also stop the model generating (POST /api/chat/cancel), not just the audio.
// 3. Timings: speech-final → request sent → first audio, and how long a cancel took (numbers only) → /api/timing.
// 4. The live task brief, running plans and questions for the owner: a panel that follows the owner across views.
const L4 = { es: null, work: null, t0: 0, sent: 0, heard: 0, timer: 0, open: (typeof hstore !== "undefined" ? hstore.get("hq-l4-open", "1") : "1") !== "0" };

// ---------- 1. stream ----------
function l4Stream() {
  if (L4.es || typeof EventSource === "undefined") return;
  const es = new EventSource("/api/chat/stream"); L4.es = es;
  es.onmessage = m => {
    let e; try { e = JSON.parse(m.data); } catch { return; }
    if (e.type === "partial" && e.text && typeof earlySpeak === "function") {
      try { earlySpeak({ busy: true, partial: e.text, id: e.chatId, messages: { length: e.count || 0 } }); } catch {}
    }
    if (e.type === "done") setTimeout(() => { try { if (typeof onChatOpDone === "function") onChatOpDone(); } catch {} }, 30);
  };
  es.onerror = () => { es.close(); L4.es = null; setTimeout(l4Stream, 5000); };
}
const l4Api = api;
api = function (path, method = "GET", body) {
  if (method === "POST" && body && path === "/chat") {
    const rate = Math.max(.7, Math.min(1.5, Number(localStorage.getItem("hq-voice-rate") || 1.05)));
    body = { ...body, speechRate: rate };
    if (body.voice || Date.now() - (window.hqVoiceAt || 0) < 6000) { L4.sent = performance.now(); L4.t0 = L4.heard || L4.sent; L4.heard = 0; }
  }
  return l4Api.call(this, path, method, body);
};

// ---------- 2. interruptions stop the model too ----------
async function l4CancelChat() {
  const t = performance.now();
  try { const r = await l4Api("/chat/cancel", "POST", {}); if (r.cancelled) l4Timing({ cancelMs: performance.now() - t }); return r.cancelled; } catch { return false; }
}
async function l4WaitIdle(ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const c = await l4Api("/chat"); if (!c.busy) return true; } catch {} await new Promise(r => setTimeout(r, 120)); }
  return false;
}
if (typeof bargeIn === "function") {
  const l4Barge = bargeIn;
  bargeIn = function (ask, said) {
    const self = this, args = arguments;
    l4CancelChat().then(async c => { if (c) await l4WaitIdle(); l4Barge.apply(self, args); });
  };
}
if (typeof stopTalking === "function") {
  const l4Stop = stopTalking;
  stopTalking = function () { const r = l4Stop.apply(this, arguments); l4CancelChat(); return r; };
}

// ---------- 3. voice timings ----------
function l4Timing(x) { l4Api("/timing", "POST", x).catch(() => {}); }
if (typeof voiceCommand === "function") {
  const l4Voice = voiceCommand;
  voiceCommand = function (text) { L4.heard = performance.now(); return l4Voice.apply(this, arguments); };
}
(function () {
  const ss = window.speechSynthesis; if (!ss) return;
  const speak = ss.speak.bind(ss);
  ss.speak = function (u) {
    if (L4.t0 && u && u.addEventListener) {
      const t0 = L4.t0, sent = L4.sent; L4.t0 = 0;
      u.addEventListener("start", () => { const now = performance.now(); if (now - t0 < 120e3) l4Timing({ firstAudioMs: now - t0, sendMs: sent - t0 }); }, { once: true });
    }
    return speak(u);
  };
})();

// ---------- 4. brief / plans / questions panel ----------
const L4_STATUS = { waiting: "waiting", queued: "queued", running: "working", verifying: "checking", blocked: "needs you", done: "verified", unverified: "needs your check", failed: "failed", cancelled: "cancelled" };
const L4_TONE = { done: "green", completed: "green", unverified: "amber", "needs-verification": "amber", blocked: "violet", failed: "red", cancelled: "", running: "cyan", verifying: "cyan" };
function l4Field(b, k, label, multi) {
  const v = Array.isArray(b[k]) ? b[k].join("\n") : b[k] || "";
  return `<label class="l4f"><span>${esc(label)}</span>${multi ? `<textarea data-k="${k}" rows="${Math.min(5, Math.max(1, v.split("\n").length))}">${esc(v)}</textarea>` : `<input data-k="${k}" value="${esc(v)}">`}</label>`;
}
function l4BriefHtml(b) {
  const open = b.questions.filter(q => !q.answer);
  return `<div class="l4card" data-brief="${esc(b.id)}">
    <div class="l4h"><b>Task brief</b><span class="l4pill ${open.length ? "amber" : "green"}">${open.length ? `${open.length} question${open.length > 1 ? "s" : ""}` : "ready"}</span></div>
    <div class="l4orig" title="Your original words, kept as said">“${esc(b.original.slice(0, 400))}${b.original.length > 400 ? "…" : ""}”</div>
    ${open.map((q, i) => `<div class="l4q"><div>${esc(q.q)}</div>${q.recommended ? `<div class="l4rec">Recommended: ${esc(q.recommended)}</div>` : ""}
      <div class="l4row"><input data-q="${esc(q.id)}" placeholder="Your answer"><button class="btn sm" data-qa="${esc(q.id)}">Answer</button>${q.recommended ? `<button class="btn sm ghost" data-qr="${esc(q.id)}" data-v="${esc(q.recommended)}">Use recommended</button>` : ""}</div></div>`).join("")}
    <details ${open.length ? "" : "open"}><summary>Details</summary>
    ${l4Field(b, "title", "Title")}${l4Field(b, "outcome", "Outcome", true)}${l4Field(b, "deliverable", "Deliverable", true)}${l4Field(b, "project", "Project")}
    ${l4Field(b, "scope", "Scope", true)}${l4Field(b, "exclusions", "Not included", true)}${l4Field(b, "constraints", "Constraints", true)}
    ${l4Field(b, "successCriteria", "Success criteria", true)}${l4Field(b, "assumptions", "Assumptions", true)}${l4Field(b, "sources", "Sources", true)}
    <label class="l4f"><span>Permission</span><select data-k="permission">${["read", "plan", "build"].map(x => `<option ${x === b.permission ? "selected" : ""}>${x}</option>`).join("")}</select></label>
    <div class="small muted">Budget ~${b.budget.minutes} min, up to ${b.budget.agents} agents · changes are saved as you leave a field</div></details>
    <div class="l4row"><button class="btn sm" data-go="${esc(b.id)}" ${open.length ? "disabled" : ""}>Go</button>${open.length ? `<button class="btn sm ghost" data-goany="${esc(b.id)}">Go with recommended</button>` : ""}<button class="btn sm ghost" data-bcancel="${esc(b.id)}">Cancel</button></div>
  </div>`;
}
function l4PlanHtml(p) {
  return `<div class="l4card" data-plan="${esc(p.id)}"><div class="l4h"><b>${esc(p.title)}</b><span class="l4pill ${L4_TONE[p.status] || ""}">${esc(p.status.replace("-", " "))}</span></div>
    <div class="small muted">${p.steps.filter(s => s.status === "done").length}/${p.steps.length} steps verified · ${Math.round(p.usage.minutes)} min${p.budgetNote ? " · " + esc(p.budgetNote) : ""}</div>
    <ol class="l4steps">${p.steps.map(s => `<li><span class="l4pill ${L4_TONE[s.status] || ""}">${esc(L4_STATUS[s.status] || s.status)}</span> ${esc(s.title)}${s.dependsOn.length ? ` <span class="muted small">after ${esc(s.dependsOn.join(", "))}</span>` : ""}${s.repairs ? ` <span class="muted small">· ${s.repairs} repair${s.repairs > 1 ? "s" : ""}</span>` : ""}${s.note ? `<div class="small muted">${esc(s.note)}</div>` : ""}${s.evidence && s.evidence.problems.length ? `<div class="small" style="color:var(--red)">${esc(s.evidence.problems[0].slice(0, 200))}</div>` : ""}</li>`).join("")}</ol>
    ${p.report ? `<div class="small muted">Report: ${esc(p.report)}</div>` : ""}
    ${p.status === "running" || p.status === "blocked" ? `<div class="l4row"><button class="btn sm ghost" data-pcancel="${esc(p.id)}">Cancel plan</button></div>` : ""}</div>`;
}
function l4QuestionHtml(q) {
  return `<div class="l4card" data-qn="${esc(q.id)}"><div class="l4h"><b>Needs your decision</b></div>
    <div class="small"><b>Blocked:</b> ${esc(q.blocked)}</div>${q.established ? `<div class="small"><b>Established:</b> ${esc(q.established)}</div>` : ""}
    ${q.recommendation ? `<div class="l4rec">Recommended: ${esc(q.recommendation)}</div>` : ""}<div class="small"><b>Need:</b> ${esc(q.needed)}</div>
    ${q.options?.length ? `<div class="l4row">${q.options.map(o => `<button class="btn sm ghost" data-qnans="${esc(q.id)}" data-v="${esc(o)}">${esc(o)}</button>`).join("")}</div>` : ""}
    <div class="l4row"><input data-qnin="${esc(q.id)}" placeholder="Your answer"><button class="btn sm" data-qnsend="${esc(q.id)}">Answer</button></div></div>`;
}
function l4Render() {
  const w = L4.work; let box = document.getElementById("l4Panel");
  const plansLive = (w?.plans || []).filter(p => p.status === "running" || p.status === "blocked" || Date.now() - Date.parse(p.updatedAt) < 6 * 36e5);
  const show = w && (w.brief || w.questions.length || plansLive.length);
  if (!show) { box?.remove(); return; }
  if (!box) { box = document.createElement("aside"); box.id = "l4Panel"; document.body.appendChild(box); box.addEventListener("click", l4Click); box.addEventListener("change", l4Change); }
  if (box.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return; // don't redraw under the owner's typing
  const n = (w.brief ? 1 : 0) + w.questions.length + plansLive.filter(p => p.status === "running" || p.status === "blocked").length;
  box.className = L4.open ? "open" : "";
  box.innerHTML = `<button class="l4tab" data-toggle="1">${L4.open ? "Hide" : `Work · ${n}`}</button>${L4.open ? `<div class="l4body">${w.brief ? l4BriefHtml(w.brief) : ""}${w.questions.map(l4QuestionHtml).join("")}${plansLive.map(l4PlanHtml).join("")}</div>` : ""}`;
}
async function l4Load() {
  try { const prev = JSON.stringify(L4.work); L4.work = await l4Api("/work"); if (JSON.stringify(L4.work) !== prev) l4Render(); } catch {}
}
async function l4Do(fn, ok) { try { await fn(); if (ok) toast(ok); } catch (e) { toast(e.message); } l4Load(); }
function l4Click(e) {
  const t = e.target.closest("button"); if (!t) return;
  const d = t.dataset;
  if (d.toggle) { L4.open = !L4.open; if (typeof hstore !== "undefined") hstore.set("hq-l4-open", L4.open ? "1" : "0"); l4Render(); return; }
  const bid = t.closest("[data-brief]")?.dataset.brief;
  if (d.qa) { const v = t.parentElement.querySelector("input")?.value.trim(); if (v) l4Do(() => l4Api(`/briefs/${bid}`, "PATCH", { answers: { [d.qa]: v } })); }
  if (d.qr) l4Do(() => l4Api(`/briefs/${bid}`, "PATCH", { answers: { [d.qr]: d.v } }));
  if (d.go) l4Do(() => l4Api(`/briefs/${d.go}/go`, "POST", {}), "Started");
  if (d.goany) l4Do(() => l4Api(`/briefs/${d.goany}/go`, "POST", { useDefaults: true }), "Started with the recommended defaults");
  if (d.bcancel) l4Do(() => l4Api(`/briefs/${d.bcancel}/cancel`, "POST", {}), "Brief cancelled");
  if (d.pcancel && confirm("Cancel this plan? Running steps stop now.")) l4Do(() => l4Api(`/plans/${d.pcancel}/cancel`, "POST", {}), "Plan cancelled");
  if (d.qnans) l4Do(() => l4Api(`/questions/${d.qnans}/answer`, "POST", { answer: d.v }), "Answer sent");
  if (d.qnsend) { const v = t.parentElement.querySelector("input")?.value.trim(); if (v) l4Do(() => l4Api(`/questions/${d.qnsend}/answer`, "POST", { answer: v }), "Answer sent"); }
}
function l4Change(e) {
  const k = e.target.dataset.k, bid = e.target.closest("[data-brief]")?.dataset.brief; if (!k || !bid) return;
  const multi = ["exclusions", "constraints", "successCriteria", "assumptions", "sources"].includes(k);
  const v = multi ? e.target.value.split("\n").map(x => x.trim()).filter(Boolean) : e.target.value;
  l4Do(() => l4Api(`/briefs/${bid}`, "PATCH", { [k]: v }));
}
(function l4Style() {
  const s = document.createElement("style");
  s.textContent = `#l4Panel{position:fixed;right:14px;bottom:14px;z-index:60;max-width:min(420px,calc(100vw - 28px));font-size:13px}
#l4Panel .l4tab{display:block;margin-left:auto;background:var(--surface);color:var(--text);border:1px solid var(--border2);border-radius:999px;padding:6px 12px;cursor:pointer;box-shadow:var(--shadow)}
#l4Panel .l4body{margin-top:8px;max-height:min(70vh,640px);overflow:auto;display:flex;flex-direction:column;gap:8px}
#l4Panel .l4card{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:10px 12px;box-shadow:var(--shadow);color:var(--text)}
#l4Panel .l4h{display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:6px}
#l4Panel .l4orig{color:var(--text2);font-style:italic;margin-bottom:8px}
#l4Panel .l4q{border-left:3px solid var(--amber);padding-left:8px;margin:8px 0}
#l4Panel .l4rec{color:var(--text2);font-size:12px;margin:4px 0}
#l4Panel .l4row{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;align-items:center}
#l4Panel .l4row input{flex:1;min-width:120px}
#l4Panel .l4f{display:block;margin:6px 0}#l4Panel .l4f span{display:block;font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.04em}
#l4Panel .l4f input,#l4Panel .l4f textarea,#l4Panel .l4f select{width:100%;box-sizing:border-box}
#l4Panel .l4pill{font-size:11px;border-radius:999px;padding:1px 8px;border:1px solid var(--border2);color:var(--text2);white-space:nowrap}
#l4Panel .l4pill.green{color:var(--green);background:var(--green-bg)}#l4Panel .l4pill.amber{color:var(--amber);background:var(--amber-bg)}
#l4Panel .l4pill.red{color:var(--red);background:var(--red-bg)}#l4Panel .l4pill.violet{color:var(--violet);background:var(--violet-bg)}#l4Panel .l4pill.cyan{color:var(--cyan)}
#l4Panel .l4steps{margin:6px 0 0 18px;padding:0}#l4Panel .l4steps li{margin:4px 0}
@media (max-width:600px){#l4Panel{left:12px;right:12px;bottom:70px}}`;
  document.head.appendChild(s);
})();
if (!window.hqOverlay) {
  l4Stream();
  l4Load();
  setInterval(() => { if (!document.hidden) l4Load(); }, 4000);
}
