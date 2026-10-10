"use strict";
const VoiceVisual={heardUntil:0,state:'idle',oneShot:false};
function voiceActivity(){
  if(typeof Access!=='undefined'&&Access.locked)return {state:'locked',label:'LOCKED',hint:'Unlock to talk'};
  if(window.speechSynthesis?.speaking&&!window.speechSynthesis.paused)return {state:'speaking',label:'SPEAKING',hint:'LUTHUR is talking · mic paused'};
  if(speechPlaybackBlocked())return {state:'paused',label:'MIC PAUSED',hint:'Speaker audio clearing · wait for Listening'};
  if(SpeechUI.phase==='mic-error')return {state:'error',label:'MIC NEEDS ATTENTION',hint:'Use Retry mic below'};
  const ready=VoiceVisual.oneShot||(Wake.on&&!Wake.paused&&Wake.ready&&!!Wake.rec);
  const busy=Cmd.waiting||S?.status?.chatBusy||(route.view==='assistant'&&chatState?.busy);
  if(ready&&Date.now()<VoiceVisual.heardUntil)return {state:'hearing',label:'HEARING YOU',hint:'Your words are appearing below'};
  if(ready&&Wake.buf?.trim())return {state:'captured',label:'WORDS CAPTURED',hint:'Pause to send · or use Send now'};
  if(SpeechUI.phase==='sending')return {state:'sending',label:'SENDING',hint:ready?'Sending your words · mic is still on':'Sending your words'};
  if(busy)return {state:'thinking',label:'THINKING',hint:ready?'Working on your reply · mic is still on':'Working on your reply'};
  if(ready&&!UPG.conversation&&!Wake.armed)return {state:'wake',label:'SAY “HEY LUTHUR”',hint:'Waiting for your call · other sounds are ignored'};
  if(ready)return {state:'listening',label:'LISTENING',hint:'Mic ready · you can speak now'};
  if(SpeechUI.phase==='wake'&&!UPG.conversation)return {state:'wake',label:'SAY “HEY LUTHUR”',hint:'Say “Hey LUTHUR” to start'};
  if(SpeechUI.editing)return {state:'paused',label:'MIC PAUSED',hint:'Edit your words below, then send'};
  if(UPG.conversation&&Wake.paused)return {state:'paused',label:'MIC PAUSED',hint:'Wait for Listening before speaking'};
  if(UPG.conversation&&Wake.on)return {state:'connecting',label:'MIC CONNECTING',hint:'Wait for Listening before speaking'};
  return {state:'idle',label:'READY',hint:'Tap the mic to start a conversation'};
}
const voiceIcons={mic:'<path d="M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0z"/><path d="M5 11v1a7 7 0 0 0 14 0v-1M12 19v3M8 22h8"/>',speaker:'<path d="M3 9h4l5-4v14l-5-4H3zM16 8a6 6 0 0 1 0 8M19 5a10 10 0 0 1 0 14"/>',thinking:'<circle cx="12" cy="12" r="8" stroke-dasharray="12 5"/><path d="M12 7v5l3 2"/>'};
function voiceIcon(state){return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${state==='speaking'?voiceIcons.speaker:['thinking','sending'].includes(state)?voiceIcons.thinking:voiceIcons.mic}</svg>`;}
function voiceSetText(el,text){if(el&&el.textContent!==text)el.textContent=text;}
function voiceVisualPaint(){
  const activity=voiceActivity();VoiceVisual.state=activity.state;
  const core=document.querySelector('.nv-core');
  if(core){
    if(!core.querySelector('.voice-core-status')){const status=document.createElement('div');status.className='voice-core-status';status.setAttribute('role','status');status.innerHTML='<div class="voice-core-icon"></div><b></b><span></span><div class="voice-bars" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>';core.append(status);}
    const changed=core.dataset.voiceState!==activity.state;core.dataset.voiceState=activity.state;
    const status=core.querySelector('.voice-core-status');if(changed)status.querySelector('.voice-core-icon').innerHTML=voiceIcon(activity.state);
    const centerLabel=status.querySelector('b');centerLabel.setAttribute('aria-label',activity.label);if(centerLabel.dataset.v!==activity.label){centerLabel.dataset.v=activity.label;centerLabel.textContent=activity.label;}voiceSetText(status.querySelector('span'),activity.hint);
    const listening=['listening','hearing','captured'].includes(activity.state);
    core.classList.toggle('listening',listening);core.classList.toggle('busy',['thinking','sending'].includes(activity.state));core.classList.toggle('speaking',activity.state==='speaking');
    const label=document.getElementById('coreState');if(label){voiceSetText(label,activity.label);label.dataset.v=activity.label;}
    NV.busyT=['thinking','sending'].includes(activity.state)?1:0;
    if(changed&&Core.ok&&Core.el===core&&!window.hqBooting)coreDraw(performance.now());
  }
  const assistantStatus=document.getElementById('voiceStatusPill');if(assistantStatus){assistantStatus.dataset.voiceState=activity.state;voiceSetText(assistantStatus,`${activity.label} · ${activity.hint}`);}
  const mic=document.getElementById('cmdMic');if(mic){mic.dataset.voiceState=activity.state;mic.setAttribute('aria-pressed',String(VoiceVisual.oneShot||(Wake.on&&!Wake.paused&&Wake.ready)));mic.setAttribute('aria-label',`${activity.label}. ${activity.hint}. ${UPG.conversation?'End':'Start'} conversation`);mic.title=mic.getAttribute('aria-label');mic.classList.toggle('live',Wake.on&&!Wake.paused&&Wake.ready);}
  const panel=document.getElementById('speechFeedback');if(panel){
    panel.dataset.voiceState=activity.state;
    const status=panel.querySelector('[data-speech-state]');voiceSetText(status,activity.state==='error'?'Microphone needs attention':`${activity.label.charAt(0)+activity.label.slice(1).toLowerCase()} · ${activity.hint}`);
    let delivery=panel.querySelector('.voice-delivery');if(!delivery){delivery=document.createElement('small');delivery.className='voice-delivery';panel.querySelector('.speech-text').before(delivery);}
    voiceSetText(delivery,SpeechUI.phase==='failed'?'Not sent · your words are saved for retry':SpeechUI.phase==='queued'?'Follow-up queued':SpeechUI.phase==='sent'?'Last turn sent':'');
    panel.querySelectorAll('[data-speech-send],[data-speech-edit]').forEach(button=>button.hidden=!SpeechUI.text&&!Wake.buf&&!SpeechUI.failed);
  }
}
const voiceCoreState=coreState;coreState=function(){if(!document.querySelector('.nv-core'))voiceCoreState();voiceVisualPaint();};

const visualSpeechStatus=speechStatus;speechStatus=function(phase,detail=''){if(['hearing','draft'].includes(phase))VoiceVisual.heardUntil=Date.now()+900;return visualSpeechStatus(phase,detail);};
const visualCommandView=vCommand;vCommand=async function(el){await visualCommandView(el);voiceVisualPaint();};
const visualAssistantView=vAssistant;vAssistant=async function(el){await visualAssistantView(el);const form=document.getElementById('chatForm');if(form&&!document.getElementById('voiceStatusPill')){const pill=document.createElement('div');pill.id='voiceStatusPill';pill.className='voice-status-pill';pill.setAttribute('role','status');form.before(pill);}voiceVisualPaint();};
const visualListen=listen;listen=function(onText,onState){return visualListen((text,final)=>{if(speechPlaybackBlocked())return;VoiceVisual.heardUntil=Date.now()+900;SpeechUI.text=text;onText(text,final);voiceVisualPaint();},on=>{VoiceVisual.oneShot=on;onState?.(on);voiceVisualPaint();});};
setInterval(()=>{if(!document.hidden)voiceVisualPaint();},200);
voiceVisualPaint();


