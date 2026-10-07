"use strict";
const Access={locked:true,checking:false,ready:false,submitting:false};
const accessPanel=document.createElement('section');accessPanel.id='accessLock';accessPanel.setAttribute('role','dialog');accessPanel.setAttribute('aria-modal','true');accessPanel.setAttribute('aria-label','Unlock LUTHUR');
accessPanel.innerHTML='<form class="access-card" autocomplete="off"><img src="eye.svg" alt=""><h1>LUTHUR</h1><p>Enter your four-digit PIN to continue.</p><input id="accessPin" type="text" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="off" data-lpignore="true" data-1p-ignore spellcheck="false" style="-webkit-text-security:disc;text-security:disc" aria-label="PIN" required disabled><button class="btn primary" disabled>Unlock</button><p id="accessMessage" role="status">Checking protection…</p><p id="accessRestartHelp" hidden>Run RESTART-LUTHUR.cmd in your LUTHUR scripts folder once. Then enter your PIN here.</p></form>';
document.body.append(accessPanel);
function accessShow(locked){
  Access.locked=locked;document.documentElement.classList.toggle('access-locked',locked);accessPanel.hidden=!locked;
  for(const child of document.body.children)if(child!==accessPanel&&child.tagName!=='SCRIPT')child.inert=locked;
  if(locked){window.speechSynthesis?.cancel();if(typeof Wake!=='undefined')Wake.pause();document.getElementById('accessPin').focus();}
  else if(typeof Wake!=='undefined')Wake.resume();
}
accessShow(true);
async function accessEnter(){
  await refresh();render.background=false;await render();
  await hudStartupBoot();
  if(!Access.locked&&!Welcome.greeted&&sessionStorage.getItem('hq-welcomed')!=='1'){
    sessionStorage.setItem('hq-welcomed','1');Welcome.pending=true;welcomePlay();
  }
}

async function accessFetch(path,body){const r=await fetch('/api/access'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-HQ':'1'},body:body?JSON.stringify(body):undefined,cache:'no-store'});const data=await r.json();if(!r.ok){const error=new Error(data.error||'Unlock failed');error.status=r.status;throw error;}return data;}
function accessReady(ready){Access.ready=ready;const input=document.getElementById('accessPin'),button=accessPanel.querySelector('button');input.disabled=!ready||Access.submitting;button.disabled=!ready||Access.submitting;document.getElementById('accessRestartHelp').hidden=ready;}
function accessUnavailable(error){accessReady(false);document.getElementById('accessMessage').textContent=error?.status===404?'LUTHUR needs one server restart to finish installing PIN protection.':'Waiting for LUTHUR to reconnect. PIN entry will become available automatically.';}
async function accessSubmit(){
  if(!Access.ready||Access.submitting)return;
  const input=document.getElementById('accessPin'),button=accessPanel.querySelector('button');if(!/^\d{4}$/.test(input.value))return;
  Access.submitting=true;input.disabled=true;button.disabled=true;document.getElementById('accessMessage').textContent='Signing in…';
  try{await accessFetch('/unlock',{pin:input.value});input.value='';Access.ready=true;accessShow(false);await accessEnter();}
  catch(error){input.value='';if(error.status===404||!error.status)accessUnavailable(error);else document.getElementById('accessMessage').textContent=error.message;}
  finally{Access.submitting=false;accessReady(Access.ready);if(Access.locked&&Access.ready)input.focus();}
}
accessPanel.querySelector('form').onsubmit=e=>{e.preventDefault();accessSubmit();};
document.getElementById('accessPin').oninput=e=>{e.target.value=e.target.value.replace(/\D/g,'').slice(0,4);if(e.target.value.length===4)accessSubmit();};
async function accessCheck(){
  if(Access.checking||Access.submitting)return;Access.checking=true;
  try{const state=await accessFetch('');if(typeof state.locked!=='boolean')throw new Error('Protection is not ready');const becameReady=!Access.ready;accessReady(true);if(state.locked!==Access.locked){accessShow(state.locked);if(!state.locked){await accessEnter();}}if(becameReady){document.getElementById('accessMessage').textContent=state.setup?'First run: choose a four-digit PIN.':'Your PIN signs you in automatically.';if(Access.locked)document.getElementById('accessPin').focus();}}
  catch(error){accessShow(true);
accessUnavailable(error);}
  finally{Access.checking=false;}
}
if(!window.hqOverlay&&sessionStorage.getItem('hq-access-open')!=='1'){sessionStorage.setItem('hq-access-open','1');accessFetch('/lock',{open:true}).catch(()=>{}).finally(accessCheck);}else accessCheck();
setInterval(accessCheck,5000);
const accessApi=api;
api=async function(path,method,body){if(Access.locked&&!path.startsWith('/access'))throw new Error('Unlock LUTHUR first.');try{return await accessApi(path,method,body);}catch(error){if(/Unlock LUTHUR/.test(error.message))accessShow(true);
throw error;}};
const accessVoice=voiceCommand;voiceCommand=function(text){if(Access.locked)return;return accessVoice(text);};
const accessWelcome=welcomePlay;welcomePlay=function(preview=false){if(Access.locked){Welcome.pending=true;return Promise.resolve();}return accessWelcome(preview);};
const accessSettings=vSettings;
vSettings=function(el){accessSettings(el);const section=document.createElement('section');section.className='card no-fold';section.innerHTML='<h2>Protection</h2><p class="small muted">PIN protects dashboard data and commands. Locking also stops PC wake listening. Existing background work continues.</p><button class="btn" id="accessLockNow">Lock LUTHUR</button>';el.querySelector('h1')?.after(section);document.getElementById('accessLockNow').onclick=async()=>{try{await accessFetch('/lock',{});accessShow(true);
}catch(e){toast(e.message);}};};
document.addEventListener('keydown',e=>{if(e.ctrlKey&&e.altKey&&e.key.toLowerCase()==='l'){e.preventDefault();accessFetch('/lock',{}).then(()=>accessShow(true)).catch(()=>accessShow(true));}});

