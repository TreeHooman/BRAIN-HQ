// Runs Claude Code headless (`claude -p`) on the user's subscription. This is the agent loop:
// Claude plans, calls tools, executes and synthesizes; HQ only decides what it may touch.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DATA, ROOT, writeJson } from "./store.ts";
import { loadConfig, loadMcpExtras, loadPermissions, agentRules, levelRank, type Level } from "./config.ts";
import { createNarrator, type Step } from "./narrate.ts";

let cachedBin: { bin: string | null; at: number } | null = null;

/** Finds the Claude CLI. Order: config → CLAUDE_BIN → PATH → ~/.local/bin → desktop app's bundled copies (newest). */
export function findClaude(force = false): string | null {
  if (!force && cachedBin && Date.now() - cachedBin.at < 10 * 60e3) return cachedBin.bin;
  const candidates: string[] = [];
  const cfg = loadConfig();
  if (cfg.claude?.bin) candidates.push(cfg.claude.bin);
  if (process.env.CLAUDE_BIN) candidates.push(process.env.CLAUDE_BIN);
  try {
    const r = spawnSync(process.platform === "win32" ? "where" : "which", ["claude"], { encoding: "utf8" });
    for (const l of (r.stdout || "").split(/\r?\n/)) if (l.trim().toLowerCase().endsWith(".exe") || (process.platform !== "win32" && l.trim())) candidates.push(l.trim());
  } catch {}
  candidates.push(path.join(os.homedir(), ".local", "bin", process.platform === "win32" ? "claude.exe" : "claude"));
  const appRoot = path.join(process.env.APPDATA || "", "Claude", "claude-code");
  try {
    const versions = fs.readdirSync(appRoot).sort((a, b) => cmpVer(b, a));
    for (const v of versions) for (const h of fs.readdirSync(path.join(appRoot, v))) candidates.push(path.join(appRoot, v, h, "claude.exe"));
  } catch {}
  const bin = candidates.find(c => { try { return fs.statSync(c).isFile(); } catch { return false; } }) || null;
  cachedBin = { bin, at: Date.now() };
  return bin;
}
function cmpVer(a: string, b: string): number {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
}

/** Writes the MCP config for one permission level: hq-brain (always) + extras allowed at that level. */
export function mcpConfigFor(level: Level, runId = "adhoc"): string {
  const extras = loadMcpExtras().mcpServers || {};
  const servers: Record<string, any> = {
    "hq-brain": { command: process.execPath, args: ["--no-warnings", path.join(ROOT, "src", "mcp", "hq-brain.ts")], env: { HQ_LEVEL: level, HQ_RUN_ID: runId } },
  };
  for (const [name, def] of Object.entries<any>(extras)) {
    if (levelRank(def.minLevel || "read") <= levelRank(level)) { const { minLevel, ...rest } = def; servers[name] = rest; }
  }
  const file = path.join(DATA, "mcp", `${runId}.json`);
  writeJson(file, { mcpServers: servers });
  return file;
}

export type RunOptions = {
  prompt: string; model: string; fallbackModel?: string; level: Level;
  addDirs?: string[]; extraAllow?: string[]; resume?: string | null; timeoutMs: number;
  system?: string; runId?: string; onSpawn?: (pid: number) => void; onStep?: (s: Step) => void;
  /** Outbox executor: no built-in tools, no hq-brain, no agent rules; only these MCP tool prefixes (account connectors). */
  act?: { allow: string[] };
  /** Thinking effort (Claude Code --effort). Omitted = the model default. */
  effort?: string | null;
  /** Build-level code sessions only. safe = allowlisted commands; auto = any command except the blocked list;
   *  bypass = Claude Code's bypassPermissions mode. HQ's deny lists (push, deploy, secrets…) apply in every mode. */
  mode?: "safe" | "auto" | "bypass" | null;
  /** Saved to the History page (and brain/history/) after the run. Omit to keep the run out of history. */
  history?: { title: string; ask?: string; project?: string | null; kind?: string; format?: (text: string) => string };
};
export type RunStats = { context: number; window: number | null; output: number; cost: number | null; rate: { status?: string; type?: string; resetsAt?: number | null; utilization?: number | null } | null };
export type RunResult = {
  ok: boolean; text: string; sessionId: string | null; durationMs: number;
  kind: "ok" | "error" | "limit" | "auth" | "timeout" | "missing";
  resetAt?: number | null; turns?: number; stats?: RunStats | null;
};

export const EFFORTS = ["low", "medium", "high"];
/** Only known levels, and not for Haiku (it has no effort setting). */
export function effortArg(e: unknown, model: string): string | null { return typeof e === "string" && EFFORTS.includes(e) && !/haiku/i.test(model) ? e : null; }

export function buildArgs(o: RunOptions): string[] {
  const perms = loadPermissions();
  if (o.act) {
    // Account connectors (claude.ai Gmail/Calendar) only load without --strict-mcp-config. Everything else stays off:
    // no built-in tools, and only the approved connector's tools are allowed (the rest are denied in -p mode).
    return ["-p", "--output-format", "stream-json", "--verbose", "--model", o.model, "--setting-sources", "project",
      "--disable-slash-commands", "--tools", "", "--append-system-prompt", o.system || "",
      "--allowedTools", ...o.act.allow, "--disallowedTools", ...(perms.hardDeny || [])];
  }
  const lv = perms.levels?.[o.level] || perms.levels?.read || {};
  const hard: string[] = perms.hardDeny || [];
  const extra = (o.extraAllow || []).filter(t => !hard.includes(t));
  const deny = [...(perms.alwaysDeny || []).filter((t: string) => !extra.includes(t)), ...hard];
  const allow = [...(lv.allow || []), ...extra, "mcp__hq-brain"];
  const args = [
    "-p", "--output-format", "stream-json", "--verbose", // one JSON event per line: feeds the live operations view
    "--model", o.model,
    "--setting-sources", "project",          // skip user-level plugins/hooks: fewer tokens, predictable
    "--strict-mcp-config", "--mcp-config", mcpConfigFor(o.level, o.runId), // only HQ's MCP servers, not every connector
    "--disable-slash-commands",
    "--tools", (lv.tools || ["Read"]).join(","),
    "--append-system-prompt", [agentRules(), o.system || ""].join("\n\n"),
  ];
  if (o.fallbackModel && o.fallbackModel !== o.model) args.push("--fallback-model", o.fallbackModel);
  const eff = effortArg(o.effort, o.model); if (eff) args.push("--effort", eff);
  if (o.level === "build" && (o.mode === "auto" || o.mode === "bypass")) {
    for (const t of ["Bash", "Edit", "Write", "MultiEdit", "NotebookEdit", "TodoWrite"]) if (!allow.includes(t)) allow.push(t);
    args.push("--permission-mode", o.mode === "bypass" ? "bypassPermissions" : "acceptEdits");
  } else if (lv.permissionMode) args.push("--permission-mode", lv.permissionMode);
  for (const d of o.addDirs || []) if (fs.existsSync(d)) args.push("--add-dir", d);
  if (o.resume) args.push("--resume", o.resume);
  args.push("--allowedTools", ...allow);
  args.push("--disallowedTools", ...deny);
  return args;
}

/** Every run reports whether Claude was signed in, so the dashboard's connection status stays true (missions, chat, Code, mail…). */
const resultListeners = new Set<(r: RunResult, o: RunOptions) => void>();
export function onRunResult(fn: (r: RunResult, o: RunOptions) => void) { resultListeners.add(fn); }
export function runClaude(o: RunOptions): Promise<RunResult> {
  return runClaudeInner(o).then(r => { for (const fn of resultListeners) { try { fn(r, o); } catch {} } return r; });
}
function runClaudeInner(o: RunOptions): Promise<RunResult> {
  const fake = process.env.HQ_FAKE_CLAUDE; // test seam: a JS file that imitates the CLI
  const bin = fake ? process.execPath : findClaude();
  const started = Date.now();
  if (!bin) return Promise.resolve({ ok: false, kind: "missing", text: "Claude CLI not found. Install Claude Code or set claude.bin in config/hq.json.", sessionId: null, durationMs: 0 });
  return new Promise(resolve => {
    // Don't leak the parent Claude session's environment (e.g. when HQ is started from a Claude session):
    // background runs must use the CLI's own sign-in so they behave the same at boot.
    const env: Record<string, string | undefined> = { ...process.env, HQ_BACKGROUND: "1" };
    for (const k of Object.keys(env)) if (/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_AGENT_SDK|CLAUDE_PID|CLAUDE_EFFORT|ANTHROPIC_BASE_URL)/.test(k)) delete env[k];
    const args = buildArgs(o);
    const child = spawn(bin, fake ? [fake, ...args] : args, { cwd: ROOT, windowsHide: true, env });
    if (child.pid) { children.add(child.pid); child.on("exit", () => children.delete(child.pid!)); }
    if (child.pid && o.onSpawn) o.onSpawn(child.pid);
    let out = "", err = "", timedOut = false;
    const narrator = o.onStep ? createNarrator(o.onStep) : null;
    child.stdout.on("data", d => { out += d; if (narrator) try { narrator.feed(String(d)); } catch {} });
    child.stderr.on("data", d => { err += d; });
    child.stdin.end(o.prompt);
    const timer = setTimeout(() => { timedOut = true; killTree(child.pid); }, o.timeoutMs);
    child.on("error", e => { clearTimeout(timer); resolve({ ok: false, kind: "error", text: String(e), sessionId: null, durationMs: Date.now() - started }); });
    child.on("close", () => {
      clearTimeout(timer);
      try { fs.unlinkSync(path.join(DATA, "mcp", `${o.runId || "adhoc"}.json`)); } catch {}
      resolve(interpret(out, err, timedOut, Date.now() - started));
    });
  });
}

// Every agent process HQ starts, so they can be stopped with HQ (never left running on their own).
const children = new Set<number>();
export function killAll() { for (const pid of children) killTree(pid); children.clear(); }

/** At startup no run is active, so any agent process HQ started earlier (before a crash, update or forced
 *  stop) is an orphan: stop it. Matched by HQ's own per-run MCP config folder and hq-brain server path,
 *  so the desktop app and the owner's own Claude Code sessions are never touched. */
export function sweepOrphans(): number {
  const marks = [path.join(DATA, "mcp").toLowerCase(), path.join(ROOT, "src", "mcp", "hq-brain.ts").toLowerCase()];
  let list: { pid: number; cmd: string }[] = [];
  try {
    if (process.platform === "win32") {
      const r = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", "Get-CimInstance Win32_Process -Filter \"Name='claude.exe' OR Name='node.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"], { windowsHide: true, encoding: "utf8", timeout: 20e3 });
      const j = JSON.parse(r.stdout || "[]"); list = (Array.isArray(j) ? j : [j]).map((x: any) => ({ pid: Number(x.ProcessId), cmd: String(x.CommandLine || "") }));
    } else {
      const r = spawnSync("ps", ["-eo", "pid=,args="], { encoding: "utf8", timeout: 10e3 });
      list = String(r.stdout || "").split("\n").map(l => l.trim().match(/^(\d+)\s+(.*)$/)).filter(Boolean).map((m: any) => ({ pid: Number(m[1]), cmd: m[2] }));
    }
  } catch { return 0; }
  let n = 0;
  for (const p of list) {
    if (!p.pid || p.pid === process.pid || p.pid === process.ppid) continue;
    const c = p.cmd.toLowerCase();
    if (marks.some(m => c.includes(m))) { killTree(p.pid); n++; }
  }
  return n;
}

export function killTree(pid?: number) {
  if (!pid) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true });
  else try { process.kill(-pid, "SIGKILL"); } catch { try { process.kill(pid, "SIGKILL"); } catch {} }
}

function interpret(out: string, err: string, timedOut: boolean, durationMs: number): RunResult {
  let j: any = null;
  // stream-json: the final {"type":"result"} event carries the answer. Fall back to the last JSON line.
  const lines = out.trim().split(/\r?\n/).reverse();
  let last: any = null;
  for (const l of lines) {
    if (!l.trim().startsWith("{")) continue;
    try { const x = JSON.parse(l); last ??= x; if (x?.type === "result") { j = x; break; } } catch {}
  }
  j ??= last?.type === "result" || last?.result !== undefined ? last : null;
  const plain = out.split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith("{")).join("\n").trim();
  // No final result (killed, crashed, limit…): use the assistant's last words, never raw JSON or base64.
  let said = "";
  if (j?.result == null) for (const l of lines) { if (!l.trim().startsWith("{")) continue; try { const x = JSON.parse(l); if (x?.type === "assistant") { const t = (x.message?.content || []).filter((c: any) => c?.type === "text").map((c: any) => c.text).join("\n").trim(); if (t) { said = t; break; } } } catch {} }
  const clean = (t: string) => t.replace(/[A-Za-z0-9+/=]{200,}/g, "[…]").slice(0, 4000);
  const text: string = j?.result ?? clean(said || plain || err.trim() || "");
  const sessionId: string | null = j?.session_id ?? null;
  const turns = j?.num_turns;
  const stats = runStats(lines, j);
  if (timedOut) return { ok: false, kind: "timeout", text: text || "Stopped at the time limit.", sessionId, durationMs, turns, stats };
  const blob = `${text}\n${err}`;
  if (/not logged in|please run \/login|invalid api key|oauth token (has )?expired|authentication_error/i.test(blob))
    return { ok: false, kind: "auth", text, sessionId, durationMs };
  if ((j?.is_error || !j) && /usage limit|limit reached|limit will reset|out of (extra )?usage|rate.?limit|resets? (at|in)|hit (your )?(weekly|five.hour|5.hour|session|plan)?\s*limit/i.test(blob))
    return { ok: false, kind: "limit", text, sessionId, durationMs, resetAt: parseReset(blob), turns, stats };
  if (!j || j.is_error) return { ok: false, kind: "error", text: text || "Claude returned an error.", sessionId, durationMs, turns, stats };
  return { ok: true, kind: "ok", text, sessionId, durationMs, turns, stats };
}

/** Context size (tokens the model saw on its last call), context window, cost and plan-limit info from stream-json. */
function runStats(linesNewestFirst: string[], result: any): RunStats | null {
  let ctx = 0, outT = 0, rate: RunStats["rate"] = null;
  for (const l of linesNewestFirst) {
    if (!l.startsWith("{")) continue;
    let x: any; try { x = JSON.parse(l); } catch { continue; }
    if (!ctx && x?.type === "assistant" && x.message?.usage) { const u = x.message.usage; ctx = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0); outT = u.output_tokens || 0; }
    if (!rate && x?.type === "rate_limit_event") { const r = x.rate_limit_info || x; rate = { status: r.status, type: r.rateLimitType || r.type, resetsAt: r.resetsAt ? Number(r.resetsAt) * (Number(r.resetsAt) < 1e12 ? 1000 : 1) : null, utilization: typeof r.utilization === "number" ? r.utilization : null }; }
    if (ctx && rate) break;
  }
  const mu: any = result?.modelUsage ? Object.values(result.modelUsage)[0] : null;
  if (!ctx && !result) return null;
  return { context: ctx, window: mu?.contextWindow || null, output: outT || result?.usage?.output_tokens || 0, cost: typeof result?.total_cost_usd === "number" ? result.total_cost_usd : null, rate };
}

/** Reads a reset time out of a usage-limit message. Returns epoch ms or null. */
export function parseReset(s: string, now = new Date()): number | null {
  const epoch = s.match(/\|(\d{10})\b/);
  if (epoch) return Number(epoch[1]) * 1000;
  const rel = s.match(/resets? in (\d+)\s*(h|hr|hour|m|min)/i);
  if (rel) return now.getTime() + Number(rel[1]) * (rel[2].toLowerCase().startsWith("h") ? 3600e3 : 60e3);
  const clock = s.match(/resets?(?: at)?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (clock) {
    let h = Number(clock[1]) % 12; if (clock[3].toLowerCase() === "pm") h += 12;
    const d = new Date(now); d.setHours(h, Number(clock[2] || 0), 0, 0);
    const dayMatch = s.match(/(mon|tue|wed|thu|fri|sat|sun)[a-z]*/i);
    if (dayMatch) {
      const want = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(dayMatch[1].toLowerCase());
      while (d.getDay() !== want || d <= now) d.setDate(d.getDate() + 1);
    } else if (d <= now) d.setDate(d.getDate() + 1);
    return d.getTime() + 60e3; // one minute of slack
  }
  return null;
}
