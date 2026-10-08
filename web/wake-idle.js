"use strict";
// Give the owner a follow-up window, measured after playback and echo cooldown.
const WakeIdle={active:false,last:0,speaking:false,delay:5000,sent:false,named:0};
function wakeIdleTouch(){WakeIdle.last=Date.now();}
const followUpsOn=()=>localStorage.getItem('hq-followup')==='1';
const idleConversation=upConversation;
upConversation=function(on){
  const result=idleConversation(on);
  WakeIdle.active=!!on&&!WAKE_PHONE;
  WakeIdle.speaking=false;WakeIdle.sent=false;wakeIdleTouch();
  return result;
};
// Every spoken turn passes here first (this file loads after the other voiceCommand wrappers).
// - Fragments the mic picked up from the room ("a", "s", "has") are dropped: one word only counts if it's a real reply.
// - "Stop listening", "go to sleep", "that's all", "never mind", "goodbye" end the conversation and go back to the name.
const SHORT_REPLY=/^(yes|yeah|yep|yup|no|nope|nah|sure|okay|ok|thanks|thank you|stop|continue|go|done|cancel|repeat|again|next|why|what|how|when|where|who|both|neither|later|now)$/;
const END_TALK=/\b(stop listening|go to sleep|that'?s all|that is all|never ?mind|good ?bye|bye bye|you can go|i'?m done|we'?re done)\b/;
const idleVoiceCommand=voiceCommand;
voiceCommand=function(text){
  const t=String(text||'').toLowerCase().replace(/[.,!?]+/g,' ').replace(/\s+/g,' ').trim(), words=t.match(/[a-z0-9']+/g)||[];
  if(END_TALK.test(t)&&words.length<=8){speechClearTurn();if(UPG.conversation)upConversation(false);speechStatus('wake');return;}
  if(words.length<2&&!SHORT_REPLY.test(t))return;
  // After the first request, more speech only counts if it used the name (or interrupted LUTHUR mid-sentence,
  // which voice-stream.js marks just before calling this).
  const barge=Date.now()-(window.hqVoiceTurn||0)<400;
  if(WakeIdle.sent&&!followUpsOn()&&!barge&&Date.now()-WakeIdle.named>15000)return;
  WakeIdle.sent=true;
  return idleVoiceCommand(text);
};
// Settings → Voice: let the owner turn follow-ups back on.
const idleSettings=vSettings;
vSettings=function(el){
  const r=idleSettings(el),box=document.getElementById('pcWakeStatus');
  if(box&&!document.getElementById('followUps')){box.insertAdjacentHTML('afterend',`<label><input id="followUps" type="checkbox" ${followUpsOn()?'checked':''}> Follow-up questions without the name · after an answer, listen 5 seconds for more (off = always say “Hey LUTHUR”)</label>`);
    document.getElementById('followUps').onchange=e=>localStorage.setItem('hq-followup',e.target.checked?'1':'0');}
  return r;
};
const idleHeard=Wake.heard;
Wake.heard=function(text,final,snapshot=false){
  if(/^\s*(?:hey|hi|ok|okay)?\s*(?:luthur|luther|luthor|lutha|lothar|jarvis)\b/i.test(String(text||'')))WakeIdle.named=Date.now();
  const result=idleHeard.call(this,text,final,snapshot);
  if(!speechPlaybackBlocked()&&this.on&&!this.paused&&(this.armed||this.buf)){
    WakeIdle.active=true;wakeIdleTouch();
  }
  return result;
};
const idleStart=Wake.start;
Wake.start=function(){
  const result=idleStart.call(this),recognizer=this.rec;
  if(recognizer&&!recognizer._idleWatch){
    recognizer._idleWatch=true;
    for(const event of ['onspeechstart','onspeechend','onend','onerror']){
      const previous=recognizer[event];
      recognizer[event]=function(...args){
        if(Wake.rec===recognizer){
          const wasSpeaking=WakeIdle.speaking;
          // onspeechstart fires on fans and wind too, so it no longer keeps a conversation open.
          WakeIdle.speaking=false;
          if(wasSpeaking)wakeIdleTouch();
        }
        return previous?.apply(this,args);
      };
    }
  }
  return result;
};
function wakeIdleCheck(){
  if(!WakeIdle.active)return;
  if(Access.locked||ForceStop.stopped||ForceStop.busy){WakeIdle.active=false;return;}
  if(!Wake.rec||Wake.paused)WakeIdle.speaking=false;
  if(speechPlaybackBlocked()||Cmd.waiting||chatState?.busy||UPG.pending.length||
    WakeIdle.speaking||Wake.buf?.trim()||SpeechUI.editing||SpeechUI.failed){
    wakeIdleTouch();return;
  }
  // Name required (owner ask, 2026-10-08): once a request was sent and answered, go straight back to "Hey LUTHUR"
  // instead of keeping the mic open for follow-ups. Settings → "Follow-up questions without the name" restores it.
  const delay=WakeIdle.sent&&!followUpsOn()?700:WakeIdle.delay;
  if(Date.now()-WakeIdle.last<delay)return;
  WakeIdle.active=false;WakeIdle.speaking=false;
  const nativeReturn=pcVoiceReturn;
  speechClearTurn();
  if(UPG.conversation)upConversation(false);
  // Native handoff is rearmed by the existing conversation toggle. Browser
  // wake listening keeps its microphone but no longer accepts unnamed speech.
  if(!nativeReturn){Wake.on=true;Wake.paused=false;Wake.start();Wake.btn();}
  speechStatus('wake');
}
setInterval(wakeIdleCheck,200);

// However a conversation ends (idle, "end conversation", the mic button, the hologram), go back to waiting for
// "Hey LUTHUR". If the PC listener started it, make sure the PC listener really came back (retry, since the mic can
// still be busy for a moment); if it can't, the browser listens for the name instead so the wake word never goes dead.
// A force stop or the PIN lock stays silent until the owner resumes.
const rearmConversation=upConversation;
upConversation=function(on){
  const was=UPG.conversation,native=pcVoiceReturn,result=rearmConversation(on);
  if(!on&&was)setTimeout(()=>wakeRearm(native),400);
  return result;
};
async function wakeRearm(native){
  const quiet=()=>UPG.conversation||ForceStop.stopped||Access.locked||window.hqDesktopVoiceOwner;
  if(quiet())return;
  if(native){
    for(let i=0;i<3;i++){
      await new Promise(resolve=>setTimeout(resolve,1500));if(quiet())return;
      try{const state=await api('/pc-voice');if(state.running){pcVoiceWasOn=true;Wake.pause();pcVoicePaint(state);return;}
        if(i<2)await api('/pc-voice','PUT',{enabled:true});}catch{}
    }
    if(quiet())return;
  }
  Wake.on=true;Wake.paused=false;hstore.set('hq-wake','1');Wake.btn();Wake.start();speechStatus('wake');
}
