// History: every answer LUTHUR gets from Claude (chat, Code, explain, briefings, missions, writing) is kept so the owner
// can find it again. Two copies, both local only:
//   data/history.jsonl          → the dashboard's History page and the hq-brain `history_search` tool
//   brain/history/YYYY-MM.md    → plain Markdown, so any Claude session in the HQ folder can read or grep it
// Runs opt in by passing `history` to runClaude (system checks, mail triage and brain-sync stay out).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA, BRAIN } from "./store.ts";
import { onRunResult, type RunOptions, type RunResult } from "./claude.ts";
import * as brain from "./brain.ts";

const FILE = path.join(DATA, "history.jsonl"), MD_DIR = path.join(BRAIN, "history");
export type Entry = { id: string; at: string; kind: string; title: string; ask: string; answer: string; project: string | null; model: string; ok: boolean; session: string | null; ref: string; provider?: "claude" | "codex" };
const clip = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
const fam = (m = "") => /opus/i.test(m) ? "Opus" : /sonnet/i.test(m) ? "Sonnet" : /haiku/i.test(m) ? "Haiku" : m || "";

export function recordHistory(r: RunResult, o: Pick<RunOptions, "history" | "model" | "runId">, provider: "claude" | "codex" = "claude") {
  if (!o.history || r.kind === "missing") return;
  if (!r.ok && !r.text) return;
  const h = o.history, at = new Date();
  const e: Entry = {
    id: crypto.randomBytes(6).toString("hex"), at: at.toISOString(), kind: clip(h.kind, 20) || "Chat", title: clip(h.title, 160).replace(/\s+/g, " ") || "(untitled)",
    ask: clip(h.ask, 4000), answer: clip(r.ok ? (() => { try { return h.format ? h.format(r.text) : r.text; } catch { return r.text; } })() : `(failed: ${r.kind}) ${r.text}`, 20_000), project: h.project && /^[a-z0-9-]{1,60}$/.test(h.project) ? h.project : null,
    model: provider === "codex" ? `Codex ${o.model || ""}`.trim() : fam(o.model), ok: r.ok, session: r.sessionId || null, ref: clip(o.runId, 80), provider,
  };
  try {
    fs.mkdirSync(DATA, { recursive: true });
    fs.appendFileSync(FILE, JSON.stringify(e) + "\n");
    if (fs.statSync(FILE).size > 25e6) { const lines = fs.readFileSync(FILE, "utf8").trim().split("\n"); fs.writeFileSync(FILE, lines.slice(-6000).join("\n") + "\n"); }
    fs.mkdirSync(MD_DIR, { recursive: true });
    const mf = path.join(MD_DIR, `${e.at.slice(0, 7)}.md`);
    if (!fs.existsSync(mf)) fs.writeFileSync(mf, `# LUTHUR history, ${e.at.slice(0, 7)}\n\nLUTHUR answers this month, oldest first. Search with Ctrl+F or grep.\n`);
    const pname = e.project ? brain.getProject(e.project)?.name || e.project : "";
    const local = new Date(at.getTime() - at.getTimezoneOffset() * 60e3).toISOString().slice(0, 16).replace("T", " ");
    fs.appendFileSync(mf, `\n## ${local} · ${e.kind} · ${provider}${pname ? " · " + pname : ""} · ${e.title.replace(/\n/g, " ")}\n\n${e.ask && e.ask !== e.title ? `**Asked:** ${e.ask.slice(0, 1500).replace(/\n/g, "\n> ")}\n\n` : ""}${e.answer}\n`);
  } catch {}
}
onRunResult((r, o) => recordHistory(r, o));

function all(): Entry[] {
  try { return fs.readFileSync(FILE, "utf8").trim().split("\n").map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; }
}
/** Newest first. q matches every word (any order) in title, question or answer. */
export function list(o: { q?: string; kind?: string; project?: string; before?: string; limit?: number } = {}) {
  const words = clip(o.q, 200).toLowerCase().split(/\s+/).filter(Boolean), kind = clip(o.kind, 20), proj = clip(o.project, 60), lim = Math.min(200, Math.max(1, Number(o.limit) || 50));
  const rows = all().reverse(), out: Entry[] = []; const kinds: Record<string, number> = {};
  for (const e of rows) {
    if (proj && e.project !== proj) continue;
    if (words.length) { const hay = `${e.title}\n${e.ask}\n${e.answer}`.toLowerCase(); if (!words.every(w => hay.includes(w))) continue; }
    kinds[e.kind] = (kinds[e.kind] || 0) + 1;
    if (kind && e.kind !== kind) continue;
    if (o.before && e.at >= o.before) continue;
    if (out.length < lim) out.push(e);
  }
  return { items: out, kinds, total: rows.length };
}
