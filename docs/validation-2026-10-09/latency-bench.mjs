// Chat latency bench with the REAL model CLI, on a COPY of HQ (make-copy.mjs). Measures from the client side, so the
// same script compares any two versions: POST /api/chat → first streamed text → complete <spoken> sentence → reply saved.
// "cold" = first turn of a fresh chat session, "warm" = later turns of the same session. No message text is stored.
//   cd <copy> && node --no-warnings <HQ>/docs/validation-2026-10-09/latency-bench.mjs <label> [rounds]
import fs from 'node:fs'; import path from 'node:path'; import { spawn } from 'node:child_process';
const root = process.cwd(), label = process.argv[2] || 'run', rounds = Number(process.argv[3] || 2), PORT = 18890;
if (/Project Secrets[\\/]HQ$/.test(root)) throw Error('Run on a COPY of HQ');
// 4th arg "persist": the same requests with the persistent chat process on (config chat.persistent).
if (process.argv[4] === 'persist') { const f = path.join(root, 'config', 'hq.local.json'), c = JSON.parse(fs.readFileSync(f, 'utf8')); c.chat = { ...(c.chat || {}), persistent: true }; fs.writeFileSync(f, JSON.stringify(c, null, 2)); }
const delay = ms => new Promise(r => setTimeout(r, ms));
const REQUESTS = [
  ['time', 'What time is it?'],
  ['next-step', "What's the next step on the LUTHUR project?"],
  ['status', 'Give me a quick status of my projects in two sentences.'],
  ['waiting', 'Is anything waiting for my approval?'],
  ['thanks', "Thanks, that's all for now."],
];
let ck = '';
const api = async (p, body) => { const r = await fetch(`http://127.0.0.1:${PORT}/api${p}`, { method: body ? 'POST' : 'GET', headers: { 'X-HQ': '1', 'Content-Type': 'application/json', Cookie: ck }, body: body ? JSON.stringify(body) : undefined }); const j = await r.json().catch(() => ({})); if (!r.ok) throw Error(JSON.stringify(j)); return j; };
const server = spawn(process.execPath, ['--no-warnings', 'src/server.ts'], { cwd: root, env: { ...process.env, HQ_PORT: String(PORT), HQ_NO_WATCH: '1' }, windowsHide: true, stdio: 'ignore' });
const rows = [];
try {
  for (let i = 0; i < 100; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/api/access/unlock`, { method: 'POST', headers: { 'X-HQ': '1', 'Content-Type': 'application/json' }, body: '{"pin":"4321"}' }); ck = (r.headers.get('set-cookie') || '').split(';')[0]; if (r.ok) break; } catch {} await delay(300); }
  await api('/initiative/settings', { enabled: false }).catch(() => {});
  for (let round = 0; round < rounds; round++) {
    await api('/chat/new', {});
    for (const [i, [key, text]] of REQUESTS.entries()) {
      const before = (await api('/chat')).messages.length;
      const t0 = performance.now(); let first = 0, spoken = 0, done = 0, ok = false, model = '';
      await api('/chat', { text, voice: true });
      while (performance.now() - t0 < 240e3) {
        const c = await api('/chat');
        if (c.partial && !first) first = performance.now() - t0;
        if (!spoken && /<\/spoken>/.test(c.partial || '')) spoken = performance.now() - t0;
        if (!c.busy && c.messages.length > before + 1) { done = performance.now() - t0; const m = c.messages.at(-1); ok = !m.error; model = c.model || ''; if (!spoken && m.speech) spoken = done; if (!first) first = done; break; }
        await delay(40);
      }
      rows.push({ label, round, key, temp: i === 0 ? 'cold' : 'warm', ok, model, firstMs: Math.round(first), spokenMs: Math.round(spoken), totalMs: Math.round(done) });
      console.log(JSON.stringify(rows.at(-1)));
      await delay(800);
    }
  }
} finally { server.kill(); }
const out = path.join(root, '..', `latency-${label}.json`); fs.writeFileSync(out, JSON.stringify(rows, null, 1));
const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const p90 = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.ceil(s.length * .9) - 1)] : null; };
for (const t of ['cold', 'warm']) { const r = rows.filter(x => x.temp === t && x.ok); console.log(t, 'n', r.length, 'first med/p90', med(r.map(x => x.firstMs)), p90(r.map(x => x.firstMs)), 'spoken', med(r.map(x => x.spokenMs)), p90(r.map(x => x.spokenMs)), 'total', med(r.map(x => x.totalMs)), p90(r.map(x => x.totalMs))); }
