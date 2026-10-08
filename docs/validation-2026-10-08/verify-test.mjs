// Verify-before-done checks (2026-10-08). Run on a COPY of HQ, never the live folder:
//   <tmp>/HQ (copy of src web config scripts brain, fresh data/, config/hq.local.json with toast off), plus
//   fake-verify-cli.mjs from this folder copied to <tmp>/HQ/fake-cli.mjs.   cd <tmp>/HQ && node --no-warnings <path>/verify-test.mjs
// Makes a throwaway project folder next to the copy (<tmp>/qa-proj) with an npm test that fails when fail.flag exists.
import fs from 'node:fs'; import path from 'node:path'; import assert from 'node:assert/strict'; import {spawn} from 'node:child_process'; import {pathToFileURL} from 'node:url';
const root=process.cwd(), results=[], PORT=18884, delay=ms=>new Promise(r=>setTimeout(r,ms));
if(!fs.existsSync(path.join(root,'fake-cli.mjs'))||/Project Secrets[\\/]HQ$/.test(root)) throw Error('Run this in a COPY of HQ that has fake-cli.mjs');
const test=async(n,fn)=>{try{const d=await fn();results.push(['PASS',n,d??'']);}catch(e){results.push(['FAIL',n,String(e.stack||e).slice(0,600)]);}};
const env={...process.env,HQ_FAKE_CLAUDE:path.join(root,'fake-cli.mjs'),HQ_FAKE_CODEX:path.join(root,'fake-cli.mjs'),HQ_PORT:String(PORT),HQ_NO_WATCH:'1'};
const write=(p,v)=>{fs.mkdirSync(path.dirname(path.join(root,p)),{recursive:true});fs.writeFileSync(path.join(root,p),JSON.stringify(v,null,2));};

const proj=path.join(path.dirname(root),'qa-proj');
fs.rmSync(proj,{recursive:true,force:true}); fs.mkdirSync(path.join(proj,'node_modules'),{recursive:true});
fs.writeFileSync(path.join(proj,'package.json'),JSON.stringify({name:'qa',scripts:{test:'node check.js'}}));
fs.writeFileSync(path.join(proj,'check.js'),"process.exit(require('fs').existsSync('fail.flag')?1:0)");
fs.writeFileSync(path.join(proj,'node_modules','junk.js'),'1');
write('brain/projects/qa-verify/project.json',{name:'QA Verify',kind:'product',stage:'building',health:'good',summary:'QA',nextStep:'',updated:'2026-10-08',paths:[proj],maxPermission:'build'});
write('brain/projects/qa-plan/project.json',{name:'QA Plan',kind:'product',stage:'building',health:'good',summary:'QA',nextStep:'',updated:'2026-10-08',paths:[proj],maxPermission:'build'});

const V=await import(pathToFileURL(path.join(root,'src/lib/verify.ts')).href);
await test('Unit: diff skips node_modules/logs and labels new, changed and deleted files',async()=>{
  const a=V.snapshot([proj]); fs.writeFileSync(path.join(proj,'new.py'),'1'); fs.writeFileSync(path.join(proj,'check.js'),fs.readFileSync(path.join(proj,'check.js'),'utf8')+'\n');
  fs.writeFileSync(path.join(proj,'node_modules','junk.js'),'2'); fs.writeFileSync(path.join(proj,'x.log'),'log');
  const d=V.diff(a,V.snapshot([proj]),[proj]); assert.deepEqual(d,['qa-proj/check.js','qa-proj/new.py (new)']);
  fs.unlinkSync(path.join(proj,'new.py')); fs.unlinkSync(path.join(proj,'x.log'));
  assert.deepEqual(V.diff(V.snapshot([proj]),new Map([...V.snapshot([proj]),[path.join(proj,'gone.py'),'h']]),[proj]),['qa-proj/gone.py (new)']); return d;});
await test('Unit: report comparison',async()=>{
  const r=t=>V.compareReport(t,['qa-proj/app.py'],[]);
  assert.equal(r('**What I did:**\n- Edited app.py.').mismatches.length,0);
  assert.match(r('**What I did:**\n- Edited app.py and main.py.').mismatches.join(),/main\.py/);
  assert.equal(r('**What I did:**\n- Updated the brain log.md and project_log.').mismatches.length,0,'brain files are not project files');
  assert.match(V.compareReport('**What I did:**\n- Fixed the bug in the code.',[],[]).mismatches.join(),/no file/);
  assert.equal(V.compareReport('**What I did:**\n- Researched options.',[],[]).mismatches.length,0);
  assert.match(r('**What I did:**\n- Done.').notes.join(),/app\.py/);
  assert.match(V.compareReport('All tests pass.',['qa-proj/app.py'],[{ok:false}]).mismatches.join(),/tests pass/);});
await test('Unit: finds npm test; owner list wins',async()=>{
  assert.deepEqual(V.findChecks(proj,'qa-verify').cmds,['npm test --silent']);
  assert.deepEqual(V.findChecks(path.dirname(proj),'none').cmds,[]);});

let server,ck='';
const api=async(p,body,method)=>{const r=await fetch(`http://127.0.0.1:${PORT}/api${p}`,{method:method||(body?'POST':'GET'),headers:{'X-HQ':'1','Content-Type':'application/json',Cookie:ck},body:body?JSON.stringify(body):undefined});const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(JSON.stringify(j));return j;};
const until=async(fn,ms=60000)=>{const end=Date.now()+ms;while(Date.now()<end){try{const x=await fn();if(x)return x;}catch{}await delay(300);}throw Error('Timed out');};
const task=async(text,project='qa-verify',permission='build')=>{const t=await api('/tasks',{text,project,permission});
  return until(async()=>{const x=(await api('/tasks')).tasks.find(y=>y.id===t.id);return x&&!['queued','running','paused'].includes(x.status)?x:null;});};
try{
  server=spawn(process.execPath,['--no-warnings','src/server.ts'],{cwd:root,env,windowsHide:true,stdio:'ignore'});
  await until(async()=>{const r=await fetch(`http://127.0.0.1:${PORT}/api/access/unlock`,{method:'POST',headers:{'X-HQ':'1','Content-Type':'application/json'},body:'{"pin":"4321"}'});ck=(r.headers.get('set-cookie')||'').split(';')[0];return r.ok;});
  await api('/initiative/settings',{enabled:false});

  await test('Truthful build task: done, checks ran and passed, summary in the report',async()=>{
    const t=await task('QA_EDIT add x'); const r=t.runs[0];
    assert.equal(t.status,'done'); assert.equal(r.verify.ok,true); assert.equal(r.verify.changed,1); assert.equal(r.verify.checks,1);
    assert.match(r.output,/Checked by HQ:\*\* ✓/); assert.match(r.output,/npm test --silent` passed/); return r.output.split('\n').slice(-3);});
  await test('Claimed edit with no change: needs a look',async()=>{
    const t=await task('QA_LIE fix it'); const r=t.runs[0];
    assert.equal(t.status,'issue'); assert.equal(r.status,'done'); assert.equal(r.verify.ok,false); assert.match(r.verify.mismatches.join(),/no file/); return r.verify.mismatches;});
  await test('Unreported change: still done, noted',async()=>{
    const t=await task('QA_QUIET tidy'); assert.equal(t.status,'done'); assert.match(t.runs[0].output,/Also changed.*app\.py/);});
  await test('Failing check + "tests pass" claim: needs a look with the check output',async()=>{
    const t=await task('QA_BREAK change'); const r=t.runs[0];
    assert.equal(t.status,'issue'); assert.match(r.output,/✗ `npm test --silent` failed/); assert.match(r.verify.mismatches.join(),/tests pass/);
    fs.unlinkSync(path.join(proj,'fail.flag'));});
  await test('Owner reply that fixes it clears "needs a look" (latest check counts)',async()=>{
    const t=await task('QA_LIE again'); assert.equal(t.status,'issue');
    await api(`/tasks/${t.id}/reply`,{text:'QA_EDIT do it for real'});
    const x=await until(async()=>{const y=(await api('/tasks')).tasks.find(z=>z.id===t.id);return y&&y.runs.length===2&&!['queued','running'].includes(y.status)?y:null;});
    assert.equal(x.status,'done');});
  await test('Plan-level task: not checked',async()=>{
    const t=await task('QA_EDIT plan only','qa-plan','plan'); assert.equal(t.runs[0].verify,undefined); assert.doesNotMatch(t.runs[0].output||'',/Checked by HQ/);});
  await test('Build prompt tells the agent it will be checked',async()=>{
    const calls=fs.readFileSync(path.join(root,'data','fake-calls.jsonl'),'utf8').trim().split('\n').map(l=>JSON.parse(l));
    assert.ok(calls.some(c=>/HQ checks build work after you finish/.test(c.prompt)));});
} finally { server?.kill(); }
for(const [s,n,d] of results) console.log(s,n,s==='FAIL'?'\n   '+d:(d?'· '+JSON.stringify(d).slice(0,240):''));
console.log(`${results.filter(r=>r[0]==='PASS').length}/${results.length} passed`);
process.exit(results.some(r=>r[0]==='FAIL')?1:0);
