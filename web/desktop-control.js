"use strict";
// "Luther, take control" / "release control": handled here, never by the model, so only the owner can start desktop control.
const DESKTOP_NAME='(?:(?:hey )?(?:luthur|luther|luthor|lutha|lothar|jarvis)[ ,]+)?';
const DESKTOP_ON=new RegExp(`^${DESKTOP_NAME}(?:take|start|begin)(?: desktop| pc| computer)? control(?: of (?:my|the) (?:pc|computer|desktop|screen))?$`,'i');
const DESKTOP_OFF=new RegExp(`^${DESKTOP_NAME}(?:release|end|give (?:me )?back|stop)(?: desktop| pc| computer)? control$`,'i');
const DESKTOP_FORGET=new RegExp(`^${DESKTOP_NAME}(?:forget|reset|clear)(?: the| my)? (?:allowed|approved) apps$`,'i');
function desktopPhrase(text){
  const t=String(text||'').toLowerCase().replace(/[.!?]+$/,'').replace(/\s+/g,' ').trim();
  if(DESKTOP_FORGET.test(t)){api('/desktop','POST',{forget:true}).then(()=>toast('LUTHUR will ask before using each app again.',6000)).catch(e=>toast(e.message,6000));return true;}
  const on=DESKTOP_ON.test(t),off=!on&&DESKTOP_OFF.test(t);if(!on&&!off)return false;
  api('/desktop','POST',{on}).then(s=>toast(on?(s.active?'LUTHUR has control. The bar at the top of your screen has Stop; approve each new app there (remembered).':'Desktop control could not start.'):'Desktop control released.',6000)).catch(e=>toast(e.message,6000));
  return true;
}
const desktopVoice=voiceCommand;voiceCommand=function(text){if(desktopPhrase(text))return;return desktopVoice.apply(this,arguments);};
const desktopSend=cmdSend;cmdSend=function(text){const t=text??document.getElementById('cmdText')?.value;if(desktopPhrase(t)){const i=document.getElementById('cmdText');if(i)i.value='';return;}return desktopSend.apply(this,arguments);};
