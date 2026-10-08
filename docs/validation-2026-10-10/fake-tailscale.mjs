// Fake Tailscale CLI for away-test.mjs (HQ_FAKE_TAILSCALE). State lives in data/qa-tailscale.json of the copy:
// { running, serving }. Logs every call to data/qa-tailscale-calls.jsonl.
import fs from 'node:fs';
const args = process.argv.slice(2), file = 'data/qa-tailscale.json';
const st = (() => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { running: true, serving: false }; } })();
fs.appendFileSync('data/qa-tailscale-calls.jsonl', JSON.stringify({ at: Date.now(), args }) + '\n');
const port = Number(process.env.HQ_PORT || 8800);
if (args[0] === 'status') {
  console.log(JSON.stringify({ BackendState: st.running ? 'Running' : 'NeedsLogin', Self: { DNSName: 'qa-pc.tail0000.ts.net.', TailscaleIPs: ['100.101.102.103', 'fd7a::1'] } }));
} else if (args[0] === 'serve' && args[1] === 'status') {
  console.log(JSON.stringify(st.serving ? { TCP: { 443: { HTTPS: true } }, Web: { 'qa-pc.tail0000.ts.net:443': { Handlers: { '/': { Proxy: `http://127.0.0.1:${port}` } } } } } : {}));
} else if (args[0] === 'serve' && args[1] === '--bg') {
  if (st.noHttps) { console.error('error: HTTPS cert support is not enabled/configured for your tailnet'); process.exit(1); }
  fs.writeFileSync(file, JSON.stringify({ ...st, serving: true }));
  console.log('Available within your tailnet: https://qa-pc.tail0000.ts.net/');
} else if (args[0] === 'serve' && args.includes('off')) {
  fs.writeFileSync(file, JSON.stringify({ ...st, serving: false }));
} else { console.error('unknown'); process.exit(1); }
