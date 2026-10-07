// Small, owner-editable preference memory. Full conversations belong in history, not here.
import fs from "node:fs";
import path from "node:path";
import { BRAIN, writeText } from "./store.ts";
import { validSlug } from "./brain.ts";

export type Preference = { id: string; scope: "global" | "project" | "challenger"; project?: string; text: string };
export type Suggestion = Preference & { reason: string };
const PROFILE = path.join(BRAIN, "preferences.md");
const PENDING = path.join(BRAIN, "preference-suggestions.md");
const MAX_ITEMS = 60;
const MAX_TEXT = 220;
const MAX_CONTEXT = 3200;

function read(file: string): string { try { return fs.readFileSync(file, "utf8"); } catch { return ""; } }
function clean(s: unknown, max = MAX_TEXT): string {
  const v = String(s ?? "").replace(/[\r\n|]+/g, " ").replace(/\s+/g, " ").trim();
  if (!v || v.length > max) throw new Error(`Text must be 1-${max} characters.`);
  return v;
}
function scopeOf(scope: string, project?: string): Pick<Preference, "scope" | "project"> {
  if (scope === "project") {
    if (!validSlug(project || "")) throw new Error("A project preference needs a valid project slug.");
    return { scope, project };
  }
  if (scope !== "global" && scope !== "challenger") throw new Error("Scope must be global, project, or challenger.");
  return { scope };
}
function parse<T extends Preference>(file: string, suggestion: boolean): T[] {
  return read(file).split("\n").filter(line => line.startsWith("- ")).flatMap(line => {
    const parts = line.slice(2).split(" | ").map(x => x.trim());
    const [id, scope, project, text, reason] = parts;
    if (!/^p-[a-z0-9-]{1,40}$/.test(id || "") || !text || !["global", "project", "challenger"].includes(scope)) return [];
    if (scope === "project" && !validSlug(project || "")) return [];
    return [{ id, scope, ...(scope === "project" ? { project } : {}), text, ...(suggestion ? { reason: reason || "" } : {}) } as T];
  });
}
function save(file: string, title: string, rows: (Preference | Suggestion)[]): void {
  if (rows.length > MAX_ITEMS) throw new Error("Preference memory is full. Remove or consolidate old items.");
  const lines = rows.map(p => `- ${p.id} | ${p.scope} | ${p.project || "-"} | ${p.text}${"reason" in p ? ` | ${p.reason}` : ""}`);
  writeText(file, `# ${title}\n\nOwner-editable. One concise preference per line.\n\n${lines.join("\n")}${lines.length ? "\n" : ""}`);
}
function freshId(learned = false): string { return `p-${learned ? "l-" : ""}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** Learned (inferred) preferences carry a "p-l-" id; explicit ones win over them in context and pruning. */
export const isLearned = (p: Pick<Preference, "id">) => p.id.startsWith("p-l-");
/** Keeps the memory inside MAX_ITEMS by dropping the oldest learned items; explicit ones are never auto-removed. */
function fit(rows: Preference[]): Preference[] {
  const out = [...rows];
  while (out.length > MAX_ITEMS) { const i = out.findIndex(isLearned); if (i < 0) break; out.splice(i, 1); }
  return out;
}
export function list(): Preference[] { return parse<Preference>(PROFILE, false); }
export function suggestions(): Suggestion[] { return parse<Suggestion>(PENDING, true); }

/** Call only for an explicit instruction or correction from the owner. */
export function remember(input: { text: string; scope: string; project?: string; id?: string }): Preference {
  const rows = list();
  const item: Preference = { id: input.id || freshId(), ...scopeOf(input.scope, input.project), text: clean(input.text) };
  const same = input.id ? -1 : rows.findIndex(p => norm(p.text) === norm(item.text) && p.scope === item.scope && p.project === item.project);
  const index = same >= 0 ? same : rows.findIndex(p => p.id === item.id);
  if (input.id && index < 0) throw new Error("No such preference.");
  if (index >= 0) rows[index] = item; else rows.push(item);
  save(PROFILE, "Owner preferences", fit(rows));
  return item;
}
export function remove(id: string): boolean {
  const rows = list(); const next = rows.filter(p => p.id !== id);
  if (next.length === rows.length) return false;
  save(PROFILE, "Owner preferences", next); return true;
}
/** An inferred pattern is active immediately (owner rule, 2026-10-07) as a learned item the owner can forget.
 * replaces: id of an older preference this one supersedes (keeps the memory free of contradictions). */
export function suggest(input: { text: string; scope: string; project?: string; reason?: string; replaces?: string }): Preference {
  let rows = list();
  const item: Preference = { id: freshId(true), ...scopeOf(input.scope, input.project), text: clean(input.text) };
  const same = rows.find(p => norm(p.text) === norm(item.text) && p.scope === item.scope && p.project === item.project);
  if (same) return same;
  if (input.replaces) rows = rows.filter(p => p.id !== input.replaces);
  rows.push(item); save(PROFILE, "Owner preferences", fit(rows));
  return item;
}
export function review(id: string, accept: boolean): Preference | null {
  const rows = suggestions(); const item = rows.find(p => p.id === id);
  if (!item) throw new Error("No such suggestion.");
  if (accept) remember({ id: undefined, scope: item.scope, project: item.project, text: item.text });
  save(PENDING, "Preference suggestions awaiting owner review", rows.filter(p => p.id !== id));
  return accept ? list().at(-1)! : null;
}
/** Bounded text for an agent prompt; global + relevant project + optional Challenger. */
export function context(project?: string, challenger = false): string {
  const chosen = list().filter(p => p.scope === "global" || (p.scope === "project" && p.project === project) || (challenger && p.scope === "challenger"))
    .map((p, i) => ({ p, i })).sort((a, b) => Number(isLearned(a.p)) - Number(isLearned(b.p)) || (isLearned(a.p) ? b.i - a.i : a.i - b.i)).map(x => x.p);
  // Explicit first in saved order, then learned newest first, so a full budget drops the stalest learned items.
  const lines = ["Owner preferences (direct instructions for this task take precedence):"];
  let used = lines[0].length + 1;
  for (const p of chosen) {
    const line = `- ${p.scope === "project" ? `[${p.project}] ` : p.scope === "challenger" ? "[Challenger] " : ""}${p.text}`;
    if (used + line.length + 1 > MAX_CONTEXT) break;
    lines.push(line); used += line.length + 1;
  }
  return lines.length > 1 ? lines.join("\n") : "";
}
