// Dedicated wake word ("Hey LUTHUR") with sherpa-onnx keyword spotting, run by scripts/pc-wake-kws.exe instead of
// Windows speech recognition (owner ask, 2026-10-09; Picovoice was dropped because it needs a company email).
// Fully local: no account, no key. The owner types the wake phrase; it is turned into the model's word pieces here
// (SentencePiece unigram over scripts/sherpa/model/bpe.model) and written to data/wake/keywords.txt.
// If the engine files are missing or it fails to start, pc-voice.ts falls back to the Windows listener (pc-wake.exe).
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadConfig, saveLocal } from "./config.ts";
import { DATA } from "./store.ts";

const DIR = path.join(DATA, "wake"), KEYWORDS = path.join(DIR, "keywords.txt");
const EXE = path.resolve("scripts/pc-wake-kws.exe"), LIBDIR = path.resolve("scripts/sherpa"), MODEL = path.join(LIBDIR, "model");
const FILES = [path.join(LIBDIR, "sherpa-onnx-c-api.dll"), path.join(LIBDIR, "onnxruntime.dll"), path.join(MODEL, "encoder.onnx"), path.join(MODEL, "decoder.onnx"), path.join(MODEL, "joiner.onnx"), path.join(MODEL, "tokens.txt"), path.join(MODEL, "bpe.model")];
const DEFAULT_PHRASE = "hey luther, hey luthor";
const conf = () => loadConfig().wakeWord || {};
const err = (msg: string, code = 400) => Object.assign(new Error(msg), { code });
let lastError = "", failedAt = 0;

const sens = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : .65; }; // 0.5 missed "luthor", 0.8 still ignored brother/mother/leather/"Martin Luther King" (selftest, 2026-10-09)
/** Sensitivity 0..1 → the spotter's threshold (lower threshold = wakes more easily) and boost score. */
const tuning = (s: number) => ({ threshold: (0.4 - 0.3 * s).toFixed(3), score: (1 + s).toFixed(2) });
const phrase = () => String(conf().phrase || DEFAULT_PHRASE);
const libOk = () => fs.existsSync(EXE) && FILES.every(f => fs.existsSync(f));

// ---- SentencePiece unigram tokenizer (enough for the wake phrase) ----
let vocab: Map<string, number> | null = null;
function pieces(): Map<string, number> {
  if (vocab) return vocab;
  const buf = fs.readFileSync(path.join(MODEL, "bpe.model")), out = new Map<string, number>(); let i = 0;
  const varint = () => { let r = 0, s = 0, b: number; do { b = buf[i++]; r += (b & 0x7f) * 2 ** s; s += 7; } while (b & 0x80); return r; };
  // ModelProto field 1 = SentencePiece { 1: piece, 2: score (float), 3: type (1 = normal) }
  while (i < buf.length) {
    const tag = varint(), f = tag >> 3, w = tag & 7;
    if (w === 2) {
      const end = varint() + i;
      if (f === 1) { let p = "", sc = 0, t = 1; while (i < end) { const t2 = varint(), f2 = t2 >> 3, w2 = t2 & 7; if (w2 === 2) { const l = varint(); if (f2 === 1) p = buf.toString("utf8", i, i + l); i += l; } else if (w2 === 5) { if (f2 === 2) sc = buf.readFloatLE(i); i += 4; } else if (w2 === 0) { const v = varint(); if (f2 === 3) t = v; } else if (w2 === 1) i += 8; } if (t === 1) out.set(p, sc); }
      i = end;
    } else if (w === 0) varint(); else if (w === 5) i += 4; else if (w === 1) i += 8; else break;
  }
  return (vocab = out);
}
/** Best-scoring split of "▁HEY▁LUTHER" into the model's pieces (Viterbi), as sentencepiece does. */
export function tokenize(text: string): string | null {
  const score = pieces(), ch = [..."▁" + text.toUpperCase().trim().split(/\s+/).join("▁")], n = ch.length;
  const best = new Array(n + 1).fill(-Infinity), from = new Array(n + 1).fill(-1); best[0] = 0;
  for (let a = 0; a < n; a++) { if (best[a] === -Infinity) continue; for (let b = a + 1; b <= Math.min(n, a + 16); b++) { const s = score.get(ch.slice(a, b).join("")); if (s !== undefined && best[a] + s > best[b]) { best[b] = best[a] + s; from[b] = a; } } }
  if (best[n] === -Infinity) return null;
  const out: string[] = []; for (let b = n; b > 0; b = from[b]) out.unshift(ch.slice(from[b], b).join(""));
  return out.join(" ");
}
const phrases = (p: string) => p.split(/[,;\n]+/).map(x => x.replace(/[^a-z' ]/gi, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
/** Writes data/wake/keywords.txt for the current phrase(s): "<pieces> @HEY_LUTHER" per line. */
function writeKeywords(p = phrase()) {
  const lines = phrases(p).map(x => { const t = tokenize(x); if (!t) throw err(`Couldn't use "${x}" as a wake phrase. Use plain English words.`); return `${t} @${x.toUpperCase().replace(/ /g, "_")}`; });
  if (!lines.length) throw err("Type a wake phrase, for example: hey luther");
  fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(KEYWORDS, lines.join("\n") + "\n");
}

/** Safe view for the dashboard. */
export function status() {
  const c = conf();
  return { phrase: phrase(), lib: libOk(), enabled: c.enabled !== false, sensitivity: sens(c.sensitivity), active: usable(), error: lastError, fallback: !!failedAt };
}
/** Use the dedicated wake word for the next listener start? (A start failure falls back to Windows until settings change.) */
export function usable() { return conf().enabled !== false && libOk() && !failedAt; }
export function helper(): { exe: string; env: Record<string, string> } {
  if (!fs.existsSync(KEYWORDS)) writeKeywords();
  const t = tuning(sens(conf().sensitivity));
  return { exe: EXE, env: { HQ_KWS_KEYWORDS: KEYWORDS, HQ_KWS_THRESHOLD: t.threshold, HQ_KWS_SCORE: t.score } };
}
/** pc-voice.ts reports how the helper ended: code 2 = the spotter couldn't start. */
export function ended(code: number | null, stderr: string) {
  if (code === 2) { failedAt = Date.now(); lastError = clean(stderr) || "The wake word engine could not start."; }
  else if (code === 0) lastError = "";
}
const clean = (s: string) => String(s || "").replace(/\x1b\[[0-9;]*m/g, "").trim().slice(-400);
const reset = () => { failedAt = 0; lastError = ""; };

export function save(b: any) {
  const patch: any = {};
  if (typeof b.phrase === "string") { const p = phrases(b.phrase).slice(0, 4).join(", "); if (!p || p.length > 80) throw err("Use 1-4 short phrases, separated by commas."); if (libOk()) writeKeywords(p); patch.phrase = p; }
  if (typeof b.enabled === "boolean") patch.enabled = b.enabled;
  if (b.sensitivity !== undefined) patch.sensitivity = sens(b.sensitivity);
  saveLocal({ wakeWord: patch }); reset();
  return status();
}
/** Starts the spotter without the microphone and has Windows speak the first wake phrase into it. */
export function check() {
  if (!libOk()) throw err("The wake word engine files are missing from scripts/sherpa.");
  const h = helper(), say = phrases(phrase())[0] || "hey luther";
  const out = spawnSync(h.exe, ["--selftest", say], { env: { ...process.env, ...h.env }, windowsHide: true, encoding: "utf8", timeout: 60e3 });
  const text = clean((out.stdout || "") + "\n" + (out.stderr || "").split(/\r?\n/).filter(l => !/^\s*$/.test(l)).slice(-3).join("\n"));
  if (out.status === 0) { reset(); return { ok: /Heard: (?!nothing)/.test(text), message: text, status: status() }; }
  failedAt = Date.now(); lastError = text || "The wake word engine could not start.";
  return { ok: false, message: lastError, status: status() };
}
