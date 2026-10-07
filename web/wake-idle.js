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
