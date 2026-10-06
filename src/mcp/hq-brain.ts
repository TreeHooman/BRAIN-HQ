// hq-brain: a tiny MCP server (stdio, JSON-RPC 2.0, no dependencies) that gives Claude structured,
// token-cheap access to the brain. Any Claude session can use it, not just HQ missions:
//   claude mcp add hq-brain -- node "<HQ>/src/mcp/hq-brain.ts"
// HQ_LEVEL=read hides every write tool. HQ_RUN_ID ties follow-ups/approvals to the run that made them.
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { DATA, DROP, uid, writeJson } from "../lib/store.ts";
import * as brain from "../lib/brain.ts";
import * as preferences from "../lib/preferences.ts";
import { createAlarmRequest } from "../lib/iphone-alarm.ts";
import { searchCodexChats } from "../lib/codex-transcripts.ts";
import * as cal from "../lib/calendar.ts";
import * as google from "../lib/google.ts";
import * as today from "../lib/today.ts";
import { validate as validateOut } from "../lib/outbox.ts";

const LEVEL = process.env.HQ_LEVEL || "plan";
const RUN_ID = process.env.HQ_RUN_ID || "interactive";
const CAN_WRITE = LEVEL !== "read";
const IS_CHAT = RUN_ID.startsWith("chat-") || RUN_ID === "interactive";

type Tool = { name: string; description: string; inputSchema: any; write?: boolean; chatOnly?: boolean; run: (a: any) => unknown | Promise<unknown> };
const S = (props: Record<string, any>, required: string[] = []) => ({ type: "object", properties: props, required });
const str = (description: string) => ({ type: "string", description });
const PART = { type: "string", enum: ["summary", "plan", "log", "json"], description: "summary = SUMMARY.md (short), plan = plan.md, log = log.md (dated entries), json = project.json fields" };
const TIER = { type: "string", enum: ["fast", "balanced", "deep"], description: "fast = cheap/simple, balanced = default, deep = hard coding/strategy" };
const LEVELP = { type: "string", enum: ["read", "plan", "build"], description: "read = look only, plan = update brain, build = edit code in dev" };

function drop(type: string, payload: Record<string, unknown>) {
  writeJson(path.join(DROP, `${uid(type + "-")}.json`), { type, fromRun: RUN_ID, fromLevel: LEVEL, ...payload });
}

const tools: Tool[] = [
  { name: "preference_context", description: "Read the short, confirmed owner preferences relevant to this project and personality. Direct owner instructions always take precedence.",
    inputSchema: S({ project: str("optional project slug"), challenger: { type: "boolean", description: "include Challenger preferences" } }),
    run: a => preferences.context(a.project, a.challenger === true) || "No confirmed preferences yet." },
  { name: "preference_list", description: "List confirmed preferences and suggestions awaiting owner review, with IDs for editing/removal.",
    inputSchema: S({}), run: () => JSON.stringify({ confirmed: preferences.list(), suggestions: preferences.suggestions() }) },
  { name: "preference_remember", write: true, chatOnly: true, description: "Save a concise preference only when the owner explicitly instructs or corrects you. Never infer one here. Scope: global, one project, or Challenger.",
    inputSchema: S({ text: str("owner's explicit preference, max 220 characters"), scope: { type: "string", enum: ["global", "project", "challenger"] }, project: str("required for project scope"), id: str("existing preference id to edit") }, ["text", "scope"]),
    run: a => preferences.remember(a) },
  { name: "preference_remove", write: true, chatOnly: true, description: "Remove a confirmed preference by ID when the owner asks to forget it.",
    inputSchema: S({ id: str("preference id") }, ["id"]), run: a => preferences.remove(a.id) ? "Removed." : "No such preference." },
  { name: "preference_suggest", write: true, chatOnly: true, description: "Propose a possible pattern from repeated owner behavior. It remains inactive until the owner confirms it. Do not suggest on every turn.",
    inputSchema: S({ text: str("proposed preference"), scope: { type: "string", enum: ["global", "project", "challenger"] }, project: str("required for project scope"), reason: str("brief evidence for asking") }, ["text", "scope", "reason"]),
    run: a => preferences.suggest(a) },
  { name: "preference_review", write: true, chatOnly: true, description: "Accept or reject a pending suggestion only after the owner explicitly decides.",
    inputSchema: S({ id: str("suggestion id"), accept: { type: "boolean" } }, ["id", "accept"]),
    run: a => preferences.review(a.id, a.accept === true) || "Rejected and removed." },
  { name: "hq_index", description: "START HERE. Tiny map of every project (stage, health, next step) plus reminders due in 14 days and next milestones.",
    inputSchema: S({}), run: () => brain.readIndex() },
  { name: "project_get", description: "Read one part of a project. Ask for 'summary' first; only read plan/log when needed.",
    inputSchema: S({ slug: str("project slug from hq_index"), part: PART }, ["slug", "part"]),
    run: a => a.part === "json" ? JSON.stringify(brain.getProject(a.slug), null, 2) : brain.readDoc(a.slug, a.part) || "(empty)" },
  { name: "list_reminders", description: "Open reminders, soonest first.",
    inputSchema: S({ days: { type: "number", description: "only those due within N days (default 30)" } }),
    run: a => { const lim = Date.now() + (a.days || 30) * 864e5; return JSON.stringify(brain.listReminders().filter(r => !r.done && brain.whenToDate(r.due).getTime() <= lim), null, 1); } },
  // Google: metadata only (sender, subject, file name). Content stays out of the agent (it can carry hidden instructions);
  // show_on_screen opens it for the owner and the dashboard reads it aloud / summarises it with a no-tools model.
  { name: "google_mail_search", description: "Find emails in the owner's connected Gmail accounts. Returns id, account, date, sender and subject only (not the body). Gmail search syntax works (from:, subject:, newer_than:7d). Use show_on_screen to open one for the owner.",
    inputSchema: S({ query: str("Gmail search, e.g. from:sam newer_than:7d"), account: str("optional account id (g-…)") }, ["query"]),
    run: async a => { const r = await google.mailList(/^g-[a-f0-9]{10}$/.test(a.account || "") ? a.account : "all", String(a.query || "").slice(0, 200), "any");
      return r.items.length ? r.items.slice(0, 15).map((m: any) => `${m.acct}/${m.id} · ${new Date(m.date).toLocaleString()} · ${m.from} · ${m.subject}`).join("\n") : (r.errors[0]?.error || "No emails found."); } },
  { name: "google_drive_search", description: "Find Docs, Sheets, Slides, PDFs and files in the owner's connected Google Drives. Returns id, account, type and name only. Use show_on_screen to open one.",
    inputSchema: S({ query: str("words in the file name"), kind: { type: "string", enum: ["", "docs", "sheets", "slides", "pdfs", "forms"], description: "optional type" } }, ["query"]),
    run: async a => { const r = await google.driveList("all", { search: String(a.query || "").slice(0, 120), kind: a.kind || "" });
      return r.items.length ? r.items.slice(0, 15).map((f: any) => `${f.acct}/${f.id} · ${String(f.mime).split(".").pop()} · ${f.name}`).join("\n") : (r.errors[0]?.error || "No files found."); } },
  { name: "show_on_screen", description: "Open something on the owner's War Room screen: a website, an email, a Drive file, a web search, a project or their calendar. Set read_aloud to have the dashboard read it out (emails, docs), or summarize for a spoken summary. Use this whenever the owner asks to see, open, pull up, read or go over something.",
    inputSchema: S({ kind: { type: "string", enum: ["url", "email", "file", "search", "project", "calendar", "inbox"] }, url: str("for url"), ref: str("for email/file: the acct/id from the search tool"), query: str("for search/inbox"), slug: str("for project"),
      read_aloud: { type: "boolean" }, summarize: { type: "boolean" } }, ["kind"]),
    run: a => {
      const ref = String(a.ref || ""); const [acct, id] = ref.split("/");
      if ((a.kind === "email" || a.kind === "file") && !(/^g-[a-f0-9]{10}$/.test(acct) && /^[A-Za-z0-9_-]{8,200}$/.test(id || ""))) throw new Error("ref must be acct/id from the search tool");
      if (a.kind === "url" && !/^https?:\/\/\S+$/i.test(String(a.url || ""))) throw new Error("url must start with http(s)://");
      drop("screen", { kind: a.kind, url: a.url ? String(a.url).slice(0, 2000) : undefined, acct, id, query: a.query ? String(a.query).slice(0, 200) : undefined, slug: a.slug, read_aloud: a.read_aloud === true, summarize: a.summarize === true });
      return `On the owner's screen${a.read_aloud ? "; the dashboard is reading it out" : a.summarize ? "; the dashboard will summarise it aloud" : ""}. Don't repeat its content.`;
    } },
  { name: "today_list", description: "The owner's goals for today (the Today page): id, title, project, minutes, done. Check it when they ask what's next or say they finished something.",
    inputSchema: S({}),
    run: () => { const p = today.get(); return p.items.length ? `${p.date}${p.note ? " · " + p.note : ""}\n` + p.items.map(i => `${i.done ? "[x]" : "[ ]"} ${i.id} · ${i.title}${i.project ? ` (${i.project})` : ""} · ${i.mins || 30}m${i.why ? " · " + i.why : ""}`).join("\n") : "Nothing planned for today yet. The owner can press Plan my day on the Today page, or you can add goals with today_update."; } },
  { name: "today_update", write: true, description: "Change today's goals: add one (small, finishable today; link goalId+stepId when it's a goal step), mark done/undo (done ticks the linked goal step, logs it, moves the project's next step on and adds the next step to today), or remove.",
    inputSchema: S({ action: { type: "string", enum: ["add", "done", "undo", "remove"] }, id: str("item id for done/undo/remove"), title: str("for add"), project: str("optional project slug"), goalId: str("optional"), stepId: str("optional"), mins: { type: "number", description: "estimate in minutes" } }, ["action"]),
    run: a => {
      if (a.action === "add") { const i = today.add({ title: a.title, project: a.project, goalId: a.goalId, stepId: a.stepId, mins: a.mins }, "luthur"); return `Added to today: ${i.title} (${i.id}).`; }
      if (!/^[\w-]{1,40}$/.test(a.id || "")) return "Give the item id from today_list.";
      if (a.action === "remove") { today.remove(a.id); return "Removed from today."; }
      const r = today.setDone(a.id, a.action === "done", "luthur"); return `${a.action === "done" ? "Done" : "Reopened"}: ${r.item.title}.${r.changed.length ? " Also: " + r.changed.join(", ") + "." : ""}`;
    } },
  { name: "hq_check", description: "Health check of HQ and the brain: Claude sign-in, running/failed missions, approvals waiting, HQ software update, Google/calendar connections, plus stale projects, missing next steps, overdue reminders and missed dates. Pass project to check one project. Use for 'do a check', 'status', 'what's broken'.",
    inputSchema: S({ project: str("optional project slug") }),
    run: a => {
      const slug = /^[a-z0-9-]{1,60}$/.test(a.project || "") ? a.project : "";
      const now = Date.now(), today = new Date().toISOString().slice(0, 10), out: string[] = [];
      const ps = brain.listProjects().filter(p => p.stage !== "done" && (!slug || p.slug === slug));
      if (slug && !ps.length) return `No active project "${slug}".`;
      const ok = (x: string) => out.push("- " + x);
      for (const p of ps) {
        const age = Math.floor((now - Date.parse(p.updated || "")) / 864e5);
        const bits = [p.health === "risk" ? "health RISK" : p.health === "watch" ? "health watch" : p.health === "unknown" ? "health not set" : "", !p.nextStep ? "no next step" : "", age > 14 ? `not updated in ${age} days` : ""].filter(Boolean);
        if (bits.length || slug) ok(`${p.name} (${p.slug}, ${p.stage}): ${bits.join(", ") || "looks fine"}${slug ? ` · next: ${p.nextStep || "-"}` : ""}`);
      }
      const inScope = (x: { project?: string | null }) => !slug || x.project === slug;
      const overdue = brain.listReminders().filter(r => !r.done && r.due.slice(0, 10) < today && inScope(r));
      if (overdue.length) ok(`Overdue reminders (${overdue.length}): ${overdue.slice(0, 6).map(r => `${r.title} [${r.due.slice(0, 10)}, id ${r.id}]`).join("; ")}`);
      const missed = brain.listMilestones().filter(m => !m.done && m.date < today && inScope(m));
      if (missed.length) ok(`Past-due milestones (${missed.length}): ${missed.slice(0, 6).map(m => `${m.title} [${m.date}]`).join("; ")}`);
      const soon = brain.listMilestones().filter(m => !m.done && m.date >= today && Date.parse(m.date) - now < 7 * 864e5 && inScope(m));
      if (soon.length) ok(`Due this week: ${soon.map(m => `${m.title} [${m.date}]`).join("; ")}`);
      if (!slug) { const n = brain.listInbox().length; if (n) ok(`${n} unsorted inbox note(s).`); }
      const sys = (() => { try { return JSON.parse(fs.readFileSync(path.join(DATA, "hq-check.json"), "utf8")); } catch { return null; } })();
      if (sys && !slug) {
        const s2: string[] = [];
        if (sys.claude !== "ok") s2.push(`Claude sign-in: ${sys.claude}`);
        if (sys.pausedUntil) s2.push(`missions paused until ${sys.pausedUntil}`);
        if (sys.running?.length) s2.push(`running: ${sys.running.join(", ")}`);
        s2.push(`queued ${sys.queued}, runs today ${sys.runsToday}`);
        if (sys.pendingApprovals) s2.push(`${sys.pendingApprovals} approval(s) waiting in Needs you`);
        if (sys.outboxWaiting) s2.push(`${sys.outboxWaiting} draft(s) waiting in the Outbox`);
        for (const f of sys.failed24h || []) s2.push(`failed in last 24h: ${f}`);
        const u = sys.update || {};
        s2.push(u.error ? `update check error: ${u.error}` : !u.keySet ? "updates: no GitHub key set (Settings → Updates)" : u.available ? `HQ update available: ${u.latest}` : `HQ up to date (${u.installed})`);
        for (const g of sys.google || []) if (!g.signedIn || !g.calendar) s2.push(`Google ${g.email}: ${!g.signedIn ? "signed out" : "calendar not allowed"}`);
        for (const c of sys.calendars || []) if (c.ok === false) s2.push(`calendar ${c.name}: ${c.error || "failing"}`);
        out.push(`HQ system (as of ${sys.at}):`, ...s2.map(x => "  - " + x));
      }
      return out.length ? out.join("\n") : "All clear: nothing stale, overdue or failing.";
    } },
  { name: "history_search", description: "Search LUTHUR's saved past answers (chats, Code sessions, explanations, quest briefings, missions, email drafts). Use when the owner refers to something discussed before. Newest first.",
    inputSchema: S({ query: str("words to find (all must match)"), project: str("optional project slug"), limit: { type: "number", description: "max results (default 5, max 20)" } }, ["query"]),
    run: a => {
      const words = String(a.query || "").toLowerCase().split(/\s+/).filter(Boolean);
      let rows: any[] = []; try { rows = fs.readFileSync(path.join(DATA, "history.jsonl"), "utf8").trim().split("\n").map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch {}
      const hits = rows.reverse().filter(e => (!a.project || e.project === a.project) && words.every(w => `${e.title}\n${e.ask}\n${e.answer}`.toLowerCase().includes(w))).slice(0, Math.min(20, a.limit || 5));
      return hits.length ? hits.map(e => `## ${e.at.slice(0, 16).replace("T", " ")} · ${e.kind}${e.project ? " · " + e.project : ""} · ${e.title}\n${e.ask && e.ask !== e.title ? "Asked: " + e.ask.slice(0, 400) + "\n" : ""}${e.answer.slice(0, 1500)}`).join("\n\n") : "Nothing in history matches.";
    } },
  { name: "external_chat_search", description: "Find chats started in Codex outside LUTHUR. Search only when the owner refers to an outside Codex chat; returns brief read-only matches.",
    inputSchema: S({ query: str("words to find"), limit: { type: "number", description: "max results (default 5, max 10)" } }, ["query"]),
    run: async a => {
      const hits = await searchCodexChats(String(a.query || ""), Math.min(10, Math.max(1, Number(a.limit) || 5)));
      return hits.length ? hits.map(h => `${h.at.slice(0, 10)} · ${h.id} · ${h.title}`).join("\n") : "No outside Codex chats match.";
    } },
  { name: "list_milestones", description: "Key dates and deadlines across projects.",
    inputSchema: S({ project: str("optional project slug") }),
    run: a => JSON.stringify(brain.listMilestones().filter(m => !a.project || m.project === a.project), null, 1) },
  { name: "calendar_events", description: "The owner's calendar events (read-only, from their connected calendars). Times are ISO; all-day events have YYYY-MM-DD dates.",
    inputSchema: S({ days: { type: "number", description: "days ahead from today (default 1 = today only, max 31)" } }),
    run: async a => {
      if (!cal.feeds().length) return "No calendar connected (Settings → Calendar).";
      await cal.syncAll(false);
      const from = new Date(); from.setHours(0, 0, 0, 0);
      const ev = cal.events(from, new Date(from.getTime() + Math.min(31, Math.max(1, a.days || 1)) * 864e5));
      return ev.length ? ev.map(e => `${e.allDay ? e.start + " (all day)" : new Date(e.start).toLocaleString()} – ${e.title}${e.location ? " @ " + e.location : ""}`).join("\n") : "No events.";
    } },
  { name: "email_draft", write: true, description: "Draft an email for the owner to approve in HQ's Outbox. It is NOT sent until they press Send. Say so in your reply.",
    inputSchema: S({ to: { type: "array", items: { type: "string" }, description: "recipient email addresses" }, cc: { type: "array", items: { type: "string" } }, subject: str("subject"), body: str("plain-text message"), from: str("optional: which connected Google account sends it (its label like 'Acmeco', or its email). Omit for the default Gmail."), note: str("optional: why, for the owner"), project: str("optional project slug") }, ["to", "subject", "body"]),
    run: a => { const payload = validateOut("email", a); drop("outbox", { kind: "email", payload, note: a.note, project: a.project }); return "Drafted. It's waiting in HQ's Outbox for the owner to approve."; } },
  { name: "calendar_draft", write: true, description: "Propose a Google Calendar change (create/update/delete) for the owner to approve in HQ's Outbox. Nothing changes until they approve. Times are local, like 2026-10-06T14:30 (date only = all day).",
    inputSchema: S({ action: { type: "string", enum: ["create", "update", "delete"] }, title: str("event title (for update/delete: the event's current title)"), start: str("start, e.g. 2026-10-06T14:30"), end: str("end"), location: str("optional"), description: str("optional"), attendees: { type: "array", items: { type: "string" }, description: "optional guest emails" }, eventRef: str("update/delete: how to find the event (current time, calendar event id)"), note: str("optional: why"), project: str("optional project slug") }, ["action", "title"]),
    run: a => { const payload = validateOut("calendar", a); drop("outbox", { kind: "calendar", payload, note: a.note, project: a.project }); return "Proposed. It's waiting in HQ's Outbox for the owner to approve."; } },
  { name: "list_inbox", description: "Unsorted brain-dump notes waiting to be filed.",
    inputSchema: S({}), run: () => JSON.stringify(brain.listInbox(), null, 1) },
  { name: "recent_decisions", description: "Recent decisions (newest first), optionally for one project.",
    inputSchema: S({ project: str("optional project slug"), n: { type: "number" } }),
    run: a => brain.recentDecisions(a.n || 15, a.project).join("\n") || "(none)" },

  { name: "goal_list", description: "Goals in the Mission Planner with their steps and progress.",
    inputSchema: S({ project: str("optional project slug") }),
    run: a => JSON.stringify(brain.listGoals().filter(g => !a.project || g.project === a.project), null, 1) },

  { name: "goal_save", write: true, description: "Create or update a Mission Planner goal broken into ordered steps. Pass id to update (send the full steps list).",
    inputSchema: S({ id: str("existing goal id to update"), title: str("the goal"), project: str("project slug"), why: str("why it matters"), due: str("YYYY-MM-DD"),
      steps: { type: "array", items: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, done: { type: "boolean" }, notes: { type: "string" }, due: { type: "string" } }, required: ["title"] } } }, ["title", "steps"]),
    run: a => { const g = brain.saveGoal(a); return `Goal ${g.id} saved with ${g.steps.length} steps.`; } },
  { name: "goal_step_done", write: true, description: "Mark a goal step done or not done.",
    inputSchema: S({ goal_id: str("goal id"), step_id: str("step id"), done: { type: "boolean" } }, ["goal_id", "step_id"]),
    run: a => { brain.setStepDone(a.goal_id, a.step_id, a.done !== false); return "Updated."; } },
  { name: "project_update", write: true, description: "Change project fields: stage, health, summary (one line), nextStep, tags, paths, repos, links, phases, maxPermission (can only be lowered from the dashboard).",
    inputSchema: S({ slug: str("project slug"), fields: { type: "object", description: "fields to set, e.g. {\"stage\":\"building\",\"nextStep\":\"...\"}" } }, ["slug", "fields"]),
    run: a => { const f = { ...a.fields }; delete f.maxPermission; brain.updateProject(a.slug, f); return `Updated ${a.slug}.`; } },
  { name: "project_write", write: true, description: "Replace SUMMARY.md (keep under ~40 lines) or plan.md for a project.",
    inputSchema: S({ slug: str("project slug"), part: { type: "string", enum: ["summary", "plan"] }, content: str("full markdown content") }, ["slug", "part", "content"]),
    run: a => { brain.writeDoc(a.slug, a.part, a.content, { capSummary: true }); return `Wrote ${a.part} for ${a.slug}.`; } },
  { name: "project_log", write: true, description: "Add a dated entry to a project's log (newest first). One short entry per run.",
    inputSchema: S({ slug: str("project slug"), text: str("what happened / what was learned") }, ["slug", "text"]),
    run: a => { brain.addLog(a.slug, a.text, RUN_ID.startsWith("chat-") ? "assistant" : RUN_ID === "interactive" ? "claude" : `mission ${RUN_ID}`); return "Logged."; } },
  { name: "project_create", write: true, description: "Create a new project from the template.",
    inputSchema: S({ name: str("project name"), kind: { type: "string", enum: brain.KINDS }, stage: { type: "string", enum: brain.STAGES }, summary: str("one-line summary") }, ["name"]),
    run: a => { const p = brain.createProject(a); return `Created project ${p.slug}.`; } },
  { name: "reminder_add", write: true, description: "Add a reminder. It pops up on Windows and the phone when due.",
    inputSchema: S({ title: str("what to do"), due: str("YYYY-MM-DD or YYYY-MM-DD HH:MM (local time; default 09:00)"), project: str("optional project slug"), repeat: { type: "string", enum: ["daily", "weekly", "monthly"] } }, ["title", "due"]),
    run: a => { const r = brain.addReminder(a); return `Reminder ${r.id} set for ${r.due.replace("T", " ")}.`; } },
  { name: "iphone_alarm_request", write: true, description: "Use when the owner asks for an iPhone Clock alarm within the next 24 hours. Immediately sends a tap-to-create Shortcut notification and saves a due reminder. Never say the Clock alarm is set until the owner runs the Shortcut.",
    inputSchema: S({ title: str("alarm label"), due: str("YYYY-MM-DD HH:MM in this PC's local timezone; must be within 24 hours") }, ["title", "due"]),
    run: a => createAlarmRequest(String(a.title || ""), String(a.due || "")) },
  { name: "reminder_done", write: true, description: "Mark a reminder done (repeating ones move to the next date).",
    inputSchema: S({ id: str("reminder id") }, ["id"]), run: a => { brain.completeReminder(a.id); return "Done."; } },
  { name: "milestone_add", write: true, description: "Add a key date/deadline to the roadmap and calendar.",
    inputSchema: S({ date: str("YYYY-MM-DD"), title: str("what happens"), project: str("optional project slug"), kind: { type: "string", enum: ["milestone", "deadline"] } }, ["date", "title"]),
    run: a => { const m = brain.addMilestone(a); return `Milestone ${m.id} on ${m.date}.`; } },
  { name: "decision_log", write: true, description: "Record a decision or strategic pivot with the reason.",
    inputSchema: S({ text: str("the decision"), why: str("the reason"), project: str("optional project slug") }, ["text"]),
    run: a => { brain.addDecision(a.text, a.project, a.why); return "Decision recorded."; } },
  { name: "inbox_add", write: true, description: "Drop a raw note into the inbox for later sorting.",
    inputSchema: S({ text: str("the note"), project: str("optional project slug") }, ["text"]),
    run: a => { brain.addInbox(a.text, a.project); return "Added to inbox."; } },
  { name: "inbox_remove", write: true, description: "Remove inbox notes after filing them somewhere better.",
    inputSchema: S({ ids: { type: "array", items: { type: "string" } } }, ["ids"]),
    run: a => `Removed ${brain.removeInbox(a.ids)} note(s).` },
  { name: "brief_write", write: true, description: "Save today's morning brief (markdown). Shown on the dashboard home.",
    inputSchema: S({ text: str("the brief in markdown") }, ["text"]), run: a => { brain.writeBrief(a.text); return "Brief saved."; } },
  { name: "queue_followup", write: true, description: "Queue a background mission for later (one project, small and specific). It can't have more permission than you.",
    inputSchema: S({ title: str("short title"), prompt: str("exact instructions for the next run"), project: str("project slug"), tier: TIER, permission: LEVELP,
      owner_approved: { type: "boolean", description: "Chat only: true ONLY if the owner explicitly said in this conversation to run it without asking. Otherwise new tasks wait for their approval in HQ." } }, ["title", "prompt"]),
    run: a => { if (a.project && !brain.getProject(a.project)) throw new Error(`Unknown project ${a.project}`); drop("followup", { ...a, owner_approved: a.owner_approved === true }); return a.owner_approved === true ? "Queued. HQ will run it within budget." : "Sent to the owner for approval in HQ (it runs once they approve)."; } },
  { name: "request_approval", write: true, description: "Ask the owner to approve something beyond your permission (deploy, push, publish, anything live, public or irreversible). Describe exactly what would be done.",
    inputSchema: S({ title: str("one-line ask"), detail: str("what, why, risks, exact commands/text"), project: str("optional project slug"),
      proposed_prompt: str("instructions for the run that executes it if approved"), proposed_permission: LEVELP,
      extra_allow: { type: "array", items: { type: "string" }, description: "extra tool patterns the approved run needs, e.g. Bash(git push:*)" } }, ["title", "detail"]),
    run: a => { drop("approval", { title: a.title, detail: a.detail, project: a.project, proposed: a.proposed_prompt ? { title: a.title, prompt: a.proposed_prompt, project: a.project, permission: a.proposed_permission || "build", extraAllow: a.extra_allow || [] } : null }); return "Sent to the owner's approval queue."; } },
  { name: "mission_schedule", write: true, chatOnly: true, description: "Create a RECURRING background mission (chat only). Use for standing jobs like 'every Monday review X'.",
    inputSchema: S({ title: str("short title"), prompt: str("what to do each time"), project: str("optional project slug"), tier: TIER, permission: LEVELP,
      schedule: { type: "object", description: "{type:'daily',time:'08:00'} | {type:'weekly',day:1,time:'09:00'} (0=Sun) | {type:'every',hours:6} | {type:'once',at:'2026-10-12T09:00'}" } }, ["title", "prompt", "schedule"]),
    run: a => { drop("mission", a); return "Mission scheduled. It shows in HQ → Missions."; } },
];

const visible = tools.filter(t => (!t.write || CAN_WRITE) && (!t.chatOnly || IS_CHAT));

function reply(id: unknown, result?: unknown, error?: { code: number; message: string }) {
  process.stdout.write(JSON.stringify(error ? { jsonrpc: "2.0", id, error } : { jsonrpc: "2.0", id, result }) + "\n");
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", line => {
  if (!line.trim()) return;
  let msg: any;
  try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  if (id === undefined) return; // notifications
  try {
    if (method === "initialize") {
      reply(id, { protocolVersion: params?.protocolVersion || "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "hq-brain", version: "1.0.0" },
        instructions: "HQ business brain. Call hq_index first; read project summaries before plans/logs. Patch the brain when facts change." });
    } else if (method === "tools/list") {
      reply(id, { tools: visible.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    } else if (method === "tools/call") {
      const t = visible.find(x => x.name === params?.name);
      if (!t) return reply(id, { content: [{ type: "text", text: `Unknown or not allowed at level ${LEVEL}: ${params?.name}` }], isError: true });
      Promise.resolve().then(() => t.run(params?.arguments || {}))
        .then(out => reply(id, { content: [{ type: "text", text: String(out ?? "ok") }] }))
        .catch((e: any) => reply(id, { content: [{ type: "text", text: `Error: ${e?.message || e}` }], isError: true }));
    } else if (method === "ping") reply(id, {});
    else reply(id, undefined, { code: -32601, message: `Method not found: ${method}` });
  } catch (e: any) {
    reply(id, undefined, { code: -32603, message: String(e?.message || e) });
  }
});
