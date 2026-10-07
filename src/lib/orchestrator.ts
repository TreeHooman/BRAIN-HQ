// The orchestrator: event loop that owns missions, the queue, budgets, usage-limit pauses,
// approvals, follow-up handoffs, reminders and keep-awake. It spends zero tokens while idle.
import fs from "node:fs";
import {isStopped,setStopped,checkStopped} from './stop-control.ts';
import { resolveModel, validateChoice, explicitModel, type ModelChoice } from "./model-policy.ts";
import {sessionContext} from './codex-usage.ts';
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { DATA, DROP, appendLine, fingerprint, localDate, readJson, uid, writeJson } from "./store.ts";
import { budget, loadConfig, minLevel, type Level } from "./config.ts";
import { findClaude, killTree, onRunResult, runClaude, type RunResult } from "./claude.ts";
import { findCodex, runCodex, codexAvailability } from "./codex.ts";
import * as preferences from "./preferences.ts";
import { recordHistory } from "./history.ts";
import { redact, type Step } from "./narrate.ts";
import { isDue, type Schedule } from "./schedule.ts";
import { notify } from "./notify.ts";
import * as brain from "./brain.ts";
import * as handoff from "./handoff.ts";
import * as transcripts from "./transcripts.ts";
import * as outbox from "./outbox.ts";
import { autoCleanChats, retiredSessions } from "./chat-memory.ts";

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
  output?: string; error?: string; model?: string; provider?: "claude" | "codex"; durationMs?: number; maxMinutes?: number;
  extraAllow?: string[]; parentRun?: string | null; depth: number; followups?: number;
  watch?: string[]; skipIfUnchanged?: boolean;
  taskId?: string | null; reply?: boolean; reportedAt?: string; effort?: string | null; dismissed?: boolean; ownerDone?: boolean;
};
export type Approval = {
  id: string; createdAt: string; title: string; detail: string; project?: string | null;
  fromRun?: string | null; status: "pending" | "approved" | "rejected";
  proposed?: { title: string; prompt: string; project?: string | null; tier?: string; permission?: string; extraAllow?: string[]; provider?: "claude" | "codex"; task?: boolean } | null;
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
  screen: path.join(DATA, "screen-cmd.json"),
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
    taskId: spec.taskId ?? null, reply: spec.reply, sessionId: spec.sessionId ?? null, effort: spec.effort ?? null, provider: spec.provider,
  };
  if (r.taskId === "self") r.taskId = r.id;
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
  const a = active.get(id);
  if (r.status === "running" && a) { killTree(a.pid); a.cancelled = true; return; }
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
      permission: minLevel(a.proposed.permission || "plan", "build"), extraAllow: a.proposed.extraAllow, provider: a.proposed.provider, parentRun: a.proposed.task ? null : a.fromRun, priority: 1, ...(a.proposed.task ? { taskId: "self", depth: 0 } : {}) }, a.proposed.task ? "task" : "approval");
  }
  return a;
}

// ---------------- status ----------------
type Slot = { run: Run; pid?: number; cancelled?: boolean };
const active = new Map<string, Slot>();
const ownerRun = (r: Run) => !!r.taskId || r.trigger === "manual" || r.trigger === "approval";
const maxTasks = () => Math.max(1, Math.min(6, Number(loadConfig().tasks?.maxParallel) || 3));
const codexModelFor = (tier: string): string => tier === "fast" ? "gpt-6-luna" : "gpt-6.1-sol";
let chatBusy = false;
let chatControl: {pid?:number;cancelled:boolean}|null=null;
export function forceStop(){
  setStopped(true);
  if(chatControl){chatControl.cancelled=true;killTree(chatControl.pid);}
  for(const run of runCache.values())if(OPEN.has(run.status))cancelRun(run.id);
  const work=readJson<Record<string,any>>(GOAL_WORK,{});for(const goal of Object.values(work))goal.active=false;writeJson(GOAL_WORK,work);
  ingestDrop();activity('owner-force-stop');return {stopped:true};
}
export function resumeWork(){if(chatBusy||active.size)throw new Error('LUTHUR is still stopping. Wait a moment, then resume.');setStopped(false);kick();return {stopped:false};}
let chatPartial = "";
export function status() {
  const s = state(); const b = budget();
  const queued = [...runCache.values()].filter(r => r.status === "queued").length;
  return {
    pausedUntil: s.pausedUntil, pauseReason: s.pauseReason, auth: s.auth, claudeBin: findClaude(), codexBin: findCodex(),codexStatus:codexAvailability(),
    backupActive: !!(s.pausedUntil && Date.parse(s.pausedUntil) > Date.now() && findCodex()),
    running: (r => r ? { id: r.id, title: r.title, startedAt: r.startedAt } : null)([...active.values()][0]?.run),
    active: [...active.values()].map(({ run: r }) => ({ id: r.id, title: r.title, startedAt: r.startedAt, taskId: r.taskId || null, project: r.project })), maxParallel: maxTasks() + 1,
    stopped:isStopped(),chatBusy, queued, today: s.day.date === localDate() ? s.day.runs : 0, maxRunsPerDay: b.maxRunsPerDay, budget: b.preset,
    pendingApprovals: approvals().filter(a => a.status === "pending").length,
  };
}

// ---------------- live operations (in memory, for the dashboard's ops feed) ----------------
export type Op = {
  id: string; kind: "chat" | "mission" | "code"; title: string; project?: string | null; model: string; level?: string;
  agent?: string; task?: string | null; parent?: string | null;
  startedAt: number; endedAt?: number; status: "running" | "done" | "failed" | "cancelled";
  steps: Step[]; calls: number; added: number; removed: number;
};
const ops = new Map<string, Op>();
const OP_KEEP_MS = 25_000; // finished tiles linger briefly so the UI can show the result
export function opStart(o: Omit<Op, "startedAt" | "status" | "steps" | "calls" | "added" | "removed">): (s: Step) => void {
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
export function opEnd(id: string, ok: boolean, cancelled=false) { const op = ops.get(id); if (op) { op.status = cancelled ? "cancelled" : ok ? "done" : "failed"; op.endedAt = Date.now(); } }
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
  if (state().auth !== "ok") setTimeout(() => void checkAuth(), 4000); // don't show "Not checked yet" for long
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
    handoff.refreshIfChanged();
    if(isStopped())return;
    scheduleMissions();
    resumeIfReady();
    advanceGoalWork();
    manageAwake();
    runNext();
    autoCleanChats(!chatBusy && !active.size && !status().queued);
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
    if(isStopped()&&['followup','screen','mission'].includes(d.type))continue;
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
      const fromChat = String(d.fromRun || "").startsWith("chat-");
      const perm = minLevel(d.permission || "plan", ceiling);
      // Claude leads; it may hand a follow-up to Codex, which runs with the same permission.
      const engine = d.engine === "codex" || d.engine === "claude" ? d.engine as "claude" | "codex" : undefined;
      // New work LUTHUR starts on its own (a Task from the chat, or a follow-up from a scheduled mission) waits for the
      // owner's OK unless they turned that off or explicitly said "just do it" in the chat. Sub-agents of a task that was
      // already approved run straight away (they're part of that task).
      const needsOk = loadConfig().assistant?.taskApproval !== false && !parent?.taskId && !(fromChat && d.owner_approved === true);
      if (needsOk) {
        const all = approvals();
        all.unshift({ id: uid("ap"), createdAt: new Date().toISOString(), title: `Start task: ${String(d.title || "").slice(0, 120)}`, detail: String(d.prompt || "").slice(0, 2000), project: d.project, fromRun: d.fromRun, status: "pending",
          proposed: { title: d.title, prompt: d.prompt, project: d.project, tier: d.tier || "balanced", permission: perm, provider: engine, task: fromChat } });
        saveApprovals(all);
        activity("approval-requested", { title: d.title });
        notify({ title: "LUTHUR wants to start a task", body: String(d.title || ""), priority: 3, tags: "raised_hand" });
        continue;
      }
      // From the chat, delegated work becomes a Task (reports back); from a task, it's a sub-agent of that task.
      enqueue({ title: d.title, prompt: d.prompt, project: d.project, tier: d.tier || "balanced", permission: minLevel(d.permission || "plan", ceiling), parentRun: fromChat ? null : d.fromRun, depth: fromChat ? 0 : depth,
        priority: fromChat || parent?.taskId ? 1 : 2, taskId: fromChat ? "self" : parent?.taskId || null, effort: parent?.effort || null, provider: engine }, fromChat ? "task" : "followup");
    } else if (d.type === "approval") {
      const all = approvals();
      all.unshift({ id: uid("ap"), createdAt: new Date().toISOString(), title: d.title, detail: d.detail || "", project: d.project, fromRun: d.fromRun, status: "pending", proposed: d.proposed || null });
      saveApprovals(all);
      activity("approval-requested", { title: d.title });
      notify({ title: "HQ needs your OK", body: d.title, priority: 4, tags: "raised_hand" });
    } else if (d.type === "screen") {
      // Only the chat (the owner's live conversation) may drive their screen.
      if (!String(d.fromRun || "").startsWith("chat-")) continue;
      const k = String(d.kind || ""); if (!["url", "email", "file", "search", "project", "calendar", "inbox"].includes(k)) continue;
      writeJson(F.screen, { id: uid("scr"), at: Date.now(), kind: k, url: d.url, acct: d.acct, id2: d.id, query: d.query, slug: d.slug, read_aloud: !!d.read_aloud, summarize: !!d.summarize });
    } else if (d.type === "mission") {
      // Recurring missions can only be created from the chat (the owner), never by a background run.
      if (!String(d.fromRun || "").startsWith("chat-")) { activity("mission-dropped", { reason: "only the chat can schedule missions", title: d.title }); continue; }
      try {
        const m = saveMission({ title: d.title, prompt: d.prompt, project: d.project || null, tier: d.tier || "balanced",
          permission: minLevel(d.permission || "plan", loadConfig().autonomy?.maxLevel || "build"), schedule: d.schedule || null, enabled: true, skipIfUnchanged: !!d.skipIfUnchanged });
        activity("mission-created", { mission: m.id, title: m.title });
      } catch (e) { activity("mission-dropped", { reason: String(e), title: d.title }); }
    } else if (d.type === "outbox") {
      try { outbox.add(String(d.kind), d.payload, String(d.fromRun || "jarvis"), { project: d.project, note: d.note }); }
      catch (e) { activity("outbox-dropped", { reason: String(e) }); }
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

/** Starts queued runs while slots are free: one background lane, plus up to tasks.maxParallel owner runs
 *  (tasks, manual runs, approvals). Two runs never work on the same project at once. */
function runNext() {
  const s = state();
  if (s.pausedUntil && new Date(s.pausedUntil) > new Date() && !findCodex()) return;
  // After a sign-in problem, retry at most every 30 minutes.
  if (s.auth === "needs-login" && s.authCheckedAt && Date.now() - new Date(s.authCheckedAt).getTime() < 30 * 60e3 && !findCodex()) return;
  const queue = [...runCache.values()].filter(r => r.status === "queued").sort((a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt));
  if (!queue.length) return;
  const b = budget();
  const today = localDate();
  let capped = 0;
  for (const run of queue) {
    if (s.pausedUntil && Date.parse(s.pausedUntil) > Date.now() && (run.provider === "claude" || (run.sessionId && run.provider !== "codex") || run.extraAllow?.length)) continue;
    const running = [...active.values()].map(x => x.run);
    if (run.project && running.some(r => r.project === run.project)) continue;
    const owner = ownerRun(run);
    if (owner ? running.filter(ownerRun).length >= maxTasks() : running.some(r => !ownerRun(r))) continue;
    const st = state();
    if (!owner && (st.day.date === today ? st.day.runs : 0) >= b.maxRunsPerDay) { capped++; continue; }
    void execute(run).catch(e => {
      activity("error", { where: "execute", run: run.id, error: String(e) });
      Object.assign(run, { status: "failed", endedAt: new Date().toISOString(), error: String(e) }); saveRun(run); opEnd(run.id, false);
      if (run.taskId) taskCheck(run);
    }).finally(kick);
  }
  if (capped && s.notified.cap !== today) {
    patchState(x => { x.notified.cap = today; });
    notify({ title: "HQ daily budget reached", body: `${capped} mission(s) wait until tomorrow. Raise the budget in Settings if you want more.`, priority: 2, phone: false });
  }
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
    ...(run.taskId ? [
      "## This is a delegated task",
      "The owner gave you this task from HQ's Tasks screen and is watching it live. Before each group of actions, say in one short line what you're doing and why.",
      run.depth ? `You are a sub-agent of task ${run.taskId}. Do only your part.` : "If it splits into independent parts, hand each one to a sub-agent with queue_followup (they run in parallel and report into this task). Do the rest yourself.",
      "",
    ] : []),
    "## Finish",
    "Patch the brain if facts changed (project_update / project_log / decision_log / reminder_add).",
    run.taskId ? "End with a short report for the owner: **Result** (1-2 lines), **What I did** (bullets), **Needs you** (approvals, outbox drafts, decisions; or \"Nothing\")." : "End with a 3-6 line summary.",
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

  const claudeModel = run.permission === "build" || run.tier !== "fast" ? "sonnet" : "haiku";
  const fallback = undefined;
  const blocked = state().pausedUntil && Date.parse(state().pausedUntil!) > Date.now();
  const provider = run.provider || (run.sessionId || run.extraAllow?.length ? "claude" : blocked && findCodex() ? "codex" : "claude");
  const model = provider === "codex" ? codexModelFor(run.tier) : claudeModel;
  const resuming = !!run.sessionId;
  const reply = run.reply && !run.startedAt;
  Object.assign(run, { status: "running", startedAt: new Date().toISOString(), level, model, provider });
  saveRun(run);
  const slot: Slot = { run };
  active.set(run.id, slot);
  activity("started", { run: run.id, title: run.title, model, level });
  setAwake(true);
  patchState(s => { const t = localDate(); if (s.day.date !== t) s.day = { date: t, runs: 0 }; if (!resuming || reply) s.day.runs++; });

  const onStep = opStart({ id: run.id, kind: "mission", title: run.title, project: run.project, model, level, task: run.taskId || null, parent: run.parentRun || null });
  let res: RunResult;
  try {
  const options = {
    prompt: reply ? `The owner replied on this task:\n\n${run.prompt.trim()}\n\nAct on it within your permission (${level}), then end with the same short report format.`
      : resuming ? "Continue the mission where you left off (you were paused by a usage limit or restart). Then finish as instructed." : missionPrompt(run, level, minutes),
    model, fallbackModel: fallback, effort: run.effort, level, runId: run.id, resume: run.sessionId?.replace(/^codex:/, "") || null,
    system: preferences.context(run.project || undefined),
    history: { title: run.title, ask: reply ? run.prompt : run.prompt.slice(0, 2000), project: run.project || null, kind: "Mission" },
    addDirs: level === "build" || level === "read" || level === "plan" ? (proj?.paths || []) : [],
    extraAllow: run.extraAllow, timeoutMs: minutes * 60e3,
    onSpawn: pid => { slot.pid = pid;if(slot.cancelled)killTree(pid); }, onStep,
  };
  res = provider === "codex" ? await runCodex(options) : await runClaude(options);
  if (provider === "codex") recordHistory(res, options, "codex");
  } finally { active.delete(run.id); }
  const cancelled = slot.cancelled;
  opEnd(run.id, res.ok && !cancelled,!!cancelled);
  handleResult(run, res, !!cancelled);
}

function handleResult(run: Run, res: RunResult, cancelled: boolean) {
  run.sessionId = res.sessionId ? (run.provider === "codex" ? `codex:${res.sessionId}` : res.sessionId) : run.sessionId;
  run.durationMs = (run.durationMs || 0) + res.durationMs;
  const now = new Date().toISOString();
  if (cancelled) { Object.assign(run, { status: "cancelled", endedAt: now, output: res.text }); saveRun(run); activity("cancelled", { run: run.id }); taskCheck(run); return; }
  if (res.kind === "limit") {
    if (run.provider === "codex") {
      Object.assign(run, { status: "failed", endedAt: now, error: "Codex usage limit reached. " + res.text });
      saveRun(run); activity("codex-limit", { run: run.id }); if (run.taskId) taskCheck(run);
      notify({ title: "HQ backup limit reached", body: run.title, priority: 3 });
      return;
    }
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
    if (run.provider === "codex") {
      Object.assign(run, { status: "failed", endedAt: now, error: `Codex backup unavailable: ${res.text}` });
      saveRun(run); activity("codex-unavailable", { run: run.id }); if (run.taskId) taskCheck(run);
      notify({ title: "HQ backup unavailable", body: run.title, priority: 3 });
      return;
    }
    Object.assign(run, { status: "queued", error: res.text });
    saveRun(run);
    const first = state().auth !== "needs-login";
    patchState(s => { s.auth = "needs-login"; s.authCheckedAt = now; s.day.runs = Math.max(0, s.day.runs - 1); });
    activity("needs-login", { run: run.id });
    if (first) notify({ title: "HQ can't reach Claude", body: "Run scripts\\SIGN-IN-CLAUDE.cmd once, then missions start automatically.", priority: 4, tags: "warning" });
    return;
  }
  if (run.provider === "claude") patchState(s => { s.auth = "ok"; s.authCheckedAt = now; });
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
  if (run.taskId) { taskCheck(run); return; }
  notify({ title: `${run.status === "done" ? "✅" : "⚠️"} ${run.title}`, body: body || run.status, priority: run.status === "done" ? 2 : 3, phone: run.status !== "done" || run.trigger === "schedule" });
}

// ---------------- tasks (owner-delegated work, may fan out into parallel sub-agents) ----------------
const OPEN = new Set(["queued", "running", "paused"]);
const taskRuns = (taskId: string) => [...runCache.values()].filter(r => r.taskId === taskId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
function taskStatus(rs: Run[]): string {
  if (rs.some(r => r.status === "running")) return "running";
  if (rs.some(r => r.status === "paused")) return "paused";
  if (rs.some(r => r.status === "queued")) return "queued";
  const root = rs[0];
  if (rs.every(r => r.status === "cancelled")) return "cancelled";
  return rs.some(r => r.status === "failed" || r.status === "timeout") || root?.status !== "done" ? "issue" : "done";
}
/** When the last run of a task finishes, report back once (phone + desktop). */
function taskCheck(run: Run) {
  const rs = taskRuns(run.taskId!); const root = rs.find(r => r.id === run.taskId);
  if (!root || rs.some(r => OPEN.has(r.status))) return;
  const st = taskStatus(rs);
  const last = [...rs].reverse().find(r => r.output) || root;
  root.reportedAt = new Date().toISOString(); saveRun(root);
  activity("task-" + st, { task: root.id, title: root.title, agents: rs.length });
  if (st === "cancelled") return;
  const body = (last.output || last.error || "").replace(/[#*_`]/g, "").replace(/\s+/g, " ").trim().slice(0, 300);
  notify({ title: `${st === "done" ? "✅ Task done" : "⚠️ Task needs a look"}: ${root.title}`, body: body || st, priority: st === "done" ? 3 : 4, tags: st === "done" ? "white_check_mark" : "warning" });
}
export function createTask(input: { text?: string; project?: string | null; tier?: string; permission?: string; effort?: string }): Run {
  const text = String(input.text || "").trim().slice(0, 8000);
  if (!text) throw new Error("Say what you want done.");
  if (input.project && !brain.getProject(input.project)) throw new Error(`Unknown project ${input.project}`);
  const first = text.split("\n")[0];
  return enqueue({ title: first.length > 80 ? first.slice(0, 79) + "…" : first, prompt: text, project: input.project || null, tier: ["fast", "balanced", "deep"].includes(String(input.tier)) ? input.tier : "balanced",
    permission: minLevel(input.permission || "plan", loadConfig().autonomy?.maxLevel || "build"), priority: 1, taskId: "self", effort: input.effort || null }, "task");
}
export function replyTask(id: string, text: string): Run {
  const rs = taskRuns(id); const root = rs.find(r => r.id === id);
  if (!root) throw Object.assign(new Error("No such task"), { code: 404 });
  if (rs.some(r => OPEN.has(r.status))) throw new Error("The task is still working. Reply when it reports back.");
  text = String(text || "").trim().slice(0, 8000);
  if (!text) throw new Error("Type a reply.");
  const lead = [...rs].reverse().find(r => r.depth === 0 && r.sessionId) || root;
  root.reportedAt = undefined; saveRun(root);
  return enqueue({ title: "↳ " + (text.length > 70 ? text.slice(0, 69) + "…" : text), prompt: text, project: root.project, tier: root.tier, permission: root.permission,
    taskId: id, parentRun: lead.id, depth: 0, sessionId: lead.sessionId || null, reply: !!lead.sessionId, priority: 1, effort: root.effort }, "task");
}
export function cancelTask(id: string) { for (const r of taskRuns(id)) if (OPEN.has(r.status)) cancelRun(r.id); }
export function editTask(id: string, patch: { title?: string; done?: boolean }) {
  const root = runCache.get(id); if (!root || root.taskId !== id || root.dismissed) throw Object.assign(new Error("Task not found"), { code: 404 });
  if (patch.done !== undefined && taskRuns(id).some(r => OPEN.has(r.status))) throw new Error("Stop the working task before marking it complete.");
  if (patch.title !== undefined) { const title = String(patch.title).trim().slice(0, 200); if (!title) throw new Error("A task needs a title."); root.title = title; }
  if (patch.done !== undefined) root.ownerDone = !!patch.done;
  saveRun(root); return { ok: true };
}
export function dismissTask(id: string) {
  const root = runCache.get(id); if (!root || root.taskId !== id) throw Object.assign(new Error("Task not found"), { code: 404 });
  if (taskRuns(id).some(r => OPEN.has(r.status))) throw new Error("Stop the working task before removing it.");
  root.dismissed = true; saveRun(root); return { ok: true };
}
export function tasks(limit = 30) {
  const roots = [...runCache.values()].filter(r => r.taskId && r.taskId === r.id && !r.dismissed).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  return roots.map(root => {
    const rs = taskRuns(root.id);
    return { id: root.id, title: root.title, prompt: root.prompt.slice(0, 2000), project: root.project, createdAt: root.createdAt, status: root.ownerDone && !rs.some(r => OPEN.has(r.status)) ? "done" : taskStatus(rs), reportedAt: root.reportedAt || null,
      runs: rs.map(r => ({ id: r.id, title: r.title, status: r.status, parent: r.parentRun, depth: r.depth, reply: !!r.reply, prompt: r.reply ? r.prompt.slice(0, 600) : undefined, level: r.level || r.permission, model: r.model || r.tier,
        startedAt: r.startedAt, endedAt: r.endedAt, durationMs: r.durationMs, output: r.output?.slice(0, 6000), error: r.error?.slice(0, 800) })) };
  });
}

// Workstreams use the existing task scheduler, budget and permission ceiling. No new engine or API billing.
type GoalWork = { goalId: string; permission: string; tier: string; active: boolean; steps: Record<string, string>; finished?: Record<string, string> };
const GOAL_WORK = path.join(DATA, "goal-work.json");
export function goalWork() { return readJson<GoalWork[]>(GOAL_WORK, []); }
export function startGoalWork(goalId: string, permission = "plan", tier = "balanced") {
  const g = brain.listGoals().find(g => g.id === goalId); if (!g?.steps.length) throw new Error("Add goal steps first.");
  const all = goalWork(); let work = all.find(w => w.goalId === goalId);
  if (!work) { work = { goalId, permission, tier, active: true, steps: {} }; all.push(work); }
  work.permission = minLevel(permission, loadConfig().autonomy?.maxLevel || "build"); work.tier = tier; work.active = true;
  work.finished ||= {};
  for (const [sid, tid] of Object.entries(work.steps)) {
    const rs = taskRuns(tid);
    const reopened = work.finished[sid] === tid && !g.steps.find(s => s.id === sid)?.done;
    if (reopened || (!rs.some(r => OPEN.has(r.status)) && taskStatus(rs) !== "done" && !runCache.get(tid)?.ownerDone)) { delete work.steps[sid]; delete work.finished[sid]; }
  }
  writeJson(GOAL_WORK, all); advanceGoalWork(); return goalWork();
}
export function stopGoalWork(goalId: string) {
  const all = goalWork(), work = all.find(w => w.goalId === goalId);
  if (work) { work.active = false; for (const tid of Object.values(work.steps)) cancelTask(tid); writeJson(GOAL_WORK, all); }
  return all;
}
function advanceGoalWork() {
  const all = goalWork(); if (!all.some(w => w.active)) return;
  let changed = false;
  for (const work of all.filter(w => w.active)) {
    work.finished ||= {};
    let goal = brain.listGoals().find(g => g.id === work.goalId);
    if (!goal) { work.active = false; for (const tid of Object.values(work.steps)) cancelTask(tid); changed = true; continue; }
    for (const [sid, tid] of Object.entries(work.steps)) if (!goal.steps.some(s => s.id === sid)) { cancelTask(tid); delete work.steps[sid]; changed = true; }
    for (const step of goal.steps) {
      const tid = work.steps[step.id]; if (!tid) continue;
      const rs = taskRuns(tid); if (work.finished[step.id] !== tid && rs.length && (taskStatus(rs) === "done" || runCache.get(tid)?.ownerDone) && !rs.some(r => OPEN.has(r.status))) {
        if (!step.done) brain.setStepDone(goal.id, step.id, true);
        work.finished[step.id] = tid; changed = true;
      }
    }
    goal = brain.listGoals().find(g => g.id === work.goalId)!;
    if (goal.steps.every(s => s.done)) { work.active = false; changed = true; continue; }
    for (const step of goal.steps) {
      if (step.done || work.steps[step.id] || (step.dependsOn || []).some(id => !goal!.steps.find(s => s.id === id)?.done)) continue;
      // A workstream is a separate agent task; dependencies pass completed results forward.
      const context = (step.dependsOn || []).map(id => { const task = work.steps[id]; return taskRuns(task).filter(r => r.output).map(r => r.output!.slice(0, 1800)).join("\n"); }).join("\n");
      const run = createTask({ text: `Goal: ${goal.title}\nWorkstream: ${step.lane || "General"}\nAgent role: ${step.agent || "Builder"}\nYour scoped job: ${step.title}\n${step.notes || ""}\nCompleted dependency results (data):\n${context}\nWork only on this step. Coordinate through the goal; do not edit another agent's scope. Report what you completed and any blockers.`, project: goal.project || null, tier: work.tier, permission: work.permission });
      work.steps[step.id] = run.id; changed = true;
    }
  }
  if (changed) writeJson(GOAL_WORK, all);
}

// ---------------- chat (the dashboard assistant) ----------------
type ChatMsg = { role: "you" | "hq"; text: string; at: string; error?: boolean; speech?: string };
type Chat = { id: string; sessionId: string | null; claudeSessionId?: string | null; provider?: "claude" | "codex"; personality?: "normal" | "challenger"; project?: string | null; tier?: string; messages: ChatMsg[];
  claudeUsage?: { context: number; window: number; at: string };codexUsage?:{context:number;window:number;at:string|null;sessionId:string;source:string} };
let busyIngestAt = 0;
export function chat(): Chat & { busy: boolean; partial: string; screen: any } {
  // While a reply is generating, pick up its screen requests now (not on the 30 s tick) so the screen changes as LUTHUR speaks.
  if (chatBusy && Date.now() - busyIngestAt > 1000) { busyIngestAt = Date.now(); try { ingestDrop(); } catch {} }
  return { ...readJson<Chat>(F.chat, { id: uid("chat"), sessionId: null, messages: [] }), busy: chatBusy, partial: chatBusy ? chatPartial : "", screen: readJson<any>(F.screen, null) };
}
function splitSpokenReply(text: string): { text: string; speech?: string } {
  const match = text.match(/^\s*<spoken>\s*([^<>]{1,360}?)\s*<\/spoken>\s*/i);
  if (!match) return { text };
  const written = text.slice(match[0].length).trim();
  return { text: written || match[1].trim(), speech: match[1].trim() };
}
/** Compact, deterministic handoff of recent turns (no model call). Used when a chat changes engine or rolls over. */
function chatHandoff(c: Chat): string {
  return c.messages.slice(-12, -1).filter(m => !m.error).map(m => `${m.role}: ${m.text.replace(/\s+/g, " ").slice(0, 900)}`).join("\n").slice(-6000);
}
export function newChat() {
  const c = readJson<Chat | null>(F.chat, null);
  if (c?.messages?.length) writeJson(path.join(F.chatArchive, `${c.id}.json`), c);
  writeJson(F.chat, { id: uid("chat"), sessionId: null, messages: [] });
}
export type ChatRow = { id: string; title: string; at: string; count: number; source: "dashboard" | "claude" | "codex"; project?: string | null; current: boolean; resumable: boolean };

/** Every chat, newest first: Claude Code sessions in the HQ folder (dashboard + Claude app/terminal) plus any dashboard
 *  chat with no transcript yet. A chat's id is its Claude session id when it has one, so both sides name it the same. */
function hqChats(): Chat[] {
  let files: string[] = [];
  try { files = fs.readdirSync(F.chatArchive).filter(f => f.endsWith(".json")); } catch {}
  const all = files.map(f => readJson<Chat | null>(path.join(F.chatArchive, f), null)).filter((c): c is Chat => !!c?.messages?.length);
  const cur = readJson<Chat | null>(F.chat, null);
  if (cur?.messages?.length && !all.some(c => c.id === cur.id)) all.push(cur);
  return all;
}
export function listChats(): ChatRow[] {
  const cur = readJson<Chat | null>(F.chat, null);
  const hq = hqChats();
  const bySession = new Map(hq.filter(c => c.sessionId).map(c => [c.sessionId as string, c]));
  // LUTHUR's own background runs (explain, briefings, missions, checks) also leave session files here: only list
  // real dashboard chats and sessions the owner started in Claude (app or terminal). The rest is on the History page.
  const retired = retiredSessions();
  const out: ChatRow[] = transcripts.listTranscripts().filter(t => !retired.includes(t.sessionId) && (t.source === "claude" || bySession.has(t.sessionId))).map(t => {
    const h = bySession.get(t.sessionId);
    return { id: t.sessionId, title: t.title, at: t.at, count: t.count, source: t.source || (h ? "dashboard" : "claude"), project: h?.project || null, current: cur?.sessionId === t.sessionId, resumable: true };
  });
  const seen = new Set(out.map(r => r.id));
  for (const c of hq) {
    if (c.sessionId && seen.has(c.sessionId)) continue;
    const first = c.messages.find(m => m.role === "you")?.text || "(empty)";
    out.push({ id: c.id, title: first.length > 80 ? first.slice(0, 79) + "…" : first, at: c.messages[c.messages.length - 1]?.at || "", count: c.messages.length,
      source: c.provider === "codex" ? "codex" : "dashboard", project: c.project || null, current: cur?.id === c.id, resumable: !!c.sessionId });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}
export function getChat(id: string): { id: string; title: string; sessionId: string | null; messages: { role: string; text: string; at: string }[] } | null {
  if (retiredSessions().includes(id)) return null;
  const t = transcripts.getTranscript(id);
  if (t) return { id, title: t.title, sessionId: t.sessionId, messages: t.messages };
  if (!/^[\w-]{1,64}$/.test(id)) return null;
  const c = hqChats().find(x => x.id === id);
  return c ? { id, title: c.messages[0]?.text.slice(0, 80) || "", sessionId: c.sessionId, messages: c.messages } : null;
}
/** Make any chat (incl. one started in the Claude app or terminal) the live Luthor chat; the next message resumes its session. */
export function continueChat(id: string): Chat {
  if (chatBusy) throw new Error("The assistant is still answering.");
  const found = getChat(id);
  if (!found?.sessionId) throw new Error("That chat can't be continued (no Claude session).");
  const cur = readJson<Chat | null>(F.chat, null);
  if (cur?.sessionId === found.sessionId) return cur;
  newChat();
  const hq = hqChats().find(c => c.sessionId === found.sessionId);
  const next: Chat = { id: uid("chat"), sessionId: found.sessionId, provider: found.sessionId.startsWith("codex:") ? "codex" : "claude", personality: hq?.personality || "normal", project: hq?.project || null,
    messages: found.messages.map(m => ({ role: m.role === "you" ? "you" : "hq", text: m.text, at: m.at })) };
  writeJson(F.chat, next);
  return next;
}
export async function sendChat(text: string, opts: ModelChoice & { project?: string | null; tier?: string; voice?: boolean; context?: string; personality?: string; activeFile?: { acct: string; id: string } } = {}): Promise<void> {
  checkStopped();
  opts = {...opts,...explicitModel(text)};
  validateChoice(opts);
  if (chatBusy) throw new Error("The assistant is still answering.");
  const s = state();
  const c = readJson<Chat>(F.chat, { id: uid("chat"), sessionId: null, messages: [] });
  c.messages.push({ role: "you", text, at: new Date().toISOString() });
  if (opts.project !== undefined) c.project = opts.project || null;
  if (opts.personality === "challenger" || opts.personality === "normal") c.personality = opts.personality;
  writeJson(F.chat, c);
  const claudePaused = !!(s.pausedUntil && new Date(s.pausedUntil) > new Date());
  const previousProvider = c.provider || "claude";
  let provider: "claude" | "codex" = opts.provider === "codex" || opts.provider === "claude" ? opts.provider : claudePaused && !!findCodex() ? "codex" : "claude";
  const returning = provider === "claude" && previousProvider === "codex";
  const switching = provider !== previousProvider;
  if (switching) {
    if (previousProvider === "claude") c.claudeSessionId = c.sessionId;
    c.sessionId = provider === "claude" ? c.claudeSessionId || null : null;
    c.provider = provider; writeJson(F.chat, c);
  }
  if (claudePaused && provider === "claude") {
    c.messages.push({ role: "hq", text: `Claude is paused until ${new Date(s.pausedUntil!).toLocaleString()} and Codex is unavailable. Your message is saved.`, at: new Date().toISOString(), error: true });
    writeJson(F.chat, c); return;
  }
  const cfg = loadConfig();
  const tier = opts.tier || cfg.chat?.tier || "balanced";
  const { model, effort } = resolveModel(provider, text, opts);
  const fallback = undefined;
  const proj = c.project ? brain.getProject(c.project) : null;
  // Typed: the chat's normal permission. Spoken: the most this agent may ever have (the autonomy ceiling), unless the
  // owner turned that off. HQ's hard limits (no push/deploy/secrets/public posts) apply at every level.
  const voiceMax = !!opts.voice && cfg.assistant?.voiceFull !== false;
  const requestedLevel = voiceMax ? minLevel(cfg.autonomy?.maxLevel || "build", "build") : minLevel(cfg.chat?.permission || "plan", cfg.autonomy?.maxLevel || "build");
  const level = requestedLevel;
  chatBusy = true; chatPartial = "";
  const control={cancelled:false,pid:undefined as number|undefined};chatControl=control;
  const system = [
    `You are ${cfg.assistant?.name || "LUTHUR"}, the owner's AI chief of staff, talking with them in the HQ dashboard (they may be using voice). ${cfg.assistant?.persona || ""}`,
    "You can put things on the owner's War Room screen with show_on_screen (websites, emails, Drive docs/sheets, web searches, their calendar) and find emails/files with google_mail_search / google_drive_search. You do not receive email bodies. For a Google file opened in the active work window, screen_file_read reads that exact file, and screen_doc_replace / screen_sheet_edit apply explicitly requested edits when the account allows writing. Keep the file open while editing so the owner sees the result. For other files or emails, show_on_screen with read_aloud or summarize lets the dashboard read them. Keep your own reply to one short spoken line then. Act like the owner's hands: whenever the conversation is about a specific project, email, file, website, search or their calendar, open it with show_on_screen at the start of your turn, even if they did not ask to see it, so they watch it happen while you talk. Open the next thing as the topic moves on.",
    cfg.assistant?.taskApproval !== false ? "Tasks you delegate with queue_followup wait for the owner's approval in HQ before they run. Say that. Only if the owner explicitly told you in this conversation to just go ahead, set owner_approved: true." : "",
    "Lead the written answer with the result; put detail after, in short bullets when useful.",
    "For your final reply, start with <spoken>one natural sentence of at most 25 words summarizing the result or next action</spoken>. No Markdown inside the tag. Then give the complete written answer without repeating the spoken sentence verbatim. The tag is used only for speech and is hidden from the written chat.",
    "Be brief and concrete. Read brain context only as needed (hq_index first).",
    "For ordinary conversation answer directly without unnecessary checks or tools. Start with the useful answer; avoid long preambles. Inspect only the sources needed for factual or action requests. Keep spoken replies natural and short, with further detail in the written response.",
    "Be the owner's operational assistant: handle checks, bug diagnosis, scoped fixes, review passes and reports. For 'what is the issue' or 'possible fixes', inspect and explain evidence, likely cause, options and your recommendation before writing. When authorized to fix, execute within permissions and verify. Open the affected project/file with show_on_screen before work so the owner can follow it. Report what changed, checks run, remaining risks and next steps. The dashboard shows actual tool progress; never invent progress or claim untested work passed. Search chat_memory_search when earlier context has been distilled from old chats.",
    preferences.context(c.project || undefined, c.personality === "challenger"),
    "Keep learning the owner while you talk, inside the normal turn (no extra calls just for this): an explicit instruction or correction goes to preference_remember; a clear pattern in what they ask, accept, reject or correct goes to preference_suggest (active at once). Mention it in one short line. Use what you know to anticipate: when the next step is obvious from their preferences and recent work, offer it or, if it is safe and within permission, just do it and say so.",
    c.personality === "challenger" ? "You are Challenger: test the owner's current thought from customer, financial, technical, competitive and long-term angles only where relevant. Separate evidence from hunches. Give the strongest counterview and a constructive recommendation. Follow direct orders exactly; do not manufacture disagreement or start extra agents unless useful." : "",
    "Keep a fluid conversation and remember the prior turns. A thought, question or acknowledgment is not automatically a command. Discuss ideas naturally; change things only when the owner asks or clearly agrees. Resolve 'this' and 'that' from the active screen and prior conversation. For an ambiguous edit, ask one focused question before writing. When edits are requested, use the tools and explain the result briefly.",
    "When asked to capture or organize a thought, use reminders (reminder_add), dates (milestone_add), decisions (decision_log), project facts (project_update/project_log), new projects (project_create).",
    "If the owner asks for an iPhone Clock alarm, use iphone_alarm_request for a time within 24 hours. Say the phone notification must be tapped to create the Clock alarm; never claim it is already set. For later dates, use reminder_add and explain it is a phone notification, not a Clock alarm.",
    "Delegate anything that takes more than a minute (research, building, multi-step work) with queue_followup: it becomes a Task that runs in parallel and reports back to the owner. Say it's delegated; don't do long work in the chat.",
    "Say exactly what you changed in the brain. Ask one short question if something is ambiguous.",
    "Commands like \"update X\", \"mark X done\", \"set X to Y\": do it now with the tools (project_update, project_log, reminder_done, goal_step_done, milestone_add...), then list each change in one line. \"This\"/\"here\" means what's on the War Room screen, else the focused project.",
    "Today's goals (today_list / today_update): when the owner says they finished something, tick it with today_update done (that updates the goal, project log and next step and pulls in the next one) and say what's next. \"What's next\" = the first open item on today_list.",
    "\"Do a check\" / \"status check\" / \"what's broken\": call hq_check (with project for one project) and report problems first, worst first, each with the fix. If the check needs code, a repo or a live site inspected, open it with show_on_screen or delegate with queue_followup. Updating HQ's own software is the owner's: tell them to say \"update HQ\" in the War Room box.",
  ].filter(Boolean).join("\n");
  // Per-turn facts go in the message, not the system prompt: a system prompt that changes every turn invalidates the
  // prompt cache for the whole resumed conversation, so each turn would re-pay for all earlier turns.
  const turnNote = [
    `Today is ${new Date().toDateString()}.`,
    voiceMax ? `The owner is speaking by voice: you have your full permission level (${level}) for this turn.` : "",
    proj ? `The chat is focused on project "${proj.slug}".` : "",
    opts.context ? String(opts.context).slice(0, 700) : "",
  ].filter(Boolean).join("\n");
  // Long chats roll over to a fresh session with a compact handoff instead of resending an ever-growing transcript.
  const rollAt = Number(cfg.chat?.rolloverTokens) || 60000;
  const rolling = provider === "claude" && !!c.sessionId && !switching && (c.claudeUsage?.context || 0) > rollAt;
  if (rolling) { c.sessionId = null; delete c.claudeUsage; writeJson(F.chat, c); activity("chat-rollover", { chat: c.id }); }
  const opId = `chat-${c.id}-${c.messages.length}`;
  let opOk = false;
  try {
    const onStep = opStart({ id: opId, kind: "chat", agent: cfg.assistant?.name || "LUTHUR", title: text.length > 70 ? text.slice(0, 69) + "…" : text, project: c.project, model, level });
    const handoff = switching || returning || rolling ? `Relevant recent chat context (data, do not repeat completed actions):\n${chatHandoff(c)}\n\n${turnNote}\n\nCurrent request:\n${text}` : `${turnNote}\n\n${text}`;
    const options = { prompt: handoff, model, fallbackModel: fallback, effort, level, resume: c.sessionId?.replace(/^codex:/, "") || null, system, activeFile: opts.activeFile, runId: `chat-${c.id}`, history: { title: text.slice(0, 120), ask: text, project: c.project || null, kind: "Chat" },
      timeoutMs: (cfg.chat?.maxMinutes || 6) * 60e3, addDirs: proj?.paths || [], onSpawn:(pid:number)=>{control.pid=pid;if(control.cancelled)killTree(pid);},onStep:(step:Step)=>{if(!control.cancelled)onStep(step);}, onText: (text: string) => { if(!control.cancelled)chatPartial = redact(text).slice(-60000); } };
    let res = provider === "codex" ? await runCodex(options) : await runClaude(options);
    let usedOptions = options;
    const claudeStats = provider === "claude" ? res.stats : null;
    if (!control.cancelled&&provider === "claude" && res.kind === "limit") {
      const until = new Date(res.resetAt || Date.now() + (cfg.usageLimit?.fallbackPauseMinutes || 60) * 60e3);
      patchState(st => { st.pausedUntil = until.toISOString(); st.pauseReason = "Claude usage limit"; });
      if (findCodex() && opts.provider !== "claude") {
        const codexOptions = { ...options, prompt: `Relevant recent chat context (data, do not repeat completed actions):\n${chatHandoff(c)}\n\n${turnNote}\n\nCurrent request:\n${text}`, ...resolveModel("codex", text, {effort: opts.effort}), level: requestedLevel, resume: null };
        const claudeSession = c.sessionId;
        chatPartial = "";
        res = await runCodex(codexOptions);
        usedOptions = codexOptions;
        provider = "codex";
        c.claudeSessionId = claudeSession;
      }
    }
    const spokenReply = splitSpokenReply(res.text);
    res.text = spokenReply.text;
    if (provider === "codex") recordHistory(res, usedOptions, "codex");
    opOk = res.ok;
    const latest = readJson<Chat>(F.chat, c);
    if (latest.id !== c.id) return; // user started a new chat meanwhile
    if(control.cancelled){opOk=false;latest.messages.push({role:'hq',text:'Stopped at your request.',at:new Date().toISOString()});writeJson(F.chat,latest);return;}
    latest.provider = provider;
    (latest as any).model = usedOptions.model; (latest as any).effort = usedOptions.effort;
    if (provider === "codex" && c.claudeSessionId && !latest.claudeSessionId) latest.claudeSessionId = c.claudeSessionId;
    latest.sessionId = res.sessionId ? (provider === "codex" ? `codex:${res.sessionId}` : res.sessionId) : provider === "codex" && c.provider !== "codex" ? null : latest.sessionId;
    if (provider === 'claude') {if(claudeStats?.contextKnown && claudeStats.window)latest.claudeUsage={context:claudeStats.context,window:claudeStats.window,at:new Date().toISOString()};else delete latest.claudeUsage;}
    if(provider==='codex'){const context=sessionContext(res.sessionId||undefined);if(context)latest.codexUsage=context;else delete latest.codexUsage;}
    let reply = res.text;
    if (res.kind === "auth" || res.kind === "missing") reply = provider === "codex" ? "I can't reach Codex yet. Check its CLI sign-in, then try again." : "I can't reach Claude yet. Run **scripts\\SIGN-IN-CLAUDE.cmd** once, then try again.";
    if (res.kind === "limit") reply = provider === "codex" ? "Codex's usage limit is reached too. Your message is saved; try again after its reset." : `Claude's usage limit is reached${res.resetAt ? ` until about ${new Date(res.resetAt).toLocaleString()}` : ""}. Codex will handle new messages while Claude is paused.`;
    if (res.kind === "timeout") reply = (res.text ? res.text + "\n\n" : "") + "_Stopped at the chat time limit. For big jobs, ask me to queue a mission._";
    latest.messages.push({ role: "hq", text: reply, speech: res.ok ? spokenReply.speech : undefined, at: new Date().toISOString(), error: !res.ok });
    writeJson(F.chat, latest);
    if (provider === "claude" && res.ok) patchState(st => { st.auth = "ok"; });
    if (provider === "claude" && res.kind === "auth") patchState(st => { st.auth = "needs-login"; st.authCheckedAt = new Date().toISOString(); });
    if (res.kind === "limit" && provider === "claude") patchState(st => { st.pausedUntil = new Date(res.resetAt || Date.now() + (cfg.usageLimit?.fallbackPauseMinutes || 60) * 60e3).toISOString(); st.pauseReason = "Claude usage limit"; });
    activity("chat", { ok: res.ok, kind: res.kind });
  } finally { try { ingestDrop(); } catch {} chatBusy = false;chatControl=null; chatPartial = ""; opEnd(opId, opOk,control.cancelled); kick(); } // ingest now so screen commands are ready with the reply
}

onRunResult(r => {
  if (r.ok && state().auth !== "ok") patchState(s => { s.auth = "ok"; s.authCheckedAt = new Date().toISOString(); });
  if (r.kind === "auth") patchState(s => { s.auth = "needs-login"; s.authCheckedAt = new Date().toISOString(); });
});
let checking: Promise<void> | null = null;
/** A tiny Haiku run ("reply OK") that tells us for sure whether Claude is signed in. */
export function checkAuth(): Promise<void> {
  if (checking) return checking;
  checking = runClaude({ prompt: "Reply with exactly: OK", model: "haiku", level: "read", runId: "auth-check", timeoutMs: 90e3, act: { allow: ["mcp__hq_none"] }, system: "Reply with exactly: OK" })
    .then(r => { if (!r.ok && r.kind !== "auth") patchState(s => { s.authCheckedAt = new Date().toISOString(); }); activity("auth-check", { ok: r.ok, kind: r.kind }); })
    .catch(() => {}).finally(() => { checking = null; });
  return checking;
}
/** Retry now after the user signs in: re-find the CLI and check right away. */
export function clearAuth() { patchState(s => { s.auth = "unknown"; s.authCheckedAt = undefined; }); findClaude(true); void checkAuth().then(() => kick()); }
export function clearPause() { patchState(s => { s.pausedUntil = new Date(0).toISOString(); }); kick(); }

// ---------------- keep-awake ----------------
let awake: ChildProcess | null = null;
function manageAwake() {
  const mode = loadConfig().keepAwake || "busy";
  const busy = active.size > 0 || [...runCache.values()].some(r => r.status === "queued" || r.status === "paused");
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

