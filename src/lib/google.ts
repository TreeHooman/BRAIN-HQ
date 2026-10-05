// Google Workspace: several Google accounts (one per company) for Mail + Drive (Sheets, Docs, Forms, Slides).
// OAuth "installed app" flow with PKCE and a loopback redirect. By default an account is read-only (gmail.readonly,
// drive.readonly). "Allow writing" (per account, opt-in) adds gmail.send + documents + spreadsheets: sending only ever
// happens from the Outbox after the owner presses Send, and Doc/Sheet edits only from the owner's own clicks. Nothing
// here can delete mail or files. Refresh tokens + the client secret live only in
// config/hq.local.json; access tokens only in memory; neither is ever sent to the dashboard or put in errors.
// Email and file content is untrusted data: returned as plain text for the dashboard to escape, never passed to agents.
import crypto from "node:crypto";
import path from "node:path";
import { loadConfig, saveLocal } from "./config.ts";
import { DATA, appendLine } from "./store.ts";

const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const DRIVE = "https://www.googleapis.com/drive/v3";
const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
const WRITE_SCOPES = ["https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/documents", "https://www.googleapis.com/auth/spreadsheets"];
const DOCS = "https://docs.googleapis.com/v1/documents";
const CAL_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const SCOPES = ["openid", "email", "profile", "https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/drive.readonly", CAL_SCOPE];
const CAL = "https://www.googleapis.com/calendar/v3";
const TIMEOUT = 15e3, MAX_ACCOUNTS = 12;
const COLORS = ["#38bdf8", "#a78bfa", "#f59e0b", "#f472b6", "#34d399", "#fb7185", "#60a5fa", "#facc15", "#2dd4bf", "#c084fc", "#fb923c", "#4ade80"];

type Account = { id: string; email: string; name: string; label: string; color: string; refresh: string | null; addedAt: string; scopes?: string };
type Pending = { verifier: string; at: number; redirect: string; write: boolean };
const hasCal = (a: Account) => String(a.scopes || "").includes(CAL_SCOPE);
const canWrite = (a: Account) => WRITE_SCOPES.every(x => String(a.scopes || "").includes(x));
const pending = new Map<string, Pending>();
const access = new Map<string, { token: string; exp: number }>();
const refreshing = new Map<string, Promise<string>>();
const mailCache = new Map<string, { at: number; items: any[] }>();

const conf = () => loadConfig().google || {};
const accounts = (): Account[] => (Array.isArray(conf().accounts) ? conf().accounts : []).filter((a: any) => a && /^g-[a-f0-9]{10}$/.test(a.id));
const saveAccounts = (list: Account[]) => saveLocal({ google: { accounts: list } });
const err = (msg: string, code = 400) => Object.assign(new Error(msg), { code });
const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const clip = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const FILE_ID = /^[A-Za-z0-9_-]{10,200}$/, MSG_ID = /^[A-Za-z0-9]{8,40}$/;

export function redirectUri(port: number) { return `http://127.0.0.1:${port}/api/google/callback`; }

/** Safe view for the dashboard: never includes tokens or the client secret. */
export function status(port: number) {
  const c = conf();
  return {
    configured: !!(c.clientId && c.clientSecret), clientId: c.clientId ? String(c.clientId).slice(0, 10) + "…" : null, redirectUri: redirectUri(port),
    accounts: accounts().map(a => ({ id: a.id, email: a.email, name: a.name, label: a.label, color: a.color, ok: !!a.refresh, write: canWrite(a), cal: hasCal(a) })),
  };
}

export function setClient(id: string, secret: string) {
  const i = String(id || "").trim(), s = String(secret || "").trim();
  if (!/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/i.test(i)) throw err("That isn't a Google Client ID (it ends in .apps.googleusercontent.com).");
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(s)) throw err("That doesn't look like the Client secret (it usually starts with GOCSPX-).");
  saveLocal({ google: { clientId: i, clientSecret: s } });
  access.clear();
  return { ok: true };
}

/** Starts adding (or reconnecting) an account: returns Google's sign-in page. State + PKCE verifier stay here for 10 minutes. */
export function loginUrl(port: number, hint?: string, write = false) {
  const c = conf();
  if (!c.clientId || !c.clientSecret) throw err("Add your Google Client ID and secret first.");
  if (!hint && accounts().length >= MAX_ACCOUNTS) throw err(`Up to ${MAX_ACCOUNTS} accounts. Remove one first.`);
  for (const [k, v] of pending) if (Date.now() - v.at > 10 * 60e3) pending.delete(k);
  if (pending.size > 20) pending.clear();
  const state = b64url(crypto.randomBytes(18)), verifier = b64url(crypto.randomBytes(48));
  const redirect = redirectUri(port);
  pending.set(state, { verifier, at: Date.now(), redirect, write });
  const q = new URLSearchParams({
    response_type: "code", client_id: c.clientId, redirect_uri: redirect, scope: [...SCOPES, ...(write ? WRITE_SCOPES : [])].join(" "), state, include_granted_scopes: "true",
    code_challenge: b64url(crypto.createHash("sha256").update(verifier).digest()), code_challenge_method: "S256",
    access_type: "offline", prompt: "consent select_account",
  });
  const h = accounts().find(a => a.id === hint)?.email; if (h) q.set("login_hint", h);
  return `${AUTH}?${q}`;
}

async function token(form: Record<string, string>) {
  const c = conf();
  const r = await fetch(TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, ...form }), signal: AbortSignal.timeout(TIMEOUT) });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw err(j.error === "invalid_grant" ? "Google sign-in expired. Reconnect this account." : j.error === "invalid_client" ? "Google rejected the Client ID/secret. Check them in Workspace → Setup." : `Google sign-in failed (${r.status}).`, j.error === "invalid_grant" ? 401 : 400);
  return j;
}

/** Google sends the browser back here. Returns the account label for the toast. */
export async function callback(params: URLSearchParams): Promise<string> {
  const state = params.get("state") || "", p = pending.get(state);
  pending.delete(state);
  if (!p || Date.now() - p.at > 10 * 60e3) throw err("Sign-in link expired. Press Add account again.");
  if (params.get("error")) throw err(params.get("error") === "access_denied" ? "You cancelled the Google sign-in." : "Google refused the sign-in.");
  const code = params.get("code"); if (!code) throw err("Google didn't send a code.");
  const granted = String(params.get("scope") || "");
  if (granted && (!granted.includes("gmail.readonly") || !granted.includes("drive.readonly"))) throw err("Tick both boxes (Gmail and Drive) on Google's page, then try again.");
  const j = await token({ grant_type: "authorization_code", code, redirect_uri: p.redirect, code_verifier: p.verifier });
  // The id_token came straight from Google's token endpoint over TLS, so reading its claims is enough here.
  let claims: any = {};
  try { claims = JSON.parse(Buffer.from(String(j.id_token || "").split(".")[1] || "", "base64url").toString("utf8")); } catch {}
  const email = clip(claims.email, 200).toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+$/.test(email)) throw err("Google didn't say which account this is. Try again.");
  const id = "g-" + crypto.createHash("sha256").update(email).digest("hex").slice(0, 10);
  const list = accounts(), old = list.find(a => a.id === id);
  const refresh = j.refresh_token || old?.refresh || null;
  if (!refresh) throw err("Google didn't return a sign-in key. Remove LUTHUR at myaccount.google.com/permissions, then add the account again.");
  const domain = email.split("@")[1];
  const scopes = String(j.scope || granted || "");
  const acc: Account = old ? { ...old, refresh, scopes, name: clip(claims.name, 80) || old.name } : {
    id, email, name: clip(claims.name, 80), refresh, scopes, addedAt: new Date().toISOString(),
    label: domain === "gmail.com" || domain === "googlemail.com" ? "Personal" : domain.split(".")[0].replace(/^./, c => c.toUpperCase()).slice(0, 24),
    color: COLORS.find(c => !list.some(a => a.color === c)) || COLORS[list.length % COLORS.length],
  };
  if (!old && list.length >= MAX_ACCOUNTS) throw err(`Up to ${MAX_ACCOUNTS} accounts.`);
  saveAccounts(old ? list.map(a => a.id === id ? acc : a) : [...list, acc]);
  access.set(id, { token: j.access_token, exp: Date.now() + (Number(j.expires_in || 3600) - 60) * 1e3 });
  mailCache.clear();
  return p.write && !canWrite(acc) ? `${acc.label} connected, but writing wasn't allowed (tick every box on Google's page)` : `${acc.label} connected${canWrite(acc) ? " with writing on" : ""}`;
}

export function update(id: string, patch: { label?: unknown; color?: unknown }) {
  const list = accounts(), a = list.find(x => x.id === id); if (!a) throw err("No such account", 404);
  if (patch.label !== undefined) a.label = clip(patch.label, 24) || a.label;
  if (patch.color !== undefined) { const c = String(patch.color); if (!/^#[0-9a-f]{6}$/i.test(c)) throw err("Bad colour"); a.color = c.toLowerCase(); }
  saveAccounts(list);
  return { ok: true };
}

/** Removes the account here and asks Google to revoke the key (best effort). */
export async function remove(id: string) {
  const list = accounts(), a = list.find(x => x.id === id); if (!a) throw err("No such account", 404);
  saveAccounts(list.filter(x => x.id !== id));
  access.delete(id); mailCache.clear();
  if (a.refresh) await fetch("https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: a.refresh }), signal: AbortSignal.timeout(TIMEOUT) }).catch(() => {});
  return { ok: true };
}

function account(id: string): Account {
  const a = accounts().find(x => x.id === id);
  if (!a) throw err("No such account", 404);
  if (!a.refresh) throw err(`${a.label} needs reconnecting (Workspace → Accounts).`, 401);
  return a;
}

async function accessToken(a: Account): Promise<string> {
  const cur = access.get(a.id); if (cur && Date.now() < cur.exp) return cur.token;
  const busy = refreshing.get(a.id); if (busy) return busy;
  const p = (async () => {
    try {
      const j = await token({ grant_type: "refresh_token", refresh_token: a.refresh! });
      access.set(a.id, { token: j.access_token, exp: Date.now() + (Number(j.expires_in || 3600) - 60) * 1e3 });
      return j.access_token as string;
    } catch (e: any) {
      if (e?.code === 401) saveAccounts(accounts().map(x => x.id === a.id ? { ...x, refresh: null } : x));
      throw e;
    } finally { refreshing.delete(a.id); }
  })();
  refreshing.set(a.id, p);
  return p;
}

async function gget(a: Account, url: string, kind: "json" | "text" = "json", retry = true): Promise<any> {
  const t = await accessToken(a);
  const r = await fetch(url, { headers: { Authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(TIMEOUT) });
  if (r.status === 401 && retry) { access.delete(a.id); return gget(a, url, kind, false); }
  if (r.ok) return kind === "text" ? (await r.text()).slice(0, 400_000) : r.json();
  const j: any = await r.json().catch(() => null);
  const reason = String(j?.error?.errors?.[0]?.reason || j?.error?.status || "");
  const api = url.includes("gmail") ? "Gmail API" : url.includes("sheets") ? "Google Sheets API" : url.includes("/calendar/") ? "Google Calendar API" : "Google Drive API";
  if (/accessNotConfigured|SERVICE_DISABLED/i.test(reason) || /has not been used|is disabled/i.test(String(j?.error?.message || ""))) throw err(`Turn on the ${api} in Google Cloud (Workspace → Setup, step 2), wait a minute, then retry.`);
  if (r.status === 404) throw err("Not found (it may have been deleted or you lost access).", 404);
  if (r.status === 403) throw err(/insufficient/i.test(reason) ? `${a.label}: reconnect and tick every box on Google's page.` : /domainPolicy|admin/i.test(reason + (j?.error?.message || "")) ? `${a.label}: the company's Google admin blocks this. Ask them to allow LUTHUR's Client ID.` : "Google didn't allow that.");
  if (r.status === 429) throw err("Google says slow down. Try again in a few seconds.");
  throw err(`Google error (${r.status}).`);
}

async function gsend(a: Account, url: string, body: unknown, method = "POST", retry = true): Promise<any> {
  const t = await accessToken(a);
  const r = await fetch(url, { method, headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT) });
  if (r.status === 401 && retry) { access.delete(a.id); return gsend(a, url, body, method, false); }
  const j: any = await r.json().catch(() => ({}));
  if (r.ok) return j;
  const msg = String(j?.error?.message || ""), reason = String(j?.error?.status || j?.error?.errors?.[0]?.reason || "");
  const api = url.includes("gmail") ? "Gmail API" : url.includes("docs.googleapis") ? "Google Docs API" : "Google Sheets API";
  if (/SERVICE_DISABLED|accessNotConfigured/i.test(reason) || /has not been used|is disabled/i.test(msg)) throw err(`Turn on the ${api} in Google Cloud (Workspace → Setup), wait a minute, then retry.`);
  if (r.status === 403) throw err(/insufficient|PERMISSION_DENIED/i.test(reason + msg) && !/caller does not have permission/i.test(msg) ? `${a.label}: turn on writing for this account (Workspace → Accounts → Allow writing).` : "You don't have edit access to that file.");
  if (r.status === 404) throw err("Not found (it may have been deleted or you lost access).", 404);
  if (r.status === 429) throw err("Google says slow down. Try again in a few seconds.");
  throw err(`Google error (${r.status})${msg ? ": " + clip(msg, 140) : ""}.`);
}
const ACTIVITY = path.join(DATA, "activity.jsonl");
const wlog = (event: string, a: Account, d: Record<string, unknown>) => appendLine(ACTIVITY, JSON.stringify({ at: new Date().toISOString(), event, acct: a.id, label: a.label, ...d }));
function writer(id: string): Account { const a = account(id); if (!canWrite(a)) throw err(`${a.label} is read-only. Workspace → Accounts → Allow writing.`, 403); return a; }

/** "Acmeco", "anthony@acmeco.com" or an account id → the account id (for the Outbox "from"). */
export function findAccount(v: unknown): string {
  const s = String(v || "").trim().toLowerCase(), list = accounts();
  const a = list.find(x => x.id === s || x.email === s || x.label.toLowerCase() === s);
  if (!a) throw err(`No connected Google account called "${clip(v, 60)}". Connected: ${list.map(x => `${x.label} (${x.email})`).join(", ") || "none"}.`);
  return a.id;
}
export function accountInfo(id: string) { const a = accounts().find(x => x.id === id); return a ? { id: a.id, email: a.email, label: a.label, write: canWrite(a) } : null; }

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}
const pick = (accId: string) => accId === "all" ? accounts().filter(a => a.refresh) : [account(accId)];

// ---------------- Gmail ----------------
const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decodeEnt = (s: string) => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => e[0] === "#" ? (() => { const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ""; })() : ENT[e.toLowerCase()] ?? m);
const hdr = (h: any[], n: string) => clip((h || []).find((x: any) => String(x.name).toLowerCase() === n)?.value, 300);

async function mailOf(a: Account, q: string, max: number, fresh = false) {
  const key = `${a.id}|${q}|${max}`, c = mailCache.get(key);
  if (c && !fresh && Date.now() - c.at < 60e3) return c.items;
  const l = await gget(a, `${GMAIL}/messages?${new URLSearchParams({ maxResults: String(max), q })}`);
  const ids = (l.messages || []).map((m: any) => String(m.id)).filter((id: string) => MSG_ID.test(id));
  const items = (await pool(ids, 8, (id: string) => gget(a, `${GMAIL}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`).catch(() => null)))
    .filter(Boolean).map((m: any) => {
      const h = m.payload?.headers || [], labels: string[] = m.labelIds || [];
      return { acct: a.id, id: m.id, thread: m.threadId, from: hdr(h, "from"), subject: hdr(h, "subject") || "(no subject)", snippet: clip(decodeEnt(String(m.snippet || "")), 200), date: Number(m.internalDate) || 0, unread: labels.includes("UNREAD"), important: labels.includes("IMPORTANT") };
    });
  mailCache.set(key, { at: Date.now(), items });
  if (mailCache.size > 60) mailCache.delete(mailCache.keys().next().value!);
  return items;
}

/** Latest mail for one account or "all" (merged, newest first). Search uses Gmail's own syntax. */
export async function mailList(acc: string, search = "", folder = "inbox", fresh = false) {
  const s = clip(search, 200);
  const base = folder === "unread" ? "in:inbox is:unread" : folder === "starred" ? "is:starred" : folder === "sent" ? "in:sent" : folder === "any" ? "" : "in:inbox -category:promotions -category:social";
  const q = [s ? (folder === "inbox" ? "" : base) : base, s].filter(Boolean).join(" ").trim();
  const list = pick(acc); if (!list.length) return { items: [], errors: [] };
  const per = list.length > 1 ? 12 : 25, errors: { acct: string; error: string }[] = [];
  const all = (await Promise.all(list.map(a => mailOf(a, q, per, fresh).catch((e: any) => { errors.push({ acct: a.id, error: String(e?.message || e) }); return []; })))).flat();
  return { items: all.sort((x, y) => y.date - x.date).slice(0, 40), errors };
}

function walk(p: any, out: { plain: string[]; html: string[]; files: { name: string; size: number }[] }) {
  if (!p) return;
  const mime = String(p.mimeType || ""), data = p.body?.data;
  if (p.filename) out.files.push({ name: clip(p.filename, 120), size: Number(p.body?.size) || 0 });
  else if (data && mime === "text/plain") out.plain.push(Buffer.from(data, "base64url").toString("utf8"));
  else if (data && mime === "text/html") out.html.push(Buffer.from(data, "base64url").toString("utf8"));
  (p.parts || []).forEach((x: any) => walk(x, out));
}
const htmlToText = (h: string) => decodeEnt(h.replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h\d|table)>/gi, "\n").replace(/<li[^>]*>/gi, "• ").replace(/<[^>]+>/g, "")).replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();

/** One email as plain text (never HTML), plus attachment names. */
export async function mailRead(acc: string, id: string) {
  if (!MSG_ID.test(id)) throw err("Bad message id");
  const a = account(acc), m = await gget(a, `${GMAIL}/messages/${id}?format=full`);
  const out = { plain: [] as string[], html: [] as string[], files: [] as { name: string; size: number }[] };
  walk(m.payload, out);
  const h = m.payload?.headers || [];
  const body = (out.plain.length ? out.plain.join("\n\n") : htmlToText(out.html.join("\n"))).replace(/\r/g, "").slice(0, 100_000);
  return {
    acct: a.id, id: m.id, thread: m.threadId, from: hdr(h, "from"), to: hdr(h, "to"), cc: hdr(h, "cc"), subject: hdr(h, "subject") || "(no subject)",
    date: Number(m.internalDate) || 0, body, files: out.files.slice(0, 30), write: canWrite(a),
    messageId: hdr(h, "message-id"), references: hdr(h, "references"), replyTo: hdr(h, "reply-to"),
    link: `https://mail.google.com/mail/?authuser=${encodeURIComponent(a.email)}#all/${encodeURIComponent(m.threadId)}`,
  };
}

// ---------------- Drive ----------------
export const KINDS: Record<string, string> = {
  sheets: "application/vnd.google-apps.spreadsheet", docs: "application/vnd.google-apps.document", forms: "application/vnd.google-apps.form",
  slides: "application/vnd.google-apps.presentation", folders: "application/vnd.google-apps.folder", pdfs: "application/pdf",
};
const qs = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
const FIELDS = "nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink,owners(displayName,me),shared,size,parents)";
/** Adds authuser so the link opens in the right Google account. Only Google https links pass. */
function openLink(raw: unknown, email: string) {
  try { const u = new URL(String(raw)); if (u.protocol !== "https:" || !/(^|\.)google\.com$/.test(u.hostname)) return null; u.searchParams.set("authuser", email); return u.toString(); } catch { return null; }
}
const fileOut = (a: Account, f: any) => ({ acct: a.id, id: f.id, name: clip(f.name, 200), mime: clip(f.mimeType, 100), modified: f.modifiedTime || null, owner: f.owners?.[0]?.me ? "me" : clip(f.owners?.[0]?.displayName, 60), shared: !!f.shared, size: Number(f.size) || 0, link: openLink(f.webViewLink, a.email) });

export async function driveList(acc: string, o: { search?: string; kind?: string; folder?: string; page?: string }) {
  const s = clip(o.search, 120), kind = KINDS[o.kind || ""] ? o.kind! : o.kind === "shared" ? "shared" : "";
  const folder = o.folder && FILE_ID.test(o.folder) ? o.folder : "";
  const terms = ["trashed = false"];
  if (folder) terms.push(`'${folder}' in parents`);
  if (kind === "shared") terms.push("sharedWithMe = true"); else if (kind) terms.push(`mimeType = '${KINDS[kind]}'`);
  if (s) terms.push(`(name contains '${qs(s)}' or fullText contains '${qs(s)}')`);
  const list = pick(acc); if (!list.length) return { items: [], errors: [], next: null };
  if (folder && list.length > 1) throw err("Pick one account to browse folders.");
  const errors: { acct: string; error: string }[] = []; let next: string | null = null;
  const per = list.length > 1 ? 25 : 60;
  const res = await Promise.all(list.map(async a => {
    const p = new URLSearchParams({ q: terms.join(" and "), fields: FIELDS, pageSize: String(per), supportsAllDrives: "true", includeItemsFromAllDrives: "true", corpora: "allDrives" });
    if (!s) p.set("orderBy", folder ? "folder,name" : "modifiedTime desc"); // Drive can't sort full-text searches
    if (o.page && list.length === 1 && /^[A-Za-z0-9_~.-]{1,400}$/.test(o.page)) p.set("pageToken", o.page);
    try { const j = await gget(a, `${DRIVE}/files?${p}`); if (list.length === 1) next = j.nextPageToken || null; return (j.files || []).filter((f: any) => FILE_ID.test(String(f.id))).map((f: any) => fileOut(a, f)); }
    catch (e: any) { errors.push({ acct: a.id, error: String(e?.message || e) }); return []; }
  }));
  const items = res.flat();
  if (list.length > 1 && !s) items.sort((x, y) => String(y.modified).localeCompare(String(x.modified)));
  return { items, errors, next };
}

export async function driveFile(acc: string, id: string) {
  if (!FILE_ID.test(id)) throw err("Bad file id");
  const a = account(acc);
  return fileOut(a, await gget(a, `${DRIVE}/files/${id}?fields=id,name,mimeType,modifiedTime,webViewLink,owners(displayName,me),shared,size,parents&supportsAllDrives=true`));
}

/** In-app look at a file: a Sheet as a table (one tab at a time), Docs/Slides/text as plain text, everything else as a link. */
export async function preview(acc: string, id: string, tab?: string) {
  const f: any = await driveFile(acc, id), a = account(acc);
  f.write = canWrite(a);
  const exp = (mime: string) => gget(a, `${DRIVE}/files/${id}/export?mimeType=${encodeURIComponent(mime)}`, "text");
  if (f.mime === KINDS.sheets) {
    try {
      const meta = await gget(a, `${SHEETS}/${id}?fields=sheets.properties(title,sheetId,index)`);
      const tabs = (meta.sheets || []).map((s: any) => clip(s.properties?.title, 100)).filter(Boolean).slice(0, 50);
      const t = tabs.includes(String(tab)) ? String(tab) : tabs[0];
      const v = await gget(a, `${SHEETS}/${id}/values/${encodeURIComponent(`'${t.replace(/'/g, "''")}'!A1:AZ500`)}?valueRenderOption=FORMATTED_VALUE`);
      const rows = (v.values || []).slice(0, 500).map((r: any[]) => r.slice(0, 52).map(c => String(c ?? "").slice(0, 500)));
      return { file: f, kind: "sheet", tabs, tab: t, rows, cut: (v.values || []).length >= 500 };
    } catch (e: any) {
      if (!/Sheets API/.test(String(e?.message))) throw e;
      const csv = await exp("text/csv"); // first tab only, without the Sheets API
      return { file: f, kind: "sheet", tabs: [], tab: null, rows: parseCsv(csv).slice(0, 500), cut: false, note: "Showing the first tab. Turn on the Google Sheets API to see every tab." };
    }
  }
  if (f.mime === KINDS.docs || f.mime === KINDS.slides) return { file: f, kind: "text", text: (await exp("text/plain")).slice(0, 200_000) };
  if (/^text\/(plain|csv|markdown)$/.test(f.mime) && f.size < 1_000_000) {
    const t = await gget(a, `${DRIVE}/files/${id}?alt=media&supportsAllDrives=true`, "text");
    return f.mime === "text/csv" ? { file: f, kind: "sheet", tabs: [], tab: null, rows: parseCsv(t).slice(0, 500), cut: false } : { file: f, kind: "text", text: t.slice(0, 200_000) };
  }
  if (RAW_OK.test(f.mime) && f.size <= 25e6) return { file: f, kind: f.mime === "application/pdf" ? "pdf" : "image" };
  return { file: f, kind: "link" };
}

function parseCsv(s: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell.slice(0, 500)); cell = ""; }
    else if (ch === "\n") { row.push(cell.slice(0, 500)); rows.push(row.slice(0, 52)); row = []; cell = ""; if (rows.length >= 500) break; }
    else if (ch !== "\r") cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// ---------------- writing (opt-in per account) ----------------
const hclean = (v: unknown, n = 1000) => String(v ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, n); // no header injection
const enc = (v: string) => /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, "utf8").toString("base64")}?=`;
const MID = /^<[^<>\s]{3,300}>$/;

/** Sends one email from the account. Only called by the Outbox after the owner pressed Send. */
export async function sendMail(fromId: string, p: { to: string[]; cc?: string[]; subject: string; body: string; threadId?: string; inReplyTo?: string; references?: string }) {
  const a = writer(fromId);
  const name = hclean(a.name, 80).replace(/["\\]/g, "");
  const inReply = p.inReplyTo && MID.test(p.inReplyTo) ? p.inReplyTo : "";
  const refs = (String(p.references || "").match(/<[^<>\s]{3,300}>/g) || []).slice(-20).join(" ");
  const head = [
    `From: ${name ? `"${enc(name)}" ` : ""}<${a.email}>`, `To: ${p.to.map(x => hclean(x, 300)).join(", ")}`, ...(p.cc?.length ? [`Cc: ${p.cc.map(x => hclean(x, 300)).join(", ")}`] : []),
    `Subject: ${enc(hclean(p.subject, 300))}`, ...(inReply ? [`In-Reply-To: ${inReply}`, `References: ${refs.includes(inReply) ? refs : [refs, inReply].filter(Boolean).join(" ")}`] : []),
    "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64",
  ];
  const raw = head.join("\r\n") + "\r\n\r\n" + (Buffer.from(String(p.body).replace(/\r?\n/g, "\r\n"), "utf8").toString("base64").match(/.{1,76}/g) || []).join("\r\n");
  const thread = p.threadId && /^[A-Za-z0-9]{8,40}$/.test(p.threadId) ? p.threadId : undefined;
  const r = await gsend(a, `${GMAIL}/messages/send`, { raw: Buffer.from(raw, "utf8").toString("base64url"), ...(thread ? { threadId: thread } : {}) });
  wlog("google-mail-sent", a, { to: p.to.length + (p.cc?.length || 0), id: r.id });
  mailCache.clear();
  return { id: String(r.id || ""), from: a.email };
}

export async function createFile(acc: string, kind: string, title: unknown, text?: unknown) {
  const a = writer(acc), t = clip(title, 200) || (kind === "sheet" ? "Untitled spreadsheet" : "Untitled document");
  if (kind === "sheet") {
    const r = await gsend(a, SHEETS, { properties: { title: t } });
    wlog("google-sheet-created", a, { id: r.spreadsheetId });
    return { id: String(r.spreadsheetId), link: openLink(r.spreadsheetUrl, a.email), mime: KINDS.sheets, name: t, acct: a.id };
  }
  if (kind !== "doc") throw err("Pick Doc or Sheet.");
  const r = await gsend(a, DOCS, { title: t });
  const body = String(text ?? "").replace(/\r\n/g, "\n").slice(0, 100_000);
  if (body.trim()) await gsend(a, `${DOCS}/${r.documentId}:batchUpdate`, { requests: [{ insertText: { location: { index: 1 }, text: body } }] });
  wlog("google-doc-created", a, { id: r.documentId });
  return { id: String(r.documentId), link: openLink(`https://docs.google.com/document/d/${r.documentId}/edit`, a.email), mime: KINDS.docs, name: t, acct: a.id };
}

const colName = (i: number) => { let s = ""; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
/** Writes the given cells (row/col are 0-based) on one tab. Values are typed like in Google Sheets (=formulas work). */
export async function sheetSet(acc: string, id: string, tab: unknown, cells: unknown) {
  if (!FILE_ID.test(id)) throw err("Bad file id");
  const a = writer(acc), t = clip(tab, 100);
  if (!t) throw err("Which tab?");
  if (!Array.isArray(cells) || !cells.length) throw err("Nothing to save.");
  if (cells.length > 500) throw err("Too many changes at once (max 500).");
  const data = cells.map((c: any) => {
    const r = Number(c?.r), k = Number(c?.c);
    if (!Number.isInteger(r) || !Number.isInteger(k) || r < 0 || k < 0 || r > 99_999 || k > 701) throw err("Bad cell");
    return { range: `'${t.replace(/'/g, "''")}'!${colName(k)}${r + 1}`, values: [[String(c?.v ?? "").slice(0, 50_000)]] };
  });
  const res = await gsend(a, `${SHEETS}/${id}/values:batchUpdate`, { valueInputOption: "USER_ENTERED", data });
  wlog("google-sheet-edited", a, { id, cells: data.length });
  return { ok: true, updated: Number(res.totalUpdatedCells) || data.length };
}

export async function docAppend(acc: string, id: string, text: unknown) {
  if (!FILE_ID.test(id)) throw err("Bad file id");
  const a = writer(acc), body = String(text ?? "").replace(/\r\n/g, "\n").slice(0, 100_000);
  if (!body.trim()) throw err("Nothing to add.");
  const d = await gget(a, `${DOCS}/${id}?fields=body.content(endIndex)`);
  const end = Math.max(1, (Number(d.body?.content?.at(-1)?.endIndex) || 2) - 1);
  await gsend(a, `${DOCS}/${id}:batchUpdate`, { requests: [{ insertText: { location: { index: end }, text: "\n" + body } }] });
  wlog("google-doc-edited", a, { id, op: "append" });
  return { ok: true };
}

export async function docReplace(acc: string, id: string, find: unknown, repl: unknown, matchCase = false) {
  if (!FILE_ID.test(id)) throw err("Bad file id");
  const a = writer(acc), f = String(find ?? "").slice(0, 2000), r = String(repl ?? "").slice(0, 20_000);
  if (!f.trim()) throw err("Type the text to find.");
  const res = await gsend(a, `${DOCS}/${id}:batchUpdate`, { requests: [{ replaceAllText: { containsText: { text: f, matchCase: !!matchCase }, replaceText: r } }] });
  const n = Number(res.replies?.[0]?.replaceAllText?.occurrencesChanged) || 0;
  wlog("google-doc-edited", a, { id, op: "replace", n });
  return { ok: true, changed: n };
}

// Raw bytes for in-app viewing of PDFs and images only (never HTML/SVG/scripts). Capped at 25 MB.
const RAW_OK = /^(application\/pdf|image\/(png|jpeg|gif|webp|bmp))$/;
export async function raw(acc: string, id: string): Promise<{ type: string; body: Buffer }> {
  if (!FILE_ID.test(id)) throw err("Bad file id");
  const f = await driveFile(acc, id), a = account(acc);
  if (!RAW_OK.test(f.mime)) throw err("No preview for this type.");
  if (f.size > 25e6) throw err("Too big to preview here (over 25 MB). Open it in Google.");
  const t = await accessToken(a);
  const r = await fetch(`${DRIVE}/files/${id}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(60e3) });
  if (!r.ok) throw err(`Google error (${r.status}).`);
  const body = Buffer.from(await r.arrayBuffer());
  if (body.length > 25e6) throw err("Too big to preview here.");
  return { type: f.mime, body };
}

// ---------------- Calendar (read-only; shown in LUTHUR's Calendar, Upcoming and briefings) ----------------
export type GCalEvent = { id: string; feed: string; title: string; start: string; end: string; allDay: boolean; location?: string };
type CalMonth = { at: number; events: GCalEvent[]; inflight?: Promise<void> };
const calCache = new Map<string, CalMonth>(); // `${acct}|${yyyy-mm}`
const calState = new Map<string, { ok: boolean | null; error: string | null; at: number }>();
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
function monthsBetween(from: Date, to: Date): Date[] { const out: Date[] = []; const d = new Date(from.getFullYear(), from.getMonth(), 1); while (d < to && out.length < 14) { out.push(new Date(d)); d.setMonth(d.getMonth() + 1); } return out; }

async function calFetch(a: Account, month: Date): Promise<GCalEvent[]> {
  const from = new Date(month), to = new Date(month); to.setMonth(to.getMonth() + 1);
  const list = await gget(a, `${CAL}/users/me/calendarList?minAccessRole=reader&maxResults=50`);
  const cals = (list.items || []).filter((c: any) => c && c.selected !== false && !c.hidden && typeof c.id === "string").slice(0, 15);
  const out: GCalEvent[] = [];
  await pool(cals, 4, async (c: any) => {
    const q = new URLSearchParams({ timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "250", fields: "items(id,status,summary,location,start,end)" });
    const r = await gget(a, `${CAL}/calendars/${encodeURIComponent(c.id)}/events?${q}`).catch(() => null);
    for (const e of r?.items || []) {
      if (e.status === "cancelled" || !e.start) continue;
      const allDay = !!e.start.date;
      out.push({ id: crypto.createHash("sha1").update(`${a.id}|${c.id}|${e.id}`).digest("hex").slice(0, 16), feed: "g:" + a.id, title: clip(e.summary, 200) || "(busy)", location: clip(e.location, 200) || undefined, allDay,
        start: allDay ? String(e.start.date) : new Date(e.start.dateTime).toISOString(), end: allDay ? String(e.end?.date || e.start.date) : new Date(e.end?.dateTime || e.start.dateTime).toISOString() });
    }
  });
  return out;
}
/** Starts background fetches for stale months (10 min TTL). Non-blocking. */
export function calKick(from: Date, to: Date) {
  for (const a of accounts().filter(x => x.refresh && hasCal(x))) for (const m of monthsBetween(from, to)) {
    const key = `${a.id}|${monthKey(m)}`, c = calCache.get(key) || { at: 0, events: [] };
    if (c.inflight || (c.at && Date.now() - c.at < 10 * 60e3)) continue;
    c.inflight = calFetch(a, m).then(ev => { c.events = ev; calState.set(a.id, { ok: true, error: null, at: Date.now() }); })
      .catch((e: any) => calState.set(a.id, { ok: false, error: String(e?.message || e).slice(0, 200), at: Date.now() }))
      .finally(() => { c.at = Date.now(); c.inflight = undefined; });
    calCache.set(key, c);
    if (calCache.size > 200) calCache.delete(calCache.keys().next().value!);
  }
}
export async function calSync(from: Date, to: Date) { for (const [k] of calCache) calCache.get(k)!.at = 0; calKick(from, to); await Promise.all([...calCache.values()].map(c => c.inflight)); }
export function calEvents(from: Date, to: Date): GCalEvent[] {
  const f = from.getTime(), t = to.getTime(), seen = new Set<string>(), out: GCalEvent[] = [];
  for (const a of accounts().filter(x => hasCal(x))) for (const m of monthsBetween(from, to)) for (const e of calCache.get(`${a.id}|${monthKey(m)}`)?.events || []) {
    const s = Date.parse(e.allDay ? e.start + "T00:00" : e.start), en = Date.parse(e.allDay ? e.end + "T00:00" : e.end);
    if (s < t && Math.max(en, s + 1) > f && !seen.has(e.id)) { seen.add(e.id); out.push(e); }
  }
  return out;
}
/** Calendar "feeds" for the dashboard: one per connected account (managed in Workspace, not removable here). */
export function calFeeds() {
  return accounts().map(a => {
    const st = calState.get(a.id), n = [...calCache.entries()].filter(([k]) => k.startsWith(a.id + "|")).reduce((s, [, v]) => s + v.events.length, 0);
    return { id: "g:" + a.id, name: a.label, color: a.color, host: a.email, google: true, needsReconnect: !hasCal(a), ok: !hasCal(a) ? false : st ? st.ok : null, error: !hasCal(a) ? "Press Reconnect in Workspace → Accounts to show this calendar." : st?.error || null, lastSync: st?.at ? new Date(st.at).toISOString() : null, count: n };
  });
}
