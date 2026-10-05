// The orchestrator: event loop that owns missions, the queue, budgets, usage-limit pauses,
// approvals, follow-up handoffs, reminders and keep-awake. It spends zero tokens while idle.
import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { DATA, DROP, appendLine, fingerprint, localDate, readJson, uid, writeJson } from "./store.ts";
import { budget, loadConfig, minLevel, modelFor, type Level } from "./config.ts";
import { findClaude, killTree, runClaude, type RunResult } from "./claude.ts";
import type { Step } from "./narrate.ts";
import { isDue, type Schedule } from "./schedule.ts";
import { notify } from "./notify.ts";
import * as brain from "./brain.ts";

export type Mission = {
  id: string; title: string; prompt: string; project?: string | null;
  tier: string; permission: string; schedule?: Schedule | null; maxMinutes?: number;
  enabled: boolean; skipIfUnchanged?: boolean; watch?: string[]; priority?: number; createdAt?: string;
};
export type Run = {
  id: string; missionId: string | null; title: string; prompt: string; project?: string | null;
  tier: string; permission: string; level?: Level; trigger: string; priority: number;
  status: "queued" | "running" | "done" | "failed" | "paused" | "skipped" | "timeout" | "cancelled";
  createdAt: string; startedAt?: string; endedAt?: string; sessionId?: string | null;
  output?: string; error?: string; model?: string; durationMs?: number; maxMinutes?: number;
  extraAllow?: string[]; parentRun?: string | null; depth: number; followups?: number;
  watch?: string[]; skipIfUnchanged?: boolean;
};
export type Approval = {
  id: string; createdAt: string; title: string; detail: string; project?: string | null;
  fromRun?: string | null; status: "pending" | "approved" | "rejected";
  proposed?: { title: string; prompt: string; project?: string | null; tier?: string; permission?: string; extraAllow?: string[] } | null;
};
type State = {
  pausedUntil: string | null; pauseReason?: string; auth: "ok" | "needs-login" | "unknown"; authCheckedAt?: string;
  lastRun: Record<string, string>; sig: Record<string, string>; day: { date: string; runs: number };
  notified: Record<string, string>;
};

const F = {
  missions: path.join(DATA, "missions.json"),
  state: path.join(DATA, "state.json"),
  approvals: path.join(DATA, "approvals.json"),
  activity: path.join(DATA, "activity.jsonl"),
  runs: path.join(DATA, "runs"),
  chat: path.join(DATA, "chat", "current.json"),
  chatArchive: path.join(DATA, "chat", "archive"),
};
const MAX_DEPTH = 3;
const KEEP_RUNS = 300;

// ---------------- persistence ----------------
export function missions(): Mission[] { return readJson<Mission[]>(F.missions, []); }
function saveMissions(m: Mission[]) { writeJson(F.missions, m); }
function state(): State {
  return { pausedUntil: null, auth: "unknown", lastRun: {}, sig: {}, day: { date: localDate(), runs: 0 }, notified: {}, ...readJson<Partial<State>>(F.state, {}) } as State;
}
function saveState(s: State) { writeJson(F.state, s); }
function patchState(fn: (s: State) => void) { const s = state(); fn(s); saveState(s); }

const runCache = new Map<string, Run>();
function loadRuns() {
  fs.mkdirSync(F.runs, { recursive: true });
  for (const f of fs.readdirSync(F.runs).filter(f => f.endsWith(".json"))) {
    const r = readJson<Run | null>(path.join(F.runs, f), null);
    if (r) runCache.set(r.id, r);
  }
}
function saveRun(r: Run) { runCache.set(r.id, r); writeJson(path.join(F.runs, `${r.id}.json`), r); }
export function runs(limit = 60): Run[] {
  return [...runCache.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}
export function getRun(id: string): Run | undefined { return runCache.get(id); }
function pruneRuns() {
  const all = [...runCache.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const r of all.slice(KEEP_RUNS)) {
    if (r.status === "queued" || r.status === "running" || r.status === "paused") continue;
    runCache.delete(r.id);
    const src = path.join(F.runs, `${r.id}.json`), dst = path.join(F.runs, "archive", `${r.id}.json`);
    try { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.renameSync(src, dst); } catch {}
  }
}

export function approvals(): Approval[] { return readJson<Approval[]>(F.approvals, []); }
function saveApprovals(a: Approval[]) { writeJson(F.approvals, a); }

export function activity(event: string, detail: Record<string, unknown> = {}) {
  appendLine(F.activity, JSON.stringify({ at: new Date().toISOString(), event, ...detail }));
}
export function recentActivity(n = 40): any[] {
  try {
    const lines = fs.readFileSync(F.activity, "utf8").trim().split("\n");
    if (lines.length > 5000) fs.writeFileSync(F.activity, lines.slice(-2000).join("\n") + "\n");
    return lines.slice(-n).reverse().map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

// ---------------- missions API ----------------
export function saveMission(input: Partial<Mission>): Mission {
  const all = missions();
  const i = input.id ? all.findIndex(m => m.id === input.id) : -1;
  const base: Mission = i >= 0 ? all[i] : { id: uid("ms"), title: "", prompt: "", tier: "balanced", permission: "plan", enabled: true, createdAt: new Date().toISOString() };
  const m: Mission = { ...base, ...input, id: base.id };
  if (!m.title?.trim() || !m.prompt?.trim()) throw new Error("A mission needs a title and instructions.");
  if (m.project && !brain.getProject(m.project)) throw new Error(`Unknown project ${m.project}`);
  if (i >= 0) all[i] = m; else all.push(m);
  saveMissions(all);
  return m;
}
export function deleteMission(id: string) { saveMissions(missions().filter(m => m.id !== id)); }

export function enqueue(spec: Partial<Run> & { title: string; prompt: string }, trigger: string): Run {
  const r: Run = {
    id: uid("run"), missionId: spec.missionId ?? null, title: spec.title, prompt: spec.prompt, project: spec.project ?? null,
    tier: spec.tier || "balanced", permission: spec.permission || "plan", trigger, priority: spec.priority ?? 2,
    status: "queued", createdAt: new Date().toISOString(), maxMinutes: spec.maxMinutes, extraAllow: spec.extraAllow,
    parentRun: spec.parentRun ?? null, depth: spec.depth ?? 0, watch: spec.watch, skipIfUnchanged: spec.skipIfUnchanged,
  };
  saveRun(r);
  activity("queued", { run: r.id, title: r.title, trigger });
  kick();
  return r;
}
export function runMissionNow(id: string): Run {
  const m = missions().find(x => x.id === id);
  if (!m) throw new Error("No such mission");
  return enqueue({ ...fromMission(m), priority: 1, skipIfUnchanged: false }, "manual");
}
function fromMission(m: Mission): Partial<Run> & { title: string; prompt: string } {
  return { missionId: m.id, title: m.title, prompt: m.prompt, project: m.project, tier: m.tier, permission: m.permission, maxMinutes: m.maxMinutes, priority: m.priority ?? 2, watch: m.watch, skipIfUnchanged: m.skipIfUnchanged };
}
export function cancelRun(id: string) {
  const r = runCache.get(id);
  if (!r) return;
  if (r.status === "running" && current?.run.id === id) { killTree(current.pid); current.cancelled = true; return; }
  if (r.status === "queued" || r.status === "paused") { r.status = "cancelled"; r.endedAt = new Date().toISOString(); saveRun(r); }
}

export function decideApproval(id: string, approve: boolean): Approval {
  const all = approvals(); const a = all.find(x => x.id === id);
  if (!a) throw new Error("No such approval");
  if (a.status !== "pending") return a;
  a.status = approve ? "approved" : "rejected";
  saveApprovals(all);
  activity(approve ? "approved" : "rejected", { approval: id, title: a.title });
  if (approve && a.proposed) {
    enqueue({ title: a.proposed.title, prompt: `${a.proposed.prompt}\n\n(The owner approved this in HQ: "${a.title}".)`, project: a.proposed.project, tier: a.proposed.tier || "balanced",
      permission: minLevel(a.proposed.permission || "plan", "build"), extraAllow: a.proposed.extraAllow, parentRun: a.fromRun, priority: 1 }, "approval");
  }
  return a;
}

// ---------------- status ----------------
let current: { run: Run; pid?: number; cancelled?: boolean } | null = null;
let chatBusy = false;
export function status() {
  const s = state(); const b = budget();
  const queued = [...runCache.values()].filter(r => r.status === "queued").length;
  return {
    pausedUntil: s.pausedUntil, pauseReason: s.pauseReason, auth: s.auth, claudeBin: findClaude(),
    running: current ? { id: current.run.id, title: current.run.title, startedAt: current.run.startedAt } : null,
    chatBusy, queued, today: s.day.date === localDate() ? s.day.runs : 0, maxRunsPerDay: b.maxRunsPerDay, budget: b.preset,
    pendingApprovals: approvals().filter(a => a.status === "pending").length,
  };
}

// ---------------- live operations (in memory, for the dashboard's ops feed) ----------------
export type Op = {
  id: string; kind: "chat" | "mission"; title: string; project?: string | null; model: string; level?: string;
  startedAt: number; endedAt?: number; status: "running" | "done" | "failed";
  steps: Step[]; calls: number; added: number; removed: number;
};
const ops = new Map<string, Op>();
const OP_KEEP_MS = 25_000; // finished tiles linger briefly so the UI can show the result
function opStart(o: Omit<Op, "startedAt" | "status" | "steps" | "calls" | "added" | "removed">): (s: Step) => void {
  ops.set(o.id, { ...o, startedAt: Date.now(), status: "running", steps: [], calls: 0, added: 0, removed: 0 });
  return s => {
    const op = ops.get(o.id); if (!op) return;
    const i = op.steps.findIndex(x => x.id === s.id);
    if (i >= 0) op.steps[i] = { ...s };
    else {
      op.steps.push({ ...s });
      if (s.kind === "tool") { op.calls++; op.added += s.added || 0; op.removed += s.removed || 0; }
      if (op.steps.length > 80) op.steps.splice(0, op.steps.length - 80);
    }
  };
}
function opEnd(id: string, ok: boolean) { const op = ops.get(id); if (op) { op.status = ok ? "done" : "failed"; op.endedAt = Date.now(); } }
export function liveOps() {
  const now = Date.now();
  for (const [k, o] of ops) if (o.endedAt && now - o.endedAt > OP_KEEP_MS) ops.delete(k);
  return { now, ops: [...ops.values()].sort((a, b) => a.startedAt - b.startedAt) };
}

// ---------------- the loop ----------------
let timer: NodeJS.Timeout | null = null;
let ticking = false;
export function start() {
  fs.mkdirSync(DROP, { recursive: true });
  loadRuns();
  // A crash mid-run leaves "running" records; put them back in the queue.
  for (const r of runCache.values()) if (r.status === "running") { r.status = "queued"; saveRun(r); }
  brain.regenerateIndex();
  timer = setInterval(() => void tick(), 30_000);
  setTimeout(() => void tick(), 2000);
}
export function stop() { if (timer) clearInterval(timer); setAwake(false); }
let kickTimer: NodeJS.Timeout | null = null;
function kick() { if (!kickTimer) kickTimer = setTimeout(() => { kickTimer = null; void tick(); }, 300); }

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    ingestDrop();
    checkReminders();
    scheduleMissions();
    resumeIfReady();
    manageAwake();
    if (!current) await runNext();
  } catch (e) {
    activity("error", { where: "tick", error: String(e) });
  } finally { ticking = false; }
}

function ingestDrop() {
  let files: string[] = [];
  try { files = fs.readdirSync(DROP).filter(f => f.endsWith(".json")); } catch { return; }
  for (const f of files) {
    const file = path.join(DROP, f);
    const d = readJson<any>(file, null);
    try { fs.unlinkSync(file); } catch {}
    if (!d) continue;
    const parent = d.fromRun ? runCache.get(d.fromRun) : undefined;
    if (d.type === "followup") {
      const b = budget();
      const depth = (parent?.depth ?? 0) + 1;
      if (parent && (parent.followups ?? 0) >= b.maxFollowupsPerRun) { activity("followup-dropped", { reason: "per-run limit", title: d.title }); continue; }
      if (depth > MAX_DEPTH) { activity("followup-dropped", { reason: "chain too deep", title: d.title }); continue; }
      if (parent) { parent.followups = (parent.followups ?? 0) + 1; saveRun(parent); }
      // A follow-up never gets more permission than the run that created it. The chat is the owner
      // speaking directly, so its follow-ups may go up to the autonomy ceiling.
      const ceiling = parent?.level || (String(d.fromRun || "").startsWith("chat-") ? (loadConfig().autonomy?.maxLevel || "build") : "plan");
      enqueue({ title: d.title, prompt: d.prompt, project: d.project, tier: d.tier || "balanced", permission: minLevel(d.permission || "plan", ceiling), parentRun: d.fromRun, depth, priority: 2 }, "followup");
    } else if (d.type === "approval") {
      const all = approvals();
      all.unshift({ id: uid("ap"), createdAt: new Date().toISOString(), title: d.title, detail: d.detail || "", project: d.project, fromRun: d.fromRun, status: "pending", proposed: d.proposed || null });
      saveApprovals(all);
      activity("approval-requested", { title: d.title });
      notify({ title: "HQ needs your OK", body: d.title, priority: 4, tags: "raised_hand" });
    } else if (d.type === "mission") {
      // Recurring missions can only be created from the chat (the owner), never by a background run.
      if (!String(d.fromRun || "").startsWith("chat-")) { activity("mission-dropped", { reason: "only the chat can schedule missions", title: d.title }); continue; }
      try {
        const m = saveMission({ title: d.title, prompt: d.prompt, project: d.project || null, tier: d.tier || "balanced",
          permission: minLevel(d.permission || "plan", loadConfig().autonomy?.maxLevel || "build"), schedule: d.schedule || null, enabled: true, skipIfUnchanged: !!d.skipIfUnchanged });
        activity("mission-created", { mission: m.id, title: m.title });
      } catch (e) { activity("mission-dropped", { reason: String(e), title: d.title }); }
    } else if (d.type === "notify") {
      notify({ title: d.title || "HQ", body: d.body || "", priority: d.priority });
    }
  }
}

function checkReminders() {
  const now = new Date();
  for (const r of brain.listReminders()) {
    if (r.done || r.notifiedAt) continue;
    if (brain.whenToDate(r.due) <= now) {
      notify({ title: `⏰ ${r.title}`, body: r.project ? `Project: ${r.project}` : "Reminder", priority: 4, tags: "alarm_clock" });
      brain.markNotified(r.id);
      activity("reminder", { title: r.title });
    }
  }
}

function scheduleMissions() {
  const now = new Date();
  const s = state();
  let changed = false;
  for (const m of missions()) {
    if (!m.enabled || !m.schedule) continue;
    // A newly added schedule starts from now: it doesn't fire for occurrences before it existed.
    if (!s.lastRun[m.id] && m.schedule.type !== "every" && m.schedule.type !== "once") { s.lastRun[m.id] = now.toISOString(); changed = true; continue; }
    const last = s.lastRun[m.id] ? new Date(s.lastRun[m.id]) : null;
    if (!isDue(m.schedule, now, last)) continue;
    s.lastRun[m.id] = now.toISOString(); changed = true;
    const pending = [...runCache.values()].some(r => r.missionId === m.id && (r.status === "queued" || r.status === "running" || r.status === "paused"));
    if (!pending) enqueue(fromMission(m), "schedule");
  }
  if (changed) saveState(s);
}

function resumeIfReady() {
  const s = state();
  if (!s.pausedUntil || new Date(s.pausedUntil) > new Date()) return;
  patchState(x => { x.pausedUntil = null; x.pauseReason = undefined; });
  let n = 0;
  for (const r of runCache.values()) if (r.status === "paused") { r.status = "queued"; saveRun(r); n++; }
  activity("resumed", { runs: n });
  if (n) notify({ title: "HQ resumed", body: `Usage reset. Continuing ${n} paused mission${n > 1 ? "s" : ""}.`, priority: 2, phone: false });
}

async function runNext() {
  const s = state();
  if (s.pausedUntil && new Date(s.pausedUntil) > new Date()) return;
  // After a sign-in problem, retry at most every 30 minutes.
  if (s.auth === "needs-login" && s.authCheckedAt && Date.now() - new Date(s.authCheckedAt).getTime() < 30 * 60e3) return;
  const queue = [...runCache.values()].filter(r => r.status === "queued").sort((a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt));
  if (!queue.length) return;
  const b = budget();
  const today = localDate();
  const used = s.day.date === today ? s.day.runs : 0;
  const run = queue.find(r => r.trigger === "manual" || r.trigger === "approval") || (used < b.maxRunsPerDay ? queue[0] : undefined);
  if (!run) {
    if (s.notified.cap !== today) {
      patchState(x => { x.notified.cap = today; });
      notify({ title: "HQ daily budget reached", body: `${queue.length} mission(s) wait until tomorrow. Raise the budget in Settings if you want more.`, priority: 2, phone: false });
    }
    return;
  }
  await execute(run);
  kick();
}

function missionPrompt(run: Run, level: Level, minutes: number): string {
  const proj = run.project ? brain.getProject(run.project) : null;
  const levelText = { read: "READ: look and report only. You cannot change files or the brain.", plan: "PLAN: you may update the HQ brain through hq-brain tools. You cannot edit code.", build: "BUILD: you may edit code and run tests inside the project's folders. No pushing, deploying or publishing." }[level];
  return [
    `# HQ mission: ${run.title}`,
    `Run id: ${run.id} · trigger: ${run.trigger}${run.parentRun ? ` · follow-up of ${run.parentRun}` : ""}`,
    `Scope: ${proj ? `project "${proj.slug}" (${proj.name}). Read brain/projects/${proj.slug}/SUMMARY.md first. Folders: ${(proj.paths || []).join("; ") || "none"}` : "HQ-wide. Start with hq_index."}`,
    `Permission: ${levelText}`,
    `Time limit: about ${minutes} minutes. If you can't finish, log progress with project_log and queue_followup the rest.`,
    "",
    "## Task",
    run.prompt.trim(),
    "",
    "## Finish",
    "Patch the brain if facts changed (project_update / project_log / decision_log / reminder_add). End with a 3-6 line summary.",
  ].join("\n");
}

async function execute(run: Run) {
  const cfg = loadConfig();
  const proj = run.project ? brain.getProject(run.project) : null;
  const level = minLevel(run.permission, proj?.maxPermission, cfg.autonomy?.maxLevel || "build");
  const b = budget(cfg);
  const minutes = Math.min(run.maxMinutes || b.maxMinutesPerRun, b.maxMinutesPerRun * 2);

  if (run.skipIfUnchanged && run.missionId && run.trigger === "schedule") {
    const sig = fingerprint(run.watch?.length ? run.watch : ["brain"]);
    if (state().sig[run.missionId] === sig) {
      Object.assign(run, { status: "skipped", endedAt: new Date().toISOString(), output: "Nothing changed since the last run, so it was skipped (no tokens used)." });
      saveRun(run); activity("skipped", { run: run.id, title: run.title });
      return;
    }
  }

  const { model, fallback } = modelFor(run.tier);
  const resuming = !!run.sessionId;
  Object.assign(run, { status: "running", startedAt: new Date().toISOString(), level, model });
  saveRun(run);
  current = { run };
  activity("started", { run: run.id, title: run.title, model, level });
  setAwake(true);
  patchState(s => { const t = localDate(); if (s.day.date !== t) s.day = { date: t, runs: 0 }; if (!resuming) s.day.runs++; });

  const onStep = opStart({ id: run.id, kind: "mission", title: run.title, project: run.project, model, level });
  const res: RunResult = await runClaude({
    prompt: resuming ? "Continue the mission where you left off (you were paused by a usage limit or restart). Then finish as instructed." : missionPrompt(run, level, minutes),
    model, fallbackModel: fallback, level, runId: run.id, resume: run.sessionId || null,
    addDirs: level === "build" || level === "read" || level === "plan" ? (proj?.paths || []) : [],
    extraAllow: run.extraAllow, timeoutMs: minutes * 60e3,
    onSpawn: pid => { if (current) current.pid = pid; }, onStep,
  });
  const cancelled = current?.cancelled;
  current = null;
  opEnd(run.id, res.ok && !cancelled);
  handleResult(run, res, !!cancelled);
}

function handleResult(run: Run, res: RunResult, cancelled: boolean) {
  run.sessionId = res.sessionId || run.sessionId;
  run.durationMs = (run.durationMs || 0) + res.durationMs;
  const now = new Date().toISOString();
  if (cancelled) { Object.assign(run, { status: "cancelled", endedAt: now, output: res.text }); saveRun(run); activity("cancelled", { run: run.id }); return; }
  if (res.kind === "limit") {
    const cfg = loadConfig();
    const until = new Date(res.resetAt || Date.now() + (cfg.usageLimit?.fallbackPauseMinutes || 60) * 60e3);
    Object.assign(run, { status: "paused", error: res.text });
    saveRun(run);
    patchState(s => { s.pausedUntil = until.toISOString(); s.pauseReason = "Claude usage limit"; });
    activity("paused", { run: run.id, until: until.toISOString() });
    notify({ title: "HQ paused: usage limit", body: `Resumes automatically around ${until.toLocaleString()}.`, priority: 3, tags: "hourglass" });
    return;
  }
  if (res.kind === "auth" || res.kind === "missing") {
    Object.assign(run, { status: "queued", error: res.text });
    saveRun(run);
    const first = state().auth !== "needs-login";
    patchState(s => { s.auth = "needs-login"; s.authCheckedAt = now; s.day.runs = Math.max(0, s.day.runs - 1); });
    activity("needs-login", { run: run.id });
    if (first) notify({ title: "HQ can't reach Claude", body: "Run scripts\\SIGN-IN-CLAUDE.cmd once, then missions start automatically.", priority: 4, tags: "warning" });
    return;
  }
  patchState(s => { s.auth = "ok"; s.authCheckedAt = now; });
  if (res.kind === "timeout") {
    Object.assign(run, { status: "timeout", endedAt: now, output: res.text });
  } else if (!res.ok) {
    Object.assign(run, { status: "failed", endedAt: now, error: res.text });
  } else {
    Object.assign(run, { status: "done", endedAt: now, output: res.text });
    if (run.missionId) patchState(s => { s.sig[run.missionId!] = fingerprint(run.watch?.length ? run.watch : ["brain"]); });
  }
  saveRun(run);
  pruneRuns();
  activity(run.status, { run: run.id, title: run.title, minutes: Math.round((run.durationMs || 0) / 6e4) });
  const body = (run.output || run.error || "").replace(/[#*_`]/g, "").trim().slice(0, 300);
  notify({ title: `${run.status === "done" ? "✅" : "⚠️"} ${run.title}`, body: body || run.status, priority: run.status === "done" ? 2 : 3, phone: run.status !== "done" || run.trigger === "schedule" });
}

// ---------------- chat (the dashboard assistant) ----------------
type ChatMsg = { role: "you" | "hq"; text: string; at: string; error?: boolean };
type Chat = { id: string; sessionId: string | null; project?: string | null; tier?: string; messages: ChatMsg[] };
export function chat(): Chat & { busy: boolean } {
  return { ...readJson<Chat>(F.chat, { id: uid("chat"), sessionId: null, messages: [] }), busy: chatBusy };
}
export function newChat() {
  const c = readJson<Chat | null>(F.chat, null);
  if (c?.messages?.length) writeJson(path.join(F.chatArchive, `${c.id}.json`), c);
  writeJson(F.chat, { id: uid("chat"), sessionId: null, messages: [] });
}
export async function sendChat(text: string, opts: { project?: string | null; tier?: string } = {}): Promise<void> {
  if (chatBusy) throw new Error("The assistant is still answering.");
  const s = state();
  const c = readJson<Chat>(F.chat, { id: uid("chat"), sessionId: null, messages: [] });
  c.messages.push({ role: "you", text, at: new Date().toISOString() });
  if (opts.project !== undefined) c.project = opts.project || null;
  writeJson(F.chat, c);
  if (s.pausedUntil && new Date(s.pausedUntil) > new Date()) {
    c.messages.push({ role: "hq", text: `Paused by the Claude usage limit until ${new Date(s.pausedUntil).toLocaleString()}. Your note is saved; ask again after that.`, at: new Date().toISOString(), error: true });
    writeJson(F.chat, c); return;
  }
  const cfg = loadConfig();
  const tier = opts.tier || cfg.chat?.tier || "balanced";
  const { model, fallback } = modelFor(tier);
  const proj = c.project ? brain.getProject(c.project) : null;
  const level = minLevel(cfg.chat?.permission || "plan", cfg.autonomy?.maxLevel || "build");
  chatBusy = true;
  const system = [
    `You are ${cfg.assistant?.name || "JARVIS"}, the owner's AI chief of staff, talking with them in the HQ dashboard (they may be using voice). ${cfg.assistant?.persona || ""}`,
    "Lead with the answer in one or two spoken-friendly sentences; put detail after, in short bullets.",
    "Be brief and concrete. Read brain context only as needed (hq_index first).",
    "Turn loose thoughts into structure: reminders (reminder_add), dates (milestone_add), decisions (decision_log), project facts (project_update/project_log), new projects (project_create), and work to do later (queue_followup: it runs as a background mission).",
    "Say exactly what you changed in the brain. Ask one short question if something is ambiguous.",
    `Today is ${new Date().toDateString()}.`,
    proj ? `The chat is focused on project "${proj.slug}".` : "",
  ].join("\n");
  const opId = `chat-${c.id}-${c.messages.length}`;
  let opOk = false;
  try {
    const onStep = opStart({ id: opId, kind: "chat", title: text.length > 70 ? text.slice(0, 69) + "…" : text, project: c.project, model, level });
    const res = await runClaude({ prompt: text, model, fallbackModel: fallback, level, resume: c.sessionId, system, runId: `chat-${c.id}`,
      timeoutMs: (cfg.chat?.maxMinutes || 6) * 60e3, addDirs: proj?.paths || [], onStep });
    opOk = res.ok;
    const latest = readJson<Chat>(F.chat, c);
    if (latest.id !== c.id) return; // user started a new chat meanwhile
    latest.sessionId = res.sessionId || latest.sessionId;
    let reply = res.text;
    if (res.kind === "auth" || res.kind === "missing") reply = "I can't reach Claude yet. Run **scripts\\SIGN-IN-CLAUDE.cmd** once (it opens Claude so you can sign in), then try again.";
    if (res.kind === "limit") reply = `Claude's usage limit is reached${res.resetAt ? ` until about ${new Date(res.resetAt).toLocaleString()}` : ""}. Background missions will pause and resume on their own.`;
    if (res.kind === "timeout") reply = (res.text ? res.text + "\n\n" : "") + "_Stopped at the chat time limit. For big jobs, ask me to queue a mission._";
    latest.messages.push({ role: "hq", text: reply, at: new Date().toISOString(), error: !res.ok });
    writeJson(F.chat, latest);
    if (res.ok) patchState(st => { st.auth = "ok"; });
    if (res.kind === "auth") patchState(st => { st.auth = "needs-login"; st.authCheckedAt = new Date().toISOString(); });
    activity("chat", { ok: res.ok, kind: res.kind });
  } finally { chatBusy = false; opEnd(opId, opOk); kick(); }
}

/** Retry now after the user signs in. */
export function clearAuth() { patchState(s => { s.auth = "unknown"; s.authCheckedAt = undefined; }); findClaude(true); kick(); }
export function clearPause() { patchState(s => { s.pausedUntil = new Date(0).toISOString(); }); kick(); }

// ---------------- keep-awake ----------------
let awake: ChildProcess | null = null;
function manageAwake() {
  const mode = loadConfig().keepAwake || "busy";
  const busy = !!current || [...runCache.values()].some(r => r.status === "queued" || r.status === "paused");
  setAwake(mode === "always" || (mode === "busy" && busy));
}
function setAwake(on: boolean) {
  if (process.platform !== "win32") return;
  if (on && !awake) {
    const ps = `Add-Type -Name P -Namespace W -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);'; [W.P]::SetThreadExecutionState([uint32]"0x80000001") | Out-Null; while ($true) { Start-Sleep -Seconds 300 }`;
    awake = spawn("powershell.exe", ["-NoProfile", "-WindowStyle", "Hidden", "-Command", ps], { windowsHide: true, stdio: "ignore" });
    awake.on("exit", () => { awake = null; });
  } else if (!on && awake) {
    killTree(awake.pid); awake = null;
  }
}
export function awakeOn() { return !!awake; }

