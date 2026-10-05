// Screen browser: a real Chrome that LUTHUR drives and streams into the Command screen, for sites that refuse to be
// embedded (YouTube, Google, most big sites). Runs headless on this PC with its own profile (data\screen-browser), so
// logins made inside it stay here and never touch the owner's normal Chrome profile.
// Control channel is --remote-debugging-pipe (no network port at all). Frames arrive via Page.startScreencast and are
// served to the dashboard as an MJPEG stream; clicks, scrolls and typing are forwarded as CDP input events.
// It shuts itself down after 10 idle minutes.
import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import type { ServerResponse } from "node:http";
import { DATA } from "./store.ts";

const PROFILE = path.join(DATA, "screen-browser");
const IDLE_MS = 10 * 60e3;
const err = (m: string, code = 400) => Object.assign(new Error(m), { code });

type Pending = { res: (v: any) => void; rej: (e: Error) => void };
const B: {
  proc: ChildProcess | null; starting: Promise<void> | null; id: number; wait: Map<number, Pending>; session: string | null; buf: string;
  frame: Buffer | null; frameN: number; target?: string; dw?: number; dh?: number; top?: number; ih?: number; viewers: Set<ServerResponse>; url: string; title: string; w: number; h: number; lastUse: number; idle: NodeJS.Timeout | null; loading: boolean; error: string;
} = { proc: null, starting: null, id: 0, wait: new Map(), session: null, buf: "", frame: null, frameN: 0, viewers: new Set(), url: "", title: "", w: 1280, h: 760, lastUse: 0, idle: null, loading: false, error: "" };

function findChrome(): string | null {
  if (process.env.HQ_SCREEN_CHROME && fs.existsSync(process.env.HQ_SCREEN_CHROME)) return process.env.HQ_SCREEN_CHROME;
  const c = process.platform === "win32" ? [
    path.join(process.env["PROGRAMFILES"] || "C:\\Program Files", "Google\\Chrome\\Application\\chrome.exe"),
    path.join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Google\\Chrome\\Application\\chrome.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe"),
    path.join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Microsoft\\Edge\\Application\\msedge.exe"),
    path.join(process.env["PROGRAMFILES"] || "C:\\Program Files", "Microsoft\\Edge\\Application\\msedge.exe"),
  ] : process.platform === "darwin" ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]
    : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/opt/pw-browsers/chromium"];
  return c.find(p => p && fs.existsSync(p)) || null;
}

function send(method: string, params: any = {}, session: string | null = B.session): Promise<any> {
  if (!B.proc) return Promise.reject(err("Screen browser isn't running."));
  const id = ++B.id, msg: any = { id, method, params }; if (session) msg.sessionId = session;
  return new Promise((res, rej) => {
    B.wait.set(id, { res, rej });
    try { (B.proc!.stdio[3] as NodeJS.WritableStream).write(JSON.stringify(msg) + "\0"); } catch { B.wait.delete(id); return rej(err("Screen browser closed.")); }
    setTimeout(() => { if (B.wait.delete(id)) rej(err(`Browser didn't answer (${method}).`)); }, 20e3);
  });
}
function onMessage(m: any) {
  if (m.id && B.wait.has(m.id)) { const p = B.wait.get(m.id)!; B.wait.delete(m.id); m.error ? p.rej(err(m.error.message || "Browser error")) : p.res(m.result); return; }
  if (m.method === "Page.screencastFrame" && m.sessionId === B.session) {
    B.frame = Buffer.from(m.params.data, "base64"); B.frameN++;
    const md = m.params.metadata || {}; B.dw = md.deviceWidth || B.w; B.dh = md.deviceHeight || B.h; B.top = md.offsetTop || 0;
    send("Page.screencastFrameAck", { sessionId: m.params.sessionId }).catch(() => {});
    for (const v of B.viewers) pushFrame(v);
  } else if (m.method === "Page.frameNavigated" && !m.params.frame.parentId) B.url = m.params.frame.url;
  else if (m.method === "Page.loadEventFired") { B.loading = false; refreshTitle(); }
  else if (m.method === "Page.frameStartedLoading") B.loading = true;
  else if (m.method === "Target.targetInfoChanged" && m.params.targetInfo.type === "page") { B.title = m.params.targetInfo.title || B.title; B.url = m.params.targetInfo.url || B.url; }
  else if (m.method === "Target.targetCreated" && m.params.targetInfo.type === "page" && m.params.targetInfo.openerId) {
    // a site opened a new tab/window: show it in the same screen instead
    const u = m.params.targetInfo.url; send("Target.closeTarget", { targetId: m.params.targetInfo.targetId }, null).catch(() => {});
    if (/^https?:/.test(u)) navigate(u).catch(() => {});
  }
}
async function refreshTitle() { try { const r = await send("Runtime.evaluate", { expression: "document.title", returnByValue: true }); B.title = String(r?.result?.value || B.title).slice(0, 200); } catch {} }

async function start() {
  if (B.proc) return;
  if (B.starting) return B.starting;
  B.starting = (async () => {
    const exe = findChrome(); if (!exe) throw err("Chrome or Edge isn't installed on this PC.");
    fs.mkdirSync(PROFILE, { recursive: true });
    const proc = spawn(exe, ["--headless=new", "--remote-debugging-pipe", `--user-data-dir=${PROFILE}`, "--no-first-run", "--no-default-browser-check", "--disable-extensions",
      "--disable-background-networking", "--disable-sync", "--metrics-recording-only", "--password-store=basic", "--autoplay-policy=no-user-gesture-required", `--window-size=${B.w},${B.h}`,
      ...(process.platform === "linux" && process.getuid?.() === 0 ? ["--no-sandbox"] : []), "about:blank"], // Chrome refuses to run as root without it (containers)
      { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"], windowsHide: true });
    B.proc = proc; B.buf = ""; B.session = null;
    proc.on("exit", () => { B.proc = null; B.session = null; for (const [, p] of B.wait) p.rej(err("Screen browser closed.")); B.wait.clear(); });
    proc.on("error", e => { B.error = e.message; });
    // a dying browser must never take HQ down with it
    for (const i of [2, 3, 4]) (proc.stdio[i] as any)?.on("error", () => {});
    (proc.stdio[2] as NodeJS.ReadableStream).on("data", (d: Buffer) => { B.error = (B.error + d.toString("utf8")).slice(-2000); });
    (proc.stdio[4] as NodeJS.ReadableStream).on("data", (d: Buffer) => {
      B.buf += d.toString("utf8"); let i;
      while ((i = B.buf.indexOf("\0")) >= 0) { const s = B.buf.slice(0, i); B.buf = B.buf.slice(i + 1); try { onMessage(JSON.parse(s)); } catch {} }
    });
    await new Promise(r => setTimeout(r, 300));
    if (!B.proc) throw err("Chrome didn't start: " + B.error.split("\n").filter(Boolean).slice(-2).join(" ").slice(0, 300));
    await send("Target.setDiscoverTargets", { discover: true }, null);
    const { targetInfos } = await send("Target.getTargets", {}, null);
    let page = targetInfos.find((t: any) => t.type === "page");
    if (!page) page = { targetId: (await send("Target.createTarget", { url: "about:blank" }, null)).targetId };
    B.session = (await send("Target.attachToTarget", { targetId: page.targetId, flatten: true }, null)).sessionId;
    await send("Page.enable"); await send("Runtime.enable").catch(() => {});
    B.target = page.targetId; await sizeWindow();
    await send("Page.startScreencast", { format: "jpeg", quality: 72, maxWidth: 2560, maxHeight: 1600, everyNthFrame: 1 });
  })().finally(() => { B.starting = null; });
  return B.starting;
}
function touch() {
  B.lastUse = Date.now();
  if (B.idle) clearTimeout(B.idle);
  B.idle = setTimeout(() => { if (Date.now() - B.lastUse >= IDLE_MS && !B.viewers.size) stop(); else touch(); }, IDLE_MS);
}
export function stop() { try { B.proc?.kill(); } catch {} B.proc = null; B.session = null; B.frame = null; for (const v of B.viewers) { try { v.end(); } catch {} } B.viewers.clear(); return { ok: true }; }

// A still page paints nothing new after a resize: take one picture so viewers get the new size right away.
async function snap() {
  try {
    const r = await send("Page.captureScreenshot", { format: "jpeg", quality: 72 });
    B.frame = Buffer.from(r.data, "base64"); B.dw = B.w; B.dh = B.ih || B.h; B.top = 0;
    for (const v of B.viewers) pushFrame(v);
  } catch {}
}
export async function navigate(raw: string) {
  const u = String(raw || "").trim();
  if (!/^https?:\/\//i.test(u)) throw err("Only http/https pages.");
  await start(); touch();
  B.url = u; B.loading = true;
  await send("Page.navigate", { url: u });
  return state();
}
/** What's on the page right now, as text (for "brief me"). */
export async function text() {
  if (!B.proc) throw err("Nothing open in the screen browser.");
  const r = await send("Runtime.evaluate", { expression: "JSON.stringify({t:document.title,x:(document.body&&document.body.innerText||'').slice(0,15000)})", returnByValue: true });
  const j = JSON.parse(r?.result?.value || "{}"); return { url: B.url, title: String(j.t || B.title).slice(0, 200), text: String(j.x || "") };
}
export async function stateFresh() { if (B.proc && B.session) await refreshTitle(); return state(); }
export function state() { return { running: !!B.proc, url: B.url, title: B.title, loading: B.loading, w: B.w, h: B.h, frames: B.frameN, viewers: B.viewers.size, dw: B.dw || B.w, dh: B.dh || B.h, top: B.top || 0 }; }

/** Viewer size → browser viewport (keeps the stream sharp and clicks exact). */
// The real window size (not device emulation) so pages lay out, paint and stream at exactly the viewer's size.
async function sizeWindow() {
  try {
    const { windowId } = await send("Browser.getWindowForTarget", { targetId: B.target }, null);
    await send("Emulation.clearDeviceMetricsOverride").catch(() => {});
    const tw = B.w, th = B.h;
    let w = tw, h = th;
    for (let i = 0; i < 2; i++) { // window bounds include a frame: measure the real viewport and correct once
      await send("Browser.setWindowBounds", { windowId, bounds: { width: w, height: h } }, null);
      const r = await send("Runtime.evaluate", { expression: "[innerWidth,innerHeight]", returnByValue: true });
      const [iw, ih] = r?.result?.value || [B.w, B.h];
      B.ih = ih;
      if (Math.abs(iw - tw) <= 1 && Math.abs(ih - th) <= 1) break;
      w += tw - iw; h += th - ih;
    }
  } catch {
    await send("Emulation.setDeviceMetricsOverride", { width: B.w, height: B.h, deviceScaleFactor: 1, mobile: false }).catch(() => {});
  }
}
export async function resize(w: number, h: number) {
  B.w = Math.max(360, Math.min(1920, Math.round(w) || 1280)); B.h = Math.max(300, Math.min(1200, Math.round(h) || 760));
  if (!B.proc) return state();
  await sizeWindow();
  await send("Page.stopScreencast").catch(() => {});
  await send("Page.startScreencast", { format: "jpeg", quality: 72, maxWidth: 2560, maxHeight: 1600, everyNthFrame: 1 });
  await snap();
  return state();
}

const KEYS: Record<string, [number, string]> = { Enter: [13, "\r"], Backspace: [8, ""], Tab: [9, ""], Escape: [27, ""], Delete: [46, ""], ArrowLeft: [37, ""], ArrowUp: [38, ""], ArrowRight: [39, ""], ArrowDown: [40, ""], Home: [36, ""], End: [35, ""], PageUp: [33, ""], PageDown: [34, ""], " ": [32, " "] };
/** One input event from the dashboard: click, move, wheel, text or key. Coordinates are in viewport pixels. */
export async function input(e: any) {
  if (!B.proc) throw err("Screen browser isn't running.");
  touch();
  const x = Math.max(0, Math.min(B.w, Number(e.x) || 0)), y = Math.max(0, Math.min(B.h, Number(e.y) || 0));
  const mods = (e.alt ? 1 : 0) | (e.ctrl ? 2 : 0) | (e.meta ? 4 : 0) | (e.shift ? 8 : 0);
  switch (e.type) {
    case "click": for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1, modifiers: mods }); break;
    case "move": await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }); break;
    case "wheel": await send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: Math.max(-3000, Math.min(3000, Number(e.dx) || 0)), deltaY: Math.max(-3000, Math.min(3000, Number(e.dy) || 0)) }); break;
    case "text": { const t = String(e.text || "").slice(0, 5000); if (t) await send("Input.insertText", { text: t }); break; }
    case "key": {
      const k = String(e.key || ""), m = KEYS[k];
      if (!m) break;
      await send("Input.dispatchKeyEvent", { type: m[1] ? "keyDown" : "rawKeyDown", key: k, code: k, windowsVirtualKeyCode: m[0], text: m[1] || undefined, modifiers: mods });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: k, windowsVirtualKeyCode: m[0], modifiers: mods });
      break;
    }
    case "back": await send("Runtime.evaluate", { expression: "history.back()" }); break;
    case "forward": await send("Runtime.evaluate", { expression: "history.forward()" }); break;
    case "reload": await send("Page.reload", {}); break;
    default: throw err("Unknown input.");
  }
  return { ok: true };
}

function pushFrame(res: ServerResponse) {
  if (!B.frame) return;
  // each part is closed by the NEXT boundary right away, so browsers show a still page's frame immediately
  try { res.write(`Content-Type: image/jpeg\r\nContent-Length: ${B.frame.length}\r\n\r\n`); res.write(B.frame); res.write("\r\n--frame\r\n"); } catch {}
}
/** MJPEG stream (an <img> shows it live). Max 4 viewers. */
export function stream(res: ServerResponse) {
  if (B.viewers.size >= 4) { const old = B.viewers.values().next().value!; B.viewers.delete(old); try { old.end(); } catch {} } // newest viewer wins
  res.writeHead(200, { "Content-Type": "multipart/x-mixed-replace; boundary=frame", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", Connection: "close" });
  res.write("--frame\r\n");
  B.viewers.add(res); touch(); pushFrame(res); pushFrame(res); // twice: some browsers only paint a part once the next one starts
  res.on("close", () => { B.viewers.delete(res); });
}
