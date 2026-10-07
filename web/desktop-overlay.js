"use strict";
const Hologram={visible:true,dismissing:false};
async function hologramOpen(){try{await api('/desktop-overlay','POST',{action:'open'});}catch(e){toast(e.message);}}
const hologramSettings=vSettings;
vSettings=function(el){hologramSettings(el);const card=document.createElement('section');card.className='card no-fold';card.innerHTML='<h2>Desktop hologram</h2><p class="small muted">With PC wake listening enabled, say “Hey LUTHUR” while using another app. A small translucent window stays above your work and shows listening, speaking and published activity. Drag its title bar to move it. Your saved voice and model choices apply.</p><button class="btn" type="button">Open hologram</button>';card.querySelector('button').onclick=hologramOpen;el.querySelector('h1')?.after(card);};
// A single voice surface owns microphone and playback while the hologram is open.
const hologramSpeak=speak,hologramSpeakAlways=speakAlways;
speak=function(...args){if(!window.hqOverlay&&window.hqDesktopVoiceOwner)return;return hologramSpeak(...args);};
speakAlways=function(...args){if(!window.hqOverlay&&window.hqDesktopVoiceOwner)return;return hologramSpeakAlways(...args);};
if(window.hqOverlay){
  document.documentElement.dataset.theme='hud';
  toast=function(message){if(/^(Conversation (on|ended)|Hands-free on)/i.test(String(message)))return;const surface=document.querySelector('.holo-surface');if(!surface)return;let note=surface.querySelector('.holo-notice');if(!note){note=document.createElement('p');note.className='holo-notice';note.setAttribute('role','status');surface.querySelector('.holo-work').after(note);}note.textContent=String(message);clearTimeout(toast.holoTimer);toast.holoTimer=setTimeout(()=>note.remove(),6500);};
  hudNotify=function(message){toast(message);};
  parseHash=function(){route={view:'command',arg:null};};
  welcomePlay=function(){return Promise.resolve();};
  hudStartupBoot=function(){return Promise.resolve();};
  const hologramCommand=vCommand;
  vCommand=async function(el){
    if(el.querySelector('.holo-surface'))return;
    await hologramCommand(el);
    const stage=el.querySelector('#nvStage'),core=el.querySelector('#core'),form=el.querySelector('#cmdAsk'),feedback=el.querySelector('#speechFeedback'),reply=el.querySelector('#cmdReply');
    if(!stage||!core)return;
    stage.replaceChildren(core);const surface=document.createElement('section');surface.className='holo-surface';surface.innerHTML='<header class="holo-header"><b>◈ LUTHUR</b><button type="button" class="btn sm" data-holo-main>Full app</button><button type="button" class="btn sm" data-holo-dismiss aria-label="Dismiss hologram">×</button></header><section class="holo-work" role="status" aria-label="Current activity"></section>';
    surface.querySelector('header').after(stage);if(feedback)surface.append(feedback);if(form)surface.append(form);if(reply)surface.append(reply);el.replaceChildren(surface);coreSize();voiceVisualPaint();
    surface.querySelector('[data-holo-dismiss]').onclick=()=>hologramDismiss();surface.querySelector('[data-holo-main]').onclick=async()=>{await hologramDismiss('main');};
    form.querySelector('input').placeholder='Talk, or type your request…';hologramPaint();
  };
  const hologramReply=cmdShowReply;
  cmdShowReply=function(c,animate){hologramReply(c,animate);const box=document.getElementById('cmdReply');if(!box)return;const last=[...(c?.messages||[])].reverse().find(m=>m.role==='hq');box.innerHTML=c?.busy||Cmd.waiting?`<div class="who">LUTHUR · WORKING</div><div>${esc(String(c?.partial||'').replace(/<spoken>[\s\S]*?<\/spoken>/g,'').slice(-800))}</div>`:last?`<div class="who">LUTHUR · ${esc(c.provider||'')}</div><div class="cmd-md">${md(last.text)}</div>`:'<p class="muted">Ready when you call.</p>';};
  function hologramPaint(){
    if(Access.locked)return;const panel=document.querySelector('.holo-work');if(!panel)return;const list=Ops.data||[],active=list.filter(o=>o.status==='running'),op=active.at(-1)||list.at(-1),step=op?.steps?.at(-1);
    const html=op?`<small>${active.length?'LIVE ACTIVITY':'LAST ACTIVITY'} · ${esc(op.model||'')}</small><b>${esc(op.title||'Current request')}</b><span>${esc(step?.result||step?.target||step?.verb||step?.text||op.status||'Waiting for published updates')}</span>`:'<small>ACTIVITY</small><span>No active work. Your next request will appear here.</span>';
    if(panel.innerHTML!==html)panel.innerHTML=html;
  }
  async function hologramDismiss(action='hide'){
    if(Hologram.dismissing)return;Hologram.dismissing=true;
    try{const rearm=pcVoiceReturn||pcVoiceWasOn;window.speechSynthesis?.cancel();StopMonitor.stop();upConversation(false);Wake.pause();if(rearm&&!ForceStop.stopped)await api('/pc-voice','PUT',{enabled:true});await api('/desktop-overlay','POST',{action});Hologram.visible=false;}catch(e){toast(e.message);}finally{Hologram.dismissing=false;}
  }
  const hologramPoll=pcVoicePoll;
  pcVoicePoll=async function(){if(Access.locked)return;const state=await api('/pc-voice').catch(()=>null);if(state?.event?.target==='overlay')Hologram.visible=true;if(!Hologram.visible)return;return hologramPoll();};
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!document.querySelector('.up-window'))void hologramDismiss();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)Hologram.visible=true;});
  window.addEventListener('pagehide',()=>{window.speechSynthesis?.cancel();Wake.pause();const post=(url,body)=>fetch('/api'+url,{method:'POST',headers:{'Content-Type':'application/json','X-HQ':'1'},body:JSON.stringify(body),keepalive:true}).catch(()=>{});post('/desktop-overlay',{action:'release'});if(pcVoiceReturn&&!ForceStop.stopped)fetch('/api/pc-voice',{method:'PUT',headers:{'Content-Type':'application/json','X-HQ':'1'},body:JSON.stringify({enabled:true}),keepalive:true}).catch(()=>{});});
  setInterval(()=>{hologramPaint();if(Hologram.visible&&!Access.locked)api('/desktop-overlay','POST',{action:'heartbeat'}).catch(()=>{});},3000);
}
