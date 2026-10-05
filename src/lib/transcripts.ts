// Claude Code session transcripts: the one shared chat store. Dashboard (Luthor) chats run `claude -p`
// in the HQ folder, and Claude Code sessions opened on the HQ folder (terminal or the Claude app's Code tab)
// are saved in the same place, so both show up together and either can be resumed from the other.
// Read-only. Only user/assistant text is returned: tool calls, tool output and thinking are dropped.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT } from "./store.ts";

export type TMsg = { role: "you" | "hq"; text: string; at: string };
export type Transcript = { sessionId: string; title: string; at: string; count: number; source: "dashboard" | "claude" | null; messages: TMsg[] };

const SESSION_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const validSessionId = (s: string) => SESSION_RE.test(s || "");

function projectsDir(): string {
  return path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "projects");
}

/** Claude Code names a project's folder after its cwd with every non-alphanumeric char turned into "-". */
function sessionDir(): string | null {
  const want = ROOT.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase();
  try { return fs.readdirSync(projectsDir()).filter(d => d.toLowerCase() === want).map(d => path.join(projectsDir(), d))[0] || null; }
  catch { return null; }
}

// Strip harness noise Claude Code stores inside user turns (reminders, slash-command wrappers).
function clean(s: string): string {
  return s.replace(/<(system-reminder|local-command-stdout|local-command-caveat|command-message|command-args)>[\s\S]*?<\/\1>/g, "")
    .replace(/<command-name>([\s\S]*?)<\/command-name>/g, "$1").trim();
}
function textOf(content: unknown): string {
  if (typeof content === "string") return clean(content);
  if (!Array.isArray(content)) return "";
  return clean(content.filter((b: any) => b?.type === "text").map((b: any) => String(b.text || "")).join("\n"));
}

const cache = new Map<string, { key: string; t: Transcript }>();
function parse(file: string): Transcript | null {
  let st: fs.Stats; try { st = fs.statSync(file); } catch { return null; }
  const key = `${st.size}:${st.mtimeMs}`;
  const hit = cache.get(file); if (hit?.key === key) return hit.t;
  const sessionId = path.basename(file, ".jsonl");
  const messages: TMsg[] = [];
  let title = "", origin: string | null = null; // where the session started (first entrypoint seen)
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line) continue;
    let j: any; try { j = JSON.parse(line); } catch { continue; }
    if (j.type === "custom-title" && j.customTitle) title = String(j.customTitle);
    if (j.type === "summary" && j.summary && !title) title = String(j.summary);
    if ((j.type !== "user" && j.type !== "assistant") || j.isSidechain || j.isMeta) continue;
    if (origin === null && j.entrypoint) origin = String(j.entrypoint);
    const text = textOf(j.message?.content);
    if (!text) continue;
    messages.push({ role: j.type === "user" ? "you" : "hq", text, at: String(j.timestamp || "") });
  }
  if (!messages.length) return null;
  const first = messages.find(m => m.role === "you")?.text || "";
  title = (title || first || "(no text)").split("\n")[0];
  const t: Transcript = { sessionId, title: title.length > 80 ? title.slice(0, 79) + "…" : title, at: messages[messages.length - 1].at,
    count: messages.length, source: origin === null ? null : origin.startsWith("sdk") ? "dashboard" : "claude", messages };
  cache.set(file, { key, t });
  return t;
}

export function listTranscripts(): Transcript[] {
  const dir = sessionDir(); if (!dir) return [];
  let files: string[] = []; try { files = fs.readdirSync(dir).filter(f => f.endsWith(".jsonl") && validSessionId(f.slice(0, -6))); } catch {}
  return files.map(f => parse(path.join(dir, f))).filter((t): t is Transcript => !!t);
}

export function getTranscript(sessionId: string): Transcript | null {
  if (!validSessionId(sessionId)) return null;
  const dir = sessionDir(); return dir ? parse(path.join(dir, `${sessionId}.jsonl`)) : null;
}
