// Turns Claude Code's stream-json output into short, safe step lines for the live operations feed.
// Never passes file contents from secret-looking paths, and redacts token-like strings everywhere.
import * as brain from "./brain.ts";

export type Step = {
  id: string; at: number; kind: "tool" | "text";
  tool: string; verb: string; target: string;
  result?: string; ok?: boolean; done?: boolean;
  added?: number; removed?: number; diff?: string[];
};

const SECRET_PATH = /(^|[\\/])\.env(\.|$)|tunnel-token|credential|secret|token|\.pem$|\.key$|id_rsa|\.npmrc|\.netrc/i;
export function redact(s: string): string {
  return String(s ?? "")
    .replace(/\b(sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{10,}|xox[abprs]-[A-Za-z0-9-]{8,}|AKIA[0-9A-Z]{12,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_.-]+)/g, "•••")
    .replace(/\b([A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|PWD|API_?KEY|PRIVATE_?KEY)[A-Za-z0-9_]*)\s*([=:])\s*("[^"]*"|'[^']*'|\S+)/gi, "$1$2•••")
    .replace(/(bearer\s+)\S+/gi, "$1•••")
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, "•••");
}
const clip = (s: string, n: number) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
const shortPath = (p: string) => { const parts = String(p || "").split(/[\\/]+/).filter(Boolean); return parts.slice(-2).join("/") || String(p || ""); };
const lineCount = (s: unknown) => typeof s === "string" && s.length ? s.replace(/\n$/, "").split("\n").length : 0;
const projName = (slug: unknown) => { const p = slug ? brain.getProject(String(slug)) : null; return p?.name || String(slug || "project"); };

function resultText(c: any): string {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map(x => (typeof x === "string" ? x : x?.type === "text" ? x.text : "")).join("\n");
  return "";
}
function diffPreview(removedText: string, addedText: string): string[] {
  const out: string[] = [];
  const pick = (s: string, sign: string, n: number) => {
    for (const l of String(s || "").split("\n").filter(x => x.trim()).slice(0, n)) out.push(sign + clip(redact(l), 90));
  };
  pick(removedText, "-", 2); pick(addedText, "+", 3);
  return out;
}

const BRAIN: Record<string, (i: any) => string> = {
  hq_index: () => "Scanning HQ index",
  project_get: i => `Reading ${projName(i.slug)} ${i.part || i.doc || "summary"}`,
  list_reminders: () => "Checking reminders",
  list_milestones: () => "Checking milestones",
  list_inbox: () => "Opening the inbox",
  recent_decisions: () => "Reviewing decisions",
  goal_list: () => "Loading goals",
  goal_save: i => `Saving goal "${clip(i.title, 50)}"`,
  goal_step_done: () => "Ticking a goal step",
  project_update: i => `Updating ${projName(i.slug)}${Object.keys(i).filter(k => k !== "slug").length ? ` (${Object.keys(i).filter(k => k !== "slug").slice(0, 3).join(", ")})` : ""}`,
  project_write: i => `Rewriting ${projName(i.slug)} ${i.part || i.doc || i.which || "doc"}`,
  project_log: i => `Logging to ${projName(i.slug)}`,
  project_create: i => `Creating project ${clip(i.name, 40)}`,
  reminder_add: i => `Setting reminder "${clip(i.title, 50)}"`,
  reminder_done: () => "Completing a reminder",
  milestone_add: i => `Adding milestone "${clip(i.title, 50)}"`,
  decision_log: () => "Logging a decision",
  inbox_add: () => "Filing a note to the inbox",
  inbox_remove: i => `Clearing ${(i.ids || []).length || ""} inbox note${(i.ids || []).length === 1 ? "" : "s"}`,
  brief_write: () => "Writing the brief",
  queue_followup: i => `Queuing mission "${clip(i.title, 50)}"`,
  request_approval: i => `Requesting your OK: "${clip(i.title, 50)}"`,
  mission_schedule: i => `Scheduling "${clip(i.title, 50)}"`,
};

function describeTool(name: string, i: any): { tool: string; verb: string; target: string; step: Partial<Step> } {
  i = i || {};
  const file = String(i.file_path || i.path || i.notebook_path || "");
  const secret = SECRET_PATH.test(file);
  if (name.startsWith("mcp__hq-brain__")) {
    const t = name.slice("mcp__hq-brain__".length);
    return { tool: "brain", verb: "Brain", target: (BRAIN[t] || (() => t.replace(/_/g, " ")))(i), step: {} };
  }
  if (name.startsWith("mcp__")) return { tool: "mcp", verb: "Tool", target: name.split("__").slice(1).join(" · "), step: {} };
  switch (name) {
    case "Read": return { tool: "read", verb: "Read", target: shortPath(file), step: {} };
    case "Write": return { tool: "write", verb: "Write", target: shortPath(file), step: secret ? {} : { added: lineCount(i.content), diff: diffPreview("", i.content) } };
    case "Edit": return { tool: "edit", verb: "Edit", target: shortPath(file), step: secret ? {} : { added: lineCount(i.new_string), removed: lineCount(i.old_string), diff: diffPreview(i.old_string, i.new_string) } };
    case "MultiEdit": {
      const ed: any[] = Array.isArray(i.edits) ? i.edits : [];
      return { tool: "edit", verb: "Edit", target: shortPath(file), step: secret ? {} : { added: ed.reduce((n, e) => n + lineCount(e.new_string), 0), removed: ed.reduce((n, e) => n + lineCount(e.old_string), 0), diff: ed[0] ? diffPreview(ed[0].old_string, ed[0].new_string) : [] } };
    }
    case "NotebookEdit": return { tool: "edit", verb: "Edit", target: shortPath(file), step: {} };
    case "Glob": return { tool: "search", verb: "Search", target: clip(i.pattern, 60), step: {} };
    case "Grep": return { tool: "search", verb: "Search", target: `"${clip(redact(i.pattern), 50)}"${i.path ? " in " + shortPath(i.path) : ""}`, step: {} };
    case "Bash": return { tool: "bash", verb: "Bash", target: clip(redact(i.command), 90), step: {} };
    case "WebSearch": return { tool: "web", verb: "Web", target: clip(i.query, 70), step: {} };
    case "WebFetch": { let h = String(i.url || ""); try { h = new URL(h).hostname; } catch {} return { tool: "web", verb: "Fetch", target: h, step: {} }; }
    case "TodoWrite": return { tool: "plan", verb: "Plan", target: `${(i.todos || []).length} tasks`, step: {} };
    case "Task": case "Agent": return { tool: "agent", verb: "Agent", target: clip(i.description || i.prompt, 60), step: {} };
    default: return { tool: name.toLowerCase(), verb: name, target: clip(redact(JSON.stringify(i)), 60), step: {} };
  }
}

function summarizeResult(st: Step, text: string, extra: any): string {
  const lines = text.split("\n").filter(l => l.trim());
  switch (st.tool) {
    case "read": { const n = extra?.file?.numLines ?? lines.length; return `Read ${n} line${n === 1 ? "" : "s"}`; }
    case "write": return `Wrote ${st.added ?? 0} lines`;
    case "edit": return `Edited +${st.added ?? 0} −${st.removed ?? 0}`;
    case "search": { const n = extra?.numFiles ?? extra?.filenames?.length ?? lines.length; return n ? `Found ${n} result${n === 1 ? "" : "s"}` : "No matches"; }
    case "bash": { const pass = text.match(/(\d+)\s+(passed|passing)/i); if (pass) return `✓ ${pass[1]} passed`; return clip(redact(lines[lines.length - 1] || "done"), 80); }
    case "web": return lines.length ? "Got results" : "No results";
    case "brain": return clip(redact(lines[0] || "ok"), 80);
    default: return clip(redact(lines[0] || "done"), 80);
  }
}

/** One narrator per run. feed() takes raw stdout chunks; onStep fires on every new or updated step. */
export function createNarrator(onStep: (s: Step) => void) {
  let buf = "";
  const open = new Map<string, Step>();
  let n = 0;
  const handle = (j: any) => {
    if (j?.type === "assistant" && Array.isArray(j.message?.content)) {
      for (const c of j.message.content) {
        if (c?.type === "tool_use") {
          const d = describeTool(String(c.name || ""), c.input);
          const st: Step = { id: String(c.id || `s${++n}`), at: Date.now(), kind: "tool", tool: d.tool, verb: d.verb, target: d.target, ...d.step };
          open.set(st.id, st); onStep(st);
        } else if (c?.type === "text" && String(c.text || "").trim()) {
          const first = String(c.text).trim().split(/(?<=[.!?])\s|\n/)[0];
          onStep({ id: `say-${++n}`, at: Date.now(), kind: "text", tool: "say", verb: "Says", target: clip(redact(first), 140), done: true, ok: true });
        }
      }
    } else if (j?.type === "user" && Array.isArray(j.message?.content)) {
      for (const c of j.message.content) {
        if (c?.type !== "tool_result") continue;
        const st = open.get(String(c.tool_use_id)); if (!st) continue;
        open.delete(st.id);
        const text = resultText(c.content);
        st.ok = !c.is_error; st.done = true;
        st.result = c.is_error ? "✗ " + clip(redact(text.split("\n")[0] || "error"), 80) : summarizeResult(st, text, j.tool_use_result);
        onStep(st);
      }
    }
  };
  return {
    feed(chunk: string) {
      buf += chunk;
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith("{")) continue;
        try { handle(JSON.parse(line)); } catch {}
      }
    },
  };
}
