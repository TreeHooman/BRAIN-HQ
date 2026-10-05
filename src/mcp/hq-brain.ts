// hq-brain: a tiny MCP server (stdio, JSON-RPC 2.0, no dependencies) that gives Claude structured,
// token-cheap access to the brain. Any Claude session can use it, not just HQ missions:
//   claude mcp add hq-brain -- node "<HQ>/src/mcp/hq-brain.ts"
// HQ_LEVEL=read hides every write tool. HQ_RUN_ID ties follow-ups/approvals to the run that made them.
import path from "node:path";
import readline from "node:readline";
import { DROP, uid, writeJson } from "../lib/store.ts";
import * as brain from "../lib/brain.ts";

const LEVEL = process.env.HQ_LEVEL || "plan";
const RUN_ID = process.env.HQ_RUN_ID || "interactive";
const CAN_WRITE = LEVEL !== "read";
const IS_CHAT = RUN_ID.startsWith("chat-") || RUN_ID === "interactive";

type Tool = { name: string; description: string; inputSchema: any; write?: boolean; chatOnly?: boolean; run: (a: any) => unknown };
const S = (props: Record<string, any>, required: string[] = []) => ({ type: "object", properties: props, required });
const str = (description: string) => ({ type: "string", description });
const PART = { type: "string", enum: ["summary", "plan", "log", "json"], description: "summary = SUMMARY.md (short), plan = plan.md, log = log.md (dated entries), json = project.json fields" };
const TIER = { type: "string", enum: ["fast", "balanced", "deep"], description: "fast = cheap/simple, balanced = default, deep = hard coding/strategy" };
const LEVELP = { type: "string", enum: ["read", "plan", "build"], description: "read = look only, plan = update brain, build = edit code in dev" };

function drop(type: string, payload: Record<string, unknown>) {
  writeJson(path.join(DROP, `${uid(type + "-")}.json`), { type, fromRun: RUN_ID, fromLevel: LEVEL, ...payload });
}

const tools: Tool[] = [
  { name: "hq_index", description: "START HERE. Tiny map of every project (stage, health, next step) plus reminders due in 14 days and next milestones.",
    inputSchema: S({}), run: () => brain.readIndex() },
  { name: "project_get", description: "Read one part of a project. Ask for 'summary' first; only read plan/log when needed.",
    inputSchema: S({ slug: str("project slug from hq_index"), part: PART }, ["slug", "part"]),
    run: a => a.part === "json" ? JSON.stringify(brain.getProject(a.slug), null, 2) : brain.readDoc(a.slug, a.part) || "(empty)" },
  { name: "list_reminders", description: "Open reminders, soonest first.",
    inputSchema: S({ days: { type: "number", description: "only those due within N days (default 30)" } }),
    run: a => { const lim = Date.now() + (a.days || 30) * 864e5; return JSON.stringify(brain.listReminders().filter(r => !r.done && brain.whenToDate(r.due).getTime() <= lim), null, 1); } },
  { name: "list_milestones", description: "Key dates and deadlines across projects.",
    inputSchema: S({ project: str("optional project slug") }),
    run: a => JSON.stringify(brain.listMilestones().filter(m => !a.project || m.project === a.project), null, 1) },
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
    inputSchema: S({ title: str("short title"), prompt: str("exact instructions for the next run"), project: str("project slug"), tier: TIER, permission: LEVELP }, ["title", "prompt"]),
    run: a => { if (a.project && !brain.getProject(a.project)) throw new Error(`Unknown project ${a.project}`); drop("followup", a); return "Queued. HQ will run it within budget."; } },
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
      try {
        const out = t.run(params?.arguments || {});
        reply(id, { content: [{ type: "text", text: String(out ?? "ok") }] });
      } catch (e: any) {
        reply(id, { content: [{ type: "text", text: `Error: ${e?.message || e}` }], isError: true });
      }
    } else if (method === "ping") reply(id, {});
    else reply(id, undefined, { code: -32601, message: `Method not found: ${method}` });
  } catch (e: any) {
    reply(id, undefined, { code: -32603, message: String(e?.message || e) });
  }
});
