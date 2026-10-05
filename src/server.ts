// HQ server: dashboard + JSON API on localhost only. Start: node src/server.ts
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { WEB, ROOT, readJson } from "./lib/store.ts";
import { ensureLocalConfig, loadConfig, loadModels, saveLocal, budget } from "./lib/config.ts";
import * as brain from "./lib/brain.ts";
import * as orch from "./lib/orchestrator.ts";
import { notify, ntfy } from "./lib/notify.ts";
import { describe } from "./lib/schedule.ts";
import * as cal from "./lib/calendar.ts";
import * as outbox from "./lib/outbox.ts";
import * as code from "./lib/code.ts";

ensureLocalConfig();
const cfg = loadConfig();
const PORT = Number(process.env.HQ_PORT || cfg.port || 8800);
const HOST = cfg.host || "127.0.0.1";

const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json", ".webmanifest": "application/manifest+json" };

function send(res: http.ServerResponse, code: number, body: unknown) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(code, { "Content-Type": typeof body === "string" ? "text/plain; charset=utf-8" : "application/json", "Cache-Control": "no-store" });
  res.end(text);
}
async function body(req: http.IncomingMessage): Promise<any> {
  let raw = "";
  for await (const chunk of req) { raw += chunk; if (raw.length > 2e6) throw new Error("Too large"); }
  return raw ? JSON.parse(raw) : {};
}

function snapshot() {
  const c = loadConfig();
  cal.kick();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return {
    now: new Date().toISOString(),
    projects: brain.listProjects(),
    reminders: brain.listReminders(),
    milestones: brain.listMilestones(),
    inbox: brain.listInbox(),
    goals: brain.listGoals(),
    outbox: outbox.list().filter(x => x.status !== "discarded").slice(0, 60), outboxBusy: outbox.busy(),
    calendar: { feeds: cal.feedStatus(), upcoming: cal.events(today, new Date(today.getTime() + 15 * 864e5)).slice(0, 80) },
    decisions: brain.recentDecisions(30),
    brief: brain.latestBrief(),
    missions: orch.missions().map(m => ({ ...m, scheduleText: describe(m.schedule) })),
    runs: orch.runs(60).map(r => ({ ...r, output: r.output?.slice(0, 4000), prompt: r.prompt.slice(0, 2000) })),
    approvals: orch.approvals().slice(0, 50),
    templates: missionTemplates(),
    activity: orch.recentActivity(40),
    status: { ...orch.status(), awake: orch.awakeOn() },
    settings: {
      port: PORT, budget: c.budget?.preset, budgets: Object.keys(c.budget?.presets || {}), budgetNow: budget(c),
      assistantName: c.assistant?.name || "JARVIS", keepAwake: c.keepAwake, autonomy: c.autonomy?.maxLevel, chatTier: c.chat?.tier,
      ntfy: { enabled: !!c.notifications?.ntfy?.enabled, topic: c.notifications?.ntfy?.topic, server: c.notifications?.ntfy?.server, detail: c.notifications?.ntfy?.detail },
      toast: c.notifications?.toast !== false, models: loadModels(), hqDir: ROOT,
      startup: fs.existsSync(path.join(process.env.APPDATA || "", "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "HQ.lnk")),
    },
  };
}

function missionTemplates(): any[] {
  const dir = path.join(ROOT, "missions", "library");
  try { return fs.readdirSync(dir).filter(f => f.endsWith(".json")).map(f => readJson(path.join(dir, f), null)).filter(Boolean); } catch { return []; }
}

type Handler = (m: RegExpMatchArray, b: any, url: URL) => unknown | Promise<unknown>;
const routes: [string, RegExp, Handler][] = [
  ["GET", /^\/api\/state$/, () => snapshot()],
  ["GET", /^\/api\/project\/([a-z0-9-]+)$/, m => {
    const p = brain.getProject(m[1]); if (!p) throw Object.assign(new Error("Not found"), { code: 404 });
    return { project: p, summary: brain.readDoc(m[1], "summary"), plan: brain.readDoc(m[1], "plan"), log: brain.readDoc(m[1], "log"), decisions: brain.recentDecisions(20, m[1]) };
  }],
  ["POST", /^\/api\/projects$/, (_, b) => brain.createProject(b)],
  ["PUT", /^\/api\/project\/([a-z0-9-]+)$/, (m, b) => brain.updateProject(m[1], b)],
  ["PUT", /^\/api\/project\/([a-z0-9-]+)\/doc\/(summary|plan)$/, (m, b) => { brain.writeDoc(m[1], m[2], String(b.content ?? "")); return { ok: true }; }],
  ["POST", /^\/api\/project\/([a-z0-9-]+)\/log$/, (m, b) => { brain.addLog(m[1], String(b.text || ""), "you"); return { ok: true }; }],

  ["POST", /^\/api\/inbox$/, (_, b) => brain.addInbox(String(b.text || ""), b.project || undefined)],
  ["DELETE", /^\/api\/inbox\/([\w-]+)$/, m => ({ removed: brain.removeInbox([m[1]]) })],
  ["POST", /^\/api\/inbox\/sort$/, () => {
    const m = orch.missions().find(x => x.id === "inbox-sort");
    if (m) return orch.runMissionNow(m.id);
    return orch.enqueue({ title: "Sort inbox", prompt: "File every inbox note into the right place, then remove it from the inbox.", tier: "fast", permission: "plan", priority: 1 }, "manual");
  }],

  ["POST", /^\/api\/reminders$/, (_, b) => brain.addReminder(b)],
  ["PATCH", /^\/api\/reminders\/([\w-]+)$/, (m, b) => b.complete ? brain.completeReminder(m[1]) : brain.updateReminder(m[1], b)],
  ["DELETE", /^\/api\/reminders\/([\w-]+)$/, m => { brain.deleteReminder(m[1]); return { ok: true }; }],
  ["POST", /^\/api\/milestones$/, (_, b) => brain.addMilestone(b)],
  ["PATCH", /^\/api\/milestones\/([\w-]+)$/, (m, b) => brain.updateMilestone(m[1], b)],
  ["DELETE", /^\/api\/milestones\/([\w-]+)$/, m => { brain.deleteMilestone(m[1]); return { ok: true }; }],
  ["POST", /^\/api\/decisions$/, (_, b) => { brain.addDecision(String(b.text || ""), b.project || undefined, b.why || undefined); return { ok: true }; }],

  ["POST", /^\/api\/goals$/, (_, b) => brain.saveGoal(b)],
  ["DELETE", /^\/api\/goals\/([\w-]+)$/, m => { brain.deleteGoal(m[1]); return { ok: true }; }],
  ["PATCH", /^\/api\/goals\/([\w-]+)\/steps\/([\w-]+)$/, (m, b) => brain.setStepDone(m[1], m[2], !!b.done)],
  ["POST", /^\/api\/missions$/, (_, b) => orch.saveMission(b)],
  ["DELETE", /^\/api\/missions\/([\w-]+)$/, m => { orch.deleteMission(m[1]); return { ok: true }; }],
  ["POST", /^\/api\/missions\/([\w-]+)\/run$/, m => orch.runMissionNow(m[1])],
  ["POST", /^\/api\/runs$/, (_, b) => orch.enqueue({ title: b.title, prompt: b.prompt, project: b.project || null, tier: b.tier, permission: b.permission, priority: 1 }, "manual")],
  ["POST", /^\/api\/runs\/([\w-]+)\/cancel$/, m => { orch.cancelRun(m[1]); return { ok: true }; }],
  ["GET", /^\/api\/runs\/([\w-]+)$/, m => orch.getRun(m[1]) || {}],
  ["POST", /^\/api\/approvals\/([\w-]+)$/, (m, b) => orch.decideApproval(m[1], !!b.approve)],

  ["GET", /^\/api\/calendar$/, (_m, _b, url) => {
    const day = (v: string | null, d: Date) => /^\d{4}-\d{2}-\d{2}$/.test(v || "") ? new Date(v + "T00:00") : d;
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const from = day(url.searchParams.get("from"), new Date(now.getTime() - 7 * 864e5));
    let to = day(url.searchParams.get("to"), new Date(now.getTime() + 60 * 864e5));
    if (to.getTime() - from.getTime() > 400 * 864e5) to = new Date(from.getTime() + 400 * 864e5);
    cal.kick();
    return { feeds: cal.feedStatus(), events: cal.events(from, to) };
  }],
  ["POST", /^\/api\/calendar\/feeds$/, (_, b) => cal.addFeed(String(b.name || ""), String(b.url || ""))],
  ["DELETE", /^\/api\/calendar\/feeds\/([\w-]+)$/, m => { cal.removeFeed(m[1]); return { ok: true }; }],
  ["POST", /^\/api\/calendar\/sync$/, async () => { await cal.syncAll(); return { feeds: cal.feedStatus() }; }],
  ["POST", /^\/api\/outbox$/, (_, b) => outbox.add(String(b.kind), b.payload, "you", { project: b.project })],
  ["PUT", /^\/api\/outbox\/([\w-]+)$/, (m, b) => outbox.update(m[1], b.payload)],
  ["DELETE", /^\/api\/outbox\/([\w-]+)$/, m => { outbox.discard(m[1]); return { ok: true }; }],
  ["POST", /^\/api\/outbox\/([\w-]+)\/send$/, m => { outbox.precheck(m[1]); void outbox.send(m[1]).catch(e => outbox.fail(m[1], e?.message)); return { ok: true }; }],
  ["GET", /^\/api\/connectors$/, (_m, _b, url) => outbox.discover(url.searchParams.get("force") === "1")],
  ["POST", /^\/api\/connectors$/, (_, b) => { for (const k of ["email", "calendar"] as const) if (k in b) outbox.setConnector(k, b[k] ? String(b[k]).slice(0, 100) : null); return outbox.discover(); }],

  ["GET", /^\/api\/code$/, () => code.list()],
  ["POST", /^\/api\/code$/, (_, b) => code.create(String(b.project || ""), b.name)],
  ["GET", /^\/api\/code\/([a-z0-9-]+)$/, m => code.get(m[1])],
  ["POST", /^\/api\/code\/([a-z0-9-]+)$/, (m, b) => { code.check(m[1], String(b.text || "")); void code.send(m[1], String(b.text || ""), b.tier, b.effort || null).catch(() => {}); return { ok: true }; }],
  ["PUT", /^\/api\/code\/([a-z0-9-]+)$/, (m, b) => code.rename(m[1], String(b.name || ""))],
  ["POST", /^\/api\/code\/([a-z0-9-]+)\/stop$/, m => { code.stop(m[1]); return { ok: true }; }],
  ["DELETE", /^\/api\/code\/([a-z0-9-]+)$/, m => { code.close(m[1]); return { ok: true }; }],
  ["GET", /^\/api\/tasks$/, () => ({ tasks: orch.tasks(), status: orch.status() })],
  ["POST", /^\/api\/tasks$/, (_, b) => orch.createTask(b)],
  ["POST", /^\/api\/tasks\/([\w-]+)\/reply$/, (m, b) => orch.replyTask(m[1], String(b.text || ""))],
  ["POST", /^\/api\/tasks\/([\w-]+)\/cancel$/, m => { orch.cancelTask(m[1]); return { ok: true }; }],
  ["GET", /^\/api\/live$/, () => orch.liveOps()],
  ["GET", /^\/api\/chat$/, () => orch.chat()],
  ["POST", /^\/api\/chat$/, (_, b) => { void orch.sendChat(String(b.text || ""), { project: b.project, tier: b.tier, effort: b.effort }).catch(() => {}); return { ok: true }; }],
  ["POST", /^\/api\/chat\/new$/, () => { orch.newChat(); return { ok: true }; }],

  ["POST", /^\/api\/settings$/, (_, b) => {
    const patch: any = {};
    if (b.budget) patch.budget = { preset: b.budget };
    if (b.keepAwake) patch.keepAwake = b.keepAwake;
    if (b.autonomy) patch.autonomy = { maxLevel: b.autonomy };
    if (b.chatTier) patch.chat = { tier: b.chatTier };
    if (b.ntfy) patch.notifications = { ntfy: b.ntfy };
    if (typeof b.toast === "boolean") patch.notifications = { ...(patch.notifications || {}), toast: b.toast };
    saveLocal(patch);
    return { ok: true };
  }],
  ["POST", /^\/api\/notify\/test$/, async () => {
    notify({ title: "HQ test", body: "Notifications work.", phone: false });
    const phone = await ntfy("HQ test", "Phone notifications work.", { tags: "white_check_mark" });
    return { ok: true, phone };
  }],
  ["POST", /^\/api\/claude\/retry$/, () => { orch.clearAuth(); return { ok: true }; }],
  ["POST", /^\/api\/pause\/clear$/, () => { orch.clearPause(); return { ok: true }; }],
];

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      // Block cross-site requests: only the dashboard sends this header (custom headers force a CORS preflight we never allow).
      if (req.method !== "GET" && req.headers["x-hq"] !== "1") return send(res, 403, { error: "Missing X-HQ header" });
      if (url.pathname === "/api/search" && req.method === "GET") return send(res, 200, brain.searchBrain(url.searchParams.get("q") || ""));
      for (const [method, re, h] of routes) {
        const m = url.pathname.match(re);
        if (m && req.method === method) return send(res, 200, await h(m, req.method === "GET" ? {} : await body(req), url));
      }
      return send(res, 404, { error: "No such endpoint" });
    }
    let p = decodeURIComponent(url.pathname);
    if (p === "/") p = "/index.html";
    const file = path.normalize(path.join(WEB, p));
    if (!file.startsWith(WEB)) return send(res, 403, "Forbidden");
    fs.readFile(file, (err, data) => {
      if (err) return send(res, 404, "Not found");
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
      res.end(data);
    });
  } catch (e: any) {
    send(res, e?.code === 404 ? 404 : 400, { error: e?.message || String(e) });
  }
});

server.on("error", (e: any) => {
  if (e.code === "EADDRINUSE") { console.log(`HQ is already running on http://localhost:${PORT}`); process.exit(0); }
  throw e;
});
server.listen(PORT, HOST, () => {
  console.log(`HQ running → http://localhost:${PORT}`);
  if (!process.env.HQ_NO_ORCHESTRATOR) orch.start();
  cal.kick();
  outbox.recover();
});
const shutdown = () => { orch.stop(); process.exit(0); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
