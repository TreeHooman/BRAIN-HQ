// Email + calendar watcher: turns changes into "Needs you" cards. Code only, zero model tokens: it reads the inbox
// glance cache (mail.ts, already refreshed by its own small run) and the calendar caches (calendar.ts / google.ts).
// Cards: important or action-looking unread emails, new / moved / cancelled events in the next 7 days, and clashes
// (two timed events overlapping today or tomorrow). Email text is untrusted data: shown escaped, never acted on.
import path from "node:path";
import crypto from "node:crypto";
import { DATA, readJson, writeJson } from "./store.ts";
import { loadConfig } from "./config.ts";
import { notify } from "./notify.ts";
import * as mail from "./mail.ts";
import * as cal from "./calendar.ts";

export type Card = { id: string; kind: "mail" | "cal-new" | "cal-moved" | "cal-cancelled" | "cal-clash"; sev: "red" | "amber" | ""; title: string; sub: string; href: string; at: string; until?: string; key?: string };
type Snap = Record<string, { t: string; s: string; f: string }>;
type State = { cards: Card[]; dismissed: string[]; seenMail: string[]; snap: Snap | null; snapAt: string | null };

const FILE = path.join(DATA, "watch.json");
const WEEK = 7 * 864e5;
// Words that usually mean an email wants something from the owner. Data only: nothing here is ever acted on.
const ACTION = /\b(urgent|asap|action required|action needed|please (reply|respond|confirm|review|sign)|reply needed|respond by|deadline|due (today|tomorrow|by)|overdue|invoice|payment|past due|final notice|interview|offer|contract|sign(ature)? required|verify|expir(es|ing)|reminder:|rsvp|can you|could you|are you (free|available))\b/i;
const NOISE = /\b(no-?reply|noreply|newsletter|notifications?@|digest|unsubscribe|marketing|promo)\b/i;

const load = (): State => ({ cards: [], dismissed: [], seenMail: [], snap: null, snapAt: null, ...readJson<Partial<State>>(FILE, {}) });
const save = (s: State) => writeJson(FILE, { ...s, dismissed: s.dismissed.slice(-300), seenMail: s.seenMail.slice(-300), cards: s.cards.slice(0, 40) });
const hash = (s: string) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 12);
const cfg = () => ({ enabled: true, phoneMail: true, clashes: true, ...(loadConfig().watch || {}) });
const fromName = (f: string) => f.replace(/<[^>]*>/g, "").replace(/"/g, "").trim() || f.replace(/[<>]/g, "");
const when = (iso: string, allDay: boolean) => {
  const d = allDay ? new Date(iso.slice(0, 10) + "T00:00") : new Date(iso);
  const day = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  return allDay ? day : `${day} ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
};

/** Cards for the dashboard (dismissed and expired ones removed). */
export function cards(): Card[] {
  const s = load(), now = Date.now();
  return s.cards.filter(c => !s.dismissed.includes(c.id) && (!c.until || Date.parse(c.until) > now));
}
export function dismiss(id: string) { const s = load(); if (!s.dismissed.includes(id)) s.dismissed.push(id); s.cards = s.cards.filter(c => c.id !== id); save(s); return cards(); }
export function clear() { const s = load(); s.dismissed.push(...s.cards.map(c => c.id)); s.cards = []; save(s); return cards(); }

function mailCards(s: State, out: Card[], fresh: Card[]) {
  const m = mail.status();
  if (!m.enabled || !m.at) { out.push(...s.cards.filter(c => c.kind === "mail")); return; }
  for (const x of m.items) {
    if (!x.unread) continue;
    const text = `${x.subject} ${x.snippet}`, action = ACTION.test(text);
    if (!x.important && !action) continue;
    if (NOISE.test(x.from) && !x.important) continue;
    const key = hash(`${x.from}|${x.subject}|${x.date}`), id = "w-m-" + key;
    const old = s.cards.find(c => c.id === id);
    const card: Card = old || { id, kind: "mail", sev: action && /\b(urgent|asap|overdue|past due|final notice|deadline)\b/i.test(text) ? "red" : "amber",
      title: `Email: ${x.subject}`.slice(0, 160), sub: `FROM ${fromName(x.from).slice(0, 40).toUpperCase()}${action ? " · MAY NEED A REPLY" : " · IMPORTANT"}`,
      href: `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(x.subject.slice(0, 80))}`, at: new Date().toISOString(), until: new Date(Date.now() + 3 * 864e5).toISOString(), key };
    out.push(card);
    if (!s.seenMail.includes(key)) { s.seenMail.push(key); if (!old) fresh.push(card); }
  }
  // An email that is read now (or dropped out of the glance) stops needing the owner.
}

function calCards(s: State, out: Card[], fresh: Card[]) {
  const now = Date.now(), from = new Date(now), to = new Date(now + WEEK);
  const ok = new Set(cal.feedStatus().filter((f: any) => f.ok === true && f.lastSync).map((f: any) => f.id));
  const evs = cal.events(from, to);
  const snap: Snap = {};
  for (const e of evs) if (ok.has(e.feed)) snap[e.id] = { t: e.title, s: e.start, f: e.feed };
  // Feeds that haven't synced since the restart keep their old entries, so nothing looks cancelled or new.
  for (const [id, v] of Object.entries(s.snap || {})) if (!ok.has(v.f) && Date.parse(v.s) > now) snap[id] = v;
  const keep = s.cards.filter(c => c.kind !== "mail" && c.kind !== "cal-clash");
  if (s.snap && s.snapAt) {
    const prevEnd = Date.parse(s.snapAt) + WEEK; // events that only slid into the 7-day window aren't "new"
    const gone = Object.entries(s.snap).filter(([id, v]) => !snap[id] && ok.has(v.f) && Date.parse(v.s) > now + 5 * 60e3);
    const added = evs.filter(e => ok.has(e.feed) && !s.snap![e.id] && Date.parse(e.start) < prevEnd);
    for (const e of added) {
      const was = gone.findIndex(([, v]) => v.f === e.feed && v.t === e.title);
      const allDay = e.allDay;
      if (was >= 0) {
        const [, v] = gone.splice(was, 1)[0];
        keep.push({ id: "w-cm-" + hash(e.id + v.s), kind: "cal-moved", sev: "amber", title: `Moved: ${e.title}`.slice(0, 160), sub: `NOW ${when(e.start, allDay).toUpperCase()} · WAS ${when(v.s, v.s.length <= 10).toUpperCase()}`, href: "#calendar", at: new Date().toISOString(), until: e.start });
      } else {
        keep.push({ id: "w-cn-" + hash(e.id), kind: "cal-new", sev: "", title: `New event: ${e.title}`.slice(0, 160), sub: `${when(e.start, allDay).toUpperCase()}${e.location ? " · " + e.location.slice(0, 40).toUpperCase() : ""}`, href: "#calendar", at: new Date().toISOString(), until: e.start });
      }
      fresh.push(keep[keep.length - 1]);
    }
    for (const [id, v] of gone) {
      keep.push({ id: "w-cc-" + hash(id), kind: "cal-cancelled", sev: "amber", title: `Cancelled: ${v.t}`.slice(0, 160), sub: `WAS ${when(v.s, v.s.length <= 10).toUpperCase()}`, href: "#calendar", at: new Date().toISOString(), until: v.s });
      fresh.push(keep[keep.length - 1]);
    }
  }
  out.push(...keep);
  s.snap = snap; s.snapAt = new Date(now).toISOString();
  // Clashes: timed events overlapping each other, today and tomorrow. Recomputed each check (not stored as news).
  if (cfg().clashes) {
    const end = new Date(); end.setHours(0, 0, 0, 0); end.setDate(end.getDate() + 2);
    const timed = cal.events(from, end).filter(e => !e.allDay && Date.parse(e.end) > now).sort((a, b) => a.start.localeCompare(b.start));
    for (let i = 0; i < timed.length; i++) for (let j = i + 1; j < timed.length; j++) {
      const a = timed[i], b = timed[j];
      if (Date.parse(b.start) >= Date.parse(a.end)) break;
      if (a.title === b.title && a.start === b.start) continue; // same event on two calendars
      out.push({ id: "w-cx-" + hash(a.id + b.id), kind: "cal-clash", sev: "red", title: `Clash: ${a.title} / ${b.title}`.slice(0, 160), sub: `OVERLAP AT ${when(b.start, false).toUpperCase()}`, href: "#calendar", at: new Date().toISOString(), until: a.end });
    }
  }
}

/** One pass: rebuild cards from the caches and alert on what's new. */
export function check(): Card[] {
  if (!cfg().enabled) return [];
  const s = load(), out: Card[] = [], fresh: Card[] = [];
  try { mailCards(s, out, fresh); } catch (e) { console.warn("watch mail:", e); out.push(...s.cards.filter(c => c.kind === "mail")); }
  try { calCards(s, out, fresh); } catch (e) { console.warn("watch calendar:", e); out.push(...s.cards.filter(c => c.kind !== "mail")); }
  const now = Date.now(), seen = new Set<string>();
  s.cards = out.filter(c => !seen.has(c.id) && seen.add(c.id) && (!c.until || Date.parse(c.until) > now));
  save(s);
  const send = fresh.filter(c => !s.dismissed.includes(c.id) && (c.kind !== "mail" || cfg().phoneMail));
  if (send.length === 1) notify({ title: send[0].title, body: send[0].sub.toLowerCase(), priority: send[0].sev === "red" ? 4 : 3, tags: send[0].kind === "mail" ? "email" : "calendar" });
  else if (send.length > 1) notify({ title: `${send.length} email/calendar updates`, body: send.slice(0, 4).map(c => c.title).join("\n"), priority: send.some(c => c.sev === "red") ? 4 : 3, tags: "bell" });
  return cards();
}

/** Every minute. Calendar caches refresh themselves (kick); mail on its own 30-min timer. */
export function start() {
  const tick = () => { try { if (cfg().enabled) { cal.kick(); check(); } } catch (e) { console.warn("watch:", e); } setTimeout(tick, 60e3).unref?.(); };
  setTimeout(tick, 45e3).unref?.();
}
