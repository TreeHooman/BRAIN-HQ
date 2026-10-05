// The orchestrator: event loop that owns missions, the queue, budgets, usage-limit pauses,
// approvals, follow-up handoffs, reminders and keep-awake. It spends zero tokens while idle.
import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { DATA, DROP, appendLine, fingerprint, localDate, readJson, uid, writeJson } from "./store.ts";
import { budget, loadConfig, minLevel, modelFor, type Level } from "./config.ts";
import { findClaude, killTree, onRunResult, runClaude, type RunResult } from "./claude.ts";
import type { Step } from "./narrate.ts";
import { isDue, type Schedule } from "./schedule.ts";
import { notify } from "./notify.ts";
import * as brain from "./brain.ts";
import * as transcripts from "./transcripts.ts";
import * as outbox from "./outbox.ts";

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
  taskId?: string | null; reply?: boolean; reportedAt?: string; effort?: string | null;
};
export type Approval = {
  id: string; createdAt: string; title: string; detail: string; project?: string | null;
  fromRun?: string | null; status: "pending" | "approved" | "rejected";
  proposed?: { title: string; prompt: string; project?: string | null; tier?: string; permission?: string; extraAllow?: string[]; task?: boolean } | null;
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
    taskId: spec.taskId ?? null, reply: spec.reply, sessionId: spec.sessionId ?? null, effort: spec.effort ?? null,
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
      permission: minLevel(a.proposed.permission || "plan", "build"), extraAllow: a.proposed.extraAllow, parentRun: a.proposed.task ? null : a.fromRun, priority: 1, ...(a.proposed.task ? { taskId: "self", depth: 0 } : {}) }, a.proposed.task ? "task" : "approval");
  }
  return a;
}

// ---------------- status ----------------
type Slot = { run: Run; pid?: number; cancelled?: boolean };
const active = new Map<string, Slot>();
const ownerRun = (r: Run) => !!r.taskId || r.trigger === "manual" || r.trigger === "approval";
const maxTasks = () => Math.max(1, Math.min(6, Number(loadConfig().tasks?.maxParallel) || 3));
let chatBusy = false;
export function status() {
  const s = state(); const b = budget();
  const queued = [...runCache.values()].filter(r => r.status === "queued").length;
  return {
    pausedUntil: s.pausedUntil, pauseReason: s.pauseReason, auth: s.auth, claudeBin: findClaude(),
    running: (r => r ? { id: r.id, title: r.title, startedAt: r.startedAt } : null)([...active.values()][0]?.run),
    active: [...active.values()].map(({ run: r }) => ({ id: r.id, title: r.title, startedAt: r.startedAt, taskId: r.taskId || null, project: r.project })), maxParallel: maxTasks() + 1,
    chatBusy, queued, today: s.day.date === localDate() ? s.day.runs : 0, maxRunsPerDay: b.maxRunsPerDay, budget: b.preset,
    pendingApprovals: approvals().filter(a => a.status === "pending").length,
  };
}

// ---------------- live operations (in memory, for the dashboard's ops feed) ----------------
export type Op = {
  id: string; kind: "chat" | "mission" | "code"; title: string; project?: string | null; model: string; level?: string;
  agent?: string; task?: string | null; parent?: string | null;
  startedAt: number; endedAt?: number; status: "running" | "done" | "failed";
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
export function opEnd(id: string, ok: boolean) { const op = ops.get(id); if (op) { op.status = ok ? "done" : "failed"; op.endedAt = Date.now(); } }
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
    scheduleMissions();
    resumeIfReady();
    manageAwake();
    runNext();
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
      const fromChat = String(d.fromRun || "").startsWith("chat-");
      const perm = minLevel(d.permission || "plan", ceiling);
      // New work LUTHUR starts on its own (a Task from the chat, or a follow-up from a scheduled mission) waits for the
      // owner's OK unless they turned that off or explicitly said "just do it" in the chat. Sub-agents of a task that was
      // already approved run straight away (they're part of that task).
      const needsOk = loadConfig().assistant?.taskApproval !== false && !parent?.taskId && !(fromChat && d.owner_approved === true);
      if (needsOk) {
        const all = approvals();
        all.unshift({ id: uid("ap"), createdAt: new Date().toISOString(), title: `Start task: ${String(d.title || "").slice(0, 120)}`, detail: String(d.prompt || "").slice(0, 2000), project: d.project, fromRun: d.fromRun, status: "pending",
          proposed: { title: d.title, prompt: d.prompt, project: d.project, tier: d.tier || "balanced", permission: perm, task: fromChat } });
        saveApprovals(all);
        activity("approval-requested", { title: d.title });
        notify({ title: "LUTHUR wants to start a task", body: String(d.title || ""), priority: 3, tags: "raised_hand" });
        continue;
      }
      // From the chat, delegated work becomes a Task (reports back); from a task, it's a sub-agent of that task.
      enqueue({ title: d.title, prompt: d.prompt, project: d.project, tier: d.tier || "balanced", permission: minLevel(d.permission || "plan", ceiling), parentRun: fromChat ? null : d.fromRun, depth: fromChat ? 0 : depth,
        priority: fromChat || parent?.taskId ? 1 : 2, taskId: fromChat ? "self" : parent?.taskId || null, effort: parent?.effort || null }, fromChat ? "task" : "followup");
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
  if (s.pausedUntil && new Date(s.pausedUntil) > new Date()) return;
  // After a sign-in problem, retry at most every 30 minutes.
  if (s.auth === "needs-login" && s.authCheckedAt && Date.now() - new Date(s.authCheckedAt).getTime() < 30 * 60e3) return;
  const queue = [...runCache.values()].filter(r => r.status === "queued").sort((a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt));
  if (!queue.length) return;
  const b = budget();
  const today = localDate();
  let capped = 0;
  for (const run of queue) {
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

  const { model, fallback } = modelFor(run.tier);
  const resuming = !!run.sessionId;
  const reply = run.reply && !run.startedAt;
  Object.assign(run, { status: "running", startedAt: new Date().toISOString(), level, model });
  saveRun(run);
  const slot: Slot = { run };
  active.set(run.id, slot);
  activity("started", { run: run.id, title: run.title, model, level });
  setAwake(true);
  patchState(s => { const t = localDate(); if (s.day.date !== t) s.day = { date: t, runs: 0 }; if (!resuming || reply) s.day.runs++; });

  const onStep = opStart({ id: run.id, kind: "mission", title: run.title, project: run.project, model, level, task: run.taskId || null, parent: run.parentRun || null });
  let res: RunResult;
  try {
  res = await runClaude({
    prompt: reply ? `The owner replied on this task:\n\n${run.prompt.trim()}\n\nAct on it within your permission (${level}), then end with the same short report format.`
      : resuming ? "Continue the mission where you left off (you were paused by a usage limit or restart). Then finish as instructed." : missionPrompt(run, level, minutes),
    model, fallbackModel: fallback, effort: run.effort, level, runId: run.id, resume: run.sessionId || null,
    history: { title: run.title, ask: reply ? run.prompt : run.prompt.slice(0, 2000), project: run.project || null, kind: "Mission" },
    addDirs: level === "build" || level === "read" || level === "plan" ? (proj?.paths || []) : [],
    extraAllow: run.extraAllow, timeoutMs: minutes * 60e3,
    onSpawn: pid => { slot.pid = pid; }, onStep,
  });
  } finally { active.delete(run.id); }
  const cancelled = slot.cancelled;
  opEnd(run.id, res.ok && !cancelled);
  handleResult(run, res, !!cancelled);
}

function handleResult(run: Run, res: RunResult, cancelled: boolean) {
  run.sessionId = res.sessionId || run.sessionId;
  run.durationMs = (run.durationMs || 0) + res.durationMs;
  const now = new Date().toISOString();
  if (cancelled) { Object.assign(run, { status: "cancelled", endedAt: now, output: res.text }); saveRun(run); activity("cancelled", { run: run.id }); taskCheck(run); return; }
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
export function tasks(limit = 30) {
  const roots = [...runCache.values()].filter(r => r.taskId && r.taskId === r.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  return roots.map(root => {
    const rs = taskRuns(root.id);
    return { id: root.id, title: root.title, prompt: root.prompt.slice(0, 2000), project: root.project, createdAt: root.createdAt, status: taskStatus(rs), reportedAt: root.reportedAt || null,
      runs: rs.map(r => ({ id: r.id, title: r.title, status: r.status, parent: r.parentRun, depth: r.depth, reply: !!r.reply, prompt: r.reply ? r.prompt.slice(0, 600) : undefined, level: r.level || r.permission, model: r.model || r.tier,
        startedAt: r.startedAt, endedAt: r.endedAt, durationMs: r.durationMs, output: r.output?.slice(0, 6000), error: r.error?.slice(0, 800) })) };
  });
}

// ---------------- chat (the dashboard assistant) ----------------
type ChatMsg = { role: "you" | "hq"; text: string; at: string; error?: boolean };
type Chat = { id: string; sessionId: string | null; project?: string | null; tier?: string; messages: ChatMsg[] };
export function chat(): Chat & { busy: boolean; screen: any } {
  return { ...readJson<Chat>(F.chat, { id: uid("chat"), sessionId: null, messages: [] }), busy: chatBusy, screen: readJson<any>(F.screen, null) };
}
export function newChat() {
  const c = readJson<Chat | null>(F.chat, null);
  if (c?.messages?.length) writeJson(path.join(F.chatArchive, `${c.id}.json`), c);
  writeJson(F.chat, { id: uid("chat"), sessionId: null, messages: [] });
}
export type ChatRow = { id: string; title: string; at: string; count: number; source: "dashboard" | "claude"; project?: string | null; current: boolean; resumable: boolean };

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
  const out: ChatRow[] = transcripts.listTranscripts().filter(t => t.source === "claude" || bySession.has(t.sessionId)).map(t => {
    const h = bySession.get(t.sessionId);
    return { id: t.sessionId, title: t.title, at: t.at, count: t.count, source: t.source || (h ? "dashboard" : "claude"), project: h?.project || null, current: cur?.sessionId === t.sessionId, resumable: true };
  });
  const seen = new Set(out.map(r => r.id));
  for (const c of hq) {
    if (c.sessionId && seen.has(c.sessionId)) continue;
    const first = c.messages.find(m => m.role === "you")?.text || "(empty)";
    out.push({ id: c.id, title: first.length > 80 ? first.slice(0, 79) + "…" : first, at: c.messages[c.messages.length - 1]?.at || "", count: c.messages.length,
      source: "dashboard", project: c.project || null, current: cur?.id === c.id, resumable: !!c.sessionId });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}
export function getChat(id: string): { id: string; title: string; sessionId: string | null; messages: { role: string; text: string; at: string }[] } | null {
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
  const next: Chat = { id: uid("chat"), sessionId: found.sessionId, project: hq?.project || null,
    messages: found.messages.map(m => ({ role: m.role === "you" ? "you" : "hq", text: m.text, at: m.at })) };
  writeJson(F.chat, next);
  return next;
}
export async function sendChat(text: string, opts: { project?: string | null; tier?: string; effort?: string; voice?: boolean; context?: string } = {}): Promise<void> {
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
  // Typed: the chat's normal permission. Spoken: the most this agent may ever have (the autonomy ceiling), unless the
  // owner turned that off. HQ's hard limits (no push/deploy/secrets/public posts) apply at every level.
  const voiceMax = !!opts.voice && cfg.assistant?.voiceFull !== false;
  const level = voiceMax ? minLevel(cfg.autonomy?.maxLevel || "build", "build") : minLevel(cfg.chat?.permission || "plan", cfg.autonomy?.maxLevel || "build");
  chatBusy = true;
  const system = [
    `You are ${cfg.assistant?.name || "LUTHUR"}, the owner's AI chief of staff, talking with them in the HQ dashboard (they may be using voice). ${cfg.assistant?.persona || ""}`,
    "You can put things on the owner's Command screen with show_on_screen (websites, emails, Drive docs/sheets, web searches, their calendar) and find emails/files with google_mail_search / google_drive_search. You never see email or file contents: to read or go over one, call show_on_screen with read_aloud or summarize and the dashboard does it. Keep your own reply to one short spoken line then.",
    voiceMax ? `The owner is speaking to you by voice: you have your full permission level (${level}) for this turn.` : "",
    cfg.assistant?.taskApproval !== false ? "Tasks you delegate with queue_followup wait for the owner's approval in HQ before they run. Say that. Only if the owner explicitly told you in this conversation to just go ahead, set owner_approved: true." : "",
    "Lead with the answer in one or two spoken-friendly sentences; put detail after, in short bullets.",
    "Be brief and concrete. Read brain context only as needed (hq_index first).",
    "Turn loose thoughts into structure: reminders (reminder_add), dates (milestone_add), decisions (decision_log), project facts (project_update/project_log), new projects (project_create).",
    "Delegate anything that takes more than a minute (research, building, multi-step work) with queue_followup: it becomes a Task that runs in parallel and reports back to the owner. Say it's delegated; don't do long work in the chat.",
    "Say exactly what you changed in the brain. Ask one short question if something is ambiguous.",
    "Commands like \"update X\", \"mark X done\", \"set X to Y\": do it now with the tools (project_update, project_log, reminder_done, goal_step_done, milestone_add...), then list each change in one line. \"This\"/\"here\" means what's on the Command screen, else the focused project.",
    "\"Do a check\" / \"status check\" / \"what's broken\": call hq_check (with project for one project) and report problems first, worst first, each with the fix. If the check needs code, a repo or a live site inspected, open it with show_on_screen or delegate with queue_followup. Updating HQ's own software is the owner's: tell them to say \"update HQ\" in the Command box.",
    `Today is ${new Date().toDateString()}.`,
    proj ? `The chat is focused on project "${proj.slug}".` : "",
    opts.context ? String(opts.context).slice(0, 700) : "",
  ].join("\n");
  const opId = `chat-${c.id}-${c.messages.length}`;
  let opOk = false;
  try {
    const onStep = opStart({ id: opId, kind: "chat", agent: cfg.assistant?.name || "LUTHUR", title: text.length > 70 ? text.slice(0, 69) + "…" : text, project: c.project, model, level });
    const res = await runClaude({ prompt: text, model, fallbackModel: fallback, effort: opts.effort || null, level, resume: c.sessionId, system, runId: `chat-${c.id}`, history: { title: text.slice(0, 120), ask: text, project: c.project || null, kind: "Chat" },
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
  } finally { try { ingestDrop(); } catch {} chatBusy = false; opEnd(opId, opOk); kick(); } // ingest now so screen commands are ready with the reply
}

onRunResult(r => {
  if (r.ok && state().auth !== "ok") patchState(s => { s.auth = "ok"; s.authCheckedAt = new Date().toISOString(); });
  if (r.kind === "auth") patchState(s => { s.auth = "needs-login"; s.authCheckedAt = new Date().toISOString(); });
});
let checking: Promise<void> | null = null;
/** A tiny Haiku run ("reply OK") that tells us for sure whether Claude is signed in. */
export function checkAuth(): Promise<void> {
  if (checking) return checking;
  checking = runClaude({ prompt: "Reply with exactly: OK", model: modelFor("fast").model, level: "read", runId: "auth-check", timeoutMs: 90e3, act: { allow: ["mcp__hq_none"] }, system: "Reply with exactly: OK" })
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

