import fs from 'node:fs';
let p='';for await(const d of process.stdin)p+=d;
fs.appendFileSync('data/fake-calls.jsonl',JSON.stringify({at:Date.now(),prompt:p,args:process.argv.slice(2)})+'\n');
if(p.includes('QA_TIMEOUT')) await new Promise(r=>setTimeout(r,60000));
if(p.includes('QA_DELAY')) await new Promise(r=>setTimeout(r,2500));
const err=p.includes('QA_AUTH')?'not logged in':p.includes('QA_LIMIT')?'usage limit reached; resets in 60 minutes':p.includes('QA_ERROR')?'Simulated provider error':null;
console.log(JSON.stringify({type:'result',result:err||'QA deterministic success',is_error:!!err,session_id:'qa-session',num_turns:1}));
