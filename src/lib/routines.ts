import path from "node:path";
import { BRAIN, readJson, writeJson, uid, localDate } from "./store.ts";

type Routine = { id: string; title: string; time: string; days: number[]; completed: string[] };
const FILE = path.join(BRAIN, "routines.json");
const fail = (s: string) => { throw Object.assign(new Error(s), { code: 400 }); };
export function list() { return readJson<Routine[]>(FILE, []); }
export function save(input: Partial<Routine>) {
  const all = list(), old = input.id ? all.find(x => x.id === input.id) : null;
  if (input.id && !old) fail("Routine not found.");
  const title = String(input.title ?? old?.title ?? "").trim().slice(0, 200);
  const time = String(input.time ?? old?.time ?? "09:00");
  const days = [...new Set(input.days ?? old?.days ?? [1, 2, 3, 4, 5])];
  if (!title || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || !days.length || days.some(d => !Number.isInteger(d) || d < 0 || d > 6)) fail("Choose a title, valid time, and at least one day.");
  if (!old && all.length >= 60) fail("Limit of 60 routines reached.");
  const item: Routine = { id: old?.id || uid("rt-"), title, time, days, completed: old?.completed || [] };
  writeJson(FILE, old ? all.map(x => x.id === old.id ? item : x) : [...all, item]); return item;
}
export function complete(id: string, done: boolean) {
  const all = list(), item = all.find(x => x.id === id); if (!item) fail("Routine not found.");
  const date = localDate(); item!.completed = item!.completed.filter(d => d !== date).slice(-365);
  if (done) item!.completed.push(date);
  writeJson(FILE, all); return item;
}
export function remove(id: string) { writeJson(FILE, list().filter(x => x.id !== id)); return { ok: true }; }
