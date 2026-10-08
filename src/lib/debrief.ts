// Evening debrief: what LUTHUR did today, what waits for the owner, and what is due tomorrow. Code only (no model
// call): orchestrator.debrief() gathers the facts HQ already records, this file words and stores them.
// Sent once a day at config debrief.hour (default 21:00), and only when something happened.
import fs from "node:fs";
import path from "node:path";
import { DATA, readText, writeText } from "./store.ts";

const DIR = path.join(DATA, "debriefs");

export type DebriefInput = {
  date: string; // YYYY-MM-DD, local
  tasks: { title: string; status: string; project?: string | null }[];
  missionsDone: number; missionsFailed: { title: string; status: string }[];
  waiting: { title: string }[];
  changes: { summary: string; project?: string | null }[];
  picks: { title: string; outcome: string }[];
  tomorrow: { title: string; when?: string; kind: "reminder" | "milestone"; project?: string | null }[];
  overdue: number;
  projectName?: (slug: string) => string;
};
export type Debrief = { date: string; text: string; headline: string; empty: boolean };

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function compose(i: DebriefInput): Debrief {
  const name = (p?: string | null) => p ? ` · ${i.projectName ? i.projectName(p) : p}` : "";
  const clean = (t: string) => t.replace(/^Initiative · /, "").replace(/\s+/g, " ").trim();
  const done = i.tasks.filter(t => t.status === "done"), partly = i.tasks.filter(t => t.status === "partly"), issue = i.tasks.filter(t => t.status === "issue");
  const empty = !i.tasks.length && !i.missionsDone && !i.missionsFailed.length && !i.changes.length && !i.picks.length;

  const parts: string[] = [];
  if (i.tasks.length) parts.push(`${plural(i.tasks.length, "task")} (${[done.length && `${done.length} done`, partly.length && `${partly.length} partly done`, issue.length && `${issue.length} need${issue.length === 1 ? "s" : ""} a look`].filter(Boolean).join(", ")})`);
  if (i.missionsDone || i.missionsFailed.length) parts.push(`${plural(i.missionsDone + i.missionsFailed.length, "background run")}${i.missionsFailed.length ? ` (${i.missionsFailed.length} failed)` : ""}`);
  if (i.changes.length) parts.push(plural(i.changes.length, "note change"));
  if (i.picks.length) parts.push(plural(i.picks.length, "idea") + " picked");
  if (i.waiting.length) parts.push(`${i.waiting.length} waiting for you`);
  const headline = empty ? "A quiet day: LUTHUR did nothing on its own." : parts.join(", ") + ".";

  const d = new Date(i.date + "T12:00");
  const out = [`# Evening debrief · ${DOW[d.getDay()]}, ${MON[d.getMonth()]} ${d.getDate()}`, "", `**Today:** ${headline}`];
  const section = (title: string, lines: string[], max = 10) => {
    if (!lines.length) return;
    out.push("", `## ${title}`, ...lines.slice(0, max).map(l => "- " + l));
    if (lines.length > max) out.push(`- …and ${lines.length - max} more`);
  };
  section("Needs a look", [...issue.map(t => `⚠ ${clean(t.title)}${name(t.project)}`), ...i.missionsFailed.map(m => `⚠ ${clean(m.title)} (${m.status === "timeout" ? "ran out of time" : "failed"})`)]);
  section("Partly done", partly.map(t => `🟡 ${clean(t.title)}${name(t.project)}`));
  section("Finished", done.map(t => `✅ ${clean(t.title)}${name(t.project)}`));
  section("Waiting for your OK", i.waiting.map(a => clean(a.title.replace(/^Start task: /, ""))));
  section("Notes LUTHUR changed (Undo in Missions & approvals)", i.changes.map(c => `${c.summary.replace(/\s+/g, " ").slice(0, 140)}${name(c.project)}`), 8);
  section("Ideas LUTHUR picked", i.picks.map(p => `${clean(p.title)} · ${{ started: "started on its own", asked: "asked you", rejected: "you said no" }[p.outcome] || p.outcome}`));
  const tmr = i.tomorrow.map(t => `📅 ${t.title}${t.when ? ` · ${t.when}` : ""}${name(t.project)}`);
  if (i.overdue) tmr.push(`${plural(i.overdue, "reminder")} still overdue`);
  section("Tomorrow", tmr.length ? tmr : ["Nothing due."]);
  return { date: i.date, text: out.join("\n") + "\n", headline, empty };
}

export function save(b: Debrief): void { writeText(path.join(DIR, `${b.date}.md`), b.text); }

export function latest(): { date: string; text: string } | null {
  try {
    const last = fs.readdirSync(DIR).filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort().at(-1);
    return last ? { date: last.slice(0, 10), text: readText(path.join(DIR, last)) } : null;
  } catch { return null; }
}
