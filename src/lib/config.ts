// Loads config/*.json, merged with config/hq.local.json (private, per-PC overrides).
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { CONFIG, readJson, readText, writeJson } from "./store.ts";

export const LEVELS = ["read", "plan", "build"] as const;
export type Level = (typeof LEVELS)[number];

export function levelRank(l: string): number {
  const i = LEVELS.indexOf(l as Level);
  return i < 0 ? 0 : i;
}
export function minLevel(...ls: (string | undefined | null)[]): Level {
  let best = LEVELS.length - 1;
  for (const l of ls) if (l) best = Math.min(best, levelRank(l));
  return LEVELS[best];
}

function deepMerge(a: any, b: any): any {
  if (Array.isArray(b) || typeof b !== "object" || b === null) return b;
  const out = { ...(a || {}) };
  for (const k of Object.keys(b)) out[k] = deepMerge(out[k], b[k]);
  return out;
}

const LOCAL = path.join(CONFIG, "hq.local.json");

export function ensureLocalConfig(): void {
  const local = readJson<any>(LOCAL, {});
  let changed = false;
  if (!local.notifications?.ntfy?.topic) {
    local.notifications = local.notifications || {};
    local.notifications.ntfy = local.notifications.ntfy || {};
    local.notifications.ntfy.topic = "hq-" + crypto.randomBytes(9).toString("hex");
    changed = true;
  }
  if (changed || !fs.existsSync(LOCAL)) writeJson(LOCAL, local);
}

export function loadConfig(): any {
  return deepMerge(readJson(path.join(CONFIG, "hq.json"), {}), readJson(LOCAL, {}));
}

export function saveLocal(patch: any): void {
  writeJson(LOCAL, deepMerge(readJson(LOCAL, {}), patch));
}

export function budget(cfg = loadConfig()) {
  const b = cfg.budget || {};
  return { preset: b.preset || "light", ...(b.presets?.[b.preset] || { maxRunsPerDay: 6, maxMinutesPerRun: 15, maxFollowupsPerRun: 2 }) };
}

export function loadModels(): any { return readJson(path.join(CONFIG, "models.json"), { tiers: {} }); }

export function modelFor(tier: string): { model: string; fallback?: string } {
  const m = loadModels();
  const t = m.tiers?.[tier] || m.tiers?.balanced || { model: "sonnet" };
  const fbTier = m.fallback?.[tier];
  const fallback = fbTier ? (m.tiers?.[fbTier]?.model || fbTier) : undefined;
  return { model: t.model, fallback };
}

export function loadPermissions(): any { return readJson(path.join(CONFIG, "permissions.json"), { levels: {} }); }
export function loadMcpExtras(): any { return readJson(path.join(CONFIG, "mcp.json"), { mcpServers: {} }); }
export function agentRules(): string { return readText(path.join(CONFIG, "agent-rules.md")); }
