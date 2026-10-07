"use strict";
// Native speech exposes word timing, not an output audio stream. Never invent an audio level.
const VoiceMotion={utterance:null,startedAt:0,wordAt:-Infinity,wordMs:180,boundaries:false};
function voiceMotionLevel(now=performance.now()){
  if(!window.speechSynthesis?.speaking||window.speechSynthesis.paused)return 0;
  if(!VoiceMotion.boundaries)return .12; // steady playback glow when the voice has no timing events
  const elapsed=now-VoiceMotion.wordAt;
  return elapsed>=0?Math.max(0,1-elapsed/VoiceMotion.wordMs)*.8:0;
}
const motionConfigure=configureVoice;
configureVoice=function(u){
  motionConfigure(u);
  const start=()=>{VoiceMotion.utterance=u;VoiceMotion.startedAt=performance.now();VoiceMotion.wordAt=-Infinity;VoiceMotion.boundaries=false;};
  const boundary=event=>{
    if(VoiceMotion.utterance!==u||!window.speechSynthesis?.speaking||event.name&&event.name!=='word')return;
    const tail=String(u.text||'').slice(Number(event.charIndex)||0),word=tail.match(/^\S+/)?.[0]||'';
    VoiceMotion.wordAt=performance.now();VoiceMotion.wordMs=Math.max(90,Math.min(320,(Number(event.charLength)||word.length||3)*35/(u.rate||1)));VoiceMotion.boundaries=true;
  };
  const end=()=>{if(VoiceMotion.utterance===u){VoiceMotion.utterance=null;VoiceMotion.wordAt=-Infinity;VoiceMotion.boundaries=false;}};
  if(u.addEventListener){u.addEventListener('start',start);u.addEventListener('boundary',boundary);u.addEventListener('end',end);u.addEventListener('error',end);}
  else{for(const [name,handler] of [['onstart',start],['onboundary',boundary],['onend',end],['onerror',end]]){const previous=u[name];u[name]=event=>{previous?.(event);handler(event||{});};}}
};
