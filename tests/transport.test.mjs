import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {callFreshMcp} from '../bridge/fresh-mcp-call.mjs';
test('uncertain send is dispatched once and never replayed on timeout',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'tiko-transport-'));const log=join(dir,'dispatch');const script=join(dir,'fake.mjs');
 writeFileSync(script,`import {createInterface} from 'node:readline';import {appendFileSync} from 'node:fs';for await(const l of createInterface({input:process.stdin})){const m=JSON.parse(l);if(m.method==='initialize')console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{}}));if(m.method==='tools/call')appendFileSync(process.env.DISPATCH_LOG,'sent\\n');}`);
 try{
 await assert.rejects(callFreshMcp({command:process.execPath,args:[script],env:{...process.env,DISPATCH_LOG:log},initialize:{},request:{id:1,method:'tools/call',params:{name:'gbot_send',arguments:{}}},timeoutMs:400}),e=>e.code==='BRIDGE_TIMEOUT'&&e.delivery==='unknown');
 assert.equal(readFileSync(log,'utf8'),'sent\n');
 const controller=new AbortController();controller.abort();
 await assert.rejects(callFreshMcp({signal:controller.signal}),e=>e.code==='BRIDGE_CANCELLED'&&e.delivery==='not-submitted');
 assert.equal(readFileSync(log,'utf8'),'sent\n');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
