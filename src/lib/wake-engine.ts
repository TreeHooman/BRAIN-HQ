// Picovoice Porcupine wake word ("Hey LUTHUR"), run by scripts/pc-wake-pv.exe instead of Windows speech recognition
// when the owner has set it up (owner ask, 2026-10-09). The AccessKey is a secret: it lives only in config/hq.local.json
// (entered by the owner in Settings → Voice), goes to the helper through its environment, and is never sent to the page.
// The owner's keyword file (.ppn, trained in Picovoice Console) is kept in data/wake/. Without either, or after the helper
// fails to start, pc-voice.ts falls back to the Windows listener (pc-wake.exe).
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadConfig, saveLocal } from "./config.ts";
import { DATA } from "./store.ts";

const DIR = path.join(DATA, "wake"), KEYWORD = path.join(DIR, "keyword.ppn");
const EXE = path.resolve("scripts/pc-wake-pv.exe"), LIB = path.resolve("scripts/pv/libpv_porcupine.dll"), MODEL = path.resolve("scripts/pv/porcupine_params.pv");
const conf = () => loadConfig().picovoice || {};
const err = (msg: string, code = 400) => Object.assign(new Error(msg), { code });
let lastError = "", failedAt = 0;

const sens = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : .6; };
const ready = () => ({ key: !!conf().accessKey, keyword: fs.existsSync(KEYWORD), lib: fs.existsSync(EXE) && fs.existsSync(LIB) && fs.existsSync(MODEL) });

/** Safe view for the dashboard: never includes the key. */
export function status() {
  const c = conf(), r = ready();
  return { configured: r.key, keyword: r.keyword, keywordName: c.keywordName || "", lib: r.lib, enabled: c.enabled !== false,
    sensitivity: sens(c.sensitivity), active: usable(), error: lastError, fallback: !!failedAt };
}
/** Use Picovoice for the next listener start? (A start failure falls back to Windows until settings change.) */
export function usable() { const r = ready(); return conf().enabled !== false && r.key && r.keyword && r.lib && !failedAt; }
export function helper(): { exe: string; env: Record<string, string> } {
  const c = conf();
  return { exe: EXE, env: { HQ_PV_KEY: String(c.accessKey || ""), HQ_PV_KEYWORD: KEYWORD, HQ_PV_SENS: String(sens(c.sensitivity)) } };
}
/** pc-voice.ts reports how the helper ended: code 2 = Porcupine couldn't start (bad key, wrong keyword file). */
export function ended(code: number | null, stderr: string) {
  if (code === 2) { failedAt = Date.now(); lastError = clean(stderr) || "Picovoice could not start."; }
  else if (code === 0) lastError = "";
}
const clean = (s: string) => String(s || "").replace(/[A-Za-z0-9+/=]{40,}/g, "[hidden]").trim().slice(0, 400);
const reset = () => { failedAt = 0; lastError = ""; };

export function save(b: any) {
  const patch: any = {};
  if (typeof b.accessKey === "string" && b.accessKey.trim()) {
    const k = b.accessKey.trim();
    if (!/^[A-Za-z0-9+/=_-]{30,200}$/.test(k)) throw err("That doesn't look like a Picovoice AccessKey. Copy it from console.picovoice.ai (the AccessKey box on the home page).");
    patch.accessKey = k;
  }
  if (b.clearKey === true) patch.accessKey = null;
  if (typeof b.enabled === "boolean") patch.enabled = b.enabled;
  if (b.sensitivity !== undefined) patch.sensitivity = sens(b.sensitivity);
  saveLocal({ picovoice: patch }); reset();
  return status();
}
/** The .ppn file from Picovoice Console (Porcupine → your phrase → Windows), sent by the page as base64. */
export function saveKeyword(b: any) {
  const name = String(b?.name || "").slice(0, 120), data = Buffer.from(String(b?.data || ""), "base64");
  if (!/\.ppn$/i.test(name)) throw err("Choose the .ppn file from the zip Picovoice Console gives you (unzip it first).");
  if (!/windows/i.test(name)) throw err("That keyword file isn't the Windows one. In Picovoice Console pick Windows as the platform.");
  if (data.length < 1000 || data.length > 500e3) throw err("That file doesn't look like a Porcupine keyword file.");
  fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(KEYWORD, data);
  saveLocal({ picovoice: { keywordName: name } }); reset();
  return status();
}
/** Starts Porcupine once without the microphone, to prove the key, keyword and library work together. */
export function check() {
  const r = ready();
  if (!r.lib) throw err("The Picovoice files are missing from scripts/pv.");
  if (!r.key || !r.keyword) throw err("Add your AccessKey and the .ppn keyword file first.");
  const h = helper(), out = spawnSync(h.exe, ["--check"], { env: { ...process.env, ...h.env }, windowsHide: true, encoding: "utf8", timeout: 30e3 });
  const text = clean((out.stdout || "") + (out.stderr || ""));
  if (out.status === 0) { reset(); return { ok: true, message: text, status: status() }; }
  failedAt = Date.now(); lastError = text || "Picovoice could not start.";
  return { ok: false, message: lastError, status: status() };
}
