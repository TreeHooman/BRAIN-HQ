// Code screen: a live coding session per project, run by Claude Code at build level in the project's
// folders. One session per project, resumed every message (cheap: Claude keeps the context cached).
import path from "node:path";
import fs from "node:fs";
import { DATA, readJson, uid, writeJson } from "./store.ts";
import { loadConfig, minLevel, modelFor } from "./config.ts";
import { killTree, runClaude } from "./claude.ts";
import { opStart, opEnd, activity } from "./orchestrator.ts";
import type { Step } from "./narrate.ts";
import * as brain from "./brain.ts";

type Msg = { role: "you" | "hq"; text: string; at: string; error?: boolean; steps?: Step[]; added?: number; removed?: number; ms?: number };
type Session = { id: string; project: string; sessionId: string | null; messages: Msg[] };

const DIR = path.join(DATA, "code");
// Live code that must never be edited from HQ (agent rules): sessions there are forced to read-only.
const PROTECTED = /LoanCentral-Test/i;
const busy = new Map<string, { pid?: number; cancelled?: boolean; opId: string }>();

const file = (slug: string) => path.join(DIR, `${slug}.json`);
function load(slug: string): Session { return readJson<Session>(file(slug), { id: uid("code"), project: slug, sessionId: null, messages: [] }); }

function access(slug: string) {
  const p = brain.getProject(slug);
  if (!p) throw Object.assign(new Error("Unknown project"), { code: 404 });
  const dirs = (p.paths || []).filter(d => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });
  const ceiling = loadConfig().autonomy?.maxLevel || "build";
  let level = minLevel("build", p.maxPermission, ceiling);
  if ((p.paths || []).some(d => PROTECTED.test(d))) level = "read";
  return { p, dirs, level };
}

export function get(slug: string) {
  const { p, dirs, level } = access(slug);
  const s = load(slug);
  return { project: slug, name: p.name, folders: p.paths || [], found: dirs, level, busy: busy.has(slug), opId: busy.get(slug)?.opId || null, messages: s.messages.slice(-60) };
}

export function reset(slug: string) {
  if (busy.has(slug)) throw new Error("Stop the current task first.");
  const s = load(slug);
  if (s.messages.length) writeJson(path.join(DIR, "archive", `${slug}-${s.id}.json`), s);
  writeJson(file(slug), { id: uid("code"), project: slug, sessionId: null, messages: [] });
}

export function stop(slug: string) { const b = busy.get(slug); if (b) { b.cancelled = true; killTree(b.pid); } }

/** Throws the reasons a message can't start, so the API can answer right away. */
export function check(slug: string, text: string) {
  if (busy.has(slug)) throw new Error("Still working on the last message.");
  if (!String(text || "").trim()) throw new Error("Type what you want done.");
  const { p, dirs } = access(slug);
  if (!dirs.length) throw new Error(`No folder found for ${p.name}. Add its folder under the project's Setup tab.`);
}

export async function send(slug: string, text: string, tier = "balanced"): Promise<void> {
  check(slug, text);
  text = String(text || "").trim().slice(0, 20000);
  const { p, dirs, level } = access(slug);
  const s = load(slug);
  s.messages.push({ role: "you", text, at: new Date().toISOString() });
  writeJson(file(slug), s);
  const cfg = loadConfig();
  const { model, fallback } = modelFor(["fast", "balanced", "deep"].includes(tier) ? tier : "balanced");
  const opId = `code-${slug}-${s.messages.length}`;
  const steps: Step[] = [];
  const onOp = opStart({ id: opId, kind: "code", title: `${p.name}: ${text.length > 60 ? text.slice(0, 59) + "…" : text}`, project: slug, model, level });
  const onStep = (st: Step) => { onOp(st); const i = steps.findIndex(x => x.id === st.id); if (i >= 0) steps[i] = { ...st }; else steps.push({ ...st }); if (steps.length > 120) steps.shift(); };
  busy.set(slug, { opId });
  let ok = false;
  try {
    const res = await runClaude({
      prompt: text, model, fallbackModel: fallback, level, resume: s.sessionId, runId: `code-${slug}`, addDirs: dirs,
      timeoutMs: (cfg.code?.maxMinutes || 20) * 60e3, onStep, onSpawn: pid => { const b = busy.get(slug); if (b) b.pid = pid; },
      system: [
        `You're pair-programming with the owner live in HQ's Code screen on project "${p.name}".`,
        `Project folders: ${dirs.join("; ")}. Work only there; for shell commands, cd into the folder first.`,
        level === "build" ? "You may edit files and run tests/builds. Never commit, push, deploy or touch live services (those are blocked)." : "This project is READ-ONLY here: explain and propose diffs, don't edit.",
        "Keep replies short: what you changed (files), how to try it, anything risky. Use code blocks for snippets.",
      ].join("\n"),
    });
    const b = busy.get(slug);
    ok = res.ok && !b?.cancelled;
    const latest = load(slug);
    if (latest.id !== s.id) return;
    latest.sessionId = res.sessionId || latest.sessionId;
    let reply = res.text || "";
    if (b?.cancelled) reply = (reply ? reply + "\n\n" : "") + "_Stopped._";
    else if (res.kind === "auth" || res.kind === "missing") reply = "I can't reach Claude. Run **scripts\\SIGN-IN-CLAUDE.cmd** once, then try again.";
    else if (res.kind === "limit") reply = `Claude's usage limit is reached${res.resetAt ? ` until about ${new Date(res.resetAt).toLocaleString()}` : ""}.`;
    else if (res.kind === "timeout") reply = (reply ? reply + "\n\n" : "") + "_Stopped at the time limit. Say “continue” to pick up where I left off._";
    const tools = steps.filter(x => x.kind === "tool");
    latest.messages.push({ role: "hq", text: reply, at: new Date().toISOString(), error: !res.ok && !b?.cancelled, ms: res.durationMs,
      steps: tools.slice(-40).map(x => ({ ...x, diff: x.diff?.slice(0, 12) })), added: tools.reduce((a, x) => a + (x.added || 0), 0), removed: tools.reduce((a, x) => a + (x.removed || 0), 0) });
    if (latest.messages.length > 200) latest.messages.splice(0, latest.messages.length - 200);
    writeJson(file(slug), latest);
    activity("code", { project: slug, ok: res.ok, kind: res.kind });
  } finally { busy.delete(slug); opEnd(opId, ok); }
}
