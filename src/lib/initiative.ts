// The initiative loop: every few hours a code-only pass (no model call) reads each project's deadlines, reminders,
// goal steps, next step and health from the brain and picks a few small jobs LUTHUR could start by itself.
// The orchestrator routes each pick like any other task: a live fast-approve rule starts it, otherwise it waits in
// Missions & approvals (one phone alert per scan, not one per pick). Settings sit with the rules in
// config/autonomy-rules.json (owner-only); state is data/initiative.json. Never build on HQ itself, never above a
// project's maxPermission or autonomy.maxLevel, and build only for projects on the owner's build list.
import crypto from "node:crypto";
import path from "node:path";
import { DATA, localDate, readJson, writeJson } from "./store.ts";
import { loadConfig, minLevel, type Level } from "./config.ts";
import * as brain from "./brain.ts";
import * as autonomy from "./autonomy.ts";

const FILE = path.join(DATA, "initiative.json");
const HOUR = 36e5, DAY = 24 * HOUR;
const SEEN_DAYS = 7, REJECTED_DAYS = 30, KEEP_RECENT = 30;
const SKIP_STAGES = new Set(["done", "paused"]);
const OWNER_ONLY = /^\s*(owner|you)\s*[:,-]/i; // "Owner: confirm X": nothing an agent can start

export type Candidate = {
  key: string; project: string; name: string; kind: "deadline" | "reminder" | "goal" | "next";
  job: string; why: string; score: number; permission: Level; title: string;
};
type Entry = { at: string; project: string; title: string; why: string; outcome: "started" | "asked" | "rejected"; ref?: string };
type State = { lastScan: string | null; day: { date: string; count: number }; seen: Record<string, string>; recent: Entry[] };

function load(): State {
  const s = readJson<Partial<State>>(FILE, {});
  return { lastScan: s.lastScan || null, day: s.day?.date === localDate() ? s.day : { date: localDate(), count: 0 },
    seen: s.seen && typeof s.seen === "object" ? s.seen : {}, recent: Array.isArray(s.recent) ? s.recent : [] };
}
function save(s: State) {
  const now = Date.now();
  for (const [k, until] of Object.entries(s.seen)) if (Date.parse(until) < now) delete s.seen[k];
  s.recent = s.recent.slice(0, KEEP_RECENT);
  writeJson(FILE, s);
}
const hash = (t: string) => crypto.createHash("sha1").update(t.trim().toLowerCase()).digest("hex").slice(0, 12);
const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
/** Whole calendar days from today to a brain date (0 = today, negative = past). */
const days = (iso: string, now: number) => Math.round((midnight(brain.whenToDate(iso)) - midnight(new Date(now))) / DAY);
const short = (t: string, n: number) => { t = t.replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };

/** Is a scheduled scan due now? (enabled, inside the owner's hours, interval passed, daily cap left) */
export function due(now = new Date()): boolean {
  const cfg = autonomy.initiativeSettings(), s = load();
  if (!cfg.enabled || s.day.count >= cfg.maxPerDay) return false;
  const h = now.getHours(); if (h < cfg.fromHour || h >= cfg.toHour) return false;
  return !s.lastScan || now.getTime() - Date.parse(s.lastScan) >= cfg.everyHours * HOUR;
}

/** Every job worth starting for one project, best first. Pure brain reads. */
function candidatesFor(p: brain.Project, goalSteps: Set<string>, build: string[], now: number): Candidate[] {
  const out: Omit<Candidate, "permission" | "title">[] = [];
  const add = (c: Omit<Candidate, "permission" | "title" | "project" | "name">) => out.push({ ...c, project: p.slug, name: p.name });
  for (const m of brain.listMilestones()) {
    if (m.done || m.project !== p.slug) continue;
    const d = days(m.date, now); if (d < -3 || d > 14) continue;
    add({ key: `ms:${m.id}`, kind: "deadline", score: d < 0 ? 90 : 50 + (14 - d) * 3, why: d < 0 ? `"${m.title}" was due ${m.date}` : `"${m.title}" is due ${m.date} (${d === 0 ? "today" : `in ${d} day${d > 1 ? "s" : ""}`})`,
      job: `Get the milestone "${m.title}" (due ${m.date}) done or ready. Do what you can now and list exactly what is left for the owner.` });
  }
  for (const r of brain.listReminders()) {
    if (r.done || r.project !== p.slug) continue;
    const d = days(r.due, now); if (d < -7 || d > 3) continue;
    add({ key: `rm:${r.id}`, kind: "reminder", score: d < 0 ? 60 : 45 + (3 - d) * 4, why: `reminder "${short(r.title, 60)}" ${d < 0 ? "is overdue" : `is due ${r.due.slice(0, 10)}`}`,
      job: `Prepare for the owner's reminder "${r.title}" (due ${r.due}) so it takes them a couple of minutes: gather the facts, draft what is needed into the brain, and say what they must do.` });
  }
  for (const g of brain.listGoals()) {
    if (g.project !== p.slug) continue;
    const step = g.steps.find(s => !s.done && !goalSteps.has(`${g.id}:${s.id}`) && (s.dependsOn || []).every(id => g.steps.find(x => x.id === id)?.done));
    if (!step) continue;
    const soon = g.due && days(g.due, now) <= 30;
    add({ key: `goal:${g.id}:${step.id}`, kind: "goal", score: 30 + (soon ? 20 : 0), why: `next open step of the goal "${short(g.title, 60)}"${g.due ? ` (due ${g.due})` : ""}`,
      job: `Goal "${g.title}": ${step.title}${step.notes ? `\nNotes: ${step.notes}` : ""}\nWhen it is done, mark the step done with the hq-brain goal tools.` });
  }
  if (p.nextStep && !OWNER_ONLY.test(p.nextStep))
    add({ key: `next:${p.slug}:${hash(p.nextStep)}`, kind: "next", score: 25, why: "the project's next step", job: p.nextStep });
  const boost = p.health === "risk" ? 15 : p.health === "watch" ? 8 : 0, idea = p.stage === "idea" ? -10 : 0;
  // HQ never builds on itself; code work elsewhere needs the project on the owner's build list.
  const canBuild = p.slug !== "luthur" && build.includes(p.slug) && (p.paths || []).length > 0;
  const ceiling = minLevel(loadConfig().autonomy?.maxLevel || "build", p.maxPermission || "build");
  return out.map(c => {
    const permission = minLevel(canBuild && (c.kind === "goal" || c.kind === "next") ? "build" : "plan", ceiling);
    return { ...c, score: c.score + boost + idea, permission, title: `Initiative · ${p.name}: ${short(c.job.split("\n")[0].replace(/^Goal "[^"]*": /, ""), 70)}` };
  }).sort((a, b) => b.score - a.score);
}

/** Picks this scan's jobs: at most one per project, skipping busy projects and anything proposed recently.
 *  `busy` = projects with open runs, a pending approval or a task started in the last 12 h. */
export function pick(ctx: { busy: Set<string>; goalSteps: Set<string> }, now = new Date()): Candidate[] {
  const cfg = autonomy.initiativeSettings(), s = load(), t = now.getTime(), build = autonomy.buildProjects();
  s.lastScan = now.toISOString();
  const room = Math.max(0, Math.min(cfg.maxPerScan, cfg.maxPerDay - s.day.count));
  const best: Candidate[] = [];
  if (room) for (const p of brain.listProjects()) {
    if (SKIP_STAGES.has(p.stage) || ctx.busy.has(p.slug)) continue;
    const c = candidatesFor(p, ctx.goalSteps, build, t).find(c => !s.seen[c.key]);
    if (c) best.push(c);
  }
  save(s);
  return best.sort((a, b) => b.score - a.score).slice(0, room);
}

/** Notes what happened to a pick: it isn't proposed again for a week, and it counts toward today's cap. */
export function record(c: Candidate, outcome: "started" | "asked", ref: string) {
  const s = load();
  s.seen[c.key] = new Date(Date.now() + SEEN_DAYS * DAY).toISOString();
  s.day.count++;
  s.recent.unshift({ at: new Date().toISOString(), project: c.project, title: c.title, why: c.why, outcome, ref });
  save(s);
}
/** The owner said no: don't suggest the same job for a month. */
export function rejected(key: string, approvalId: string) {
  const s = load();
  s.seen[key] = new Date(Date.now() + REJECTED_DAYS * DAY).toISOString();
  const e = s.recent.find(x => x.ref === approvalId); if (e) e.outcome = "rejected";
  save(s);
}

export function prompt(c: Candidate): string {
  return [
    `LUTHUR initiative: you picked this job yourself from the brain. Nobody asked for it, so keep it small and useful.`,
    `Project: ${c.name} (${c.project}). Why now: ${c.why}.`,
    ``, `Job: ${c.job}`, ``,
    `How to work:`,
    `- Do the part you can do at your permission level. If the job needs the owner (a decision, their device or account, anything live, public, sent or paid), don't attempt it: prepare it so it takes them two minutes (options with your recommendation, a draft in the brain, a checklist) and say exactly what they must do.`,
    `- Stop after this one job. No new tasks unless something is clearly broken.`,
    `- Check your work before reporting: re-read what you changed${c.permission === "build" ? " and run the project's tests or checks if it has them" : ""}. Say plainly what you could not verify.`,
    `- Record it: one project_log entry, and update nextStep if it moved.`,
  ].join("\n");
}

export function status() {
  const cfg = autonomy.initiativeSettings(), s = load();
  let next: Date | null = !cfg.enabled ? null : new Date(Math.max(Date.now(), s.lastScan ? Date.parse(s.lastScan) + cfg.everyHours * HOUR : 0));
  // Outside the owner's hours (or with today's cap used up) the next look is the next morning.
  if (next && (next.getHours() >= cfg.toHour || s.day.count >= cfg.maxPerDay)) { next.setDate(next.getDate() + 1); next.setHours(cfg.fromHour, 0, 0, 0); }
  else if (next && next.getHours() < cfg.fromHour) next.setHours(cfg.fromHour, 0, 0, 0);
  return { settings: cfg, lastScan: s.lastScan, nextScan: next?.toISOString() || null, today: s.day.count, recent: s.recent.slice(0, 10) };
}
