"use strict";
// Who listens for "Hey LUTHUR" (owner, 2026-10-09: with the PC detector alone, "Hey Luther, what time is it" in the War
// Room lost the words after the name and took ~1.5 s to hand over).
// - LUTHUR's window in use: the browser listener runs too. It hears the whole sentence, so it handles the wake itself;
//   a detector wake-up for the same moment is dropped unless the browser missed the name.
// - Minimized or behind other apps: only the PC detector (scripts/pc-wake-kws.exe), which opens the side panel.
function wakeMainInUse(){return !window.hqOverlay&&document.visibilityState==='visible'&&document.hasFocus()&&!(typeof Access!=='undefined'&&Access.locked)&&!(typeof ForceStop!=='undefined'&&ForceStop.stopped);}
setInterval(()=>{
  if(!pcVoiceWasOn||window.hqDesktopVoiceOwner||UPG.conversation||WAKE_PHONE)return;
  // Ending a conversation switches the browser listener off (upgrade.js upConversation), so turn it back on here.
  if(wakeMainInUse()){if(!Wake.rec&&!speechPlaybackBlocked()&&!SpeechUI.editing){Wake.on=true;Wake.paused=false;Wake.start();}}
  else if(!Wake.paused)Wake.pause();
},400);
/** Called by voice.js before acting on a detector wake-up: true when the browser listener already has this turn. */
async function wakeBrowserHas(){
  if(!wakeMainInUse()||Wake.paused||!Wake.rec)return false;
  const had=()=>UPG.conversation||Cmd.waiting||!!Wake.armed||Date.now()-(typeof WakeIdle!=='undefined'?WakeIdle.named:0)<5000;
  if(had())return true;
  await new Promise(resolve=>setTimeout(resolve,1200)); // the browser's words arrive a moment after the detector's
  return had();
}
