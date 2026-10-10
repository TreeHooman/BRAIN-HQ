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

// Barge-in (owner ask, 2026-10-07): while LUTHUR speaks, the stop listener hears the mic. When the owner starts talking
// (words that aren't LUTHUR's own speech echoing back), LUTHUR goes quiet at once and keeps that recognizer open until the
// owner's sentence is final, then sends it with a note so the reply answers them and can finish the cut-off thought.
// The name is optional ("Luther, ..." still works). "stop"/"shut up" alone only hush (force-stop.js).
const Barge={hold:0,said:'',note:'',noteAt:0,from:0,t:0};
const BARGE_NAME=/^(?:hey |ok |okay )?(?:luthur|luthor|luther|lutha|lothar|jarvis)\b ?/;
const bargeHolding=()=>Barge.hold&&Date.now()-Barge.hold<12000;
function bargeEcho(text,speech){
  const w=stopWords(text).split(' ').filter(Boolean),s=new Set(stopWords(speech).split(' '));
  return !w.length||w.filter(x=>s.has(x)).length/w.length>=0.6;
}
function bargeQuiet(said){
  if(!Barge.hold){Barge.hold=Date.now();Barge.said=said||'';}
  window.speechSynthesis?.cancel();
}
function bargeRelease(){
  clearTimeout(Barge.t);if(!Barge.hold)return;Barge.hold=0;bargeStop.call(StopMonitor);
  if(Wake.on&&!ForceStop.stopped&&!Access.locked)Wake.resume();
}
function bargeIn(ask,said){
  clearTimeout(Barge.t);Barge.hold=0;bargeStop.call(StopMonitor);window.speechSynthesis?.cancel();
  const heard=String(said||'').replace(/\s+/g,' ').trim().slice(0,220);
  Barge.note=heard?`The owner interrupted you while you were saying: "${heard}". Answer what they just said first; if your earlier point still matters, finish it in a sentence after.`:'';Barge.noteAt=Date.now();
  setTimeout(()=>{if(!ForceStop.stopped&&!Access.locked){window.hqVoiceTurn=Date.now();voiceCommand(ask);if(Wake.on)Wake.resume();}},250);
}
const bargeContext=cmdContext;
cmdContext=function(){const c=bargeContext.apply(this,arguments);if(!Barge.note||Date.now()-Barge.noteAt>60e3)return c;const n=Barge.note;Barge.note='';return c?`${n}\n${c}`:n;};
// While the owner is mid-sentence, nothing may close that recognizer or start the normal one over it.
const bargeStop=StopMonitor.stop;
StopMonitor.stop=function(){if(bargeHolding())return;Barge.hold=0;return bargeStop.call(this);};
const bargeWakeStart=Wake.start;
Wake.start=function(){if(bargeHolding())return;return bargeWakeStart.apply(this,arguments);};
setInterval(()=>{if(Barge.hold&&!bargeHolding())bargeRelease();},1000);
const bargeStart=StopMonitor.start;
StopMonitor.start=function(){
  if(bargeHolding()&&this.rec)return;
  bargeStart.call(this);const r=this.rec;if(!r)return;const prev=r.onresult,prevEnd=r.onend;
  r.onend=e=>{if(this.rec===r&&Barge.hold){this.rec=null;this.ready=false;bargeRelease();return;}prevEnd?.call(r,e);};
  // Owner ask (2026-10-08): "whenever I talk I want it to stop talking and let me finish". He goes quiet on the first
  // two words that aren't his own echo (was three), then keeps listening across pauses and sends only after the owner
  // has really finished (the same silence rule as a normal turn, longer after "and…"/"um…"), not on the first breath.
  r.onresult=e=>{
    prev?.call(r,e);
    if(this.rec!==r||ForceStop.stopped||Access.locked)return;
    const last=e.results[e.results.length-1];if(!last)return;
    if(!Barge.hold){
      const text=stopWords(last[0].transcript),ask=text.replace(BARGE_NAME,'').trim();if(!ask)return;
      if(bargeEcho(text,this.speech)||isStopRequest(ask))return;
      const first=ask.split(' ');if(first.length<2&&first[0].length<3)return; // one real word is enough (owner, 2026-10-09)
      Barge.from=e.results.length-1;bargeQuiet(this.speech);
    }
    Barge.hold=Date.now();clearTimeout(Barge.t); // still talking: keep the mic, restart the silence clock
    const ask=stopWords(Array.from(e.results).slice(Barge.from).map(x=>x[0].transcript).join(' ')).replace(BARGE_NAME,'').trim();
    if(!ask)return;
    if(isStopRequest(ask)){bargeRelease();return;}
    if(!last.isFinal)return;
    const said=Barge.said||this.speech;
    Barge.t=setTimeout(()=>{
      if(this.rec!==r||!Barge.hold)return;
      if(ask.split(' ').length<2){bargeRelease();return;}
      bargeIn(ask,said);
    },typeof turnPauseFor==='function'?turnPauseFor(ask,turnPauseBase()):1000);
  };
};
const earlySpeakChatReply=speakChatReply;
speakChatReply=function(c,force=false){
  const last=c?.messages?.at(-1);
  // The final hq message sits at the index the partial turn was keyed on: this turn was already spoken.
  if(last?.role==='hq'&&!last.error&&EarlySpeech.key===`${c.id||'chat'}:${c.messages.length-1}`){VoiceReply.last=`${c.id||'chat'}:${last.at||last.text}`;return;}
  return earlySpeakChatReply.call(this,c,force);
};
