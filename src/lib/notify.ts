// Alerts: Windows toast (bottom-right pop-up) + optional phone push via ntfy.
import { spawn } from "node:child_process";
import { loadConfig } from "./config.ts";
import { phoneUrl } from "./remote.ts";

const xml = (s: string) => s.replace(/[<>&"']/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]!));

export function toast(title: string, body: string, url: string): void {
  if (process.platform !== "win32") return;
  const toastXml = `<toast activationType="protocol" launch="${xml(url)}"><visual><binding template="ToastGeneric"><text>${xml(title)}</text><text>${xml(body.slice(0, 240))}</text></binding></visual></toast>`;
  // Shows as "Windows PowerShell" in Action Center; no extra installs needed.
  const ps = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$x = New-Object Windows.Data.Xml.Dom.XmlDocument
$x.LoadXml([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(toastXml, "utf8").toString("base64")}')))
$t = [Windows.UI.Notifications.ToastNotification]::new($x)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show($t)`;
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", Buffer.from(ps, "utf16le").toString("base64")], { windowsHide: true, stdio: "ignore" });
  child.on("error", () => {});
}

const header = (s: string) => /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;

export async function ntfy(title: string, body: string, opts: { priority?: number; url?: string; tags?: string } = {}): Promise<boolean> {
  const n = loadConfig().notifications?.ntfy;
  if (!n?.enabled || !n.topic) return false;
  try {
    const res = await fetch(`${(n.server || "https://ntfy.sh").replace(/\/$/, "")}/${encodeURIComponent(n.topic)}`, {
      method: "POST",
      headers: { Title: header(title), Priority: String(opts.priority || 3), ...(opts.tags ? { Tags: opts.tags } : {}), ...(opts.url ? { Click: opts.url } : {}) },
      body: n.detail === "full" ? body.slice(0, 1500) : "Open HQ for details.",
      signal: AbortSignal.timeout(10000),
    });
    return res.ok;
  } catch { return false; }
}

export type Alert = { title: string; body: string; priority?: number; tags?: string; phone?: boolean };

export function notify(a: Alert): void {
  const cfg = loadConfig();
  const url = `http://localhost:${cfg.port || 8800}/`;
  if (cfg.notifications?.toast !== false) toast(a.title, a.body, url);
  // Tapping a phone alert opens LUTHUR over Tailscale when phone access is on (remote.ts).
  const click = phoneUrl();
  if (a.phone !== false) void ntfy(a.title, a.body, { priority: a.priority, tags: a.tags, ...(click ? { url: click } : {}) });
}
