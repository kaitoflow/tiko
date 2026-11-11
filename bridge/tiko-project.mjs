import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createProjectStore, readActiveAccountScope } from './project-bots.mjs';
import {taskReplyProtocol} from './task-reply.mjs';

const launcher=fileURLToPath(new URL('./launch.mjs',import.meta.url));
const legacyPath=new URL('./verified-setup.json',import.meta.url);
const legacy=existsSync(legacyPath)?JSON.parse(readFileSync(legacyPath,'utf8')):null;
const store=createProjectStore();
const {positionals,values}=parseArgs({allowPositionals:true,options:{
  help:{type:'boolean',short:'h'},'task-file':{type:'string'},'task-id':{type:'string'},
  project:{type:'string'},'project-id':{type:'string'},'project-name':{type:'string'},
  legacy:{type:'boolean'},after:{type:'string'},limit:{type:'string',default:'40'},
}});
const command=positionals[0]==='project'?(positionals[1]??'status'):positionals[0]??'help';
function fail(code,message){throw Object.assign(new Error(message),{code});}
function run(args){
  if(readActiveAccountScope()!==store.accountScope)fail('ACCOUNT_CHANGED','Grok Bot account changed; resolve the project again in the active account');
  try{return JSON.parse(execFileSync(process.execPath,[launcher,'cli',...args],
    {encoding:'utf8',windowsHide:true,timeout:65000,maxBuffer:2000000}));}
  catch(error){let providerError;
    for(const source of [error.stdout,error.stderr]){try{providerError=JSON.parse(String(source));break;}catch{}}
    throw Object.assign(new Error(providerError?.error?.message??'Grok Bot call failed or timed out; inspect before retrying'),
      {code:providerError?.error?.code??error.code??'call-failed'});
  }
}
const identify=()=>store.identify({project:values.project,projectId:values['project-id'],projectName:values['project-name']});
function legacyDestination(){
  if(!legacy || legacy.accountScope!==store.accountScope)fail('LEGACY_ACCOUNT_UNBOUND','The legacy shared Bot has no verified binding to this account; use the project expert');
  return {botId:legacy.bot_id,botName:legacy.bot_name,legacy:true};
}
function destination(create=false){
  if(values.legacy)return legacyDestination();
  const identity=identify();const bot=create?store.ensure(identity,run):store.binding(identity);
  if(!bot||bot.state!=='ready')fail('PROJECT_BOT_REQUIRED','Resolve this project first: tiko project ensure --project <project root>');
  return {...bot,identity};
}
try{
  if(values.help||command==='help'){
    console.log('Grok Bot project experts: one Bot per project, shared by all its Codex chats.\n'+
      'tiko projects\ntiko project ensure --project <root> [--project-id <Codex project ID>]\n'+
      'tiko status [--project <root>]\ntiko send --task-file <UTF-8 file> [--project <root>] [--task-id <id>]\n'+
      'tiko read --task-id <id> [--project <root>] [--after <cursor>] [--limit 40]\n'+
      'Inside a known project, its root is detected. --legacy explicitly selects the old shared Tiko.');
  }else if(command==='projects'){
    console.log(JSON.stringify({scope:'project',accountScope:store.accountScope,projects:store.list()}));
  }else if(command==='ensure'){
    if(values.legacy)fail('INVALID_SCOPE','Project ensure cannot use --legacy');
    console.log(JSON.stringify(store.ensure(identify(),run)));
  }else if(command==='status'){
    const identity=values.legacy?null:identify();
    const bot=values.legacy?legacyDestination():store.binding(identity);
    if(!bot||bot.state==='pending')console.log(JSON.stringify({available:false,project:identity,state:bot?.state??'unbound',
      next:'tiko project ensure --project '+JSON.stringify(identity.root)}));
    else{
      const data=run(['bots','list','--json']);const bots=Array.isArray(data)?data:data.bots??data.agents??data.items;
      if(!Array.isArray(bots))fail('ROSTER_FORMAT','Unexpected Grok Bot roster');
      const present=bots.some(b=>(b.id??b.agentId??b.uuid)===bot.botId);
      console.log(JSON.stringify({available:present,project:identity,name:bot.botName,id:bot.botId,mode:'manual readback'}));
      if(!present)process.exitCode=1;
    }
  }else if(command==='send'){
    if(!values['task-file'])fail('TASK_REQUIRED','send requires --task-file');
    const task=readFileSync(values['task-file'],'utf8');
    if(!task.trim()||Buffer.byteLength(task)>64000)fail('TASK_SIZE','Task must be nonempty and at most 64 KB');
    const id=values['task-id']??`TIKO_${randomUUID()}`;
    if(!/^[A-Za-z0-9_-]{1,128}$/.test(id))fail('TASK_ID','Use letters, digits, underscore or hyphen in task IDs');
    const bot=destination(true);if(!bot.legacy)store.rememberTask(id,bot.identity,bot);
    const scope=bot.legacy?'通用任务':`项目「${bot.projectName}」，项目根目录：${bot.root}，项目绑定：${bot.key}`;
    const message=`Codex 委派给 ${bot.botName} 的任务，任务 ID：${id}。${scope}。`+
      '同一项目的不同 Codex 聊天共用这个专家 Bot；仅处理当前任务和授权范围。'+
      '只在当前 Grok Bot 会话回复，Codex 主动读回并作最终决定，不为回传调用 codex_send。'+
      `最终回复以 ${id} BEGIN 开头、${id} END 结尾，必须单独写出 mode: analysis|design|grill|review 中的本轮模式，以及 status: complete|needs_user|needs_evidence 中的实际状态；按任务指定模式交付结论、依据、未确认事项。\n\n${task}`;
    const receipt=run(['send','--reply-mode','manual','--request-id',id,'--json',bot.botId,message]);
    console.log(JSON.stringify({task_id:id,project:bot.identity??null,bot:bot.botName,bot_id:bot.botId,receipt,
      note:'Send once; read the matching task before retrying an uncertain receipt.'}));
  }else if(command==='read'){
    const id=values['task-id'];if(!id)fail('TASK_REQUIRED','read requires --task-id');
    const bot=destination();const recorded=values.legacy?null:store.task(id);
    if(recorded&&recorded.projectKey!==bot.key)fail('PROJECT_TASK_MISMATCH','Task belongs to a different project');
    const limit=Number(values.limit);if(!Number.isInteger(limit)||limit<1||limit>200)fail('LIMIT','limit must be 1..200');
    const args=['thread','--json','--limit',String(limit)];if(values.after)args.push('--after',values.after);args.push(bot.botId);
    const data=run(args);const rows=data.entries??data.thread?.entries??data.transcript?.entries;
    if(!Array.isArray(rows))fail('THREAD_FORMAT','Unexpected Grok Bot thread format');
    const entries=rows.map(e=>({...e,text:e.text??(typeof e.content==='string'?e.content:
      typeof e.message?.content==='string'?e.message.content:typeof e.message?.text==='string'?e.message.text:'')}))
      .filter(e=>e.text.includes(id));
    const protocols=entries.map(e=>taskReplyProtocol(e,id));
    const protocol=protocols.findLast(p=>p.complete);
    const complete=Boolean(protocol);
    console.log(JSON.stringify({task_id:id,project:bot.identity??null,bot:bot.botName,bot_id:bot.botId,
      cursor:data.cursor??rows.at(-1)?.id,gapReset:data.gapReset,task_visible:entries.length>0,
      completed_reply_observed:complete,protocol:protocol??null,entries}));
  }else fail('COMMAND','Unknown command; use tiko --help');
}catch(error){console.error(JSON.stringify({error:{code:error.code??'invalid-input',message:error.message}}));process.exitCode=1;}
