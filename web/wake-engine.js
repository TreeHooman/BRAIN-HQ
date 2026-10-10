"use strict";
// Settings → Voice → Wake word: Picovoice Porcupine "Hey LUTHUR" (src/lib/wake-engine.ts, scripts/pc-wake-pv.exe).
// The AccessKey is write-only here: the page never gets it back, only whether one is saved.
async function wakeEngineRestart(){try{const s=await api('/pc-voice');if(s.running){await api('/pc-voice','PUT',{enabled:false});await api('/pc-voice','PUT',{enabled:true});}}catch{}}
function wakeEnginePaint(box,st){
  const line=box.querySelector('[data-we-state]');
  const state=st.active?'On · Picovoice listens for your wake word, on this PC':!st.lib?'Picovoice files missing (scripts/pv)':!st.configured?'Off · add your AccessKey':!st.keyword?'Off · add your .ppn wake word file':!st.enabled?'Off · switched off below':st.fallback?'Off · it failed to start, so the Windows listener is used':'Off';
  line.textContent=state;line.dataset.on=st.active?'1':'0';
  box.querySelector('[data-we-key]').textContent=st.configured?'AccessKey saved ✓':'No AccessKey yet';
  box.querySelector('[data-we-kw]').textContent=st.keyword?`Wake word file: ${st.keywordName||'saved'} ✓`:'No wake word file yet';
  box.querySelector('[data-we-err]').textContent=st.error||'';
  box.querySelector('#weEnabled').checked=st.enabled;box.querySelector('#weSens').value=String(st.sensitivity);box.querySelector('[data-we-sensv]').textContent=Math.round(st.sensitivity*100)+'%';
}
const wakeEngineSettings=vSettings;
vSettings=function(el){
  const r=wakeEngineSettings(el);const after=document.getElementById('voiceSettings')?.closest('section');if(!after||document.getElementById('wakeEngine'))return r;
  const box=document.createElement('section');box.className='card no-fold';box.id='wakeEngine';
  box.innerHTML=`<h2>Wake word · Picovoice</h2>
    <p class="small muted">A dedicated “Hey LUTHUR” detector that runs on this PC, even when LUTHUR is minimized. It replaces the Windows listener once set up. Setup: sign in at <b>console.picovoice.ai</b>, copy your AccessKey, then under Porcupine type your phrase (e.g. “Hey Luther”), choose <b>Windows</b>, download and unzip, and pick the .ppn file below.</p>
    <p class="we-state" data-we-state>Checking…</p>
    <div class="form">
      <label class="f">AccessKey <span class="small muted" data-we-key></span><input id="weKey" type="password" autocomplete="off" placeholder="Paste a new AccessKey to save or replace it"></label>
      <div class="row"><button type="button" class="btn sm" id="weKeySave">Save key</button><button type="button" class="btn sm ghost" id="weKeyClear">Remove key</button></div>
      <label class="f">Wake word file (.ppn, Windows) <span class="small muted" data-we-kw></span><input id="weFile" type="file" accept=".ppn"></label>
      <label class="f">Sensitivity <span class="small muted" data-we-sensv></span><input id="weSens" type="range" min="0.3" max="0.9" step="0.05"><span class="small muted">Higher hears you more easily but wakes by mistake more often.</span></label>
      <label><input id="weEnabled" type="checkbox"> Use Picovoice for the wake word</label>
      <div class="row"><button type="button" class="btn sm primary" id="weCheck">Test setup</button></div>
      <p class="small" data-we-err style="color:var(--red)"></p>
    </div>`;
  after.after(box);
  const run=async(fn,ok)=>{try{const st=await fn();wakeEnginePaint(box,st.status||st);if(st.ok===false)return;if(ok)toast(ok);await wakeEngineRestart();}catch(e){toast(e.message);}};
  api('/wake-engine').then(st=>wakeEnginePaint(box,st)).catch(e=>{box.querySelector('[data-we-state]').textContent=e.message;});
  box.querySelector('#weKeySave').onclick=()=>{const v=box.querySelector('#weKey').value.trim();if(!v)return toast('Paste the AccessKey first.');box.querySelector('#weKey').value='';run(()=>api('/wake-engine','PUT',{accessKey:v}),'AccessKey saved');};
  box.querySelector('#weKeyClear').onclick=async()=>{if(await uiConfirm('Remove the Picovoice AccessKey? The Windows listener takes over.'))run(()=>api('/wake-engine','PUT',{clearKey:true}),'AccessKey removed');};
  box.querySelector('#weFile').onchange=e=>{const f=e.target.files?.[0];if(!f)return;const rd=new FileReader();rd.onload=()=>{const data=String(rd.result).split(',')[1]||'';run(()=>api('/wake-engine/keyword','POST',{name:f.name,data}),'Wake word file saved');e.target.value='';};rd.readAsDataURL(f);};
  box.querySelector('#weSens').oninput=e=>{box.querySelector('[data-we-sensv]').textContent=Math.round(e.target.value*100)+'%';};
  box.querySelector('#weSens').onchange=e=>run(()=>api('/wake-engine','PUT',{sensitivity:Number(e.target.value)}),'Sensitivity saved');
  box.querySelector('#weEnabled').onchange=e=>run(()=>api('/wake-engine','PUT',{enabled:e.target.checked}),e.target.checked?'Picovoice on':'Picovoice off · Windows listener');
  box.querySelector('#weCheck').onclick=async()=>{box.querySelector('[data-we-state]').textContent='Testing…';try{const r=await api('/wake-engine/check','POST');wakeEnginePaint(box,r.status);toast(r.ok?'Picovoice works · say your wake word':'Picovoice failed · see the message');if(r.ok)await wakeEngineRestart();}catch(e){toast(e.message);api('/wake-engine').then(st=>wakeEnginePaint(box,st)).catch(()=>{});}};
  return r;
};
