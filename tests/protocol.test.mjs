import test from 'node:test';
import assert from 'node:assert/strict';
import {taskReplyProtocol} from '../bridge/task-reply.mjs';
const reply=(mode,status)=>({role:'assistant',text:`T1 BEGIN\nmode: ${mode}\nstatus: ${status}\nResult\nT1 END`});
test('all modes preserve complete and blocked-round outcomes',()=>{for(const m of ['analysis','design','grill','review'])for(const s of ['complete','needs_user','needs_evidence'])assert.deepEqual(taskReplyProtocol(reply(m,s),'T1'),{complete:true,mode:m,status:s});});
test('partial, streaming and different-task responses are not completion',()=>{const e=reply('design','complete');for(const v of [{...e,truncated:true},{...e,isStreaming:true},{...e,role:'user'}])assert.equal(taskReplyProtocol(v,'T1').complete,false);assert.equal(taskReplyProtocol(e,'T2').complete,false);assert.equal(taskReplyProtocol(reply('unknown','complete'),'T1').complete,false);});
