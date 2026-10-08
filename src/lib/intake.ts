// "Talk it through" intake. A complex request becomes a live, editable task brief; "go" starts it as a plan.
// The owner's original words are kept verbatim next to the brief, so intent survives every edit. Every change is
// recorded (who, which field, before/after). Questions are only for things that change how the work is done; each
// one carries a recommended default, so "go anyway" can start with those.
import path from "node:path";
import { DATA, readJson, uid, writeJson } from "./store.ts";
import { loadConfig, minLevel, type Level } from "./config.ts";
import * as brain from "./brain.ts";

export type Question = { id: string; q: string; why?: string; recommended?: string; answer?: string | null; answeredAt?: string };
export type Brief = {
  id: string; createdAt: string; updatedAt: string; by: string;
  status: "review" | "started" | "cancelled" | "done";
  original: string;                 // verbatim request, never edited
  title: string; outcome: string; deliverable: string; project: string | null;
  sources: string[]; scope: string; exclusions: string[]; constraints: string[];
  permission: Level; successCriteria: string[]; assumptions: string[];
  budget: { minutes: number; agents: number };
  questions: Question[];
  edits: { at: string; by: string; field: string; before: unknown; after: unknown }[];
  planId?: string | null;
};
const FILE = path.join(DATA, "briefs.json");
const KEEP = 100;
const FIELDS = ["title", "outcome", "deliverable", "project", "sources", "scope", "exclusions", "constraints", "permission", "successCriteria", "assumptions", "budget"] as const;

export function list(): Brief[] { const a = readJson<Brief[]>(FILE, []); return Array.isArray(a) ? a : []; }
function save(all: Brief[]) { writeJson(FILE, all.slice(0, KEEP)); }
export function get(id: string): Brief | null { return list().find(b => b.id === id) || null; }
/** The brief the owner is currently reviewing (newest), if any. */
export function active(): Brief | null { return list().find(b => b.status === "review") || null; }
export const ready = (b: Brief) => b.questions.every(q => q.answer != null && String(q.answer).trim() !== "");

const str = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const arr = (v: unknown, n = 12, len = 300) => (Array.isArray(v) ? v : typeof v === "string" && v.trim() ? v.split(/\n|;\s/) : []).map(x => str(x, len)).filter(Boolean).slice(0, n);
function ceiling(project: string | null): Level {
  const p = project ? brain.getProject(project) : null;
  return minLevel(loadConfig().autonomy?.maxLevel || "build", p?.maxPermission || "build");
}
function clean(field: string, v: unknown, b: Partial<Brief>): unknown {
  switch (field) {
    case "title": return str(v, 120);
    case "outcome": case "deliverable": case "scope": return str(v, 1200);
    case "project": { const s = str(v, 60); if (!s) return null; if (!brain.getProject(s)) throw new Error(`Unknown project ${s}`); return s; }
    case "sources": case "exclusions": case "constraints": case "successCriteria": case "assumptions": return arr(v);
    case "permission": return minLevel(str(v, 10) || "plan", ceiling((b.project as string) ?? null));
    case "budget": { const o: any = v || {}; return { minutes: Math.max(5, Math.min(480, Number(o.minutes) || 60)), agents: Math.max(1, Math.min(8, Number(o.agents) || 4)) }; }
  }
  return v;
}

export function create(input: Partial<Brief> & { original: string; questions?: Partial<Question>[] }, by = "chat"): Brief {
  const original = String(input.original || "").trim().slice(0, 8000);
  if (!original) throw new Error("A brief needs the original request.");
  const now = new Date().toISOString();
  const b: Brief = { id: uid("br"), createdAt: now, updatedAt: now, by, status: "review", original, title: "", outcome: "", deliverable: "", project: null,
    sources: [], scope: "", exclusions: [], constraints: [], permission: "plan", successCriteria: [], assumptions: [], budget: { minutes: 60, agents: 4 }, questions: [], edits: [] };
  b.project = clean("project", input.project, b) as string | null;
  for (const f of FIELDS) if (f !== "project" && input[f] !== undefined) (b as any)[f] = clean(f, input[f], b);
  if (input.permission === undefined) b.permission = clean("permission", "plan", b) as Level;
  if (!b.title) b.title = str(original.split("\n")[0], 80);
  b.questions = (input.questions || []).slice(0, 3).map(q => ({ id: uid("q"), q: str(q.q, 300), why: str(q.why, 200) || undefined, recommended: str(q.recommended, 300) || undefined, answer: null })).filter(q => q.q);
  // A newer brief replaces an older one still in review: only one live brief at a time.
  const all = list();
  for (const o of all) if (o.status === "review") { o.status = "cancelled"; o.updatedAt = now; }
  all.unshift(b); save(all);
  return b;
}
/** Corrections from the owner (chat, voice or the card). answers: {questionId|index: text}. addQuestions only while in review. */
export function update(id: string, patch: Partial<Record<(typeof FIELDS)[number], unknown>> & { answers?: Record<string, string>; addQuestions?: Partial<Question>[]; removeQuestions?: string[] }, by = "owner"): Brief {
  const all = list(), b = all.find(x => x.id === id);
  if (!b) throw Object.assign(new Error("No such brief"), { code: 404 });
  if (b.status !== "review") throw new Error("This brief already started or was cancelled.");
  const at = new Date().toISOString();
  for (const f of FIELDS) {
    if ((patch as any)[f] === undefined) continue;
    const after = clean(f, (patch as any)[f], b), before = (b as any)[f];
    if (JSON.stringify(after) === JSON.stringify(before)) continue;
    (b as any)[f] = after; b.edits.push({ at, by, field: f, before, after });
    if (f === "project") b.permission = clean("permission", b.permission, b) as Level; // a new project may lower the ceiling
  }
  for (const [k, v] of Object.entries(patch.answers || {})) {
    const q = b.questions.find((x, i) => x.id === k || String(i + 1) === k); if (!q) continue;
    const a = str(v, 600); if (!a) continue;
    b.edits.push({ at, by, field: `answer:${q.id}`, before: q.answer ?? null, after: a }); q.answer = a; q.answeredAt = at;
  }
  for (const qid of patch.removeQuestions || []) { const i = b.questions.findIndex(q => q.id === qid); if (i >= 0) { b.edits.push({ at, by, field: `remove:${qid}`, before: b.questions[i].q, after: null }); b.questions.splice(i, 1); } }
  for (const q of (patch.addQuestions || []).slice(0, Math.max(0, 3 - b.questions.length))) { const n = { id: uid("q"), q: str(q.q, 300), why: str(q.why, 200) || undefined, recommended: str(q.recommended, 300) || undefined, answer: null }; if (n.q) b.questions.push(n); }
  b.updatedAt = at; save(all);
  return b;
}
export function cancel(id: string, by = "owner"): Brief { return setStatus(id, "cancelled", by); }
export function markStarted(id: string, planId: string, useDefaults: boolean): Brief {
  const all = list(), b = all.find(x => x.id === id);
  if (!b) throw Object.assign(new Error("No such brief"), { code: 404 });
  if (b.status !== "review") throw new Error("This brief already started or was cancelled.");
  const at = new Date().toISOString();
  // "Go anyway": open questions take their recommended default, recorded as an assumption (never as the owner's answer).
  if (useDefaults) for (const q of b.questions) if (q.answer == null) b.assumptions.push(`Assumed (recommended default, not confirmed): ${q.q} → ${q.recommended || "LUTHUR's best judgment"}`);
  b.status = "started"; b.planId = planId; b.updatedAt = at; b.edits.push({ at, by: "owner", field: "status", before: "review", after: "started" });
  save(all); return b;
}
export function attachPlan(id: string, planId: string) { const all = list(), b = all.find(x => x.id === id); if (b) { b.planId = planId; save(all); } }
export function setStatus(id: string, status: Brief["status"], by = "owner"): Brief {
  const all = list(), b = all.find(x => x.id === id);
  if (!b) throw Object.assign(new Error("No such brief"), { code: 404 });
  const at = new Date().toISOString(); b.edits.push({ at, by, field: "status", before: b.status, after: status }); b.status = status; b.updatedAt = at; save(all); return b;
}

/** Code-only routing hint: is this request big enough to deserve a brief instead of doing it in the chat? */
export function looksComplex(text: string): boolean {
  const t = String(text || "").toLowerCase(), words = t.split(/\s+/).filter(Boolean).length;
  const verbs = (t.match(/\b(build|implement|create|research|investigate|compare|analy[sz]e|write up|draft|plan|design|migrate|refactor|audit|set up|prepare|organi[sz]e|review|fix)\b/g) || []).length;
  const multi = /\b(and then|after that|then|also|plus|as well as|step|phase|first|finally)\b/.test(t) || /\n\s*[-*\d]/.test(text);
  return (verbs >= 1 && words >= 25) || (verbs >= 2 && multi) || words >= 60;
}

/** The brief as one block of text for the planner and every worker (the original words first). */
export function compile(b: Brief): string {
  const L = (h: string, a: string[]) => a.length ? [`${h}:`, ...a.map(x => `- ${x}`)] : [];
  return [
    `Original request (owner's words, verbatim):\n"""${b.original}"""`,
    `Outcome: ${b.outcome || "(see request)"}`, `Deliverable: ${b.deliverable || "(see request)"}`,
    `Project: ${b.project || "HQ-wide"} · Permission: ${b.permission} · Budget: ~${b.budget.minutes} min, up to ${b.budget.agents} agents`,
    b.scope ? `Scope: ${b.scope}` : "", ...L("Out of scope", b.exclusions), ...L("Constraints", b.constraints), ...L("Sources", b.sources),
    ...L("Success criteria", b.successCriteria), ...L("Assumptions", b.assumptions),
    ...L("Owner answers", b.questions.filter(q => q.answer).map(q => `${q.q} → ${q.answer}`)),
  ].filter(Boolean).join("\n");
}
export function view(b: Brief) { return { ...b, ready: ready(b) }; }
