// The brain: durable memory as plain files under /brain. Shared by the server and the MCP server.
import fs from "node:fs";
import path from "node:path";
import { BRAIN, PROJECTS, TEMPLATES, readJson, readText, writeJson, writeText, uid, localDate, localStamp } from "./store.ts";

export type Phase = { name: string; start?: string; end?: string; status?: string };
export type Project = {
  slug: string; name: string; kind: string; stage: string; health: string;
  summary: string; nextStep: string; updated: string; order?: number;
  paths?: string[]; repos?: string[]; links?: { label: string; url: string }[]; tags?: string[];
  maxPermission?: string; phases?: Phase[]; notes?: string;
};
export type Reminder = { id: string; title: string; due: string; project?: string; repeat?: string | null; done?: boolean; notifiedAt?: string | null; createdAt: string };
export type Milestone = { id: string; date: string; title: string; project?: string; kind?: string; done?: boolean };
export type InboxItem = { id: string; text: string; at: string; project?: string };
export type Step = { id: string; title: string; done?: boolean; notes?: string; due?: string };
export type Goal = { id: string; title: string; project?: string | null; why?: string; due?: string; steps: Step[]; createdAt: string; updated?: string };

export const KINDS = ["business", "product", "workstream", "strategy", "research", "frontier", "tool"];
export const STAGES = ["idea", "planned", "building", "live", "paused", "done"];
export const HEALTH = ["good", "watch", "risk", "unknown"];
const DOCS: Record<string, string> = { summary: "SUMMARY.md", plan: "plan.md", log: "log.md" };
const EDITABLE = ["name", "kind", "stage", "health", "summary", "nextStep", "order", "paths", "repos", "links", "tags", "maxPermission", "phases", "notes"];

const F = {
  reminders: path.join(BRAIN, "reminders.json"),
  milestones: path.join(BRAIN, "milestones.json"),
  inbox: path.join(BRAIN, "inbox.json"),
  decisions: path.join(BRAIN, "decisions.md"),
  index: path.join(BRAIN, "INDEX.md"),
  briefs: path.join(BRAIN, "briefs"),
  goals: path.join(BRAIN, "goals.json"),
};

export function validSlug(s: string): boolean { return /^[a-z0-9][a-z0-9-]{0,40}$/.test(s || ""); }
function pdir(slug: string): string {
  if (!validSlug(slug)) throw new Error(`Bad project slug: ${slug}`);
  return path.join(PROJECTS, slug);
}
export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "project";
}

// ---------- projects ----------
export function listProjects(): Project[] {
  let dirs: string[] = [];
  try { dirs = fs.readdirSync(PROJECTS); } catch { return []; }
  const out: Project[] = [];
  for (const d of dirs) {
    const p = readJson<Project | null>(path.join(PROJECTS, d, "project.json"), null);
    if (p) out.push({ ...p, slug: d });
  }
  return out.sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.name.localeCompare(b.name));
}

export function getProject(slug: string): Project | null {
  const p = readJson<Project | null>(path.join(pdir(slug), "project.json"), null);
  return p ? { ...p, slug } : null;
}

export function updateProject(slug: string, patch: Partial<Project>): Project {
  const cur = getProject(slug);
  if (!cur) throw new Error(`No project ${slug}`);
  const next: any = { ...cur };
  for (const k of EDITABLE) if (k in patch) next[k] = (patch as any)[k];
  next.updated = localDate();
  delete next.slug;
  writeJson(path.join(pdir(slug), "project.json"), next);
  regenerateIndex();
  return { ...next, slug };
}

export function createProject(input: { name: string; kind?: string; summary?: string; stage?: string; slug?: string }): Project {
  const slug = input.slug && validSlug(input.slug) ? input.slug : slugify(input.name);
  const dir = pdir(slug);
  if (fs.existsSync(path.join(dir, "project.json"))) throw new Error(`Project ${slug} already exists`);
  const tdir = path.join(TEMPLATES, "project");
  const fill = (s: string) => s.replaceAll("{{name}}", input.name).replaceAll("{{date}}", localDate()).replaceAll("{{slug}}", slug)
    .replaceAll("{{summary}}", input.summary || "Not written yet.");
  for (const f of fs.readdirSync(tdir)) writeText(path.join(dir, f), fill(readText(path.join(tdir, f))));
  const proj = readJson<any>(path.join(dir, "project.json"), {});
  Object.assign(proj, { name: input.name, kind: input.kind || proj.kind, stage: input.stage || proj.stage, summary: input.summary || proj.summary, updated: localDate(), order: listProjects().length + 1 });
  writeJson(path.join(dir, "project.json"), proj);
  regenerateIndex();
  return { ...proj, slug };
}

export function readDoc(slug: string, part: string): string {
  const f = DOCS[part];
  if (!f) throw new Error(`Unknown doc ${part}`);
  return readText(path.join(pdir(slug), f));
}

export function writeDoc(slug: string, part: string, content: string, opts: { capSummary?: boolean } = {}): void {
  const f = DOCS[part];
  if (!f || part === "log") throw new Error(`Can't overwrite ${part}; use project_log for the log`);
  if (opts.capSummary && part === "summary" && content.split("\n").length > 60) throw new Error("SUMMARY.md must stay under ~40-60 lines. Move detail into plan.md.");
  writeText(path.join(pdir(slug), f), content.endsWith("\n") ? content : content + "\n");
  touch(slug);
}

function touch(slug: string) {
  const file = path.join(pdir(slug), "project.json");
  const p = readJson<any>(file, null);
  if (p) { p.updated = localDate(); writeJson(file, p); regenerateIndex(); }
}

/** Newest-first dated log. Old entries roll into archive/ so the live log stays small. */
export function addLog(slug: string, text: string, source = "you"): void {
  const file = path.join(pdir(slug), "log.md");
  const cur = readText(file, "# Log\n");
  const head = cur.startsWith("# ") ? cur.slice(0, cur.indexOf("\n") + 1) : "# Log\n";
  const body = cur.startsWith("# ") ? cur.slice(cur.indexOf("\n") + 1) : cur;
  let next = `${head}\n## ${localStamp()} · ${source}\n${text.trim()}\n${body.startsWith("\n") ? body : "\n" + body}`;
  if (next.length > 12000) {
    const cut = next.lastIndexOf("\n## ", 8000);
    if (cut > 0) {
      const archive = path.join(pdir(slug), "archive", `log-${localDate().slice(0, 7)}.md`);
      writeText(archive, readText(archive, "# Log archive\n") + next.slice(cut));
      next = next.slice(0, cut) + "\n\n_Older entries: archive/_\n";
    }
  }
  writeText(file, next.replace(/\n{3,}/g, "\n\n"));
  touch(slug);
}

// ---------- reminders ----------
export function listReminders(): Reminder[] {
  return readJson<Reminder[]>(F.reminders, []).sort((a, b) => a.due.localeCompare(b.due));
}
export function addReminder(r: { title: string; due: string; project?: string; repeat?: string | null }): Reminder {
  const due = normalizeWhen(r.due);
  const item: Reminder = { id: uid("r"), title: r.title.trim(), due, project: r.project || undefined, repeat: r.repeat || null, done: false, notifiedAt: null, createdAt: new Date().toISOString() };
  const all = listReminders(); all.push(item); writeJson(F.reminders, all); regenerateIndex();
  return item;
}
export function updateReminder(id: string, patch: Partial<Reminder>): Reminder {
  const all = listReminders();
  const r = all.find(x => x.id === id);
  if (!r) throw new Error("No such reminder");
  if (patch.due) { patch.due = normalizeWhen(patch.due); patch.notifiedAt = null; }
  Object.assign(r, patch);
  writeJson(F.reminders, all); regenerateIndex();
  return r;
}
export function completeReminder(id: string): Reminder {
  const all = listReminders();
  const r = all.find(x => x.id === id);
  if (!r) throw new Error("No such reminder");
  if (r.repeat) { r.due = advance(r.due, r.repeat); r.notifiedAt = null; }
  else r.done = true;
  writeJson(F.reminders, all); regenerateIndex();
  return r;
}
export function deleteReminder(id: string): void {
  writeJson(F.reminders, listReminders().filter(x => x.id !== id)); regenerateIndex();
}
export function markNotified(id: string): void {
  const all = listReminders(); const r = all.find(x => x.id === id);
  if (r) { r.notifiedAt = new Date().toISOString(); writeJson(F.reminders, all); }
}

/** Accepts "2026-10-12", "2026-10-12 09:30" or an ISO string; returns local "YYYY-MM-DDTHH:MM". */
export function normalizeWhen(s: string): string {
  const m = String(s).trim().match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (!m) throw new Error(`Can't read date "${s}". Use YYYY-MM-DD or YYYY-MM-DD HH:MM`);
  const hh = m[2] ? m[2].padStart(2, "0") : "09";
  return `${m[1]}T${hh}:${m[3] || "00"}`;
}
export function whenToDate(s: string): Date { return new Date(normalizeWhen(s)); }
function advance(due: string, repeat: string): string {
  const d = whenToDate(due);
  const now = new Date();
  do {
    if (repeat === "daily") d.setDate(d.getDate() + 1);
    else if (repeat === "weekly") d.setDate(d.getDate() + 7);
    else if (repeat === "monthly") d.setMonth(d.getMonth() + 1);
    else break;
  } while (d <= now);
  return `${localDate(d)}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ---------- milestones ----------
export function listMilestones(): Milestone[] {
  return readJson<Milestone[]>(F.milestones, []).sort((a, b) => a.date.localeCompare(b.date));
}
export function addMilestone(m: { date: string; title: string; project?: string; kind?: string }): Milestone {
  const item: Milestone = { id: uid("m"), date: normalizeWhen(m.date).slice(0, 10), title: m.title.trim(), project: m.project || undefined, kind: m.kind || "milestone", done: false };
  const all = listMilestones(); all.push(item); writeJson(F.milestones, all); regenerateIndex();
  return item;
}
export function updateMilestone(id: string, patch: Partial<Milestone>): Milestone {
  const all = listMilestones(); const m = all.find(x => x.id === id);
  if (!m) throw new Error("No such milestone");
  Object.assign(m, patch); writeJson(F.milestones, all); regenerateIndex();
  return m;
}
export function deleteMilestone(id: string): void {
  writeJson(F.milestones, listMilestones().filter(x => x.id !== id)); regenerateIndex();
}

// ---------- inbox ----------
export function listInbox(): InboxItem[] { return readJson<InboxItem[]>(F.inbox, []); }
export function addInbox(text: string, project?: string): InboxItem {
  const item: InboxItem = { id: uid("i"), text: text.trim(), at: localStamp(), project };
  const all = listInbox(); all.push(item); writeJson(F.inbox, all);
  return item;
}
export function removeInbox(ids: string[]): number {
  const all = listInbox(); const keep = all.filter(x => !ids.includes(x.id));
  writeJson(F.inbox, keep); return all.length - keep.length;
}

// ---------- decisions ----------
export function addDecision(text: string, project?: string, why?: string): void {
  const cur = readText(F.decisions, "# Decisions\n\nNewest first. What was decided, and why.\n");
  const idx = cur.indexOf("\n- ");
  const line = `- **${localDate()}**${project ? ` [${project}]` : ""} ${text.trim()}${why ? ` _Why:_ ${why.trim()}` : ""}`;
  const next = idx < 0 ? `${cur.trimEnd()}\n\n${line}\n` : `${cur.slice(0, idx)}\n${line}${cur.slice(idx)}`;
  writeText(F.decisions, next);
}
export function recentDecisions(n = 15, project?: string): string[] {
  return readText(F.decisions).split("\n").filter(l => l.startsWith("- ") && (!project || l.includes(`[${project}]`))).slice(0, n);
}

// ---------- briefs ----------
export function writeBrief(text: string): string {
  const file = path.join(F.briefs, `${localDate()}.md`);
  writeText(file, text.endsWith("\n") ? text : text + "\n");
  return file;
}
export function latestBrief(): { date: string; text: string } | null {
  try {
    const files = fs.readdirSync(F.briefs).filter(f => f.endsWith(".md")).sort();
    const last = files.at(-1);
    return last ? { date: last.slice(0, 10), text: readText(path.join(F.briefs, last)) } : null;
  } catch { return null; }
}

// ---------- goals (Mission Planner) ----------
export function listGoals(): Goal[] { return readJson<Goal[]>(F.goals, []); }
export function saveGoal(input: Partial<Goal> & { title: string }): Goal {
  const all = listGoals();
  const i = input.id ? all.findIndex(g => g.id === input.id) : -1;
  const base: Goal = i >= 0 ? all[i] : { id: uid("g"), title: "", steps: [], createdAt: new Date().toISOString() };
  const g: Goal = { ...base, ...input, id: base.id, updated: new Date().toISOString() };
  if (!g.title?.trim()) throw new Error("A goal needs a title.");
  g.steps = (g.steps || []).filter(st => st && String(st.title || "").trim()).map(st => ({ ...st, id: st.id || uid("s"), title: String(st.title).trim(), done: !!st.done }));
  if (i >= 0) all[i] = g; else all.push(g);
  writeJson(F.goals, all); regenerateIndex();
  return g;
}
export function deleteGoal(id: string): void { writeJson(F.goals, listGoals().filter(g => g.id !== id)); regenerateIndex(); }
export function setStepDone(goalId: string, stepId: string, done: boolean): Goal {
  const all = listGoals(); const g = all.find(x => x.id === goalId);
  const st = g?.steps.find(x => x.id === stepId);
  if (!g || !st) throw new Error("No such goal/step");
  st.done = done; g.updated = new Date().toISOString();
  writeJson(F.goals, all); regenerateIndex();
  return g;
}

// ---------- search across the brain ----------
export function searchBrain(q: string, limit = 40): { file: string; project: string | null; line: number; text: string }[] {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const out: { file: string; project: string | null; line: number; text: string }[] = [];
  const walk = (dir: string) => {
    let names: string[] = [];
    try { names = fs.readdirSync(dir); } catch { return; }
    for (const n of names) {
      const p = path.join(dir, n);
      if (n === "templates" || n.endsWith(".tmp")) continue;
      let st: fs.Stats; try { st = fs.statSync(p); } catch { continue; }
      if (st.isDirectory()) { walk(p); continue; }
      if (!/\.(md|json)$/.test(n)) continue;
      const rel = path.relative(BRAIN, p).split(path.sep).join("/");
      const proj = rel.startsWith("projects/") ? rel.split("/")[1] : null;
      readText(p).split("\n").forEach((line, i) => {
        if (out.length >= limit) return;
        const low = line.toLowerCase();
        if (terms.every(t => low.includes(t))) out.push({ file: rel, project: proj, line: i + 1, text: line.trim().slice(0, 220) });
      });
    }
  };
  walk(BRAIN);
  return out;
}

// ---------- INDEX.md: the tiny always-loaded map (no tokens to build) ----------
export function regenerateIndex(): void {
  const projects = listProjects();
  const now = new Date();
  const soon = new Date(now.getTime() + 14 * 864e5);
  const reminders = listReminders().filter(r => !r.done && whenToDate(r.due) <= soon).slice(0, 8);
  const milestones = listMilestones().filter(m => !m.done && new Date(m.date + "T23:59") >= now).slice(0, 6);
  const lines = [
    "# HQ index",
    "",
    `_Auto-generated ${localStamp()}. Don't edit; change project.json files instead._`,
    "",
    "| project | kind | stage | health | next step | updated |",
    "|---|---|---|---|---|---|",
    ...projects.map(p => `| ${p.slug} | ${p.kind} | ${p.stage} | ${p.health} | ${(p.nextStep || "").replace(/\|/g, "/")} | ${p.updated} |`),
    "",
    "## Due in the next 14 days",
    ...(reminders.length ? reminders.map(r => `- ${r.due.replace("T", " ")} ${r.title}${r.project ? ` [${r.project}]` : ""}`) : ["- nothing"]),
    "",
    "## Next milestones",
    ...(milestones.length ? milestones.map(m => `- ${m.date} ${m.title}${m.project ? ` [${m.project}]` : ""}`) : ["- none"]),
    "",
    "## Goals (Mission Planner)",
    ...(listGoals().length ? listGoals().map(g => `- ${g.title}${g.project ? ` [${g.project}]` : ""}: ${g.steps.filter(x => x.done).length}/${g.steps.length} steps${g.due ? `, due ${g.due}` : ""}`) : ["- none"]),
    "",
    "Per project: brain/projects/<slug>/SUMMARY.md (short) → plan.md → log.md. Decisions: brain/decisions.md.",
    "",
  ];
  writeText(F.index, lines.join("\n"));
}
export function readIndex(): string {
  if (!fs.existsSync(F.index)) regenerateIndex();
  return readText(F.index);
}
