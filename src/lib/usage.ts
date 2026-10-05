// Usage ledger: every Claude run (Code, chat, missions, inbox, explain…) is logged with what the CLI reported, so the
// Code page can show today / this week, where it went, and the plan limit. Numbers come from Claude Code's own output;
// cost is the pay-per-use equivalent (on a subscription it counts toward your plan, it isn't billed).
import fs from "node:fs";
import path from "node:path";
import { DATA, readJson, writeJson } from "./store.ts";
import { onRunResult } from "./claude.ts";

const FILE = path.join(DATA, "usage.jsonl"), RATE = path.join(DATA, "usage-rate.json");
type Row = { at: string; src: string; model: string; ok: boolean; kind: string; cost: number; out: number; ctx: number; ms: number };
const src = (id = "") => /^code-/.test(id) ? "Code" : /^chat-/.test(id) ? "Chat" : /^mail-/.test(id) ? "Inbox" : id === "explain" ? "Explain" : id === "write-ai" ? "Writing" : /^out-/.test(id) ? "Outbox" : id === "auth-check" ? "System" : "Missions";
const fam = (m = "") => /opus/i.test(m) ? "Opus" : /sonnet/i.test(m) ? "Sonnet" : /haiku/i.test(m) ? "Haiku" : m || "?";

onRunResult((r, o) => {
  if (r.kind === "missing") return;
  const st = r.stats;
  const row: Row = { at: new Date().toISOString(), src: src(o.runId), model: fam(o.model), ok: r.ok, kind: r.kind, cost: Number(st?.cost) || 0, out: Number(st?.output) || 0, ctx: Number(st?.context) || 0, ms: r.durationMs || 0 };
  try {
    fs.mkdirSync(DATA, { recursive: true });
    fs.appendFileSync(FILE, JSON.stringify(row) + "\n");
    if (fs.statSync(FILE).size > 3e6) { const lines = fs.readFileSync(FILE, "utf8").trim().split("\n"); fs.writeFileSync(FILE, lines.slice(-8000).join("\n") + "\n"); }
  } catch {}
  if (st?.rate) writeJson(RATE, { ...st.rate, at: row.at });
  if (r.kind === "limit") writeJson(RATE, { status: "rejected", resetsAt: r.resetAt || null, at: row.at });
});

export function summary() {
  let rows: Row[] = [];
  try { rows = fs.readFileSync(FILE, "utf8").trim().split("\n").slice(-10000).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch {}
  const now = new Date(), day0 = new Date(now); day0.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(day0); d.setDate(d.getDate() - (6 - i)); return { date: d.toISOString().slice(0, 10), label: d.toLocaleDateString(undefined, { weekday: "short" }), start: d.getTime(), runs: 0, cost: 0, out: 0 }; });
  const add = (o: any, r: Row) => { o.runs++; o.cost += r.cost; o.out += r.out; };
  const today = { runs: 0, cost: 0, out: 0, failed: 0 }, week = { runs: 0, cost: 0, out: 0 }, bySrc: Record<string, any> = {}, byModel: Record<string, any> = {};
  const hour5 = { runs: 0, cost: 0 };
  for (const r of rows) {
    const t = Date.parse(r.at); if (!(t >= days[0].start)) continue;
    const d = days.findLast(x => t >= x.start); if (d) add(d, r);
    add(week, r); add(bySrc[r.src] ||= { runs: 0, cost: 0, out: 0 }, r); add(byModel[r.model] ||= { runs: 0, cost: 0, out: 0 }, r);
    if (t >= day0.getTime()) { add(today, r); if (!r.ok) today.failed++; }
    if (t >= Date.now() - 5 * 3600e3) { hour5.runs++; hour5.cost += r.cost; }
  }
  return { today, week, hour5, days: days.map(({ start, ...d }) => d), bySrc, byModel, rate: readJson<any>(RATE, null), since: rows[0]?.at || null };
}
