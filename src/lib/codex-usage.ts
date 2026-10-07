import {spawn} from 'node:child_process';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {findCodex} from './codex.ts';
export function normalizeLimits(data:any,now=Date.now()){
  const raw=data?.rateLimitsByLimitId;const buckets=raw&&Object.keys(raw).length?Object.values(raw):data?.rateLimits?[data.rateLimits]:[];
  return buckets.map((b:any)=>({id:String(b.limitId||'codex').slice(0,80),name:String(b.limitName||b.limitId||'Codex').slice(0,80),windows:[b.primary,b.secondary].flatMap(w=>{
    if(!w||!Number.isFinite(w.usedPercent)||!Number.isFinite(w.windowDurationMins)||w.windowDurationMins<=0)return [];
    return [{usedPercent:Math.min(100,Math.max(0,w.usedPercent)),windowDurationMins:w.windowDurationMins,resetsAt:Number.isFinite(w.resetsAt)?w.resetsAt*1000:null,at:now}];
  })}));
}
let cached:any=null,checked=0,pending:Promise<any>|null=null;
export async function accountLimits(){
  if(Date.now()-checked<60000)return cached;if(pending)return pending;
  pending=readLimits().then(raw=>{cached={buckets:normalizeLimits(raw),at:Date.now(),error:null};return cached;}).catch(()=>({...(cached||{buckets:[],at:null}),error:'Account usage unavailable; retrying shortly.'})).then(result=>{checked=Date.now();cached=result;return result;}).finally(()=>pending=null);return pending;
}
function readLimits():Promise<any>{return new Promise((resolve,reject)=>{
  const fake=process.env.HQ_FAKE_USAGE_RPC;const bin=fake?process.execPath:findCodex();if(!bin)return reject(Error('CLI unavailable'));
  const env={...process.env};for(const key of Object.keys(env))if(/^(OPENAI_API_KEY|CODEX_API_KEY|ANTHROPIC_API_KEY)$/i.test(key))delete env[key];
  const child=spawn(bin,fake?[fake]:['app-server','--listen','stdio://','-c','mcp_servers={}'],{windowsHide:true,env,stdio:['pipe','pipe','ignore']});
  let buffer='',done=false;const finish=(error:any,value?:any)=>{if(done)return;done=true;clearTimeout(timer);child.stdin.end();child.kill();error?reject(error):resolve(value);};
  const timer=setTimeout(()=>finish(Error('Usage read timed out')),8000);
  const send=(msg:any)=>{if(!done)child.stdin.write(JSON.stringify(msg)+'\n');};
  child.stdin.on('error',()=>{});child.on('error',e=>finish(e));child.on('close',()=>{if(!done)finish(Error('Usage read closed'));});
  child.stdout.on('data',chunk=>{buffer+=String(chunk);if(buffer.length>1_000_000)return finish(Error('Unexpected response size'));let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);let msg:any;try{msg=JSON.parse(line);}catch{continue;}if(msg.id===1){if(msg.error)return finish(Error('Initialize unavailable'));send({method:'initialized',params:{}});send({id:2,method:'account/rateLimits/read',params:{}});}if(msg.id===2)finish(msg.error?Error('Usage unavailable'):null,msg.result);}});
  // Only initialize and read limits. Never create a thread/turn or read credentials.
  send({id:1,method:'initialize',params:{clientInfo:{name:'luthur_usage',title:'LUTHUR usage',version:'1.0.0'},capabilities:{experimentalApi:false}}});
});}
export function parseContext(lines:string[],sessionId:string){
  for(let i=lines.length-1;i>=0;i--){let e:any;try{e=JSON.parse(lines[i]);}catch{continue;}if(e.type!=='event_msg'||e.payload?.type!=='token_count')continue;
    const info=e.payload.info,used=info?.last_token_usage?.total_tokens,win=info?.model_context_window;if(!Number.isFinite(used)||used<0||!Number.isFinite(win)||win<=0)continue;
    return {context:used,window:win,at:e.timestamp||null,sessionId,source:'Codex last-turn token telemetry'};
  }return null;
}
const files=new Map<string,string>();
export function sessionContext(rawId:string|undefined){
  const id=String(rawId||'').replace(/^codex:/,'');if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))return null;
  // Read only token telemetry for the known LUTHUR session, never other chats or credential files.
  const root=process.env.HQ_USAGE_SESSIONS||path.join(process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),'sessions');
  let file=files.get(id);
  if(!file){const find=(dir:string,depth:number):string|undefined=>{let entries:fs.Dirent[];try{entries=fs.readdirSync(dir,{withFileTypes:true});}catch{return;}for(const e of entries){if(e.isFile()&&e.name.endsWith('-'+id+'.jsonl'))return path.join(dir,e.name);}if(depth>0)for(const e of entries)if(e.isDirectory()){const hit=find(path.join(dir,e.name),depth-1);if(hit)return hit;}};file=find(root,3);if(file)files.set(id,file);}
  if(!file)return null;let fd:number|undefined;try{fd=fs.openSync(file,'r');const size=fs.fstatSync(fd).size,bytes=Math.min(size,2_000_000),buffer=Buffer.alloc(bytes);fs.readSync(fd,buffer,0,bytes,size-bytes);return parseContext(buffer.toString('utf8').split('\n'),id);}catch{return null;}finally{if(fd!==undefined)fs.closeSync(fd);}
}
