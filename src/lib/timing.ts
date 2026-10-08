// Latency spans for chat, voice and agent runs. Numbers and labels only: never message text, prompts or replies.
// data/timing.jsonl keeps the newest 4000 rows. GET /api/timing reports median and slow case (p90), cold vs warm,
// with first-useful-answer latency kept apart from total task time.
import fs from "node:fs";
import path from "node:path";
import { DATA, appendLine } from "./store.ts";

const FILE = path.join(DATA, "timing.jsonl");
const KEEP = 4000;

/** One measured request. All *Ms values are offsets from the request's start (t0), except tool/run totals. */
export type Span = {
  at?: string; kind: "chat" | "fast" | "voice" | "run" | "step" | "review";
  route?: string; model?: string; engine?: string; temp?: "cold" | "warm"; ok?: boolean;
  prepMs?: number; spawnMs?: number; firstOutMs?: number; initMs?: number; firstTextMs?: number; spokenMs?: number;
  tools?: number; toolMs?: number; totalMs?: number; contextTokens?: number;
  // voice (from the dashboard)
  turnWaitMs?: number; sendMs?: number; firstAudioMs?: number; cancelMs?: number;
};
const NUM = ["prepMs", "spawnMs", "firstOutMs", "initMs", "firstTextMs", "spokenMs", "tools", "toolMs", "totalMs", "contextTokens", "turnWaitMs", "sendMs", "firstAudioMs", "cancelMs"] as const;
const KINDS = new Set(["chat", "fast", "voice", "run", "step", "review"]);

let writes = 0;
export function record(s: Span): void {
  if (!KINDS.has(s.kind)) return;
  const row: Record<string, unknown> = { at: new Date().toISOString(), kind: s.kind };
  for (const k of ["route", "model", "engine", "temp"] as const) if (typeof s[k] === "string") row[k] = String(s[k]).slice(0, 40);
  if (typeof s.ok === "boolean") row.ok = s.ok;
  for (const k of NUM) { const v = Number(s[k]); if (s[k] != null && Number.isFinite(v) && v >= 0 && v < 36e5 * 6) row[k] = Math.round(v); }
  try { appendLine(FILE, JSON.stringify(row)); } catch { return; }
  if (++writes % 200 === 0) trim();
}
function trim() {
  try { const lines = fs.readFileSync(FILE, "utf8").trim().split("\n"); if (lines.length > KEEP) fs.writeFileSync(FILE, lines.slice(-KEEP).join("\n") + "\n"); } catch {}
}
export function rows(sinceIso?: string): Span[] {
  try {
    return fs.readFileSync(FILE, "utf8").trim().split("\n").map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter((r: any) => r && (!sinceIso || r.at >= sinceIso));
  } catch { return []; }
}
const pct = (a: number[], p: number) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.ceil(s.length * p) - 1))]; };
function stat(list: Span[], key: keyof Span) {
  const v = list.map(r => Number(r[key])).filter(Number.isFinite);
  return v.length ? { n: v.length, median: pct(v, .5), p90: pct(v, .9) } : null;
}
/** Median/p90 per kind and cold/warm. firstUseful = first text the owner can read or hear (fast path: the answer). */
export function summary(sinceIso?: string) {
  const all = rows(sinceIso), out: Record<string, any> = {};
  const groups = new Map<string, Span[]>();
  for (const r of all) { const k = `${r.kind}${r.temp ? ":" + r.temp : ""}`; if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(r); }
  for (const [k, list] of groups) {
    out[k] = { n: list.length, okRate: list.filter(r => r.ok !== false).length / list.length };
    for (const key of ["prepMs", "spawnMs", "firstOutMs", "initMs", "firstTextMs", "spokenMs", "toolMs", "totalMs", "turnWaitMs", "sendMs", "firstAudioMs", "cancelMs", "contextTokens"] as (keyof Span)[]) { const s = stat(list, key); if (s) out[k][key] = s; }
  }
  return { since: sinceIso || null, rows: all.length, groups: out };
}

/** A stopwatch for one request. mark() is idempotent per name (the first time wins). */
export function stopwatch() {
  const t0 = Date.now(), marks: Record<string, number> = {};
  return { t0, mark(name: string) { if (!(name in marks)) marks[name] = Date.now() - t0; return marks[name]; }, get: (name: string) => marks[name], since: () => Date.now() - t0, marks };
}
