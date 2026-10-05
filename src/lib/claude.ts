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
};
export type RunResult = {
  ok: boolean; text: string; sessionId: string | null; durationMs: number;
  kind: "ok" | "error" | "limit" | "auth" | "timeout" | "missing";
  resetAt?: number | null; turns?: number;
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
  if (lv.permissionMode) args.push("--permission-mode", lv.permissionMode);
  for (const d of o.addDirs || []) if (fs.existsSync(d)) args.push("--add-dir", d);
  if (o.resume) args.push("--resume", o.resume);
  args.push("--allowedTools", ...allow);
  args.push("--disallowedTools", ...deny);
  return args;
}

export function runClaude(o: RunOptions): Promise<RunResult> {
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
  const text: string = j?.result ?? (plain || err.trim() || (j ? "" : out.trim().slice(-2000)));
  const sessionId: string | null = j?.session_id ?? null;
  const turns = j?.num_turns;
  if (timedOut) return { ok: false, kind: "timeout", text: text || "Stopped at the time limit.", sessionId, durationMs, turns };
  const blob = `${text}\n${err}`;
  if (/not logged in|please run \/login|invalid api key|oauth token (has )?expired|authentication_error/i.test(blob))
    return { ok: false, kind: "auth", text, sessionId, durationMs };
  if ((j?.is_error || !j) && /usage limit|limit reached|limit will reset|out of (extra )?usage|rate.?limit|resets? (at|in)|hit your limit/i.test(blob))
    return { ok: false, kind: "limit", text, sessionId, durationMs, resetAt: parseReset(blob) };
  if (!j || j.is_error) return { ok: false, kind: "error", text: text || "Claude returned an error.", sessionId, durationMs, turns };
  return { ok: true, kind: "ok", text, sessionId, durationMs, turns };
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
