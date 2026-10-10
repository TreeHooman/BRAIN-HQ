// Unsent text (and attached image ids) in the chat and Code boxes. Kept in this process's memory only, so a draft
// survives closing a panel or tab and switching device, and is gone when LUTHUR restarts (owner, 2026-10-10).
import { MAX_IMAGES } from "./uploads.ts";

type Draft = { text: string; images: string[]; at: number };
const drafts = new Map<string, Draft>();
const KEY_RE = /^[a-z]{2,10}(:[a-z0-9-]{1,60})?$/;
const checkKey = (key: string) => { if (!KEY_RE.test(key)) throw new Error("Bad draft key"); };

export function get(key: string): Draft { checkKey(key); return drafts.get(key) || { text: "", images: [], at: 0 }; }

export function put(key: string, b: any): { ok: true } {
  checkKey(key);
  const text = String(b?.text ?? "").slice(0, 20000);
  const images = (Array.isArray(b?.images) ? b.images : []).filter((x: unknown) => typeof x === "string" && /^img-[a-f0-9]{16}\.(png|jpg|webp|gif)$/.test(x)).slice(0, MAX_IMAGES);
  if (!text.trim() && !images.length) drafts.delete(key);
  else { drafts.set(key, { text, images, at: Date.now() }); if (drafts.size > 200) drafts.delete(drafts.keys().next().value!); }
  return { ok: true };
}
