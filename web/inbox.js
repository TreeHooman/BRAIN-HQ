// Command screen extras: "Upcoming" (next 7 days of calendar, reminders and milestones) and "Inbox"
// (latest Gmail, read-only, through the claude.ai connector; refreshed by HQ every 30 min while turned on).
"use strict";
const Mail = { st: null, t: 0, loading: false };
const mailGet = async () => { Mail.st = await api("/mail").catch(() => Mail.st); return Mail.st; };
const fromName = f => String(f || "").replace(/<[^>]*>/g, "").replace(/"/g, "").trim() || String(f || "").replace(/[<>]/g, "");

function upcomingHTML() {
  const now = new Date(), start = new Date(now); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() + 2); // after today + tomorrow (the Today panel)
  const end = new Date(start); end.setDate(end.getDate() + 6);
  const items = [];
  (S.calendar?.upcoming || []).forEach(e => { const s = e.allDay ? toDate(e.start + "T00:00") : new Date(e.start); if (s >= start && s < end) items.push({ s, t: e.title, k: "ev", all: e.allDay, sub: e.location || "" }); });
  S.reminders.filter(r => !r.done).forEach(r => { const s = toDate(r.due); if (s >= start && s < end) items.push({ s, t: r.title, k: "rem", all: String(r.due).length <= 10, sub: r.project ? projName(r.project) : "", p: r.project }); });
  S.milestones.filter(m => !m.done).forEach(m => { const s = toDate(m.date + "T09:00"); if (s >= start && s < end) items.push({ s, t: m.title, k: m.kind === "deadline" ? "dl" : "ms", all: true, sub: m.project ? projName(m.project) : "", p: m.project }); });
  items.sort((a, b) => a.s - b.s);
  let html = "", day = "";
  for (const x of items.slice(0, 6)) {
    const d = `${DOW[x.s.getDay()]} ${x.s.getDate()} ${MON[x.s.getMonth()]}`;
    if (d !== day) { day = d; html += `<div class="nv-now" style="color:var(--text3)">${esc(d.toUpperCase())}</div>`; }
    html += `<a class="nv-row ${x.k === "ev" ? "t-ev" : x.k === "dl" ? "sev-red" : "t-rem"}" href="${x.p ? "#project/" + esc(x.p) : x.k === "ev" ? "#calendar" : "#roadmap"}"><span class="tm">${x.all ? "all day" : `${pad(x.s.getHours())}:${pad(x.s.getMinutes())}`}</span><div style="min-width:0"><div class="t">${esc(x.t)}</div><small>${x.k === "ev" ? "CALENDAR" : x.k === "dl" ? "DEADLINE" : x.k === "ms" ? "MILESTONE" : "REMINDER"}${x.sub ? " · " + esc(x.sub).slice(0, 40) : ""}</small></div></a>`;
  }
  const feeds = (S.calendar?.feeds || []).length;
  return `<div class="card nv-panel" id="nvUp"><div class="ttl">Upcoming <b>${items.length ? items.length + " this week" : "clear"}</b></div>${html}${items.length > 6 ? `<a class="nv-empty" href="#calendar" style="display:block;margin-top:6px">+${items.length - 6} more in Calendar</a>` : ""}${html ? "" : `<div class="nv-empty">Nothing in the next 7 days.${feeds ? "" : ` <a href="#settings">Connect your calendar</a>`}</div>`}</div>`;
}

function inboxHTML() {
  const m = Mail.st;
  if (!m) return `<div class="card nv-panel" id="nvMail"><div class="ttl">Inbox</div><div class="nv-empty">Loading…</div></div>`;
  if (!m.enabled) return `<div class="card nv-panel" id="nvMail"><div class="ttl">Inbox <b>off</b></div>
    <div class="nv-empty" style="margin-bottom:10px">See your latest emails here. HQ reads Gmail through your claude.ai Gmail connector, <b>read-only</b> (it can't send, draft or delete), every 30 minutes. Each check is a small Haiku run on your Claude plan.</div>
    <button type="button" class="btn sm primary" id="mailOn">Show my inbox here</button></div>`;
  const unread = m.items.filter(x => x.unread).length;
  const rows = m.items.slice(0, 7).map(x => {
    const d = Date.parse(x.date), when = Number.isFinite(d) ? ago(new Date(d).toISOString()) : "";
    return `<a class="nv-row ml-row ${x.unread ? "unread" : ""}" href="https://mail.google.com/mail/u/0/#search/${encodeURIComponent(x.subject.slice(0, 80))}" target="_blank" rel="noopener noreferrer"><span class="led ${x.unread ? (x.important ? "amber" : "") : "off"}"></span><div style="min-width:0"><div class="t"><b>${esc(fromName(x.from)).slice(0, 40)}</b>${esc(x.subject)}</div><small>${esc(x.snippet).slice(0, 110)}${when ? " · " + esc(when) : ""}</small></div></a>`;
  }).join("");
  return `<div class="card nv-panel" id="nvMail"><div class="ttl">Inbox <b>${m.busy ? "checking…" : unread ? unread + " unread" : m.items.length ? "read" : ""}</b></div>
    ${m.error ? `<div class="nv-empty" style="color:var(--amber)">${esc(m.error)}</div>` : ""}
    ${rows || (m.busy ? `<div class="nv-empty">Reading Gmail…</div>` : m.error ? "" : `<div class="nv-empty">Nothing new in the last 3 days.</div>`)}
    <div class="ml-foot"><span>${m.at ? "checked " + esc(ago(m.at)) : ""}</span><button type="button" class="btn sm ghost" id="mailRef" ${m.busy ? "disabled" : ""}>Refresh</button><button type="button" class="btn sm ghost" id="mailOff" title="Stop reading Gmail">Turn off</button></div></div>`;
}

function cmdExtras() {
  const L = document.getElementById("cmdLeft"), R = document.getElementById("cmdRight"); if (!L || !R) return;
  document.getElementById("nvUp")?.remove(); document.getElementById("nvMail")?.remove();
  const today = [...L.children].find(c => c.id !== "nvFocus");
  const box = document.createElement("div"); box.innerHTML = upcomingHTML() + inboxHTML();
  const [up, ml] = box.children;
  if (today) today.after(up); else L.append(up);
  // inbox: right column, under "Needs you" (above Quick actions)
  const quick = [...R.children].find(c => /Quick actions/i.test(c.querySelector(".ttl")?.textContent || ""));
  if (quick) quick.before(ml); else R.append(ml);
  ml.querySelector("#mailOn")?.addEventListener("click", async () => { Mail.st = await api("/mail/enable", "POST", { on: true }).catch(e => { toast(e.message); return Mail.st; }); cmdExtras(); mailPoll(); });
  ml.querySelector("#mailOff")?.addEventListener("click", async () => { if (!confirm("Stop showing your inbox here?")) return; Mail.st = await api("/mail/enable", "POST", { on: false }).catch(() => Mail.st); cmdExtras(); });
  ml.querySelector("#mailRef")?.addEventListener("click", async () => { Mail.st = await api("/mail/refresh", "POST").catch(e => { toast(e.message); return Mail.st; }); cmdExtras(); mailPoll(); });
}
async function mailPoll() {
  clearTimeout(Mail.t); if (route.view !== "command" || document.hidden) return;
  const was = JSON.stringify(Mail.st); await mailGet();
  if (JSON.stringify(Mail.st) !== was) cmdExtras();
  Mail.t = setTimeout(mailPoll, Mail.st?.busy ? 4000 : 60000);
}
const _cmdFillX = cmdFill;
cmdFill = function (q) { _cmdFillX(q); try { cmdExtras(); } catch (e) { console.warn(e); } if (!Mail.st) mailGet().then(cmdExtras); clearTimeout(Mail.t); Mail.t = setTimeout(mailPoll, Mail.st?.busy ? 4000 : 60000); };
document.addEventListener("visibilitychange", () => { if (!document.hidden && route.view === "command") mailPoll(); });
