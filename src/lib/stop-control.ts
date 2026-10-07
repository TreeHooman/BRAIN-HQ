import path from 'node:path';
import {DATA,readJson,writeJson} from './store.ts';
const file=path.join(DATA,'owner-stop.json');
export function isStopped(){return readJson<{stopped:boolean}>(file,{stopped:false}).stopped===true;}
export function setStopped(stopped:boolean){writeJson(file,{stopped,at:new Date().toISOString()});}
export function checkStopped(){if(isStopped())throw new Error('LUTHUR is stopped. Use Resume LUTHUR before starting new work.');}
