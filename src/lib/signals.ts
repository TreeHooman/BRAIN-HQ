// Incoming mail/calendar signals linked to projects. Code only. Every signal is journaled once (dedupe by key) with
// the project it matched, how sure, and why, so the owner can audit it (data/signals.jsonl). Lessons from Alfred:
// a signal filed under the WRONG project quietly pollutes it, so an ambiguous match stays unlinked rather than guessed;
// and nothing is acted on directly: at most a "prepare for this" task goes through the normal approval gate.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA, appendLine } from "./store.ts";
import * as brain from "./brain.ts";
import * as watch from "./watch.ts";

export type Signal = { at: string; key: string; source: "mail" | "calendar"; kind: string; title: string; when?: string; project: string | null; confidence: number; why: string; action: string };
const FILE = path.join(DATA, "signals.jsonl");
const STOP = new Set(["the", "and", "for", "with", "project", "app", "bot", "hq", "new", "dev", "test", "main", "work", "team", "plan", "my"]);

export function journal(limit = 300): Signal[] {
  try { return fs.readFileSync(FILE, "utf8").trim().split("\n").slice(-limit).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).reverse(); } catch { return []; }
}
let seen: Set<string> | null = null;
function seenKeys(): Set<string> { if (!seen) seen = new Set(journal(5000).map(s => s.key)); return seen; }

/** Words that identify a project: its name, slug parts, tags, repo names, link labels. */
function terms(p: brain.Project): string[] {
  const words = [p.name, p.slug.replace(/-/g, " "), ...(p.tags || []), ...(p.repos || []).map(r => r.split("/").pop() || ""), ...(p.links || []).map(l => l.label)]
    .join(" ").toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !STOP.has(w));
  const phrases = [p.name.toLowerCase(), p.slug.replace(/-/g, " ")].filter(x => x.length >= 4);
  return [...new Set([...phrases, ...words])];
}
/** Best project for a text, or null when nothing (or more than one project equally) fits. */
export function match(text: string, projects = brain.listProjects()): { project: string | null; confidence: number; why: string } {
  const t = ` ${String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  const scored = projects.filter(p => p.stage !== "done").map(p => {
    const hits = terms(p).filter(w => t.includes(` ${w} `));
    const score = hits.reduce((n, w) => n + (w.includes(" ") ? 3 : w === p.name.toLowerCase() ? 3 : 1), 0);
    return { p, hits, score };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
  if (!scored.length) return { project: null, confidence: 0, why: "no project words" };
  if (scored[1] && scored[1].score === scored[0].score) return { project: null, confidence: 0.3, why: `ambiguous: ${scored[0].p.slug} vs ${scored[1].p.slug}` };
  const conf = Math.min(1, scored[0].score / 3);
  return conf >= 0.66 ? { project: scored[0].p.slug, confidence: conf, why: `mentions ${scored[0].hits.slice(0, 3).join(", ")}` } : { project: null, confidence: conf, why: `weak: ${scored[0].hits.join(", ")}` };
}

export type ScanHost = { propose(sig: Signal): string };
/** New watch cards become journaled signals. Matched upcoming events may get a prep task (through the normal gate). */
export function scan(host: ScanHost): Signal[] {
  const out: Signal[] = [], known = seenKeys();
  for (const c of watch.cards()) {
    const key = crypto.createHash("sha1").update(`${c.kind}|${c.key || c.id}|${c.title}`).digest("hex").slice(0, 16);
    if (known.has(key)) continue;
    const source = c.kind === "mail" ? "mail" as const : "calendar" as const;
    const m = match(`${c.title} ${c.sub}`);
    const sig: Signal = { at: new Date().toISOString(), key, source, kind: c.kind, title: c.title.slice(0, 140), when: c.until || c.at, project: m.project, confidence: Math.round(m.confidence * 100) / 100, why: m.why, action: "linked" };
    if (!m.project) sig.action = "unlinked";
    else if (source === "calendar" && c.kind !== "cal-cancelled") {
      const when = Date.parse(c.until || c.at);
      if (Number.isFinite(when) && when - Date.now() < 48 * 36e5 && when > Date.now()) sig.action = host.propose(sig);
    }
    known.add(key); appendLine(FILE, JSON.stringify(sig)); out.push(sig);
  }
  try { const lines = fs.readFileSync(FILE, "utf8").trim().split("\n"); if (lines.length > 6000) fs.writeFileSync(FILE, lines.slice(-4000).join("\n") + "\n"); } catch {}
  return out;
}
