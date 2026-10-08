// Phone access from anywhere through Tailscale (docs/AWAY-MODE.md). HQ itself keeps listening on 127.0.0.1 only;
// `tailscale serve` gives it an HTTPS address (https://<pc>.<tailnet>.ts.net) that only the owner's own Tailscale
// devices can reach (never Funnel, never the public internet). HTTPS matters: phones only allow the microphone on
// secure pages. The PIN lock still applies. This module only reads Tailscale's state, except serve() and unserve(),
// which run when the owner presses the button.
import { execFile } from "node:child_process";
import fs from "node:fs";

let bin: string | null | undefined;
function cli(): string | null {
  if (bin !== undefined) return bin;
  const candidates = process.platform === "win32" ? ["C:\\Program Files\\Tailscale\\tailscale.exe", "C:\\Program Files (x86)\\Tailscale\\tailscale.exe"] : ["/usr/bin/tailscale", "/usr/local/bin/tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"];
  bin = candidates.find(f => { try { return fs.statSync(f).isFile(); } catch { return false; } }) || null;
  return bin;
}
function run(args: string[], timeout = 15e3): Promise<{ ok: boolean; out: string }> {
  const b = process.env.HQ_FAKE_TAILSCALE || cli();
  if (!b) return Promise.resolve({ ok: false, out: "Tailscale is not installed" });
  const [file, pre] = b.endsWith(".mjs") ? [process.execPath, [b]] : [b, []];
  return new Promise(res => execFile(file, [...pre, ...args], { timeout, windowsHide: true }, (e, out, err) => res({ ok: !e, out: String(out || err || e?.message || "") })));
}

export type Remote = { installed: boolean; running: boolean; name: string | null; ip: string | null; serving: boolean; url: string | null; checkedAt: number; error?: string };
let cache: Remote | null = null;

/** Tailscale's state and the phone address, cached for a minute. */
export async function status(port: number, fresh = false): Promise<Remote> {
  if (cache && !fresh && Date.now() - cache.checkedAt < 60e3) return cache;
  const r: Remote = { installed: !!(process.env.HQ_FAKE_TAILSCALE || cli()), running: false, name: null, ip: null, serving: false, url: null, checkedAt: Date.now() };
  if (r.installed) {
    const st = await run(["status", "--json"]);
    try {
      const j = JSON.parse(st.out);
      r.running = j.BackendState === "Running";
      r.name = String(j.Self?.DNSName || "").replace(/\.$/, "") || null;
      r.ip = (j.Self?.TailscaleIPs || []).find((x: string) => /^100\./.test(x)) || null;
    } catch { r.error = st.out.slice(0, 200); }
    if (r.running) {
      const sv = await run(["serve", "status", "--json"]);
      try { r.serving = servesPort(JSON.parse(sv.out || "{}"), port); } catch {}
      if (r.serving && r.name) r.url = `https://${r.name}/`;
    }
  }
  cache = r;
  return r;
}
/** Does the serve config proxy HTTPS to this port on this PC? */
export function servesPort(j: any, port: number): boolean {
  for (const host of Object.values<any>(j?.Web || {})) for (const h of Object.values<any>(host?.Handlers || {})) {
    const p = String(h?.Proxy || "");
    if (new RegExp(`^(https?://)?(127\\.0\\.0\\.1|localhost):${port}/?$`).test(p)) return true;
  }
  return false;
}
/** The address phone alerts should open: the Tailscale one when it works, else null (local only). */
export function phoneUrl(): string | null { return cache?.url || null; }

export async function serve(port: number): Promise<Remote> {
  const s = await status(port, true);
  if (!s.installed) throw new Error("Install Tailscale on this PC first (tailscale.com/download), sign in, then press this again.");
  if (!s.running) throw new Error("Tailscale is installed but not signed in or not connected. Open Tailscale, sign in, then press this again.");
  const r = await run(["serve", "--bg", String(port)], 30e3);
  if (!r.ok) throw new Error(/https|cert/i.test(r.out) ? "Tailscale needs HTTPS turned on for your network: open login.tailscale.com/admin/dns, enable HTTPS Certificates, then press this again." : `Tailscale said: ${r.out.slice(0, 200)}`);
  return status(port, true);
}
export async function unserve(port: number): Promise<Remote> {
  await run(["serve", "--https=443", "off"], 30e3);
  return status(port, true);
}
