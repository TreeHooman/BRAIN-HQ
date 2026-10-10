// Code workroom end to end: the plan a manager writes never kills the request (src/lib/code-manager.ts).
// Real HQ server, real runClaude spawn and stream parsing; only the CLI is simulated. Run on a COPY of HQ:
//   node docs/validation-2026-10-09/make-copy.mjs <tmp>/HQ
//   cd <tmp>/HQ && node --no-warnings <HQ>/docs/validation-2026-10-10/workroom-test.mjs [filter]
import fs from 'node:fs'; import path from 'node:path'; import assert from 'node:assert/strict'; import { spawn } from 'node:child_process'; import { fileURLToPath } from 'node:url';
const root = process.cwd(), here = path.dirname(fileURLToPath(import.meta.url)), results = [], PORT = 18894, delay = ms => new Promise(r => setTimeout(r, ms));
if (/Project Secrets[\\/]HQ$/.test(root) || !fs.existsSync(path.join(root, 'src', 'server.ts'))) throw Error('Run this in a COPY of HQ (make-copy.mjs)');
const only = process.argv[2] ? new RegExp(process.argv[2], 'i') : null;
const test = async (n, fn) => { if (only && !only.test(n)) return; const t = Date.now(); try { const d = await fn(); results.push(['PASS', n, d ?? '', Date.now() - t]); } catch (e) { results.push(['FAIL', n, String(e.stack || e).slice(0, 900), Date.now() - t]); } };
const J = p => path.join(root, p);
const write = (p, v) => { fs.mkdirSync(path.dirname(J(p)), { recursive: true }); fs.writeFileSync(J(p), typeof v === 'string' ? v : JSON.stringify(v, null, 2)); };
fs.copyFileSync(path.join(here, 'fake-code-cli.mjs'), J('fake-code-cli.mjs'));
const env = { ...process.env, HQ_FAKE_CLAUDE: J('fake-code-cli.mjs'), HQ_PORT: String(PORT), HQ_NO_WATCH: '1' };
const calls = () => { try { return fs.readFileSync(J('data/fake-code-calls.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } };
const until = async (fn, ms, what) => { const end = Date.now() + ms; let last; while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e; } await delay(250); } throw Error(`timed out waiting for ${what}: ${last?.message || JSON.stringify(last)?.slice(0, 300)}`); };

// A throwaway project with a real folder, so the workroom may run at build level.
write('qa-repo/README.md', '# QA repo\n');
write('brain/projects/qa-code/project.json', { name: 'QA Code', kind: 'product', stage: 'building', health: 'good', summary: 'Workroom test project', nextStep: 'Test', updated: '2026-10-10', paths: [J('qa-repo')], maxPermission: 'build' });
write('brain/projects/qa-code/log.md', '# Log\n');
write('brain/projects/qa-code/SUMMARY.md', '# QA Code\n');

let server = null, ck = '';
const api = async (p, body, method) => { const r = await fetch(`http://127.0.0.1:${PORT}/api${p}`, { method: method || (body ? 'POST' : 'GET'), headers: { 'X-HQ': '1', 'Content-Type': 'application/json', Cookie: ck }, body: body ? JSON.stringify(body) : undefined }); const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(Error(JSON.stringify(j)), { status: r.status, body: j }); return j; };
// One fresh workroom per case, managed with room for 6 workers. Returns the final reply and that room's CLI calls.
const ask = async (text, settings = { orchestration: 'managed', maxWorkers: 6, maxCalls: 8 }) => {
  const { id } = await api('/code', { project: 'qa-code' });
  await api(`/code/${id}/settings`, settings, 'PUT');
  const before = calls().length;
  await api(`/code/${id}`, { text });
  const s = await until(async () => { const r = await api(`/code/${id}`); return !r.busy && r.messages.at(-1)?.role === 'hq' && r.messages.at(-1).text !== '' && r; }, 30000, 'workroom reply');
  const dir = J(`data/code/workrooms/${id}`), note = f => { try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch { return ''; } };
  return { reply: s.messages.at(-1), room: s, note, calls: calls().slice(before).filter(c => c.role !== 'other') }; // 'other' = HQ's own sign-in probe
};

try {
  server = spawn(process.execPath, ['--no-warnings', 'src/server.ts'], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  server.stderr.on('data', d => fs.appendFileSync(J('data/qa-server-err.log'), d));
  await until(async () => { const r = await fetch(`http://127.0.0.1:${PORT}/api/access/unlock`, { method: 'POST', headers: { 'X-HQ': '1', 'Content-Type': 'application/json' }, body: '{"pin":"4321"}' }); ck = (r.headers.get('set-cookie') || '').split(';')[0]; return r.ok; }, 30000, 'server');

  await test('Original bug: a 7,500-character task runs whole; workers see the full owner request', async () => {
    const owner = 'QA_LONG build it. ' + 'detail '.repeat(800) + 'QA_OWNER_END';
    const r = await ask(owner);
    assert.equal(r.reply.error, false, 'no error: ' + r.reply.text.slice(0, 300));
    assert.doesNotMatch(r.reply.text, /No workers started/);
    assert.equal(r.reply.text, 'QA review done.');
    assert.deepEqual(r.calls.map(c => c.role), ['manager', 'worker', 'worker', 'review']);
    const w1 = r.calls[1].prompt; assert.ok(w1.includes('QA_TASK_END'), 'worker 1 got its whole task'); assert.ok(w1.includes('QA_OWNER_END'), 'worker 1 got the whole owner request');
    assert.ok(r.calls[2].prompt.includes('QA worker done'), 'worker 2 got worker 1\'s report');
    assert.ok(r.calls[3].prompt.includes('QA_OWNER_END') && (r.calls[3].prompt.match(/QA worker done/g) || []).length === 2, 'review got the request and both reports');
    assert.ok(r.note('PLAN.md').includes('QA_TASK_END'), 'PLAN.md has the whole task');
    assert.ok(r.note('WORKER-1.md').includes('QA_TASK_END'));
    assert.match(r.note('STATUS.md'), /Workers used: 2\/2/);
    assert.deepEqual(r.reply.agents.map(a => a.role), ['LUTHUR · manager', 'Long worker', 'Second worker', 'LUTHUR · review']);
    return `task ${w1.length} chars in the worker prompt`;
  });
  await test('Too many workers: 8 planned, 6 run, owner told in chat, PLAN.md records it', async () => {
    const r = await ask('QA_MANY split it up');
    assert.equal(r.reply.error, false, r.reply.text.slice(0, 300));
    assert.equal(r.calls.filter(c => c.role === 'worker').length, 6);
    assert.match(r.reply.text, /^_Plan adjusted: Plan had 8 workers/);
    assert.match(r.reply.text, /QA review done\.$/);
    assert.match(r.note('PLAN.md'), /## Adjustments/); assert.match(r.note('PLAN.md'), /## 6\. W5/); assert.doesNotMatch(r.note('PLAN.md'), /## 7\./);
  });
  await test('Call budget caps workers too: maxCalls 4 leaves room for 2 workers', async () => {
    const r = await ask('QA_MANY split it up', { orchestration: 'managed', maxWorkers: 6, maxCalls: 4 });
    assert.equal(r.reply.error, false, r.reply.text.slice(0, 300));
    assert.deepEqual(r.calls.map(c => c.role), ['manager', 'worker', 'worker', 'review']);
    assert.match(r.reply.text, /^_Plan adjusted:/);
  });
  await test('Unreadable plan JSON: no workers, manager reply kept, short note, no error', async () => {
    const r = await ask('QA_BADJSON plan it');
    assert.equal(r.reply.error, false, r.reply.text.slice(0, 300));
    assert.deepEqual(r.calls.map(c => c.role), ['manager']);
    assert.match(r.reply.text, /^Plan below\./); assert.match(r.reply.text, /not readable JSON/); assert.doesNotMatch(r.reply.text, /luthur_tasks/);
  });
  await test('Direct mode (the default): a plan is ignored, the manager answers alone', async () => {
    const r = await ask('QA_LONG build it', { orchestration: 'direct' });
    assert.equal(r.reply.error, false, r.reply.text.slice(0, 300));
    assert.deepEqual(r.calls.map(c => c.role), ['manager']);
    assert.doesNotMatch(r.reply.text, /luthur_tasks/);
    assert.match(r.calls[0].system, /Worker limit for this request: 0/);
  });
} finally {
  if (server) { server.kill(); await new Promise(r => { server.on('exit', r); setTimeout(r, 3000); }); }
}
for (const [s, n, d, ms] of results) console.log(`${s} ${n} (${ms} ms)${d ? '\n     ' + (typeof d === 'string' ? d : JSON.stringify(d)) : ''}`);
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed`); process.exit(failed ? 1 : 0);
