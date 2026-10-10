// Code screen: signed-in Claude/Codex sessions within the project's permission ceiling.
// LUTHUR coordinates bounded workers using concise Markdown handoffs and fresh CLI context.
import { codeSettings, type CodeSettings } from './code-settings.ts';
import { resolveModel, validateChoice, type ModelChoice } from "./model-policy.ts";
import { runCodex } from "./codex.ts";
import {sessionContext} from './codex-usage.ts';
import {checkStopped} from './stop-control.ts';
import {manageCode,workroom,codeWork} from './code-manager.ts';
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { DATA, ROOT, readJson, uid, writeJson } from "./store.ts";
import { loadConfig, minLevel } from "./config.ts";
import { killTree, runClaude } from "./claude.ts";
import { opStart, opEnd, activity } from "./orchestrator.ts";
import type { Step } from "./narrate.ts";
import * as brain from "./brain.ts";
import type { Image } from "./uploads.ts";

type Agent = { role: string; engine: "claude" | "codex"; model: string; effort?: string; ok?: boolean };
type Msg = { role: "you" | "hq"; text: string; images?: string[]; agents?: Agent[]; at: string; error?: boolean; steps?: Step[]; added?: number; removed?: number; ms?: number; ctx?: number; win?: number | null; cost?: number | null; mode?: string };
type Session = { id: string; project: string; folder?: string; name?: string; sessionId: string | null; createdAt?: string; updatedAt?: string; importedFrom?: string; usage?: { cost: number; turns: number; ctx: number|null; win: number | null; rate: any; at: string }; messages: Msg[]; settings?: CodeSettings };

const DIR = path.join(DATA, "code");
const ID = /^[a-z0-9-]{1,60}$/;
// Live code that must never be edited from HQ (agent rules): sessions there are forced to read-only.
const PROTECTED = /LoanCentral-Test/i;
const busy = new Map<string, { pid?: number; cancelled?: boolean; opId: string; provider?: string }>();

// The file name is the session key (older files are named after the project slug).
const file = (key: string) => { if (!ID.test(key)) throw Object.assign(new Error("Bad session id"), { code: 404 }); return path.join(DIR, `${key}.json`); };
function load(key: string): Session {
  const s = readJson<Session | null>(file(key), null);
  if (!s) throw Object.assign(new Error("No such session"), { code: 404 });
  return s;
}
const save = (key: string, s: Session) => { s.updatedAt = new Date().toISOString(); writeJson(file(key), s); };
const maxParallel = () => Math.max(1, Math.min(2, Number(loadConfig().code?.maxParallel) || 1));

function access(slug: string, folder?: string) {
  const p = brain.getProject(slug);
  if (!p) throw Object.assign(new Error("Unknown project"), { code: 404 });
  if (folder && !(p.paths || []).some(d => path.resolve(d).toLowerCase() === path.resolve(folder).toLowerCase())) throw new Error("Choose a repository folder registered on this project.");
  const dirs = (p.paths || []).filter(d => !folder || path.resolve(d).toLowerCase() === path.resolve(folder).toLowerCase()).filter(d => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });
  const ceiling = loadConfig().autonomy?.maxLevel || "build";
  let level = minLevel("build", p.maxPermission, ceiling);
  if ((p.paths || []).some(d => PROTECTED.test(d))) level = "read";
  return { p, dirs, level };
}

function keys(): string[] {
  try { return fs.readdirSync(DIR).filter(f => f.endsWith(".json")).map(f => f.slice(0, -5)).filter(k => ID.test(k)); } catch { return []; }
}

/** Every open session, newest activity first, with a short preview for the grid. */
export function list() {
  const out = [];
  for (const k of keys()) {
    const s = readJson<Session | null>(path.join(DIR, `${k}.json`), null);
    if (!s?.project) continue;
    const p = brain.getProject(s.project);
    const last = s.messages.at(-1), lastHq = [...s.messages].reverse().find(m => m.role === "hq");
    const lastYou = [...s.messages].reverse().find(m => m.role === "you");
    out.push({
      id: k, project: s.project, folder:s.folder||null, manager:true, projectName: p?.name || s.project, name: s.name || p?.name || s.project,
      busy: busy.has(k), opId: busy.get(k)?.opId || null, messages: s.messages.length,
      task: lastYou?.text.slice(0, 140) || "", reply: (lastHq?.text || "").replace(/[#*_`>]/g, "").trim().slice(0, 220),
      error: !!lastHq?.error, added: lastHq?.added || 0, removed: lastHq?.removed || 0, ms: lastHq?.ms || 0,
      steps: (lastHq?.steps || []).slice(-6).map(x => ({ verb: x.verb, target: x.target, ok: x.ok, result: x.result })),
      updatedAt: s.updatedAt || last?.at || s.createdAt || "",
    });
  }
  return { max: maxParallel(), running: busy.size, sessions: out.sort((a, b) => Number(b.busy) - Number(a.busy) || b.updatedAt.localeCompare(a.updatedAt)) };
}

export function create(slug: string, name?: string, folder?: string) {
  const { p } = access(slug, folder);
  if (keys().length >= 40) throw new Error("Too many open sessions. Close a few first.");
  const n = keys().filter(k => readJson<Session | null>(path.join(DIR, `${k}.json`), null)?.project === slug).length;
  const id = uid("cs-").toLowerCase().replace(/[^a-z0-9-]/g, "");
  const s: Session = { id, project: slug, name: String(name || "").trim().slice(0, 40) || (n ? `${p.name} ${n + 1}` : p.name), sessionId: null, createdAt: new Date().toISOString(), messages: [] };
  s.folder = folder || undefined; save(id, s);
  return { id };
}

export function manager(slug:string,folder?:string){
  access(slug,folder);
  const normalized=(value:string|null|undefined)=>value?path.resolve(value).toLowerCase():null;
  const found=list().sessions.find(s=>s.project===slug&&normalized(s.folder)===normalized(folder));
  return found?{id:found.id}:create(slug,'LUTHUR · '+(brain.getProject(slug)?.name||slug),folder);
}

export function get(key: string) {
  const s = load(key);
  const { p, dirs, level } = access(s.project, s.folder);
  const settings = codeSettings(s.settings);
  const sameProject = [...busy.keys()].filter(k => k !== key && readJson<Session | null>(path.join(DIR, `${k}.json`), null)?.project === s.project).length;
  return { id: key, project: s.project, name: s.name || p.name, folders: p.paths || [], found: dirs, level, busy: busy.has(key), opId: busy.get(key)?.opId || null, sameProject, usage: s.usage || null, messages: s.messages.slice(-60),manager:true,settings,effectiveLevel:minLevel(["read","plan"].includes(settings.permission)?settings.permission:"build",level),effectiveMinutes:Math.min(settings.maxMinutes,loadConfig().code?.maxMinutes||120),workroom:workroom(key) };
}

export function configure(key: string, patch: Partial<CodeSettings>) {
  if (busy.has(key)) throw new Error('Stop the running request before changing its settings.');
  const s = load(key); s.settings = codeSettings({...s.settings, ...patch}); save(key, s); return s.settings;
}
export function editNote(key: string, kind: string, text: string) {
  load(key);
  if (busy.has(key)) throw new Error('Stop the running request before editing notes.');
  if (!['brief','status','plan','report','handoff'].includes(kind) || typeof text !== 'string' || text.length > 20000) throw new Error('Invalid note. Maximum 20,000 characters.');
  const target = path.join(DIR, 'workrooms', key); fs.mkdirSync(target, {recursive:true});
  fs.writeFileSync(path.join(target, kind.toUpperCase()+'.md'), text, 'utf8'); return {ok:true};
}
export function requestSettings(key: string) { return codeSettings(load(key).settings); }
export function rename(key: string, name: string) {
  const s = load(key); s.name = String(name || "").trim().slice(0, 40) || s.name; save(key, s); return { ok: true };
}

/** Closes a session: its history moves to the archive. */
export function close(key: string) {
  if (busy.has(key)) throw new Error("Stop the current task first.");
  const s = load(key);
  if (s.messages.length) writeJson(path.join(DIR, "archive", `${key}-${Date.now()}.json`), s);
  fs.rmSync(file(key), { force: true });
}

export function stop(key: string) { const b = busy.get(key); if (b) { b.cancelled = true; killTree(b.pid); } }
export function stopAll(){for(const key of busy.keys())stop(key);}
export function hasActiveWork(){return busy.size>0;}

/** Throws the reasons a message can't start, so the API can answer right away. */
export function check(key: string, text: string) {
  checkStopped();
  if (busy.has(key)) throw new Error("Still working on the last message.");
  if (!String(text || "").trim()) throw new Error("Type what you want done.");
  if (busy.size >= maxParallel()) throw new Error(`${busy.size} sessions are already running (limit ${maxParallel()}). Wait for one to finish.`);
  const { p, dirs } = access(load(key).project, load(key).folder);
  if (!dirs.length) throw new Error(`No folder found for ${p.name}. Add its folder under the project's Setup tab.`);
}

export async function send(key: string, text: string, tier = "balanced", effort: string | null = null, readOnly = false, mode: string | null = null, choice: ModelChoice = {}, images: Image[] = []): Promise<void> {
  const settings = requestSettings(key);
  choice={...settings, astraApproved:settings.model==='gpt-6-astra', opusApproved:settings.model==='opus'};
  mode=settings.permission;
  readOnly=readOnly || mode==='read';
  validateChoice(choice);
  check(key, text);
  text = String(text || "").trim().slice(0, 20000);
  const s = load(key);
  const { p, dirs, level: max } = access(s.project, s.folder);
  const level = minLevel(readOnly ? "read" : mode === "plan" ? "plan" : "build", max); // the lock in the chat box: look only, no edits
  s.messages.push({ role: "you", text, ...(images.length ? { images: images.map(i => i.id) } : {}), at: new Date().toISOString() });
  save(key, s);
  const cfg = loadConfig();
  const provider = choice.provider === "codex" ? "codex" : "claude";
  const selected = resolveModel(provider, '', choice, codeWork(text));
  const model = selected.model, fallback = undefined; effort = selected.effort;
  s.sessionId = null;
  const opId = `code-${key}-${s.messages.length}`;
  const steps: Step[] = [];
  const name = s.name || p.name;
  const onOp = opStart({ id: opId, kind: "code", title: `${name}: ${text.length > 60 ? text.slice(0, 59) + "…" : text}`, project: s.project, model, level, agent: 'LUTHUR' });
  let edited = false; // any file written this turn: LUTHUR's solo work then gets an independent review (code-manager.ts)
  const onStep = (st: Step) => { onOp(st); if (st.kind === "tool" && /write|edit/i.test(st.tool || "")) edited = true; const i = steps.findIndex(x => x.id === st.id); if (i >= 0) steps[i] = { ...st }; else steps.push({ ...st }); if (steps.length > 120) steps.shift(); };
  busy.set(key, { opId, provider });
  let ok = false;
  try {
    const base = {
      prompt: text, model, fallbackModel: fallback, effort, level, mode: level === "build" && (mode === "auto" || mode === "bypass") ? mode : "safe", resume:null, runId: `code-${key}`, addDirs: dirs, images,
      timeoutMs: Math.min(settings.maxMinutes, cfg.code?.maxMinutes || 120) * 60e3, onStep, onSpawn: pid => { const b = busy.get(key); if (b) {b.pid = pid;if(b.cancelled)killTree(pid);} },
      system: [
        settings.instructions,
        `You're LUTHUR, managing work with the owner live in HQ's Code screen on project "${p.name}" (workroom "${name}").`,
        `Project folders: ${dirs.join("; ")}. Work only there; for shell commands, cd into the folder first.`,
        "Other sessions may be editing the same folders at the same time: re-read a file right before you edit it.",
        level === "build" ? "You may edit files and run tests/builds. Never commit, push, deploy or touch live services (those are blocked)." : "This project is READ-ONLY here: explain and propose diffs, don't edit.",
        "Before each group of actions, say in one short line what you're about to do and why (the owner watches it live).",
        "Keep the final reply short: what you changed (files), how to try it, anything risky. Use code blocks for snippets.",
      ].join("\n"),
    };
    const agents: Agent[] = [];
    const res=await manageCode({settings,key,project:p.name,text,edited:settings.reviewSolo?()=>edited:undefined,history:s.messages.slice(-7,-1).map(m=>`${m.role}: ${m.text.slice(0,400)}`).join('\n'),provider,choice,system:base.system,timeoutMs:base.timeoutMs,cancelled:()=>!!busy.get(key)?.cancelled,run:async spec=>{
      const childId=`${opId}-worker-${spec.index}`;
      const child=spec.index>=1&&spec.role!=='LUTHUR · review'?opStart({id:childId,kind:'code',title:spec.role,project:s.project,model:spec.model,level,agent:spec.role,parent:opId}):null;
      let result;
      try{result=await (provider==='codex'?runCodex:runClaude)({...base,prompt:spec.prompt,system:spec.system,model:spec.model,effort:spec.effort,timeoutMs:spec.timeoutMs,resume:null,runId:`code-${key}-${spec.index}`,noAgents:true,onStep:st=>{onStep(st);child?.(st);}});return result;}
      finally{agents.push({role:spec.role,engine:provider,model:result?.stats?.model||spec.model,effort:spec.effort,ok:!!result?.ok});if(child)opEnd(childId,!!result?.ok,!!busy.get(key)?.cancelled);}
    }});
    const b = busy.get(key);
    ok = res.ok && !b?.cancelled;
    let latest: Session;
    try { latest = load(key); } catch { return; } // closed meanwhile
    if (latest.id !== s.id) return;
    latest.sessionId = null; // Markdown workroom is durable context; avoid growing CLI memory.
    let reply = res.text || "";
    if (b?.cancelled) reply = (reply ? reply + "\n\n" : "") + "_Stopped._";
    else if (res.kind === "auth" || res.kind === "missing") reply = `I can't reach ${provider === 'codex' ? 'Codex' : 'Claude'}. Check its CLI sign-in, then try again.`;
    else if (res.kind === "limit") reply = `${provider === 'codex' ? 'Codex' : 'Claude'}'s usage limit is reached${res.resetAt ? ` until about ${new Date(res.resetAt).toLocaleString()}` : ""}.`;
    else if (res.kind === "timeout") reply = (reply ? reply + "\n\n" : "") + "_Stopped at the time limit. Say “continue” to pick up where I left off._";
    const kept = steps.filter(x => x.kind === "tool" || x.kind === "text");
    const tools = steps.filter(x => x.kind === "tool");
    const st = res.stats;
    {const u=latest.usage||{cost:0,turns:0};const context=provider==='codex'?sessionContext(res.sessionId||undefined):st?.contextKnown?{context:st.context,window:st.window}:null;latest.usage={cost:u.cost+(st?.cost||0),turns:u.turns+1,ctx:context?.context??null,win:context?.window||null,rate:provider==='claude'?st?.rate||null:null,at:new Date().toISOString()};}
    latest.messages.push({ role: "hq", text: reply, at: new Date().toISOString(), error: !res.ok && !b?.cancelled, ms: res.durationMs, ctx: st?.context, win: st?.window, cost: st?.cost, mode: level === "build" ? (mode || "safe") : "read", agents,
      steps: kept.slice(-50).map(x => ({ ...x, diff: x.diff?.slice(0, 12) })), added: tools.reduce((a, x) => a + (x.added || 0), 0), removed: tools.reduce((a, x) => a + (x.removed || 0), 0) });
    if (latest.messages.length > 200) latest.messages.splice(0, latest.messages.length - 200);
    save(key, latest);
    activity("code", { session: key, project: s.project, ok: res.ok, kind: res.kind });
    if (res.ok && !b?.cancelled) {
      const files = [...new Set(tools.filter(x => /write|edit/i.test(x.tool)).map(x => x.target).filter(Boolean))];
      if(files.length)brain.addLog(s.project,`Code workroom ${name}: ${reply.replace(/\s+/g,' ').slice(0,500)} Files: ${files.slice(0,12).join(', ')}. See workroom REPORT.md for verification.`, 'LUTHUR');
    }
  } catch(error){
    const latest=load(key),cancelled=!!busy.get(key)?.cancelled;
    latest.messages.push({role:'hq',text:cancelled?'_Stopped._':`Workroom needs attention: ${(error as Error).message}`,at:new Date().toISOString(),error:!cancelled});
    save(key,latest);
  } finally { const cancelled=busy.get(key)?.cancelled;busy.delete(key); opEnd(opId, ok,!!cancelled); }
}

// ---------------- existing Claude Code sessions (from the terminal / VS Code) ----------------
// Claude Code keeps each conversation in ~/.claude/projects/<folder path with every non-letter/digit as "-">/<uuid>.jsonl.
// Importing copies that file next to HQ's own sessions and resumes the copy, so the original is never changed
// and runs keep HQ's cwd, permissions and settings (not the other folder's).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const claudeProjects = () => path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "projects");
const enc = (p: string) => path.resolve(p).replace(/[^a-zA-Z0-9]/g, "-");

function head(file: string, bytes: number, fromEnd = false): string {
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, "r");
    const size = fs.fstatSync(fd).size, n = Math.min(bytes, size), buf = Buffer.alloc(n);
    fs.readSync(fd, buf, 0, n, fromEnd ? size - n : 0);
    return buf.toString("utf8");
  } catch { return ""; } finally { if (fd !== null) try { fs.closeSync(fd); } catch {} }
}
function textOf(m: any): string {
  const c = m?.message?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.filter((x: any) => x?.type === "text").map((x: any) => x.text).join("\n");
  return "";
}
const human = (t: string) => !!t.trim() && !/^\s*<(command|local-command|system-reminder|user-prompt-submit-hook)/.test(t) && !/^Caveat:/.test(t);
function lines(raw: string): any[] { const out = []; for (const l of raw.split("\n")) { if (!l.trim()) continue; try { out.push(JSON.parse(l)); } catch {} } return out; }

function sessionFiles(slug: string): { id: string; file: string; mtime: number; size: number; folder: string }[] {
  const { p } = access(slug);
  const root = claudeProjects(), mine = enc(ROOT).toLowerCase();
  let dirs: string[] = [];
  try { dirs = fs.readdirSync(root); } catch { return []; }
  const wants = (p.paths || []).map(d => enc(d).toLowerCase());
  const out = [];
  for (const d of dirs) {
    const dl = d.toLowerCase();
    if (dl === mine || !wants.some(w => dl === w || dl.startsWith(w + "-"))) continue;
    let files: string[] = [];
    try { files = fs.readdirSync(path.join(root, d)).filter(f => f.endsWith(".jsonl") && UUID.test(f.slice(0, -6))); } catch { continue; }
    for (const f of files) { try { const st = fs.statSync(path.join(root, d, f)); out.push({ id: f.slice(0, -6), file: path.join(root, d, f), mtime: st.mtimeMs, size: st.size, folder: d }); } catch {} }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

/** Claude Code sessions found for this project's folders, newest first (titles + first ask, never whole transcripts). */
export function external(slug: string) {
  const taken = new Set(keys().map(k => readJson<Session | null>(path.join(DIR, `${k}.json`), null)?.importedFrom).filter(Boolean));
  return sessionFiles(slug).slice(0, 25).map(s => {
    const first = lines(head(s.file, 256e3));
    const title = first.find(x => x.type === "summary" && x.summary)?.summary || "";
    const ask = first.filter(x => x.type === "user").map(textOf).find(human) || "";
    const cwd = first.find(x => typeof x.cwd === "string")?.cwd || "";
    return { id: s.id, title: String(title).slice(0, 90), ask: ask.replace(/\s+/g, " ").slice(0, 160), folder: cwd ? path.basename(cwd) : "", updatedAt: new Date(s.mtime).toISOString(), sizeKb: Math.round(s.size / 1024), imported: taken.has(s.id) };
  }).filter(s => s.ask || s.title);
}

export function importSession(slug: string, sid: string, name?: string) {
  if (!UUID.test(sid)) throw Object.assign(new Error("Bad session id"), { code: 404 });
  const src = sessionFiles(slug).find(s => s.id === sid);
  if (!src) throw Object.assign(new Error("That session wasn't found in this project's folders."), { code: 404 });
  if (src.size > 200e6) throw new Error("That session is too big to bring in.");
  const destDir = path.join(claudeProjects(), enc(ROOT));
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, `${sid}.jsonl`);
  if (!fs.existsSync(dest)) fs.copyFileSync(src.file, dest);
  // show the last few exchanges so the owner sees where it left off
  const tail = lines(head(src.file, 1e6, true)).filter(x => x.type === "user" || x.type === "assistant");
  const hist: Msg[] = [];
  for (const x of tail) {
    const t = textOf(x); if (!t.trim() || (x.type === "user" && !human(t))) continue;
    hist.push({ role: x.type === "user" ? "you" : "hq", text: t.slice(0, 4000), at: x.timestamp || new Date(src.mtime).toISOString() });
  }
  const meta = external(slug).find(e => e.id === sid);
  const { id } = create(slug, name || meta?.title || meta?.ask.slice(0, 40));
  const s = load(id);
  s.sessionId = sid; s.importedFrom = sid;
  s.messages = [...hist.slice(-8), { role: "hq", text: "_Brought in recent Claude Code conversation. LUTHUR will continue using compact Markdown workroom notes. Your original session is untouched._", at: new Date().toISOString() }];
  save(id, s);
  return { id };
}

// ---------------- Claude Code sessions run outside HQ ----------------
// The owner also works in Claude Code directly (terminal, desktop app) inside a project's folders. Those transcripts are
// read here once a minute; each finished turn goes to brain-sync, so LUTHUR records what was done, moves the next step on
// and ticks Today's goals. Only text, edited file names and line counts are passed on (as data). History isn't replayed:
// the first scan only notes where each file ends.
const WATCH = path.join(DATA, "session-watch.json");
let watchT: ReturnType<typeof setInterval> | null = null;
export function watchStart() {
  if (watchT || process.env.HQ_NO_WATCH) return;
  const tick = () => { try { watchScan(); } catch {} };
  watchT = setInterval(tick, 60e3); watchT.unref?.(); setTimeout(tick, 15e3).unref?.();
}
function readFrom(file: string, from: number, max: number): Buffer {
  let fd: number | null = null;
  try { fd = fs.openSync(file, "r"); const buf = Buffer.alloc(max); const n = fs.readSync(fd, buf, 0, max, from); return buf.subarray(0, n); }
  catch { return Buffer.alloc(0); } finally { if (fd !== null) try { fs.closeSync(fd); } catch {} }
}
type WTurn = { ask: string; reply: string; files: string[]; added: number; removed: number; at: string };
function turnsOf(rows: any[]): WTurn[] {
  const out: WTurn[] = []; let t: WTurn | null = null;
  const nl = (s: unknown) => typeof s === "string" && s ? s.split("\n").length : 0;
  for (const r of rows) {
    if (r?.isSidechain) continue;
    const c = r?.message?.content;
    if (r.type === "user") {
      const isResult = Array.isArray(c) && c.some((x: any) => x?.type === "tool_result");
      const txt = textOf(r);
      if (!isResult && human(txt)) { t = { ask: txt.slice(0, 2000), reply: "", files: [], added: 0, removed: 0, at: String(r.timestamp || new Date().toISOString()) }; out.push(t); }
      continue;
    }
    if (r.type !== "assistant" || !Array.isArray(c)) continue;
    if (!t) { t = { ask: "", reply: "", files: [], added: 0, removed: 0, at: String(r.timestamp || new Date().toISOString()) }; out.push(t); }
    for (const b of c) {
      if (b?.type === "text" && b.text) t.reply = (t.reply + "\n" + b.text).slice(-4000);
      if (b?.type === "tool_use" && /^(Edit|MultiEdit|Write|NotebookEdit)$/.test(b.name)) {
        const i = b.input || {}, f = String(i.file_path || i.notebook_path || "");
        if (f && !t.files.includes(f) && t.files.length < 30) t.files.push(path.basename(f));
        if (b.name === "Write") t.added += nl(i.content);
        else for (const e of b.name === "MultiEdit" ? (i.edits || []) : [i]) { t.added += nl(e?.new_string); t.removed += nl(e?.old_string); }
      }
    }
  }
  return out.filter(x => x.reply || x.files.length);
}
function watchScan() {
  const st = readJson<{ off: Record<string, number>; init?: boolean }>(WATCH, { off: {} });
  const first = !st.init, now = Date.now();
  const mine = new Set(keys().map(k => readJson<Session | null>(path.join(DIR, `${k}.json`), null)?.sessionId).filter(Boolean)); // HQ's own Code sessions sync themselves
  for (const p of brain.listProjects()) {
    if (!p.paths?.length || p.stage === "done") continue;
    let files: ReturnType<typeof sessionFiles> = []; try { files = sessionFiles(p.slug); } catch { continue; }
    for (const f of files.slice(0, 20)) {
      const was = st.off[f.id];
      if (first || (was === undefined && now - f.mtime > 6 * 3600e3) || mine.has(f.id)) { st.off[f.id] = f.size; continue; }
      const from = was ?? 0;
      if (f.size <= from || now - f.mtime < 45e3) continue; // nothing new, or Claude is still mid-turn
      const buf = readFrom(f.file, from, Math.min(f.size - from, 4e6)), cut = buf.lastIndexOf(10);
      if (cut < 0) continue;
      st.off[f.id] = from + cut + 1;
      for (const t of turnsOf(lines(buf.subarray(0, cut + 1).toString("utf8")))) brainSync.afterTurn("ext-" + f.id, p.slug, t);
    }
  }
  st.init = true;
  const ids = Object.keys(st.off); if (ids.length > 500) for (const k of ids.slice(0, ids.length - 500)) delete st.off[k];
  writeJson(WATCH, st);
}

