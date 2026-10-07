// PC control for LUTHUR's chat, in three guarded abilities (owner request, 2026-10-07):
//  1. open a web page or search in the owner's own Chrome (new tab, their logins; open only: no clicks, no typing),
//  2. open an app from an allowlist (config pc.apps),
//  3. drive LUTHUR's separate screen browser (browser.ts, shown live on the War Room): read, click, type.
//     Send/post/buy/delete-like clicks and non-search submits need the owner's yes in the chat first.
// The hq-brain MCP runs in another process, so requests arrive as files in data/pc/ and answers go back the same way.
// Only chat runs (the owner talking) may use it; never free mouse/keyboard control of the owner's real desktop.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { DATA, DROP, readJson, uid, writeJson } from "./store.ts";
import { loadConfig } from "./config.ts";
import * as browser from "./browser.ts";

export const PC_DIR = path.join(DATA, "pc");
const err = (m: string) => new Error(m);

// App name → a fixed launch target: a URI handed to explorer.exe, or an executable. Never a shell string.
const DEFAULT_APPS: Record<string, string> = {
  chrome: "chrome", spotify: "spotify:", discord: "discord:", "vs code": "vscode:", vscode: "vscode:",
  "file explorer": "explorer.exe", explorer: "explorer.exe", notepad: "notepad.exe", calculator: "calculator:", steam: "steam://open/main",
};
export function apps(): Record<string, string> {
  const extra = loadConfig().pc?.apps || {};
  const out: Record<string, string> = { ...DEFAULT_APPS };
  for (const [k, v] of Object.entries(extra)) if (typeof v === "string" && v.trim()) out[k.toLowerCase().trim()] = v.trim(); else if (v === false) delete out[k.toLowerCase().trim()];
  return out;
}
const enabled = () => loadConfig().pc?.enabled !== false;

function launch(exe: string, args: string[]) {
  const child = spawn(exe, args, { detached: true, stdio: "ignore", windowsHide: false });
  child.on("error", () => {}); child.unref();
}

export function openInChrome(input: { url?: string; search?: string }): string {
  let url = String(input.url || "").trim();
  if (!url && input.search) url = "https://www.google.com/search?q=" + encodeURIComponent(String(input.search).slice(0, 300));
  if (url && !/^[a-z]+:/i.test(url)) url = "https://" + url;
  if (!/^https?:\/\/[^\s]+$/i.test(url) || url.length > 2000) throw err("Only http/https web addresses (or a search).");
  const exe = browser.findChrome();
  if (!exe) throw err("Chrome isn't installed on this PC.");
  launch(exe, [url]);
  return `Opened in Chrome: ${url}`;
}

export function openApp(name: string): string {
  const key = String(name || "").toLowerCase().trim(), list = apps(), target = list[key];
  if (!target) throw err(`"${name}" isn't on the app list. Allowed: ${Object.keys(list).join(", ")}. The owner can add apps under pc.apps in config/hq.local.json.`);
  if (target === "chrome") { const exe = browser.findChrome(); if (!exe) throw err("Chrome isn't installed."); launch(exe, []); }
  else if (/^[a-z][a-z0-9+.-]*:/i.test(target) && !/^[a-z]:\\/i.test(target)) launch("explorer.exe", [target]);
  else launch(target, []);
  return `Opened ${key}.`;
}

// ---------- LUTHUR's own browser (3) ----------
const RISKY = /\b(send|post|publish|submit|buy|pay|purchase|order|checkout|check out|place order|delete|remove|transfer|withdraw|deposit|confirm|sign up|signup|register|subscribe|unsubscribe|reply|comment|tweet|upload|donate|accept|agree)\b/i;
const MAP = `(()=>{const vis=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};
document.querySelectorAll('[data-luthur]').forEach(e=>e.removeAttribute('data-luthur'));
const els=[...document.querySelectorAll('a[href],button,input:not([type=hidden]),textarea,select,[role=button],[role=link],[role=searchbox],[role=textbox],[contenteditable=true]')].filter(vis).slice(0,150);
const lab=e=>(e.getAttribute('aria-label')||e.innerText||e.placeholder||e.title||(e.tagName==='INPUT'&&/^(submit|button)$/i.test(e.type)?e.value:'')||e.name||'').replace(/\\s+/g,' ').trim().slice(0,80);
return JSON.stringify({url:location.href,title:document.title,text:(document.body&&document.body.innerText||'').slice(0,6000),items:els.map((e,i)=>{e.setAttribute('data-luthur',String(i+1));return {ref:i+1,tag:e.tagName.toLowerCase(),type:(e.type||e.getAttribute('role')||'').toLowerCase(),label:lab(e)}})});})()`;
const find = (ref: number) => `(()=>{const e=document.querySelector('[data-luthur="${ref}"]');if(!e)return JSON.stringify(null);e.scrollIntoView({block:'center'});
const lab=(e.getAttribute('aria-label')||e.innerText||e.placeholder||e.title||e.value||e.name||'').replace(/\\s+/g,' ').trim().slice(0,80);
const f=e.form,sb=f&&f.querySelector('button[type=submit],input[type=submit],button:not([type])');
const search=/search/i.test((e.type||'')+' '+(e.getAttribute('role')||'')+' '+(e.name||'')+' '+(e.placeholder||'')+' '+(e.getAttribute('aria-label')||''))||/^(q|query|s|search_query)$/i.test(e.name||'')||!!(f&&/search/i.test((f.getAttribute('role')||'')+' '+(f.action||'')));
return JSON.stringify({tag:e.tagName.toLowerCase(),type:(e.type||'').toLowerCase(),label:lab,search,submitLabel:sb?(sb.innerText||sb.value||'').trim().slice(0,60):''});})()`;

const ref = (v: unknown) => { const n = Number(v); if (!Number.isInteger(n) || n < 1 || n > 500) throw err("ref must be a number from browser_read."); return n; };
const settle = () => new Promise(r => setTimeout(r, 900));
async function read() { const j = await browser.evaluateJson(MAP); return JSON.stringify(j); }

export async function browserOpen(url: string) { await browser.navigate(/^https?:\/\//i.test(url) ? url : "https://" + url); await settle(); await settle(); return read(); }
export async function browserClick(r: unknown, confirmed: boolean) {
  const n = ref(r), el = await browser.evaluateJson(find(n));
  if (!el) throw err("That element is gone. Call browser_read again.");
  if (RISKY.test(el.label) && !confirmed) throw err(`"${el.label}" looks like a send/post/buy/delete step. Ask the owner in the chat first; call again with owner_confirmed only after they say yes.`);
  await browser.evaluateJson(`(()=>{const e=document.querySelector('[data-luthur="${n}"]');e.focus();e.click();return JSON.stringify(true)})()`);
  await settle(); return read();
}
export async function browserType(r: unknown, text: string, submit: boolean, confirmed: boolean) {
  const n = ref(r), el = await browser.evaluateJson(find(n));
  if (!el) throw err("That element is gone. Call browser_read again.");
  if (el.type === "password") throw err("LUTHUR never types passwords. Ask the owner to type it themselves on the War Room screen.");
  if (/card|cvc|cvv|iban|ssn|account.?number|routing/i.test(el.label)) throw err("LUTHUR never enters payment or ID numbers. The owner types those themselves.");
  if (submit && !el.search && !confirmed) throw err(`Pressing Enter here submits a form${el.submitLabel ? ` ("${el.submitLabel}")` : ""}. Ask the owner first; call again with owner_confirmed only after they say yes.`);
  await browser.evaluateJson(`(()=>{const e=document.querySelector('[data-luthur="${n}"]');e.focus();if('value' in e){e.value='';}else if(e.isContentEditable){e.textContent='';}return JSON.stringify(true)})()`);
  await browser.input({ type: "text", text: String(text || "").slice(0, 2000) });
  if (submit) await browser.input({ type: "key", key: "Enter" });
  await settle(); return read();
}

// ---------- request channel from the hq-brain MCP ----------
async function handle(req: any): Promise<string> {
  if (!enabled()) throw err("PC control is turned off (pc.enabled in config).");
  if (!String(req.fromRun || "").startsWith("chat-") && req.fromRun !== "interactive") throw err("Only LUTHUR's chat with the owner can use PC control.");
  const a = req.args || {}, ok = a.owner_confirmed === true;
  switch (req.op) {
    case "chrome_open": return openInChrome(a);
    case "app_open": return openApp(a.name);
    case "browser_open": {
      const text = await browserOpen(String(a.url || ""));
      // Show it live on the War Room (same page, so the viewer does not reload it: see browser.navigate).
      try { const u = JSON.parse(text).url; if (u) writeJson(path.join(DROP, `${uid("screen-")}.json`), { type: "screen", fromRun: req.fromRun, kind: "url", url: u }); } catch {}
      return text;
    }
    case "browser_read": return read();
    case "browser_click": return browserClick(a.ref, ok);
    case "browser_type": return browserType(a.ref, String(a.text || ""), a.submit === true, ok);
    case "browser_scroll": await browser.input({ type: "wheel", x: 400, y: 300, dy: a.up ? -700 : 700 }); await settle(); return read();
    case "browser_back": await browser.input({ type: "back" }); await settle(); return read();
    default: throw err("Unknown PC action.");
  }
}
let busy = false, timer: NodeJS.Timeout | null = null;
async function poll() {
  if (busy) return; busy = true;
  try {
    const files = fs.existsSync(PC_DIR) ? fs.readdirSync(PC_DIR).filter(f => /^req-[\w-]{1,60}\.json$/.test(f)) : [];
    for (const f of files) {
      const file = path.join(PC_DIR, f), req = readJson<any>(file, null); try { fs.unlinkSync(file); } catch {}
      const out = path.join(PC_DIR, f.replace(/^req-/, "res-"));
      if (!req || Date.now() - Number(req.at || 0) > 60e3) continue;
      try { writeJson(out, { ok: true, text: await handle(req) }); } catch (e: any) { writeJson(out, { ok: false, text: String(e?.message || e) }); }
    }
  } finally { busy = false; }
}
export function startPcControl() { if (!timer) timer = setInterval(() => void poll(), 250); }
