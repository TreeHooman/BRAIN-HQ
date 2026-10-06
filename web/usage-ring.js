// Claude context and five-hour plan signals around the War Room core.
"use strict";
const UsageRing = { timer: 0 };
function usageRingArc(key, fraction) {
  const svg = document.querySelector(".nv-hud"), p = svg?.querySelector(`[data-usage="${key}"]`); if (!p) return;
  const r0 = Number(p.dataset.r0), r1 = r0 + 10, c = 200, a0 = 288 * Math.PI / 180;
  const a1 = a0 + Math.max(.001, Math.min(1, fraction || 0)) * 52 * Math.PI / 180;
  const pt = (r, a) => [c + Math.cos(a) * r, c + Math.sin(a) * r].map(v => v.toFixed(2));
  const [ax, ay] = pt(r1, a0), [bx, by] = pt(r1, a1), [cx, cy] = pt(r0, a1), [dx, dy] = pt(r0, a0);
  p.setAttribute("d", `M${ax} ${ay}A${r1} ${r1} 0 0 1 ${bx} ${by}L${cx} ${cy}A${r0} ${r0} 0 0 0 ${dx} ${dy}Z`);
  p.classList.toggle("known", fraction != null);
}
function usageRingPaint(chat, data) {
  const svg = document.querySelector(".nv-hud"), note = document.getElementById("nvUsageNote"); if (!svg || !note) return;
  const context = chat?.claudeUsage, ctx = context?.window > 0 && context?.context >= 0 ? Math.min(1, context.context / context.window) : null;
  const five = data?.rates?.fiveHour || (/five|5.?hour/i.test(data?.rate?.type || "") ? data.rate : null);
  const fresh = five && (!five.resetsAt || Number(five.resetsAt) > Date.now());
  const raw = Number(five?.utilization), usable = five?.utilization != null && Number.isFinite(raw);
  const fivePct = fresh && (usable || five.status === "rejected") ? five.status === "rejected" ? 1 : Math.min(1, Math.max(0, raw <= 1 ? raw : raw / 100)) : null;
  const weekly = data?.rates?.weekly || (/seven|week/i.test(data?.rate?.type || "") ? data.rate : null);
  const weeklyBlocked = weekly?.status === "rejected" && (!weekly.resetsAt || Number(weekly.resetsAt) > Date.now());
  usageRingArc("context", ctx); usageRingArc("fiveHour", fivePct);
  const ctxText = ctx == null ? "—" : `${Math.round(ctx * 100)}%`, fiveText = fivePct == null ? "—" : `${Math.round(fivePct * 100)}%`;
  svg.querySelector('[data-usage-label="context"]').textContent = `CTX ${ctxText}`;
  svg.querySelector('[data-usage-label="fiveHour"]').textContent = `5H ${fiveText}`;
  note.textContent = `CLAUDE CONTEXT ${ctxText}  ·  5H ${fiveText}${weeklyBlocked ? "  ·  WEEKLY LIMIT" : ""}`;
  const ctxDetail = context ? `${Math.round(context.context / 1000)}k of ${Math.round(context.window / 1000)}k tokens on the last Claude turn (${new Date(context.at).toLocaleString()}).` : "Context appears after LUTHUR completes a Claude turn that reports its window size.";
  const fiveDetail = fivePct == null ? "Claude has not supplied a current five-hour usage signal to LUTHUR." : `Last reported five-hour plan usage: ${fiveText}${five.at ? ` (${new Date(five.at).toLocaleString()})` : ""}.`;
  note.title = `${ctxDetail} ${fiveDetail}${weeklyBlocked ? " Claude's weekly limit is currently reached." : ""}`;
  note.setAttribute("aria-label", note.title);
  note.classList.toggle("weekly-blocked", weeklyBlocked);
}
async function usageRingPoll() {
  clearTimeout(UsageRing.timer);
  if (route.view !== "command" || !document.getElementById("nvUsageNote")) return;
  const [chat, data] = await Promise.all([api("/chat").catch(() => null), api("/usage").catch(() => null)]);
  if (route.view === "command") usageRingPaint(chat, data);
  if (route.view === "command") UsageRing.timer = setTimeout(usageRingPoll, chat?.busy ? 10000 : 30000);
}
function usageRingMount() {
  const stage = document.getElementById("nvStage"); if (!stage) return;
  const note = document.createElement("div"); note.id = "nvUsageNote"; note.className = "nv-usage-note"; note.setAttribute("role", "status");
  note.textContent = "CLAUDE CONTEXT —  ·  5H —"; stage.append(note);
  usageRingPoll();
}
