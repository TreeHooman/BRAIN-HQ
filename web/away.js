"use strict";
// Away mode in the dashboard (docs/AWAY-MODE.md). Loads after l4.js.
// 1. Today → "Away mode" card: phone access (Tailscale), health checks, usage pacing, reliability, results to rate,
//    and habits LUTHUR spotted (do them before you ask).
// 2. Tasks: 👍 / 👎 on every finished report; 👎 asks what was wrong and saves it as a lesson.
const AW = { data: null, at: 0, busy: false };

async function awLoad(force) {
  if (AW.busy || (!force && AW.data && Date.now() - AW.at < 60e3)) return AW.data;
  AW.busy = true;
  try { AW.data = await api("/away"); AW.at = Date.now(); } catch {} finally { AW.busy = false; }
  return AW.data;
}

const awDot = l => `<i class="aw-dot ${l === "bad" ? "bad" : l === "warn" ? "warn" : "ok"}"></i>`;
function awCard() {
  const d = AW.data;
  if (!d) return `<section class="card nv-panel aw" style="grid-column:1/-1"><div class="panel-title">Away mode</div><div class="empty small">Loading…</div></section>`;
  const r = d.remote, h = d.health, p = d.pacing, rel = d.reliability;
  const phone = r?.url
    ? `<div class="aw-row">${awDot("ok")}<div class="grow"><b>Phone access on</b><small>Open <a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.url.replace(/^https:\/\/|\/$/g, ""))}</a> on any of your Tailscale devices. Same PIN.</small></div><button type="button" class="btn sm ghost" data-awcopy="${esc(r.url)}">Copy</button></div>`
    : `<div class="aw-row">${awDot("warn")}<div class="grow"><b>Phone access off</b><small>${!r?.installed ? "Install Tailscale on this PC and your phone (same account)." : !r.running ? "Open Tailscale on this PC and sign in." : "Tailscale is connected; LUTHUR isn't shared on it yet."}</small></div>${r?.running ? `<button type="button" class="btn sm" data-awserve>Turn on</button>` : ""}</div>`;
  const checks = (h?.checks || []).filter(c => c.id !== "remote");
  const bad = checks.filter(c => c.level !== "ok");
  const health = `<div class="aw-row">${awDot(bad.some(c => c.level === "bad") ? "bad" : bad.length ? "warn" : "ok")}<div class="grow"><b>${bad.length ? `${bad.length} thing${bad.length > 1 ? "s" : ""} need${bad.length > 1 ? "" : "s"} a look` : "Healthy"}</b>
      <small>${h?.at ? `checked ${esc(ago(h.at))}` : "not checked yet"}${h?.restarts?.length ? ` · ${h.restarts.length} auto-restart${h.restarts.length > 1 ? "s" : ""} this week` : ""} · ${h?.pingConfigured ? (h.ping?.ok ? "dead-man ping ok" : h.ping?.at ? "dead-man ping failing" : "dead-man ping set") : "no dead-man ping (see docs/AWAY-MODE.md)"}</small>
      ${bad.length ? `<ul class="aw-list">${bad.map(c => `<li>${awDot(c.level)}${esc(c.text)}${c.fix ? `<small>${esc(c.fix)}</small>` : ""}</li>`).join("")}</ul>` : ""}</div><button type="button" class="btn sm ghost" data-awcheck>Check now</button></div>`;
  const pace = `<div class="aw-row">${awDot(p?.mode === "reserve" ? "warn" : "ok")}<div class="grow"><b>Usage: ${p?.mode === "save" ? "saving" : p?.mode === "reserve" ? "reserve reached" : "on pace"}</b>
      <small>${p?.weekly != null ? `Claude this week ${Math.round(p.weekly)}%${p.expected != null ? ` (even pace ${p.expected}%)` : ""}${p.fiveHour != null ? ` · 5-hour ${Math.round(p.fiveHour)}%` : ""}` : "No weekly reading yet"}${p?.mode === "save" ? " · background work goes to Codex or waits" : p?.mode === "reserve" ? ` · the last ${p.settings.reserve}% is kept for you` : ""}. Your chat and your tasks are never held back.</small></div></div>`;
  const relLine = rel?.finished ? `${rel.finished} results in 30 days · ${rel.done} done, ${rel.partly} partly, ${rel.issue} needed a look · you rated ${rel.rated}${rel.rated ? ` (${rel.score}% right${rel.falseDone ? `, <b class="aw-bad">${rel.falseDone} said done but weren't</b>` : ""})` : ""}` : "Nothing finished yet.";
  const unrated = (d.unrated || []).slice(0, 5).map(w => `<li data-awid="${esc(w.id)}"><span class="pill ${w.status === "done" ? "green" : w.status === "partly" ? "amber" : "red"}">${w.status === "issue" ? "needs a look" : w.status}</span><span class="grow">${esc(w.title)}<small>${w.kind} · ${esc(ago(w.at))}</small></span>${awRateBtns(w.id)}</li>`).join("");
  const habits = (d.habits || []).map(x => `<li><span class="grow"><b>${esc(x.title)}</b><small>You asked this on ${x.days} days · LUTHUR would do it ${esc(x.when)}</small></span><button type="button" class="btn sm" data-awhabit="${x.key}" data-ok="1">Do it before I ask</button><button type="button" class="btn sm ghost" data-awhabit="${x.key}">No</button></li>`).join("");
  return `<section class="card nv-panel aw" style="grid-column:1/-1"><div class="panel-title between"><span>Away mode</span><small class="faint">for running LUTHUR from your phone</small></div>
    ${phone}${health}${pace}
    <div class="aw-row">${awDot(rel?.falseDone ? "warn" : "ok")}<div class="grow"><b>Reliability</b><small>${relLine}</small>
      ${unrated ? `<ul class="aw-list aw-rate">${unrated}</ul>` : ""}
      ${rel?.recentBad?.length ? `<details><summary class="small muted">Lessons learned (${rel.recentBad.length})</summary><ul class="aw-list">${rel.recentBad.map(b => `<li>${esc(b.title)}<small>${esc(b.note || "no note")}</small></li>`).join("")}</ul></details>` : ""}</div></div>
    ${habits ? `<div class="aw-row">${awDot("ok")}<div class="grow"><b>Habits LUTHUR spotted</b><ul class="aw-list aw-habit">${habits}</ul></div></div>` : ""}
  </section>`;
}
const awRateBtns = id => `<span class="aw-btns"><button type="button" class="btn sm ghost" data-awrate="${esc(id)}" data-good="1" title="It was right" aria-label="It was right">👍</button><button type="button" class="btn sm ghost" data-awrate="${esc(id)}" title="It wasn't right" aria-label="It wasn't right">👎</button></span>`;

async function awRate(id, good) {
  let note = "";
  if (!good) { note = prompt("What was wrong? LUTHUR keeps this as a lesson for next time (optional).") ?? null; if (note === null) return false; }
  try { const r = await api("/outcomes/rate", "POST", { id, good, note }); toast(good ? "Noted: right" : r.lesson ? "Noted. Lesson saved for next time." : "Noted: not right"); if (r.ruleTurnedOff) toast("The rule that started it is now off.", 5000); }
  catch (e) { toast("⚠ " + e.message); return false; }
  AW.at = 0; return true;
}

function awBind(root, repaint) {
  root.querySelectorAll("[data-awcopy]").forEach(b => b.onclick = () => navigator.clipboard?.writeText(b.dataset.awcopy).then(() => toast("Copied")).catch(() => toast(b.dataset.awcopy, 8000)));
  root.querySelectorAll("[data-awserve]").forEach(b => b.onclick = async () => { b.disabled = true; try { await api("/remote/serve", "POST", {}); toast("Phone access on"); } catch (e) { toast("⚠ " + e.message, 9000); } await awLoad(true); repaint(); });
  root.querySelectorAll("[data-awcheck]").forEach(b => b.onclick = async () => { b.disabled = true; try { await api("/away/health", "POST", {}); } catch (e) { toast("⚠ " + e.message); } await awLoad(true); repaint(); });
  root.querySelectorAll("[data-awrate]").forEach(b => b.onclick = async () => { if (await awRate(b.dataset.awrate, b.dataset.good === "1")) { await awLoad(true); repaint(); } });
  root.querySelectorAll("[data-awhabit]").forEach(b => b.onclick = async () => {
    try { await api(`/habits/${b.dataset.awhabit}`, "POST", { accept: b.dataset.ok === "1" }); toast(b.dataset.ok === "1" ? "Scheduled. It shows in Missions." : "OK, won't suggest it for 60 days."); } catch (e) { toast("⚠ " + e.message); }
    await awLoad(true); repaint();
  });
}

// ---------- 1. Today card ----------
if (typeof tdPaint === "function") {
  const awTdPaint = tdPaint;
  tdPaint = function (el) {
    awTdPaint(el);
    const host = el.querySelector(".td-cols.two"); if (!host) return;
    host.insertAdjacentHTML("beforeend", awCard());
    const card = host.querySelector(".aw");
    awBind(card, () => { if (el.isConnected && route.view === "home") tdPaint(el); });
    if (!AW.data || Date.now() - AW.at > 60e3) awLoad().then(() => { if (el.isConnected && route.view === "home" && AW.data) { const c = el.querySelector(".aw"); if (c) { c.outerHTML = awCard(); awBind(el.querySelector(".aw"), () => tdPaint(el)); } } });
  };
}

// ---------- 2. Rate task reports ----------
if (typeof taskList === "function") {
  const awTaskList = taskList;
  taskList = function () {
    awTaskList.apply(this, arguments);
    const box = document.getElementById("tkList"); if (!box) return;
    for (const t of Live.tasks || []) {
      if (!["done", "partly", "issue"].includes(t.status)) continue;
      const card = box.querySelector(`.lv-task[data-task="${CSS.escape(t.id)}"]`); if (!card || card.querySelector(".aw-taskrate")) continue;
      const html = t.rating ? `<div class="aw-taskrate small muted">${t.rating.good ? "👍 You said this was right." : `👎 You said this wasn't right${t.rating.note ? `: ${esc(t.rating.note)}` : "."}`}</div>`
        : `<div class="aw-taskrate"><span class="small muted">Was this right?</span>${awRateBtns(t.id)}</div>`;
      (card.querySelector(".lv-reply") || card).insertAdjacentHTML("beforebegin", html);
      card.querySelectorAll(".aw-taskrate [data-awrate]").forEach(b => b.onclick = async () => {
        if (await awRate(b.dataset.awrate, b.dataset.good === "1")) { t.rating = { good: b.dataset.good === "1", note: "" }; const row = card.querySelector(".aw-taskrate"); if (row) row.outerHTML = `<div class="aw-taskrate small muted">${t.rating.good ? "👍 Noted as right." : "👎 Noted as not right."}</div>`; liveKick?.(); }
      });
    }
  };
}
