// Code-enforced limits for agent runs (Claude's deny lists don't reach Codex). Two layers:
// 1. safeWriteDirs: a Codex build run may only write project folders that are not HQ itself, not inside or
//    around HQ, and not LoanCentral-Test (or any folder that contains it).
// 2. watch/check: HQ's own code, config and start scripts are snapshotted before every build run and compared
//    after it. config/** and scripts/** are restored (an agent must never change its own permissions or what runs
//    at sign-in); src/** changes are reported with the earlier copy kept in data/guard/<run>/, because the owner
//    may be editing code at the same time.
// Pure file work, no model calls.
import fs from "node:fs";
import path from "node:path";
import { DATA, ROOT, appendLine, onWrite } from "./store.ts";
import { notify } from "./notify.ts";

const WATCH = ["config", "src", "scripts"], RESTORE = ["config", "scripts"];
const MAX_FILE = 2_000_000;
const norm = (p: string) => path.resolve(p).toLowerCase().replace(/[\\/]+$/, "");
const within = (child: string, parent: string) => child === parent || child.startsWith(parent + path.sep);

function protectedRoots(extra: string[] = []): string[] {
  const named = [path.resolve(ROOT, "..", "LoanBot", "LoanCentral-Test"), ...extra];
  return [ROOT, ...named].map(norm);
}

/** Folders a build run may write. Drops HQ, anything inside it or containing it, and LoanCentral-Test (inside or around). */
export function safeWriteDirs(dirs: string[], extra: string[] = []): { ok: string[]; dropped: { dir: string; reason: string }[] } {
  const roots = protectedRoots(extra), ok: string[] = [], dropped: { dir: string; reason: string }[] = [];
  for (const d of dirs) {
    const n = norm(d);
    const hit = roots.find(r => within(n, r) || within(r, n));
    if (hit || /(^|[\\/])loancentral-test([\\/]|$)/i.test(n)) dropped.push({ dir: d, reason: hit === norm(ROOT) ? "HQ's own folder" : "protected folder (LoanCentral-Test)" });
    else if (!ok.some(x => norm(x) === n)) ok.push(d);
  }
  return { ok, dropped };
}

/** Empty workspace for a Codex build run that has no writable project folder. */
export function scratchWorkspace(): string {
  const dir = path.join(DATA, "codex-work");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

type Snap = Map<string, Buffer | null>;
const active = new Map<string, Snap>();

function walk(dir: string, out: string[]) {
  let entries: fs.Dirent[] = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && !e.name.endsWith(".tmp")) out.push(p);
  }
}
function files(): string[] { const out: string[] = []; for (const d of WATCH) walk(path.join(ROOT, d), out); return out; }
function read(p: string): Buffer | null {
  try { const st = fs.statSync(p); return st.size > MAX_FILE ? null : fs.readFileSync(p); } catch { return null; }
}

// HQ's own server writes (settings saves) are the owner's, so they update every open snapshot.
onWrite(file => {
  const f = path.resolve(file);
  if (!active.size || !WATCH.some(d => within(f, path.join(ROOT, d)))) return;
  const buf = read(f);
  for (const s of active.values()) s.set(f, buf);
});

/** Snapshot HQ code/config before a build run. */
export function watch(runId: string) {
  const snap: Snap = new Map();
  for (const f of files()) snap.set(f, read(f));
  active.set(runId, snap);
}

export type GuardReport = { restored: string[]; changed: string[]; kept: string | null };
/** Compare after the run. Restores config/** and scripts/**; reports code changes and keeps the earlier copies. */
export function check(runId: string): GuardReport {
  const snap = active.get(runId); active.delete(runId);
  const report: GuardReport = { restored: [], changed: [], kept: null };
  if (!snap) return report;
  const now = new Set(files());
  const keepDir = path.join(DATA, "guard", runId.replace(/[^\w.-]/g, "_"));
  const keep = (f: string, buf: Buffer | null, tag: string) => {
    const dst = path.join(keepDir, tag, path.relative(ROOT, f));
    try { fs.mkdirSync(path.dirname(dst), { recursive: true }); if (buf) fs.writeFileSync(dst, buf); report.kept = keepDir; } catch {}
  };
  for (const f of new Set([...snap.keys(), ...now])) {
    const before = snap.has(f) ? snap.get(f)! : undefined, after = now.has(f) ? read(f) : undefined;
    if (before === null || after === null) continue; // too big to compare
    if (before && after && before.equals(after)) continue;
    const rel = path.relative(ROOT, f);
    if (RESTORE.some(d => within(f, path.join(ROOT, d)))) {
      keep(f, after ?? null, "agent-version");
      try { if (before) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, before); } else fs.unlinkSync(f); report.restored.push(rel); } catch {}
    } else {
      keep(f, before ?? null, "before");
      report.changed.push(rel);
    }
  }
  if (report.restored.length || report.changed.length)
    appendLine(path.join(DATA, "guard", "log.jsonl"), JSON.stringify({ at: new Date().toISOString(), run: runId, ...report }));
  return report;
}

let seq = 0;
/** Runs a build-level agent run between watch() and check(), and tells the owner if anything was undone or changed. */
export async function guarded<T>(runId: string | undefined, level: string, fn: () => Promise<T>): Promise<T> {
  if (level !== "build") return fn();
  const id = `${runId || "adhoc"}-${Date.now().toString(36)}${++seq}`;
  watch(id);
  try { return await fn(); }
  finally {
    const r = check(id);
    if (r.restored.length) notify({ title: "LUTHUR undid a protected change", body: `${runId || "A run"} changed ${r.restored.slice(0, 4).join(", ")}. Put back; the agent's version is in ${path.relative(ROOT, r.kept || "")}.`, priority: 4, tags: "shield" });
    if (r.changed.length) notify({ title: "HQ code changed during a run", body: `${r.changed.slice(0, 4).join(", ")} changed during ${runId || "a run"} (by the agent or you). Earlier copy: ${path.relative(ROOT, r.kept || "")}.`, priority: 3, tags: "warning" });
  }
}
