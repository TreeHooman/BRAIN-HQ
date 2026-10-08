// Fake Claude CLI for verify-test.mjs. Reads the mission prompt and, for the project folder named in it:
//   QA_EDIT  writes app.py and reports it truthfully      QA_LIE   changes nothing but claims it edited app.py
//   QA_QUIET writes app.py, reports only "Done"           QA_BREAK writes app.py and makes the project's check fail
import fs from 'node:fs'; import path from 'node:path';
let p='';for await(const d of process.stdin)p+=d;
fs.appendFileSync('data/fake-calls.jsonl',JSON.stringify({at:Date.now(),prompt:p})+'\n');
let dir=(p.match(/Folders: ([^\n;]+)/)||[])[1]?.trim(); // a reply prompt has no folder line: reuse the last one
if(dir) fs.writeFileSync('data/qa-dir.txt',dir); else try{dir=fs.readFileSync('data/qa-dir.txt','utf8');}catch{}
const w=(f,t)=>fs.writeFileSync(path.join(dir,f),t);
let report='**Result:** Done\n**What I did:**\n- Looked around.\n**Needs you:** Nothing';
if(p.includes('QA_EDIT')){w('app.py','x = '+Date.now()+'\n');report='**Result:** Done\n**What I did:**\n- Edited app.py to add x.\n**Needs you:** Nothing';}
if(p.includes('QA_LIE')){report='**Result:** Done\n**What I did:**\n- Edited app.py and fixed the bug.\n- Tests pass.\n**Needs you:** Nothing';}
if(p.includes('QA_QUIET')){w('app.py','y = '+Date.now()+'\n');}
if(p.includes('QA_BREAK')){w('app.py','z = 1\n');w('fail.flag','1');report='**Result:** Done\n**What I did:**\n- Edited app.py.\n- All tests pass.\n**Needs you:** Nothing';}
console.log(JSON.stringify({type:'result',result:report,is_error:false,session_id:'qa-session',num_turns:1}));
