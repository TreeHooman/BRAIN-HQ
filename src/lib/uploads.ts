// Images the owner attaches to a chat or Code message (paste, drop or pick).
// The page shrinks each image before upload; here it is checked (type + magic bytes + size) and kept in
// data/uploads/ as img-<16 hex>.<ext>. Runs get the files by id only, never by a path the page sent.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA } from "./store.ts";

const DIR = path.join(DATA, "uploads");
const MAX_BYTES = 1.5e6;
const KEEP_DAYS = 30;
const TYPES: Record<string, { ext: string; magic: (b: Buffer) => boolean }> = {
  "image/png": { ext: "png", magic: b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  "image/jpeg": { ext: "jpg", magic: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  "image/webp": { ext: "webp", magic: b => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP" },
  "image/gif": { ext: "gif", magic: b => b.subarray(0, 4).toString("latin1") === "GIF8" },
};
const ID_RE = /^img-[a-f0-9]{16}\.(png|jpg|webp|gif)$/;
export const MAX_IMAGES = 4;
export type Image = { id: string; path: string; type: string };

export function save(dataUrl: unknown): { id: string; bytes: number } {
  const m = String(dataUrl || "").match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new Error("Only PNG, JPEG, WebP or GIF images can be attached.");
  const kind = TYPES[m[1]], buf = Buffer.from(m[2], "base64");
  if (!buf.length || buf.length > MAX_BYTES) throw new Error("That image is too large (1.5 MB max after shrinking).");
  if (!kind.magic(buf)) throw new Error("That file isn't a valid image.");
  fs.mkdirSync(DIR, { recursive: true });
  const id = `img-${crypto.randomBytes(8).toString("hex")}.${kind.ext}`;
  fs.writeFileSync(path.join(DIR, id), buf);
  prune();
  return { id, bytes: buf.length };
}

/** Turns ids sent by the page into checked files that exist. Unknown or malformed ids are dropped. */
export function resolve(ids: unknown): Image[] {
  if (!Array.isArray(ids)) return [];
  const out: Image[] = [];
  for (const id of ids.slice(0, MAX_IMAGES)) {
    if (typeof id !== "string" || !ID_RE.test(id)) continue;
    const p = path.join(DIR, id);
    if (!fs.existsSync(p)) continue;
    const ext = id.split(".").pop()!;
    out.push({ id, path: p, type: Object.keys(TYPES).find(t => TYPES[t].ext === ext)! });
  }
  return out;
}

export function read(id: string): { body: Buffer; type: string } {
  const [img] = resolve([id]);
  if (!img) throw Object.assign(new Error("Not found"), { code: 404 });
  return { body: fs.readFileSync(img.path), type: img.type };
}

/** Claude message content: the images first, then the text (stream-json input). */
export function contentBlocks(text: string, images: Image[] = []) {
  return [
    ...images.map(i => ({ type: "image", source: { type: "base64", media_type: i.type, data: fs.readFileSync(i.path).toString("base64") } })),
    { type: "text", text },
  ];
}

let lastPrune = 0;
function prune() {
  if (Date.now() - lastPrune < 3600e3) return;
  lastPrune = Date.now();
  const cutoff = Date.now() - KEEP_DAYS * 86400e3;
  try { for (const f of fs.readdirSync(DIR)) if (ID_RE.test(f) && fs.statSync(path.join(DIR, f)).mtimeMs < cutoff) fs.rmSync(path.join(DIR, f), { force: true }); } catch {}
}
