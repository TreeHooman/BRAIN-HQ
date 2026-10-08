// When a worker is truly blocked it asks ONE concise question: what is blocked, what it already established, its
// recommended option, and what decision or information it needs. The task keeps doing independent work meanwhile.
// The answer is saved here (and in the project log) and the blocked step resumes with it, so the owner never has to
// restate it. There is no timeout: silence is never an answer.
import path from "node:path";
import { DATA, readJson, uid, writeJson } from "./store.ts";

export type OwnerQuestion = {
  id: string; createdAt: string; run: string; planId?: string | null; stepId?: string | null; taskId?: string | null; project?: string | null;
  blocked: string; established: string; recommendation: string; options: string[]; needed: string;
  status: "open" | "answered" | "withdrawn"; answer?: string; answeredAt?: string; answeredBy?: string; delivered?: boolean;
};
const FILE = path.join(DATA, "questions.json");
export function list(): OwnerQuestion[] { const a = readJson<OwnerQuestion[]>(FILE, []); return Array.isArray(a) ? a : []; }
export function open(): OwnerQuestion[] { return list().filter(q => q.status === "open"); }
export function get(id: string) { return list().find(q => q.id === id) || null; }
function save(a: OwnerQuestion[]) { writeJson(FILE, [...a.filter(q => q.status === "open"), ...a.filter(q => q.status !== "open").slice(0, 200)]); }
const s = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

export function ask(input: Partial<OwnerQuestion> & { run: string }): OwnerQuestion {
  const blocked = s(input.blocked, 400), needed = s(input.needed, 400);
  if (!blocked || !needed) throw new Error("A question needs what is blocked and what decision or information is needed.");
  const all = list();
  // The same worker asking the same thing again (a resumed or retried run) gets the existing question back.
  const dup = all.find(q => q.status === "open" && (q.run === input.run || (input.stepId && q.stepId === input.stepId && q.planId === input.planId)) && q.needed === needed);
  if (dup) return dup;
  const q: OwnerQuestion = { id: uid("qn"), createdAt: new Date().toISOString(), run: input.run, planId: input.planId ?? null, stepId: input.stepId ?? null, taskId: input.taskId ?? null, project: input.project ?? null,
    blocked, established: s(input.established, 1200), recommendation: s(input.recommendation, 600), options: (Array.isArray(input.options) ? input.options : []).map(o => s(o, 200)).filter(Boolean).slice(0, 5), needed, status: "open" };
  all.unshift(q); save(all); return q;
}
export function answer(id: string, text: string, by = "owner"): OwnerQuestion {
  const all = list(), q = all.find(x => x.id === id);
  if (!q) throw Object.assign(new Error("No such question"), { code: 404 });
  if (q.status !== "open") throw new Error("That question was already answered.");
  const a = s(text, 2000); if (!a) throw new Error("Type an answer.");
  // "Use your recommendation" is an explicit answer: record the recommendation itself, so the log shows what was decided.
  q.answer = /^(?:yes|ok|okay|sure|go with (?:it|that|your recommendation)|use (?:your|the) recommendation|recommended|do what you recommend|agreed?)\.?$/i.test(a) && q.recommendation ? `${q.recommendation} (owner agreed: "${a}")` : a;
  q.status = "answered"; q.answeredAt = new Date().toISOString(); q.answeredBy = by;
  save(all); return q;
}
export function markDelivered(id: string) { const all = list(), q = all.find(x => x.id === id); if (q) { q.delivered = true; save(all); } }
export function withdraw(filter: (q: OwnerQuestion) => boolean) { const all = list(); let n = 0; for (const q of all) if (q.status === "open" && filter(q)) { q.status = "withdrawn"; n++; } if (n) save(all); return n; }
/** The one-message form the owner sees (phone, chat, card). */
export function text(q: OwnerQuestion): string {
  return [`Blocked: ${q.blocked}`, q.established ? `Established: ${q.established}` : "", q.recommendation ? `I recommend: ${q.recommendation}` : "", q.options.length ? `Options: ${q.options.join(" / ")}` : "", `Need from you: ${q.needed}`].filter(Boolean).join("\n");
}
