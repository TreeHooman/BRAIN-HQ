"use strict";
// Settings → Voice → Wake word: dedicated local "Hey LUTHUR" detector (sherpa-onnx; src/lib/wake-engine.ts,
// scripts/pc-wake-kws.exe). No account or key: the owner types the phrase.
async function wakeEngineRestart(){try{const s=await api('/pc-voice');if(s.running){await api('/pc-voice','PUT',{enabled:false});await api('/pc-voice','PUT',{enabled:true});}}catch{}}
function wakeEnginePaint(box,st){
  const line=box.querySelector('[data-we-state]');
  line.textContent=st.active?'On · listening for your wake phrase on this PC':!st.lib?'Engine files missing (scripts/sherpa)':!st.enabled?'Off · the Windows listener is used':st.fallback?'Off · it failed to start, so the Windows listener is used':'Off';
  line.dataset.on=st.active?'1':'0';
  const input=box.querySelector('#wePhrase');if(document.activeElement!==input)input.value=st.phrase||'';
  box.querySelector('[data-we-err]').textContent=st.error||'';
  box.querySelector('#weEnabled').checked=st.enabled;box.querySelector('#weSens').value=String(st.sensitivity);box.querySelector('[data-we-sensv]').textContent=Math.round(st.sensitivity*100)+'%';
}
const wakeEngineSettings=vSettings;
vSettings=function(el){
  const r=wakeEngineSettings(el);const after=document.getElementById('voiceSettings')?.closest('section');if(!after||document.getElementById('wakeEngine'))return r;
  const box=document.createElement('section');box.className='card no-fold';box.id='wakeEngine';
  box.innerHTML=`<h2>Wake word</h2>
    <p class="small muted">A dedicated wake-word detector that runs on this PC (no account, nothing leaves the PC), even when LUTHUR is minimized. It replaces the Windows listener. Spell the phrase the way it sounds; add a second spelling after a comma.</p>
    <p class="we-state" data-we-state>Checking…</p>
    <div class="form">
      <label class="f">Wake phrase<input id="wePhrase" autocomplete="off" placeholder="hey luther, hey luthor"></label>
      <div class="row"><button type="button" class="btn sm" id="wePhraseSave">Save phrase</button></div>
      <label class="f">Sensitivity <span class="small muted" data-we-sensv></span><input id="weSens" type="range" min="0" max="1" step="0.05"><span class="small muted">Higher hears you more easily but wakes by mistake more often.</span></label>
      <label><input id="weEnabled" type="checkbox"> Use the dedicated wake word</label>
      <div class="row"><button type="button" class="btn sm primary" id="weCheck">Test</button><span class="small muted">Windows says your phrase into the detector, without the mic.</span></div>
      <p class="small" data-we-msg></p>
      <p class="small" data-we-err style="color:var(--red)"></p>
    </div>`;
  after.after(box);
  const run=async(fn,ok)=>{try{const st=await fn();wakeEnginePaint(box,st);if(ok)toast(ok);await wakeEngineRestart();}catch(e){toast(e.message);}};
  api('/wake-engine').then(st=>wakeEnginePaint(box,st)).catch(e=>{box.querySelector('[data-we-state]').textContent=e.message;});
  box.querySelector('#wePhraseSave').onclick=()=>run(()=>api('/wake-engine','PUT',{phrase:box.querySelector('#wePhrase').value}),'Wake phrase saved');
  box.querySelector('#weSens').oninput=e=>{box.querySelector('[data-we-sensv]').textContent=Math.round(e.target.value*100)+'%';};
  box.querySelector('#weSens').onchange=e=>run(()=>api('/wake-engine','PUT',{sensitivity:Number(e.target.value)}),'Sensitivity saved');
  box.querySelector('#weEnabled').onchange=e=>run(()=>api('/wake-engine','PUT',{enabled:e.target.checked}),e.target.checked?'Dedicated wake word on':'Windows listener on');
  box.querySelector('#weCheck').onclick=async()=>{const msg=box.querySelector('[data-we-msg]');msg.textContent='Testing…';try{const r=await api('/wake-engine/check','POST');wakeEnginePaint(box,r.status);msg.textContent=r.message||'';toast(r.ok?'Wake word works':'Wake word test failed');if(r.ok)await wakeEngineRestart();}catch(e){msg.textContent='';toast(e.message);}};
  return r;
};
