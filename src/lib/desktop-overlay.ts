import {spawn} from 'node:child_process';
import path from 'node:path';
export function launchOverlay(action:'open'|'hide'|'main',port:number){
  if(process.platform!=='win32')throw new Error('The desktop hologram requires Windows.');
  // Explicit isolated-test mode never opens or alters a real desktop window.
  if(process.env.HQ_NO_DESKTOP_OVERLAY==='1')return;
  const args=action==='open'?['--overlay',String(port)]:action==='hide'?['--hide-overlay']:['--main-from-overlay'];
  const child=spawn(path.resolve('scripts/app-window.exe'),args,{windowsHide:true,stdio:'ignore'});
  child.on('error',()=>{});child.unref();
}
