import {spawn, type ChildProcess} from 'node:child_process';
import path from 'node:path';
import {launchOverlay} from './desktop-overlay.ts';
let surface:'main'|'overlay'='main';
let overlaySeen=0;
let helper: ChildProcess | null = null, error = '', seq = 0;
let event: {seq:number;text:string;at:number;kind:'wake'|'command';target:'overlay'} | null = null;
export function status(){if(surface==='overlay'&&Date.now()-overlaySeen>30000)surface='main';return {running:!!helper,error,event,protocol:2,surface};}
export function desktop(action:string,port:number){if(action==='heartbeat'){overlaySeen=Date.now();surface='overlay';return status();}if(action==='release'){surface='main';return status();}if(!['open','hide','main'].includes(action))throw new Error('Choose open, hide or main.');launchOverlay(action as 'open'|'hide'|'main',port);surface=action==='open'?'overlay':'main';overlaySeen=Date.now();return status();}
export function claim(at:number){if(!event||event.at!==at)return {event:null};const claimed=event;event=null;return {event:claimed};}
export function receive(text: string,kind='command',port=8800){
  const clean=String(text||'').trim().slice(0,8000);
  if(!clean&&kind!=='wake')throw new Error('Empty voice request');
  desktop('open',port);event={seq:++seq,text:clean,at:Date.now(),kind:kind==='wake'?'wake':'command',target:'overlay'};return {ok:true};
}
export function setEnabled(on:boolean,port:number,cookie=''){
  if(!on){helper?.kill();helper=null;event=null;return status();}
  if(helper)return status();
  if(process.platform!=='win32')throw new Error('PC wake listening requires Windows.');
  error='';
  const proc=spawn(path.resolve('scripts/pc-wake.exe'),[String(port)],{windowsHide:true,stdio:['ignore','ignore','pipe'],env:{...process.env,HQ_PC_VOICE_COOKIE:cookie}});
  helper=proc;
  proc.stderr?.on('data',()=>{error='Windows wake listener could not start. Check microphone permission and Windows speech recognition.';});
  proc.on('error',()=>{error='Windows wake listener could not start.';if(helper===proc)helper=null;});
  proc.on('exit',()=>{if(helper===proc)helper=null;});
  return status();
}
process.on('exit',()=>helper?.kill());
