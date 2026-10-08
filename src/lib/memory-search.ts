// Memory search: one ranked, code-only search over everything LUTHUR remembers (no model calls).
// Sources: project SUMMARY/plan/log, decisions, preferences, goals, milestones, reminders, inbox, briefs,
// distilled chat memories (brain/chat-memory) and saved answers (data/history.jsonl).
// The index is rebuilt only when a source file's size or mtime changes.
import fs from "node:fs";
import path from "node:path";
import { BRAIN, PROJECTS, DATA, readJson } from "./store.ts";

export type MemoryHit = { source: string; ref: string; title: string; at: string; project: string; snippet: string; score: number };
type Doc = { source: string; ref: string; title: string; at: string; project: string; text: string; terms: Map<string, number>; len: number };

const STOP = new Set("a an and are as at be but by do for from has have i if in is it its me my of on or our so that the this to was we what when where which who why will with you your about did does how".split(" "));
// Light stemming so "decided"/"decision"/"decisions" and "loans"/"loan" meet.
const stem = (w: string) => w.length > 4 ? w.replace(/(ations?|ions?|ings?|edly|ed|es|s)$/, "") : w;
const tokens = (s: string) => (s.toLowerCase().match(/[a-z0-9][a-z0-9_-]*/g) || []).filter(w => !STOP.has(w)).map(stem);

let cache: { key: string; docs: Doc[]; df: Map<string, number>; avg: number } | null = null;

function files(): string[] {
  const out: string[] = [];
  const add = (f: string) => { if (fs.existsSync(f)) out.push(f); };
  for (const f of ["decisions.md", "preferences.md", "goals.json", "milestones.json", "reminders.json", "inbox.json"]) add(path.join(BRAIN, f));
  for (const slug of fs.existsSync(PROJECTS) ? fs.readdirSync(PROJECTS) : []) for (const f of ["project.json", "SUMMARY.md", "plan.md", "log.md"]) add(path.join(PROJECTS, slug, f));
  for (const dir of ["briefs", "chat-memory"]) { const d = path.join(BRAIN, dir); if (fs.existsSync(d)) for (const f of fs.readdirSync(d).filter(f => f.endsWith(".md")).sort().slice(-60)) out.push(path.join(d, f)); }
  add(path.join(DATA, "history.jsonl"));
  return out;
}

// Split a Markdown file into sections at "## " headings (logs: one dated entry each) or "- " bullets (decisions, preferences).
function sections(text: string, bullets: boolean): { title: string; body: string }[] {
  if (bullets) return text.split(/\r?\n/).filter(l => /^\s*- /.test(l)).map(l => ({ title: "", body: l.replace(/^\s*- /, "") }));
  const out: { title: string; body: string }[] = []; let cur = { title: "", body: "" };
  for (const line of text.split(/\r?\n/)) {
    if (/^#{1,3} /.test(line)) { if (cur.body.trim() || cur.title) out.push(cur); cur = { title: line.replace(/^#+ /, ""), body: "" }; }
    else cur.body += line + "\n";
  }
  if (cur.body.trim() || cur.title) out.push(cur);
  return out.filter(s => (s.title + s.body).trim());
}

const dateIn = (s: string) => (s.match(/\b20\d\d-\d\d-\d\d(?:[ T]\d\d:\d\d)?/) || [""])[0].replace(" ", "T");

function build(): Doc[] {
  const docs: Omit<Doc, "terms" | "len">[] = [];
  const push = (d: Omit<Doc, "terms" | "len">) => { if (d.text.trim()) docs.push({ ...d, text: d.text.slice(0, 6000) }); };
  const rel = (f: string) => path.relative(path.dirname(BRAIN), f).replace(/\\/g, "/");
  for (const f of files()) {
    const r = rel(f), name = path.basename(f);
    const proj = f.startsWith(PROJECTS) ? path.basename(path.dirname(f)) : "";
    try {
      if (name === "history.jsonl") {
        for (const l of fs.readFileSync(f, "utf8").split("\n")) { let e: any; try { e = JSON.parse(l); } catch { continue; }
          push({ source: "answer", ref: `history:${e.id || ""}`, title: `${e.kind || "Answer"}: ${e.title || ""}`, at: e.at || "", project: e.project || "", text: `${e.title || ""}\n${e.ask || ""}\n${e.answer || ""}` }); }
      } else if (name === "goals.json") {
        for (const g of readJson<any[]>(f, [])) push({ source: "goal", ref: `goal:${g.id}`, title: g.title, at: g.createdAt || "", project: g.project || "", text: `${g.title}\n${g.why || ""}\nDue ${g.due || "-"}\n${(g.steps || []).map((s: any) => `- [${s.done ? "x" : " "}] ${s.title} ${s.notes || ""}`).join("\n")}` });
      } else if (name === "milestones.json" || name === "reminders.json" || name === "inbox.json") {
        const kind = name === "milestones.json" ? "date" : name === "reminders.json" ? "reminder" : "inbox";
        for (const m of readJson<any[]>(f, [])) push({ source: kind, ref: `${kind}:${m.id || ""}`, title: m.title || m.text || "", at: m.date || m.due || m.createdAt || m.at || "", project: m.project || "", text: `${m.title || m.text || ""} ${m.date || m.due || ""}${m.done ? " (done)" : ""} ${m.kind || ""} ${m.notes || ""}` });
      } else if (name === "project.json") {
        const p = readJson<any>(f, {}); push({ source: "project", ref: r, title: p.name || proj, at: p.updated || "", project: proj, text: `${p.name || proj} ${p.kind || ""} ${p.stage || ""} ${p.health || ""}\n${p.summary || ""}\nNext: ${p.nextStep || ""}\n${(p.tags || []).join(" ")}` });
      } else {
        const text = fs.readFileSync(f, "utf8");
        const source = proj ? name.replace(/\.md$/, "").toLowerCase() : f.includes(`${path.sep}briefs${path.sep}`) ? "brief" : f.includes(`${path.sep}chat-memory${path.sep}`) ? "chat memory" : name.replace(/\.md$/, "");
        const whole = source === "brief" || source === "chat memory" || source === "summary";
        if (whole) { push({ source, ref: r, title: proj ? `${proj} summary` : name.replace(/\.md$/, ""), at: dateIn(name) || dateIn(text), project: proj, text }); continue; }
        for (const s of sections(text, name === "decisions.md" || name === "preferences.md")) {
          const proj2 = proj || (s.body.match(/^\*\*[\d-]+\*\* \[([\w-]+)\]/) || [])[1] || "";
          push({ source, ref: r, title: s.title || s.body.slice(0, 80), at: dateIn(s.title) || dateIn(s.body.slice(0, 40)), project: proj2, text: `${s.title}\n${s.body}` });
        }
      }
    } catch { /* one unreadable file never breaks search */ }
  }
  return docs.map(d => { const t = tokens(`${d.title} ${d.title} ${d.text}`), terms = new Map<string, number>(); for (const w of t) terms.set(w, (terms.get(w) || 0) + 1); return { ...d, terms, len: t.length || 1 }; });
}

function index() {
  const key = files().map(f => { try { const s = fs.statSync(f); return `${f}:${s.size}:${s.mtimeMs}`; } catch { return f; } }).join("|");
  if (cache?.key === key) return cache;
  const docs = build(), df = new Map<string, number>();
  for (const d of docs) for (const w of d.terms.keys()) df.set(w, (df.get(w) || 0) + 1);
  cache = { key, docs, df, avg: docs.reduce((n, d) => n + d.len, 0) / (docs.length || 1) };
  return cache;
}

function snippet(text: string, words: string[], max = 360): string {
  const flat = text.replace(/\s+/g, " ").trim(), low = flat.toLowerCase();
  let at = -1; for (const w of words) { const i = low.indexOf(w); if (i >= 0 && (at < 0 || i < at)) at = i; }
  const start = Math.max(0, at - 100);
  return (start ? "…" : "") + flat.slice(start, start + max) + (start + max < flat.length ? "…" : "");
}

/** BM25 ranking, any word may match; more matched words, an exact phrase and recent dates rank higher. */
export function searchMemory(query: string, o: { project?: string; source?: string; limit?: number } = {}): MemoryHit[] {
  const q = tokens(query); if (!q.length) return [];
  const { docs, df, avg } = index(), N = docs.length, phrase = query.trim().toLowerCase();
  const raw = query.toLowerCase().match(/[a-z0-9][a-z0-9_-]*/g) || [];
  const hits: MemoryHit[] = [];
  for (const d of docs) {
    if (o.project && d.project !== o.project) continue;
    if (o.source && d.source !== o.source) continue;
    let score = 0, matched = 0;
    for (const w of new Set(q)) {
      const tf = d.terms.get(w); if (!tf) continue; matched++;
      const idf = Math.log(1 + (N - (df.get(w) || 0) + .5) / ((df.get(w) || 0) + .5));
      score += idf * (tf * 2.2) / (tf + 1.2 * (.25 + .75 * d.len / avg));
    }
    if (!matched) continue;
    score *= matched / new Set(q).size;
    if (phrase.length > 3 && phrase.includes(" ") && d.text.toLowerCase().includes(phrase)) score *= 1.6;
    const age = d.at ? (Date.now() - Date.parse(d.at)) / 864e5 : NaN;
    if (age >= 0) score *= 1 + .3 / (1 + age / 30);
    hits.push({ source: d.source, ref: d.ref, title: d.title.replace(/\s+/g, " ").slice(0, 140), at: d.at.slice(0, 16), project: d.project, snippet: snippet(d.text, raw), score: Math.round(score * 100) / 100 });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, Math.min(30, Math.max(1, o.limit || 8)));
}

/** Compact text for agents: a few lines per hit, capped so a search stays cheap. */
export function memorySearchText(query: string, o: { project?: string; source?: string; limit?: number } = {}): string {
  const hits = searchMemory(query, o);
  if (!hits.length) return "Nothing in memory matches. Try fewer or different words.";
  return hits.map(h => `- [${h.source}${h.project ? " · " + h.project : ""}${h.at ? " · " + h.at.replace("T", " ") : ""}] ${h.title}\n  ${h.snippet}\n  (${h.ref})`).join("\n").slice(0, 9000);
}
