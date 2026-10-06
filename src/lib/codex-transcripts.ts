// Read-only view of local Codex chats started outside LUTHUR. Never imports transcripts into brain/.
// Only user input text and assistant final answers are exposed; reasoning, tools and system messages are ignored.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { ROOT } from "./store.ts";

export type CodexMessage = { role: "you" | "hq"; text: string; at: string };
export type CodexChat = { id: string; title: string; at: string; source: "codex"; count: number | null; readOnly: true };
export type CodexTranscript = CodexChat & { messages: CodexMessage[] };
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fileId = (file: string) => path.basename(file, ".jsonl").match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i)?.[1] || "";
const BASE = path.join(os.homedir(), ".codex", "sessions");
const MAX_FILES = 1000;
const cache = new Map<string, { key: string; chat: CodexChat | null }>();
let inventory: { until: number; files: string[] } = { until: 0, files: [] };

function files(): string[] {
  if (Date.now() < inventory.until) return inventory.files;
  const found: { file: string; mtime: number }[] = [];
  const dirs = [BASE];
  while (dirs.length) {
    const dir = dirs.pop()!;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) dirs.push(file);
      else if (entry.isFile() && entry.name.endsWith(".jsonl") && ID.test(fileId(entry.name))) {
        try { found.push({ file, mtime: fs.statSync(file).mtimeMs }); } catch {}
      }
    }
  }
  found.sort((a, b) => b.mtime - a.mtime);
  inventory = { until: Date.now() + 30_000, files: found.slice(0, MAX_FILES).map(x => x.file) };
  return inventory.files;
}

function contentText(content: unknown, type: "input_text" | "output_text"): string {
  if (!Array.isArray(content)) return "";
  return content.filter((c: any) => c?.type === type && typeof c.text === "string").map((c: any) => c.text).join("\n").trim();
}

function message(j: any): CodexMessage | null {
  if (j?.type !== "response_item" || j.payload?.type !== "message") return null;
  const p = j.payload;
  if (p.role === "user") {
    const text = contentText(p.content, "input_text");
    if (/^<(environment_context|external_codex_apps_open_page)>/.test(text)) return null;
    return text ? { role: "you", text, at: String(j.timestamp || "") } : null;
  }
  if (p.role === "assistant" && p.phase === "final_answer") {
    const text = contentText(p.content, "output_text");
    return text ? { role: "hq", text, at: String(j.timestamp || "") } : null;
  }
  return null;
}

function meta(file: string): CodexChat | null {
  let st: fs.Stats;
  try { st = fs.statSync(file); } catch { return null; }
  const key = `${st.size}:${st.mtimeMs}`;
  const hit = cache.get(file);
  if (hit?.key === key) return hit.chat;
  // Codex writes session metadata and the first user turn near the start of each JSONL file.
  // Cap listing reads so a large transcript cannot make opening History slow.
  const bytes = Math.min(st.size, 128 * 1024), buf = Buffer.alloc(bytes);
  let n = 0;
  try { const fd = fs.openSync(file, "r"); try { n = fs.readSync(fd, buf, 0, bytes, 0); } finally { fs.closeSync(fd); } } catch { return null; }
  let title = "", cwd = "", at = "";
  for (const line of buf.toString("utf8", 0, n).split("\n").slice(0, -1)) {
    let j: any; try { j = JSON.parse(line); } catch { continue; }
    if (j.type === "session_meta") { cwd ||= String(j.payload?.cwd || ""); at ||= String(j.payload?.timestamp || j.timestamp || ""); }
    const m = message(j);
    if (m?.role === "you") {
      const candidate = m.text.split("\n").find(s => s.trim())?.trim() || "";
      if (candidate) { title = candidate; break; }
    }
  }
  // HQ's own Codex runs have their own first-class HQ history; avoid duplicate external listings.
  const sameRoot = cwd && path.resolve(cwd).toLowerCase() === path.resolve(ROOT).toLowerCase();
  const chat: CodexChat | null = sameRoot || !title ? null : {
    id: fileId(file), title: title.slice(0, 100), at: new Date(st.mtimeMs).toISOString(),
    source: "codex", count: null, readOnly: true,
  };
  cache.set(file, { key, chat });
  return chat;
}

export function listCodexChats(limit = 100): CodexChat[] {
  const out: CodexChat[] = [];
  for (const file of files()) {
    const chat = meta(file); if (chat) out.push(chat);
    if (out.length >= Math.min(200, Math.max(1, limit))) break;
  }
  return out;
}

async function parse(file: string): Promise<CodexTranscript | null> {
  const chat = meta(file); if (!chat) return null;
  const messages: CodexMessage[] = [];
  const stream = fs.createReadStream(file, { encoding: "utf8" });
  try {
    for await (const line of readline.createInterface({ input: stream, crlfDelay: Infinity })) {
      let j: any; try { j = JSON.parse(line); } catch { continue; }
      const m = message(j); if (m) messages.push(m);
    }
  } finally { stream.destroy(); }
  return { ...chat, count: messages.length, messages };
}

export async function getCodexChat(id: string): Promise<CodexTranscript | null> {
  if (!ID.test(id)) return null;
  const file = files().find(f => fileId(f) === id);
  return file ? parse(file) : null;
}

export async function searchCodexChats(query: string, limit = 50): Promise<CodexChat[]> {
  const words = query.trim().toLowerCase().slice(0, 200).split(/\s+/).filter(Boolean);
  if (!words.length) return listCodexChats(limit);
  const out: CodexChat[] = [];
  for (const file of files()) {
    const chat = meta(file); if (!chat) continue;
    if (words.every(w => chat.title.toLowerCase().includes(w))) { out.push(chat); }
    else {
      const transcript = await parse(file);
      if (transcript && words.every(w => transcript.messages.some(m => m.text.toLowerCase().includes(w)))) out.push(chat);
    }
    if (out.length >= Math.min(100, Math.max(1, limit))) break;
  }
  return out;
}
