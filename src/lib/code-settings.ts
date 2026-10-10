import { validateChoice } from './model-policy.ts';

export const CODE_DEFAULTS = {
  provider: 'claude', model: 'auto', effort: 'low', adaptive: false,
  reviewSolo: true, permission: 'safe', orchestration: 'direct', maxWorkers: 2,
  maxCalls: 4, maxMinutes: 20, instructions: '',
};
export type CodeSettings = typeof CODE_DEFAULTS;
export function codeSettings(input: Partial<CodeSettings> = {}): CodeSettings {
  const s = { ...CODE_DEFAULTS, ...input };
  const fail = (message: string): never => { throw new Error(message); };
  if (!['claude', 'codex'].includes(s.provider)) fail('Choose Claude or Codex.');
  if (!['read', 'plan', 'safe', 'auto', 'bypass'].includes(s.permission)) fail('Choose a permission level.');
  if (s.provider === 'codex' && s.permission === 'bypass') fail('Codex uses a workspace sandbox. Choose Read, Plan or Workspace edits.');
  if (!['direct', 'managed'].includes(s.orchestration)) fail('Choose one agent or orchestrator.');
  for (const [key, min, max] of [['maxWorkers', 0, 6], ['maxCalls', 1, 8], ['maxMinutes', 1, 120]] as const) {
    if (!Number.isInteger(s[key]) || s[key] < min || s[key] > max) fail(`${key} must be between ${min} and ${max}.`);
  }
  for (const key of ['instructions'] as const) if (typeof s[key] !== 'string' || s[key].length > 20000) fail(`${key} must be text under 20,000 characters.`);
  if (typeof s.reviewSolo !== 'boolean') fail('Review must be on or off.');
  if (typeof s.adaptive !== 'boolean') fail('Adaptive routing must be on or off.');
  validateChoice({ ...s, astraApproved: s.model === 'gpt-6-astra', opusApproved: s.model === 'opus' });
  return Object.fromEntries(Object.keys(CODE_DEFAULTS).map(k => [k, s[k]])) as CodeSettings;
}
