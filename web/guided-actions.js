"use strict";
function guideText(text){return String(text||'').trim().replace(/^(?:hey\s+)?(?:luthur|luthor|luther)[,!.]?\s+/i,'').replace(/^(?:can|could|would) you\s+/i,'').replace(/^please\s+/i,'').replace(/[.!?]+$/,'').trim();}
function guideBriefRequest(text){
 const c=guideText(text);
 return /^(?:brief(?: me)?|briefing|give me (?:a |the |my )?(?:(?:daily|today'?s) )?(?:briefing|overview|rundown)|catch me up|(?:walk|run) me through|give me a brief)\b(?:\s+(?:on|about|of)\s+|\s+)?(.*)$/i.exec(c);
}
function guideProject(text){const norm=s=>String(s).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();const c=' '+norm(text)+' ';return S.projects.filter(p=>[p.name,p.slug].some(name=>c.includes(' '+norm(name)+' '))).sort((a,b)=>b.name.length-a.name.length)[0];}
function guidedOverview(){if(Scr.cur?.k==='search'&&/^me$/i.test(Scr.cur.q)){Scr.cur=null;Scr.quest=null;scrPaint();}Brief.start();}
function guideHighlight(element){if(!element)return;element.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'nearest'});element.classList.add('guided-target');clearTimeout(element.guideTimer);element.guideTimer=setTimeout(()=>element.classList.remove('guided-target'),5000);}
const guidedOpen=upOpen;
upOpen=async function(ref){const result=await guidedOpen(ref);guideHighlight(result?.el||document.getElementById('nvScreen'));return result;};
const guidedScreen=scrGo;
scrGo=async function(...args){const result=await guidedScreen(...args);guideHighlight(document.getElementById('nvScreen'));return result;};
const guidedBuild=Brief.build;
Brief.build=function(slug){
 const steps=guidedBuild.call(this,slug);if(slug)return steps;
 const expanded=[];
 for(const step of steps){
  if(step.view==='missions')step.view='assistant/missions';
  if(step.title==='Next moves'){
   const projects=S.projects.filter(p=>p.stage!=='done'&&p.nextStep).sort((a,b)=>({risk:0,watch:1}[a.health]??2)-({risk:0,watch:1}[b.health]??2)).slice(0,3);
   for(const p of projects)expanded.push({view:'project/'+p.slug,sel:'#view h1',title:p.name+' · next move',say:p.nextStep});
  }else expanded.push(step);
 }
 expanded.splice(1,0,{view:'today',sel:'#view h1',title:'Daily',say:'Your daily workspace brings together routines and tasks. Check off completed items here; changes are shared across LUTHUR.'});
 return expanded;
};
const guidedShow=Brief.show;
Brief.show=async function(){
 if(Access.locked||ForceStop.stopped){this.end();return;}
 const step=this.steps[this.i];if(!step||!this.on)return;
 const [view,arg]=step.view.split('/');
 if(route.view!==view||(arg&&route.arg!==arg)){
  location.hash=step.view;
  const deadline=Date.now()+8000;
  while(Date.now()<deadline&&this.on&&this.steps[this.i]===step){
   if(route.view===view&&(!arg||route.arg===arg)&&document.getElementById('view')?.dataset.view===view&&(!step.sel||document.querySelector(step.sel)))break;
   await new Promise(resolve=>setTimeout(resolve,100));
  }
 }
 if(this.on&&this.steps[this.i]===step&&!Access.locked&&!ForceStop.stopped)return guidedShow.call(this);
};
setInterval(()=>{if(Brief.on&&(Access.locked||ForceStop.stopped))Brief.end();},300);
function guidedLocal(text){
 if(Access.locked||ForceStop.stopped)return false;
 const c=guideText(text);
 if(Brief.on&&/^(?:next|back|previous|repeat|again|pause|resume|continue|stop (?:the )?briefing|close (?:the )?briefing)$/i.test(c)){if(/^(stop|close)/i.test(c))Brief.end();else Brief.voice(c);return true;}
 const match=guideBriefRequest(c);if(!match)return false;
 const target=match[1].trim(),project=guideProject(target);
 if(project){Brief.start(project.slug);return true;}
 if(!target||/^(me|today|daily|my day|everything|all(?: projects)?|luthur|luthor|luther|the app|my priorities)$/i.test(target)){guidedOverview();return true;}
 // A briefing of a currently displayed document stays beside its source.
 if(/^(this|that|it|the screen)$/i.test(target)){
  if(route.view==='project'&&route.arg){Brief.start(route.arg);return true;}
  const material=scrMaterial();
  if(material?.project){Brief.start(material.project);return true;}
  if(material?.text){const build=Brief.build;Brief.build=()=>[{view:route.view+(route.arg?'/'+route.arg:''),sel:'#nvScreen',title:material.title||'On screen',say:String(material.text).replace(/[#*`]/g,'').slice(0,600),end:true}];try{Brief.start();}finally{Brief.build=build;}return true;}
  guidedOverview();return true;
 }
 if(!/https?:|\b[\w-]+\.[a-z]{2,}\b|\b(doc|document|file|sheet|email|mail|page)\b/i.test(target)){guidedOverview();return true;}
 return false;
}
const guidedSend=cmdSend;
cmdSend=function(text){text=text??document.getElementById('cmdText')?.value??'';
 if(guidedLocal(text)){const input=document.getElementById('cmdText');if(input)input.value='';return;}
 const project=guideProject(text),active=UPG.active?.kind==='process'?UPG.workTarget:UPG.active,target=project?{kind:'project',slug:project.slug}:active|| (route.view==='project'?{kind:'project',slug:route.arg}:null);
 if(target&&/\b(edit|update|change|fix|check|review|inspect|build|add|remove|complete)\b/i.test(text)&&!Cmd.waiting&&!chatState?.busy&&!Access.locked&&!ForceStop.stopped){return upOpen(target).then(()=>guidedSend(text));}
 return guidedSend(text);
};
const guidedVoice=voiceCommand;
voiceCommand=function(text){if(guidedLocal(text))return;return guidedVoice(text);};
