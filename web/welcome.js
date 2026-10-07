"use strict";
const Welcome={pending:false,attempting:false,greeted:false};
function welcomeLine(){
  const lines=["Welcome back. Ready when you are.","Good to have you back. What shall we work on?","Welcome back. Where would you like to start?","I'm here. What do you need today?","Welcome back. Let's pick up where we left off.","Hello again. How can I help?"];
  const last=localStorage.getItem('hq-welcome-last'),choices=lines.filter(line=>line!==last),line=choices[Math.floor(Math.random()*choices.length)];
  localStorage.setItem('hq-welcome-last',line);return line;
}
async function welcomePlay(preview=false){
  if(Welcome.attempting||document.hidden||window.speechSynthesis?.speaking)return;
  if(localStorage.getItem('hq-mute')==='1'){Welcome.pending=false;return;}
  const chime=localStorage.getItem('hq-startup-chime')!=='0',greeting=localStorage.getItem('hq-startup-greeting')!=='0';
  if(!chime&&!greeting){Welcome.pending=false;return;}
  Welcome.attempting=true;
  try{
    const volume=Math.max(0,Math.min(1,Number(localStorage.getItem('hq-voice-volume')??1)));
    if(chime){
      const ac=Snd.ac();
      if(ac.state==='suspended'){
        if(!navigator.userActivation?.isActive){Welcome.pending=true;return;}
        await ac.resume();
      }
      if(ac.state!=='running'){Welcome.pending=true;return;}
      [523.25,659.25,783.99].forEach((frequency,i)=>{
        const oscillator=ac.createOscillator(),gain=ac.createGain(),at=ac.currentTime+i*.13;
        oscillator.type='sine';oscillator.frequency.value=frequency;
        gain.gain.setValueAtTime(.0001,at);gain.gain.exponentialRampToValueAtTime(Math.max(.0001,.035*volume),at+.018);gain.gain.exponentialRampToValueAtTime(.0001,at+.32);
        oscillator.connect(gain).connect(ac.destination);oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};oscillator.start(at);oscillator.stop(at+.34);
      });
    }
    Welcome.pending=false;
    if(greeting&&window.speechSynthesis){
      const u=new SpeechSynthesisUtterance(welcomeLine());configureVoice(u);u.volume=volume;
      u.onerror=e=>{if(!preview&&(e.error==='not-allowed'||e.error==='audio-busy'))Welcome.pending=true;};
      // Queue after the chime without cancelling a real assistant response.
      setTimeout(()=>{if(!speechSynthesis.speaking&&!document.hidden){if(typeof speechPlaybackStart==='function')speechPlaybackStart(u);if(typeof ForceStop==='undefined'||!ForceStop.stopped)speechSynthesis.speak(u);}},chime?550:0);
    }
    Welcome.greeted=true;
  }catch{if(!preview)Welcome.pending=true;}finally{Welcome.attempting=false;}
}
const welcomeBoot=hudBoot;
hudBoot=function(short){return welcomeBoot(short).then(()=>{if(!Welcome.greeted&&sessionStorage.getItem('hq-welcomed')!=='1'){sessionStorage.setItem('hq-welcomed','1');Welcome.pending=true;welcomePlay();}});};
for(const event of ['pointerdown','keydown'])document.addEventListener(event,()=>{if(Welcome.pending&&!window.hqBooting)welcomePlay();},{passive:true});
window.addEventListener('DOMContentLoaded',()=>{if(!isHud()||reduced()){if(sessionStorage.getItem('hq-welcomed')!=='1'){sessionStorage.setItem('hq-welcomed','1');Welcome.pending=true;welcomePlay();}}});
const welcomeSettings=vSettings;
vSettings=function(el){
  welcomeSettings(el);const form=document.getElementById('voiceSettings');if(!form)return;
  form.insertAdjacentHTML('beforeend',`<label><input id="startupChime" type="checkbox" ${localStorage.getItem('hq-startup-chime')!=='0'?'checked':''}> Gentle startup chime</label><label><input id="startupGreeting" type="checkbox" ${localStorage.getItem('hq-startup-greeting')!=='0'?'checked':''}> Spoken welcome when opening LUTHUR</label><div><button type="button" id="welcomePreview" class="btn sm">Preview welcome</button></div><p class="small muted">Welcomes vary and use your chosen voice and volume. If the browser blocks automatic audio, the welcome plays on your first click.</p>`);
  document.getElementById('startupChime').onchange=e=>localStorage.setItem('hq-startup-chime',e.target.checked?'1':'0');
  document.getElementById('startupGreeting').onchange=e=>localStorage.setItem('hq-startup-greeting',e.target.checked?'1':'0');
  document.getElementById('welcomePreview').onclick=()=>welcomePlay(true);
};
