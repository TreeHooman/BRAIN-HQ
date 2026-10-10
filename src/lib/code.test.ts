import test from 'node:test';
import assert from 'node:assert/strict';
import {namedProjects} from './code.ts';
import * as brain from './brain.ts';

// Uses the real brain/projects (read only).
const own=(slug:string)=>brain.getProject(slug)?.paths||[];
const names=(current:string,text:string)=>namedProjects(current,text,own(current)).map(x=>x.p.slug);

test('a request about LUTHUR\'s own code from another workroom gets the HQ folder',()=>{
 assert.deepEqual(names('loancentral-discord','LUTHUR Code workroom: what went wrong. FIXED (src/lib/code-manager.ts, commit 51d11e9)'),['luthur']);
 assert.deepEqual(names('loancentral-discord','fix the HQ dashboard'),['luthur']);
});
test('addressing the assistant as LUTHUR does not pull in HQ',()=>{
 assert.deepEqual(names('loancentral-discord','LUTHUR, add a /loan command to the bot'),[]);
 assert.deepEqual(names('loancentral-discord','hey luthur what does this file do'),[]);
});
test('the current project and longer names are not double-counted',()=>{
 assert.deepEqual(names('loancentral-discord','in LoanCentral Discord, fix the help command'),[]);
 assert.ok(!names('luthur','fix the LoanCentral Discord bot').includes('loancentral'));
});
