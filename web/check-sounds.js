"use strict";
const CheckSound={last:0,seen:new Map(),ready:false};
function checkTone(kind='scan'){
  if(localStorage.getItem('hq-check-sounds')==='0'||localStorage.getItem('hq-mute')==='1'||document.hidden||window.speechSynthesis?.speaking)return;
  if(Date.now()-CheckSound.last<450)return;
  try{
    const ac=Snd.ac();if(ac.state!=='running')return;
    CheckSound.last=Date.now();const volume=Math.max(0,Math.min(1,Number(localStorage.getItem('hq-voice-volume')??1)));
    const notes=kind==='done'?[660,880]:kind==='failed'?[330,260]:[900];
    notes.forEach((f,i)=>{const o=ac.createOscillator(),g=ac.createGain(),at=ac.currentTime+i*.09;o.type='sine';o.frequency.value=f;g.gain.setValueAtTime(.0001,at);g.gain.exponentialRampToValueAtTime(Math.max(.0001,.014*volume),at+.012);g.gain.exponentialRampToValueAtTime(.0001,at+.10);o.connect(g).connect(ac.destination);o.onended=()=>{o.disconnect();g.disconnect();};o.start(at);o.stop(at+.12);});
  }catch{}
}
const checkBoot=hudBoot;
hudBoot=function(short){checkTone();const timer=setInterval(()=>checkTone(),1000);return checkBoot(short).finally(()=>clearInterval(timer));};
const checkOps=opsRender;
opsRender=function(data){
  let tone=null;
  for(const op of data?.ops||[]){const signature=[op.status,op.steps?.length||0,op.steps?.at(-1)?.result||''].join(':');const previous=CheckSound.seen.get(op.id);
    if(CheckSound.ready&&previous!==signature&&(previous||op.status==='running'))tone=op.status==='done'?'done':op.status==='failed'?'failed':op.status==='running'?'scan':tone;
    CheckSound.seen.set(op.id,signature);
  }
  CheckSound.ready=true;while(CheckSound.seen.size>200)CheckSound.seen.delete(CheckSound.seen.keys().next().value);
  const result=checkOps(data);if(tone)checkTone(tone);return result;
};
const checkSettings=vSettings;
vSettings=function(el){checkSettings(el);const form=document.getElementById('voiceSettings');if(!form)return;form.insertAdjacentHTML('beforeend',`<label><input id="checkSounds" type="checkbox" ${localStorage.getItem('hq-check-sounds')!=='0'?'checked':''}> Subtle scan and work-check sounds</label>`);document.getElementById('checkSounds').onchange=e=>localStorage.setItem('hq-check-sounds',e.target.checked?'1':'0');};
