"use strict";
function codeManagerModal(){
 const projects=codeProjects();if(!projects.length)return toast('Add a repository folder in Project → Setup first.');
 modal(`<h2>Talk to LUTHUR</h2><p class="small muted">Choose a repository. LUTHUR continues its existing workroom, keeps concise Markdown notes and assigns focused workers only when useful.</p><form class="form" id="managerForm"><label class="f">Project<select name="project">${projects.map(p=>`<option value="${esc(p.slug)}" ${activeProject()===p.slug?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label><label class="f">Repository<select name="folder"></select></label><button class="btn primary">Open LUTHUR workroom</button></form>`);
 const form=document.getElementById('managerForm');
 const sync=()=>{const p=projects.find(p=>p.slug===form.elements.project.value);form.elements.folder.innerHTML=(p.paths||[]).map(folder=>`<option value="${esc(folder)}">${esc(folder)}</option>`).join('');};
 form.elements.project.onchange=sync;sync();
 form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('button');button.disabled=true;
  try{const {id}=await api('/code/workroom/start','POST',Object.fromEntries(new FormData(form)));closeModal();Live.code=await api('/code');codeGrid();codeOpen(id);liveKick();}catch(error){toast(error.message);button.disabled=false;}
 };
}

// Workroom controls use server-persisted settings, independent of the chat model.
async function codeSettingsModal(id) {
 try {
  const d=await api('/code/'+id),s=d.settings;if(!s)throw new Error('Restart LUTHUR to activate Code settings.');
  modal(`<h2>Agent & limits</h2><p class="muted">Settings for ${esc(d.name)}. Changes apply to the next request, including voice.</p>
   <form id="codeSettingsForm" class="form code-settings">
    <label class="f">Workroom name<input name="name" maxlength="40" value="${esc(d.name)}" required></label>
    <div class="code-setting-grid">
     <label class="f">Engine<select name="provider">${opts([['claude','Claude'],['codex','ChatGPT / Codex']],s.provider)}</select></label>
     <label class="f">Model<select name="model"></select></label>
     <label class="f">Thinking<select name="effort">${opts([['low','Low'],['medium','Medium'],['high','High']],s.effort)}</select></label>
     <label class="f">Permissions<select name="permission"></select></label>
     <label class="f">Working style<select name="orchestration">${opts([['direct','One agent — direct work'],['managed','Orchestrator + review']],s.orchestration)}</select></label>
     <label class="f">Worker limit<input name="maxWorkers" type="number" min="0" max="2" value="${s.maxWorkers}" required></label>
     <label class="f">Model calls per request<input name="maxCalls" type="number" min="1" max="4" value="${s.maxCalls}" required></label>
     <label class="f">Minutes per request<input name="maxMinutes" type="number" min="1" max="120" value="${s.maxMinutes}" required></label>
    </div>
    <p id="codePermissionHelp" class="small muted"></p>
    <label class="row"><input type="checkbox" name="reviewSolo" ${s.reviewSolo?'checked':''}> Independent review after file edits (uses one additional call)</label>
    <label class="row"><input type="checkbox" name="adaptive" ${s.adaptive?'checked':''}> Let premium models use a lighter model for easy requests</label>
    <label class="f">Agent instructions<textarea name="instructions" rows="5" maxlength="20000" placeholder="Your coding style, preferred tools, verification rules…">${esc(s.instructions)}</textarea></label>
    <p class="small muted">Limits cover the whole request, including workers and review. Orchestration needs at least three calls for one worker, or four for two. Subscription quotas remain controlled by the provider. Project and global permission ceilings still apply.</p>
    <p class="code-form-error" role="alert"></p><div class="row code-form-actions"><button class="btn primary">Save settings</button><button class="btn" type="button" data-cancel>Cancel</button></div>
   </form>`);
  const f=document.getElementById('codeSettingsForm'),e=f.elements;
  const sync=()=>{
   const engine=e.provider.value,current=e.model.value||s.model;
   e.model.innerHTML=opts(ModelConsole.catalog[engine],ModelConsole.catalog[engine].some(([k])=>k===current)?current:'auto');
   const permission=e.permission.value||s.permission;
   e.permission.innerHTML=opts([['read','Read only'],['plan','Plan & update notes'],['safe',engine==='codex'?'Workspace edits (sandboxed)':'Scoped edits & listed commands'],...(engine==='claude'?[['auto','Edits & commands'],['bypass','Bypass permissions']]:[])],engine==='codex'&&['auto','bypass'].includes(permission)?'safe':permission);
   help();
  };
  const help=()=>{document.getElementById('codePermissionHelp').textContent=({read:'Inspect and explain; no code edits.',plan:'Read code and update workroom / project notes.',safe:e.provider.value==='codex'?'Codex is confined to writable workspace folders. Commands requiring escalation fail.':'Claude may edit and run allow-listed commands. Other commands are denied in this headless session.',auto:'Claude may edit and run commands except its configured deny list.',bypass:'Explicit opt-in: Claude bypasses permission prompts. Tool deny rules remain configured, but shell access is not a security sandbox.'})[e.permission.value];};
  e.provider.onchange=sync;e.permission.onchange=help;sync();
  f.querySelector('[data-cancel]').onclick=closeModal;
  f.onsubmit=async event=>{
   event.preventDefault();const button=f.querySelector('button[type=submit],button:not([type])');button.disabled=true;
   try {
    if(e.permission.value==='bypass'&&s.permission!=='bypass'&&!(await uiConfirm('Enable bypass permissions for this workroom? The agent can execute commands without permission prompts.',button)))return;
    const settings=Object.fromEntries(new FormData(f));delete settings.name;
    for(const key of ['maxWorkers','maxCalls','maxMinutes'])settings[key]=Number(settings[key]);
    settings.adaptive=e.adaptive.checked;settings.reviewSolo=e.reviewSolo.checked;
    await api('/code/'+id+'/settings','PUT',settings);
    await api('/code/'+id,'PUT',{name:e.name.value});
    closeModal();if(route.view==='code'&&Code.slug===id)await codeLoad(true);toast('Workroom settings saved');
   }catch(error){f.querySelector('[role=alert]').textContent=error.message;}finally{button.disabled=false;}
  };
 }catch(error){toast(error.message);}
}

function codeComposerRestore(id) {
 const ta=document.getElementById('cdText');
 if(typeof Att==='undefined')ta.value=hstore.get('hq-code-draft-'+id,'');
 ta.addEventListener('input',()=>hstore.set('hq-code-draft-'+id,ta.value));
 const form=document.getElementById('cdForm'),tools=document.createElement('div');tools.className='code-composer-tools';
 tools.innerHTML='<button type="button" class="btn sm" data-last>Edit last request</button><button type="button" class="btn sm" data-export>Export conversation</button><span class="small muted">Draft saved on this device · Ctrl+Enter to send</span>';
 form.before(tools);
 tools.querySelector('[data-last]').onclick=()=>{const last=[...(Code.data?.messages||[])].reverse().find(m=>m.role==='you');if(last){ta.value=last.text;ta.dispatchEvent(new Event('input'));ta.focus();}};
 tools.querySelector('[data-export]').onclick=()=>{const text=(Code.data?.messages||[]).map(m=>`## ${m.role==='you'?'You':'LUTHUR'}\n\n${m.text}`).join('\n\n');const url=URL.createObjectURL(new Blob([text],{type:'text/markdown'}));const a=document.createElement('a');a.href=url;a.download='workroom-'+id+'.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
}

async function codeNoteEdit(kind) {
 const id=Code.slug,d=await api('/code/'+id);
 modal(`<h2>Edit ${esc(kind)}</h2><form id="codeNoteForm" class="form"><label class="f">Workroom text<textarea name="text" rows="16" maxlength="20000">${esc(d.workroom[kind]||'')}</textarea></label><p role="alert"></p><div class="row"><button class="btn primary">Save note</button><button class="btn" type="button" data-cancel>Cancel</button></div></form>`);
 const f=document.getElementById('codeNoteForm');f.querySelector('[data-cancel]').onclick=closeModal;
 f.onsubmit=async event=>{event.preventDefault();try{await api('/code/'+id+'/notes/'+kind,'PUT',{text:f.elements.text.value});closeModal();await codeLoad(false);toast('Note saved');}catch(error){f.querySelector('[role=alert]').textContent=error.message;}};
}
