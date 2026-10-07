"use strict";
// ElevenLabs voice. When it is on, speechSynthesis.speak() is routed to /api/tts/speak and played as audio.
// Everything else keeps using the speechSynthesis API: speaking/pending/cancel and the utterance's start/end/error events
// behave as they do for a device voice, so mic pausing, the orb and the hologram need no changes.
// If ElevenLabs fails (no key, no credit, offline), the device voice speaks instead.
const Eleven={on:false,status:null,u:null,audio:null,ctl:null,fetching:false,warned:false};
// Fallback voice: keep the British "JARVIS" voice. A voice the owner picked in Settings wins; otherwise the best en-GB male.
function britishFallback(u){
  if(localStorage.getItem('hq-voice-id')&&u.voice)return;
  const vs=window.speechSynthesis.getVoices().filter(v=>/en-GB/i.test(v.lang)),male=/(Ryan|Thomas|George|Daniel|Arthur|Oliver|Alfie|Elliot|Male)/i;
  u.voice=vs.find(v=>male.test(v.name)&&/Natural/i.test(v.name))||vs.find(v=>male.test(v.name))||vs.find(v=>/Natural/i.test(v.name))||vs[0]||u.voice;
  if(u.voice)u.lang=u.voice.lang;
}
(function(){
  const ss=window.speechSynthesis;if(!ss)return;
  const proto=Object.getPrototypeOf(ss),nativeSpeak=ss.speak.bind(ss),nativeCancel=ss.cancel.bind(ss);
  const getter=name=>Object.getOwnPropertyDescriptor(proto,name)?.get;
  const live={speaking:()=>!!Eleven.u&&!Eleven.fetching,pending:()=>!!Eleven.u&&Eleven.fetching,paused:()=>false};
  for(const name of ['speaking','pending','paused']){const g=getter(name);if(!g)continue;Object.defineProperty(ss,name,{configurable:true,get(){return Eleven.u?live[name]():g.call(ss);}});}
  const fire=(u,type,error)=>{let e;try{e=type==='error'?new SpeechSynthesisErrorEvent('error',{utterance:u,error}):new SpeechSynthesisEvent(type,{utterance:u});}catch{e=new Event(type);if(error)e.error=error;}u.dispatchEvent(e);};
  const stop=()=>{Eleven.ctl?.abort();Eleven.ctl=null;const a=Eleven.audio;Eleven.audio=null;if(a){a.onended=a.onerror=null;a.pause();URL.revokeObjectURL(a.src);}const u=Eleven.u;Eleven.u=null;Eleven.fetching=false;return u;};
  ss.cancel=function(){const u=stop();if(u)fire(u,'error','interrupted');nativeCancel();};
  ss.speak=function(u){
    if(!Eleven.on)return nativeSpeak(u);
    const prev=stop();if(prev)fire(prev,'error','interrupted');
    const ctl=new AbortController();Eleven.u=u;Eleven.ctl=ctl;Eleven.fetching=true;
    const fallback=msg=>{if(Eleven.u!==u)return;stop();if(!Eleven.warned&&typeof toast==='function'){Eleven.warned=true;toast(/credits/i.test(msg)?'ElevenLabs credits ran out · using the free voice until they refill':'ElevenLabs voice unavailable, using device voice: '+msg);}britishFallback(u);nativeSpeak(u);};
    fetch('/api/tts/speak',{method:'POST',headers:{'Content-Type':'application/json','X-HQ':'1'},body:JSON.stringify({text:u.text,speed:u.rate}),signal:ctl.signal})
      .then(async r=>{if(!r.ok){let m='error '+r.status;try{m=(await r.json()).error||m;}catch{}throw new Error(m);}return r.blob();})
      .then(blob=>{
        if(Eleven.u!==u)return;
        const a=new Audio(URL.createObjectURL(blob));a.volume=Math.max(0,Math.min(1,Number(u.volume??1)));Eleven.audio=a;Eleven.fetching=false;
        const done=type=>()=>{if(Eleven.audio!==a)return;stop();fire(u,type,type==='error'?'audio-busy':undefined);};
        a.onended=done('end');a.onerror=done('error');
        a.play().then(()=>{if(Eleven.audio===a)fire(u,'start');},e=>{if(Eleven.audio!==a)return;stop();fire(u,'error',e?.name==='NotAllowedError'?'not-allowed':'audio-busy');});
      })
      .catch(e=>{if(e?.name!=='AbortError')fallback(e.message);});
  };
})();
function elevenRefresh(){return api('/tts').then(s=>{Eleven.status=s;Eleven.on=!!s.enabled;Eleven.warned=false;return s;}).catch(()=>null);}
elevenRefresh();

const elevenSettings=vSettings;
vSettings=function(el){
  elevenSettings(el);
  const anchor=document.getElementById('voiceSettings')?.closest('section');if(!anchor)return;
  const card=document.createElement('section');card.className='card no-fold';card.id='elevenCard';
  card.innerHTML=`<h2>ElevenLabs voice</h2><p class="small muted">Give LUTHUR a premium voice from your ElevenLabs account. Your API key stays in this PC's private settings and is never shown again. Speaking speed above still applies; pitch does not.</p>
  <form class="form" id="elevenForm"><label class="f">API key<input id="elevenKey" type="password" autocomplete="off" placeholder="Paste a new key to save it"></label>
  <label class="f">Voice<select id="elevenVoice"><option value="">Save your key to load your voices</option></select></label>
  <label class="f">Or a voice ID<input id="elevenVoiceId" placeholder="e.g. from Voice Library → ID"></label>
  <div class="two"><label class="f">Stability · lower is more expressive<input id="elevenStability" type="range" min="0" max="1" step="0.05"></label><label class="f">Style · higher is more character<input id="elevenStyle" type="range" min="0" max="1" step="0.05"></label></div>
  <label><input id="elevenOn" type="checkbox"> Use ElevenLabs as LUTHUR's default voice · switches to the free voice automatically if credits run out</label>
  <div class="row"><button class="btn sm" type="submit">Save</button><button type="button" class="btn sm" id="elevenPreview">Preview</button><button type="button" class="btn sm ghost" id="elevenClear">Remove key</button></div>
  <p class="small muted" id="elevenState"></p></form>`;
  anchor.after(card);
  const $e=id=>document.getElementById(id);
  const paint=s=>{if(!s)return;$e('elevenState').textContent=!s.configured?'No API key saved.':s.enabled&&s.outOfCredits?`On · ${s.voiceName||s.voiceId} · credits used up, using the free voice for now`:s.enabled?`On · ${s.voiceName||s.voiceId}`:s.voiceId?'Key saved · voice chosen · turned off':'Key saved · pick a voice';$e('elevenOn').checked=s.enabled;$e('elevenVoiceId').value=s.voiceId;$e('elevenStability').value=s.stability;$e('elevenStyle').value=s.style;};
  const loadVoices=s=>{if(!s?.configured)return;api('/tts/voices').then(vs=>{const sel=$e('elevenVoice');sel.innerHTML='<option value="">Choose a voice…</option>'+vs.map(v=>`<option value="${esc(v.id)}" ${v.id===s.voiceId?'selected':''}>${esc(v.name)}${v.category?' · '+esc(v.category):''}</option>`).join('');}).catch(e=>{$e('elevenState').textContent=e.message;});};
  elevenRefresh().then(s=>{paint(s);loadVoices(s);});
  $e('elevenVoice').onchange=e=>{if(e.target.value)$e('elevenVoiceId').value=e.target.value;};
  const save=async extra=>{const sel=$e('elevenVoice'),id=$e('elevenVoiceId').value.trim(),name=sel.value===id?sel.selectedOptions[0]?.textContent.split(' · ')[0]:'';
    const s=await api('/tts','PUT',{apiKey:$e('elevenKey').value,voiceId:id,voiceName:name||'',stability:Number($e('elevenStability').value),style:Number($e('elevenStyle').value),enabled:$e('elevenOn').checked,...extra});
    $e('elevenKey').value='';Eleven.status=s;Eleven.on=!!s.enabled;Eleven.warned=false;paint(s);loadVoices(s);return s;};
  $e('elevenForm').onsubmit=e=>{e.preventDefault();save().then(s=>toast(s.enabled?'LUTHUR is using ElevenLabs':'ElevenLabs settings saved')).catch(e=>toast(e.message));};
  $e('elevenClear').onclick=()=>save({clearKey:true}).then(()=>toast('ElevenLabs key removed')).catch(e=>toast(e.message));
  $e('elevenPreview').onclick=()=>save().then(s=>{if(!s.enabled)return toast('Turn on “Use ElevenLabs” to preview.');const u=new SpeechSynthesisUtterance("I'm Luthor. I can help you review your plans, investigate issues, and keep your work moving. What shall we work on?");configureVoice(u);u.volume=Number(localStorage.getItem('hq-voice-volume')??1);speechSynthesis.cancel();if(typeof ForceStop==='undefined'||!ForceStop.stopped)speechSynthesis.speak(u);}).catch(e=>toast(e.message));
};
