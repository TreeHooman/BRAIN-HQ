// Canvases: a pan/zoom board per project holding cards (live agent chats, the project overview,
// goal checklists, notes). Only the layout is stored here; card content comes from the brain and Code sessions.
import path from "node:path";
import fs from "node:fs";
import { DATA, readJson, uid, writeJson } from "./store.ts";
import * as brain from "./brain.ts";

export type Card = { id: string; type: "project" | "agent" | "checklist" | "note"; x: number; y: number; w: number; h: number; ref?: string | null; text?: string };
export type Canvas = { id: string; name: string; project: string | null; cards: Card[]; view: { x: number; y: number; z: number }; createdAt: string; updatedAt: string };

const DIR = path.join(DATA, "canvas");
const ID = /^cv-[a-z0-9]{4,40}$/;
const TYPES = ["project", "agent", "checklist", "note"];
const num = (v: unknown, lo: number, hi: number, d: number) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
const str = (v: unknown, max: number) => String(v ?? "").slice(0, max);
const file = (id: string) => { if (!ID.test(id)) throw Object.assign(new Error("Bad canvas id"), { code: 404 }); return path.join(DIR, `${id}.json`); };

export function list() {
  let fs_: string[] = [];
  try { fs_ = fs.readdirSync(DIR).filter(f => f.endsWith(".json")); } catch {}
  return fs_.map(f => readJson<Canvas | null>(path.join(DIR, f), null)).filter((c): c is Canvas => !!c && ID.test(c.id))
    .map(c => ({ id: c.id, name: c.name, project: c.project, cards: c.cards.length, updatedAt: c.updatedAt }))
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
}

export function get(id: string): Canvas {
  const c = readJson<Canvas | null>(file(id), null);
  if (!c) throw Object.assign(new Error("No such canvas"), { code: 404 });
  return c;
}

function clean(cards: unknown): Card[] {
  if (!Array.isArray(cards)) return [];
  return cards.slice(0, 60).filter((c: any) => c && TYPES.includes(c.type)).map((c: any) => ({
    id: /^[a-z0-9-]{1,40}$/i.test(String(c.id)) ? String(c.id) : uid("c-"),
    type: c.type, x: num(c.x, -20000, 20000, 0), y: num(c.y, -20000, 20000, 0), w: num(c.w, 220, 1400, 380), h: num(c.h, 160, 1400, 420),
    ref: c.ref == null ? null : str(c.ref, 80), ...(c.type === "note" ? { text: str(c.text, 8000) } : {}),
  }));
}

export function create(input: { name?: string; project?: string | null; cards?: unknown }) {
  if (list().length >= 60) throw new Error("Too many canvases. Delete a few first.");
  const project = input.project && brain.getProject(String(input.project)) ? String(input.project) : null;
  const now = new Date().toISOString();
  const c: Canvas = { id: uid("cv-").toLowerCase().replace(/[^a-z0-9-]/g, ""), name: str(input.name, 40).trim() || "Main canvas", project, cards: clean(input.cards), view: { x: 0, y: 0, z: 1 }, createdAt: now, updatedAt: now };
  writeJson(file(c.id), c);
  return c;
}

export function save(id: string, patch: { name?: string; cards?: unknown; view?: any }) {
  const c = get(id);
  if (patch.name !== undefined) c.name = str(patch.name, 40).trim() || c.name;
  if (patch.cards !== undefined) c.cards = clean(patch.cards);
  if (patch.view) c.view = { x: num(patch.view.x, -50000, 50000, 0), y: num(patch.view.y, -50000, 50000, 0), z: num(patch.view.z, .25, 2, 1) };
  c.updatedAt = new Date().toISOString();
  writeJson(file(id), c);
  return { ok: true, updatedAt: c.updatedAt };
}

export function remove(id: string) { fs.rmSync(file(id), { force: true }); }
