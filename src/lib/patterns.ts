// Prediction from habits: finds requests the owner keeps making (same kind of ask on 3+ different days, at a similar
// weekday or time) in the chat history and suggests doing them before they ask, as a scheduled mission. Only the owner
// turns a suggestion on. Code only (word overlap, no model call).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA, readJson, writeJson } from "./store.ts";

const HISTORY = path.join(DATA, "history.jsonl"), FILE = path.join(DATA, "patterns.json");
const DAY = 864e5, WINDOW = 60 * DAY, MIN_DAYS = 3, SIM = 0.5;

const STOP = new Set(("a an the and or but if then so to of in on at for from by with about into over is are was were be been am do does did done have has had " +
  "i me my mine you your we our us it its this that these those there here what whats which who how why when where can could would should will shall may might " +
  "please pls just like really also again now today tonight tomorrow yeah yes ok okay hey hi hello luther luthur jarvis thanks thank want need let lets get give tell " +
  "show make up out some any all one thing things stuff go going know think see look well right gonna wanna kind sort").split(/\s+/));
const stem = (w: string) => w.replace(/(ing|ed|es|s)$/, "").slice(0, 12);
export function words(text: string): string[] {
  return [...new Set(String(text).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(w => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w)).map(stem))];
}
const jaccard = (a: string[], b: string[]) => { const B = new Set(b); const i = a.filter(x => B.has(x)).length; return i ? i / (a.length + b.length - i) : 0; };

export type Ask = { at: string; text: string };
export type Pattern = {
  key: string; title: string; example: string; count: number; days: number; lastAt: string;
  schedule: { type: "weekly"; day: number; time: string } | { type: "daily"; time: string }; when: string;
};
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const hhmm = (mins: number) => `${String(Math.floor(((mins % 1440) + 1440) % 1440 / 60)).padStart(2, "0")}:${String(((mins % 60) + 60) % 60).padStart(2, "0")}`;

/** Owner asks from the chat history (newest last). */
export function asks(now = Date.now()): Ask[] {
  let lines: string[] = [];
  try { lines = fs.readFileSync(HISTORY, "utf8").trim().split("\n").slice(-6000); } catch { return []; }
  const out: Ask[] = [];
  for (const l of lines) { try { const e = JSON.parse(l); if (e?.kind === "Chat" && e.ok !== false && e.ask && now - Date.parse(e.at) < WINDOW) out.push({ at: e.at, text: String(e.ask).slice(0, 500) }); } catch {} }
  return out;
}

/** Repeated asks with a regular rhythm. `existing` = titles+prompts of missions already scheduled (skipped). */
export function find(list: Ask[], existing: string[] = [], tzOffsetMin = new Date().getTimezoneOffset()): Pattern[] {
  const items = list.map(a => ({ ...a, w: words(a.text) })).filter(a => a.w.length >= 2 && a.w.length <= 25);
  const groups: { w: string[]; members: typeof items }[] = [];
  for (const it of items) {
    const g = groups.find(g => jaccard(g.w, it.w) >= SIM);
    if (g) g.members.push(it); else groups.push({ w: it.w, members: [it] });
  }
  const have = existing.map(words);
  const out: Pattern[] = [];
  for (const g of groups) {
    const local = g.members.map(m => { const d = new Date(Date.parse(m.at) - tzOffsetMin * 60e3); return { day: d.toISOString().slice(0, 10), dow: d.getUTCDay(), mins: d.getUTCHours() * 60 + d.getUTCMinutes(), m }; });
    const dates = new Set(local.map(x => x.day));
    if (dates.size < MIN_DAYS) continue;
    if (have.some(h => jaccard(h, g.w) >= SIM)) continue;
    // One sample per day (the first ask that day), then look for a weekday or a daily habit.
    const perDay = [...dates].map(d => local.filter(x => x.day === d).sort((a, b) => a.mins - b.mins)[0]);
    const byDow = new Map<number, typeof perDay>();
    for (const x of perDay) byDow.set(x.dow, [...(byDow.get(x.dow) || []), x]);
    const [dow, onDow] = [...byDow.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    const median = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const latest = g.members[g.members.length - 1];
    const key = crypto.createHash("sha1").update([...g.w].sort().slice(0, 8).join(" ")).digest("hex").slice(0, 12);
    const title = latest.text.replace(/\s+/g, " ").trim().slice(0, 70);
    let schedule: Pattern["schedule"], when: string;
    if (onDow.length >= MIN_DAYS) {
      const t = hhmm(Math.floor((median(onDow.map(x => x.mins)) - 30) / 15) * 15);
      schedule = { type: "weekly", day: dow, time: t }; when = `every ${DAYS[dow]} at ${t}`;
    } else {
      const mins = perDay.map(x => x.mins), mid = median([...mins]);
      if (mins.filter(m => Math.abs(m - mid) <= 120).length < Math.max(MIN_DAYS, Math.ceil(perDay.length * 0.6))) continue; // no regular time
      const t = hhmm(Math.floor((mid - 30) / 15) * 15);
      schedule = { type: "daily", time: t }; when = `every day at ${t}`;
    }
    out.push({ key, title, example: latest.text.slice(0, 300), count: g.members.length, days: dates.size, lastAt: latest.at, schedule, when });
  }
  return out.sort((a, b) => b.days - a.days).slice(0, 5);
}

type Store = { dismissed: Record<string, string>; announced: Record<string, string> };
const load = (): Store => { const s = readJson<Partial<Store>>(FILE, {}); return { dismissed: s.dismissed || {}, announced: s.announced || {} }; };

/** Suggestions the owner hasn't turned down (a "no" hides it for 60 days). */
export function suggestions(existing: string[], now = Date.now()): Pattern[] {
  const s = load();
  return find(asks(now), existing).filter(p => !(s.dismissed[p.key] && Date.parse(s.dismissed[p.key]) > now));
}
export function dismiss(key: string) { const s = load(); s.dismissed[key] = new Date(Date.now() + 60 * DAY).toISOString(); writeJson(FILE, s); }
/** Suggestions not announced before (each is announced once). */
export function fresh(list: Pattern[]): Pattern[] {
  const s = load(), out = list.filter(p => !s.announced[p.key]);
  if (out.length) { for (const p of out) s.announced[p.key] = new Date().toISOString(); writeJson(FILE, s); }
  return out;
}
export function missionFor(p: Pattern) {
  return {
    title: `Ahead of you: ${p.title}`.slice(0, 100),
    prompt: `The owner keeps asking for this (${p.days} different days, latest: "${p.example}"). Do it before they ask, ${p.when}. ` +
      "Work only from the brain and what you are allowed to read. Keep the result short enough to read on a phone and put it where the owner will see it (the project log, or a reminder if something needs them). If nothing is new since the last time, say so in one line.",
    tier: "fast", permission: "plan", schedule: p.schedule, enabled: true,
  };
}
