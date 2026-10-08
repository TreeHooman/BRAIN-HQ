// Simple app questions answered from HQ's own data, with no model call (owner: "very slow"). Only whole, plain
// questions match; anything with more to it ("what time is my meeting", "…and email Sam") goes to the model as before.
// Answers are read-only: nothing here changes data, except "go"/"cancel" on a brief the owner is reviewing.

export type FastCtx = {
  now?: Date;
  approvals: { title: string }[];
  running: { title: string }[];
  queued: number;
  remindersToday: { title: string; when: string }[];
  questions: { question: string }[];
  outboxDrafts: number;
  brief?: { id: string; title: string; ready: boolean } | null;
  projects?: { slug: string; name: string; nextStep: string; stage: string; health: string }[];
};
export type FastAnswer = { route: string; text: string; speech: string; action?: { kind: "brief-go" | "brief-cancel"; id: string } };

const norm = (t: string) => String(t || "").toLowerCase().replace(/^(?:(?:hey|ok|okay|hi)\s+)?(?:luthur|luther|luthor|jarvis)[,\s]+/, "")
  .replace(/[.!?,]+/g, " ").replace(/\s+/g, " ").trim().replace(/^(?:please|so|um|uh)\s+/, "").replace(/\s+please$/, "");
const list = (a: string[], n = 3) => a.slice(0, n).join("; ") + (a.length > n ? `; and ${a.length - n} more` : "");
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

const ROUTES: [string, RegExp][] = [
  ["time", /^(?:what(?:'s| is) the time|what time is it(?: now| right now)?|(?:tell me )?the time|time check)$/],
  ["date", /^(?:what(?:'s| is) (?:the date|today(?:'s date)?)|what day is (?:it|today)(?: today)?|what(?:'s| is) today's date|today's date|what date is it)$/],
  ["approvals", /^(?:(?:is|are) (?:there )?(?:anything|any(?: approvals| tasks)?) (?:waiting|pending)(?: for (?:me|my (?:ok|approval)))?|what(?:'s| is) waiting(?: for me| for my (?:ok|approval))?|(?:any|do i have any) (?:approvals|pending approvals)|what needs my (?:ok|approval))$/],
  ["running", /^(?:what(?:'s| is| are you) (?:running|working on)(?: (?:right )?now)?|(?:is )?anything running|what are (?:the )?agents doing|task status|status of (?:my )?tasks)$/],
  ["reminders", /^(?:(?:what are |any )?(?:my )?reminders(?: for)? today|what(?:'s| is) on (?:my reminders )?today|do i have (?:any )?reminders(?: today)?)$/],
  ["questions", /^(?:(?:do you have |any )(?:questions|decisions)(?: for me)?|what (?:do you need|decisions do you need) from me|what(?:'s| is) blocked)$/],
  ["next-step", /^(?:what(?:'s| is) (?:the )?next(?: step)?|what (?:do i|should i|should we|do we) do next) (?:on|for|in|with) (?:the |my )?(.+?)(?: project)?$/],
  ["go-anyway", /^(?:go anyway|start (?:it )?anyway|run it anyway|use (?:your|the) defaults(?: and go)?)$/],
  ["go", /^(?:go|go ahead|start(?: it)?|do it|run it|yes go|ok go|okay go|start the (?:task|brief|job))$/],
  ["cancel-brief", /^(?:cancel (?:the |that )?(?:brief|task brief)|scrap (?:the |that )?brief|forget (?:the |that )?brief)$/],
];

/** null when the request needs the model. */
export function answer(text: string, ctx: FastCtx): FastAnswer | null {
  const t = norm(text);
  if (!t || t.length > 80) return null;
  const hit = ROUTES.find(([, re]) => re.test(t)), route = hit?.[0], arg = hit ? (t.match(hit[1]) || [])[1] || "" : "";
  if (!route) return null;
  const now = ctx.now || new Date();
  const say = (written: string, spoken = written, action?: FastAnswer["action"]): FastAnswer => ({ route, text: written, speech: spoken.slice(0, 300), action });
  switch (route) {
    case "time": { const s = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); return say(`It's ${s.replace(/.$/, "")}.`); }
    case "date": { const s = now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" }); return say(`Today is ${s}.`); }
    case "approvals": {
      const a = ctx.approvals, q = ctx.questions.length, d = ctx.outboxDrafts;
      if (!a.length && !q && !d) return say("Nothing is waiting for you.");
      const parts = [a.length ? `${plural(a.length, "approval")}: ${list(a.map(x => x.title))}` : "", q ? `${plural(q, "question")} from tasks` : "", d ? `${plural(d, "Outbox draft")} waiting for Send` : ""].filter(Boolean);
      return say(`Waiting for you: ${parts.join(". ")}.`, `${[a.length ? plural(a.length, "approval") : "", q ? plural(q, "question") : "", d ? plural(d, "draft") : ""].filter(Boolean).join(", ")} waiting for you.`);
    }
    case "running": {
      if (!ctx.running.length && !ctx.queued) return say("Nothing is running right now.");
      const r = ctx.running.map(x => x.title);
      return say(`${r.length ? `Working on: ${list(r)}.` : "Nothing running yet."}${ctx.queued ? ` ${ctx.queued} queued.` : ""}`, `${plural(r.length, "job")} running${ctx.queued ? `, ${ctx.queued} queued` : ""}.`);
    }
    case "reminders": {
      const r = ctx.remindersToday;
      if (!r.length) return say("No reminders left for today.");
      return say(`Today: ${list(r.map(x => `${x.title} at ${x.when}`), 6)}.`, `${plural(r.length, "reminder")} today: ${list(r.map(x => `${x.title} at ${x.when}`), 3)}.`);
    }
    case "questions": {
      const q = ctx.questions;
      if (!q.length) return say("No open questions from your tasks.");
      return say(`Open questions: ${q.map((x, i) => `${i + 1}. ${x.question}`).join(" ")}`, `${plural(q.length, "question")}. First: ${q[0].question}`);
    }
    case "go": {
      // Only meaningful when a brief is waiting for "go"; otherwise the model handles it (it may refer to something else).
      if (!ctx.brief) return null;
      if (!ctx.brief.ready) return say(`The brief "${ctx.brief.title}" still has an open question. Answer it first, or say "go anyway".`, "The brief still has an open question. Answer it first.");
      return say(`Starting "${ctx.brief.title}". I'll report back when it's verified or if I need a decision.`, "Starting it now. I'll report back when it's done or if I need you.", { kind: "brief-go", id: ctx.brief.id });
    }
    case "next-step": {
      // Only when the words name exactly one project (sound-alikes like "Luther" count); otherwise the model handles it.
      const want = arg.replace(/\b(project|the)\b/g, "").replace(/\s+/g, " ").trim(), alias = (s: string) => s.replace(/luther|luthor|lutha/g, "luthur");
      const ps = (ctx.projects || []).filter(p => { const n = p.name.toLowerCase(), s = p.slug.replace(/-/g, " "); return !!want && (alias(want) === alias(n) || want === s || alias(want) === s); });
      if (ps.length !== 1) return null;
      const p = ps[0];
      return say(p.nextStep ? `Next on ${p.name}: ${p.nextStep}` : `${p.name} has no next step set.`, p.nextStep ? `Next on ${p.name}: ${p.nextStep}` : `${p.name} has no next step set yet.`);
    }
    case "go-anyway": {
      if (!ctx.brief) return null;
      return say(`Starting "${ctx.brief.title}" with the recommended defaults for the open points.`, "Starting it with the recommended defaults.", { kind: "brief-go", id: ctx.brief.id });
    }
    case "cancel-brief": {
      if (!ctx.brief) return null;
      return say(`Brief "${ctx.brief.title}" cancelled. Nothing was started.`, "Cancelled. Nothing was started.", { kind: "brief-cancel", id: ctx.brief.id });
    }
  }
  return null;
}
