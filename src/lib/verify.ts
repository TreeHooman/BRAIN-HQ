// Verify-before-done (docs/AUTONOMY-DESIGN.md §6). A build run on a project with folders is checked by code, not by
// the agent's word: the project folders are snapshotted before the run and compared after it, the project's own
// checks (owner-set in config verify.checks, or found: npm test, pytest in a venv) run when files changed, and the
// agent's report is compared with the real file changes. Any failed check or mismatch makes the run "needs a look".
// No model calls. Checks run after the "after" snapshot, so their own leftovers never count as changes.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { loadConfig } from "./config.ts";
import { killTree } from "./claude.ts";
import { redact } from "./narrate.ts";

const SKIP_DIRS = new Set(["node_modules", "venv", ".venv", "env", "__pycache__", ".git", ".pytest_cache", ".mypy_cache", ".next", "dist", "build", "coverage", ".cache"]);
const SKIP_FILE = /\.(log|db|sqlite3?|db-journal|db-wal|pyc|tmp|lock)$/i;
const MAX_FILES = 20000, MAX_HASH = 5_000_000;

export type Snapshot = Map<string, string>; // absolute path -> content hash (or size:mtime for big files)
export type CheckResult = { cmd: string; dir: string; ok: boolean; code: number | null; ms: number; tail: string; timedOut?: boolean };
export type Verify = { at: string; dirs: string[]; changed: string[]; checks: CheckResult[]; skipped: string[]; mismatches: string[]; notes: string[]; ok: boolean };

function walk(dir: string, out: string[]) {
  let entries: fs.Dirent[] = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (out.length >= MAX_FILES) return;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p, out); }
    else if (e.isFile() && !SKIP_FILE.test(e.name)) out.push(p);
  }
}
function sig(p: string): string | null {
  try {
    const st = fs.statSync(p);
    return st.size > MAX_HASH ? `${st.size}:${st.mtimeMs}` : crypto.createHash("sha1").update(fs.readFileSync(p)).digest("hex");
  } catch { return null; }
}

/** Folders that exist; nested duplicates (a folder inside another listed one) are dropped. */
export function projectDirs(paths: string[] | undefined): string[] {
  const ok = (paths || []).map(p => path.resolve(p)).filter(p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } });
  return ok.filter(d => !ok.some(o => o !== d && d.toLowerCase().startsWith(o.toLowerCase() + path.sep)));
}

export function snapshot(dirs: string[]): Snapshot {
  const snap: Snapshot = new Map(), files: string[] = [];
  for (const d of dirs) walk(d, files);
  for (const f of files) { const s = sig(f); if (s) snap.set(f, s); }
  return snap;
}

/** Changed files between two snapshots, as "<folder>/<relative path>" with " (new)" / " (deleted)". */
export function diff(before: Snapshot, after: Snapshot, dirs: string[]): string[] {
  const label = (f: string) => { const d = dirs.find(x => f.toLowerCase().startsWith(x.toLowerCase() + path.sep)); return d ? path.basename(d) + "/" + path.relative(d, f).replace(/\\/g, "/") : f; };
  const out: string[] = [];
  for (const [f, s] of after) if (!before.has(f)) out.push(label(f) + " (new)"); else if (before.get(f) !== s) out.push(label(f));
  for (const f of before.keys()) if (!after.has(f)) out.push(label(f) + " (deleted)");
  return out.sort();
}

/** The checks to run in one folder: the owner's list for the project wins; otherwise what the folder declares. */
export function findChecks(dir: string, slug: string | null | undefined): { cmds: string[]; skipped: string[] } {
  const own = loadConfig().verify?.checks?.[slug || ""];
  if (Array.isArray(own)) return { cmds: own.map(String).filter(Boolean), skipped: [] };
  const cmds: string[] = [], skipped: string[] = [];
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    const t = String(pkg.scripts?.test || "");
    if (t && !/no test specified/i.test(t)) {
      if (fs.existsSync(path.join(dir, "node_modules")) || !Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).length) cmds.push("npm test --silent");
      else skipped.push(`${path.basename(dir)}: npm test (dependencies not installed)`);
    }
  } catch {}
  const hasPyTests = fs.existsSync(path.join(dir, "tests")) || (() => { try { return fs.readdirSync(dir).some(n => /^test_.*\.py$/.test(n)); } catch { return false; } })();
  if (hasPyTests) {
    const py = ["venv", ".venv"].flatMap(v => [path.join(dir, v, "Scripts", "python.exe"), path.join(dir, v, "bin", "python")]).find(p => fs.existsSync(p));
    const hasPytest = py && ["Scripts/pytest.exe", "bin/pytest"].some(x => fs.existsSync(path.join(path.dirname(path.dirname(py)), x)));
    if (py && hasPytest) cmds.push(`"${py}" -m pytest -q -p no:cacheprovider`);
    else skipped.push(`${path.basename(dir)}: python tests (no venv with pytest)`);
  }
  return { cmds, skipped };
}

function runCheck(cmd: string, dir: string, timeoutMs: number): Promise<CheckResult> {
  return new Promise(resolve => {
    const t0 = Date.now(); let out = "", timedOut = false;
    const child = spawn(cmd, { cwd: dir, shell: true, windowsHide: true, env: { ...process.env, CI: "1", PYTHONDONTWRITEBYTECODE: "1" } });
    const add = (b: Buffer) => { out = (out + b.toString("utf8")).slice(-6000); };
    child.stdout?.on("data", add); child.stderr?.on("data", add);
    const timer = setTimeout(() => { timedOut = true; killTree(child.pid); }, timeoutMs);
    const done = (code: number | null) => { clearTimeout(timer); resolve({ cmd, dir, ok: code === 0 && !timedOut, code, ms: Date.now() - t0, tail: redact(out.trim().split(/\r?\n/).slice(-15).join("\n")).slice(-1500), ...(timedOut ? { timedOut } : {}) }); };
    child.on("error", e => { out += String(e); done(null); });
    child.on("close", done);
  });
}

// Brain files live in HQ, not in the project folders, so the report naming them is never a mismatch.
const BRAIN_FILES = /^(summary|plan|log|index|decisions|handoff)\.md$|^(project|milestones|reminders|goals)\.json$/i;
const FILE_RE = /[\w.\-\/\\]*[\w\-]\.(py|ts|tsx|js|mjs|cjs|jsx|json|md|txt|html|css|scss|yml|yaml|toml|cfg|ini|sql|sh|ps1|bat|cmd|java|cs|go|rs|rb|php|csv)\b/gi;
const EDIT_RE = /\b(edit|chang|updat|add|wrote|writ|creat|fix|implement|refactor|renam|delet|remov|replac|patch|rewr)/i;
const base = (s: string) => s.replace(/ \((new|deleted)\)$/, "").split(/[\\/]/).pop()!.toLowerCase();

/** Compares the agent's report with the real file changes. Returns mismatches (needs a look) and notes (FYI). */
export function compareReport(text: string, changed: string[], checks: CheckResult[]): { mismatches: string[]; notes: string[] } {
  const mismatches: string[] = [], notes: string[] = [];
  const t = String(text || "");
  const m = t.match(/\*\*What I did:?\*\*:?([\s\S]*?)(?=\n\s*\*\*[A-Z][^*\n]{0,30}\*\*|$)/i);
  const did = m ? m[1] : t;
  const editLines = did.split(/\r?\n/).filter(l => EDIT_RE.test(l) && !/\b(brain|project_(log|update|write)|decision_log|reminder_add|milestone_add)\b/i.test(l));
  const claimed = [...new Set(editLines.flatMap(l => l.match(FILE_RE) || []).map(base).filter(n => !BRAIN_FILES.test(n)))];
  const changedNames = new Set(changed.map(base));
  if (claimed.length && !changed.length) mismatches.push(`The report says it changed ${claimed.slice(0, 4).join(", ")}, but no file in the project folder changed.`);
  else for (const c of claimed) if (!changedNames.has(c)) mismatches.push(`The report says it changed ${c}, but that file did not change.`);
  const edits = editLines.join("\n");
  if (!claimed.length && !changed.length && /\b(fixed|implemented|added|built|wrote|created)\b/i.test(edits) && /\b(code|function|test|feature|bug|script|file)s?\b/i.test(edits))
    mismatches.push("The report describes code work, but no file in the project folder changed.");
  const mentioned = new Set((t.match(FILE_RE) || []).map(base));
  const quiet = changed.filter(c => !mentioned.has(base(c)));
  if (quiet.length) notes.push(`Also changed (not named in the report): ${quiet.slice(0, 6).join(", ")}${quiet.length > 6 ? ` and ${quiet.length - 6} more` : ""}.`);
  if (checks.some(c => !c.ok) && /\b(tests?|checks?) (all )?(pass|passed|passing|green)\b|\ball tests pass/i.test(t))
    mismatches.push("The report says the tests pass, but HQ's run of them failed.");
  return { mismatches, notes };
}

/** After a run: diff, project checks (only when something changed), report comparison. */
export async function after(before: Snapshot, dirs: string[], slug: string | null | undefined, report: string): Promise<Verify> {
  const changed = diff(before, snapshot(dirs), dirs);
  const checks: CheckResult[] = [], skipped: string[] = [];
  const cfg = loadConfig().verify || {};
  const timeoutMs = Math.max(1, Math.min(30, Number(cfg.timeoutMinutes) || 5)) * 60e3;
  if (changed.length) for (const d of dirs) {
    const f = findChecks(d, slug); skipped.push(...f.skipped);
    for (const cmd of f.cmds) checks.push(await runCheck(cmd, d, timeoutMs));
  }
  const { mismatches, notes } = compareReport(report, changed, checks);
  return { at: new Date().toISOString(), dirs, changed: changed.slice(0, 200), checks, skipped, mismatches, notes, ok: checks.every(c => c.ok) && !mismatches.length };
}

/** A short block appended to the run's report, so the owner sees what HQ checked. */
export function summary(v: Verify): string {
  const lines = [`**Checked by HQ:** ${v.ok ? "✓ matches the report" : "⚠ needs a look"} · ${v.changed.length ? `${v.changed.length} file${v.changed.length > 1 ? "s" : ""} changed` : "no project files changed"}`];
  if (v.changed.length) lines.push("- Changed: " + v.changed.slice(0, 8).join(", ") + (v.changed.length > 8 ? ` and ${v.changed.length - 8} more` : ""));
  for (const c of v.checks) lines.push(`- ${c.ok ? "✓" : "✗"} \`${c.cmd.replace(/"[^"]*[\\/](python(\.exe)?)"/i, "$1")}\` ${c.ok ? "passed" : c.timedOut ? "timed out" : `failed (exit ${c.code})`} in ${Math.round(c.ms / 100) / 10} s${c.ok ? "" : "\n```\n" + c.tail + "\n```"}`);
  if (v.changed.length && !v.checks.length) lines.push("- No project checks found to run" + (v.skipped.length ? ` (${v.skipped.join("; ")})` : "") + ".");
  for (const m of v.mismatches) lines.push("- ⚠ " + m);
  for (const n of v.notes) lines.push("- " + n);
  return lines.join("\n");
}
