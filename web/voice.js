"use strict";
// Device voices are previewable without an account or a paid speech provider.
function configureVoice(u){
  const voices=window.speechSynthesis?.getVoices()||[],selected=localStorage.getItem("hq-voice-id");
  const found=voices.find(v=>v.voiceURI===selected)||voices.find(v=>v.name===selected);
  if(found)u.voice=found;
  u.rate=Math.max(.7,Math.min(1.5,Number(localStorage.getItem("hq-voice-rate")||1.05)));
  u.pitch=Math.max(.6,Math.min(1.4,Number(localStorage.getItem("hq-voice-pitch")||.95)));
  // Preserve pending owner speech when playback starts; recognition ignores our voice.
}
function voiceChoices(){
  const select=document.getElementById("voiceChoice");if(!select)return;
  const selected=localStorage.getItem("hq-voice-id")||"",voices=window.speechSynthesis?.getVoices()||[];
  select.innerHTML='<option value="">Automatic · English assistant voice</option>'+voices.map(v=>`<option value="${esc(v.voiceURI)}" ${v.voiceURI===selected?'selected':''}>${esc(v.name)} · ${esc(v.lang)}</option>`).join('');
  if(selected&&!voices.some(v=>v.voiceURI===selected))select.insertAdjacentHTML('beforeend',`<option selected value="${esc(selected)}">Saved voice unavailable on this device · using automatic</option>`);
}
window.speechSynthesis?.addEventListener("voiceschanged",voiceChoices);
const voiceSettings=vSettings;
vSettings=function(el){
  voiceSettings(el);const section=document.createElement("section");section.className="card no-fold";
  section.innerHTML=`<h2>Voice & conversation</h2><p class="small muted">Pick a voice installed or provided by this browser. Preview it before choosing. These preferences are saved on this device.</p><form id="voiceSettings" class="form"><label class="f">Assistant voice<select id="voiceChoice"></select></label><div class="row"><button type="button" class="btn sm" id="voicePreview">Preview voice</button><button type="button" class="btn sm ghost" id="voicePreviewStop">Stop preview</button></div><div class="two"><label class="f">Speaking speed<input id="voiceRate" type="range" min="0.7" max="1.5" step="0.05" value="${localStorage.getItem('hq-voice-rate')||1.05}"></label><label class="f">Pitch<input id="voicePitch" type="range" min="0.6" max="1.4" step="0.05" value="${localStorage.getItem('hq-voice-pitch')||.95}"></label></div><label class="f">Pause before sending a spoken turn<select id="voicePause"><option value="700">Quick · 0.7 seconds</option><option value="1000">Natural · 1 second</option><option value="1600">Relaxed · 1.6 seconds</option><option value="2400">Slow · 2.4 seconds</option></select></label><label><input id="voiceFast" type="checkbox" ${localStorage.getItem('hq-voice-fast')!=='0'?'checked':''}> Use Fast for casual spoken conversation</label><p class="small muted">Desktop: tap the War Room mic once to keep talking, and again to stop. Mobile speech input uses one tap per turn. Custom voices require a separate speech provider; a reference can guide that later.</p></form>`;
  el.querySelector('h1')?.after(section);voiceChoices();document.getElementById('voicePause').value=localStorage.getItem('hq-turn-pause2')||'1000';
  section.insertAdjacentHTML('beforeend',`<div class="form"><label><input id="voiceDeep" type="checkbox" ${localStorage.getItem('hq-voice-deep')==='1'?'checked':''}> Use Deep thinking for spoken work requests</label><label><input id="pcWake" type="checkbox"> PC wake listener · waits for “Hey LUTHUR” or “LUTHUR”</label><p id="pcWakeStatus" class="small muted">Checking PC listener…</p><p class="small muted">PC listener works while LUTHUR is minimized. Keep the local server running. Say the name to start a conversation in your chosen voice. Say “end conversation” to return to wake-only listening. Windows voice recognition accuracy depends on your microphone.</p></div>`);
  document.getElementById('voiceDeep').onchange=e=>localStorage.setItem('hq-voice-deep',e.target.checked?'1':'0');
  document.getElementById('pcWake').disabled=true;
  api('/pc-voice').then(pcVoicePaint).catch(pcVoiceUnavailable);
  document.getElementById('pcWake').onchange=async e=>{localStorage.setItem('hq-pcwake',e.target.checked?'1':'0');try{pcVoiceReturn=false;SpeechPlayback.rearmPc=false;const state=await api('/pc-voice','PUT',{enabled:e.target.checked});pcVoicePaint(state);if(state.running){upConversation(false);Wake.pause();pcVoiceWasOn=true;}else{pcVoiceWasOn=false;Wake.resume();}}catch(err){e.target.checked=false;toast(err.message);}};
  for(const [id,key]of[['voiceChoice','hq-voice-id'],['voiceRate','hq-voice-rate'],['voicePitch','hq-voice-pitch'],['voicePause','hq-turn-pause2']])document.getElementById(id).oninput=e=>localStorage.setItem(key,e.target.value);
  document.getElementById('voiceFast').onchange=e=>localStorage.setItem('hq-voice-fast',e.target.checked?'1':'0');
  document.getElementById('voiceSettings').onsubmit=e=>e.preventDefault();
  document.getElementById('voicePreview').onclick=()=>{if(!window.speechSynthesis)return toast('Speech playback is unavailable in this browser.');const u=new SpeechSynthesisUtterance("I'm Luthor. I can help you review your plans, investigate issues, and keep your work moving. What shall we work on?");configureVoice(u);u.volume=Number(localStorage.getItem('hq-voice-volume')??1);speechSynthesis.cancel();if(typeof speechPlaybackStart==='function')speechPlaybackStart(u);if(typeof ForceStop==='undefined'||!ForceStop.stopped)speechSynthesis.speak(u);};
  document.getElementById('voicePreviewStop').onclick=()=>window.speechSynthesis?.cancel();
};
const conversationCommand=vCommand;
vCommand=async function(el){
  await conversationCommand(el);if(route.view!=="command")return;
  const mic=document.getElementById('cmdMic');if(mic&&!WAKE_PHONE){mic.onclick=()=>upConversation(!UPG.conversation);mic.title='Start or end continuous conversation';mic.setAttribute('aria-label',mic.title);mic.classList.toggle('live',UPG.conversation);}
};
const conversationToggle=upConversation;
upConversation=function(on){const was=UPG.conversation;if(on&&pcVoiceWasOn){pcVoiceReturn=true;api('/pc-voice','PUT',{enabled:false}).catch(e=>toast(e.message));pcVoiceWasOn=false;Wake.paused=false;}conversationToggle(on);document.getElementById('cmdMic')?.classList.toggle('live',on);if(!on&&was&&pcVoiceReturn){pcVoiceReturn=false;api('/pc-voice','PUT',{enabled:true}).then(state=>{pcVoiceWasOn=state.running;if(state.running)Wake.pause();pcVoicePaint(state);}).catch(e=>toast(e.message));}};
// Favor a quick model only for casual speech, retaining the selected tier for substantive work.
const conversationApi=api;
api=function(path,method,body){
  const voiced=body?.voice===true||Date.now()-(window.hqVoiceAt||0)<6000;
  const work=/\b(fix|bug|build|code|edit|change|update|delete|complete|review|inspect|check|research|report|plan|compare|analy[sz]e|diagnos\w*|think deeply)\b/i.test(body?.text||'');
  if(path==='/chat'&&method==='POST'&&voiced&&!body?.modelPolicy){
    if(work&&localStorage.getItem('hq-voice-deep')==='1')body={...body,tier:'deep',effort:'high'};
    else if(!work&&localStorage.getItem('hq-voice-fast')!=='0')body={...body,tier:'fast',effort:'low'};
  }
  const request=conversationApi(path,method,body);
  // Listening/thinking graphics acknowledge receipt; speak only useful replies.
  return request;
};
function pcVoicePaint(state){
  const checkbox=document.getElementById('pcWake'),note=document.getElementById('pcWakeStatus');
  if(state.protocol!==2){if(checkbox)checkbox.disabled=true;if(note)note.textContent='Restart LUTHUR once to load the chosen-voice conversation handoff.';return;}
  if(checkbox){checkbox.checked=state.running||pcVoiceReturn;checkbox.disabled=false;}
  if(note)note.textContent=state.error|| (pcVoiceReturn&&UPG.conversation?'Conversation active. End conversation to return to wake-only listening.':state.running?'Listening for your call. Other speech does not send a request.':'PC listener off.');
}
function pcVoiceUnavailable(error){
  const checkbox=document.getElementById('pcWake'),note=document.getElementById('pcWakeStatus');
  if(checkbox)checkbox.disabled=true;
  if(note)note.textContent=/unlock/i.test(error?.message||'')?'Unlock LUTHUR with your PIN, then this switch will become available.':/No such endpoint/i.test(error?.message||'')?'Server restart needed. Run RESTART-LUTHUR.cmd from the LUTHUR scripts folder. Closing the app window alone does not restart the server.':'Waiting for the local server. This switch will become available automatically when it reconnects.';
}
let pcVoiceLast=0,pcVoiceWasOn=false,pcVoicePolling=false,pcVoiceReturn=false,pcAutoAt=0;
async function pcVoicePoll(){
  if(pcVoicePolling)return;pcVoicePolling=true;
  try{
    const state=await api('/pc-voice');pcVoicePaint(state);
    if(state.protocol!==2)return;
    if(!window.hqOverlay&&state.surface==='overlay'){window.hqDesktopVoiceOwner=true;Wake.pause();window.speechSynthesis?.cancel();return;}
    window.hqDesktopVoiceOwner=false;
    if(state.running&&!pcVoiceWasOn){upConversation(false);Wake.pause();}
    if(!state.running&&pcVoiceWasOn)Wake.resume();
    pcVoiceWasOn=state.running;
    // "Hey LUTHUR" stays on (owner ask, 2026-10-08): a restart or unlock forgets the PC listener, so the main window
    // turns it back on whenever nothing else is using the mic. Unticking it in Settings is remembered (hq-pcwake=0).
    if(!state.running&&!state.event&&!state.error&&!window.hqOverlay&&localStorage.getItem('hq-pcwake')!=='0'&&!UPG.conversation&&!pcVoiceReturn&&
      !(typeof ForceStop!=='undefined'&&ForceStop.stopped)&&!(typeof Access!=='undefined'&&Access.locked)&&!speechPlaybackBlocked()&&!Cmd.waiting&&Date.now()-pcAutoAt>8000){
      pcAutoAt=Date.now();const on=await api('/pc-voice','PUT',{enabled:true}).catch(()=>null);
      if(on?.running){pcVoiceWasOn=true;Wake.pause();pcVoicePaint(on);}
    }
    // Only claim the wake word while this window is the one in use: a window hidden behind others still counts as
    // "visible", which sent "Hey LUTHUR" to it instead of popping up the side panel.
    if(state.running&&!window.hqOverlay&&document.visibilityState==='visible'&&document.hasFocus())api('/desktop-overlay','POST',{action:'main-visible'}).catch(()=>{});
    const event=state.event;
    if(event?.target==='overlay'&&!window.hqOverlay)return;
    if(event&&event.at>pcVoiceLast){pcVoiceLast=event.at;if(Date.now()-event.at<20000&&(await api('/pc-voice/claim','POST',{at:event.at})).event){
      const wlog=line=>api('/wake-engine/log','POST',{line}).catch(()=>{});
      if(typeof speechPlaybackBlocked==='function'&&(speechPlaybackBlocked()||event.at<=SpeechPlayback.ignorePcBefore)){wlog('page dropped it: LUTHUR was speaking');return;}
      wlog(`page starts conversation (${route.view}, words: ${event.text?.trim()?event.text.trim().split(/\s+/).length:0})`);
      window.hqVoiceAt=Date.now();
      if(route.view!=='command'){location.hash='command';await new Promise(resolve=>setTimeout(resolve,400));}
      if(event.kind==='wake'){
        if(!Wake.supported()){toast('Wake detected. Open LUTHUR in Chrome or Edge to start microphone conversation.');return;}
        await api('/pc-voice','PUT',{enabled:false});pcVoiceWasOn=false;pcVoiceReturn=true;Wake.paused=false;upConversation(true);
        if(event.text?.trim())voiceCommand(event.text);
      }else voiceCommand(event.text);
    }}
  }catch(error){pcVoiceUnavailable(error);}finally{pcVoicePolling=false;}
}
setInterval(pcVoicePoll,1000);




