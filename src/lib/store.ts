// Tiny file store: JSON/text helpers with atomic writes (OneDrive-safe retries).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const BRAIN = path.join(ROOT, "brain");
export const PROJECTS = path.join(BRAIN, "projects");
export const TEMPLATES = path.join(BRAIN, "templates");
export const DATA = path.join(ROOT, "data");
export const DROP = path.join(DATA, "drop");
export const CONFIG = path.join(ROOT, "config");
export const WEB = path.join(ROOT, "web");

export function readText(file: string, fallback = ""): string {
  try { return fs.readFileSync(file, "utf8"); } catch { return fallback; }
}

export function readJson<T>(file: string, fallback: T): T {
  // strip a UTF-8 BOM: Windows PowerShell / Notepad add one, and JSON.parse rejects it
  try { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")) as T; } catch { return fallback; }
}

export function writeText(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, text);
  for (let i = 0; i < 5; i++) {
    try { fs.renameSync(tmp, file); return; } catch (e) {
      // OneDrive or an editor can hold a lock for a moment.
      if (i === 4) { fs.writeFileSync(file, text); try { fs.unlinkSync(tmp); } catch {} return; }
      const until = Date.now() + 60 * (i + 1); while (Date.now() < until) { /* brief spin */ }
    }
  }
}

export function writeJson(file: string, value: unknown): void {
  writeText(file, JSON.stringify(value, null, 2) + "\n");
}

export function appendLine(file: string, line: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, line + "\n");
}

export function uid(prefix = ""): string {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

const pad = (n: number) => String(n).padStart(2, "0");
export function localDate(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function localStamp(d = new Date()): string {
  return `${localDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** mtime+size fingerprint of files/folders, used to skip missions when nothing changed. */
export function fingerprint(relPaths: string[]): string {
  const parts: string[] = [];
  const walk = (p: string) => {
    let st: fs.Stats;
    try { st = fs.statSync(p); } catch { parts.push(p + ":missing"); return; }
    if (st.isDirectory()) {
      for (const name of fs.readdirSync(p).sort()) if (!name.endsWith(".tmp")) walk(path.join(p, name));
    } else parts.push(`${p}:${st.size}:${Math.floor(st.mtimeMs)}`);
  };
  for (const r of relPaths) walk(path.resolve(ROOT, r));
  let h = 0;
  for (const ch of parts.join("|")) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return String(h >>> 0);
}
