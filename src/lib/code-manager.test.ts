import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {delegation,manageCode} from './code-manager.ts';
import {codeSettings} from './code-settings.ts';
import {DATA} from './store.ts';
import type {RunResult} from './claude.ts';

const tasks=(v:unknown)=>`Reply <luthur_tasks>${typeof v==='string'?v:JSON.stringify(v)}</luthur_tasks>`;

test('delegation: no block means no workers',()=>{
 assert.deepEqual(delegation('just chat'),{reply:'just chat',jobs:[],notes:[]});
});
test('delegation: valid plan',()=>{
 const r=delegation(tasks([{title:'A',task:'do a'},{title:'B',task:'do b'}]));
 assert.equal(r.reply,'Reply');assert.deepEqual(r.jobs,[{title:'A',task:'do a'},{title:'B',task:'do b'}]);assert.deepEqual(r.notes,[]);
});
test('delegation: long task is kept whole',()=>{
 const long='x'.repeat(10000);
 assert.equal(delegation(tasks([{title:'A',task:long}])).jobs[0].task,long);
});
test('delegation: code fence, {tasks}, bare object and unclosed tag are read',()=>{
 assert.equal(delegation('Hi <luthur_tasks>\n```json\n[{"title":"A","task":"go"}]\n```\n</luthur_tasks>').jobs.length,1);
 assert.equal(delegation(tasks({tasks:[{title:'A',task:'go'}]})).jobs.length,1);
 assert.equal(delegation(tasks({title:'A',task:'go'})).jobs.length,1);
 const open=delegation('Hi <luthur_tasks>[{"title":"A","task":"go"}]');
 assert.equal(open.reply,'Hi');assert.equal(open.jobs.length,1);
});
test('delegation: invalid JSON means no workers, with a note',()=>{
 const r=delegation(tasks('[{title: oops}]'));
 assert.equal(r.reply,'Reply');assert.deepEqual(r.jobs,[]);assert.equal(r.notes.length,1);
});
test('delegation: blank tasks skipped, titles fall back, long titles cut',()=>{
 const r=delegation(tasks([{title:'',task:'one'},{role:'Tester',task:'two'},{title:'B',task:''},{title:'T'.repeat(300),task:'three'}]));
 assert.deepEqual(r.jobs.map(j=>j.title),['Worker 1','Tester','T'.repeat(100)]);
 assert.match(r.notes.join(' '),/1 empty/);
});
test('delegation: workers over the limit are dropped',()=>{
 const plan=Array.from({length:8},(_,i)=>({title:'T'+i,task:'do '+i}));
 const r=delegation(tasks(plan),6);
 assert.equal(r.jobs.length,6);assert.match(r.notes.join(' '),/8 workers/);
 assert.deepEqual(delegation(tasks(plan),0).jobs,[]);
});

// End to end: a scripted runner plays manager, workers and reviewer. Uses a throwaway workroom under data/.
const ok=(text:string):RunResult=>({ok:true,text,sessionId:null,durationMs:1,kind:'ok',stats:null});
function room(){const key='test-'+Math.random().toString(36).slice(2,10);return {key,dir:path.join(DATA,'code','workrooms',key)};}
function flow(key:string,text:string,replies:RunResult[],settings={orchestration:'managed',maxWorkers:2,maxCalls:4}){
 const prompts:{role:string;prompt:string}[]=[];
 const run=async(spec:{prompt:string;role:string})=>{prompts.push({role:spec.role,prompt:spec.prompt});const r=replies.shift();if(!r)throw Error('unexpected call: '+spec.role);return r;};
 const result=manageCode({settings:codeSettings(settings as any),key,project:'test',text,history:'',provider:'claude',choice:{},system:'',timeoutMs:60000,cancelled:()=>false,edited:()=>true,run});
 return {result,prompts};
}

test('manageCode: workers get the full owner request; plan and report are written',async()=>{
 const {key,dir}=room();
 try{
  const text='Build it. '+'detail '.repeat(1000);
  const {result,prompts}=flow(key,text,[ok(tasks([{title:'W1',task:'part one'}])),ok('worker done'),ok('review done')]);
  const r=await result;
  assert.equal(r.text,'review done');
  assert.ok(prompts[1].prompt.includes(text),'worker saw the whole request');
  assert.match(fs.readFileSync(path.join(dir,'PLAN.md'),'utf8'),/## 1\. W1\npart one/);
  assert.match(fs.readFileSync(path.join(dir,'REPORT.md'),'utf8'),/review done/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('manageCode: dropped workers are told in chat and recorded in PLAN.md',async()=>{
 const {key,dir}=room();
 try{
  const plan=Array.from({length:4},(_,i)=>({title:'W'+i,task:'t'+i}));
  const {result,prompts}=flow(key,'Build it',[ok(tasks(plan)),ok('w0'),ok('w1'),ok('review')]);
  const r=await result;
  assert.equal(prompts.length,4,'2 workers plus manager and review');
  assert.match(r.text,/^_Plan adjusted: Plan had 4 workers/);
  assert.match(fs.readFileSync(path.join(dir,'PLAN.md'),'utf8'),/## Adjustments/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('manageCode: a failed worker pauses the run and keeps the notice',async()=>{
 const {key,dir}=room();
 try{
  const plan=Array.from({length:3},(_,i)=>({title:'W'+i,task:'t'+i}));
  const {result,prompts}=flow(key,'Build it',[ok(tasks(plan)),{...ok('boom'),ok:false,kind:'error'}]);
  const r=await result;
  assert.equal(prompts.length,2,'no more workers after the failure');
  assert.match(r.text,/^_Plan adjusted:.*\n\nWork paused: error/s);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('manageCode: unreadable plan finishes without workers',async()=>{
 const {key,dir}=room();
 try{
  const {result,prompts}=flow(key,'Build it',[ok(tasks('[{nope')),ok('review')]);
  const r=await result;
  assert.equal(prompts.length,2,'manager plus solo review');
  assert.match(r.text,/not readable JSON/);
  assert.ok(!r.text.includes('luthur_tasks'));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
