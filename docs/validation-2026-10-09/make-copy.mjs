// Makes an isolated copy of HQ for tests: src web config scripts brain + package.json, a FRESH data/ and a fresh
// config/hq.local.json (toast + phone alerts off). The private hq.local.json (keys, tokens) is never copied.
//   node docs/validation-2026-10-09/make-copy.mjs <target dir>
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dst = path.resolve(process.argv[2] || ''); if (!process.argv[2] || dst === src || dst.startsWith(src + path.sep)) throw Error('Give a target outside HQ');
fs.rmSync(dst, { recursive: true, force: true }); fs.mkdirSync(dst, { recursive: true });
for (const d of ['src', 'web', 'scripts', 'brain', 'docs']) fs.cpSync(path.join(src, d), path.join(dst, d), { recursive: true, filter: f => !/[\/](backup|node_modules)([\/]|$)/.test(f) });
fs.mkdirSync(path.join(dst, 'config'), { recursive: true });
for (const f of fs.readdirSync(path.join(src, 'config'))) if (f !== 'hq.local.json') fs.copyFileSync(path.join(src, 'config', f), path.join(dst, 'config', f));
fs.copyFileSync(path.join(src, 'package.json'), path.join(dst, 'package.json'));
fs.writeFileSync(path.join(dst, 'config', 'hq.local.json'), JSON.stringify({ notifications: { toast: false, ntfy: { enabled: false, topic: 'hq-test' } }, mail: { enabled: false }, watch: { enabled: false }, pc: { enabled: false } }, null, 2));
fs.mkdirSync(path.join(dst, 'data', 'drop'), { recursive: true });
console.log('copy ready:', dst);
