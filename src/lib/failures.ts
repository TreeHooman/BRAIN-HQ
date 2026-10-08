// Failure classes and what to do about each (code only). Adapted from Alfred's lesson "make failure loud": every
// failed run gets one class, a reason the owner can read, and one policy. Unknown cases never retry silently.
//   transient  network blips, provider 5xx/overload, a stall, a first timeout with no state change → retry with backoff
//   quota      usage limit → wait for the reset (the orchestrator already pauses Claude / falls back to Codex)
//   auth       signed out → wait for sign-in, tell the owner once, never burn retries
//   permanent  missing CLI, refused by a limit, invalid request, agent says it's blocked/not possible → stop, report
//   uncertain  stopped after it had already changed state (files, brain, drafts) → never blind retry: resume and
//              check what's already done first (once), else "needs verification"
import type { RunResult } from "./claude.ts";

export type FailureClass = "transient" | "quota" | "auth" | "permanent" | "uncertain";
export type Failure = { cls: FailureClass; reason: string };
export type RetryPolicy = { maxRetries: number; baseDelayMs: number; maxDelayMs: number };
export const DEFAULT_POLICY: RetryPolicy = { maxRetries: 3, baseDelayMs: 30e3, maxDelayMs: 15 * 60e3 };

const TRANSIENT = /\b(ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|network|overloaded|529|502|503|504|internal server error|api error|temporarily unavailable|try again|connection (?:reset|refused|closed))\b/i;
const PERMANENT = /\b(not found\. install|CLI not found|invalid (?:model|argument|request)|unknown option|permission denied by hq|hard limit|not allowed|refus(?:e|ed) by (?:hq|a limit)|budget reached)\b/i;
const AGENT_BLOCKED = /\*\*Result:?\*\*:?\s*(Blocked|Not possible|Cannot be done)/i;

/** One class per failed result. `writes` = state-changing tool calls the run made before it ended. */
export function classify(res: Pick<RunResult, "ok" | "kind" | "text" | "stalled">, writes = 0): Failure | null {
  if (res.ok && res.kind === "ok") return AGENT_BLOCKED.test(res.text || "") ? { cls: "permanent", reason: "The agent reported it is blocked." } : null;
  const t = String(res.text || "").slice(0, 2000);
  if (res.kind === "limit") return { cls: "quota", reason: "Usage limit reached." };
  if (res.kind === "auth") return { cls: "auth", reason: "Not signed in." };
  if (res.kind === "missing") return { cls: "permanent", reason: "The model CLI is not installed." };
  if (PERMANENT.test(t)) return { cls: "permanent", reason: firstLine(t) || "Refused." };
  if (writes > 0) return { cls: "uncertain", reason: `${res.stalled ? "Stalled" : res.kind === "timeout" ? "Timed out" : "Failed"} after ${writes} change${writes === 1 ? "" : "s"}; the outcome needs checking.` };
  if (res.kind === "timeout") return { cls: "transient", reason: res.stalled ? "Stalled with no output." : "Timed out before changing anything." };
  if (TRANSIENT.test(t) || !t.trim()) return { cls: "transient", reason: firstLine(t) || "Provider error with no message." };
  // An error we don't recognise: retry once (cheap, nothing changed), then treat as permanent.
  return { cls: "transient", reason: firstLine(t) || "Unrecognised error." };
}
const firstLine = (t: string) => t.split(/\r?\n/).map(l => l.trim()).find(Boolean)?.slice(0, 200) || "";

/** Next step for a failure: when to try again (ms from now), or null to stop. attempt = retries already made. */
export function nextRetry(f: Failure, attempt: number, policy: RetryPolicy = DEFAULT_POLICY, unknownError = false): { delayMs: number; resume: boolean } | null {
  if (f.cls === "transient") {
    const max = unknownError ? Math.min(1, policy.maxRetries) : policy.maxRetries;
    if (attempt >= max) return null;
    // Exponential backoff with ±20% jitter so parallel workers don't retry in lockstep.
    const d = Math.min(policy.maxDelayMs, policy.baseDelayMs * 4 ** attempt);
    return { delayMs: Math.round(d * (0.8 + Math.random() * 0.4)), resume: false };
  }
  if (f.cls === "uncertain") return attempt >= 1 ? null : { delayMs: 5e3, resume: true };
  return null; // quota/auth wait elsewhere; permanent stops
}
export const isUnknown = (f: Failure) => f.cls === "transient" && !/stall|timed out|provider error|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket|network|overload|5\d\d|unavailable|try again|connection/i.test(f.reason);

/** Prompt for resuming a run whose outcome is uncertain: check before redoing anything. */
export const RESUME_UNCERTAIN = "You were stopped part-way (crash, restart, stall or time limit) after you had already changed some things. Before doing anything else, check what is already done (files, brain entries, drafts, queued work) and do NOT repeat any completed change or create duplicates. Then finish only what is left, and end with the same report format.";
