// Runs the earlier suites (2026-10-05 … 10-08), each on its own fresh copy of HQ, and prints pass/fail per suite.
//   node docs/validation-2026-10-09/run-regression.mjs <work dir> [source dir = this HQ]
// The source can be another checkout (e.g. `git archive HEAD`) to compare before/after. No real model calls.
import fs from 'node:fs'; import path from 'node:path'; import { spawnSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), hq = path.resolve(here, '..', '..');
const work = path.resolve(process.argv[2] || ''), src = path.resolve(process.argv[3] || hq);
if (!process.argv[2] || work.startsWith(hq)) throw Error('Give a work dir outside HQ');
const V = p => path.join(hq, 'docs', p);
const suites = [
  { name: 'base-15', test: 'validation-2026-10-05/run-tests.mjs', fake: 'validation-2026-10-05/fake-cli.mjs' },
  { name: 'phase0', test: 'validation-2026-10-07/phase0-test.mjs', fake: 'validation-2026-10-05/fake-cli.mjs', agent: true },
  { name: 'autonomy', test: 'validation-2026-10-07/autonomy-test.mjs', fake: 'validation-2026-10-05/fake-cli.mjs', agent: true },
  { name: 'initiative', test: 'validation-2026-10-08/initiative-test.mjs', fake: 'validation-2026-10-05/fake-cli.mjs' },
  { name: 'verify', test: 'validation-2026-10-08/verify-test.mjs', fake: 'validation-2026-10-08/fake-verify-cli.mjs' },
  { name: 'debrief', test: 'validation-2026-10-08/debrief-test.mjs', fake: 'validation-2026-10-08/fake-verify-cli.mjs' },
].filter(s => !process.argv[4] || process.argv[4].split(',').includes(s.name));
const copy = path.join(here, 'make-copy.mjs');
const out = [];
for (const s of suites) {
  const base = path.join(work, s.name), dir = path.join(base, 'HQ');
  fs.rmSync(base, { recursive: true, force: true }); fs.mkdirSync(base, { recursive: true });
  // make-copy copies from the folder it lives in, so run the copy script that belongs to the source tree when it has one.
  const mk = fs.existsSync(path.join(src, 'docs', 'validation-2026-10-09', 'make-copy.mjs')) ? path.join(src, 'docs', 'validation-2026-10-09', 'make-copy.mjs') : copy;
  if (mk === copy && src !== hq) { // older source: copy by hand
    for (const d of ['src', 'web', 'scripts', 'brain']) fs.cpSync(path.join(src, d), path.join(dir, d), { recursive: true });
    fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
    for (const f of fs.readdirSync(path.join(src, 'config'))) if (f !== 'hq.local.json') fs.copyFileSync(path.join(src, 'config', f), path.join(dir, 'config', f));
    fs.copyFileSync(path.join(src, 'package.json'), path.join(dir, 'package.json'));
    fs.writeFileSync(path.join(dir, 'config', 'hq.local.json'), JSON.stringify({ notifications: { toast: false, ntfy: { enabled: false, topic: 'hq-test' } }, mail: { enabled: false }, watch: { enabled: false }, pc: { enabled: false } }));
    fs.mkdirSync(path.join(dir, 'data', 'drop'), { recursive: true });
  } else spawnSync(process.execPath, [mk, dir], { stdio: 'ignore' });
  fs.copyFileSync(V(s.fake), path.join(dir, 'fake-cli.mjs'));
  // These suites listen for phone alerts on a local sink (127.0.0.1:18881): point the copy's ntfy there.
  if (['base-15', 'phase0', 'autonomy'].includes(s.name)) { const f = path.join(dir, 'config', 'hq.local.json'), c = JSON.parse(fs.readFileSync(f, 'utf8')); c.notifications = { toast: false, ntfy: { enabled: true, server: 'http://127.0.0.1:18881', topic: 'hq-test', detail: 'full' } }; fs.writeFileSync(f, JSON.stringify(c, null, 2)); }
  if (s.agent) { fs.copyFileSync(V('validation-2026-10-07/fake-agent.mjs'), path.join(base, 'fake-agent.mjs')); fs.mkdirSync(path.join(base, 'GenBot'), { recursive: true }); fs.mkdirSync(path.join(base, 'LoanBot', 'LoanCentral-Test'), { recursive: true }); }
  const t = Date.now();
  const r = spawnSync(process.execPath, ['--no-warnings', V(s.test)], { cwd: dir, encoding: 'utf8', timeout: 15 * 60e3 });
  const text = (r.stdout || '') + (r.stderr || '');
  const fails = text.split('\n').filter(l => l.startsWith('FAIL'));
  const sum = text.match(/(\d+)\/(\d+) passed/) || text.match(/(\d+) passed/);
  out.push({ suite: s.name, code: r.status, summary: sum ? sum[0] : text.trim().split('\n').slice(-2).join(' | ').slice(0, 200), fails: fails.map(f => f.slice(0, 160)), sec: Math.round((Date.now() - t) / 1000) });
  console.log(JSON.stringify(out.at(-1)));
  fs.writeFileSync(path.join(base, 'output.txt'), text);
}
fs.writeFileSync(path.join(work, 'regression.json'), JSON.stringify(out, null, 1));
