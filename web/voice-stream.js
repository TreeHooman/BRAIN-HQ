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
// Screen first: a show_on_screen made during this turn is applied while the reply is still being written. Read-aloud and
// summaries wait for the end so they never talk over the early sentence. scrFromChat skips ones already shown.
function earlyScreen(c){
  const s=c?.screen,you=[...(c?.messages||[])].reverse().find(m=>m.role==='you');
  if(!s?.id||s.read_aloud||s.summarize||typeof scrFromChat!=='function'||!you)return;
  const at=Number(s.at)||Date.parse(s.at),since=Date.parse(you.at||'');
  if(Number.isFinite(at)&&Number.isFinite(since)&&at>=since-2000)scrFromChat(s);
}
/** Called by the busy branch of the chat poll (hud.js cmdPollStart). */
function chatWhileBusy(c){earlySpeak(c);earlyScreen(c);}

// Barge-in by name: while LUTHUR speaks, only the stop listener hears the mic (speaker echo). "Luther, <new request>"
// now cuts the playback and sends the new request. Words LUTHUR is saying itself are ignored.
const BARGE=/^(?:hey |ok |okay )?(?:luthur|luthor|luther|lutha|lothar|jarvis) (.+)$/;
function bargeIn(ask){
  StopMonitor.stop();window.speechSynthesis?.cancel();
  setTimeout(()=>{if(!ForceStop.stopped&&!Access.locked){window.hqVoiceTurn=Date.now();voiceCommand(ask);}},250);
}
const bargeStart=StopMonitor.start;
StopMonitor.start=function(){
  bargeStart.call(this);const r=this.rec;if(!r)return;const prev=r.onresult;
  r.onresult=e=>{
    prev?.call(r,e);
    if(this.rec!==r||ForceStop.stopped||Access.locked)return;
    const last=e.results[e.results.length-1];if(!last?.isFinal)return;
    const m=stopWords(last[0].transcript).match(BARGE);if(!m)return;
    const ask=m[1].trim();if(ask.split(' ').length<2||isStopRequest(ask)||stopWords(this.speech).includes(ask))return;
    bargeIn(ask);
  };
};
const earlySpeakChatReply=speakChatReply;
speakChatReply=function(c,force=false){
  const last=c?.messages?.at(-1);
  // The final hq message sits at the index the partial turn was keyed on: this turn was already spoken.
  if(last?.role==='hq'&&!last.error&&EarlySpeech.key===`${c.id||'chat'}:${c.messages.length-1}`){VoiceReply.last=`${c.id||'chat'}:${last.at||last.text}`;return;}
  return earlySpeakChatReply.call(this,c,force);
};
