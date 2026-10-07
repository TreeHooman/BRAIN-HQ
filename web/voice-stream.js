"use strict";
// Early speech: the reply opens with <spoken>one sentence</spoken>, which arrives in the 500ms partial poll long before
// the full answer is done. Say it as soon as it is complete, then skip the duplicate when the final reply lands.
const EarlySpeech={key:'',said:''};
const earlyWanted=()=>voiceOn()||Date.now()-(window.hqVoiceTurn||0)<10*60e3;
function earlySpeak(c){
  if(!c?.busy||!c.partial||!earlyWanted()||(typeof ForceStop!=='undefined'&&ForceStop.stopped))return;
  const key=`${c.id||'chat'}:${c.messages?.length||0}`;if(EarlySpeech.key===key)return;
  const m=String(c.partial).match(/<spoken>\s*([^<>]{1,360}?)\s*<\/spoken>/i);if(!m)return;
  const text=m[1].replace(/[#*_`>|]/g,'').replace(/\s+/g,' ').trim();if(!text)return;
  EarlySpeech.key=key;EarlySpeech.said=text;
  if(typeof speakAlways==='function')speakAlways(text);else speak(text);
}
const earlyShowReply=cmdShowReply;
cmdShowReply=function(c,animate){earlySpeak(c);return earlyShowReply.call(this,c,animate);};
const earlySpeakChatReply=speakChatReply;
speakChatReply=function(c,force=false){
  const last=c?.messages?.at(-1);
  // The final hq message sits at the index the partial turn was keyed on: this turn was already spoken.
  if(last?.role==='hq'&&!last.error&&EarlySpeech.key===`${c.id||'chat'}:${c.messages.length-1}`){VoiceReply.last=`${c.id||'chat'}:${last.at||last.text}`;return;}
  return earlySpeakChatReply.call(this,c,force);
};
