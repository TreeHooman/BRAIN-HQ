// Fake Claude CLI for workroom-test.mjs. Speaks stream-json and plays the Code workroom roles (manager, worker,
// review), picked from the system prompt. A marker in the current owner request picks the manager's plan.
// Every call is logged to data/fake-code-calls.jsonl with the FULL prompt, so the test can check nothing was cut.
import fs from 'node:fs';
let p = ''; for await (const d of process.stdin) p += d;
const args = process.argv.slice(2), arg = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const sys = arg('--system-prompt') || arg('--append-system-prompt') || '';
const role = /focused worker reporting to LUTHUR/.test(sys) ? 'worker' : /You are LUTHUR · review/.test(sys) ? 'review' : /coding manager/.test(sys) ? 'manager' : 'other';
const session = `fc-${Date.now().toString(36)}`;
const out = j => process.stdout.write(JSON.stringify(j) + '\n');
fs.appendFileSync('data/fake-code-calls.jsonl', JSON.stringify({ at: Date.now(), role, prompt: p, system: sys }) + '\n');
const now = p.split('Current owner request:\n').at(-1); // the manager prompt also carries earlier workroom notes
const tasks = v => `Plan below.\n<luthur_tasks>${typeof v === 'string' ? v : JSON.stringify(v)}</luthur_tasks>`;
let text = 'OK';
if (role === 'manager') {
  if (now.includes('QA_LONG')) text = tasks([{ title: 'Long worker', task: 'step '.repeat(1500) + 'QA_TASK_END' }, { title: 'Second worker', task: 'short job' }]);
  else if (now.includes('QA_MANY')) text = tasks(Array.from({ length: 8 }, (_, i) => ({ title: 'W' + i, task: 'job ' + i })));
  else if (now.includes('QA_BADJSON')) text = tasks('[{title: oops, task: }]');
  else text = 'QA manager reply, no workers.';
} else if (role === 'worker') text = `QA worker done (${p.length} chars seen).`;
else if (role === 'review') text = 'QA review done.';
out({ type: 'system', subtype: 'init', session_id: session });
out({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
out({ type: 'result', result: text, is_error: false, session_id: session, num_turns: 1, total_cost_usd: 0.01 });
