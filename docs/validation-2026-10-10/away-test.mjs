// Away mode checks (docs/AWAY-MODE.md). Run on a COPY of HQ, never the live folder:
//   node docs/validation-2026-10-09/make-copy.mjs <tmp>/HQ
//   copy docs/validation-2026-10-09/fake-l4-cli.mjs to <tmp>/HQ/fake-cli.mjs
//   cd <tmp>/HQ && node --no-warnings <HQ>/docs/validation-2026-10-10/away-test.mjs [filter]
// Simulated Claude/Codex/Tailscale; real HQ server, MCP, files. The watchdog check runs a patched copy of
// scripts/watchdog.vbs against this copy's port (Windows only).
import fs from 'node:fs'; import path from 'node:path'; import assert from 'node:assert/strict'; import { spawn, execFileSync } from 'node:child_process'; import { pathToFileURL, fileURLToPath } from 'node:url';
const root = process.cwd(), here = path.dirname(fileURLToPath(import.meta.url)), results = [], PORT = 18893, delay = ms => new Promise(r => setTimeout(r, ms));
if (!fs.existsSync(path.join(root, 'fake-cli.mjs')) || /Project Secrets[\\/]HQ$/.test(root)) throw Error('Run this in a COPY of HQ that has fake-cli.mjs');
const only = process.argv[2] ? new RegExp(process.argv[2], 'i') : null;
const test = async (n, fn) => { if (only && !only.test(n)) return; const t = Date.now(); try { const d = await fn(); results.push(['PASS', n, d ?? '', Date.now() - t]); } catch (e) { results.push(['FAIL', n, String(e.stack || e).slice(0, 900), Date.now() - t]); } };
fs.copyFileSync(path.join(here, 'fake-tailscale.mjs'), path.join(root, 'fake-tailscale.mjs'));
const env = { ...process.env, HQ_FAKE_CLAUDE: path.join(root, 'fake-cli.mjs'), HQ_FAKE_CODEX: path.join(root, 'fake-cli.mjs'), HQ_FAKE_TAILSCALE: path.join(root, 'fake-tailscale.mjs'), HQ_PORT: String(PORT), HQ_NO_WATCH: '1' };
const J = p => path.join(root, p), readJ = (p, d) => { try { return JSON.parse(fs.readFileSync(J(p), 'utf8')); } catch { return d; } };
const write = (p, v) => { fs.mkdirSync(path.dirname(J(p)), { recursive: true }); fs.writeFileSync(J(p), typeof v === 'string' ? v : JSON.stringify(v, null, 2)); };
const calls = () => { try { return fs.readFileSync(J('data/fake-calls.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } };
const until = async (fn, ms, what) => { const end = Date.now() + ms; let last; while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e; } await delay(250); } throw Error(`timed out waiting for ${what}: ${last?.message || JSON.stringify(last)?.slice(0, 300)}`); };

// ---- setup: a throwaway project, l4 on, task approval on (so nothing starts without the owner) ----
write('brain/projects/qa-away/project.json', { name: 'QA Away', kind: 'product', stage: 'building', health: 'good', summary: 'Away mode test project', nextStep: 'Finish QA', updated: '2026-10-10', paths: [], maxPermission: 'plan' });
write('brain/projects/qa-away/log.md', '# Log\n');
write('brain/projects/qa-away/SUMMARY.md', '# QA Away\n');
const local = readJ('config/hq.local.json', {});
write('config/hq.local.json', { ...local, l4: { fastpath: true, intake: true, plans: true, retries: true, review: true, signals: false, projectState: false }, tasks: { maxParallel: 4 }, assistant: { taskApproval: true }, budget: { preset: 'heavy' }, initiative: { enabled: false } });
write('data/qa-tailscale.json', { running: true, serving: false });

// ---- unit checks (no server) ----
const M = async f => import(pathToFileURL(J(`src/lib/${f}.ts`)).href);
const H = 3600e3, NOW = Date.parse('2026-10-10T12:00:00Z');
await test('Unit: pacing spreads the week and keeps a reserve', async () => {
  const P = await M('pacing'), r = (weekly, resetIn, five = 10, at = NOW) => ({ weekly: { utilization: weekly, utilizationUnit: 'percent', resetsAt: NOW + resetIn, at: new Date(at).toISOString() }, fiveHour: { utilization: five, utilizationUnit: 'percent', resetsAt: NOW + 2 * H, at: new Date(at).toISOString() } });
  assert.equal(P.view(NOW, r(30, 4 * 24 * H)).mode, 'normal', '30% with 3 of 7 days gone (pace 43%)');
  const save = P.view(NOW, r(60, 5 * 24 * H)); assert.equal(save.mode, 'save', '60% with 2 days gone (pace 29%)'); assert.equal(save.expected, 29);
  assert.equal(P.view(NOW, r(86, 1 * 24 * H)).mode, 'reserve', '86% leaves less than the 15% reserve');
  assert.equal(P.view(NOW, r(20, 4 * 24 * H, 85)).mode, 'save', '5-hour window past 80%');
  assert.equal(P.view(NOW, r(99, -H)).mode, 'normal', 'a reading from before the reset says nothing');
  assert.equal(P.view(NOW, {}).mode, 'normal', 'no reading');
  return save.reason;
});
await test('Unit: habits found from repeated asks (weekly, daily), noise and scheduled ones skipped', async () => {
  const Pt = await M('patterns'), at = (d, h, m = 0) => new Date(Date.UTC(2026, 8, d, h, m)).toISOString(); // Sept 2026, UTC
  const asks = [
    ...[7, 14, 21, 28].map(d => ({ at: at(d, 9, 10), text: 'hey luther what is the status of the loancentral discord bot' })), // Mondays
    ...[2, 3, 4, 5, 8].map(d => ({ at: at(d, 18, 5), text: 'summarize my unread email for today' })),
    { at: at(9, 13), text: 'open spotify' }, { at: at(10, 13), text: 'write a poem about cats' }, { at: at(11, 13), text: 'what is the weather in toronto' },
  ];
  const found = Pt.find(asks, [], 0);
  const weekly = found.find(p => /discord/.test(p.title)), daily = found.find(p => /email/.test(p.title));
  assert.ok(weekly, 'weekly habit found'); assert.deepEqual(weekly.schedule, { type: 'weekly', day: 1, time: '08:30' });
  assert.ok(daily, 'daily habit found'); assert.equal(daily.schedule.type, 'daily'); assert.equal(daily.schedule.time, '17:30');
  assert.equal(found.length, 2, 'one-off asks are not habits');
  assert.equal(Pt.find(asks, ['Discord status: check the status of the loancentral discord bot'], 0).length, 1, 'already scheduled → skipped');
  const m = Pt.missionFor(weekly); assert.equal(m.permission, 'plan'); assert.match(m.prompt, /before they ask/);
  return found.map(p => p.when);
});
await test('Unit: health checks name what would break unattended work', async () => {
  const Hh = await M('health'), base = { claudeAuth: 'ok', codex: 'online', remoteUrl: 'https://x.ts.net/', tailscaleInstalled: true, queued: 0, running: 0, lastOkRunAt: NOW - H, pacing: { mode: 'normal', reason: '' } };
  const lv = (x, disk = 50) => Object.fromEntries(Hh.evaluate({ ...base, ...x }, NOW, disk).map(c => [c.id, c.level]));
  assert.ok(Object.values(lv({})).every(l => l === 'ok'), 'all ok');
  assert.equal(lv({ claudeAuth: 'needs-login' })['claude-auth'], 'bad');
  assert.equal(lv({ codex: 'needs-login' })['codex-auth'], 'warn');
  assert.equal(lv({ remoteUrl: null })['remote'], 'warn');
  assert.equal(lv({ queued: 3, lastOkRunAt: NOW - 30 * H })['stuck'], 'bad');
  assert.equal(lv({ queued: 3, running: 1, lastOkRunAt: NOW - 30 * H })['stuck'], 'ok', 'something is running');
  assert.equal(lv({}, 1.5)['disk'], 'bad'); assert.equal(lv({}, 5)['disk'], 'warn');
  assert.equal(lv({ pacing: { mode: 'reserve', reason: 'x' } })['pacing'], 'warn');
});
await test('Unit: Tailscale serve config read correctly', async () => {
  const R = await M('remote');
  const real = { TCP: { 443: { HTTPS: true } }, Web: { 'desktop-x.tail2bfce5.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:8800' } } } } };
  assert.equal(R.servesPort(real, 8800), true); assert.equal(R.servesPort(real, 18893), false); assert.equal(R.servesPort({}, 8800), false);
  assert.equal(R.servesPort({ Web: { a: { Handlers: { '/': { Proxy: 'localhost:8800' } } } } }, 8800), true);
});
await test('Unit: outcomes → lessons and reliability (false "done" counted)', async () => {
  const O = await M('outcomes');
  O.record({ id: 'u1', kind: 'task', title: 'Unit task one', project: 'qa-away', good: false, note: 'QA_UNIT_LESSON used the wrong currency', status: 'done', autoRule: null });
  O.record({ id: 'u2', kind: 'task', title: 'Unit task two', project: null, good: true, note: '', status: 'done', autoRule: null });
  assert.match(fs.readFileSync(J('brain/projects/qa-away/lessons.md'), 'utf8'), /QA_UNIT_LESSON/);
  assert.ok(O.lessons('qa-away').some(l => /QA_UNIT_LESSON/.test(l)));
  const r = O.reliability([{ id: 'u1', status: 'done', at: new Date().toISOString() }, { id: 'u2', status: 'done', at: new Date().toISOString() }, { id: 'u3', status: 'issue', at: new Date().toISOString() }]);
  assert.deepEqual([r.finished, r.rated, r.good, r.bad, r.falseDone, r.unrated, r.score], [3, 2, 1, 1, 1, 1, 50]);
  O.record({ id: 'u1', kind: 'task', title: 'Unit task one', project: 'qa-away', good: true, note: '', status: 'done', autoRule: null });
  assert.equal(O.reliability([{ id: 'u1', status: 'done', at: new Date().toISOString() }]).good, 1, 're-rating replaces the earlier one');
  fs.rmSync(J('data/outcomes.jsonl')); fs.rmSync(J('brain/projects/qa-away/lessons.md'));
});
await test('Unit: debrief asks for ratings and shows reliability', async () => {
  const D = await M('debrief');
  const b = D.compose({ date: '2026-10-10', tasks: [{ title: 'T', status: 'done' }], missionsDone: 0, missionsFailed: [], waiting: [], changes: [], picks: [], tomorrow: [], overdue: 0, unrated: 2, reliability: 'Last 30 days: 5 results' });
  assert.match(b.text, /## Reliability/); assert.match(b.text, /Rate today's 2 results/); assert.match(b.text, /Last 30 days: 5 results/);
  assert.doesNotMatch(D.compose({ date: '2026-10-10', tasks: [], missionsDone: 0, missionsFailed: [], waiting: [], changes: [], picks: [], tomorrow: [], overdue: 0 }).text, /Reliability/);
});

// ---- server checks ----
let server = null, ck = '';
const api = async (p, body, method) => { const r = await fetch(`http://127.0.0.1:${PORT}/api${p}`, { method: method || (body ? 'POST' : 'GET'), headers: { 'X-HQ': '1', 'Content-Type': 'application/json', Cookie: ck }, body: body ? JSON.stringify(body) : undefined }); const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(Error(JSON.stringify(j)), { status: r.status, body: j }); return j; };
const startServer = async () => {
  server = spawn(process.execPath, ['--no-warnings', 'src/server.ts'], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  server.stderr.on('data', d => fs.appendFileSync(J('data/qa-server-err.log'), d));
  await until(async () => { const r = await fetch(`http://127.0.0.1:${PORT}/api/access/unlock`, { method: 'POST', headers: { 'X-HQ': '1', 'Content-Type': 'application/json' }, body: '{"pin":"4321"}' }); ck = (r.headers.get('set-cookie') || '').split(';')[0]; return r.ok; }, 30000, 'server');
};
const stopServer = async () => { const s = server; server = null; if (!s) return; s.kill(); await new Promise(r => { s.on('exit', r); setTimeout(r, 3000); }); };
const task = async (text, project = 'qa-away') => { const t = await api('/tasks', { text, project, permission: 'plan' }); return until(async () => (await api('/tasks')).tasks.find(x => x.id === t.id && ['done', 'partly', 'issue'].includes(x.status)), 30000, 'task ' + text.slice(0, 30)); };

// Seed before start: a finished task a live fast-approve rule started, and four Monday asks for the habit check.
const ruleId = 'rule-qa-live';
write('config/autonomy-rules.json', { rules: [{ id: ruleId, title: 'QA live rule', project: 'qa-away', maxPermission: 'plan', engine: null, titleMatch: null, source: 'owner', createdAt: '2026-10-01T00:00:00Z', trialUntil: '2026-10-02T00:00:00Z', state: 'live', matches: 1 }], buildProjects: [], dismissed: {} });
const ended = new Date(Date.now() - 3600e3).toISOString();
write('data/runs/runqaauto.json', { id: 'runqaauto', missionId: null, title: 'QA auto-started task', prompt: 'x', project: 'qa-away', tier: 'fast', permission: 'plan', trigger: 'task', priority: 1, status: 'done', createdAt: ended, startedAt: ended, endedAt: ended, reportedAt: ended, taskId: 'runqaauto', depth: 0, autoRule: ruleId, output: '**Result:** Done' });
const mondays = [-28, -21, -14, -7].map(d => { const x = new Date(); x.setDate(x.getDate() + d - ((x.getDay() + 6) % 7)); x.setHours(9, 10, 0, 0); return x.toISOString(); });
fs.writeFileSync(J('data/history.jsonl'), mondays.map((at, i) => JSON.stringify({ id: 'h' + i, at, kind: 'Chat', title: 'x', ask: 'QA what is the status of the qa away launch checklist', answer: 'ok', project: null, model: 'Haiku', ok: true, session: null, ref: 'chat-qa', provider: 'claude' })).join('\n') + '\n');

try {
  await startServer();
  await test('Away card: phone address from Tailscale, Turn on works, health runs', async () => {
    let a = await api('/away');
    assert.equal(a.remote.installed, true); assert.equal(a.remote.running, true); assert.equal(a.remote.url, null, 'not serving yet');
    a = await api('/remote/serve', {}); assert.equal(a.url, 'https://qa-pc.tail0000.ts.net/');
    assert.ok(fs.readFileSync(J('data/qa-tailscale-calls.jsonl'), 'utf8').includes(`"serve","--bg","${PORT}"`), 'served this port');
    const h = await api('/away/health', {}); const ids = h.checks.map(c => c.id);
    for (const id of ['claude-auth', 'codex-auth', 'disk', 'remote', 'stuck', 'pacing', 'crashes']) assert.ok(ids.includes(id), id);
    assert.equal(h.checks.find(c => c.id === 'remote').level, 'ok');
    a = await api('/away'); for (const k of ['remote', 'health', 'pacing', 'reliability', 'unrated', 'habits']) assert.ok(k in a, k);
    return h.checks.filter(c => c.level !== 'ok').map(c => c.id).join(',') || 'all ok';
  });
  await test('Away card: Turn on explains a missing HTTPS setting instead of failing silently', async () => {
    write('data/qa-tailscale.json', { running: true, serving: false, noHttps: true });
    await assert.rejects(api('/remote/serve', {}), e => /HTTPS Certificates/.test(e.message));
    write('data/qa-tailscale.json', { running: true, serving: true });
  });
  await test('Dead-man ping: pasted URL saved locally (https only), pinged, removable', async () => {
    await assert.rejects(api('/away/ping', { url: 'http://insecure.example/x' }), e => e.status === 400);
    await assert.rejects(api('/away/ping', { url: 'javascript:alert(1)' }), e => e.status === 400);
    const r = await api('/away/ping', { url: 'https://127.0.0.1:1/qa-ping' }); assert.equal(r.pingConfigured, true);
    assert.equal(readJ('config/hq.local.json', {}).health.pingUrl, 'https://127.0.0.1:1/qa-ping');
    const h = (await api('/away')).health; assert.equal(h.pingConfigured, true); assert.equal(h.ping.ok, false, 'unreachable ping reported as failing');
    assert.equal(JSON.stringify(await api('/away')).includes('qa-ping'), false, 'the URL is never sent to the page');
    assert.equal((await api('/away/ping', { url: '' })).pingConfigured, false);
  });
  await test('Health: one alert per problem (no repeat within 12 h)', async () => {
    const a1 = readJ('data/health.json', {}).alerted || {};
    await api('/away/health', {}); const a2 = readJ('data/health.json', {}).alerted || {};
    for (const k of Object.keys(a1)) assert.equal(a2[k], a1[k], `alert for ${k} not repeated`);
    return Object.keys(a2).join(',') || 'nothing to alert';
  });
  await test('Rating: 👎 with a note becomes a lesson that the next task reads', async () => {
    const t1 = await task('QA_SRC first away task: list three things');
    const r = await api('/outcomes/rate', { id: t1.id, good: false, note: 'QA_AWAY_LESSON always give prices in CAD' });
    assert.equal(r.good, false); assert.equal(r.lesson, true);
    assert.match(fs.readFileSync(J('brain/projects/qa-away/lessons.md'), 'utf8'), /QA_AWAY_LESSON/);
    assert.deepEqual((await api('/tasks')).tasks.find(x => x.id === t1.id).rating, { good: false, note: 'QA_AWAY_LESSON always give prices in CAD' });
    const t2 = await task('QA_SRC second away task: compare two options');
    const c = calls().find(c => c.run === t2.id); assert.ok(c, 'second task ran');
    assert.match(c.prompt, /Lessons from earlier work[\s\S]*QA_AWAY_LESSON/);
    const rel = (await api('/outcomes')).reliability; assert.ok(rel.rated >= 1 && rel.falseDone >= 1, JSON.stringify(rel));
    return rel;
  });
  await test('Rating: 👎 on work a live rule started turns the rule off', async () => {
    const r = await api('/outcomes/rate', { id: 'runqaauto', good: false, note: '' });
    assert.equal(r.ruleTurnedOff, ruleId);
    const rule = (await api('/autonomy')).rules.find(x => x.id === ruleId); assert.equal(rule.state, 'off'); assert.match(rule.offReason, /not right/);
  });
  await test('Rating by voice: chat drop counts, a background run cannot rate', async () => {
    write(`data/drop/rating-qa-1.json`, { type: 'rating', fromRun: 'run-sneaky', id: null, good: true });
    write(`data/drop/rating-qa-2.json`, { type: 'rating', fromRun: 'chat-qa', id: null, good: true, note: '' });
    await until(() => !fs.existsSync(J('data/drop/rating-qa-2.json')), 10000, 'drop ingested');
    const latestId = (await api('/outcomes')).finished[0].id;
    const all = fs.readFileSync(J('data/outcomes.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    assert.equal(all.filter(o => o.id === latestId && o.good).length, 1, 'only the chat rating counted');
    const act = fs.readFileSync(J('data/activity.jsonl'), 'utf8'); assert.match(act, /rating-dropped/);
  });
  await test('MCP: rate_work only in the chat', async () => {
    const tools = runId => new Promise(resolve => { const c = spawn(process.execPath, ['--no-warnings', 'src/mcp/hq-brain.ts'], { cwd: root, env: { ...process.env, HQ_LEVEL: 'plan', HQ_RUN_ID: runId } }); let b = ''; c.stdout.on('data', d => { b += d; if (b.includes('"id":1')) { c.kill(); resolve(JSON.parse(b.trim().split('\n')[0]).result.tools.map(t => t.name)); } }); c.stdin.write('{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n'); });
    assert.ok((await tools('chat-qa')).includes('rate_work')); assert.ok(!(await tools('run-qa')).includes('rate_work'));
  });
  await test('Pacing: background work goes to Codex (or waits) when Claude is ahead of pace; owner tasks still run', async () => {
    write('data/usage-rates.json', { weekly: { utilization: 88, utilizationUnit: 'percent', resetsAt: Date.now() + 2 * 864e5, at: new Date().toISOString(), type: 'seven_day' } });
    assert.equal((await api('/away')).pacing.mode, 'reserve');
    const m = await api('/missions', { title: 'QA paced mission', prompt: 'QA_SRC background check', permission: 'read', tier: 'fast', schedule: { type: 'every', hours: 24 }, enabled: true });
    const run = await until(async () => readDirRuns().find(r => r.missionId === m.id), 45000, 'mission enqueued (scheduler ticks every 30 s)');
    await delay(3000);
    const r2 = readDirRuns().find(r => r.id === run.id);
    const act = fs.readFileSync(J('data/activity.jsonl'), 'utf8');
    assert.ok(r2.provider === 'codex' || (r2.status === 'queued' && /"event":"paced"/.test(act)), `background run used ${r2.provider} (${r2.status})`);
    const t = await task('QA_SRC owner task while paced');
    const tr = readDirRuns().find(r => r.id === t.id); assert.equal(tr.provider, 'claude', 'the owner\'s own task is not held back');
    write('data/usage-rates.json', {});
    return `background → ${r2.provider || r2.status}`;
  });
  await test('Habits: four Monday asks → suggestion → "Do it before I ask" schedules a weekly mission', async () => {
    const a = await api('/away'); const h = a.habits.find(x => /qa away launch checklist/i.test(x.title));
    assert.ok(h, 'habit suggested: ' + JSON.stringify(a.habits)); assert.equal(h.schedule.type, 'weekly'); assert.equal(h.schedule.day, 1);
    const r = await api(`/habits/${h.key}`, { accept: true }); assert.equal(r.mission.schedule.day, 1); assert.equal(r.mission.permission, 'plan');
    assert.ok(!(await api('/away')).habits.some(x => x.key === h.key), 'not suggested again');
  });
  await test('Phone alerts open LUTHUR over Tailscale', async () => {
    process.env.HQ_FAKE_TAILSCALE = env.HQ_FAKE_TAILSCALE; process.env.HQ_PORT = String(PORT);
    const R = await M('remote');
    await R.status(PORT, true); // this process's cache (the server has its own)
    assert.equal(R.phoneUrl(), 'https://qa-pc.tail0000.ts.net/');
  });
} finally { await stopServer(); }
function readDirRuns() { return fs.readdirSync(J('data/runs')).filter(f => f.endsWith('.json')).map(f => readJ('data/runs/' + f, null)).filter(Boolean); }

// ---- watchdog (Windows): a patched copy points at this port and checks every 2 s ----
if (process.platform === 'win32') await test('Watchdog: restarts a crashed server, leaves a deliberate stop alone', async () => {
  const vbs = fs.readFileSync(J('scripts/watchdog.vbs'), 'utf8').replace('Const PORT = 8800', `Const PORT = ${PORT}`).replace(/WScript\.Sleep 60000/g, 'WScript.Sleep 2000').replace('"watchdog.vbs"', '"qa-watchdog.vbs"');
  fs.writeFileSync(J('scripts/qa-watchdog.vbs'), vbs);
  try { fs.rmSync(J('data/watchdog.log')); } catch {}
  const wd = spawn('wscript.exe', [J('scripts/qa-watchdog.vbs')], { cwd: root, env, windowsHide: true, stdio: 'ignore' });
  const up = async () => { try { const r = await fetch(`http://127.0.0.1:${PORT}/api/access`); return r.status === 200 || r.status === 401; } catch { return false; } };
  try {
    assert.equal(await up(), false, 'server is down at the start');
    await until(up, 30000, 'watchdog restarted the server');
    assert.match(fs.readFileSync(J('data/watchdog.log'), 'utf8'), /restart: server did not answer/);
    // Deliberate stop: flag + kill → stays down.
    write('data/hq-stopped.flag', 'stopped');
    const pid = execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-NetTCPConnection -LocalPort ${PORT} -State Listen).OwningProcess`], { encoding: 'utf8' }).trim().split(/\s+/)[0];
    execFileSync('taskkill', ['/pid', pid, '/T', '/F']);
    await delay(12000);
    assert.equal(await up(), false, 'stayed stopped while the flag is there');
    // Second watchdog quits at once (only one runs).
    const second = spawn('wscript.exe', [J('scripts/qa-watchdog.vbs')], { cwd: root, env, windowsHide: true, stdio: 'ignore' });
    const quit = await new Promise(r => { second.on('exit', () => r(true)); setTimeout(() => r(false), 8000); });
    assert.equal(quit, true, 'a second watchdog exits');
  } finally {
    try { execFileSync('taskkill', ['/pid', String(wd.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
    try { const pid = execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue).OwningProcess`], { encoding: 'utf8' }).trim(); if (pid) execFileSync('taskkill', ['/pid', pid.split(/\s+/)[0], '/T', '/F'], { stdio: 'ignore' }); } catch {}
  }
});

const pass = results.filter(r => r[0] === 'PASS').length;
for (const [s, n, d, ms] of results) console.log(`${s} ${n} (${ms} ms)${s === 'FAIL' ? '\n   ' + d : d ? ' · ' + (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 200) : ''}`);
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
