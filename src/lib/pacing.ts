// Usage pacing for long stretches away: spread Claude's weekly allowance over the week and keep a reserve for the
// owner's own conversation. Reads the 5-hour/weekly percentages HQ already records (usage.ts → data/usage-rates.json).
// Code only. Only background work (scheduled missions, initiative picks, follow-ups) is held back; the owner's chat
// and tasks they started are never blocked by pacing (Claude's real limit still applies to them).
import path from "node:path";
import { DATA, readJson } from "./store.ts";
import { loadConfig } from "./config.ts";

const RATES = path.join(DATA, "usage-rates.json"), WEEK = 7 * 864e5, STALE = 6 * 3600e3;

export type Pacing = { enabled: boolean; reserve: number; margin: number; fiveHourMax: number };
export function settings(): Pacing {
  const c = loadConfig().pacing || {};
  const num = (v: unknown, lo: number, hi: number, d: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  return { enabled: c.enabled !== false, reserve: num(c.reservePercent, 0, 50, 15), margin: num(c.aheadMargin, 0, 50, 10), fiveHourMax: num(c.fiveHourMax, 10, 100, 80) };
}

export type Mode = "normal" | "save" | "reserve";
export type View = { mode: Mode; reason: string; weekly: number | null; fiveHour: number | null; expected: number | null; resetsAt: number | null; stale: boolean; settings: Pacing };

/** normal: background work runs as usual. save: Claude is ahead of the week's pace (or the 5-hour window is nearly
 *  used), so background work goes to Codex if it is available, else waits. reserve: the weekly reserve is reached;
 *  background work waits for the reset (or Codex), leaving Claude for the owner. */
export function view(now = Date.now(), rates: Record<string, any> = readJson<Record<string, any>>(RATES, {})): View {
  const s = settings();
  const pct = (r: any) => r && r.utilizationUnit === "percent" && typeof r.utilization === "number" ? r.utilization : r && typeof r.utilization === "number" && r.utilization <= 1 ? r.utilization * 100 : null;
  const w = rates.weekly, f = rates.fiveHour;
  const weekly = pct(w), fiveHour = f && Number(f.resetsAt) > now ? pct(f) : null;
  const resetsAt = Number(w?.resetsAt) || null;
  const stale = !w?.at || now - Date.parse(w.at) > STALE;
  // How much of the week should be used by now if the allowance were spread evenly (the week ends at the reset).
  const expected = resetsAt && resetsAt > now ? Math.max(0, Math.min(100, 100 * (1 - (resetsAt - now) / WEEK))) : null;
  const base = { weekly, fiveHour, expected: expected == null ? null : Math.round(expected), resetsAt, stale, settings: s };
  if (!s.enabled || weekly == null || (resetsAt && resetsAt <= now)) return { mode: "normal", reason: s.enabled ? "no current weekly reading" : "pacing is off", ...base };
  if (weekly >= 100 - s.reserve) return { mode: "reserve", reason: `weekly use ${Math.round(weekly)}%: the last ${s.reserve}% is kept for you`, ...base };
  if (expected != null && weekly > expected + s.margin) return { mode: "save", reason: `weekly use ${Math.round(weekly)}% is ahead of the ${Math.round(expected)}% pace`, ...base };
  if (fiveHour != null && fiveHour >= s.fiveHourMax) return { mode: "save", reason: `5-hour window ${Math.round(fiveHour)}% used`, ...base };
  return { mode: "normal", reason: expected != null ? `weekly use ${Math.round(weekly)}%, pace ${Math.round(expected)}%` : `weekly use ${Math.round(weekly)}%`, ...base };
}
