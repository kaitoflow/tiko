import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';

// Each tool call owns a fresh upstream client. No account, gateway or fetch
// route state survives between calls, and mutations are never retried here.
export function callFreshMcp({command,args,env,initialize,request,signal,timeoutMs=90000}) {
  if(signal?.aborted)return Promise.reject(Object.assign(new Error('Expert bridge call cancelled'),{code:'BRIDGE_CANCELLED',delivery:'not-submitted'}));
  return new Promise((resolve,reject)=>{
    let settled=false, dispatched=false;
    const initializationId=request.id==='__fresh_initialize__'?'__fresh_initialize_2__':'__fresh_initialize__';
    const child=spawn(command,args,{env,stdio:['pipe','pipe','inherit'],windowsHide:true});
    const reader=createInterface({input:child.stdout});
    const send=value=>child.stdin.write(JSON.stringify(value)+'\n');
    const finish=(error,value)=>{
      if(settled)return;settled=true;
      clearTimeout(timer);signal?.removeEventListener('abort',abort);
      reader.close();child.stdin.end();
      const kill=setTimeout(()=>child.kill(),1500);kill.unref();child.once('exit',()=>clearTimeout(kill));
      if(error){error.delivery=dispatched&&request.params?.name==='gbot_send'?'unknown':'not-submitted';reject(error);}else resolve(value);
    };
    const abort=()=>finish(Object.assign(new Error('Expert bridge call cancelled'),{code:'BRIDGE_CANCELLED'}));
    const timer=setTimeout(()=>finish(Object.assign(new Error('Expert bridge call timed out'),{code:'BRIDGE_TIMEOUT'})),timeoutMs);
    signal?.addEventListener('abort',abort,{once:true});
    child.once('error',()=>finish(Object.assign(new Error('Could not start expert client'),{code:'BRIDGE_START_FAILED'})));
    child.stdin.on('error',()=>finish(Object.assign(new Error('Expert client pipe closed'),{code:'BRIDGE_PIPE_CLOSED'})));
    child.once('exit',()=>{if(!settled)finish(Object.assign(new Error('Expert client exited before its reply'),{code:'BRIDGE_EARLY_EXIT'}));});
    reader.on('line',line=>{
      let response;try{response=JSON.parse(line);}catch{return;}
      if(!dispatched&&response.id===initializationId){
        if(response.error){finish(Object.assign(new Error('Expert protocol initialization failed'),{code:'BRIDGE_INIT_FAILED'}));return;}
        send({jsonrpc:'2.0',method:'notifications/initialized'});
        dispatched=true;send(request);
      }else if(dispatched&&response.id===request.id)finish(null,response);
    });
    if(signal?.aborted){abort();return;}
    send({jsonrpc:'2.0',id:initializationId,method:'initialize',params:initialize});
  });
}
