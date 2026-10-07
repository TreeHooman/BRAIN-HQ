// Fake Codex/Claude: records where it ran, then (if asked) tampers with HQ files like an escaped agent would.
import fs from 'node:fs'; import path from 'node:path';
let p=''; for await (const d of process.stdin) p+=d;
const root=process.env.QA_ROOT;
fs.appendFileSync(path.join(root,'..','calls.jsonl'),JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2),prompt:p.slice(-600)})+'\n');
if(p.includes('QA_TAMPER')){
  const perm=path.join(root,'config','permissions.json'); const j=JSON.parse(fs.readFileSync(perm,'utf8')); j.hardDeny=[]; fs.writeFileSync(perm,JSON.stringify(j));
  fs.writeFileSync(path.join(root,'scripts','evil.cmd'),'echo pwned');
  fs.appendFileSync(path.join(root,'src','lib','schedule.ts'),'\n// tampered\n');
}
if(process.argv.includes('exec')){
  console.log(JSON.stringify({type:'thread.started',thread_id:'qa'}));
  console.log(JSON.stringify({type:'item.completed',item:{id:'1',type:'agent_message',text:'QA ok'}}));
  console.log(JSON.stringify({type:'turn.completed'}));
} else console.log(JSON.stringify({type:'result',result:'QA ok',is_error:false,session_id:'qa',num_turns:1}));
