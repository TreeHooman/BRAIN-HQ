// Initiative loop checks (2026-10-08). Run on a COPY of HQ, never the live folder:
//   <tmp>/HQ (copy of src web config scripts brain, fresh data/, config/hq.local.json with toast off), fake-cli.mjs from
//   docs/validation-2026-10-05 copied to <tmp>/HQ/fake-cli.mjs.   cd <tmp>/HQ && node --no-warnings <path>/initiative-test.mjs
// It empties the copy's projects, goals, milestones, reminders and rules first. No real model calls.
import fs from 'node:fs'; import path from 'node:path'; import assert from 'node:assert/strict'; import {spawn} from 'node:child_process'; import {pathToFileURL} from 'node:url';
const root=process.cwd(), results=[], PORT=18883, delay=ms=>new Promise(r=>setTimeout(r,ms));
if(!fs.existsSync(path.join(root,'fake-cli.mjs'))||/Project Secrets[\\/]HQ$/.test(root)) throw Error('Run this in a COPY of HQ that has fake-cli.mjs');
const test=async(n,fn)=>{try{const d=await fn();results.push(['PASS',n,d??'']);}catch(e){results.push(['FAIL',n,String(e.stack||e).slice(0,600)]);}};
const env={...process.env,HQ_FAKE_CLAUDE:path.join(root,'fake-cli.mjs'),HQ_FAKE_CODEX:path.join(root,'fake-cli.mjs'),HQ_PORT:String(PORT),HQ_NO_WATCH:'1'};
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8').replace(/^\uFEFF/,''));
const write=(p,v)=>{fs.mkdirSync(path.dirname(path.join(root,p)),{recursive:true});fs.writeFileSync(path.join(root,p),JSON.stringify(v,null,2));};
const day=n=>{const d=new Date(Date.now()+n*864e5);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};

// A clean brain: four projects that each exercise one signal.
fs.rmSync(path.join(root,'brain','projects'),{recursive:true,force:true});
const proj=(slug,p)=>write(`brain/projects/${slug}/project.json`,{name:slug.toUpperCase(),kind:'product',stage:'building',health:'good',summary:'QA',nextStep:'',updated:day(0),paths:[],maxPermission:'build',...p});
proj('qa-due',{nextStep:'Tidy the docs.'});
proj('qa-owner',{nextStep:'Owner: decide the price.'});
proj('qa-next',{nextStep:'Write the one-page concept.',health:'risk'});
proj('qa-goal',{nextStep:''});
proj('qa-paused',{stage:'paused',nextStep:'Something to do.'});
proj('luthur',{nextStep:'Improve the War Room.',paths:['C:/x']});
write('brain/milestones.json',[{id:'m1',date:day(2),title:'QA launch',project:'qa-due'},{id:'m2',date:day(40),title:'Far away',project:'qa-owner'}]);
write('brain/reminders.json',[]);
write('brain/goals.json',[{id:'g1',title:'QA goal',project:'qa-goal',createdAt:new Date().toISOString(),steps:[{id:'s1',title:'Step one',done:true},{id:'s2',title:'Step two',dependsOn:['s1']},{id:'s3',title:'Step three',dependsOn:['s2']}]}]);
write('config/autonomy-rules.json',{rules:[],buildProjects:[],dismissed:{},initiative:{enabled:false}}); // no scan on the first tick

let server,ck='';
const api=async(p,body,method)=>{const r=await fetch(`http://127.0.0.1:${PORT}/api${p}`,{method:method||(body?'POST':'GET'),headers:{'X-HQ':'1','Content-Type':'application/json',Cookie:ck},body:body?JSON.stringify(body):undefined});const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(JSON.stringify(j));return j;};
const until=async(fn,ms=15000)=>{const end=Date.now()+ms;while(Date.now()<end){try{const x=await fn();if(x)return x;}catch{}await delay(250);}throw Error('Timed out');};
const pending=()=>read('data/approvals.json').filter(a=>a.status==='pending'&&a.fromRun==='initiative');
try{
  server=spawn(process.execPath,['--no-warnings','src/server.ts'],{cwd:root,env,windowsHide:true,stdio:'ignore'});
  await until(async()=>{const r=await fetch(`http://127.0.0.1:${PORT}/api/access/unlock`,{method:'POST',headers:{'X-HQ':'1','Content-Type':'application/json'},body:'{"pin":"4321"}'});ck=(r.headers.get('set-cookie')||'').split(';')[0];return r.ok;});
  // Keep the 30 s tick from scanning on its own mid-test.
  await api('/initiative/settings',{enabled:false});

  await test('Look now: picks the most urgent, one per project, asks when no rule is live',async()=>{
    const r=await api('/initiative/scan',{});
    assert.equal(r.picks.length,2,'maxPerScan is 2'); assert.equal(r.asked,2); assert.equal(r.started,0);
    assert.match(r.picks[0].title,/QA-DUE/); assert.match(r.picks[0].why,/QA launch/); assert.match(r.picks[1].title,/QA-NEXT/,'risk health beats a plain goal step');
    const aps=pending(); assert.equal(aps.length,2); assert.ok(aps.every(a=>a.kind==='task'&&a.initiative&&a.proposed.task));
    return r.picks;});
  await test('Owner-only next steps, paused projects and far deadlines are never picked',async()=>{
    const r=await api('/initiative/settings',{maxPerDay:10}); assert.equal(r.settings.maxPerDay,10);
    write('config/autonomy-rules.json',{...read('config/autonomy-rules.json')}); // unchanged
    const s=await api('/initiative/scan',{}); const titles=s.picks.map(p=>p.title).join('|');
    assert.doesNotMatch(titles,/QA-OWNER|QA-PAUSED/); assert.doesNotMatch(titles,/QA-DUE|QA-NEXT/,'busy: they have pending approvals');
    return titles;});
  await test('HQ itself is plan-only; goal steps respect dependencies',async()=>{
    const all=pending(); const lu=all.find(a=>a.project==='luthur'); const g=all.find(a=>a.project==='qa-goal');
    assert.ok(lu&&g,'both picked in the second scan'); assert.equal(lu.proposed.permission,'plan'); assert.match(g.detail,/Step two/); assert.doesNotMatch(g.detail,/Step three/);});
  await test('Rejecting a pick: not proposed again, shown as "you said no"',async()=>{
    const a=pending().find(x=>x.project==='qa-goal'); await api('/approvals/'+a.id,{approve:false});
    const st=read('data/initiative.json'); assert.ok(Date.parse(st.seen[a.initiative])-Date.now()>20*864e5,'30-day hold');
    assert.equal((await api('/initiative')).recent.find(e=>e.ref===a.id).outcome,'rejected');
    const s=await api('/initiative/scan',{}); assert.ok(!s.picks.some(p=>/QA-GOAL/.test(p.title)));});
  await test('Approving a pick runs it as a Task with the initiative prompt',async()=>{
    const a=pending().find(x=>x.project==='qa-next'); await api('/approvals/'+a.id,{approve:true});
    const t=await until(async()=>(await api('/tasks')).tasks.find(x=>x.project==='qa-next'&&x.status==='done'),20000);
    const run=read(`data/runs/${t.id}.json`); assert.equal(run.permission,'plan'); assert.match(run.prompt,/LUTHUR initiative/); assert.match(run.prompt,/Why now/); return t.title;});
  await test('A live rule starts picks on its own; build only for listed projects with folders',async()=>{
    for(const a of pending()) await api('/approvals/'+a.id,{approve:false});
    proj('qa-build',{nextStep:'Add a test for the parser.',paths:['C:/qa']}); proj('qa-build2',{nextStep:'Add a test for the lexer.',paths:['C:/qb']});
    const rule=await api('/autonomy/rules',{maxPermission:'build'}); await api('/autonomy/rules/'+rule.id,{state:'live'},'PATCH');
    await api('/autonomy/build-projects',{projects:['qa-build','luthur']});
    const s=await api('/initiative/scan',{}); assert.equal(s.asked,0); assert.ok(s.started>=1);
    const runs=fs.readdirSync(path.join(root,'data/runs')).filter(f=>f.endsWith('.json')).map(f=>read('data/runs/'+f)).filter(r=>r.trigger==='initiative');
    assert.ok(runs.every(r=>r.autoRule===rule.id&&r.taskId===r.id));
    const b=runs.find(r=>r.project==='qa-build'), b2=runs.find(r=>r.project==='qa-build2');
    if(b) assert.equal(b.permission,'build'); if(b2) assert.equal(b2.permission,'plan','not on the build list');
    assert.ok(b||b2); return runs.map(r=>`${r.project}:${r.permission}`);});
  await test('Daily cap, off switch and hours stop scheduled scans',async()=>{
    const {due}=await import(pathToFileURL(path.join(root,'src/lib/initiative.ts')));
    await api('/initiative/settings',{enabled:true,everyHours:1,maxPerDay:20,fromHour:8,toHour:22});
    const st=read('data/initiative.json'); st.lastScan=new Date(Date.now()-3*864e5).toISOString(); write('data/initiative.json',st);
    const at=h=>{const d=new Date();d.setHours(h,0,0,0);return d;};
    assert.equal(due(at(12)),true); assert.equal(due(at(3)),false,'outside hours');
    await api('/initiative/settings',{enabled:false}); assert.equal(due(at(12)),false,'off');
    await api('/initiative/settings',{enabled:true,maxPerDay:st.day.count}); assert.equal(due(at(12)),false,'cap reached');
    const s=await api('/initiative/scan',{}); assert.equal(s.picks.length,0,'Look now keeps the daily cap');
    await api('/initiative/settings',{enabled:false});});
  await test('Settings are clamped and stored with the owner-only rules',async()=>{
    const r=await api('/initiative/settings',{everyHours:999,maxPerScan:0}); assert.equal(r.settings.everyHours,48); assert.equal(r.settings.maxPerScan,1);
    assert.equal(read('config/autonomy-rules.json').initiative.everyHours,48);});
} finally { server?.kill(); }
for(const [s,n,d] of results) console.log(s,n,s==='FAIL'?'\n   '+d:(d?'· '+JSON.stringify(d).slice(0,200):''));
console.log(`${results.filter(r=>r[0]==='PASS').length}/${results.length} passed`);
process.exit(results.some(r=>r[0]==='FAIL')?1:0);
