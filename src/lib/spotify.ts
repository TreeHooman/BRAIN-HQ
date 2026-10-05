// Spotify: see and control playback (Spotify Web API, OAuth "authorization code + PKCE").
// No client secret exists anywhere. The refresh token is a secret: it lives only in config/hq.local.json,
// the access token only in memory, and neither is ever sent to the dashboard or included in errors.
import crypto from "node:crypto";
import { loadConfig, saveLocal } from "./config.ts";

const AUTH = "https://accounts.spotify.com";
const API = "https://api.spotify.com/v1";
const SCOPES = ["user-read-playback-state", "user-modify-playback-state", "user-read-currently-playing", "playlist-read-private", "playlist-read-collaborative"];
const TIMEOUT = 10e3;

type Pending = { verifier: string; at: number; redirect: string };
const pending = new Map<string, Pending>();
let access: { token: string; exp: number } | null = null;
let refreshing: Promise<string> | null = null;
let me: { name: string } | null = null;

const conf = () => loadConfig().spotify || {};
const err = (msg: string, code = 400) => Object.assign(new Error(msg), { code });
const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function redirectUri(port: number): string {
  const r = String(conf().redirectUri || "");
  return /^https?:\/\//.test(r) ? r : `http://127.0.0.1:${port}/api/spotify/callback`;
}

/** Safe view for the dashboard: never includes tokens. */
export function status(port: number) {
  const c = conf();
  return { configured: !!c.clientId, connected: !!c.refreshToken, user: me?.name || null, redirectUri: redirectUri(port), clientId: c.clientId ? String(c.clientId).slice(0, 6) + "…" : null };
}

export function setClientId(id: string) {
  const v = String(id || "").trim();
  if (!/^[a-f0-9]{32}$/i.test(v)) throw err("That isn't a Spotify Client ID (32 letters and numbers, from the app's Settings page).");
  saveLocal({ spotify: { clientId: v, refreshToken: null } });
  access = null; me = null;
  return { ok: true };
}

export function disconnect() {
  saveLocal({ spotify: { refreshToken: null } });
  access = null; me = null;
  return { ok: true };
}

/** Starts sign-in: returns the Spotify page to open. State + PKCE verifier stay server-side for 10 minutes. */
export function loginUrl(port: number): string {
  const c = conf();
  if (!c.clientId) throw err("Add your Spotify Client ID first.");
  for (const [k, v] of pending) if (Date.now() - v.at > 10 * 60e3) pending.delete(k);
  if (pending.size > 20) pending.clear();
  const state = b64url(crypto.randomBytes(18)), verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const redirect = redirectUri(port);
  pending.set(state, { verifier, at: Date.now(), redirect });
  const q = new URLSearchParams({ response_type: "code", client_id: c.clientId, scope: SCOPES.join(" "), redirect_uri: redirect, state, code_challenge_method: "S256", code_challenge: challenge });
  return `${AUTH}/authorize?${q}`;
}

async function token(form: Record<string, string>): Promise<any> {
  const r = await fetch(`${AUTH}/api/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form), signal: AbortSignal.timeout(TIMEOUT) });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw err(j.error === "invalid_grant" ? "Spotify sign-in expired. Connect again." : `Spotify sign-in failed (${r.status}).`, r.status === 400 ? 401 : 400);
  return j;
}

export async function callback(params: URLSearchParams): Promise<void> {
  const state = params.get("state") || "", p = pending.get(state);
  pending.delete(state);
  if (!p || Date.now() - p.at > 10 * 60e3) throw err("Sign-in link expired. Press Connect again.");
  if (params.get("error")) throw err(params.get("error") === "access_denied" ? "You cancelled the Spotify sign-in." : "Spotify refused the sign-in.");
  const code = params.get("code"); if (!code) throw err("Spotify didn't send a code.");
  const j = await token({ grant_type: "authorization_code", code, redirect_uri: p.redirect, client_id: conf().clientId, code_verifier: p.verifier });
  if (!j.refresh_token) throw err("Spotify didn't return a sign-in token.");
  saveLocal({ spotify: { refreshToken: j.refresh_token } });
  access = { token: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1e3 };
  me = null;
}

async function accessToken(): Promise<string> {
  if (access && Date.now() < access.exp) return access.token;
  if (refreshing) return refreshing;
  const c = conf();
  if (!c.clientId || !c.refreshToken) throw err("Spotify isn't connected. Settings → Spotify.", 401);
  refreshing = (async () => {
    try {
      const j = await token({ grant_type: "refresh_token", refresh_token: c.refreshToken, client_id: c.clientId });
      if (j.refresh_token && j.refresh_token !== c.refreshToken) saveLocal({ spotify: { refreshToken: j.refresh_token } }); // PKCE tokens rotate
      access = { token: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1e3 };
      return access.token;
    } catch (e: any) {
      if (e?.code === 401) saveLocal({ spotify: { refreshToken: null } });
      throw e;
    } finally { refreshing = null; }
  })();
  return refreshing;
}

async function call(method: string, path: string, body?: unknown, retry = true): Promise<any> {
  const t = await accessToken();
  const r = await fetch(API + path, { method, headers: { Authorization: `Bearer ${t}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(TIMEOUT) });
  if (r.status === 401 && retry) { access = null; return call(method, path, body, false); }
  if (r.status === 204 || r.status === 202) return null;
  const j: any = await r.json().catch(() => null);
  if (r.ok) return j;
  const reason = j?.error?.reason || "";
  if (r.status === 404 || reason === "NO_ACTIVE_DEVICE") throw err("No Spotify device is open. Open Spotify on your PC or phone, then try again.");
  if (r.status === 403) throw err(reason === "PREMIUM_REQUIRED" ? "Controlling playback needs Spotify Premium." : "Spotify didn't allow that right now.");
  if (r.status === 429) throw err("Spotify says slow down. Try again in a few seconds.");
  throw err(`Spotify error (${r.status}).`);
}

const img = (images: any[] | undefined) => (images || []).sort((a, b) => (a.width || 0) - (b.width || 0)).find(i => (i.width || 300) >= 120)?.url || images?.[0]?.url || null;
const httpsOnly = (u: string | null) => u && /^https:\/\//.test(u) ? u : null;

export async function now() {
  if (!conf().refreshToken) return { connected: false };
  if (!me) { const u = await call("GET", "/me").catch(() => null); me = { name: u?.display_name || "Spotify" }; }
  const p = await call("GET", "/me/player?additional_types=episode");
  if (!p) return { connected: true, user: me.name, active: false };
  const it = p.item || {};
  return {
    connected: true, user: me.name, active: true, playing: !!p.is_playing,
    track: it.name || "", artist: (it.artists || []).map((a: any) => a.name).join(", ") || it.show?.name || "",
    album: it.album?.name || "", art: httpsOnly(img(it.album?.images || it.images)), uri: it.uri || null,
    progress: p.progress_ms || 0, duration: it.duration_ms || 0, shuffle: !!p.shuffle_state, repeat: p.repeat_state || "off",
    device: p.device ? { name: p.device.name, type: p.device.type, volume: p.device.volume_percent } : null,
  };
}

export async function devices() {
  const d = await call("GET", "/me/player/devices");
  return (d?.devices || []).map((x: any) => ({ id: x.id, name: x.name, type: x.type, active: x.is_active, volume: x.volume_percent }));
}

const ID = /^[A-Za-z0-9]{1,64}$/;
async function deviceQ(): Promise<string> {
  const ds = await devices().catch(() => []);
  if (ds.some((d: any) => d.active)) return "";
  const pick = ds.find((d: any) => d.type === "Computer") || ds[0];
  return pick && ID.test(pick.id) ? `?device_id=${pick.id}` : "";
}

export async function control(action: string, value?: unknown) {
  switch (action) {
    case "play": await call("PUT", "/me/player/play" + await deviceQ()); break;
    case "pause": await call("PUT", "/me/player/pause"); break;
    case "toggle": { const p = await call("GET", "/me/player"); await control(p?.is_playing ? "pause" : "play"); break; }
    case "next": await call("POST", "/me/player/next"); break;
    case "previous": await call("POST", "/me/player/previous"); break;
    case "volume": { const v = Math.max(0, Math.min(100, Math.round(Number(value)))); if (!Number.isFinite(v)) throw err("Bad volume"); await call("PUT", `/me/player/volume?volume_percent=${v}`); break; }
    case "volume-step": { const p = await call("GET", "/me/player"); const cur = p?.device?.volume_percent ?? 50; await control("volume", cur + (Number(value) || 10)); break; }
    case "shuffle": await call("PUT", `/me/player/shuffle?state=${value ? "true" : "false"}`); break;
    case "transfer": { const id = String(value || ""); if (!ID.test(id)) throw err("Bad device"); await call("PUT", "/me/player", { device_ids: [id], play: true }); break; }
    default: throw err("Unknown action");
  }
  return { ok: true };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/** "play gym playlist", "play Drake", "play Blinding Lights by The Weeknd": your playlists first, then search. */
export async function play(query: string) {
  let q = norm(String(query || "").slice(0, 200)).replace(/^(play|put on|start)\s+/, "").replace(/\s+(on spotify|please)$/, "");
  if (!q) throw err("Say what to play.");
  if (/^(music|something|spotify|my music)$/.test(q)) { await control("play"); return { ok: true, playing: "your music" }; }
  const kind = /\b(playlist)\b/.test(q) ? "playlist" : /\b(album)\b/.test(q) ? "album" : /\b(artist|songs by)\b/.test(q) ? "artist" : null;
  q = q.replace(/\b(playlist|album|artist|songs by)\b/g, " ").replace(/^\s*(my|the|some)\s+/, "").replace(/\s+/g, " ").trim() || q;
  const dq = await deviceQ();
  if (kind !== "album" && kind !== "artist") {
    const mine = await call("GET", "/me/playlists?limit=50").catch(() => null);
    const pl = (mine?.items || []).filter(Boolean).find((p: any) => norm(p.name) === q) || (mine?.items || []).filter(Boolean).find((p: any) => norm(p.name).includes(q));
    if (pl) { await call("PUT", "/me/player/play" + dq, { context_uri: pl.uri }); return { ok: true, playing: pl.name, type: "playlist" }; }
  }
  const by = q.match(/^(.+?) by (.+)$/);
  const sq = by ? `track:${by[1]} artist:${by[2]}` : q;
  const types = kind ? kind : by ? "track" : "track,artist,playlist";
  const r = await call("GET", `/search?${new URLSearchParams({ q: sq, type: types, limit: "5" })}`);
  const artist = (r?.artists?.items || []).find((a: any) => norm(a.name) === q);
  const album = r?.albums?.items?.[0], playlist = (r?.playlists?.items || []).filter(Boolean)[0], track = r?.tracks?.items?.[0];
  if (kind === "album" && album) { await call("PUT", "/me/player/play" + dq, { context_uri: album.uri }); return { ok: true, playing: album.name, type: "album" }; }
  if ((kind === "artist" || artist) && (artist || r?.artists?.items?.[0])) { const a = artist || r.artists.items[0]; await call("PUT", "/me/player/play" + dq, { context_uri: a.uri }); return { ok: true, playing: a.name, type: "artist" }; }
  if (kind === "playlist" && playlist) { await call("PUT", "/me/player/play" + dq, { context_uri: playlist.uri }); return { ok: true, playing: playlist.name, type: "playlist" }; }
  if (track) { await call("PUT", "/me/player/play" + dq, { uris: [track.uri] }); return { ok: true, playing: `${track.name} by ${(track.artists || []).map((a: any) => a.name).join(", ")}`, type: "track" }; }
  if (playlist) { await call("PUT", "/me/player/play" + dq, { context_uri: playlist.uri }); return { ok: true, playing: playlist.name, type: "playlist" }; }
  throw err(`Couldn't find “${query}” on Spotify.`);
}
