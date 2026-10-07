"use strict";
const UsageRing={timer:0};
function usageRateView(rate,percent=false){
  if(!rate)return {value:null,label:'unavailable',detail:'No provider usage report available.'};
  const now=Date.now(),at=typeof rate.at==='number'?rate.at:Date.parse(rate.at),reset=Number(rate.resetsAt)||null;
  const fresh=!rate.failed&&Number.isFinite(at)&&now-at<=300000&&now>=at-60000&&(!reset||reset>now);
  const raw=percent?rate.usedPercent:rate.utilization,known=typeof raw==='number'&&Number.isFinite(raw);
  const value=known?Math.max(0,Math.min(100,percent?raw:rate.utilizationUnit==='fraction'||raw<=1?raw*100:raw)):rate.status==='rejected'?100:null;
  const expired=reset&&reset<=now;
  const stamp=Number.isFinite(at)?new Date(at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}):'unknown';
  return {value:fresh?value:null,label:fresh&&value!==null?`${Math.round(value)}% used`:expired?'awaiting reset update':value!==null?`stale · last ${Math.round(value)}%`:'unavailable',detail:`${percent?'Account reading':'Last CLI report'}: ${stamp}${reset?'; resets '+new Date(reset).toLocaleString():''}. ${!fresh?'Not a current reading.':''}`,reset:fresh?reset:null};
}
function usageContextView(context){
  const known=context&&Number.isFinite(context.context)&&context.context>=0&&Number.isFinite(context.window)&&context.window>0;
  return known?{fraction:Math.min(1,context.context/context.window),label:`${Math.round(context.context/context.window*100)}% · ${usK(context.context)} / ${usK(context.window)}`,detail:`Last reported turn: ${Number(context.context).toLocaleString()} / ${Number(context.window).toLocaleString()} tokens${context.at?' · '+new Date(context.at).toLocaleString():''}. Context belongs to this conversation; account usage includes other Codex activity.`}:{fraction:null,label:'unavailable',detail:'Waiting for actual context/window telemetry from this conversation. Turn totals are not used as a context estimate.'};
}
function usageClaudeRate(data,key){return data?.rates?.[key]||((key==='fiveHour'?/five|5.?hour/i:/seven|week/i).test(data?.rate?.type||'')?data.rate:null);}
function usageCodexWindows(data,mins){return (data?.codex?.buckets||[]).flatMap(b=>b.windows.filter(w=>w.windowDurationMins===mins).map(w=>({...w,id:b.id,name:b.name,failed:!!data.codex.error})));}
function usageProviderView(engine,chat,data){
  const context=usageContextView(engine==='claude'?chat?.claudeUsage:data?.codex?.context||chat?.codexUsage);
  const rates=engine==='claude'?[{name:'',...usageRateView(usageClaudeRate(data,'fiveHour'))}]:usageCodexWindows(data,300).map(w=>({name:w.name,...usageRateView(w,true)}));
  if(!rates.length)rates.push({name:'',...usageRateView(null)});
  return {context,rates};
}
function usageProviderHTML(engine,chat,data){const v=usageProviderView(engine,chat,data),reset=r=>r.reset?` · resets ${new Date(r.reset).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}`:'';return `<b>${engine==='claude'?'Claude':'ChatGPT / Codex'}</b><span title="${esc(v.context.detail)}">Context ${esc(v.context.label)}</span>${v.rates.map(r=>`<span title="${esc(r.detail)}">5-hour ${v.rates.length>1?esc(r.name)+' · ':''}${esc(r.label+reset(r))}</span>`).join('')}<small>${engine==='claude'?'CLI snapshot · may exclude newer use in other apps':data?.codex?.error?'Account read failed · cached values marked stale':'Account usage · updated '+(data?.codex?.at?new Date(data.codex.at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}):'when available')}</small>`;}
function chatClaudeUsagePaint(chat,data){
  const claude=document.getElementById('chatClaudeUsage');if(!claude)return;claude.innerHTML=usageProviderHTML('claude',chat,data);const weekly=usageRateView(usageClaudeRate(data,'weekly'));claude.insertAdjacentHTML('beforeend',`<span title="${esc(weekly.detail)}">Weekly ${esc(weekly.label)}</span>`);
  let codex=document.getElementById('chatCodexUsage');if(!codex){codex=document.createElement('div');codex.id='chatCodexUsage';codex.className='chat-claude-usage codex-usage';codex.setAttribute('role','status');claude.after(codex);}codex.innerHTML=usageProviderHTML('codex',chat,data);
}
function usageRingArc(key,fraction){const p=document.querySelector(`.nv-hud [data-usage="${key}"]`);if(!p)return;const r0=Number(p.dataset.r0),r1=r0+10,c=200,a1=340*Math.PI/180,a0=a1-Math.max(.001,Math.min(1,fraction||0))*52*Math.PI/180,pt=(r,a)=>[c+Math.cos(a)*r,c+Math.sin(a)*r].map(v=>v.toFixed(2)),[ax,ay]=pt(r1,a0),[bx,by]=pt(r1,a1),[cx,cy]=pt(r0,a1),[dx,dy]=pt(r0,a0);p.setAttribute('d',`M${ax} ${ay}A${r1} ${r1} 0 0 1 ${bx} ${by}L${cx} ${cy}A${r0} ${r0} 0 0 0 ${dx} ${dy}Z`);p.classList.toggle('known',fraction!==null);}
function usageRingPaint(chat,data){
  const note=document.getElementById('nvUsageNote'),svg=document.querySelector('.nv-hud');if(!svg||!note)return;
  const views={claude:usageProviderView('claude',chat,data),codex:usageProviderView('codex',chat,data)};
  for(const engine of ['claude','codex']){const v=views[engine],ctxKey=engine==='claude'?'context':'codexContext',rateKey=engine==='claude'?'fiveHour':'codexFiveHour';const values=v.rates.map(r=>r.value).filter(n=>n!==null),rate=values.length===v.rates.length?Math.max(...values):null;
    usageRingArc(ctxKey,v.context.fraction);usageRingArc(rateKey,rate===null?null:rate/100);
    const ctx=svg.querySelector(`[data-usage-label="${ctxKey}"]`),five=svg.querySelector(`[data-usage-label="${rateKey}"]`);const who=engine==='codex'?'GPT':'CLAUDE';if(ctx)ctx.textContent=`${who} CTX ${v.context.fraction===null?'—':Math.round(v.context.fraction*100)+'%'}`;if(five)five.textContent=`${who} 5H ${rate===null?'—':Math.round(rate)+'%'}`;
  }
  note.innerHTML=['claude','codex'].map(e=>`<div>${e==='claude'?'CLAUDE':'CHATGPT'} · CTX ${views[e].context.fraction===null?'—':Math.round(views[e].context.fraction*100)+'%'} · 5H ${esc(views[e].rates.map(r=>r.label).join(' / '))}</div>`).join('');note.title='Context: last turn in this conversation. Five-hour quota: provider-reported usage; stale or expired reports are not graphed.';
}
function usageCardsPaint(chat,data){for(const engine of ['claude','codex'])for(const card of document.querySelectorAll(`[data-model-card="${engine}"]`)){let panel=card.querySelector('.model-usage');if(!panel){panel=document.createElement('div');panel.className='model-usage';panel.setAttribute('role','status');card.append(panel);}panel.innerHTML=usageProviderHTML(engine,chat,data);}const stage=document.getElementById('nvStage'),deck=stage?.querySelector('.war-models');if(deck&&innerWidth>1100){const clear=Math.ceil(deck.getBoundingClientRect().bottom-stage.getBoundingClientRect().top)+12;stage.style.setProperty('--model-clear',clear+'px');stage.style.minHeight=Math.max(560,clear+324)+'px';}}
async function usageRingPoll(){clearTimeout(UsageRing.timer);if(!['command','assistant','code'].includes(route.view)||document.hidden)return;const [chat,data]=await Promise.all([api('/chat').catch(()=>null),api('/usage').catch(()=>null)]);usageCardsPaint(chat,data);if(route.view==='command')usageRingPaint(chat,data);if(route.view==='assistant')chatClaudeUsagePaint(chat,data);UsageRing.timer=setTimeout(usageRingPoll,chat?.busy?10000:30000);}
function usageRingMount(){const stage=document.getElementById('nvStage');if(!stage)return;const note=document.createElement('div');note.id='nvUsageNote';note.className='nv-usage-note';note.setAttribute('role','status');stage.append(note);usageRingPoll();}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)usageRingPoll();});
