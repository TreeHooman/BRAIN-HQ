// Code screen: live coding sessions run by Claude Code at build level in a project's folders.
// Several sessions can run at once (cap: code.maxParallel); each one resumes its own Claude session.
import path from "node:path";
import fs from "node:fs";
import { DATA, readJson, uid, writeJson } from "./store.ts";
import { loadConfig, minLevel, modelFor } from "./config.ts";
import { killTree, runClaude } from "./claude.ts";
import { opStart, opEnd, activity } from "./orchestrator.ts";
import type { Step } from "./narrate.ts";
import * as brain from "./brain.ts";

type Msg = { role: "you" | "hq"; text: string; at: string; error?: boolean; steps?: Step[]; added?: number; removed?: number; ms?: number };
type Session = { id: string; project: string; name?: string; sessionId: string | null; createdAt?: string; updatedAt?: string; messages: Msg[] };

const DIR = path.join(DATA, "code");
const ID = /^[a-z0-9-]{1,60}$/;
// Live code that must never be edited from HQ (agent rules): sessions there are forced to read-only.
const PROTECTED = /LoanCentral-Test/i;
const busy = new Map<string, { pid?: number; cancelled?: boolean; opId: string }>();

// The file name is the session key (older files are named after the project slug).
const file = (key: string) => { if (!ID.test(key)) throw Object.assign(new Error("Bad session id"), { code: 404 }); return path.join(DIR, `${key}.json`); };
function load(key: string): Session {
  const s = readJson<Session | null>(file(key), null);
  if (!s) throw Object.assign(new Error("No such session"), { code: 404 });
  return s;
}
const save = (key: string, s: Session) => { s.updatedAt = new Date().toISOString(); writeJson(file(key), s); };
const maxParallel = () => Math.max(1, Math.min(8, Number(loadConfig().code?.maxParallel) || 4));

function access(slug: string) {
  const p = brain.getProject(slug);
  if (!p) throw Object.assign(new Error("Unknown project"), { code: 404 });
  const dirs = (p.paths || []).filter(d => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });
  const ceiling = loadConfig().autonomy?.maxLevel || "build";
  let level = minLevel("build", p.maxPermission, ceiling);
  if ((p.paths || []).some(d => PROTECTED.test(d))) level = "read";
  return { p, dirs, level };
}

function keys(): string[] {
  try { return fs.readdirSync(DIR).filter(f => f.endsWith(".json")).map(f => f.slice(0, -5)).filter(k => ID.test(k)); } catch { return []; }
}

/** Every open session, newest activity first, with a short preview for the grid. */
export function list() {
  const out = [];
  for (const k of keys()) {
    const s = readJson<Session | null>(path.join(DIR, `${k}.json`), null);
    if (!s?.project) continue;
    const p = brain.getProject(s.project);
    const last = s.messages.at(-1), lastHq = [...s.messages].reverse().find(m => m.role === "hq");
    const lastYou = [...s.messages].reverse().find(m => m.role === "you");
    out.push({
      id: k, project: s.project, projectName: p?.name || s.project, name: s.name || p?.name || s.project,
      busy: busy.has(k), opId: busy.get(k)?.opId || null, messages: s.messages.length,
      task: lastYou?.text.slice(0, 140) || "", reply: (lastHq?.text || "").replace(/[#*_`>]/g, "").trim().slice(0, 220),
      error: !!lastHq?.error, added: lastHq?.added || 0, removed: lastHq?.removed || 0, ms: lastHq?.ms || 0,
      steps: (lastHq?.steps || []).slice(-6).map(x => ({ verb: x.verb, target: x.target, ok: x.ok, result: x.result })),
      updatedAt: s.updatedAt || last?.at || s.createdAt || "",
    });
  }
  return { max: maxParallel(), running: busy.size, sessions: out.sort((a, b) => Number(b.busy) - Number(a.busy) || b.updatedAt.localeCompare(a.updatedAt)) };
}

export function create(slug: string, name?: string) {
  const { p } = access(slug);
  if (keys().length >= 40) throw new Error("Too many open sessions. Close a few first.");
  const n = keys().filter(k => readJson<Session | null>(path.join(DIR, `${k}.json`), null)?.project === slug).length;
  const id = uid("cs-").toLowerCase().replace(/[^a-z0-9-]/g, "");
  const s: Session = { id, project: slug, name: String(name || "").trim().slice(0, 40) || (n ? `${p.name} ${n + 1}` : p.name), sessionId: null, createdAt: new Date().toISOString(), messages: [] };
  save(id, s);
  return { id };
}

export function get(key: string) {
  const s = load(key);
  const { p, dirs, level } = access(s.project);
  const sameProject = [...busy.keys()].filter(k => k !== key && readJson<Session | null>(path.join(DIR, `${k}.json`), null)?.project === s.project).length;
  return { id: key, project: s.project, name: s.name || p.name, folders: p.paths || [], found: dirs, level, busy: busy.has(key), opId: busy.get(key)?.opId || null, sameProject, messages: s.messages.slice(-60) };
}

export function rename(key: string, name: string) {
  const s = load(key); s.name = String(name || "").trim().slice(0, 40) || s.name; save(key, s); return { ok: true };
}

/** Closes a session: its history moves to the archive. */
export function close(key: string) {
  if (busy.has(key)) throw new Error("Stop the current task first.");
  const s = load(key);
  if (s.messages.length) writeJson(path.join(DIR, "archive", `${key}-${Date.now()}.json`), s);
  fs.rmSync(file(key), { force: true });
}

export function stop(key: string) { const b = busy.get(key); if (b) { b.cancelled = true; killTree(b.pid); } }

/** Throws the reasons a message can't start, so the API can answer right away. */
export function check(key: string, text: string) {
  if (busy.has(key)) throw new Error("Still working on the last message.");
  if (!String(text || "").trim()) throw new Error("Type what you want done.");
  if (busy.size >= maxParallel()) throw new Error(`${busy.size} sessions are already running (limit ${maxParallel()}). Wait for one to finish.`);
  const { p, dirs } = access(load(key).project);
  if (!dirs.length) throw new Error(`No folder found for ${p.name}. Add its folder under the project's Setup tab.`);
}

export async function send(key: string, text: string, tier = "balanced", effort: string | null = null): Promise<void> {
  check(key, text);
  text = String(text || "").trim().slice(0, 20000);
  const s = load(key);
  const { p, dirs, level } = access(s.project);
  s.messages.push({ role: "you", text, at: new Date().toISOString() });
  save(key, s);
  const cfg = loadConfig();
  const { model, fallback } = modelFor(["fast", "balanced", "deep"].includes(tier) ? tier : "balanced");
  const opId = `code-${key}-${s.messages.length}`;
  const steps: Step[] = [];
  const name = s.name || p.name;
  const onOp = opStart({ id: opId, kind: "code", title: `${name}: ${text.length > 60 ? text.slice(0, 59) + "…" : text}`, project: s.project, model, level, agent: name });
  const onStep = (st: Step) => { onOp(st); const i = steps.findIndex(x => x.id === st.id); if (i >= 0) steps[i] = { ...st }; else steps.push({ ...st }); if (steps.length > 120) steps.shift(); };
  busy.set(key, { opId });
  let ok = false;
  try {
    const res = await runClaude({
      prompt: text, model, fallbackModel: fallback, effort, level, resume: s.sessionId, runId: `code-${key}`, addDirs: dirs,
      timeoutMs: (cfg.code?.maxMinutes || 20) * 60e3, onStep, onSpawn: pid => { const b = busy.get(key); if (b) b.pid = pid; },
      system: [
        `You're pair-programming with the owner live in HQ's Code screen on project "${p.name}" (session "${name}").`,
        `Project folders: ${dirs.join("; ")}. Work only there; for shell commands, cd into the folder first.`,
        "Other sessions may be editing the same folders at the same time: re-read a file right before you edit it.",
        level === "build" ? "You may edit files and run tests/builds. Never commit, push, deploy or touch live services (those are blocked)." : "This project is READ-ONLY here: explain and propose diffs, don't edit.",
        "Before each group of actions, say in one short line what you're about to do and why (the owner watches it live).",
        "Keep the final reply short: what you changed (files), how to try it, anything risky. Use code blocks for snippets.",
      ].join("\n"),
    });
    const b = busy.get(key);
    ok = res.ok && !b?.cancelled;
    let latest: Session;
    try { latest = load(key); } catch { return; } // closed meanwhile
    if (latest.id !== s.id) return;
    latest.sessionId = res.sessionId || latest.sessionId;
    let reply = res.text || "";
    if (b?.cancelled) reply = (reply ? reply + "\n\n" : "") + "_Stopped._";
    else if (res.kind === "auth" || res.kind === "missing") reply = "I can't reach Claude. Run **scripts\\SIGN-IN-CLAUDE.cmd** once, then try again.";
    else if (res.kind === "limit") reply = `Claude's usage limit is reached${res.resetAt ? ` until about ${new Date(res.resetAt).toLocaleString()}` : ""}.`;
    else if (res.kind === "timeout") reply = (reply ? reply + "\n\n" : "") + "_Stopped at the time limit. Say “continue” to pick up where I left off._";
    const kept = steps.filter(x => x.kind === "tool" || x.kind === "text");
    const tools = steps.filter(x => x.kind === "tool");
    latest.messages.push({ role: "hq", text: reply, at: new Date().toISOString(), error: !res.ok && !b?.cancelled, ms: res.durationMs,
      steps: kept.slice(-50).map(x => ({ ...x, diff: x.diff?.slice(0, 12) })), added: tools.reduce((a, x) => a + (x.added || 0), 0), removed: tools.reduce((a, x) => a + (x.removed || 0), 0) });
    if (latest.messages.length > 200) latest.messages.splice(0, latest.messages.length - 200);
    save(key, latest);
    activity("code", { session: key, project: s.project, ok: res.ok, kind: res.kind });
  } finally { busy.delete(key); opEnd(opId, ok); }
}
