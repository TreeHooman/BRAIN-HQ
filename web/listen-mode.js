"use strict";
// War Room switch (owner ask, 2026-10-09): "Always listening" or "Hey LUTHUR".
// - Always listening: while LUTHUR's window is in use the mic stays open and every sentence goes to LUTHUR, no name
//   needed and no wake-up lag. Minimized or behind other apps, the PC detector takes over until you come back.
//   "Stop"/"stop talking" only hushes him. Only "switch to LUTHUR mode" changes the mode (owner, 2026-10-09).
// - Hey LUTHUR: the name starts a conversation; it stays open for follow-ups for a few seconds (wake-idle.js).
const listenAlways=()=>localStorage.getItem('hq-listen-mode')==='always';
function listenModeSet(mode,say){
  try{localStorage.setItem('hq-listen-mode',mode);}catch{}
  listenModePaint();
  if(mode==='always'){Wake.denied=false;WakeIdle.muted=false;listenModeTick(true);}
  else if(UPG.conversation)upConversation(false);
  toast(say||(mode==='always'?'Always listening · just talk. Say “switch to LUTHUR mode” to go back to the name.':'Hey LUTHUR mode · say his name to start.'));
}
function listenModePaint(){
  const box=document.getElementById('listenMode');if(!box)return;
  box.querySelectorAll('button').forEach(b=>{const on=b.dataset.mode===(listenAlways()?'always':'wake');b.classList.toggle('on',on);b.setAttribute('aria-pressed',String(on));});
}
let listenModeBusy=false;
async function listenModeTick(now){
  if(listenModeBusy||Wake.denied||!listenAlways()||WAKE_PHONE)return;
  if(typeof ForceStop!=='undefined'&&(ForceStop.stopped||ForceStop.busy))return;
  listenModeBusy=true;
  try{
    if(wakeMainInUse()){
      if(!UPG.conversation&&!speechPlaybackBlocked()&&!SpeechUI.editing){
        // The PC detector and the always-open mic shouldn't both act: hand the mic to the conversation.
        if(pcVoiceWasOn){pcVoiceWasOn=false;pcVoiceReturn=true;await api('/pc-voice','PUT',{enabled:false}).catch(()=>{});}
        Wake.on=true;Wake.paused=false;WakeIdle.muted=false;upConversation(true);Wake.start();
      }
    }else if(UPG.conversation&&!Cmd.waiting&&!speechPlaybackBlocked()&&!document.querySelector('.up-window')){
      upConversation(false); // wake-idle.js re-arms the PC detector so "Hey LUTHUR" still works while away
    }
  }finally{listenModeBusy=false;}
}
setInterval(()=>listenModeTick(false),700);
const listenModeView=vCommand;
vCommand=async function(el){
  await listenModeView(el);if(route.view!=='command'||window.hqOverlay||document.getElementById('listenMode'))return;
  const anchor=document.getElementById('speechFeedback')||document.getElementById('cmdAsk');if(!anchor)return;
  const box=document.createElement('div');box.id='listenMode';box.className='listen-mode';box.setAttribute('role','group');box.setAttribute('aria-label','Listening mode');
  box.innerHTML='<span>Listening</span><button type="button" data-mode="always">Always listening</button><button type="button" data-mode="wake">Hey LUTHUR</button>';
  anchor.before(box);
  box.querySelectorAll('button').forEach(b=>b.onclick=()=>listenModeSet(b.dataset.mode));
  listenModePaint();
};
// Spoken mode switches, checked before anything else. Speech recognition often adds words in front ("hit wait switch to
// hey Luther mode", "Swisher hey Luther mode", owner 2026-10-09), so a short sentence that ENDS with the mode name counts.
const LISTEN_TO_WAKE=/(?:^|\s)(?:hey |the )?(?:luthur|luther|luthor|lutha|lothar|wake ?word|name)(?:'s)? (?:mode|mod)(?: please)?$/;
const LISTEN_TO_ALWAYS=/(?:^|\s)always (?:listening|listen)(?: (?:mode|mod))?(?: please)?$/;
const listenModeVoice=voiceCommand;
voiceCommand=function(text){
  const t=String(text||'').toLowerCase().replace(/[.,!?]+/g,' ').replace(/\s+/g,' ').trim();
  if(t.split(' ').length<=9){
    if(LISTEN_TO_WAKE.test(t)||/^(?:mode|mod)$/.test(t)){ // "Hey Luther mode" arrives as "mode" (the name is stripped first)
     window.speechSynthesis?.cancel();listenModeSet('wake','Hey LUTHUR mode. Say “Hey LUTHUR” when you need me.');return;}
    if(LISTEN_TO_ALWAYS.test(t)){window.speechSynthesis?.cancel();listenModeSet('always');return;}
  }
  return listenModeVoice(text);
};
