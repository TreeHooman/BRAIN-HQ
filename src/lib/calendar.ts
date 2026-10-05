// Read-only calendar feeds (iCal/.ics): Google "secret address", Outlook, iCloud, any https ICS.
// Feed URLs are secrets: they live only in config/hq.local.json and never leave this module
// (the dashboard gets id/name/host/status, never the URL; errors never include it).
import crypto from "node:crypto";
import { loadConfig, saveLocal } from "./config.ts";
import * as google from "./google.ts";

export type Feed = { id: string; name: string; url: string; color?: string };
export type CalEvent = { id: string; feed: string; title: string; start: string; end: string; allDay: boolean; location?: string };
type Stamp = { y: number; m: number; d: number; h: number; mi: number; s: number; date: boolean; tz: string | null; utc: boolean };
type VEvent = { uid: string; title: string; location?: string; start: Stamp; durMs: number; rrule?: Record<string, string>; exdates: Set<number>; recurId?: number; cancelled: boolean };
type Cache = { at: number; events: VEvent[]; ok: boolean; error?: string; inflight?: Promise<void> };

const TTL = 10 * 60e3, TIMEOUT = 15e3, MAX_BYTES = 8e6, MAX_INSTANCES = 3000;
const COLORS = ["teal", "green", "amber", "violet", "blue"];
const cache = new Map<string, Cache>();

// ---------------- feed config ----------------
export function feeds(): Feed[] {
  const f = loadConfig().calendar?.feeds;
  return Array.isArray(f) ? f.filter((x: any) => x && x.id && x.url) : [];
}
function hostOf(url: string): string { try { return new URL(url).hostname; } catch { return "?"; } }

/** Safe view for the dashboard: never includes the URL. */
export function feedStatus() {
  return [...google.calFeeds(), ...icsStatus()];
}
function icsStatus() {
  return feeds().map(f => {
    const c = cache.get(f.id);
    return { id: f.id, name: f.name, color: f.color || "teal", host: hostOf(f.url), ok: c ? c.ok : null, error: c?.error || null, lastSync: c?.at ? new Date(c.at).toISOString() : null, count: c?.events.length || 0 };
  });
}

export function normalizeUrl(raw: string): string {
  let s = String(raw || "").trim();
  if (/^webcals?:\/\//i.test(s)) s = "https://" + s.replace(/^webcals?:\/\//i, "");
  let u: URL;
  try { u = new URL(s); } catch { throw new Error("That doesn't look like a calendar address."); }
  if (u.protocol !== "https:") throw new Error("Only https calendar addresses are allowed.");
  if (u.username || u.password) throw new Error("Addresses with a username/password aren't supported.");
  const h = u.hostname.toLowerCase();
  // Block local/private targets: the server must not be used to probe the home network.
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h.startsWith("[") || /^\d+$/.test(h)
    || /^(0|10|127)\./.test(h) || /^169\.254\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h))
    throw new Error("Local or private network addresses aren't allowed.");
  return u.toString();
}

export async function addFeed(name: string, rawUrl: string): Promise<{ id: string; count: number }> {
  const url = normalizeUrl(rawUrl);
  const list = feeds();
  if (list.length >= 10) throw new Error("Up to 10 calendars.");
  if (list.some(f => f.url === url)) throw new Error("That calendar is already added.");
  const events = await fetchFeed(url); // validate before saving
  const id = "cal-" + crypto.randomBytes(5).toString("hex");
  const color = COLORS[list.length % COLORS.length];
  saveLocal({ calendar: { feeds: [...list, { id, name: String(name || "").trim().slice(0, 40) || "Calendar", url, color }] } });
  cache.set(id, { at: Date.now(), events, ok: true });
  return { id, count: events.length };
}

export function removeFeed(id: string): void {
  saveLocal({ calendar: { feeds: feeds().filter(f => f.id !== id) } });
  cache.delete(id);
}

// ---------------- fetching ----------------
async function fetchFeed(url: string): Promise<VEvent[]> {
  let res: Response | null = null;
  // Follow redirects by hand so every hop passes the same https/no-private-network check.
  for (let hop = 0; hop < 5; hop++) {
    try {
      res = await fetch(url, { headers: { Accept: "text/calendar, */*;q=0.5", "User-Agent": "HQ-Calendar/1.0" }, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT) });
    } catch (e: any) {
      throw new Error(e?.name === "TimeoutError" ? "Calendar didn't answer in time." : "Couldn't reach the calendar (check the address and your connection).");
    }
    if (res.status < 300 || res.status >= 400) break;
    const loc = res.headers.get("location");
    if (!loc) throw new Error("Calendar redirected without an address.");
    try { url = normalizeUrl(new URL(loc, url).toString()); } catch { throw new Error("Calendar redirected to an address that isn't allowed."); }
    res = null;
  }
  if (!res) throw new Error("Calendar redirected too many times.");
  if (res.status === 401 || res.status === 403 || res.status === 404) throw new Error(`Calendar refused the address (${res.status}). It may have been reset: copy the secret address again.`);
  if (!res.ok) throw new Error(`Calendar server error (${res.status}).`);
  const reader = res.body?.getReader();
  if (!reader) throw new Error("Empty calendar response.");
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BYTES) { await reader.cancel(); throw new Error("Calendar file is too large."); }
    chunks.push(value);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error("That address didn't return a calendar (.ics). Use the \"Secret address in iCal format\".");
  return parseIcs(text);
}

function refreshFeed(f: Feed, force = false): Promise<void> {
  const c = cache.get(f.id) || { at: 0, events: [], ok: false };
  if (c.inflight) return c.inflight;
  if (!force && c.at && Date.now() - c.at < (c.ok ? TTL : 2 * 60e3)) return Promise.resolve();
  c.inflight = fetchFeed(f.url)
    .then(ev => { c.events = ev; c.ok = true; c.error = undefined; })
    .catch((e: any) => { c.ok = false; c.error = String(e?.message || "Sync failed").slice(0, 200); }) // keep the last good events
    .finally(() => { c.at = Date.now(); c.inflight = undefined; });
  cache.set(f.id, c);
  return c.inflight;
}

/** Non-blocking: refresh stale feeds in the background. */
export function kick(from?: Date, to?: Date): void {
  for (const f of feeds()) void refreshFeed(f);
  const now = new Date(); google.calKick(from || new Date(now.getTime() - 7 * 864e5), to || new Date(now.getTime() + 60 * 864e5));
}
/** Blocking refresh (Sync now, MCP tool). */
export async function syncAll(force = true): Promise<void> {
  const now = new Date();
  await Promise.all([...feeds().map(f => refreshFeed(f, force)), google.calSync(new Date(now.getTime() - 7 * 864e5), new Date(now.getTime() + 60 * 864e5)).catch(() => {})]);
}

/** Expanded events overlapping [from, to), from cache. */
export function events(from: Date, to: Date): CalEvent[] {
  const out: CalEvent[] = [];
  for (const f of feeds()) {
    const c = cache.get(f.id);
    if (c) out.push(...expandAll(c.events, f.id, from.getTime(), to.getTime()));
  }
  out.push(...google.calEvents(from, to));
  return out.sort((a, b) => a.start.localeCompare(b.start)).slice(0, 2000);
}

// ---------------- ICS parsing ----------------
function unescapeText(s: string): string { return s.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim(); }

function parseStamp(params: Record<string, string>, value: string): Stamp | null {
  const m = value.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const date = !m[4] || params.VALUE === "DATE";
  return { y: +m[1], m: +m[2], d: +m[3], h: date ? 0 : +m[4], mi: date ? 0 : +m[5], s: date ? 0 : +(m[6] || 0), date, utc: !!m[7], tz: m[7] ? null : params.TZID?.replace(/^"|"$/g, "") || null };
}

function parseDuration(v: string): number {
  const m = v.match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return 0;
  const ms = ((+(m[2] || 0) * 7 + +(m[3] || 0)) * 86400 + +(m[4] || 0) * 3600 + +(m[5] || 0) * 60 + +(m[6] || 0)) * 1000;
  return m[1] === "-" ? -ms : ms;
}

export function parseIcs(text: string): VEvent[] {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const out: VEvent[] = [];
  let cur: Record<string, { p: Record<string, string>; v: string }[]> | null = null, depth = 0;
  for (const line of lines) {
    if (/^BEGIN:VEVENT$/i.test(line)) { cur = {}; depth = 0; continue; }
    if (!cur) continue;
    if (/^BEGIN:/i.test(line)) { depth++; continue; } // VALARM etc.
    if (/^END:VEVENT$/i.test(line)) { const e = toEvent(cur); if (e) out.push(e); cur = null; continue; }
    if (/^END:/i.test(line)) { depth--; continue; }
    if (depth > 0) continue;
    const i = line.search(/:(?=(?:[^"]*"[^"]*")*[^"]*$)/);
    if (i < 0) continue;
    const [name, ...ps] = line.slice(0, i).split(";");
    const p: Record<string, string> = {};
    for (const x of ps) { const j = x.indexOf("="); if (j > 0) p[x.slice(0, j).toUpperCase()] = x.slice(j + 1); }
    (cur[name.toUpperCase()] ||= []).push({ p, v: line.slice(i + 1) });
  }
  return out;
}

function toEvent(r: Record<string, { p: Record<string, string>; v: string }[]>): VEvent | null {
  const ds = r.DTSTART?.[0]; if (!ds) return null;
  const start = parseStamp(ds.p, ds.v); if (!start) return null;
  let durMs = start.date ? 864e5 : 0;
  const de = r.DTEND?.[0], du = r.DURATION?.[0];
  if (de) { const end = parseStamp(de.p, de.v); if (end) durMs = Math.max(0, toUtc(end) - toUtc(start)); }
  else if (du) durMs = Math.max(0, parseDuration(du.v.trim()));
  let rrule: Record<string, string> | undefined;
  if (r.RRULE?.[0]) { rrule = {}; for (const kv of r.RRULE[0].v.split(";")) { const [k, v] = kv.split("="); if (k && v) rrule[k.toUpperCase()] = v.toUpperCase(); } }
  const exdates = new Set<number>();
  for (const ex of r.EXDATE || []) for (const v of ex.v.split(",")) { const s = parseStamp(ex.p, v); if (s) exdates.add(toUtc(s)); }
  const rid = r["RECURRENCE-ID"]?.[0];
  const recurStamp = rid ? parseStamp(rid.p, rid.v) : null;
  return {
    uid: r.UID?.[0]?.v.trim() || crypto.randomUUID(), title: unescapeText(r.SUMMARY?.[0]?.v || "(busy)").slice(0, 200),
    location: r.LOCATION?.[0] ? unescapeText(r.LOCATION[0].v).slice(0, 200) || undefined : undefined,
    start, durMs, rrule, exdates, recurId: recurStamp ? toUtc(recurStamp) : undefined,
    cancelled: /CANCELLED/i.test(r.STATUS?.[0]?.v || ""),
  };
}

// ---------------- time zones (no deps: Intl) ----------------
const dtf = new Map<string, Intl.DateTimeFormat | null>();
function fmtFor(tz: string): Intl.DateTimeFormat | null {
  if (!dtf.has(tz)) {
    try { dtf.set(tz, new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })); }
    catch { dtf.set(tz, null); } // unknown zone name (e.g. Windows names) → treat as local time
  }
  return dtf.get(tz)!;
}
function offsetAt(utcMs: number, f: Intl.DateTimeFormat): number {
  const p: Record<string, number> = {};
  for (const x of f.formatToParts(new Date(utcMs))) if (x.type !== "literal") p[x.type] = +x.value;
  return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - Math.floor(utcMs / 1000) * 1000;
}
/** Wall-clock components → epoch ms. All-day dates are local midnight. */
function toUtc(s: Stamp): number {
  if (s.utc) return Date.UTC(s.y, s.m - 1, s.d, s.h, s.mi, s.s);
  const f = s.tz && !s.date ? fmtFor(s.tz) : null;
  if (!f) return new Date(s.y, s.m - 1, s.d, s.h, s.mi, s.s).getTime();
  const naive = Date.UTC(s.y, s.m - 1, s.d, s.h, s.mi, s.s);
  let t = naive - offsetAt(naive, f);
  t = naive - offsetAt(t, f); // second pass settles DST edges
  return t;
}

// ---------------- recurrence ----------------
const WD = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const dim = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-based
const dow = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();
const addDays = (s: Stamp, n: number): Stamp => { const t = new Date(Date.UTC(s.y, s.m - 1, s.d + n)); return { ...s, y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }; };

function monthDays(y: number, m: number, rule: Record<string, string>, dflt: number): number[] {
  const n = dim(y, m);
  if (rule.BYDAY) {
    const out: number[] = [];
    for (const tok of rule.BYDAY.split(",")) {
      const mm = tok.match(/^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/); if (!mm) continue;
      const wd = WD.indexOf(mm[2]);
      const all: number[] = [];
      for (let d = 1; d <= n; d++) if (dow(y, m, d) === wd) all.push(d);
      if (!mm[1]) out.push(...all);
      else { const k = +mm[1]; const v = k > 0 ? all[k - 1] : all[all.length + k]; if (v) out.push(v); }
    }
    let days = [...new Set(out)].sort((a, b) => a - b);
    if (rule.BYMONTHDAY) { const md = new Set(rule.BYMONTHDAY.split(",").map(x => { const v = +x; return v < 0 ? n + v + 1 : v; })); days = days.filter(d => md.has(d)); }
    if (rule.BYSETPOS) { const pos = rule.BYSETPOS.split(",").map(Number); days = pos.map(p => p > 0 ? days[p - 1] : days[days.length + p]).filter(Boolean).sort((a, b) => a - b); }
    return days;
  }
  if (rule.BYMONTHDAY) return rule.BYMONTHDAY.split(",").map(x => { const v = +x; return v < 0 ? n + v + 1 : v; }).filter(d => d >= 1 && d <= n).sort((a, b) => a - b);
  return dflt <= n ? [dflt] : [];
}

/** Yields instance starts (wall-clock stamps) in order, starting with DTSTART. */
function* occurrences(e: VEvent, toMs: number): Generator<Stamp> {
  const r = e.rrule!, s0 = e.start, iv = Math.max(1, +(r.INTERVAL || 1));
  const count = r.COUNT ? +r.COUNT : Infinity;
  let until = Infinity;
  if (r.UNTIL) { const u = parseStamp({}, r.UNTIL); if (u) until = u.utc ? toUtc(u) : toUtc({ ...u, tz: s0.tz, date: s0.date }) + (u.date && !s0.date ? 864e5 - 1 : 0); }
  const startMs = toUtc(s0);
  let n = 0, guard = 0;
  const emit = function* (st: Stamp) { const t = toUtc(st); if (t < startMs) return; if (t > until || t > toMs || n >= count) { n = Infinity; return; } n++; yield st; };
  const wanted = (st: Stamp) => !r.BYMONTH || r.BYMONTH.split(",").map(Number).includes(st.m);
  if (r.FREQ === "DAILY") {
    for (let st = s0; n < count && guard++ < 20000; st = addDays(st, iv)) {
      if (r.BYDAY && !r.BYDAY.split(",").includes(WD[dow(st.y, st.m, st.d)])) continue;
      if (wanted(st)) yield* emit(st); if (n === Infinity) return;
    }
  } else if (r.FREQ === "WEEKLY") {
    const days = (r.BYDAY ? r.BYDAY.split(",").map(x => WD.indexOf(x.replace(/^[+-]?\d+/, ""))).filter(x => x >= 0) : [dow(s0.y, s0.m, s0.d)]);
    const wkst = WD.indexOf(r.WKST || "MO");
    const order = days.map(d => (d - wkst + 7) % 7).sort((a, b) => a - b);
    let weekStart = addDays(s0, -((dow(s0.y, s0.m, s0.d) - wkst + 7) % 7));
    while (n < count && guard++ < 5000) {
      for (const off of order) { yield* emit(addDays(weekStart, off)); if (n === Infinity) return; }
      weekStart = addDays(weekStart, 7 * iv);
    }
  } else if (r.FREQ === "MONTHLY" || r.FREQ === "YEARLY") {
    let y = s0.y, m = s0.m;
    while (n < count && guard++ < 3000) {
      const months = r.FREQ === "YEARLY" ? (r.BYMONTH ? r.BYMONTH.split(",").map(Number).sort((a, b) => a - b) : [s0.m]) : [m];
      for (const mo of months) {
        for (const d of monthDays(y, mo, r, s0.d)) { yield* emit({ ...s0, y, m: mo, d }); if (n === Infinity) return; }
      }
      if (r.FREQ === "YEARLY") y += iv; else { m += iv; while (m > 12) { m -= 12; y++; } }
    }
  } else yield s0; // unsupported FREQ (HOURLY etc.): show the first one only
}

export function expandAll(list: VEvent[], feed: string, fromMs: number, toMs: number): CalEvent[] {
  const overrides = new Map<string, VEvent>();
  for (const e of list) if (e.recurId !== undefined) overrides.set(`${e.uid}|${e.recurId}`, e);
  const out: CalEvent[] = [];
  const push = (e: VEvent, st: Stamp) => {
    const t = toUtc(st), end = t + e.durMs;
    if (e.cancelled || t >= toMs || Math.max(end, t + 1) <= fromMs) return;
    const pad2 = (x: number) => String(x).padStart(2, "0");
    out.push({
      id: crypto.createHash("sha1").update(`${feed}|${e.uid}|${t}`).digest("hex").slice(0, 16), feed, title: e.title, location: e.location, allDay: st.date,
      start: st.date ? `${st.y}-${pad2(st.m)}-${pad2(st.d)}` : new Date(t).toISOString(),
      end: st.date ? (() => { const x = addDays(st, Math.max(1, Math.round(e.durMs / 864e5))); return `${x.y}-${pad2(x.m)}-${pad2(x.d)}`; })() : new Date(end).toISOString(),
    });
  };
  for (const e of list) {
    if (e.recurId !== undefined) { push(e, e.start); continue; }
    if (!e.rrule) { push(e, e.start); continue; }
    let k = 0;
    for (const st of occurrences(e, toMs)) {
      const t = toUtc(st);
      if (t + Math.max(e.durMs, 1) <= fromMs || e.exdates.has(t) || overrides.has(`${e.uid}|${t}`)) continue;
      if (++k > MAX_INSTANCES) break;
      push(e, st);
    }
  }
  return out;
}
