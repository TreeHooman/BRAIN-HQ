"use strict";
// "Luther pause" vs "Luther stop" (owner, 2026-10-09: after "stop" he kept the words as if I'd carry on).
// - Pause ("Luther pause", "pause", "hold on"): what stop used to do. He goes quiet and the turn ends, but the
//   conversation so far is kept, so you can pick up where you left off.
// - Stop ("Luther stop", "stop", "stop talking", "shut up", "stop listening"): quiet AND a full reset: the reply being
//   written is cancelled, queued follow-ups and captured words are dropped, the mic session restarts clean, and the chat
//   starts fresh (the old one is archived in History). "Force stop" keeps its own behaviour (halts LUTHUR's work).
// Loads after l4.js so it sees every spoken turn first.
const PAUSE_RE=/^(?:(?:hey|okay|ok) )?(?:(?:luthur|luthor|luther|lutha|lothar|jarvis) )?(?:please )?(?:pause|hold on|hold up|one sec|one second)(?: please| for a sec(?:ond)?| a sec(?:ond)?)?$/;
const RESET_WORDS=new Set(['stop','no','okay','ok','please','hey','luther','luthur','luthor','lutha','lothar','man','dude','just','now','again','right','talking','listening','everything']);
const isPauseRequest=text=>PAUSE_RE.test(stopWords(text));
const pauseBaseStop=isStopRequest;
const isResetStop=text=>{const w=stopWords(text).split(' ').filter(Boolean);if(isForceStop(text))return false;return pauseBaseStop(text)||(w.includes('stop')&&w.length<=8&&w.every(x=>RESET_WORDS.has(x)))||/^(?:(?:hey )?(?:luthur|luthor|luther) )?(?:shut up|stop listening)$/.test(w.join(' '));};
// Pause phrases count as stop requests too, so the mic-while-speaking monitor and barge-in treat them as commands, not questions.
isStopRequest=function(text,named=false){return pauseBaseStop(text,named)||isPauseRequest(text);};
let resetting=false;
async function voiceFullReset(){
  if(resetting)return;resetting=true;
  try{
    speechClearTurn();
    UPG.pending.length=0;Cmd.waiting=false;
    SpeechUI.text='';SpeechUI.failed=false;
    const box=document.getElementById('cmdText');if(box)box.value='';
    WakeIdle.sent=false;WakeIdle.named=0;
    // A recognizer keeps everything heard since it started: restart it so old words can't come back.
    if(Wake.rec&&!Wake.paused){Wake.stop(true);setTimeout(()=>Wake.start(),350);}
    await api('/chat/cancel','POST',{}).catch(()=>{});
    await api('/chat/new','POST').catch(()=>{});
    chatState=null;
    try{if(route.view==='command'||route.view==='assistant')render();}catch{}
    speechPaint();
    toast('Stopped · fresh start. Say “Hey LUTHUR” when you’re ready.',3500);
  }finally{resetting=false;}
}
// Every stop path that isn't typed speech (mic monitor while he talks, barge-in, Wake.heard) goes through stopOrHush.
const pauseBaseStopOrHush=stopOrHush;
stopOrHush=function(text){
  if(isForceStop(text))return pauseBaseStopOrHush(text);
  hushSpeech();
  if(!isPauseRequest(text))void voiceFullReset();
};
const pauseVoiceCommand=voiceCommand;
voiceCommand=function(text){
  if(isPauseRequest(text)){stopTalking();return;}
  if(isResetStop(text)){stopTalking();void voiceFullReset();return;}
  return pauseVoiceCommand(text);
};
