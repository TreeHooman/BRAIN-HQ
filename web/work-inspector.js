"use strict";
// Inspect published operation activity in modeless windows without changing routes.
const WorkInspector={busy:false};
const inspectorKind=ref=>['operation','agentloop'].includes(ref?.kind);
function inspectorStep(step){return `<div class="inspect-step"><div class="inspect-step-head"><time>${esc(new Date(step.at||Date.now()).toLocaleTimeString())}</time><b>${esc(step.kind==='text'?'Agent update':step.verb||step.tool||'Activity')}</b></div><pre>${esc(step.target||'')}</pre>${step.result?`<div class="inspect-result ${step.ok===false?'bad':''}">${esc(step.result)}</div>`:''}${step.diff?.length?`<pre class="inspect-diff">${esc(step.diff.join('\n'))}</pre>`:''}</div>`;}
function inspectorOp(op,link=false){return `<article class="inspect-operation"><div class="inspect-op-head"><div><b>${esc(op.title)}</b><small>${esc(gapWorker(op)[1])} · ${esc(op.model||'Model unavailable')}${op.level?' · '+esc(op.level):''}</small></div><span class="pill">${esc(cap(op.status))}</span>${link?`<button type="button" class="btn sm" data-inspect-op="${esc(op.id)}">Open operation</button>`:''}</div><p class="small muted">${fmtDur((op.endedAt||Date.now())-op.startedAt)} · ${Number(op.calls||0)} calls · +${Number(op.added||0)} / −${Number(op.removed||0)}</p>${op.steps?.length?op.steps.map(inspectorStep).join(''):'<p class="muted">Waiting for published agent activity. The request is in progress.</p>'}</article>`;}
function inspectorPaint(w,live){
  if(!w.el.isConnected)return;
  const body=w.el.querySelector('.up-window-body'),atBottom=body.scrollHeight-body.clientHeight-body.scrollTop<40,scroll=body.scrollTop;
  const ops=live.ops||[];
  let html,title;
  if(w.ref.kind==='operation'){
    const current=ops.find(op=>op.id===w.ref.id);if(current)w.data=current;
    const op=w.data;title=op?.title||'Operation activity';
    html=op?`${!current?'<p class="muted">No longer in the live feed · last captured activity</p>':''}${inspectorOp(op)}`:'<p class="muted">This operation is no longer in the live feed.</p>';
  }else{
    w.data=ops;title='Multi-agent loop · live activity';
    const running=ops.filter(op=>op.status==='running');
    html=`<div class="up-status">${running.length} active · ${ops.length} operations in the live feed</div><p class="muted">Published agent updates, tool actions and results. Open an operation to follow it separately.</p>${ops.length?ops.map(op=>inspectorOp(op,true)).join(''):'<p class="muted">Agents standing by. New activity will appear here when work starts.</p>'}`;
  }
  if(w.signature!==html){body.innerHTML=html;w.signature=html;body.scrollTop=atBottom?body.scrollHeight:scroll;}
  w.el.querySelector('header strong').textContent=title;w.el.setAttribute('aria-label',title);
}
const inspectorUpPaint=upPaint;
upPaint=async function(w){
  if(!inspectorKind(w.ref))return inspectorUpPaint(w);
  if(!w.el.classList.contains('work-inspector')){w.el.classList.add('work-inspector');w.el.style.width='880px';w.el.style.height='660px';w.el.style.left=Math.max(12,(innerWidth-Math.min(880,innerWidth-24))/2)+'px';w.el.style.top='70px';}
  try{inspectorPaint(w,await api('/live'));}catch(error){w.signature=null;const body=w.el.querySelector('.up-window-body');body.innerHTML=`<p>${esc(error.message)}</p><button type="button" class="btn sm" data-inspect-retry>Retry live activity</button>`;body.querySelector('button').onclick=()=>upPaint(w);}
};
function inspectorTargets(){
  document.querySelectorAll('#ops .op').forEach(el=>{const id=[...Ops.tiles].find(([,tile])=>tile.el===el)?.[0];if(!id)return;el.dataset.inspectOp=id;el.tabIndex=0;el.setAttribute('role','button');el.setAttribute('aria-label','Inspect operation: '+el.getAttribute('aria-label')?.replace(/^Inspect operation: /,''));});
  const loop=document.getElementById('gapLive');if(loop){loop.tabIndex=0;loop.setAttribute('role','button');loop.setAttribute('aria-label','Open multi-agent live activity');loop.dataset.inspectLoop='1';}
}
const inspectorOpsRender=opsRender;opsRender=function(data){const result=inspectorOpsRender(data);inspectorTargets();for(const w of UPG.windows.values())if(inspectorKind(w.ref))inspectorPaint(w,data);return result;};
const inspectorGapMount=gapWidgetsMount;gapWidgetsMount=function(){const result=inspectorGapMount();inspectorTargets();return result;};
function inspectorActivate(event){const target=event.target.closest('[data-inspect-op],[data-inspect-loop]');if(!target)return;if(event.type==='keydown'&&!['Enter',' '].includes(event.key))return;if(event.type==='keydown'&&event.target!==target)return;event.preventDefault();event.stopPropagation();upOpen(target.dataset.inspectOp?{kind:'operation',id:target.dataset.inspectOp}:{kind:'agentloop'});}
document.addEventListener('click',inspectorActivate);document.addEventListener('keydown',inspectorActivate);
const inspectorMaterial=scrMaterial;scrMaterial=function(){const ref=UPG.active,w=ref&&UPG.windows.get(upKey(ref));if(w&&inspectorKind(ref)){const ops=Array.isArray(w.data)?w.data:w.data?[w.data]:[];return {kind:'agent activity',title:w.el.querySelector('header strong').textContent,text:JSON.stringify(ops.map(op=>({title:op.title,status:op.status,model:op.model,steps:(op.steps||[]).slice(-12)})))};}return inspectorMaterial();};
setInterval(async()=>{const windows=[...UPG.windows.values()].filter(w=>inspectorKind(w.ref));if(!windows.length||WorkInspector.busy||document.hidden||Access.locked)return;WorkInspector.busy=true;try{const live=await api('/live');for(const w of windows)inspectorPaint(w,live);}catch{for(const w of windows){const title=w.el.querySelector('header strong');if(!title.textContent.endsWith(' · reconnecting'))title.textContent+=' · reconnecting';}}finally{WorkInspector.busy=false;}},1500);
