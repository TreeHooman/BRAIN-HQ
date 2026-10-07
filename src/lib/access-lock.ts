import {randomBytes,scryptSync,timingSafeEqual} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import path from 'node:path';
import {DATA,readJson,writeJson} from './store.ts';
const file=path.join(DATA,'access-lock.json');
// No PIN ships in source. data/access-lock.json holds the salted hash; on a fresh install the first PIN entered becomes the PIN.
type Pin={salt:string,hash:string};
let pin=readJson<Pin|null>(file,null);
export function needsSetup(){return !pin;}
function digestOf(v:string,salt:string){return scryptSync(v.slice(0,100),salt,64);}
const sessions=new Map<string,number>();let failures=0,retryAt=0;
function cookie(req:IncomingMessage){return String(req.headers.cookie||'').match(/(?:^|;\s*)hq_access=([a-f0-9]{64})(?:;|$)/)?.[1]||'';}
export function allowed(req:IncomingMessage){const key=cookie(req),until=sessions.get(key)||0;if(until<Date.now()){sessions.delete(key);return false;}return true;}
export function unlock(req:IncomingMessage,res:ServerResponse,value:unknown){
 if(Date.now()<retryAt)throw Object.assign(new Error('Too many attempts. Wait one minute.'),{code:429});
 const supplied=String(value||'');
 if(!pin){if(!/^\d{4,8}$/.test(supplied))throw Object.assign(new Error('Choose a PIN of 4 to 8 digits.'),{code:400});const salt=randomBytes(16).toString('hex');pin={salt,hash:digestOf(supplied,salt).toString('hex')};writeJson(file,pin);}
 else if(!/^\d{4,8}$/.test(supplied)||!timingSafeEqual(digestOf(supplied,pin.salt),Buffer.from(pin.hash,'hex'))){if(++failures>=5){retryAt=Date.now()+60000;failures=0;}throw Object.assign(new Error('Incorrect PIN.'),{code:403});}
 failures=0;const token=randomBytes(32).toString('hex');sessions.set(token,Date.now()+12*3600000);while(sessions.size>20)sessions.delete(sessions.keys().next().value!);
 res.setHeader('Set-Cookie',`hq_access=${token}; HttpOnly; SameSite=Strict; Path=/`);return {locked:false};
}
export function lock(res:ServerResponse){sessions.clear();res.setHeader('Set-Cookie','hq_access=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return {locked:true};}
