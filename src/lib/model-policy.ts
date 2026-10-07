// Owner-controlled subscribed CLI routing. No API billing or automatic Astra escalation.
export const MODEL_CATALOG = {
  version: 3,
  codex: [['auto','Auto · Luna / Sol 6.1'],['gpt-6-luna','Luna 6'],['gpt-6.1-sol','Sol 6.1'],['gpt-6-astra','Astra · adaptive']],
  claude: [['auto','Auto · Haiku / Sonnet'],['haiku','Haiku'],['sonnet','Sonnet'],['opus','Opus · adaptive']],
};
export type ModelChoice = { provider?: string; model?: string; effort?: string | null; astraApproved?: boolean; opusApproved?: boolean; adaptive?: boolean };
export function explicitModel(text: string): ModelChoice {
  const match=text.match(/^\s*(?:please\s+)?(?:(?:you (?:can|may)|i (?:allow|authorize) you to)\s+)?(?:use|switch to|run (?:this )?(?:with|on))\s+(astra|sol\s*6[.]1|luna(?:\s*6)?|sonnet|haiku|opus)\b/i);
  if(!match)return {};
  const name=match[1].toLowerCase().replace(/\s+/g,'');
  const model=({astra:'gpt-6-astra','sol6.1':'gpt-6.1-sol',luna:'gpt-6-luna',sonnet:'sonnet',haiku:'haiku',opus:'opus'} as Record<string,string>)[name];
  return {provider:['sonnet','haiku','opus'].includes(name)?'claude':'codex',model:name==='luna6'?'gpt-6-luna':model,astraApproved:name==='astra',opusApproved:name==='opus',adaptive:false,effort:'low'};
}
export function heavyRequest(text: string) {
  return /\b(code|coding|build|implement|debug|bug|fix|refactor|review|audit|research|report|analy[sz]\w*|diagnos\w*|plan|compare|deep|complex|heavy|test|inspect|proof|derive|architecture|strategy)\b/i.test(text);
}
/** Work that earns the owner's full thinking level. Planning, daily stuff, reviews and checks run Sonnet at low effort in Auto. */
export function deepRequest(text: string) {
  return /\b(code|coding|build|implement|debug|bug|refactor|audit|research|analy[sz]\w*|diagnos\w*|deep|complex|heavy|proof|derive|architecture|strategy|think (?:hard|deeply))\b/i.test(text);
}
export function validateChoice(choice: ModelChoice = {}) {
  if(choice.provider && !['auto','claude','codex'].includes(choice.provider)) throw new Error('Choose Claude or ChatGPT / Codex.');
  if(choice.model && choice.model!=='auto') {
    const list=choice.provider==='claude'?MODEL_CATALOG.claude:MODEL_CATALOG.codex;
    if(!list.some(([id])=>id===choice.model)) throw new Error('Choose a supported model for this engine.');
    if(choice.model==='gpt-6-astra' && choice.astraApproved!==true) throw new Error('Select Astra to allow its use until you switch models.');
    if(choice.model==='opus' && choice.opusApproved!==true) throw new Error('Select Opus to allow its use until you switch models.');
  }
  if(choice.effort && !['auto','low','medium','high','xhigh','max'].includes(choice.effort)) throw new Error('Choose a supported thinking level.');
  return choice;
}
export function resolveModel(provider: 'claude'|'codex', text: string, choice: ModelChoice = {}, heavy=false) {
  choice={...choice,...explicitModel(text)};
  validateChoice(choice);
  const manual=choice.provider===provider && choice.model && choice.model!=='auto';
  const work=heavy||heavyRequest(text),light=provider==='claude'?'haiku':'gpt-6-luna',strong=provider==='claude'?'sonnet':'gpt-6.1-sol';
  const premium=manual&&['opus','gpt-6-astra'].includes(choice.model!);
  const model=manual?(premium&&choice.adaptive!==false?(work?choice.model!:light):choice.model!):(work?strong:light);
  const picked=choice.effort && choice.effort!=='auto'?choice.effort:'low';
  // Auto: the owner's level is a ceiling. Only deep work gets it; everyday Sonnet turns stay quick.
  const effort=!manual&&!heavy&&!deepRequest(text)?'low':picked;
  if(provider==='claude' && ['xhigh','max'].includes(effort)) return {model,effort:'high'};
  return {model,effort};
}
