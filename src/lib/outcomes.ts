// Outcome learning: the owner rates finished work (good / not right, plus an optional note). Ratings become
// reliability numbers, lessons that later runs and the planner read, and a trust signal for fast-approve rules
// (a "not right" on work a rule started turns that rule off). Code only, no model calls.
import fs from "node:fs";
import path from "node:path";
import { BRAIN, DATA, PROJECTS, appendLine, localDate, readText, writeText } from "./store.ts";

const FILE = path.join(DATA, "outcomes.jsonl");
const DAY = 864e5, MAX_LESSONS = 40;

export type Outcome = {
  at: string; id: string; kind: "task" | "plan"; title: string; project: string | null;
  good: boolean; note: string; status: string; autoRule: string | null;
};

export function all(): Outcome[] {
  try { return fs.readFileSync(FILE, "utf8").trim().split("\n").map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; }
}
/** The latest rating per item (a re-rating replaces the earlier one). */
export function latest(): Map<string, Outcome> {
  const m = new Map<string, Outcome>();
  for (const o of all()) m.set(o.id, o);
  return m;
}
export function ratingOf(id: string): Outcome | null { return latest().get(id) || null; }

export function record(o: Omit<Outcome, "at">): Outcome {
  const row: Outcome = { at: new Date().toISOString(), ...o, title: o.title.slice(0, 160), note: o.note.trim().slice(0, 600) };
  appendLine(FILE, JSON.stringify(row));
  trim();
  if (!row.good && row.note) addLesson(row.project, `${row.title.slice(0, 80)}: ${row.note}`);
  return row;
}
function trim() {
  try { if (fs.statSync(FILE).size < 2e6) return; } catch { return; }
  const keep = all().filter(o => Date.now() - Date.parse(o.at) < 365 * DAY).slice(-4000);
  fs.writeFileSync(FILE, keep.map(o => JSON.stringify(o)).join("\n") + "\n");
}

// ---------- lessons (owner-editable Markdown in the brain) ----------
export function lessonsFile(project: string | null): string {
  return project && /^[a-z0-9-]{1,60}$/.test(project) && fs.existsSync(path.join(PROJECTS, project)) ? path.join(PROJECTS, project, "lessons.md") : path.join(BRAIN, "lessons.md");
}
const HEAD = "# Lessons\n\nWhat went wrong before and how to do it next time (newest first). Written when the owner marks work \"not right\" with a note. Edit freely.\n\n";
export function addLesson(project: string | null, text: string) {
  const file = lessonsFile(project), line = `- ${localDate()}: ${text.replace(/\s+/g, " ").trim().slice(0, 300)}`;
  const old = readText(file, "").split("\n").filter(l => l.startsWith("- "));
  writeText(file, HEAD + [line, ...old].slice(0, MAX_LESSONS).join("\n") + "\n");
}
/** Recent lessons for a run: the project's own plus HQ-wide ones. Empty when there are none. */
export function lessons(project: string | null, n = 6): string[] {
  const read = (f: string) => readText(f, "").split("\n").filter(l => l.startsWith("- ")).map(l => l.slice(2));
  const own = project ? read(lessonsFile(project)) : [];
  const global = read(path.join(BRAIN, "lessons.md"));
  return [...own.slice(0, n), ...global.slice(0, Math.max(2, n - own.length))].slice(0, n);
}

// ---------- reliability ----------
export type Reliability = {
  days: number; finished: number; done: number; partly: number; issue: number;
  rated: number; good: number; bad: number; falseDone: number; score: number | null; unrated: number;
  recentBad: { id: string; title: string; note: string; at: string }[];
};
/** finished = HQ's own task/plan results in the window; ratings come from the owner. falseDone = the owner said
 *  "not right" about something HQ had reported as done: the number that matters most for trust. */
export function reliability(finished: { id: string; status: string; at: string }[], days = 30): Reliability {
  const since = Date.now() - days * DAY, rated = latest();
  const fin = finished.filter(f => Date.parse(f.at) >= since);
  const r: Reliability = { days, finished: fin.length, done: 0, partly: 0, issue: 0, rated: 0, good: 0, bad: 0, falseDone: 0, score: null, unrated: 0, recentBad: [] };
  for (const f of fin) {
    if (f.status === "done") r.done++; else if (f.status === "partly") r.partly++; else if (f.status === "issue") r.issue++;
    const o = rated.get(f.id);
    if (!o) { r.unrated++; continue; }
    r.rated++;
    if (o.good) r.good++; else { r.bad++; if (o.status === "done") r.falseDone++; }
  }
  r.score = r.rated ? Math.round(100 * r.good / r.rated) : null;
  r.recentBad = [...rated.values()].filter(o => !o.good && Date.parse(o.at) >= since).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5).map(o => ({ id: o.id, title: o.title, note: o.note, at: o.at }));
  return r;
}
