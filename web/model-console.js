"use strict";
const ModelConsole={ready:false,checking:null,catalog:{codex:[['auto','Auto · Luna / Sol 6.1'],['gpt-6-luna','Luna 6'],['gpt-6.1-sol','Sol 6.1'],['gpt-6-astra','Astra · adaptive']],claude:[['auto','Auto · Haiku / Sonnet'],['haiku','Haiku'],['sonnet','Latest Sonnet'],['opus','Opus · adaptive']]}};
const modelEngine=()=>hstore.get('hq-model-engine','codex')==='claude'?'claude':'codex';
function modelPicked(engine){const model=hstore.get('hq-model-'+engine,'auto');return ModelConsole.catalog[engine].some(([id])=>id===model)?model:'auto';}
function modelEffort(engine){const effort=hstore.get('hq-model-effort-'+engine,'low');return ['low','medium','high'].includes(effort)?effort:'low';}
currentTier=function(){const pick=modelPicked(modelEngine());return ['haiku','gpt-6-luna','gpt-5.6-luna'].includes(pick)?'fast':'balanced';};
currentEffort=function(){return modelEffort(modelEngine());};
function modelTop(){return `<div class="model-engine" role="group" aria-label="AI engine"><button type="button" data-engine="codex" aria-pressed="${modelEngine()==='codex'}">◈ ChatGPT / Codex</button><button type="button" data-engine="claude" aria-pressed="${modelEngine()==='claude'}">✦ Claude</button></div>`;}
let modelControlId=0;
function modelCard(engine){const id=`model-${engine}-${++modelControlId}`;return `<section class="model-card ${engine}" data-model-card="${engine}"><div class="model-heading"><b>${engine==='codex'?'CHATGPT':'CLAUDE'}</b><span>${engine===modelEngine()?'ACTIVE':'STANDBY'}</span></div><label for="${id}">Model</label><select id="${id}" data-model="${engine}" aria-label="${engine} model">${opts(ModelConsole.catalog[engine],modelPicked(engine))}</select><div class="model-effort" role="group" aria-label="${engine} thinking level">${[['low','Low'],['medium','Med'],['high','High']].map(([id,label])=>`<button type="button" data-model-effort="${engine}" data-value="${id}" aria-pressed="${modelEffort(engine)===id}">${label}</button>`).join('')}</div><small>${engine==='codex'?'Auto: Luna 6 for chat · Sol 6.1 for coding':'Auto: Haiku for chat · Sonnet for coding'}</small><div class="astra-note" data-permission-note="${engine}"></div></section>`;}
tierSwitch=function(){return `<div class="model-console compact">${modelTop()}<div class="model-pair">${modelCard('codex')}${modelCard('claude')}</div><p class="model-connection" data-model-connection></p></div>`;};
bindTierSwitch=function(root){modelBind(root);};
function modelPaint(){
  document.querySelectorAll('[data-engine]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.engine===modelEngine())));
  document.querySelectorAll('[data-model-card]').forEach(card=>{const engine=card.dataset.modelCard;card.dataset.active=String(engine===modelEngine());card.querySelector('.model-heading span').textContent=engine===modelEngine()?'ACTIVE':'STANDBY';});
  document.querySelectorAll('[data-model]').forEach(s=>{const selected=modelPicked(s.dataset.model);if(s.value!==selected)s.value=selected;});
  document.querySelectorAll('[data-model-effort]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.value===modelEffort(b.dataset.modelEffort))));
  document.querySelectorAll('[data-permission-note]').forEach(n=>{const e=n.dataset.permissionNote,name=e==='codex'?'Astra':'Opus';n.textContent=modelPicked(e)===(e==='codex'?'gpt-6-astra':'opus')?name+' available until you switch · lighter models for easy requests':'';});
}
function modelBind(root){
  root.querySelectorAll('[data-engine]').forEach(b=>b.onclick=()=>{hstore.set('hq-model-engine',b.dataset.engine);modelPaint();});
  root.querySelectorAll('[data-model]').forEach(s=>{s.onpointerdown=e=>e.stopPropagation();s.onclick=e=>e.stopPropagation();s.onchange=e=>{e.stopPropagation();hstore.set('hq-model-'+s.dataset.model,s.value);hstore.set('hq-model-engine',s.dataset.model);modelPaint();};});
  root.querySelectorAll('[data-model-effort]').forEach(b=>b.onclick=()=>{hstore.set('hq-model-effort-'+b.dataset.modelEffort,b.dataset.value);modelPaint();});modelPaint();
  modelCheck().catch(()=>{});
  if(typeof usageRingPoll==='function')usageRingPoll();
}
const modelApi=api;
function modelRequestChoice(text=''){const provider=modelEngine(),model=modelPicked(provider),choice={provider,model,effort:modelEffort(provider),astraApproved:model==='gpt-6-astra',opusApproved:model==='opus',adaptive:true,modelPolicy:true};const match=String(text||'').match(/^\s*(?:please\s+)?(?:(?:you (?:can|may)|i (?:allow|authorize) you to)\s+)?(?:use|switch to|run (?:this )?(?:with|on))\s+(astra|sol\s*6[.]1|luna(?:\s*6)?|sonnet|haiku|opus)\b/i);if(match){const name=match[1].toLowerCase().replace(/\s+/g,'');const provider=['sonnet','haiku','opus'].includes(name)?'claude':'codex',model=({astra:'gpt-6-astra','sol6.1':'gpt-6.1-sol',luna:'gpt-6-luna',luna6:'gpt-6-luna',sonnet:'sonnet',haiku:'haiku',opus:'opus'})[name];hstore.set('hq-model-engine',provider);hstore.set('hq-model-'+provider,model);modelPaint();return {...choice,provider,model,astraApproved:name==='astra',opusApproved:name==='opus',adaptive:false,effort:'low'};}return choice;}
const modelSendCommand=cmdSend;
cmdSend=function(text){const before=UPG.pending.length,choice=modelRequestChoice(text??document.getElementById('cmdText')?.value);const result=modelSendCommand(text);if(UPG.pending.length>before){UPG.pending.at(-1).modelChoice=choice;}return result;};
async function modelCheck(){if(ModelConsole.ready)return;if(!ModelConsole.checking)ModelConsole.checking=modelApi('/models').then(c=>{if(c.version!==3)throw new Error('Model controls need a local server restart.');ModelConsole.ready=true;document.querySelectorAll('[data-model-connection]').forEach(n=>n.textContent='');}).catch(e=>{document.querySelectorAll('[data-model-connection]').forEach(n=>n.textContent='Restart LUTHUR’s local server to activate these model controls.');throw new Error('Restart LUTHUR’s local server to activate model routing.');}).finally(()=>ModelConsole.checking=null);return ModelConsole.checking;}
api=async function(path,method,body){
  const chat=path==='/chat'&&method==='POST',code=/^\/code\/[a-z0-9-]+$/.test(path)&&method==='POST';
  if(!chat&&!code)return modelApi(path,method,body);
  const queued=window.hqQueuedModelChoice?.text===body?.text?window.hqQueuedModelChoice:null;
  if(queued)window.hqQueuedModelChoice=null;
  const choice=queued||modelRequestChoice(body?.text);
  await modelCheck();
  const request={...body,provider:choice.provider,model:choice.model,effort:choice.effort,astraApproved:choice.astraApproved,opusApproved:choice.opusApproved,adaptive:choice.adaptive!==false,modelPolicy:true};
  const result=await modelApi(path,method,request);
  
  return result;
};
const modelCommandView=vCommand;
vCommand=async function(el){await modelCommandView(el);if(route.view!=='command')return;const stage=document.getElementById('nvStage');if(!stage)return;
  stage.classList.add('has-model-console');const deck=document.createElement('div');deck.className='model-console war-models';deck.innerHTML=`${modelTop()}<div class="model-pair">${modelCard('codex')}${modelCard('claude')}</div><p class="model-connection" data-model-connection></p>`;stage.prepend(deck);el.querySelector('.nv-under')?.remove();modelBind(deck);
};
