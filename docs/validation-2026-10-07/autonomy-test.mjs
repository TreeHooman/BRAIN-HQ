// Autonomy phases 1-4 checks (2026-10-07). Run on a COPY of HQ (same layout as phase0-test.mjs), never the live folder:
//   cd <tmp>/HQ && node --no-warnings <path>/autonomy-test.mjs
// Needs docs/validation-2026-10-05/fake-cli.mjs copied to <tmp>/HQ/fake-cli.mjs. No real model calls.
import fs from 'node:fs'; import path from 'node:path'; import assert from 'node:assert/strict'; import http from 'node:http'; import {spawn,spawnSync} from 'node:child_process'; import {pathToFileURL} from 'node:url';
const root=process.cwd(), results=[], PORT=18882, delay=ms=>new Promise(r=>setTimeout(r,ms));
const test=async(n,fn)=>{try{const d=await fn();results.push(['PASS',n,d??'']);}catch(e){results.push(['FAIL',n,String(e.stack||e).slice(0,600)]);}};
const sink=http.createServer((q,s)=>{q.resume();q.on('end',()=>s.end('ok'));});await new Promise(r=>sink.listen(18881,'127.0.0.1',r));
const env={...process.env,HQ_FAKE_CLAUDE:path.join(root,'fake-cli.mjs'),HQ_FAKE_CODEX:path.join(root,'fake-cli.mjs'),HQ_PORT:String(PORT),HQ_NO_WATCH:'1'};
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8').replace(/^\uFEFF/,''));
// Call hq-brain tools the way an agent run would.
function brainTools(runId,calls){const input=calls.map((c,i)=>JSON.stringify({jsonrpc:'2.0',id:i+1,method:'tools/call',params:{name:c[0],arguments:c[1]}})).join('\n')+'\n';
  const p=spawnSync(process.execPath,['--no-warnings','src/mcp/hq-brain.ts'],{cwd:root,env:{...env,HQ_LEVEL:'plan',HQ_RUN_ID:runId},input,encoding:'utf8',timeout:15000,windowsHide:true});
  return p.stdout.trim().split('\n').map(l=>JSON.parse(l)).sort((a,b)=>a.id-b.id).map(r=>r.result?.content?.[0]?.text||JSON.stringify(r));}
let server,ck='';
const api=async(p,body,method)=>{const r=await fetch(`http://127.0.0.1:${PORT}/api${p}`,{method:method||(body?'POST':'GET'),headers:{'X-HQ':'1','Content-Type':'application/json',Cookie:ck},body:body?JSON.stringify(body):undefined});const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(JSON.stringify(j));return j;};
const until=async(fn,ms=15000)=>{const end=Date.now()+ms;while(Date.now()<end){try{const x=await fn();if(x)return x;}catch{}await delay(250);}throw Error('Timed out');};
async function start(){server=spawn(process.execPath,['--no-warnings','src/server.ts'],{cwd:root,env,windowsHide:true,stdio:'ignore'});
  await until(async()=>{const r=await fetch(`http://127.0.0.1:${PORT}/api/access/unlock`,{method:'POST',headers:{'X-HQ':'1','Content-Type':'application/json'},body:'{"pin":"4321"}'});ck=(r.headers.get('set-cookie')||'').split(';')[0];return r.ok;});}
const kick=()=>api('/tasks',{text:'QA kick',tier:'fast'});
const drop=(name,obj)=>{fs.mkdirSync(path.join(root,'data','drop'),{recursive:true});fs.writeFileSync(path.join(root,'data','drop',name+'.json'),JSON.stringify(obj));};
try{
  await start();
  await api('/projects',{name:'QA Auto',slug:'qa-auto',summary:'Synthetic.'});
  await api('/project/qa-auto/doc/summary',{content:['# QA Auto','Line one about the product.','Line two about users.','Line three about pricing.','Line four about risks.','Line five about the team.','Line six about launch.'].join('\n')},'PUT');

  await test('Background run: routine changes apply and are recorded',async()=>{
    const out=brainTools('run-bg1',[['project_log',{slug:'qa-auto',text:'QA routine log'}],['project_update',{slug:'qa-auto',fields:{nextStep:'QA next',health:'watch'}}]]);
    assert.match(out[0],/Logged/); assert.match(out[1],/Updated/);
    assert.equal(read('brain/projects/qa-auto/project.json').nextStep,'QA next');
    const ch=(await api('/brain-changes?project=qa-auto')).changes; assert.ok(ch.length>=2); assert.equal(ch[0].actor,'mission'); return ch.map(c=>c.summary);});
  await test('Background run: non-routine changes wait for the owner',async()=>{
    const out=brainTools('run-bg2',[['project_update',{slug:'qa-auto',fields:{stage:'live'}}],['project_update',{slug:'qa-auto',fields:{paths:['C:/x']}}],['project_write',{slug:'qa-auto',part:'summary',content:'# QA Auto\nTotally different.\n'}]]);
    for(const o of out) assert.match(o,/Not applied/);
    assert.notEqual(read('brain/projects/qa-auto/project.json').stage,'live'); assert.match(fs.readFileSync(path.join(root,'brain/projects/qa-auto/SUMMARY.md'),'utf8'),/Line six/);
    await kick(); const aps=await until(async()=>{const a=read('data/approvals.json').filter(x=>x.brainOp&&x.status==='pending');return a.length===3&&a;});
    return aps.map(a=>a.title);});
  await test('Small summary edit by a background run is routine',async()=>{
    const cur=fs.readFileSync(path.join(root,'brain/projects/qa-auto/SUMMARY.md'),'utf8');
    assert.match(brainTools('run-bg3',[['project_write',{slug:'qa-auto',part:'summary',content:cur.replace('Line six about launch.','Line six about launch (moved to May).')}]])[0],/Wrote/);});
  await test('Owner chat applies non-routine changes directly (still recorded)',async()=>{
    assert.match(brainTools('chat-qa',[['project_update',{slug:'qa-auto',fields:{stage:'building'}}]])[0],/Updated/);
    assert.equal(read('brain/projects/qa-auto/project.json').stage,'building'); assert.equal((await api('/brain-changes?project=qa-auto')).changes[0].actor,'assistant');});
  await test('Approving a brain change applies it, recorded as approved',async()=>{
    const a=read('data/approvals.json').find(x=>x.brainOp?.args?.fields?.stage==='live'); await api('/approvals/'+a.id,{approve:true});
    await until(()=>read('brain/projects/qa-auto/project.json').stage==='live');
    const c=(await api('/brain-changes?project=qa-auto')).changes[0]; assert.equal(c.approvedBy,'owner');
    const b=read('data/approvals.json').find(x=>x.brainOp?.args?.fields?.paths); await api('/approvals/'+b.id,{approve:false}); assert.deepEqual(read('brain/projects/qa-auto/project.json').paths||[],[]);});
  await test('Undo restores; a file changed since is left alone',async()=>{
    const ch=(await api('/brain-changes?project=qa-auto')).changes;
    const live=ch.find(c=>c.approvedBy==='owner'); const r=await api(`/brain-changes/${live.id}/undo`,{});
    assert.deepEqual(r.conflicts,[]); assert.equal(read('brain/projects/qa-auto/project.json').stage,'building');
    const log=ch.find(c=>/QA routine log/.test(c.summary)); const r2=await api(`/brain-changes/${log.id}/undo`,{});
    assert.ok(r2.conflicts.length>=1,'project.json changed since → conflict'); return {r,r2};});
  await test('Rule on trial notes but still asks; rejection keeps it on trial',async()=>{
    const rule=await api('/autonomy/rules',{project:'qa-auto',maxPermission:'plan'}); assert.equal(rule.state,'trial');
    drop('followup-t1',{type:'followup',fromRun:'run-sched-1',fromLevel:'plan',title:'QA trial task',prompt:'QA_TRIAL',project:'qa-auto',permission:'plan'});
    await kick(); const a=await until(()=>read('data/approvals.json').find(x=>x.title.includes('QA trial task')));
    assert.equal(a.trialRule,rule.id); assert.match(a.detail,/would have started/);
    await api('/approvals/'+a.id,{approve:false}); const r=(await api('/autonomy')).rules.find(x=>x.id===rule.id); assert.ok(r.trialFailed); assert.equal(r.state,'trial'); return r;});
  let autoRun, ruleId;
  await test('Live rule starts the task on its own (as a Task)',async()=>{
    const rule=(await api('/autonomy')).rules[0]; ruleId=rule.id; await api('/autonomy/rules/'+rule.id,{state:'live'},'PATCH');
    drop('followup-t2',{type:'followup',fromRun:'run-sched-2',fromLevel:'plan',title:'QA live task',prompt:'QA_LIVE',project:'qa-auto',permission:'plan'});
    await kick(); autoRun=await until(async()=>(await api('/tasks')).tasks.find(t=>t.title==='QA live task'));
    assert.ok(!read('data/approvals.json').some(x=>x.title.includes('QA live task')));
    const run=read(`data/runs/${autoRun.id}.json`); assert.equal(run.autoRule,rule.id); assert.equal(run.taskId,run.id); return {task:autoRun.id};});
  await test('Build tasks need the project on the build list',async()=>{
    const {match}=await import(pathToFileURL(path.join(root,'src/lib/autonomy.ts')));
    const br=await api('/autonomy/rules',{project:'qa-auto',maxPermission:'build'}); await api('/autonomy/rules/'+br.id,{state:'live'},'PATCH');
    assert.equal(match({project:'qa-auto',permission:'build',title:'x'}),null,'not on the build list');
    await api('/autonomy/build-projects',{projects:['qa-auto']});
    assert.equal(match({project:'qa-auto',permission:'build',title:'x'})?.rule.id,br.id);
    await api('/autonomy/rules/'+br.id,{},'DELETE'); await api('/autonomy/build-projects',{projects:[]});
    // A follow-up from an unknown background run is capped at plan, so a build request can never ride a rule upward.
    drop('followup-b1',{type:'followup',fromRun:'run-sched-3',fromLevel:'build',title:'QA build task',prompt:'QA_B',project:'qa-auto',permission:'build'});
    await kick(); const t=await until(async()=>(await api('/tasks')).tasks.find(x=>x.title==='QA build task')); assert.equal(read(`data/runs/${t.id}.json`).permission,'plan');});
  await test('Task budget stops extra sub-agents and notes it',async()=>{
    const cfg=read('config/hq.local.json'); cfg.tasks={...(cfg.tasks||{}),maxSubtasks:2}; fs.writeFileSync(path.join(root,'config/hq.local.json'),JSON.stringify(cfg));
    drop('followup-s1',{type:'followup',fromRun:autoRun.id,fromLevel:'plan',title:'QA sub 1',prompt:'QA_SUB1',project:'qa-auto',permission:'plan'});
    await kick(); await until(()=>Object.values(fs.readdirSync(path.join(root,'data/runs')).filter(f=>f.endsWith('.json')).map(f=>read('data/runs/'+f))).some(r=>r.title==='QA sub 1'));
    drop('followup-s2',{type:'followup',fromRun:autoRun.id,fromLevel:'plan',title:'QA sub 2',prompt:'QA_SUB2',project:'qa-auto',permission:'plan'});
    await kick(); const root2=await until(()=>{const r=read(`data/runs/${autoRun.id}.json`);return r.budgetNote&&r;});
    assert.match(root2.budgetNote,/2 agents/); return root2.budgetNote;});
  await test('Undoing a rule-started task\'s brain change turns the rule off',async()=>{
    brainTools(autoRun.id,[['project_log',{slug:'qa-auto',text:'QA auto-task log'}]]);
    const c=(await api('/brain-changes?project=qa-auto')).changes.find(x=>x.run===autoRun.id); const r=await api(`/brain-changes/${c.id}/undo`,{});
    assert.equal(r.ruleTurnedOff,ruleId); const rule=(await api('/autonomy')).rules.find(x=>x.id===ruleId); assert.equal(rule.state,'off'); assert.match(rule.offReason,/you undid/); return rule.offReason;});
  await test('LUTHUR suggests a rule after 5 approvals; accepting adds it on trial',async()=>{
    const f=path.join(root,'data/autonomy/decisions.jsonl'); for(let i=0;i<5;i++) fs.appendFileSync(f,JSON.stringify({at:new Date().toISOString(),key:'*|read',approve:true,title:'QA read '+i,project:null,permission:'read',engine:null})+'\n');
    const s=(await api('/autonomy')).suggestions.find(x=>x.key==='*|read'); assert.ok(s); const r=await api('/autonomy/suggestion',{key:s.key,accept:true}); assert.equal(r.source,'suggested'); assert.equal(r.state,'trial');
    assert.ok(!(await api('/autonomy')).suggestions.some(x=>x.key==='*|read'));});
  await test('Background run cannot raise a project permission',async()=>{
    const out=brainTools('run-bg9',[['project_update',{slug:'qa-auto',fields:{maxPermission:'build'}}]]); assert.match(out[0],/Not applied/);});
}finally{ if(server) spawnSync('taskkill',['/pid',String(server.pid),'/T','/F'],{windowsHide:true}); sink.close(); }
for(const r of results) console.log(r[0],r[1],r[0]==='FAIL'?r[2]:'');
console.log(results.filter(r=>r[0]==='PASS').length+' passed, '+results.filter(r=>r[0]==='FAIL').length+' failed');
process.exit(0);
