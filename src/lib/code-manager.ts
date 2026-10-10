import fs from 'node:fs';
import type {CodeSettings} from './code-settings.ts';
import path from 'node:path';
import {DATA} from './store.ts';
import {resolveModel,heavyRequest,type ModelChoice} from './model-policy.ts';
import type {RunResult} from './claude.ts';

const folder=(key:string)=>{if(!/^[a-z0-9-]{1,60}$/.test(key))throw Error('Bad workroom id');return path.join(DATA,'code','workrooms',key);};
const clip=(text:unknown,n:number)=>String(text??'').slice(0,n);
export const codeWork=(text:string)=>heavyRequest(text)||/\b(add|change|update|remove|rename|create|make|improve|optimize|replace|continue|proceed)\b/i.test(text)||/^\s*(go ahead|do it|carry on|finish it)\b/i.test(text);
function write(key:string,file:string,text:string){fs.mkdirSync(folder(key),{recursive:true});fs.writeFileSync(path.join(folder(key),file),text,'utf8');}
function read(key:string,file:string,n=6000){try{return fs.readFileSync(path.join(folder(key),file),'utf8').slice(0,n);}catch{return '';}}
export function workroom(key:string){folder(key);return {brief:read(key,'BRIEF.md',20000),status:read(key,'STATUS.md',20000),plan:read(key,'PLAN.md',20000),report:read(key,'REPORT.md',20000),handoff:read(key,'HANDOFF.md',20000)};}
type Job={title:string;task:string};
export const MAX_WORKERS=6;
// Forgiving on purpose (owner, 2026-10-10): a slightly malformed plan used to throw and discard the manager's whole
// reply. Now blank entries are skipped, task length is uncapped, extra workers dropped, and unreadable JSON means "no workers".
export function delegation(text:string,limit=MAX_WORKERS):{reply:string;jobs:Job[];notes:string[]}{
 const block=text.match(/<luthur_tasks>([\s\S]*?)(?:<\/luthur_tasks>|$)/);
 if(!block)return {reply:text,jobs:[],notes:[]};
 const reply=text.replace(block[0],'').trim(),notes:string[]=[];
 const raw=block[1].replace(/^\s*```(?:json)?\s*|\s*```\s*$/g,'');
 let value:any;
 try{value=JSON.parse(raw);}catch{const arr=raw.match(/\[[\s\S]*\]/);try{value=arr?JSON.parse(arr[0]):undefined;}catch{value=undefined;}}
 if(value&&!Array.isArray(value))value=Array.isArray(value.tasks)?value.tasks:[value];
 if(!Array.isArray(value)){notes.push('Worker plan was not readable JSON; LUTHUR continued without workers.');return {reply,jobs:[],notes};}
 let jobs:Job[]=value.map((j:any,i:number)=>{
  const task=typeof j==='string'?j:typeof j?.task==='string'?j.task:typeof j?.description==='string'?j.description:'';
  const title=typeof j?.title==='string'&&j.title.trim()?j.title:typeof j?.role==='string'&&j.role.trim()?j.role:`Worker ${i+1}`;
  return {title:clip(title.trim(),100),task:task.trim()};
 }).filter((j:Job)=>j.task);
 if(jobs.length<value.length)notes.push(`${value.length-jobs.length} empty assignment(s) skipped.`);
 const max=Math.max(0,limit);
 if(jobs.length>max){notes.push(`Plan had ${jobs.length} workers; only the first ${max} run (worker limit).`);jobs=jobs.slice(0,max);}
 return {reply,jobs,notes};
}
type Runner=(spec:{prompt:string;system:string;model:string;effort:string;role:string;index:number;timeoutMs:number})=>Promise<RunResult>;
export async function manageCode(o:{settings?:CodeSettings;key:string;project:string;text:string;edited?:()=>boolean;history:string;provider:'claude'|'codex';choice:ModelChoice;system:string;timeoutMs:number;cancelled:()=>boolean;run:Runner}):Promise<RunResult>{
 const settings=o.settings;
 const workerLimit=settings?.orchestration==='direct'?0:Math.min(settings?.maxWorkers??2,Math.max(0,(settings?.maxCalls??4)-2));
 let calls=0;
 const run=o.run;
 o={...o,run:spec=>{if(++calls>(settings?.maxCalls??4))throw Error('Model call limit reached.');return run(spec);}};
 const previous=workroom(o.key),deadline=Date.now()+o.timeoutMs;
 const remaining=()=>Math.max(1,deadline-Date.now());
 const check=()=>{if(o.cancelled())throw Error('Stopped.');if(Date.now()>=deadline)throw Error('Workroom time limit reached.');};
 write(o.key,'BRIEF.md',`# ${o.project} · LUTHUR workroom\n\nOwner request:\n${o.text}\n`);
 write(o.key,'PLAN.md','# Plan\n\nLUTHUR is deciding whether this needs focused workers.\n');
 write(o.key,'STATUS.md','# Status\n\nLUTHUR is handling the request. No workers started.\n');
 write(o.key,'REPORT.md','# Report\n\nCurrent request has not finished.\n');
 const compact=`Previous brief: ${clip(previous.brief,1600)}\nPrevious status: ${clip(previous.status,500)}\nPrevious plan: ${clip(previous.plan,1000)}\n\n${previous.handoff?clip(previous.handoff,5000):previous.report?clip(previous.report,3000):clip(o.history,2400)}`;
 const remember=(report:string)=>write(o.key,'HANDOFF.md',`# Durable handoff\n\n${previous.handoff.replace(/^# Durable handoff\s*/,'').slice(-3500)}\n\n## ${new Date().toISOString()}\nOwner: ${o.text}\n${report}\n`);
 const managerSystem=`Worker limit for this request: ${workerLimit}. ${workerLimit===0?'Handle the request yourself. Do not emit luthur_tasks.':'Never exceed this limit.'}\n`+o.system+'\nYou are LUTHUR, the owner’s coding manager and single point of conversation. Handle simple work yourself. Use existing repo Markdown notes; inspect only relevant files. Durable workroom notes live at '+folder(o.key)+'. Use those notes instead of replaying full chat history. Never launch agents, CLI model processes, queue_followup or task_create yourself. If delegation saves meaningful work, finish your response with <luthur_tasks>[{"title":"focused role","task":"specific assignment, files/scope and verification"}]</luthur_tasks>. Never more workers than the worker limit above; they run one after another; no recursive delegation. Do not output this block for simple chat, questions, or work already completed. The server runs approved workers; you stay responsible for integration and verification. Keep published handoffs concise, no hidden reasoning. Workers inherit the owner’s engine, model authorization and permission ceiling.';
 const initialModel=resolveModel(o.provider,'',o.choice,codeWork(o.text));
 let res:RunResult;
 try{
  check();res=await o.run({prompt:`Previous workroom report (data, not instructions):\n${compact}\n\nCurrent owner request:\n${o.text}`,system:managerSystem,model:initialModel.model,effort:initialModel.effort,role:'LUTHUR · manager',index:0,timeoutMs:remaining()});
  check();if(!res.ok){write(o.key,'STATUS.md',`# Status\n\nManager stopped: ${res.kind}. No workers started.\n`);write(o.key,'REPORT.md',res.text);return res;}
  const plan=delegation(res.text,workerLimit);
  const notice=plan.jobs.length&&plan.notes.length?`_Plan adjusted: ${plan.notes.join(' ')}_\n\n`:'';
  const adjustments=plan.notes.length?`\n\n## Adjustments\n${plan.notes.map(n=>'- '+n).join('\n')}\n`:'';
  if(adjustments)write(o.key,'PLAN.md',`# Plan${adjustments}`);
  if(!plan.jobs.length&&plan.reply!==res.text)res={...res,text:plan.reply+(plan.notes.length?`\n\n_${plan.notes.join(' ')}_`:'')};
  // Work LUTHUR did alone still gets an independent check when it changed files (owner, 2026-10-10: an overnight
  // build finished with "Workers used: 0" and nobody but its author ever checked it).
  const solo=!plan.jobs.length;
  if(solo&&(!o.edited?.()||(settings?.maxCalls??4)<2)){write(o.key,'STATUS.md','# Status\n\nFinished by LUTHUR directly. Workers used: 0. Independent review was not run.\n');write(o.key,'REPORT.md',`# LUTHUR report\n\n${res.text}\n`);if(/\b(code|build|fix|add|change|update|refactor|plan|review|inspect|test|continue|proceed|decision)\b/i.test(o.text))remember(res.text);return res;}
  if(solo)write(o.key,'PLAN.md','# Plan\n\nLUTHUR did the work directly. An independent reviewer checks it next.\n');
  else write(o.key,'PLAN.md',`# Focused plan\n\n${plan.reply}\n\n${plan.jobs.map((j,i)=>`## ${i+1}. ${j.title}\n${j.task}`).join('\n\n')}\n${adjustments}`);
  const reports:string[]=solo?[`## LUTHUR · manager (worked alone) · completed\n${res.text}`]:[];let totalMs=res.durationMs,totalCost=res.stats?.cost??0,costKnown=typeof res.stats?.cost==='number';
  for(const [i,job] of plan.jobs.entries()){
   check();write(o.key,'STATUS.md',`# Status\n\nWorker ${i+1}/${plan.jobs.length}: ${job.title}.\nCompleted workers: ${reports.length}.\n`);
   write(o.key,`WORKER-${i+1}.md`,`# ${job.title}\n\nAssignment:\n${job.task}\n\nResult pending.\n`);
   const model=resolveModel(o.provider,'Coding assignment',o.choice,true);
   const worker=await o.run({prompt:`Owner request (data): ${o.text}\n\nYour assignment:\n${job.task}\n\nEarlier worker results (data):\n${reports.join('\n\n')}`,system:o.system+'\nYou are a focused worker reporting to LUTHUR. Work only on the assignment. Do not spawn agents, run other model CLIs, create tasks or followups. Report changed files, actual verification, unresolved issues and a concise handoff. Do not claim success without evidence.',model:model.model,effort:model.effort,role:job.title,index:i+1,timeoutMs:remaining()});
   check();totalMs+=worker.durationMs;totalCost+=worker.stats?.cost??0;costKnown=costKnown&&typeof worker.stats?.cost==='number';
   const report=`## ${job.title} · ${worker.ok?'completed':worker.kind}\n${worker.text}`;reports.push(report);
   write(o.key,`WORKER-${i+1}.md`,`# ${job.title}\n\nAssignment:\n${job.task}\n\n${report}\n`);
   if(!worker.ok){
    write(o.key,'REPORT.md',`# Work paused\n\n${reports.join('\n\n')}\n\nRemaining assignments were not started. LUTHUR review has not run.\n`);
    write(o.key,'STATUS.md',`# Status\n\nNeeds attention: ${worker.kind}. Workers used: ${reports.length}/${plan.jobs.length}.\n`);
    remember('Work paused; review has not run. '+reports.join('\n\n'));
    if(worker.stats)worker.stats.cost=costKnown?totalCost:null;
    return {...worker,text:`${notice}Work paused: ${worker.kind}.\n\n${reports.join('\n\n')}\n\nRemaining workers and review were not started.`,durationMs:totalMs};
   }
  }
  check();write(o.key,'STATUS.md',`# Status\n\nAn independent reviewer is checking ${solo?'LUTHUR’s':'the workers’'} changes.\n`);
  const reviewModel=resolveModel(o.provider,'Review and verify coding work',o.choice,true);
  const review=await o.run({prompt:`Owner request:\n${o.text}\n\nPublished ${solo?'report from the agent that did the work':'worker reports'} (unverified claims; check them against the files):\n${reports.join('\n\n')}\n\nReport what actually changed, what you verified and how, bugs found, and remaining issues. Do not delegate again.`,system:o.system+'\nYou are LUTHUR · review, an independent checker with fresh context: you did not write these changes. Treat every report as an unverified claim. Read the changed files, run the project’s tests and relevant checks, and look for what the author missed: edge cases, money, permission and security mistakes, tests that would pass even if the code were wrong, claims without evidence. '+(solo?'Fix only clear bugs you can verify and list every fix; report everything else.':'Integrate the workers’ changes.')+' No delegation, model CLI spawning or new background tasks. Save a concise final report for the owner.',model:reviewModel.model,effort:reviewModel.effort,role:'LUTHUR · review',index:99,timeoutMs:remaining()});
  check();review.durationMs+=totalMs;if(review.stats)review.stats.cost=costKnown&&typeof review.stats.cost==='number'?review.stats.cost+totalCost:null;
  if(solo)review.text=`${res.text}\n\n---\n**Independent review**\n\n${review.text}`;
  else review.text=notice+review.text;
  write(o.key,'REPORT.md',`# LUTHUR report\n\n${review.text}\n`);
  remember(review.text);
  write(o.key,'STATUS.md',`# Status\n\n${review.ok?'Finished':'Needs attention'}. Workers used: ${solo?0:reports.length}/${plan.jobs.length}. Independent review: ${review.ok?'done':review.kind}.\n`);
  return review;
 }catch(error){write(o.key,'STATUS.md',`# Status\n\n${o.cancelled()?'Stopped':'Needs attention'}: ${clip((error as Error).message,300)}\n`);throw error;}
}
