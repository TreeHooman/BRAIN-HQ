// One-click updates from GitHub. Checks the newest commit on the configured repo + branch, downloads that exact commit
// as a zip, and hands it to scripts/UPDATE-HQ.ps1 (backup, stop, copy, restart). brain\, data\ and config\hq.local.json
// are never touched. The GitHub key (fine-grained, read-only, one repo) lives only in config/hq.local.json and never
// leaves the server.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { ROOT, DATA, readJson } from "./store.ts";
import { loadConfig, saveLocal } from "./config.ts";

const DEF = { repo: "treehooman/brain-hq", branch: "claude/relaxed-turing-tnsbre" };
const VFILE = path.join(DATA, "version.json");
const REPO_RE = /^[\w.-]{1,100}\/[\w.-]{1,100}$/;
const BRANCH_RE = /^(?!.*\.\.)[\w./-]{1,120}$/;
const TOKEN_RE = /^(github_pat_[A-Za-z0-9_]{20,255}|gh[pousr]_[A-Za-z0-9]{20,255})$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const MAX_ZIP = 80 * 1024 * 1024;

type Latest = { sha: string; msg: string; date: string };
const st: { latest?: Latest; behind?: number; notes?: string[]; checkedAt?: number; error?: string; busy?: string; startedAt?: number } = {};
const ULOG = path.join(DATA, "update.log"), LLOG = path.join(DATA, "update-launch.log");
const tail = (f: string) => { try { return fs.readFileSync(f, "utf8").replace(/\0/g, "").slice(-1500); } catch { return ""; } };
const mtime = (f: string) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
// If the installer hasn't written its log ~25 s after starting, it didn't run: stop showing "Installing…" and say why.
function watchdog() {
  if (!st.busy || !st.startedAt || Date.now() - st.startedAt < 25e3) return;
  if (mtime(ULOG) >= st.startedAt) { if (Date.now() - st.startedAt > 120e3) { st.busy = ""; st.error = "Update stopped partway. Details below."; } return; }
  st.busy = ""; st.error = "The installer didn't start. Details below.";
}

function settings() {
  const u = loadConfig().update || {};
  return {
    repo: REPO_RE.test(u.repo || "") ? u.repo : DEF.repo,
    branch: BRANCH_RE.test(u.branch || "") ? u.branch : DEF.branch,
    token: TOKEN_RE.test(u.token || "") ? String(u.token) : "",
  };
}
const installed = (): { sha?: string; at?: string } => readJson(VFILE, {});

function gh(p: string, token: string) {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "HQ-updater", "X-GitHub-Api-Version": "2022-11-28" };
  if (token) headers.Authorization = "Bearer " + token;
  return fetch("https://api.github.com" + p, { headers, signal: AbortSignal.timeout(20000) });
}
function ghError(code: number, repo: string, token: string) {
  if (code === 401) return "GitHub key is wrong or expired. Make a new one and save it.";
  if (code === 403) return "GitHub refused (rate limit or the key lacks Contents: Read). Try again later or check the key.";
  if (code === 404) return token ? `The key can't see ${repo}. Give it access to that repo.` : `${repo} is private: save a GitHub key first.`;
  return "GitHub error " + code;
}

export function status() {
  watchdog();
  const s = settings(), v = installed();
  const available = !!st.latest && st.latest.sha !== v.sha;
  return { repo: s.repo, branch: s.branch, hasToken: !!s.token, installed: v, latest: st.latest || null, available, behind: st.behind ?? null, notes: st.notes || [], checkedAt: st.checkedAt || 0, error: st.error || "", busy: st.busy || "", canApply: process.platform === "win32", log: st.error && st.startedAt ? (tail(LLOG) + "\n" + tail(ULOG)).trim().slice(-2500) : "" };
}

export async function check(fresh = false) {
  if (!fresh && st.checkedAt && Date.now() - st.checkedAt < 15 * 60e3) return status();
  const s = settings();
  st.checkedAt = Date.now(); st.error = "";
  try {
    const r = await gh(`/repos/${s.repo}/commits/${encodeURIComponent(s.branch)}`, s.token);
    if (!r.ok) { st.error = ghError(r.status, s.repo, s.token); return status(); }
    const j: any = await r.json();
    if (!SHA_RE.test(j?.sha || "")) { st.error = "GitHub sent an unexpected answer"; return status(); }
    st.latest = { sha: j.sha, msg: String(j.commit?.message || "").split("\n")[0].slice(0, 200), date: String(j.commit?.committer?.date || "") };
    st.behind = undefined; st.notes = [];
    const v = installed();
    if (v.sha && SHA_RE.test(v.sha) && v.sha !== j.sha) {
      const c = await gh(`/repos/${s.repo}/compare/${v.sha}...${j.sha}`, s.token).catch(() => null);
      if (c?.ok) {
        const cj: any = await c.json();
        st.behind = Number(cj.ahead_by) || 0;
        st.notes = (cj.commits || []).slice(-15).reverse().map((x: any) => String(x.commit?.message || "").split("\n")[0].slice(0, 160));
      }
    } else if (v.sha === j.sha) st.behind = 0;
  } catch (e: any) { st.error = "Can't reach GitHub (" + (e?.name === "TimeoutError" ? "timed out" : "offline?") + ")"; }
  return status();
}

export function saveSettings(b: any) {
  const patch: any = {};
  if (b.token !== undefined) {
    const t = String(b.token || "").trim();
    if (t && !TOKEN_RE.test(t)) throw new Error("That doesn't look like a GitHub key (starts with github_pat_)");
    patch.token = t;
  }
  if (b.repo !== undefined) { if (!REPO_RE.test(String(b.repo))) throw new Error("Repo must look like owner/name"); patch.repo = String(b.repo); }
  if (b.branch !== undefined) { if (!BRANCH_RE.test(String(b.branch))) throw new Error("Bad branch name"); patch.branch = String(b.branch); }
  saveLocal({ update: patch });
  st.checkedAt = 0; st.latest = undefined; st.error = "";
  return check(true);
}

/** Downloads the checked commit and starts the installer. HQ stops a few seconds later and comes back on the new version. */
export async function apply(sha: string) {
  if (process.platform !== "win32") throw new Error("One-click update works on the Windows PC only");
  if (st.busy) throw new Error("Already updating");
  if (!SHA_RE.test(sha) || sha !== st.latest?.sha) throw new Error("Check for updates first");
  const s = settings();
  st.busy = "Downloading…";
  try {
    const r = await fetch(`https://api.github.com/repos/${s.repo}/zipball/${sha}`, { headers: { "User-Agent": "HQ-updater", Accept: "application/vnd.github+json", ...(s.token ? { Authorization: "Bearer " + s.token } : {}) }, redirect: "follow", signal: AbortSignal.timeout(180000) });
    if (!r.ok) throw new Error(ghError(r.status, s.repo, s.token));
    if (Number(r.headers.get("content-length") || 0) > MAX_ZIP) throw new Error("Update is unexpectedly large");
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX_ZIP || buf.length < 1000 || buf[0] !== 0x50 || buf[1] !== 0x4b) throw new Error("Download isn't a valid zip");
    const zip = path.join(os.tmpdir(), `hq-update-${sha.slice(0, 12)}.zip`);
    fs.writeFileSync(zip, buf);
    // Run a copy of the installer from %TEMP% (it overwrites scripts\ while it runs), through a tiny .cmd started with
    // "start": the installer then isn't in HQ's process tree, so stopping HQ doesn't stop it. Its console output
    // (including any error before its own log starts) goes to data\update-launch.log.
    const tmpPs1 = path.join(os.tmpdir(), "hq-update.ps1"), launcher = path.join(os.tmpdir(), "hq-update.cmd");
    fs.copyFileSync(path.join(ROOT, "scripts", "UPDATE-HQ.ps1"), tmpPs1);
    fs.writeFileSync(launcher, `@echo off\r\npowershell -NoProfile -ExecutionPolicy Bypass -File "${tmpPs1}" -Zip "${zip}" -Sha ${sha} -HqPid ${process.pid} -Root "${ROOT}" > "${LLOG}" 2>&1\r\n`);
    try { fs.rmSync(ULOG, { force: true }); } catch {}
    st.startedAt = Date.now(); st.error = "";
    spawn("cmd.exe", ["/d", "/c", `start "" /min "${launcher}"`], { detached: true, stdio: "ignore", windowsHide: true, windowsVerbatimArguments: true }).unref();
    st.busy = "Installing… HQ restarts in a few seconds";
    return status();
  } catch (e) { st.busy = ""; throw e; }
}
