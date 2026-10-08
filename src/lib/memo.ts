// Small cache for stable context (config, project list, preferences, agent rules). An entry is reused only while the
// files it was built from keep the same size+mtime; HQ's own writes (store.writeText) also clear entries explicitly.
// Callers get the cached value itself unless the wrapper copies it, so treat results as read-only.
import fs from "node:fs";
import path from "node:path";
import { onWrite } from "./store.ts";

type Entry = { sig: string; value: unknown; files: string[] };
const cache = new Map<string, Entry>();
let hits = 0, misses = 0;

function sigOf(files: string[]): string {
  let s = "";
  for (const f of files) { try { const st = fs.statSync(f); s += `${st.size}:${st.mtimeMs}|`; } catch { s += "-|"; } }
  return s;
}
/** Value for key, rebuilt when any watched file (or folder listing) changes. */
export function memo<T>(key: string, files: string[] | (() => string[]), build: () => T): T {
  const list = typeof files === "function" ? files() : files;
  const sig = sigOf(list), hit = cache.get(key);
  if (hit && hit.sig === sig) { hits++; return hit.value as T; }
  misses++;
  const value = build();
  cache.set(key, { sig, value, files: list.map(f => path.resolve(f)) });
  return value;
}
export function invalidate(prefix = "") { for (const k of [...cache.keys()]) if (k.startsWith(prefix)) cache.delete(k); }
export function stats() { return { entries: cache.size, hits, misses }; }

// Explicit invalidation: a write by HQ drops every entry built from that file or a file in that folder.
onWrite(file => {
  const f = path.resolve(file), dir = path.dirname(f);
  for (const [k, e] of cache) if (e.files.some(x => x === f || x === dir)) cache.delete(k);
});
