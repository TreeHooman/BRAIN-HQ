// Evening debrief checks (2026-10-08). Run on a COPY of HQ, never the live folder (same layout as verify-test.mjs:
// fake-verify-cli.mjs copied in as <tmp>/HQ/fake-cli.mjs).   cd <tmp>/HQ && node --no-warnings <path>/debrief-test.mjs
// Sets the copy's debrief hour to 0 so the first tick writes it. No real model calls.
import fs from 'node:fs'; import path from 'node:path'; import assert from 'node:assert/strict'; import {spawn} from 'node:child_process'; import {pathToFileURL} from 'node:url';
const root=process.cwd(), results=[], PORT=18885, delay=ms=>new Promise(r=>setTimeout(r,ms));
if(!fs.existsSync(path.join(root,'fake-cli.mjs'))||/Project Secrets[\\/]HQ$/.test(root)) throw Error('Run this in a COPY of HQ that has fake-cli.mjs');
const test=async(n,fn)=>{try{const d=await fn();results.push(['PASS',n,d??'']);}catch(e){results.push(['FAIL',n,String(e.stack||e).slice(0,600)]);}};
const env={...process.env,HQ_FAKE_CLAUDE:path.join(root,'fake-cli.mjs'),HQ_FAKE_CODEX:path.join(root,'fake-cli.mjs'),HQ_PORT:String(PORT),HQ_NO_WATCH:'1'};
const write=(p,v)=>{fs.mkdirSync(path.dirname(path.join(root,p)),{recursive:true});fs.writeFileSync(path.join(root,p),JSON.stringify(v,null,2));};
const pad=n=>String(n).padStart(2,'0'), ymd=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const today=ymd(new Date()), tomorrow=ymd(new Date(Date.now()+864e5));

write('brain/projects/qa-deb/project.json',{name:'QA Debrief',kind:'product',stage:'building',health:'good',summary:'QA',nextStep:'',updated:today,paths:[],maxPermission:'build'});
write('brain/milestones.json',[{id:'mq',date:tomorrow,title:'QA launch day',project:'qa-deb'}]);
write('brain/reminders.json',[{id:'rq',title:'Call the QA bank',due:`${tomorrow}T09:30`,done:false,createdAt:new Date().toISOString()},{id:'ro',title:'Old thing',due:'2020-01-01T09:00',done:false,notifiedAt:'2020-01-01T09:00:00Z',createdAt:'2020-01-01T00:00:00Z'}]);
const local=JSON.parse(fs.readFileSync(path.join(root,'config/hq.local.json'),'utf8')); local.debrief={hour:0}; write('config/hq.local.json',local);

const D=await import(pathToFileURL(path.join(root,'src/lib/debrief.ts')).href);
await test('Unit: wording, sections and the quiet-day case',async()=>{
  const b=D.compose({date:'2026-10-08',tasks:[{title:'A',status:'done',project:'p'},{title:'Initiative · B',status:'partly'},{title:'C',status:'issue'}],missionsDone:1,missionsFailed:[{title:'M',status:'timeout'}],
    waiting:[{title:'Start task: W'}],changes:[{summary:'Updated plan',project:'p'}],picks:[{title:'Initiative · B',outcome:'asked'}],tomorrow:[{title:'T',when:'09:30',kind:'reminder'}],overdue:2,projectName:s=>s.toUpperCase()});
  assert.match(b.headline,/3 tasks \(1 done, 1 partly done, 1 needs a look\), 2 background runs \(1 failed\), 1 note change, 1 idea picked, 1 waiting for you\./);
  for(const s of ['## Needs a look','⚠ C','⚠ M (ran out of time)','🟡 B','✅ A · P','## Waiting for your OK\n- W','B · asked you','📅 T · 09:30','2 reminders still overdue']) assert.ok(b.text.includes(s),s);
  assert.ok(b.text.indexOf('Needs a look')<b.text.indexOf('Finished'),'problems first');
  const q=D.compose({date:'2026-10-08',tasks:[],missionsDone:0,missionsFailed:[],waiting:[],changes:[],picks:[],tomorrow:[],overdue:0});
  assert.equal(q.empty,true); assert.match(q.text,/Nothing due/); return b.headline;});

let server,ck='';
const api=async(p,body,method)=>{const r=await fetch(`http://127.0.0.1:${PORT}/api${p}`,{method:method||(body?'POST':'GET'),headers:{'X-HQ':'1','Content-Type':'application/json',Cookie:ck},body:body?JSON.stringify(body):undefined});const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(JSON.stringify(j));return j;};
const until=async(fn,ms=60000)=>{const end=Date.now()+ms;while(Date.now()<end){try{const x=await fn();if(x)return x;}catch{}await delay(300);}throw Error('Timed out');};
const acts=()=>{try{return fs.readFileSync(path.join(root,'data/activity.jsonl'),'utf8').trim().split('\n').map(l=>JSON.parse(l)).filter(a=>a.event==='debrief');}catch{return [];}};
try{
  server=spawn(process.execPath,['--no-warnings','src/server.ts'],{cwd:root,env,windowsHide:true,stdio:'ignore'});
  await until(async()=>{const r=await fetch(`http://127.0.0.1:${PORT}/api/access/unlock`,{method:'POST',headers:{'X-HQ':'1','Content-Type':'application/json'},body:'{"pin":"4321"}'});ck=(r.headers.get('set-cookie')||'').split(';')[0];return r.ok;});
  await api('/initiative/settings',{enabled:false});

  await test('First tick after the hour writes it once; a quiet day sends no alert',async()=>{
    const a=await until(()=>acts()[0]); assert.equal(a.empty,true);
    assert.ok(fs.existsSync(path.join(root,'data/debriefs',today+'.md')));});
  await test('Tasks show up in "so far today" with tomorrow and overdue',async()=>{
    const t=await api('/tasks',{text:'QA_PARTLY do it',project:'qa-deb',permission:'plan'});
    await until(async()=>(await api('/tasks')).tasks.find(x=>x.id===t.id&&x.status==='partly'));
    const r=await api('/debrief'); const x=r.now.text;
    for(const s of ['🟡 QA_PARTLY do it · QA Debrief','📅 QA launch day · QA Debrief','📅 Call the QA bank · 09:30','1 reminder still overdue']) assert.ok(x.includes(s),s+'\n'+x);
    assert.equal(r.latest.date,today); return r.now.headline;});
  await test('Not sent twice the same day',async()=>{ await delay(32000); assert.equal(acts().length,1);});
  await test('Today page data carries the latest debrief',async()=>{ const s=await api('/state'); assert.equal(s.debrief?.date,today);});
} finally { server?.kill(); }
for(const [s,n,d] of results) console.log(s,n,s==='FAIL'?'\n   '+d:(d?'· '+JSON.stringify(d).slice(0,240):''));
console.log(`${results.filter(r=>r[0]==='PASS').length}/${results.length} passed`);
process.exit(results.some(r=>r[0]==='FAIL')?1:0);
