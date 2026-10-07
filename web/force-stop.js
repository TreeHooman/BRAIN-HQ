"use strict";
const ForceStop={stopped:false,busy:false,ready:false};
const stopWords=text=>String(text||'').toLowerCase().replace(/[^a-z ]/g,' ').replace(/\s+/g,' ').trim();
function isStopRequest(text,named=false){return (named?/^(?:hey )?(?:luthur|luthor|luther|lutha|lothar|jarvis) (?:please )?(?:stop(?: now| talking| everything)?|force stop|shut up)(?: please)?$/:/^(?:(?:hey )?(?:luthur|luthor|luther|lutha|lothar|jarvis) )?(?:please )?(?:stop(?: now| talking| everything)?|force stop|shut up)(?: please)?$/).test(stopWords(text));}
const stopButton=document.createElement('button');stopButton.type='button';stopButton.className='force-stop-button';stopButton.setAttribute('aria-label','Force stop LUTHUR');document.body.append(stopButton);
function stopPaint(){stopButton.textContent=ForceStop.busy?'■ Stopping…':ForceStop.stopped?'▶ Resume LUTHUR':'■ Stop now';stopButton.disabled=ForceStop.busy;stopButton.setAttribute('aria-label',ForceStop.stopped?'Resume LUTHUR':'Force stop LUTHUR');stopButton.dataset.stopped=String(ForceStop.stopped);stopButton.hidden=Access.locked;voiceVisualPaint();}
const StopMonitor={rec:null,ready:false,denied:false,speech:'',stop(){const r=this.rec;this.rec=null;this.ready=false;if(r){r.onend=null;try{r.abort();}catch{}}},start(){
  this.stop();if(!SR||ForceStop.stopped||Access.locked||document.hidden)return;
  const r=new SR();this.rec=r;r.lang='en-US';r.continuous=true;r.interimResults=true;
  r.onstart=()=>{if(this.rec===r){this.ready=true;voiceVisualPaint();}};
  r.onresult=e=>{if(this.rec!==r||ForceStop.stopped||Access.locked)return;const parts=Array.from(e.results).slice(-2).map(result=>result[0].transcript),candidates=[...parts,parts.join(' ')];for(const text of candidates){if(!isStopRequest(text,true))continue;
    // Never accept a stop phrase that LUTHUR is itself currently saying.
    if(/\b(?:luthur|luthor|luther|lutha|lothar|jarvis) (?:please )?(?:stop|force stop|shut up)\b/.test(stopWords(this.speech)))continue;
    void forceStopNow();return;
  }};
  r.onerror=e=>{if(this.rec===r){if(['not-allowed','service-not-allowed'].includes(e.error))this.denied=true;this.ready=false;voiceVisualPaint();}};
  r.onend=()=>{if(this.rec!==r)return;this.rec=null;this.ready=false;if(!this.denied&&speechPlaybackBlocked()&&!ForceStop.stopped)setTimeout(()=>{if(speechPlaybackBlocked())this.start();},300);};
  try{r.start();}catch{this.rec=null;this.ready=false;}
}};
function stopLocal(){
  ForceStop.stopped=true;StopMonitor.stop();pcVoiceReturn=false;SpeechPlayback.rearmPc=false;
  ++SpeechPlayback.generation;clearTimeout(SpeechPlayback.timer);SpeechPlayback.blocked=false;SpeechPlayback.until=Date.now()+1000;SpeechPlayback.ignorePcBefore=SpeechPlayback.until;
  window.speechSynthesis?.cancel();speechClearTurn();if(rec)rec.finish();upConversation(false);Wake.on=false;Wake.pause();Wake.btn();UPG.pending.length=0;Cmd.waiting=false;SpeechUI.text='';SpeechUI.phase='off';window.hqQueuedModelChoice=null;
  stopPaint();
}
async function forceStopNow(){
  if(ForceStop.busy)return;ForceStop.busy=true;stopLocal();
  api('/pc-voice','PUT',{enabled:false}).then(()=>{pcVoiceWasOn=false;}).catch(()=>{});
  try{await api('/control/stop','POST',{});toast('LUTHUR stopped. Use Resume when you are ready.');}
  catch(error){toast('Speech stopped, but server cancellation failed: '+error.message,7000);}
  finally{ForceStop.busy=false;stopPaint();}
}
stopButton.onclick=async()=>{if(!ForceStop.stopped)return forceStopNow();ForceStop.busy=true;stopPaint();try{await api('/control/resume','POST',{});ForceStop.stopped=false;toast('LUTHUR resumed. Start conversation when you are ready.');}catch(error){toast(error.message,6000);}finally{ForceStop.busy=false;stopPaint();}};
const stopVoiceCommand=voiceCommand;voiceCommand=function(text){if(isStopRequest(text)){void forceStopNow();return;}if(ForceStop.stopped){toast('LUTHUR is stopped. Use Resume LUTHUR.');return;}return stopVoiceCommand(text);};
const stopHeard=Wake.heard;Wake.heard=function(text,...args){if(isStopRequest(text)){void forceStopNow();return;}return stopHeard.call(this,text,...args);};
const stopPlaybackStart=speechPlaybackStart;speechPlaybackStart=function(u){if(ForceStop.stopped)return;stopPlaybackStart(u);if(StopMonitor.speech!==u.text||!StopMonitor.rec){StopMonitor.speech=u.text||'';StopMonitor.start();}};
const stopConfigure=configureVoice;configureVoice=function(u){stopConfigure(u);if(u.addEventListener){const end=()=>{if(u._speechGuard===SpeechPlayback.generation)StopMonitor.stop();};u.addEventListener('end',end);u.addEventListener('error',end);}};
const stopWakeStart=Wake.start;Wake.start=function(){if(ForceStop.stopped)return;if(!speechPlaybackBlocked())StopMonitor.stop();return stopWakeStart.call(this);};
const stopSpeak=speak;speak=function(text){if(!ForceStop.stopped)return stopSpeak(text);};
const stopSpeakAlways=speakAlways;speakAlways=function(text,onEnd){if(ForceStop.stopped){onEnd?.();return;}return stopSpeakAlways(text,onEnd);};
const stopActivity=voiceActivity;voiceActivity=function(){if(ForceStop.stopped&&!Access.locked)return {state:'paused',label:'STOPPED',hint:'Use Resume LUTHUR to allow new work'};const state=stopActivity();if(state.state==='speaking')state.hint=StopMonitor.ready?'Say “LUTHUR stop now” · regular mic paused':'Regular mic paused · use Stop now';return state;};
const stopApi=api;api=async function(path,method,body){if(ForceStop.stopped&&method==='POST'&&(path==='/chat'||/^\/code\/[a-z0-9-]+$/.test(path)))throw new Error('LUTHUR is stopped. Use Resume LUTHUR.');return stopApi(path,method,body);};
setInterval(async()=>{if(Access.locked){StopMonitor.stop();stopButton.hidden=true;return;}if(!speechPlaybackBlocked())StopMonitor.stop();if(!ForceStop.busy){try{const state=await api('/control');ForceStop.ready=true;if(state.stopped&&!ForceStop.stopped)stopLocal();ForceStop.stopped=state.stopped;}catch{}}stopPaint();},1500);
stopPaint();
