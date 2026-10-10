"use strict";
// "Heard you" at once (owner, 2026-10-09: the visual lagged behind "Hey LUTHUR"). The server pushes each PC detector
// wake-up over /api/pc-voice/stream; the War Room lights up straight away and the hand-off runs now instead of on the
// next 1 s poll. The browser listener's own visual (live.js, wake-heard) still runs when it catches the name itself.
(function(){
  let es=null,retry=0;
  const show=()=>{VoiceVisual.wokeUntil=Date.now()+3000;document.body.classList.add('wake-heard');try{coreState();corePing();}catch{}try{voiceVisualPaint();}catch{}
    setTimeout(()=>{if(!Wake.armed&&!UPG.conversation)document.body.classList.remove('wake-heard');try{voiceVisualPaint();}catch{}},3100);};
  const poll=()=>{if(pcVoicePolling)return setTimeout(poll,120);pcVoicePoll();};
  function open(){
    if(es||typeof EventSource==='undefined'||window.hqOverlay||(typeof Access!=='undefined'&&Access.locked))return;
    es=new EventSource('/api/pc-voice/stream');
    es.onopen=()=>{retry=0;};
    es.onmessage=m=>{let e;try{e=JSON.parse(m.data);}catch{return;}
      if(e.target!=='main')return;
      if(e.kind==='wake'&&!(typeof speechPlaybackBlocked==='function'&&speechPlaybackBlocked()))show();
      poll();};
    es.onerror=()=>{es.close();es=null;setTimeout(open,Math.min(30000,1000*2**retry++));};
  }
  setInterval(open,5000);open();
})();
