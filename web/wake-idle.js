"use strict";
// Give the owner a follow-up window, measured after playback and echo cooldown.
const WakeIdle={active:false,last:0,speaking:false,delay:5000};
function wakeIdleTouch(){WakeIdle.last=Date.now();}
const idleConversation=upConversation;
upConversation=function(on){
  const result=idleConversation(on);
  WakeIdle.active=!!on&&!WAKE_PHONE;
  WakeIdle.speaking=false;wakeIdleTouch();
  return result;
};
const idleHeard=Wake.heard;
Wake.heard=function(text,final,snapshot=false){
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
          WakeIdle.speaking=event==='onspeechstart';
          if(event==='onspeechstart'||event==='onspeechend'||wasSpeaking)wakeIdleTouch();
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
  if(Date.now()-WakeIdle.last<WakeIdle.delay)return;
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
