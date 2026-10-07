"use strict";
const SpeechUI={phase:'off',text:'',error:'',failed:'',editing:false};
function speechStatus(phase,detail=''){
  if(phase==='listening'&&['failed','editing','sent','queued','draft'].includes(SpeechUI.phase)){speechPaint();return;}
  SpeechUI.phase=phase;if(phase==='mic-error')SpeechUI.error=detail;speechPaint();
}
function speechPaint(){
  const panel=document.getElementById('speechFeedback');if(!panel)return;
  const speaking=window.speechSynthesis?.speaking;
  const labels={off:'Microphone off',wake:'Waiting for “Hey LUTHUR”',listening:'Listening · microphone ready',hearing:'Hearing you…',draft:'Heard you · sending after your pause',sending:'Sending your words…',sent:'Sent · ready for your next thought',queued:'Follow-up queued',failed:'Not sent · your words are saved here',editing:'Review text in the message box', 'mic-error':'Microphone needs attention',handling:'Heard you · handling request'};
  panel.hidden=SpeechUI.phase==='off'&&!SpeechUI.text&&!Wake.on;
  panel.dataset.phase=speaking?'speaking':SpeechUI.phase;
  const activity=typeof voiceActivity==='function'?voiceActivity():null;
  const message=activity?(activity.state==='error'?'Microphone needs attention':activity.label.charAt(0)+activity.label.slice(1).toLowerCase()+' · '+activity.hint):speaking?'Speaking · wait for Listening':labels[SpeechUI.phase]||'Listening';
  const stateLabel=panel.querySelector('[data-speech-state]');if(stateLabel.textContent!==message)stateLabel.textContent=message;
  const transcript=panel.querySelector('[data-speech-text]');transcript.textContent=SpeechUI.text||'Your recognized words will appear here.';
  panel.querySelector('[data-speech-error]').textContent=['failed','mic-error'].includes(SpeechUI.phase)?SpeechUI.error:'';
  panel.querySelector('[data-speech-send]').disabled=!Wake.buf?.trim()||SpeechUI.phase==='sending';
  panel.querySelector('[data-speech-retry]').hidden=!SpeechUI.failed;
  panel.querySelector('[data-speech-edit]').disabled=!(Wake.buf||SpeechUI.failed||SpeechUI.text)||Cmd.waiting;
  panel.querySelector('[data-speech-mic]').hidden=SpeechUI.phase!=='mic-error'&&!SpeechUI.editing;
  document.getElementById('cmdMic')?.setAttribute('aria-pressed',String(Wake.on&&!Wake.paused));
  if(typeof voiceVisualPaint==='function')voiceVisualPaint();
}
function speechClearTurn(){clearTimeout(Wake.t);Wake.turnId++;Wake.buf='';Wake.committed='';Wake.armed=0;document.body.classList.remove('wake-heard');}
function speechSend(text){if(!String(text||'').trim())return;speechClearTurn();SpeechUI.editing=false;if(UPG.conversation)Wake.resume();window.hqVoiceAt=Date.now();voiceCommand(text);}
const speechCommandView=vCommand;
vCommand=async function(el){await speechCommandView(el);if(route.view!=='command')return;const form=document.getElementById('cmdAsk');if(!form)return;
  const panel=document.createElement('section');panel.id='speechFeedback';panel.className='speech-feedback';
  panel.innerHTML='<div class="speech-state" role="status"><i></i><b data-speech-state></b></div><div class="speech-text" data-speech-text></div><p data-speech-error></p><div class="row"><button type="button" class="btn sm" data-speech-send>Send now</button><button type="button" class="btn sm" data-speech-edit>Edit text</button><button type="button" class="btn sm" data-speech-retry>Retry unsent turn</button><button type="button" class="btn sm" data-speech-mic>Retry mic / resume</button></div>';
  form.before(panel);
  panel.querySelector('[data-speech-send]').onclick=()=>speechSend(Wake.buf);
  panel.querySelector('[data-speech-retry]').onclick=()=>speechSend(SpeechUI.failed);
  panel.querySelector('[data-speech-edit]').onclick=()=>{const text=Wake.buf||SpeechUI.failed||SpeechUI.text;speechClearTurn();Wake.pause();SpeechUI.editing=true;speechStatus('editing');const input=document.getElementById('cmdText');input.value=text;input.focus();};
  panel.querySelector('[data-speech-mic]').onclick=()=>{SpeechUI.editing=false;Wake.paused=false;if(!UPG.conversation)upConversation(true);else{Wake.on=true;Wake.start();}speechStatus('listening');};
  speechPaint();
};
const speechHeard=Wake.heard;
Wake.heard=function(text,final,snapshot=false){const result=speechHeard.call(this,text,final,snapshot);if(this.buf?.trim()){SpeechUI.text=this.buf;SpeechUI.error='';speechStatus('draft');}return result;};
const speechWakeButton=Wake.btn;Wake.btn=function(){speechWakeButton.call(this);if(!this.on&&!SpeechUI.editing&&!['mic-error','failed'].includes(SpeechUI.phase))speechStatus('off');else speechPaint();};
const speechVoiceCommand=voiceCommand;voiceCommand=function(text){if(typeof Access!=='undefined'&&Access.locked)return;SpeechUI.text=String(text);speechStatus('handling');const queued=UPG.pending.length;const result=speechVoiceCommand(text);if(UPG.pending.length>queued)speechStatus('queued');return result;};
const speechSendCommand=cmdSend;cmdSend=function(text){if(SpeechUI.editing){SpeechUI.editing=false;window.hqVoiceAt=Date.now();if(UPG.conversation)Wake.resume();}return speechSendCommand(text);};
const speechApi=api;api=function(path,method,body){const voiced=body?.voice===true||Date.now()-(window.hqVoiceAt||0)<6000;const track=path==='/chat'&&method==='POST'&&voiced;
  if(track){SpeechUI.text=body.text;speechStatus('sending');}
  const request=speechApi(path,method,body);if(track)request.then(()=>{SpeechUI.failed='';SpeechUI.error='';speechStatus('sent');},error=>{SpeechUI.failed=body.text;SpeechUI.text=body.text;SpeechUI.error=error.message;speechStatus('failed');});return request;
};
const speechConfigure=configureVoice;
const SpeechPlayback={blocked:false,until:0,generation:0,timer:0,rearmPc:false,ignorePcBefore:0};
function speechPlaybackBlocked(){return SpeechPlayback.blocked||Date.now()<SpeechPlayback.until||!!window.speechSynthesis?.speaking||!!window.speechSynthesis?.pending;}
function speechPlaybackStart(u){
  if(u._speechGuard===SpeechPlayback.generation&&SpeechPlayback.blocked)return;
  u._speechGuard=++SpeechPlayback.generation;SpeechPlayback.blocked=true;SpeechPlayback.until=Infinity;clearTimeout(SpeechPlayback.timer);clearTimeout(Wake.t);Wake.pause();
  SpeechPlayback.ignorePcBefore=Infinity;
  if(typeof rec!=='undefined'&&rec)rec.finish();
  u._speechWatch?.();
  if(typeof pcVoiceWasOn!=='undefined'&&pcVoiceWasOn&&!UPG.conversation){SpeechPlayback.rearmPc=true;pcVoiceWasOn=false;api('/pc-voice','PUT',{enabled:false}).catch(()=>{});}
  speechPaint();
}
configureVoice=function(u){speechConfigure(u);{let ended=false,watchdog;
  const end=()=>{
    if(ended||u._speechGuard!==SpeechPlayback.generation)return;
    clearTimeout(watchdog);
    if(window.speechSynthesis?.speaking||window.speechSynthesis?.pending){watchdog=setTimeout(end,100);return;}
    ended=true;SpeechPlayback.blocked=false;SpeechPlayback.until=Date.now()+1000;SpeechPlayback.ignorePcBefore=SpeechPlayback.until;
    const generation=SpeechPlayback.generation;
    SpeechPlayback.timer=setTimeout(()=>{
      if(generation!==SpeechPlayback.generation||speechPlaybackBlocked()||Access.locked)return;
      if(!SpeechUI.editing&&Wake.on){if(Wake.buf?.trim())Wake.armed=Date.now();Wake.resume();if(Wake.buf?.trim())Wake.t=setTimeout(()=>speechSend(Wake.buf),turnPauseFor(Wake.buf,Math.max(1200,Number(localStorage.getItem('hq-turn-pause')||1800))));}
      if(SpeechPlayback.rearmPc&&!UPG.conversation){SpeechPlayback.rearmPc=false;api('/pc-voice','PUT',{enabled:true}).then(state=>{pcVoiceWasOn=state.running;pcVoicePaint(state);}).catch(()=>{});}
      speechPaint();
    },1050);speechPaint();
  };
  u._speechWatch=()=>{clearTimeout(watchdog);watchdog=setTimeout(end,250);};
  if(u.addEventListener){u.addEventListener('start',()=>{speechPlaybackStart(u);u._speechWatch();});u.addEventListener('end',end);u.addEventListener('error',end);}
  else {for(const key of ['onend','onerror']){const previous=u[key];u[key]=event=>{previous?.(event);end();};}}
}};
const speechPcPaint=pcVoicePaint;pcVoicePaint=function(state){speechPcPaint(state);if(state.running&&!UPG.conversation)speechStatus('wake');};
setInterval(speechPaint,300);


