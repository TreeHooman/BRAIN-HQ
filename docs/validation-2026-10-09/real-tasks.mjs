// Representative tasks with the REAL model CLI, on a COPY of HQ (make-copy.mjs). Judges result quality, not just plumbing.
//   cd <copy> && node --no-warnings <HQ>/docs/validation-2026-10-09/real-tasks.mjs [filter]
// Each task gets its own throwaway project (qa-r1…) so plans can run in parallel. Writes ../real-results.json.
import fs from 'node:fs'; import path from 'node:path'; import assert from 'node:assert/strict'; import { spawn, spawnSync } from 'node:child_process';
const root = process.cwd(), PORT = 18892, delay = ms => new Promise(r => setTimeout(r, ms)), only = process.argv[2] ? new RegExp(process.argv[2], 'i') : null;
if (/Project Secrets[\\/]HQ$/.test(root) || process.env.HQ_FAKE_CLAUDE) throw Error('Run on a COPY, with the real CLI');
const J = p => path.join(root, p), readJ = (p, d) => { try { return JSON.parse(fs.readFileSync(J(p), 'utf8')); } catch { return d; } };
const write = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof v === 'string' ? v : JSON.stringify(v, null, 2)); };
const work = path.join(path.dirname(root), 'real-work');
const mk = (slug, name, folder) => write(J(`brain/projects/${slug}/project.json`), { name, kind: 'product', stage: 'building', health: 'good', summary: `${name}: throwaway project for LUTHUR's acceptance tests.`, nextStep: 'Run the test', updated: '2026-10-09', paths: folder ? [folder] : [], maxPermission: folder ? 'build' : 'plan' });
fs.rmSync(work, { recursive: true, force: true });
const code = path.join(work, 'slug-lib'); fs.mkdirSync(code, { recursive: true });
write(path.join(code, 'package.json'), { name: 'slug-lib', version: '1.0.0', type: 'commonjs', scripts: { test: 'node --test' } });
write(path.join(code, 'util.js'), "// Turns a title into a URL slug.\nfunction slugify(text) {\n  return text.replace(' ', '-');\n}\nmodule.exports = { slugify };\n");
write(path.join(code, 'util.test.js'), "const test = require('node:test');\nconst assert = require('node:assert');\nconst { slugify } = require('./util.js');\ntest('single space', () => assert.equal(slugify('a b'), 'a-b'));\n");
for (const [s, n, f] of [['qa-r1', 'QA Research', null], ['qa-r2', 'QA Slug Lib', code], ['qa-r3', 'QA Brain', null], ['qa-r4', 'QA Draft', null], ['qa-r5', 'QA Notes DB', null], ['qa-r6', 'QA Pricing', null]]) mk(s, n, f);
write(J('brain/projects/qa-r3/log.md'), '# Log\n');
// QA_WEB=1: in THIS COPY only, allow WebSearch/WebFetch at read/plan (the live config denies them; owner decision).
if (process.env.QA_WEB === '1') { const pm = readJ('config/permissions.json', {}); for (const l of ['read', 'plan']) pm.levels[l].allow = [...new Set([...(pm.levels[l].allow || []), 'WebSearch', 'WebFetch'])]; write(J('config/permissions.json'), pm); }
const local = readJ('config/hq.local.json', {});
write(J('config/hq.local.json'), { ...local, l4: { fastpath: true, intake: true, plans: true, retries: true, review: true, signals: false, projectState: true }, tasks: { maxParallel: 3 } });

let server, ck = '';
const api = async (p, body, method) => { const r = await fetch(`http://127.0.0.1:${PORT}/api${p}`, { method: method || (body ? 'POST' : 'GET'), headers: { 'X-HQ': '1', 'Content-Type': 'application/json', Cookie: ck }, body: body ? JSON.stringify(body) : undefined }); const j = await r.json().catch(() => ({})); if (!r.ok) throw Error(JSON.stringify(j)); return j; };
const until = async (fn, ms, what) => { const end = Date.now() + ms; while (Date.now() < end) { try { const x = await fn(); if (x) return x; } catch {} await delay(2000); } throw Error('Timed out: ' + what); };
const settled = id => until(async () => { const p = await api(`/plans/${id}`); return ['completed', 'needs-verification', 'failed', 'cancelled'].includes(p.status) ? p : null; }, 40 * 60e3, 'plan ' + id);
const out = [];
const task = async (name, fn) => {
  if (only && !only.test(name)) return; const t = Date.now();
  try { const d = await fn(); out.push({ name, ok: true, min: +((Date.now() - t) / 6e4).toFixed(1), ...d }); }
  catch (e) { out.push({ name, ok: false, min: +((Date.now() - t) / 6e4).toFixed(1), error: String(e.stack || e).slice(0, 1200) }); }
  console.log(JSON.stringify(out.at(-1)).slice(0, 1500));
};
const summary = p => ({ plan: p.id, status: p.status, steps: p.steps.map(s => ({ id: s.id, title: s.title, kind: s.kind, status: s.status, repairs: s.repairs, evidence: s.evidence, review: s.review_, note: s.note })), usage: p.usage, report: p.report });
const go = async (text, project, extra = {}) => { const b = await api('/briefs', { text, project }); if (Object.keys(extra).length) await api(`/briefs/${b.id}`, extra, 'PATCH'); const r = await api(`/briefs/${b.id}/go`, { useDefaults: true }); return { brief: b, planId: r.planId }; };

try {
  server = spawn(process.execPath, ['--no-warnings', 'src/server.ts'], { cwd: root, env: { ...process.env, HQ_PORT: String(PORT), HQ_NO_WATCH: '1' }, windowsHide: true, stdio: 'ignore' });
  await until(async () => { const r = await fetch(`http://127.0.0.1:${PORT}/api/access/unlock`, { method: 'POST', headers: { 'X-HQ': '1', 'Content-Type': 'application/json' }, body: '{"pin":"4321"}' }); ck = (r.headers.get('set-cookie') || '').split(';')[0]; return r.ok; }, 60000, 'server');
  await api('/initiative/settings', { enabled: false });
  // Three plans in parallel (different projects), then the rest.
  const jobs = [
    task('R1 research with sources', async () => {
      const { brief, planId } = await go('Research three widely used open-source libraries for running scheduled/recurring background jobs in a Node.js app, compare them on maturity, persistence across restarts and Windows support, and recommend one for a small local single-user app. Cite sources.', 'qa-r1');
      const p = await settled(planId); const rep = p.report && fs.existsSync(J(p.report)) ? fs.readFileSync(J(p.report), 'utf8') : '';
      return { brief: { title: brief.title, questions: brief.questions.length, criteria: brief.successCriteria }, ...summary(p), urls: new Set(rep.match(/https?:\/\/[^\s)>\]]+/g) || []).size, reportChars: rep.length };
    }),
    task('R2 code fix with tests (build)', async () => {
      const { planId } = await go('In the QA Slug Lib project folder, fix slugify in util.js: lowercase, trim, replace every run of characters that are not a-z or 0-9 with a single hyphen, and strip leading/trailing hyphens. Add tests in util.test.js for those cases. npm test must pass.', 'qa-r2', { permission: 'build' });
      const p = await settled(planId);
      const own = spawnSync(process.execPath, ['-e', "const {slugify}=require('./util.js');const a=require('assert');a.equal(slugify('  Hello, World!  '),'hello-world');a.equal(slugify('--A__b--'),'a-b');a.equal(slugify('Ünïcode & 2024'),'n-code-2024'.replace('n-code','n-code'))||1;console.log('hidden ok')"], { cwd: code, encoding: 'utf8' });
      const npm = spawnSync('npm test --silent', { cwd: code, shell: true, encoding: 'utf8' });
      return { ...summary(p), hiddenTest: (own.stdout + own.stderr).trim().slice(0, 300), npmTest: npm.status, util: fs.readFileSync(path.join(code, 'util.js'), 'utf8').slice(0, 600) };
    }),
    task('R3 brain update', async () => {
      const { planId } = await go("For the QA Brain project: record the decision that machine data will move to node:sqlite while the brain stays markdown (reason: scale), add a dated log entry about it, and set the project's next step to 'Prototype the sqlite store'.", 'qa-r3');
      const p = await settled(planId); const proj = readJ('brain/projects/qa-r3/project.json', {});
      const dec = fs.readFileSync(J('brain/decisions.md'), 'utf8'); const log = fs.readFileSync(J('brain/projects/qa-r3/log.md'), 'utf8');
      return { ...summary(p), nextStep: proj.nextStep, decisionSaved: /sqlite/i.test(dec.slice(-3000)), logSaved: /sqlite/i.test(log) };
    }),
  ];
  await Promise.all(jobs);
  await Promise.all([
    task('R4 email draft (Outbox only)', async () => {
      const { planId } = await go('Draft a short, polite email to sam@example.com asking for the October invoice for the QA Draft project. Do not send it.', 'qa-r4');
      const p = await settled(planId); const ob = readJ('data/outbox.json', []).filter(x => /invoice/i.test(JSON.stringify(x.payload)));
      return { ...summary(p), drafts: ob.map(x => ({ status: x.status, to: x.payload.to, subject: x.payload.subject, body: String(x.payload.body).slice(0, 300) })) };
    }),
    task('R6 decision only the owner can make', async () => {
      const { planId } = await go('For the QA Pricing project, prepare a recommendation on whether to charge $9 or $19 per month for the pro plan. The final price is my call: before writing the final recommendation, ask me which one I prefer.', 'qa-r6');
      const q = await until(async () => (await api('/work')).questions.find(x => x.planId === planId) || ((await api(`/plans/${planId}`)).status !== 'running' ? 'settled-without-question' : null), 20 * 60e3, 'question');
      if (q === 'settled-without-question') { const p = await api(`/plans/${planId}`); return { asked: false, ...summary(p) }; }
      await api(`/questions/${q.id}/answer`, { answer: '$19, with a 14-day trial' });
      const p = await settled(planId); const rep = p.report && fs.existsSync(J(p.report)) ? fs.readFileSync(J(p.report), 'utf8') : '';
      return { asked: true, question: { blocked: q.blocked, recommendation: q.recommendation, needed: q.needed }, ...summary(p), usesAnswer: /\$19/.test(rep) && /trial/i.test(rep) };
    }),
    task('R5 vague request by chat → brief → go', async () => {
      await api('/chat/new', {});
      const say = async text => { const n = (await api('/chat')).messages.length; await api('/chat', { text, project: 'qa-r5' }); return until(async () => { const c = await api('/chat'); return !c.busy && c.messages.length >= n + 2 ? c : null; }, 5 * 60e3, 'chat'); };
      const c1 = await say("I keep losing track of my project notes. Can you work out what it would take to move LUTHUR's project notes into a proper database, and plan it out for me? Don't build anything yet.");
      const w = await api('/work'); const b = w.brief;
      const reply1 = c1.messages.at(-1).text.slice(0, 1200);
      if (!b) return { briefCreated: false, reply1 };
      const c2 = await say('go anyway');
      const planId = (await api('/work')).briefs.find(x => x.id === b.id)?.planId;
      const p = planId?.startsWith('pl') ? await settled(planId) : null;
      return { briefCreated: true, brief: { title: b.title, outcome: b.outcome, deliverable: b.deliverable, permission: b.permission, questions: b.questions.map(q => q.q), criteria: b.successCriteria, exclusions: b.exclusions }, reply1, reply2: c2.messages.at(-1).text.slice(0, 300), ...(p ? summary(p) : { planId }) };
    }),
  ]);
  const t = await api('/timing'); out.push({ name: 'timing', groups: t.groups });
} finally { server?.kill(); }
fs.writeFileSync(path.join(root, '..', 'real-results.json'), JSON.stringify(out, null, 1));
console.log('done', out.filter(x => x.ok).length, '/', out.filter(x => 'ok' in x).length);
