// Auto handoff: keeps the "Current state" block of HANDOFF.md in sync with the luthur brain project, so a new session
// reads one short, current page instead of a growing pile of hand-written handoff notes. No model call: it is built
// from files. Entries roll off as new work is logged (they stay in brain/projects/luthur/log.md and its archive), and
// owner checks disappear once they are removed from the "## Owner checks" list in plan.md.
import fs from "node:fs";
import path from "node:path";
import { ROOT, readJson, readText, writeText } from "./store.ts";

const FILE = path.join(ROOT, "HANDOFF.md");
const PROJ = path.join(ROOT, "brain", "projects", "luthur");
const START = "<!-- AUTO:START (generated from brain/projects/luthur; edit those files, not this block) -->";
const END = "<!-- AUTO:END -->";
const SOURCES = ["log.md", "plan.md", "project.json"].map(f => path.join(PROJ, f));
const KEEP = 8;

const clip = (s: string, n: number) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };

/** The newest log entries: "## 2026-10-07 02:05 · claude" headers followed by text. */
function recentLog(): string[] {
  const parts = readText(path.join(PROJ, "log.md"), "").split(/\n(?=## \d{4}-\d{2}-\d{2})/).slice(1, KEEP + 1);
  return parts.map(p => { const [head, ...rest] = p.split("\n"); return `- **${head.replace(/^## /, "").trim()}**: ${clip(rest.join(" "), 320)}`; });
}

/** Bullets under "## Owner checks" in plan.md: things only the owner can verify (mic, devices, real accounts). */
function ownerChecks(): string[] {
  const plan = readText(path.join(PROJ, "plan.md"), "");
  const m = plan.match(/## Owner checks\s*\n([\s\S]*?)(?=\n## |$)/);
  return m ? m[1].split("\n").filter(l => /^\s*[-*] \S/.test(l)).map(l => "- " + clip(l.replace(/^\s*[-*] /, ""), 200)) : [];
}

export function buildBlock(): string {
  const p = readJson<any>(path.join(PROJ, "project.json"), {});
  const checks = ownerChecks();
  return [
    START,
    `## Current state (auto, ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC)`,
    `- Stage: ${p.stage || "?"} · health: ${p.health || "?"}`,
    `- Next step: ${clip(p.nextStep || "none recorded", 300)}`,
    "",
    "### Waiting on the owner",
    ...(checks.length ? checks : ["- nothing listed"]),
    "",
    `### Latest work (newest first, last ${KEEP}; full log: brain/projects/luthur/log.md)`,
    ...(recentLog().length ? recentLog() : ["- no entries yet"]),
    END,
  ].join("\n");
}

/** Rewrites only the auto block; the hand-written part of HANDOFF.md is left alone. */
export function writeHandoff(): void {
  const cur = readText(FILE, "# HQ handoff\n");
  const block = buildBlock();
  const a = cur.indexOf(START), b = cur.indexOf(END);
  const next = a >= 0 && b > a ? cur.slice(0, a) + block + cur.slice(b + END.length) : cur.trimEnd() + "\n\n" + block + "\n";
  if (next.replace(/\(auto, [^)]*\)/, "") !== cur.replace(/\(auto, [^)]*\)/, "")) writeText(FILE, next);
}

let seen = "";
/** Cheap check for the orchestrator tick: rebuild only when a source file changed (covers edits made outside HQ). */
export function refreshIfChanged(): void {
  const sig = SOURCES.map(f => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } }).join(",");
  if (sig === seen) return;
  seen = sig;
  try { writeHandoff(); } catch {}
}
