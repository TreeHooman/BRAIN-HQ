// ElevenLabs text-to-speech for LUTHUR's voice. The API key is a secret: it lives only in config/hq.local.json
// (entered by the owner in Settings) and is never sent to the dashboard or included in errors.
import { loadConfig, saveLocal } from "./config.ts";

const API = "https://api.elevenlabs.io/v1";
const TIMEOUT = 20e3;
const MAX_CHARS = 320; // keeps credits down; the full reply is still on screen
const DEFAULT_MODEL = "eleven_flash_v2_5";

const conf = () => loadConfig().elevenlabs || {};
const err = (msg: string, code = 400) => Object.assign(new Error(msg), { code });
const cache = new Map<string, Buffer>();
const RECHECK = 6 * 36e5; // after credits run out, try ElevenLabs again every 6 hours (top-ups and monthly resets)
let outUntil = 0;

/** Safe view for the dashboard: never includes the key. */
export function status() {
  const c = conf();
  return { configured: !!c.apiKey, enabled: c.enabled === true && !!c.apiKey && !!c.voiceId, voiceId: c.voiceId || "", voiceName: c.voiceName || "", model: c.model || DEFAULT_MODEL, stability: num(c.stability, .45), style: num(c.style, .25), outOfCredits: Date.now() < outUntil };
}
function num(v: unknown, d: number) { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : d; }

export function save(b: any) {
  const patch: any = {};
  if (typeof b.apiKey === "string" && b.apiKey.trim()) {
    const k = b.apiKey.trim();
    if (!/^sk_[\w-]{20,120}$/.test(k)) throw err("That isn't the API key. ElevenLabs keys start with sk_ and are shown once, when you create the key (not the key's ID).");
    patch.apiKey = k;
  }
  if (b.clearKey === true) { patch.apiKey = null; patch.enabled = false; }
  if (typeof b.voiceId === "string") {
    const v = b.voiceId.trim();
    if (v && !/^[A-Za-z0-9]{10,40}$/.test(v)) throw err("That isn't an ElevenLabs voice ID.");
    patch.voiceId = v; patch.voiceName = String(b.voiceName || "").slice(0, 80);
  }
  if (typeof b.enabled === "boolean") patch.enabled = b.enabled;
  for (const k of ["stability", "style"]) if (b[k] !== undefined) patch[k] = num(b[k], .5);
  saveLocal({ elevenlabs: patch });
  cache.clear(); outUntil = 0;
  return status();
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const key = conf().apiKey;
  if (!key) throw err("Add your ElevenLabs API key in Settings → Voice.");
  const r = await fetch(API + path, { ...init, headers: { "xi-api-key": key, ...(init.headers || {}) }, signal: AbortSignal.timeout(TIMEOUT) });
  if (!r.ok) {
    let detail = "", kind = ""; try { const j: any = await r.json(); kind = String(j?.detail?.status || ""); detail = String(j?.detail?.message || kind || j?.detail || "").slice(0, 160); } catch {}
    if (r.status === 402 || /quota|credit|limit_reached/i.test(kind)) { outUntil = Date.now() + RECHECK; throw err("ElevenLabs credits are used up.", 402); }
    throw err(r.status === 401 ? "ElevenLabs rejected the API key." : `ElevenLabs error ${r.status}${detail ? ": " + detail : ""}`, r.status === 401 ? 401 : 502);
  }
  return r;
}

export async function voices() {
  const j: any = await (await call("/voices")).json();
  return (j.voices || []).map((v: any) => ({ id: String(v.voice_id), name: String(v.name || "Voice"), category: String(v.category || ""), description: String(v.labels ? Object.values(v.labels).join(", ") : "") })).slice(0, 200);
}

/** Cuts long speech at the last full sentence (or word) under MAX_CHARS. */
function clip(t: string): string {
  if (t.length <= MAX_CHARS) return t;
  const cut = t.slice(0, MAX_CHARS), end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return end > MAX_CHARS * .4 ? cut.slice(0, end + 1) : cut.slice(0, cut.lastIndexOf(" ")) + "…";
}

// Audio already being made for a sentence (prefetch): a request for the same words waits for it instead of starting over.
const inflight = new Map<string, Promise<Buffer>>();
/** Normalised exactly like the dashboard does before it asks for audio (voice-stream.js earlySpeak), so the keys match. */
export const spokenText = (t: string) => String(t || "").replace(/[#*_`>|]/g, "").replace(/\s+/g, " ").trim();
/** Start making the audio as soon as the spoken sentence is complete in the stream (before the dashboard asks). */
export function prefetch(text: string, speed: unknown): void {
  try { if (!status().enabled || status().outOfCredits) return; void speak(spokenText(text), speed).catch(() => {}); } catch {}
}

/** Returns MP3 audio for the text in the chosen voice. */
export async function speak(text: unknown, speed: unknown): Promise<Buffer> {
  const c = conf(), s = status();
  if (!s.enabled) throw err("ElevenLabs voice is off.");
  if (s.outOfCredits) throw err("ElevenLabs credits are used up.", 402);
  const t = clip(String(text || "").replace(/\s+/g, " ").trim());
  if (!t) throw err("Nothing to say.");
  const sp = Math.max(.7, Math.min(1.2, Number(speed) || 1));
  const key = `${c.voiceId}|${s.model}|${s.stability}|${s.style}|${sp}|${t}`;
  const hit = cache.get(key); if (hit) return hit;
  const wait = inflight.get(key); if (wait) return wait;
  const p = synth(c, s, t, sp, key).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
async function synth(c: any, s: ReturnType<typeof status>, t: string, sp: number, key: string): Promise<Buffer> {
  const r = await call(`/text-to-speech/${encodeURIComponent(c.voiceId)}?output_format=mp3_44100_128`, {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text: t, model_id: s.model, voice_settings: { stability: s.stability, similarity_boost: .8, style: s.style, use_speaker_boost: true, speed: sp } }),
  });
  const buf = Buffer.from(await r.arrayBuffer());
  cache.set(key, buf); if (cache.size > 40) cache.delete(cache.keys().next().value!);
  return buf;
}
