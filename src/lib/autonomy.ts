// Fast-approve rules + learned suggestions (autonomy phases 2-3, docs/AUTONOMY-DESIGN.md).
// Rules live in config/autonomy-rules.json. Only the owner changes them (dashboard API). Agents are denied config/**,
// and guard.ts puts back any agent change there. A new rule spends a week on trial: it only notes "would have
// auto-approved". It goes live after the trial unless the owner rejected a task it matched. LUTHUR can suggest
// rules from the owner's approve/reject history, but only the owner turns one on. An Undo or rejection turns one off.
// Code only, no model calls.
import fs from "node:fs";
import path from "node:path";
import { CONFIG, DATA, appendLine, readJson, uid, writeJson } from "./store.ts";
import { levelRank } from "./config.ts";
import * as brain from "./brain.ts";

const FILE = path.join(CONFIG, "autonomy-rules.json"), DECISIONS = path.join(DATA, "autonomy", "decisions.jsonl");
const TRIAL_DAYS = 7, DAY = 864e5, SUGGEST_AFTER = 5, SUGGEST_WINDOW = 30 * DAY;

export type Rule = {
  id: string; title: string; project: string | null; maxPermission: "read" | "plan" | "build"; engine: "claude" | "codex" | null;
  titleMatch: string | null; source: "owner" | "suggested"; createdAt: string; trialUntil: string;
  state: "trial" | "live" | "off"; trialFailed?: string | null; offReason?: string | null; matches?: number; lastMatch?: string | null;
};
type Store = { rules: Rule[]; buildProjects: string[]; dismissed: Record<string, string> };
export type TaskRequest = { project?: string | null; permission: string; engine?: string | null; title: string };

function load(): Store {
  const s = readJson<Partial<Store>>(FILE, {});
  return { rules: Array.isArray(s.rules) ? s.rules : [], buildProjects: Array.isArray(s.buildProjects) ? s.buildProjects : [], dismissed: s.dismissed || {} };
}
function save(s: Store) { writeJson(FILE, s); }

function covers(r: Rule, q: TaskRequest, build: string[]): boolean {
  if (r.state === "off") return false;
  if (levelRank(q.permission as any) > levelRank(r.maxPermission)) return false;
  // Build work without asking is only for projects the owner listed for it.
  if (q.permission === "build" && !(q.project && build.includes(q.project))) return false;
  if (r.project && r.project !== q.project) return false;
  if (r.engine && r.engine !== (q.engine || "claude")) return false;
  if (r.titleMatch && !q.title.toLowerCase().includes(r.titleMatch.toLowerCase())) return false;
  return true;
}

/** The rule that covers this task request, and whether it may start the task now (live) or only notes it (trial). */
export function match(q: TaskRequest): { rule: Rule; live: boolean } | null {
  const s = load(); let changed = false;
  for (const r of s.rules) if (r.state === "trial" && !r.trialFailed && Date.parse(r.trialUntil) <= Date.now()) { r.state = "live"; changed = true; }
  const rule = s.rules.find(r => covers(r, q, s.buildProjects)) || null;
  if (rule) { rule.matches = (rule.matches || 0) + 1; rule.lastMatch = new Date().toISOString(); changed = true; }
  if (changed) save(s);
  return rule ? { rule, live: rule.state === "live" } : null;
}

export function list() {
  const s = load();
  return { rules: s.rules, buildProjects: s.buildProjects, suggestions: suggestions(s), trialDays: TRIAL_DAYS };
}

export function addRule(input: Partial<Rule>, source: Rule["source"] = "owner"): Rule {
  const s = load();
  const perm = ["read", "plan", "build"].includes(String(input.maxPermission)) ? input.maxPermission! : "plan";
  const project = input.project ? String(input.project) : null;
  if (project && !brain.getProject(project)) throw new Error(`Unknown project ${project}`);
  const r: Rule = {
    id: uid("rule"), title: String(input.title || "").trim().slice(0, 120) || `${perm}-level tasks${project ? ` for ${project}` : ""}`,
    project, maxPermission: perm, engine: input.engine === "codex" || input.engine === "claude" ? input.engine : null,
    titleMatch: input.titleMatch ? String(input.titleMatch).trim().slice(0, 80) || null : null, source,
    createdAt: new Date().toISOString(), trialUntil: new Date(Date.now() + TRIAL_DAYS * DAY).toISOString(), state: "trial", matches: 0,
  };
  s.rules.push(r); save(s); note("rule-added", { rule: r.id, title: r.title, source });
  return r;
}
/** Owner edits: turn off, back on (restarts the trial), or straight to live. */
export function setRule(id: string, state: "off" | "trial" | "live"): Rule {
  const s = load(); const r = s.rules.find(x => x.id === id);
  if (!r) throw Object.assign(new Error("No such rule"), { code: 404 });
  r.state = state; r.offReason = state === "off" ? "turned off by you" : null;
  if (state === "trial") { r.trialUntil = new Date(Date.now() + TRIAL_DAYS * DAY).toISOString(); r.trialFailed = null; }
  save(s); note("rule-" + state, { rule: id }); return r;
}
export function deleteRule(id: string) { const s = load(); s.rules = s.rules.filter(r => r.id !== id); save(s); note("rule-deleted", { rule: id }); return { ok: true }; }
export function setBuildProjects(list: unknown) {
  const s = load();
  s.buildProjects = (Array.isArray(list) ? list : []).map(String).filter(x => brain.getProject(x)).slice(0, 30);
  save(s); return { buildProjects: s.buildProjects };
}

/** Demotion is never gated: an Undo of an auto-started task's work turns its rule off at once. */
export function demote(ruleId: string, reason: string) {
  const s = load(); const r = s.rules.find(x => x.id === ruleId);
  if (!r || r.state === "off") return;
  r.state = "off"; r.offReason = reason; save(s); note("rule-demoted", { rule: ruleId, reason });
}

// ---------- learning from the owner's decisions ----------
const keyOf = (q: { project?: string | null; permission: string }) => `${q.project || "*"}|${q.permission}`;
export function recordDecision(q: TaskRequest, approve: boolean, trialRule?: string | null) {
  appendLine(DECISIONS, JSON.stringify({ at: new Date().toISOString(), key: keyOf(q), approve, title: q.title.slice(0, 120), project: q.project || null, permission: q.permission, engine: q.engine || null }));
  // A rejected task that a trial rule would have started means the rule is wrong: it stays on trial.
  if (!approve && trialRule) {
    const s = load(); const r = s.rules.find(x => x.id === trialRule);
    if (r && r.state === "trial") { r.trialFailed = `you rejected "${q.title.slice(0, 80)}" on ${new Date().toLocaleDateString()}`; save(s); note("rule-trial-failed", { rule: r.id }); }
  }
  trimDecisions();
}
function decisions(): any[] {
  try { return fs.readFileSync(DECISIONS, "utf8").trim().split("\n").map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; }
}
function trimDecisions() {
  const all = decisions(); if (all.length < 3000) return;
  const keep = all.filter(d => Date.now() - Date.parse(d.at) < 120 * DAY).slice(-2000);
  fs.writeFileSync(DECISIONS, keep.map(d => JSON.stringify(d)).join("\n") + "\n");
}
/** Kinds of task the owner always approves (5+ yes, no no, in 30 days) and no rule covers yet. Never build. */
function suggestions(s: Store) {
  const by = new Map<string, { yes: number; no: number; project: string | null; permission: string; examples: string[] }>();
  for (const d of decisions()) {
    if (Date.now() - Date.parse(d.at) > SUGGEST_WINDOW || d.permission === "build") continue;
    const g = by.get(d.key) || { yes: 0, no: 0, project: d.project, permission: d.permission, examples: [] };
    if (d.approve) { g.yes++; if (g.examples.length < 3) g.examples.push(d.title); } else g.no++;
    by.set(d.key, g);
  }
  const out = [];
  for (const [key, g] of by) {
    if (g.no || g.yes < SUGGEST_AFTER) continue;
    if (s.dismissed[key] && Date.parse(s.dismissed[key]) > Date.now()) continue;
    if (s.rules.some(r => r.state !== "off" && covers(r, { project: g.project, permission: g.permission, title: "", engine: null }, s.buildProjects))) continue;
    const name = g.project ? brain.getProject(g.project)?.name || g.project : "any project";
    out.push({ key, project: g.project, permission: g.permission, approvals: g.yes, examples: g.examples, title: `Start ${g.permission}-level tasks for ${name} without asking` });
  }
  return out;
}
export function answerSuggestion(key: string, accept: boolean) {
  const s = load(); const sug = suggestions(s).find(x => x.key === key);
  if (!sug) throw Object.assign(new Error("That suggestion is gone."), { code: 404 });
  if (accept) return addRule({ title: sug.title, project: sug.project, maxPermission: sug.permission as Rule["maxPermission"] }, "suggested");
  s.dismissed[key] = new Date(Date.now() + 30 * DAY).toISOString(); save(s); return { ok: true };
}

function note(event: string, detail: Record<string, unknown>) {
  appendLine(path.join(DATA, "activity.jsonl"), JSON.stringify({ at: new Date().toISOString(), event, ...detail }));
}
