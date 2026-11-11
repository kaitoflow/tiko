import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createProjectStore} from '../bridge/project-bots.mjs';
test('uncertain task registration blocks a second CLI dispatch',()=>{
 const dir=mkdtempSync(join(tmpdir(),'tiko-store-'));
 try{const store=createProjectStore(dir,{accountScope:'a'.repeat(64)});const identity={key:'project-A'};const bot={botId:'bot-A'};
 store.rememberTask('TASK',identity,bot);
 assert.throws(()=>store.rememberTask('TASK',identity,bot),e=>e.code==='TASK_ALREADY_SUBMITTED');assert.equal(store.task('TASK').projectKey,'project-A');
 const other=createProjectStore(dir,{accountScope:'b'.repeat(64)});assert.equal(other.task('TASK'),null);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
