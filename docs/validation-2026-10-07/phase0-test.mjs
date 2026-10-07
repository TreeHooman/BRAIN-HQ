// Phase 0 guard checks (2026-10-07). Run on a COPY of HQ, never the live folder:
//   <tmp>/HQ (copy of src web config scripts brain, fresh data/, config/hq.local.json with toast off + ntfy at 127.0.0.1:18881),
//   <tmp>/GenBot and <tmp>/LoanBot/LoanCentral-Test (empty), <tmp>/fake-agent.mjs (this folder).
//   cd <tmp>/HQ && node --no-warnings <path>/phase0-test.mjs
import fs from 'node:fs'; import path from 'node:path'; import assert from 'node:assert/strict'; import http from 'node:http'; import {spawn,spawnSync} from 'node:child_process'; import {pathToFileURL} from 'node:url';
const root=process.cwd(), base=path.resolve(root,'..'), results=[], notes=[];
const imp=f=>import(pathToFileURL(path.join(root,f)));
const test=async(n,fn)=>{try{const d=await fn();results.push(['PASS',n,d??'']);}catch(e){results.push(['FAIL',n,String(e.stack||e).slice(0,500)]);}};
const sink=http.createServer((q,s)=>{let b='';q.on('data',d=>b+=d);q.on('end',()=>{notes.push(b);s.end('ok');});});await new Promise(r=>sink.listen(18881,'127.0.0.1',r));
process.env.QA_ROOT=root; process.env.HQ_FAKE_CODEX=path.join(base,'fake-agent.mjs'); process.env.HQ_FAKE_CLAUDE=path.join(base,'fake-agent.mjs');
const perm=path.join(root,'config','permissions.json'), permBefore=fs.readFileSync(perm,'utf8');
const sched=path.join(root,'src','lib','schedule.ts'), schedBefore=fs.readFileSync(sched,'utf8');
const reset=()=>{fs.writeFileSync(perm,permBefore);fs.writeFileSync(sched,schedBefore);try{fs.unlinkSync(path.join(root,'scripts','evil.cmd'))}catch{}};
const calls=()=>fs.readFileSync(path.join(base,'calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
const {runCodex}=await imp('src/lib/codex.ts'); const {runClaude}=await imp('src/lib/claude.ts'); const store=await imp('src/lib/store.ts'); const guard=await imp('src/lib/guard.ts');
await test('Codex build runs in the project folder, never HQ or LoanBot',async()=>{
  const r=await runCodex({prompt:'hello',model:'x',level:'build',timeoutMs:20000,runId:'qa1',addDirs:[root,path.join(base,'LoanBot'),path.join(base,'GenBot')]});
  assert.equal(r.ok,true,r.text); const c=calls().at(-1);
  assert.equal(path.resolve(c.cwd),path.resolve(base,'GenBot'));
  assert.equal(c.args[c.args.indexOf('-C')+1],path.join(base,'GenBot'));
  assert.ok(!c.args.some(a=>/LoanBot$|HQ$/.test(a)),'no HQ/LoanBot dir passed');
  assert.match(c.prompt,/You can write files only in/);});
await test('Codex build with no safe folder uses an empty scratch folder',async()=>{
  await runCodex({prompt:'hi',model:'x',level:'build',timeoutMs:20000,runId:'qa2',addDirs:[root]}); assert.equal(path.resolve(calls().at(-1).cwd),path.join(root,'data','codex-work'));});
await test('Codex plan run unchanged (HQ, read-only)',async()=>{
  await runCodex({prompt:'hi',model:'x',level:'plan',timeoutMs:20000,runId:'qa3',addDirs:[path.join(base,'GenBot')]}); const c=calls().at(-1);
  assert.equal(path.resolve(c.cwd),root); assert.ok(c.args.includes('sandbox_mode="read-only"'));assert.ok(!c.args.includes('--add-dir'));});
await test('Codex tampering: permissions + start script restored, code change reported and kept',async()=>{
  const r=await runCodex({prompt:'QA_TAMPER',model:'x',level:'build',timeoutMs:20000,runId:'qa4',addDirs:[path.join(base,'GenBot')]});
  assert.equal(r.ok,true); assert.equal(fs.readFileSync(perm,'utf8'),permBefore,'permissions restored');
  assert.ok(!fs.existsSync(path.join(root,'scripts','evil.cmd')),'new script removed');
  assert.match(fs.readFileSync(sched,'utf8'),/tampered/,'src left as is (owner may be editing)');
  const log=fs.readFileSync(path.join(root,'data','guard','log.jsonl'),'utf8').trim().split('\n').map(JSON.parse).at(-1);
  assert.deepEqual(log.restored.sort(),[path.join('config','permissions.json'),path.join('scripts','evil.cmd')].sort());
  assert.deepEqual(log.changed,[path.join('src','lib','schedule.ts')]);
  assert.ok(fs.existsSync(path.join(log.kept,'before','src','lib','schedule.ts')),'earlier code copy kept');
  assert.ok(fs.existsSync(path.join(log.kept,'agent-version','config','permissions.json')),'agent version kept');
  await new Promise(r=>setTimeout(r,800)); assert.ok(notes.length>=2,'owner notified: '+notes.length); reset(); return log;});
await test('Claude build tampering is caught too',async()=>{
  const r=await runClaude({prompt:'QA_TAMPER',model:'haiku',level:'build',timeoutMs:20000,runId:'qa5'});
  assert.equal(r.ok,true,r.text); assert.equal(fs.readFileSync(perm,'utf8'),permBefore); reset();});
await test('Read-level run is not snapshotted (no cost)',async()=>{
  const n=fs.readFileSync(path.join(root,'data','guard','log.jsonl'),'utf8').split('\n').length;
  await runClaude({prompt:'QA_TAMPER',model:'haiku',level:'read',timeoutMs:20000,runId:'qa6'}); reset();
  assert.equal(fs.readFileSync(path.join(root,'data','guard','log.jsonl'),'utf8').split('\n').length,n);});
await test("HQ's own settings save during a run is kept",async()=>{
  guard.watch('qa7'); const hq=path.join(root,'config','hq.local.json'); const j=JSON.parse(fs.readFileSync(hq,'utf8')); j.qaMarker=1; store.writeJson(hq,j);
  const r=guard.check('qa7'); assert.deepEqual(r.restored,[]); assert.equal(JSON.parse(fs.readFileSync(hq,'utf8')).qaMarker,1);});
await test('Unreadable request kept in drop/bad; crash-looping run fails; normal interrupted run requeued',async()=>{
  const runs=path.join(root,'data','runs'), drop=path.join(root,'data','drop'); fs.mkdirSync(runs,{recursive:true}); fs.mkdirSync(drop,{recursive:true});
  const mk=(id,restarts)=>fs.writeFileSync(path.join(runs,id+'.json'),JSON.stringify({id,missionId:null,title:id,prompt:'QA '+id,tier:'fast',permission:'read',trigger:'manual',priority:2,status:'running',createdAt:new Date().toISOString(),depth:0,restarts}));
  mk('qa-loop',2); mk('qa-once',0);
  fs.writeFileSync(path.join(drop,'followup-broken.json'),'{"type":"followup","title":"half wri');
  const srv=spawn(process.execPath,['--no-warnings','src/server.ts'],{cwd:root,env:{...process.env,HQ_PORT:'18880',HQ_NO_WATCH:'1'},windowsHide:true,stdio:'ignore'});
  try{
    await new Promise(r=>setTimeout(r,7000));
    const loop=JSON.parse(fs.readFileSync(path.join(runs,'qa-loop.json'),'utf8')), once=JSON.parse(fs.readFileSync(path.join(runs,'qa-once.json'),'utf8'));
    assert.equal(loop.status,'failed'); assert.equal(loop.restarts,3); assert.match(loop.error,/restarted 3 times/);
    assert.notEqual(once.status,'failed'); assert.equal(once.restarts,1);
    assert.ok(!fs.existsSync(path.join(drop,'followup-broken.json'))); const bad=fs.readdirSync(path.join(drop,'bad')); assert.equal(bad.length,1);
    assert.match(fs.readFileSync(path.join(root,'data','activity.jsonl'),'utf8'),/drop-unreadable/);
    return {loop:loop.status,once:once.status,bad};
  } finally { spawnSync('taskkill',['/pid',String(srv.pid),'/T','/F'],{windowsHide:true}); }});
sink.close();
for(const r of results) console.log(r[0],r[1],r[0]==='FAIL'||typeof r[2]==='object'?JSON.stringify(r[2]).slice(0,500):'');
console.log(results.filter(r=>r[0]==='PASS').length+' passed, '+results.filter(r=>r[0]==='FAIL').length+' failed');
process.exit(0);
