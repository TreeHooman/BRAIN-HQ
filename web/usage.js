// Code page: usage at a glance (today, plan limit) with a drop-down for the week, where it went, and each session's context.
"use strict";
const US = { d: null, t: 0 };
const usMoney = n => n >= 10 ? "$" + n.toFixed(0) : n >= 1 ? "$" + n.toFixed(2) : n > 0 ? "$" + n.toFixed(2) : "$0";
const usK = n => n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "k" : String(n || 0);
function usRate(r) {
  if (!r) return `<span class="us-dim">plan limit: shows after your next run</span>`;
  const pct = typeof r.utilization === "number" ? Math.round(r.utilization * (r.utilization <= 1 ? 100 : 1)) : null;
  const when = r.resetsAt ? new Date(r.resetsAt).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }) : "";
  const kind = /seven|week/i.test(r.type || "") ? "weekly" : /five|5/i.test(r.type || "") ? "5-hour" : "plan";
  const cls = r.status === "rejected" ? "bad" : /warn/.test(r.status || "") || (pct ?? 0) >= 80 ? "warn" : "ok";
  const label = r.status === "rejected" ? `${kind} limit reached` : pct != null ? `${kind} limit ${pct}% used` : /warn/.test(r.status || "") ? `${kind} limit: getting close` : `${kind} limit OK`;
  return `<span class="us-rate ${cls}">${pct != null ? `<i style="--w:${Math.min(100, pct)}%"></i>` : ""}${esc(label)}${when ? ` · resets ${esc(when)}` : ""}</span>`;
}
function usHTML() {
  const d = US.d; if (!d) return `<div class="us-strip"><span class="us-dim">Loading usage…</span></div>`;
  const open = hstore.get("hq-us-open", "0") === "1";
  const max = Math.max(1e-9, ...d.days.map(x => x.cost || x.runs / 100));
  const srcs = Object.entries(d.bySrc).sort((a, b) => b[1].cost - a[1].cost || b[1].runs - a[1].runs);
  const top = Math.max(1e-9, ...srcs.map(([, v]) => v.cost || v.runs / 100));
  const sess = (Live.code?.sessions || []).filter(s => s.usage).sort((a, b) => (b.usage.cost || 0) - (a.usage.cost || 0)).slice(0, 8);
  return `<div class="us-strip ${open ? "open" : ""}">
    <div class="us-row"><b>TODAY</b><span>${usMoney(d.today.cost)}</span><span>${d.today.runs} run${d.today.runs === 1 ? "" : "s"}</span><span>${usK(d.today.out)} tokens out</span>${usRate(d.rate)}<button type="button" class="us-tog" id="usTog">${open ? "Less ▴" : "Usage ▾"}</button></div>
    ${open ? `<div class="us-more">
      <div class="us-col"><div class="us-h">LAST 7 DAYS · ${usMoney(d.week.cost)} · ${d.week.runs} runs</div><div class="us-bars">${d.days.map(x => `<div title="${esc(x.date)}: ${usMoney(x.cost)}, ${x.runs} runs"><i style="height:${Math.max(3, (x.cost || x.runs / 100) / max * 100)}%"></i><span>${esc(x.label)}</span></div>`).join("")}</div></div>
      <div class="us-col"><div class="us-h">WHERE IT WENT (7 DAYS)</div>${srcs.map(([k, v]) => `<div class="us-src"><span>${esc(k)}</span><i style="--w:${Math.max(2, (v.cost || v.runs / 100) / top * 100)}%"></i><b>${usMoney(v.cost)}</b><small>${v.runs}</small></div>`).join("") || `<div class="us-dim">No runs yet.</div>`}
        <div class="us-h" style="margin-top:10px">BY MODEL</div><div class="us-models">${Object.entries(d.byModel).map(([k, v]) => `<span>${esc(k)} <b>${usMoney(v.cost)}</b> · ${v.runs}</span>`).join("")}</div></div>
      <div class="us-col"><div class="us-h">SESSIONS · CONTEXT USED</div>${sess.map(s => { const w = s.usage.win || 200000, p = Math.min(100, Math.round((s.usage.ctx || 0) / w * 100)); return `<div class="us-sess"><span>${esc(s.name || s.project)}</span><i class="${p >= 85 ? "bad" : p >= 60 ? "warn" : ""}" style="--w:${p}%"></i><small>${usK(s.usage.ctx)}/${usK(w)} · ${usMoney(s.usage.cost || 0)}</small></div>`; }).join("") || `<div class="us-dim">Sessions show here after they run.</div>`}</div>
    </div><div class="us-note">Dollar amounts are the pay-per-use equivalent. On your Claude plan they count toward the plan limit; nothing is billed.</div>` : ""}</div>`;
}
function usPaint() {
  const host = document.getElementById("usHost"); if (!host) return;
  host.innerHTML = usHTML();
  host.querySelector("#usTog")?.addEventListener("click", () => { hstore.set("hq-us-open", hstore.get("hq-us-open", "0") === "1" ? "0" : "1"); usPaint(); });
}
async function usLoad() {
  clearTimeout(US.t);
  if (route.view !== "code" || document.hidden) return;
  US.d = await api("/usage").catch(() => US.d); usPaint();
  US.t = setTimeout(usLoad, 30000);
}
const _vCodeUs = vCode;
vCode = async function (el) {
  await _vCodeUs(el);
  const head = el.querySelector(".tui-head"); if (!head || el.querySelector("#usHost")) return;
  const h = document.createElement("div"); h.id = "usHost"; head.after(h); usPaint(); usLoad();
};
document.addEventListener("visibilitychange", () => { if (!document.hidden) usLoad(); });
