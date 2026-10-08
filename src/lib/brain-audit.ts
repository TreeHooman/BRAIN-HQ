// Brain audit + Undo + routine/non-routine gate (autonomy phase 1, docs/AUTONOMY-DESIGN.md).
// Every agent brain write is recorded as file-level before/after versions. Contents are stored once each,
// gzipped, by hash, so a log append costs a few KB. Undo puts back the files that still match "after".
// Background runs (not the owner's chat/Code) send non-routine changes to the owner instead of applying them.
// Pure file work, no model calls. Used by both the hq-brain MCP process and the server.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createHash } from "node:crypto";
import { BRAIN, DATA, ROOT, appendLine, readJson, writeJson, uid } from "./store.ts";
import * as brain from "./brain.ts";

const DIR = path.join(DATA, "brain-audit"), LOG = path.join(DIR, "log.jsonl"), BLOBS = path.join(DIR, "blobs"), UNDONE = path.join(DIR, "undone.json");
const KEEP = 1500, MAX_FILE = 1_000_000;
const SKIP = new Set(["history", "templates", "INDEX.md"]);

export type FileChange = { file: string; before: string | null; after: string | null };
export type Change = { id: string; at: string; run: string; actor: string; tool: string; summary: string; project?: string | null; files: FileChange[]; approvedBy?: string };

// ---------- snapshots ----------
function walk(dir: string, out: Map<string, string>, top = true) {
  let entries: fs.Dirent[] = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (top && SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out, false);
    // STATE.md is a generated projection (project-state.ts), not something an agent changed.
    else if (e.isFile() && !e.name.endsWith(".tmp") && e.name !== "STATE.md") {
      try { if (fs.statSync(p).size <= MAX_FILE) out.set(path.relative(ROOT, p), hashOf(fs.readFileSync(p))); } catch {}
    }
  }
}
const hashOf = (b: Buffer) => createHash("sha256").update(b).digest("hex").slice(0, 32);
function snapshot(): Map<string, string> { const m = new Map<string, string>(); walk(BRAIN, m); return m; }
function store(rel: string): string | null {
  let buf: Buffer; try { buf = fs.readFileSync(path.join(ROOT, rel)); } catch { return null; }
  const h = hashOf(buf), f = path.join(BLOBS, h + ".gz");
  if (!fs.existsSync(f)) { fs.mkdirSync(BLOBS, { recursive: true }); fs.writeFileSync(f, zlib.gzipSync(buf)); }
  return h;
}
function blob(h: string): Buffer { return zlib.gunzipSync(fs.readFileSync(path.join(BLOBS, h + ".gz"))); }

/** Runs fn and records which brain files it changed. The "before" copy is saved first so Undo always has it. */
export async function audited<T>(meta: { run: string; actor: string; tool: string; summary: string; project?: string | null; approvedBy?: string }, fn: () => T | Promise<T>): Promise<T> {
  const before = snapshot();
  for (const rel of before.keys()) if (!fs.existsSync(path.join(BLOBS, before.get(rel) + ".gz"))) store(rel);
  const out = await fn();
  const after = snapshot(), files: FileChange[] = [];
  for (const rel of new Set([...before.keys(), ...after.keys()])) {
    const b = before.get(rel) ?? null, a = after.get(rel) ?? null;
    if (b === a) continue;
    if (a) store(rel);
    files.push({ file: rel.replace(/\\/g, "/"), before: b, after: a });
  }
  if (files.length) {
    const c: Change = { id: uid("bc"), at: new Date().toISOString(), ...meta, summary: meta.summary.slice(0, 200), files };
    appendLine(LOG, JSON.stringify(c));
    if (Math.random() < 0.02) prune();
  }
  return out;
}

// ---------- reading + Undo (server) ----------
export function list(limit = 40, project?: string): (Change & { undone?: string | null })[] {
  let lines: string[] = [];
  try { lines = fs.readFileSync(LOG, "utf8").trim().split("\n"); } catch { return []; }
  const undone = readJson<Record<string, string>>(UNDONE, {});
  const out: (Change & { undone?: string | null })[] = [];
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    try { const c = JSON.parse(lines[i]) as Change; if (!project || c.project === project) out.push({ ...c, undone: undone[c.id] || null }); } catch {}
  }
  return out;
}
export function get(id: string): Change | null { return list(KEEP).find(c => c.id === id) || null; }

/** Put back the files of one change. A file edited again since then is left alone and reported. */
export function undo(id: string, by = "owner"): { restored: string[]; conflicts: string[]; change: Change } {
  const c = get(id);
  if (!c) throw Object.assign(new Error("That change is too old or doesn't exist."), { code: 404 });
  const undone = readJson<Record<string, string>>(UNDONE, {});
  if (undone[id]) throw new Error("Already undone.");
  const restored: string[] = [], conflicts: string[] = [];
  for (const f of c.files) {
    const abs = path.join(ROOT, f.file);
    let cur: string | null = null; try { cur = hashOf(fs.readFileSync(abs)); } catch {}
    if (cur !== f.after) { conflicts.push(f.file); continue; }
    if (f.before) { fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, blob(f.before)); } else { try { fs.unlinkSync(abs); } catch {} }
    restored.push(f.file);
  }
  if (restored.length) { undone[id] = new Date().toISOString(); writeJson(UNDONE, undone); }
  try { brain.regenerateIndex(); } catch {}
  appendLine(path.join(DATA, "activity.jsonl"), JSON.stringify({ at: new Date().toISOString(), event: "brain-undo", change: id, by, restored, conflicts }));
  return { restored, conflicts, change: c };
}

function prune() {
  try {
    const lines = fs.readFileSync(LOG, "utf8").trim().split("\n");
    if (lines.length <= KEEP + 300) return;
    const keep = lines.slice(-KEEP);
    fs.writeFileSync(LOG, keep.join("\n") + "\n");
    const used = new Set<string>();
    for (const l of keep) try { for (const f of JSON.parse(l).files) { if (f.before) used.add(f.before); if (f.after) used.add(f.after); } } catch {}
    for (const h of snapshot().values()) used.add(h); // current files may be the "before" of the next change
    for (const b of fs.readdirSync(BLOBS)) if (!used.has(b.replace(/\.gz$/, ""))) try { fs.unlinkSync(path.join(BLOBS, b)); } catch {}
  } catch {}
}

// ---------- routine vs non-routine ----------
const BIG_FIELDS = ["name", "kind", "paths", "repos", "maxPermission"];
/** Why a background run's brain change needs the owner's OK, or null when it's routine. */
export function needsOwner(tool: string, a: any): string | null {
  if (tool === "project_create") return `creates a new project "${String(a.name || "").slice(0, 60)}"`;
  if (tool === "project_update") {
    const f = a.fields || {}, p = brain.getProject(String(a.slug || ""));
    const big = BIG_FIELDS.filter(k => k in f);
    if (big.length) return `changes ${big.join(", ")} of ${a.slug}`;
    if (p && typeof f.stage === "string" && f.stage !== p.stage) {
      if (["live", "done", "paused"].includes(f.stage)) return `marks ${a.slug} as ${f.stage}`;
      const order = brain.STAGES;
      if (p.stage !== "paused" && order.indexOf(f.stage) < order.indexOf(p.stage)) return `moves ${a.slug} back from ${p.stage} to ${f.stage}`;
    }
    return null;
  }
  if (tool === "project_write") {
    let old = ""; try { old = brain.readDoc(String(a.slug), String(a.part)); } catch { return null; }
    const oldLines = old.split("\n").map(l => l.trim()).filter(l => l && !/^_?not written yet/i.test(l));
    if (oldLines.length < 6) return null;
    const next = new Set(String(a.content || "").split("\n").map(l => l.trim()));
    const kept = oldLines.filter(l => next.has(l)).length / oldLines.length;
    return kept < 0.5 ? `rewrites most of ${a.slug}'s ${a.part} (keeps ${Math.round(kept * 100)}% of it)` : null;
  }
  if (tool === "goal_save" && a.id) {
    const g = brain.listGoals().find(x => x.id === a.id);
    if (!g) return null;
    const ids = new Set((a.steps || []).map((s: any) => s?.id).filter(Boolean));
    const gone = g.steps.filter(s => !ids.has(s.id)).length;
    return gone ? `removes ${gone} step${gone > 1 ? "s" : ""} from goal "${g.title.slice(0, 60)}"` : null;
  }
  return null;
}

/** The gated tools, applied the same way whether the agent runs them or the owner approves them later. */
export function applyOp(tool: string, a: any): string {
  if (tool === "project_update") { const f = { ...a.fields }; delete f.maxPermission; brain.updateProject(a.slug, f); return `Updated ${a.slug}.`; }
  if (tool === "project_write") { brain.writeDoc(a.slug, a.part, a.content, { capSummary: true }); return `Wrote ${a.part} for ${a.slug}.`; }
  if (tool === "project_create") { const p = brain.createProject(a); return `Created project ${p.slug}.`; }
  if (tool === "goal_save") { const g = brain.saveGoal(a); return `Goal ${g.id} saved with ${g.steps.length} steps.`; }
  throw new Error(`Not a gated tool: ${tool}`);
}
export const GATED = new Set(["project_update", "project_write", "project_create", "goal_save"]);

/** Short human description of a tool call for the change list. */
export function describe(tool: string, a: any): string {
  const s = (v: unknown, n = 90) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
  switch (tool) {
    case "project_update": return `${a.slug}: ${Object.entries(a.fields || {}).map(([k, v]) => `${k} → ${s(typeof v === "string" ? v : JSON.stringify(v), 70)}`).join("; ")}`;
    case "project_write": return `${a.slug}: rewrote ${a.part}`;
    case "project_log": return `${a.slug}: log · ${s(a.text)}`;
    case "decision_log": return `decision · ${s(a.text)}`;
    case "reminder_add": return `reminder · ${s(a.title)} (${s(a.due, 20)})`;
    case "reminder_done": return `reminder done · ${s(a.id, 30)}`;
    case "milestone_add": return `milestone · ${s(a.title)} (${s(a.date, 12)})`;
    case "goal_save": return `goal · ${s(a.title)}`;
    case "goal_step_done": return `goal step ${a.done === false ? "reopened" : "done"}`;
    default: return `${tool} · ${s(JSON.stringify(a), 80)}`;
  }
}
