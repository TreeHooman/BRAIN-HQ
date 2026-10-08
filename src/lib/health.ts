// Unattended health (docs/AWAY-MODE.md): every few minutes HQ checks what would leave it useless while the owner is
// away (signed-out engines, a full disk, phone access off, work stuck, the weekly reserve reached) and alerts the phone
// once per problem (again after 12 hours if it is still there). Optional dead-man ping: config health.pingUrl (put it in
// config/hq.local.json), e.g. a healthchecks.io check that emails/texts the owner when the pings stop, which is the
// only way to hear about a PC that is off or has no internet. Code only, no model calls.
import fs from "node:fs";
import path from "node:path";
import { DATA, ROOT, readJson, writeJson } from "./store.ts";
import { loadConfig } from "./config.ts";
import { notify } from "./notify.ts";

const FILE = path.join(DATA, "health.json"), WATCHDOG_LOG = path.join(DATA, "watchdog.log");
const EVERY = 5 * 60e3, REALERT = 12 * 3600e3;

export type Level = "ok" | "warn" | "bad";
export type Check = { id: string; level: Level; text: string; fix?: string };
export type Inputs = {
  claudeAuth: string; codex: string; remoteUrl: string | null; tailscaleInstalled: boolean;
  queued: number; running: number; lastOkRunAt: number | null; pacing: { mode: string; reason: string };
};
type Store = { at: string | null; startedAt: string; checks: Check[]; alerted: Record<string, string>; ping: { at: string | null; ok: boolean | null; error?: string } };

const started = new Date().toISOString();
function load(): Store { const s = readJson<Partial<Store>>(FILE, {}); return { at: s.at || null, startedAt: started, checks: s.checks || [], alerted: s.alerted || {}, ping: s.ping || { at: null, ok: null } }; }

function freeGb(dir: string): number | null {
  try { const s = fs.statfsSync(dir); return (Number(s.bavail) * Number(s.bsize)) / 1e9; } catch { return null; }
}
/** Restarts the watchdog made recently (it writes one line per restart). */
export function watchdogRestarts(days = 7): string[] {
  try { return fs.readFileSync(WATCHDOG_LOG, "utf8").trim().split(/\r?\n/).filter(l => { const t = Date.parse(l.slice(0, 19)); return Number.isFinite(t) && Date.now() - t < days * 864e5 && /restart/i.test(l); }); } catch { return []; }
}

export function evaluate(x: Inputs, now = Date.now(), disk = freeGb(ROOT)): Check[] {
  const out: Check[] = [];
  out.push(x.claudeAuth === "needs-login"
    ? { id: "claude-auth", level: "bad", text: "Claude is signed out: background work and chat run on Codex only (or stop).", fix: "On the PC run scripts\\SIGN-IN-CLAUDE.cmd (from away: remote desktop into the PC)." }
    : { id: "claude-auth", level: "ok", text: x.claudeAuth === "ok" ? "Claude signed in" : "Claude sign-in not checked yet" });
  out.push(x.codex === "needs-login"
    ? { id: "codex-auth", level: "warn", text: "Codex is signed out, so there is no backup when Claude hits its limit.", fix: "On the PC run: codex login" }
    : { id: "codex-auth", level: "ok", text: x.codex === "online" ? "Codex signed in (backup ready)" : x.codex === "unavailable" ? "Codex not installed" : "Codex status unknown" });
  if (disk != null) out.push(disk < 2 ? { id: "disk", level: "bad", text: `Only ${disk.toFixed(1)} GB free on the HQ drive.`, fix: "Free up space; HQ stops saving when the disk is full." }
    : disk < 8 ? { id: "disk", level: "warn", text: `${disk.toFixed(1)} GB free on the HQ drive.`, fix: "Free up some space before you leave." }
    : { id: "disk", level: "ok", text: `${Math.round(disk)} GB free` });
  out.push(x.remoteUrl ? { id: "remote", level: "ok", text: "Phone access on (Tailscale)" }
    : { id: "remote", level: "warn", text: x.tailscaleInstalled ? "Phone access is off: Tailscale is not serving LUTHUR." : "Phone access is off: Tailscale is not installed.", fix: "Settings → Away mode → Turn on phone access." });
  // Work waiting but nothing has finished for a day: something is stuck (limits, sign-in, a crash loop). Work that
  // pacing is holding back on purpose is reported by the pacing check instead.
  const stuck = x.pacing.mode === "normal" && x.queued > 0 && x.running === 0 && (!x.lastOkRunAt || now - x.lastOkRunAt > 24 * 3600e3);
  out.push(stuck ? { id: "stuck", level: "bad", text: `${x.queued} job${x.queued > 1 ? "s" : ""} waiting and nothing has finished for over a day.`, fix: "Open Missions & approvals; check sign-ins and the usage limit." }
    : { id: "stuck", level: "ok", text: x.queued ? `${x.queued} queued, ${x.running} running` : "Queue clear" });
  out.push(x.pacing.mode === "reserve" ? { id: "pacing", level: "warn", text: `Background work is waiting: ${x.pacing.reason}.` }
    : { id: "pacing", level: "ok", text: x.pacing.mode === "save" ? `Saving usage: ${x.pacing.reason}` : "Usage on pace" });
  const restarts = watchdogRestarts(1).length;
  out.push(restarts >= 3 ? { id: "crashes", level: "bad", text: `LUTHUR crashed and was restarted ${restarts} times in the last day.`, fix: "Check data\\server.log." }
    : { id: "crashes", level: "ok", text: restarts ? `${restarts} automatic restart${restarts > 1 ? "s" : ""} today` : "No crashes today" });
  return out;
}

async function ping(url: string): Promise<{ ok: boolean; error?: string }> {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(10e3) }); return { ok: r.ok, error: r.ok ? undefined : `HTTP ${r.status}` }; }
  catch (e: any) { return { ok: false, error: String(e?.message || e).slice(0, 120) }; }
}

let last = 0, busy = false;
/** Called from the orchestrator tick; runs every 5 minutes. Alerts the phone once per new problem. */
export async function tick(inputs: () => Promise<Inputs>, force = false): Promise<Store | null> {
  if (busy || (!force && Date.now() - last < EVERY)) return null;
  busy = true; last = Date.now();
  try {
    const s = load(), now = Date.now();
    s.checks = evaluate(await inputs(), now);
    s.at = new Date(now).toISOString();
    const url = String(loadConfig().health?.pingUrl || "");
    if (/^https:\/\/[^\s]+$/i.test(url)) { const p = await ping(url); s.ping = { at: s.at, ...p }; }
    for (const c of s.checks) {
      if (c.level === "ok") { delete s.alerted[c.id]; continue; }
      const prev = s.alerted[c.id];
      if (prev && now - Date.parse(prev) < REALERT) continue;
      s.alerted[c.id] = s.at;
      notify({ title: `${c.level === "bad" ? "🔴" : "🟠"} LUTHUR health: ${c.text}`.slice(0, 120), body: c.fix || c.text, priority: c.level === "bad" ? 4 : 3, tags: "warning" });
    }
    writeJson(FILE, s);
    return s;
  } finally { busy = false; }
}
export function view() {
  const s = load();
  return { at: s.at, startedAt: s.startedAt, checks: s.checks, ping: s.ping, pingConfigured: !!loadConfig().health?.pingUrl, restarts: watchdogRestarts(7) };
}

/** Owner pastes the dead-man ping URL (healthchecks.io or similar) on the Away card. Stored in config/hq.local.json,
 *  never sent to the page. Empty clears it. Only plain https URLs. */
export function setPingUrl(url: unknown, save: (patch: any) => void): { pingConfigured: boolean } {
  const u = String(url ?? "").trim();
  if (u && !/^https:\/\/[^\s"'<>]{4,300}$/i.test(u)) throw Object.assign(new Error("Paste the https:// ping URL from healthchecks.io (or leave it empty to remove it)."), { code: 400 });
  save({ health: { pingUrl: u } });
  last = 0; // ping on the next tick
  return { pingConfigured: !!u };
}
