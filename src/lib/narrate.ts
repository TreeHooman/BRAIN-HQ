// Turns Claude Code's stream-json output into short, safe step lines for the live operations feed.
// Never passes file contents from secret-looking paths, and redacts token-like strings everywhere.
import * as brain from "./brain.ts";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

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
// Judge only the file and its folder: the owner's projects live under "Project Secrets", which must not hide every file.
const isSecretPath = (p: string) => SECRET_PATH.test(shortPath(p));
const lineCount = (s: unknown) => typeof s === "string" && s.length ? s.replace(/\n$/, "").split("\n").length : 0;
const projName = (slug: unknown) => { const p = slug ? brain.getProject(String(slug)) : null; return p?.name || String(slug || "project"); };

function resultText(c: any): string {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map(x => (typeof x === "string" ? x : x?.type === "text" ? x.text : "")).join("\n");
  return "";
}
/** Watches a build run's workspace so changes made by shell commands (not only file-edit tools) show on the Code page.
 *  Keeps size+mtime for every file and the text of small files, so a change can be shown as removed/added lines. */
export class WorkspaceWatch {
  private files = new Map<string, { size: number; mtime: number; text: string | null }>();
  private budget = 8_000_000; // bytes of file text kept in memory
  private dir: string;
  constructor(dir: string) { this.dir = dir; this.scan(true); }
  private list(): string[] {
    const out: string[] = [], skip = /^(\.git|node_modules|dist|build|\.next|venv|\.venv|__pycache__|target|\.cache|coverage)$/;
    const walk = (d: string, depth: number) => {
      if (out.length >= 4000 || depth > 8) return;
      let ents: fs.Dirent[] = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of ents) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!skip.test(e.name)) walk(p, depth + 1); } else if (e.isFile() && out.length < 4000) out.push(p); }
    };
    walk(this.dir, 0); return out;
  }
  private read(file: string, size: number): string | null {
    if (size > 200_000 || size > this.budget || isSecretPath(file)) return null;
    try { const t = fs.readFileSync(file, "utf8"); if (t.includes("\u0000")) return null; this.budget -= t.length; return t; } catch { return null; }
  }
  /** Rescans; returns the lines that changed since the last scan (first scan only records). */
  scan(first = false): { files: string[]; diff: string[]; added: number; removed: number } {
    const res = { files: [] as string[], diff: [] as string[], added: 0, removed: 0 }, seen = new Set<string>();
    const push = (sign: string, lines: string[]) => { for (const l of lines) { if (sign === "+") res.added++; else res.removed++; if (res.diff.length < 14 && l.trim()) res.diff.push(sign + clip(redact(l), 90)); } };
    for (const file of this.list()) {
      seen.add(file);
      let st: fs.Stats; try { st = fs.statSync(file); } catch { continue; }
      const old = this.files.get(file);
      if (old && old.size === st.size && old.mtime === st.mtimeMs) continue;
      const text = this.read(file, st.size);
      this.files.set(file, { size: st.size, mtime: st.mtimeMs, text });
      if (first) continue;
      res.files.push(path.basename(file));
      if (isSecretPath(file)) continue; // name only, never contents
      const before = old?.text?.split(/\r?\n/) || [], after = text?.split(/\r?\n/) || [];
      // Multiset line diff: enough to show what was removed and added without a full LCS.
      const count = new Map<string, number>(); for (const l of before) count.set(l, (count.get(l) || 0) + 1);
      const added: string[] = []; for (const l of after) { const n = count.get(l) || 0; if (n) count.set(l, n - 1); else added.push(l); }
      const removed: string[] = []; for (const [l, n] of count) for (let i = 0; i < n; i++) removed.push(l);
      push("-", removed.filter(l => l.trim())); push("+", added.filter(l => l.trim()));
    }
    if (!first) for (const [file, f] of this.files) if (!seen.has(file)) { this.files.delete(file); res.files.push(path.basename(file) + " (deleted)"); if (!isSecretPath(file)) push("-", (f.text || "").split(/\r?\n/).filter(l => l.trim())); }
    return res;
  }
}

/** Codex reports only which files changed; read the change itself (git diff, or a new file's lines) so the Code page can show it live. */
export function fileChangeDiff(cwd: string, changes: { path?: string; kind?: string }[]): { diff: string[]; added: number; removed: number } {
  const diff: string[] = []; let added = 0, removed = 0;
  for (const c of changes.slice(0, 4)) {
    const file = path.resolve(cwd, String(c.path || "")); if (!c.path || isSecretPath(file)) continue;
    let out = "";
    const g = spawnSync("git", ["diff", "--no-color", "--no-ext-diff", "-U0", "--", file], { cwd: path.dirname(file), encoding: "utf8", timeout: 3000, windowsHide: true });
    if (g.status === 0 && g.stdout.trim()) out = g.stdout;
    else if (c.kind === "add") { try { const st = fs.statSync(file); if (st.size < 200_000) out = fs.readFileSync(file, "utf8").split(/\r?\n/).map(l => "+" + l).join("\n"); } catch {} }
    for (const l of out.split(/\r?\n/)) {
      if (/^(\+\+\+|---)/.test(l) || (l[0] !== "+" && l[0] !== "-")) continue;
      if (l[0] === "+") added++; else removed++;
      if (diff.length < 14 && l.slice(1).trim()) diff.push(l[0] + clip(redact(l.slice(1)), 90));
    }
  }
  return { diff, added, removed };
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
  const secret = isSecretPath(file);
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
