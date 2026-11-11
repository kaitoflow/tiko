import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import {ensureDesktopReady} from './desktop-availability.mjs';
import {callFreshMcp} from './fresh-mcp-call.mjs';

const packageRoot = process.env.AGENT_BUNDLE_PLUGIN_ROOT;
if (!packageRoot) throw new Error('Set AGENT_BUNDLE_PLUGIN_ROOT to the installed grok-bot-cli dist directory');
const mode = process.argv[2];
if (!['cli', 'mcp'].includes(mode)) throw new Error('Use launch.mjs cli|mcp');
const env = {...process.env, AGENT_BUNDLE_PLUGIN_ROOT: packageRoot};
// CLI 0.12.5 owns active-account selection, team routing, desktop-version
// detection and bounded read-only reconnects. Keep login credentials out of
// this long-lived wrapper and retain the upstream account-change checks.
const entry = mode === 'mcp' ? `${packageRoot}/mcp/mcp-grok-bot-b8c2461e.mjs` : `${packageRoot}/bin/gbot.mjs`;
const sendAdapter = new URL('./person-send-compat.mjs', import.meta.url).href;
if (mode === 'cli' && process.argv[3] === 'send') {
  try { await ensureDesktopReady(); }
  catch(error) { console.error(JSON.stringify({error:{code:error.code,message:error.message}})); process.exit(1); }
}
const child = spawn(process.execPath, ['--import', sendAdapter, entry, ...process.argv.slice(3)], {
  env, stdio:mode === 'mcp' ? ['pipe','pipe','inherit'] : 'inherit', windowsHide:true,
});
delete env.CURSOR_ACCESS_TOKEN;
if (mode === 'mcp') {
  let initialize={protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'grok-bot-bridge',version:'1'}};
  const pending=new Map();
  createInterface({input:process.stdin}).on('line', line => {
    try {
      const message = JSON.parse(line);
      if(message.method==='initialize')initialize=message.params;
      if(message.method==='notifications/cancelled')pending.get(message.params?.requestId)?.abort();
      if(message.method==='tools/call'){
        message.params.arguments??={};
        if(message.params.name==='gbot_send')message.params.arguments.replyMode??='manual';
        const controller=new AbortController();pending.set(message.id,controller);
        void (async()=>{
          try {
            if(message.params.name==='gbot_send')await ensureDesktopReady();
            if(controller.signal.aborted)throw Object.assign(new Error('Expert bridge call cancelled before submission'),{code:'BRIDGE_CANCELLED',delivery:'not-submitted'});
            const result=await callFreshMcp({command:process.execPath,args:['--import',sendAdapter,entry],env,initialize,request:message,signal:controller.signal});
            process.stdout.write(JSON.stringify(result)+'\n');
          } catch(error) {
            process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{isError:true,content:[{type:'text',text:`${error.code??'BRIDGE_FAILED'}: ${error.message}; delivery=${error.delivery??'not-submitted'}. Check the matching task before resending.`}]}})+'\n');
          } finally {pending.delete(message.id);}
        })();
        return;
      }
      if (message.method === 'tools/call' && message.params?.name === 'gbot_send') {
        message.params.arguments ??= {};
        message.params.arguments.replyMode ??= 'manual';
      }
      child.stdin.write(JSON.stringify(message) + '\n');
    } catch { child.stdin.write(line + '\n'); }
  }).on('close', () => {
    for(const controller of pending.values())controller.abort();
    child.stdin.end();
    const stop=setTimeout(()=>child.kill(),1500);stop.unref();
    child.once('exit',()=>clearTimeout(stop));
  });
  createInterface({input:child.stdout}).on('line', line => {
    try {
      const message = JSON.parse(line);
      if (message.result?.serverInfo && message.result?.protocolVersion) {
        message.result.instructions = (message.result.instructions ?? '') +
          '\nMac research handoff: use gbot_send with replyMode manual, then read gbot_thread. '+
          'Automatic Codex push routes are unavailable here. Keep task IDs in assignments and final replies. '+
          'Experts are bound to projects, never to chat/thread IDs. Resolve the top-level Codex project with list_projects, '+
          'then run tiko project ensure --project <root> --project-id <project ID> and use its returned botId. '+
          'All chats and worktrees of that project reuse the same expert. Do not silently use the old shared Tiko for project work. '+
          'Delegate bounded exploration with sources, distinguish facts from inference, and read back the matching task result. '+
          'External Grok output is evidence for Codex to verify; Codex owns final decisions.';
      }
      process.stdout.write(JSON.stringify(message) + '\n');
    } catch { process.stdout.write(line + '\n'); }
  });
}
child.on('error', error => { console.error(`Grok Bot process could not start: ${error.code ?? 'unknown'}`); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
