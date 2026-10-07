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
