// Local Codex CLI adapter. Uses the owner's Codex sign-in; no API key is read or passed.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./store.ts";
import { agentRules, loadConfig, type Level } from "./config.ts";
import { redact, type Step } from "./narrate.ts";
import type { RunResult } from "./claude.ts";

export type CodexOptions = {
  prompt: string; model: string; level: Level; timeoutMs: number;
  resume?: string | null; runId?: string; system?: string;
  addDirs?: string[]; onSpawn?: (pid: number) => void; onStep?: (step: Step) => void;
};

let cachedBin: { value: string | null; at: number } | null = null;
export function findCodex(force = false): string | null {
  if (!force && cachedBin && Date.now() - cachedBin.at < 600_000) return cachedBin.value;
  const candidates = [loadConfig().codex?.bin, process.env.CODEX_BIN].filter(Boolean) as string[];
  // Desktop launches may have a smaller PATH than an interactive terminal.
  if (process.platform === "win32") {
    const appBin = path.join(process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Local"), "OpenAI", "Codex", "bin");
    try {
      const versions = fs.readdirSync(appBin, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => {
        const file = path.join(appBin, e.name, "codex.exe");
        try { return { file, at: fs.statSync(file).mtimeMs }; } catch { return null; }
      }).filter((x): x is { file: string; at: number } => !!x).sort((a, b) => b.at - a.at);
      candidates.push(...versions.map(x => x.file));
    } catch {}
  }
  try {
    const lookup = spawnSync(process.platform === "win32" ? "where.exe" : "which", ["codex"], { encoding: "utf8", timeout: 5000, windowsHide: true });
    candidates.push(...String(lookup.stdout || "").split(/\r?\n/).filter(Boolean));
  } catch {}
  const value = candidates.find(p => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;
  cachedBin = { value, at: Date.now() };
  return value;
}

// JSON string literals are valid TOML strings. Arguments go directly to spawn, never a shell.
const tomlString = (s: string) => JSON.stringify(s);
export function codexArgs(o: CodexOptions): string[] {
  if (!["read", "plan", "build"].includes(o.level)) throw new Error("Unknown Codex permission level");
  const runId = o.runId || "adhoc";
  const args = ["exec", "--json", "--ignore-user-config", "--skip-git-repo-check"];
  if (o.resume) args.push("resume", o.resume);
  args.push("-m", o.model);
  // Config overrides apply on resume too. Explicitly suppress inherited approvals and MCP servers.
  args.push("-c", "approval_policy=never", "-c", `sandbox_mode=${tomlString(o.level === "build" ? "workspace-write" : "read-only")}`);
  args.push("-c", "mcp_servers={}");
  args.push("-c", `mcp_servers.hq-brain.command=${tomlString(process.execPath)}`);
  args.push("-c", `mcp_servers.hq-brain.args=${JSON.stringify(["--no-warnings", path.join(ROOT, "src", "mcp", "hq-brain.ts")])}`);
  args.push("-c", `mcp_servers.hq-brain.env.HQ_LEVEL=${tomlString(o.level)}`);
  args.push("-c", `mcp_servers.hq-brain.env.HQ_RUN_ID=${tomlString(runId)}`);
  args.push("-c", "mcp_servers.hq-brain.default_tools_approval_mode=\"approve\"");
  if (!o.resume) args.push("-C", ROOT);
  // resume currently lacks -C, but the child is spawned with cwd: ROOT.
  if (!o.resume && o.level === "build") for (const dir of o.addDirs || []) if (fs.existsSync(dir)) args.push("--add-dir", dir);
  args.push("-");
  return args;
}

const clean = (s: unknown, max = 4000) => redact(String(s ?? "")).replace(/[A-Za-z0-9+/=]{200,}/g, "[…]").slice(0, max);
const children = new Set<number>();
function killTree(pid?: number) {
  if (!pid) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, timeout: 5000 });
  else try { process.kill(-pid, "SIGKILL"); } catch { try { process.kill(pid, "SIGKILL"); } catch {} }
}
export function killAllCodex() { for (const pid of children) killTree(pid); children.clear(); }

export function runCodex(o: CodexOptions): Promise<RunResult> {
  const bin = process.env.HQ_FAKE_CODEX ? process.execPath : findCodex();
  if (!bin) return Promise.resolve({ ok: false, kind: "missing", text: "Codex CLI not found. Install Codex or set codex.bin in HQ config.", sessionId: null, durationMs: 0 });
  const started = Date.now();
  return new Promise(resolve => {
    let finished = false;
    const finish = (r: RunResult) => { if (!finished) { finished = true; resolve(r); } };
    let args: string[];
    try { args = codexArgs(o); } catch (e) { finish({ ok: false, kind: "error", text: String(e), sessionId: null, durationMs: 0 }); return; }
    const fake = process.env.HQ_FAKE_CODEX;
    const env = { ...process.env, HQ_BACKGROUND: "1" };
    // Never accidentally turn a subscribed CLI run into token-billed API usage.
    for (const key of Object.keys(env)) if (/^(OPENAI_API_KEY|CODEX_API_KEY|ANTHROPIC_API_KEY)$/i.test(key)) delete env[key];
    const child = spawn(bin, fake ? [fake, ...args] : args, { cwd: ROOT, env, windowsHide: true, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] });
    if (child.pid) { children.add(child.pid); child.on("close", () => children.delete(child.pid!)); o.onSpawn?.(child.pid); }
    const parser = new JsonlParser(o.onStep);
    let stderr = "", timedOut = false;
    child.stdout.on("data", data => parser.feed(String(data)));
    child.stderr.on("data", data => { stderr = (stderr + String(data)).slice(-16_000); });
    child.stdin.on("error", () => {});
    child.stdin.end([agentRules(), o.system || "", o.prompt].filter(Boolean).join("\n\n"));
    const timer = setTimeout(() => { timedOut = true; killTree(child.pid); }, Math.max(1000, o.timeoutMs));
    child.on("error", e => { clearTimeout(timer); finish({ ok: false, kind: "error", text: clean(e), sessionId: parser.sessionId, durationMs: Date.now() - started }); });
    child.on("close", code => { clearTimeout(timer); parser.finish(); finish(parser.result(code, stderr, timedOut, Date.now() - started)); });
  });
}

/** Codex exec --json emits thread.started, item.*, turn.completed and error events. */
export class JsonlParser {
  private buffer = ""; private answer = ""; private error = ""; private completed = false;
  private failed = false; private n = 0; sessionId: string | null = null;
  private onStep?: (step: Step) => void;
  constructor(onStep?: (step: Step) => void) { this.onStep = onStep; }
  feed(chunk: string) {
    this.buffer += chunk;
    // Avoid unbounded memory if an unexpected CLI writes a non-JSON stream.
    if (this.buffer.length > 1_000_000 && !this.buffer.includes("\n")) this.buffer = "";
    let pos: number;
    while ((pos = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, pos); this.buffer = this.buffer.slice(pos + 1);
      try { this.accept(JSON.parse(line)); } catch {}
    }
  }
  finish() { if (this.buffer.trim()) { try { this.accept(JSON.parse(this.buffer)); } catch {} } this.buffer = ""; }
  private accept(e: any) {
    if (e?.type === "thread.started" && typeof e.thread_id === "string") this.sessionId = e.thread_id;
    if (e?.type === "turn.completed") this.completed = true;
    if (e?.type === "turn.failed" || e?.type === "error") { this.failed = true; this.error = clean(e.message || e.error?.message || e.error || "Codex failed."); }
    const item = e?.item;
    if (!item || !/^(item.started|item.updated|item.completed)$/.test(String(e.type))) return;
    if (item.type === "agent_message" && typeof item.text === "string") {
      if (e.type === "item.completed") this.answer = clean(item.text, 100_000);
      if (this.onStep && e.type === "item.completed") this.onStep({ id: String(item.id || `say-${++this.n}`), at: Date.now(), kind: "text", tool: "say", verb: "Says", target: clean(item.text.split(/\n|(?<=[.!?])\s/)[0], 140), done: true, ok: true });
    } else if (this.onStep && ["command_execution", "mcp_tool_call", "file_change", "web_search"].includes(item.type)) {
      const kind = item.type === "mcp_tool_call" ? "mcp" : item.type === "command_execution" ? "bash" : item.type === "file_change" ? "edit" : "web";
      const target = item.type === "mcp_tool_call" ? `${item.server || "MCP"} · ${item.tool || "tool"}` : item.type === "command_execution" ? item.command : item.type === "file_change" ? (item.changes || []).map((x: any) => path.basename(x.path || "")).join(", ") : item.query;
      this.onStep({ id: String(item.id || `step-${++this.n}`), at: Date.now(), kind: "tool", tool: kind, verb: kind === "bash" ? "Run" : kind === "edit" ? "Edit" : kind === "web" ? "Search" : "Tool", target: clean(target, 100), done: e.type === "item.completed", ok: e.type === "item.completed" ? item.status !== "failed" : undefined });
    }
  }
  result(exitCode: number | null, stderr: string, timedOut: boolean, durationMs: number): RunResult {
    const text = this.answer || this.error || clean(stderr) || (timedOut ? "Stopped at the time limit." : "Codex returned no answer.");
    const base = { text, sessionId: this.sessionId, durationMs };
    if (timedOut) return { ...base, ok: false, kind: "timeout" };
    if (exitCode === 0 && this.completed && !this.failed) return { ...base, ok: true, kind: "ok" };
    const diagnostic = `${this.error}\n${stderr}`;
    if (/not logged in|login required|authentication (failed|required)|unauthorized|invalid (api key|credentials)/i.test(diagnostic)) return { ...base, ok: false, kind: "auth" };
    if (/usage limit|rate limit|quota exceeded|too many requests|resets? (at|in)/i.test(diagnostic)) return { ...base, ok: false, kind: "limit" };
    return { ...base, ok: false, kind: "error" };
  }
}
