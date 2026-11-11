import {readFile} from 'node:fs/promises';
import {execFile, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {join, win32} from 'node:path';
import {homedir} from 'node:os';

const execute = promisify(execFile);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export function desktopPaths(env = process.env) {
  return {
    status: join(env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Grok Bot', 'desktop-status.json'),
    executable: join(env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Programs', 'Grok Bot', 'Grok Bot.exe'),
  };
}

async function inspectProcess(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return null;
  const script = `$p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}' -ErrorAction SilentlyContinue; if($p){[pscustomobject]@{path=$p.ExecutablePath;startedAt=$p.CreationDate.ToUniversalTime().ToString('o')}|ConvertTo-Json -Compress}`;
  const {stdout} = await execute(join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-Command', script], {encoding:'utf8',windowsHide:true,timeout:5000});
  return stdout.trim() ? JSON.parse(stdout.replace(/^\uFEFF/, '')) : null;
}

export async function readDesktopState({env = process.env, read = readFile, inspect = inspectProcess} = {}) {
  const paths = desktopPaths(env);
  let status;
  try { status = JSON.parse(await read(paths.status, 'utf8')); }
  catch { return {...paths, running:false, signedIn:false, reason:'missing-status'}; }
  let actual;
  try { actual = await inspect(status.pid); } catch { actual = null; }
  const pathMatches = actual?.path && win32.normalize(actual.path).toLowerCase() === win32.normalize(paths.executable).toLowerCase();
  const startedAt = Date.parse(actual?.startedAt || '');
  const timeMatches = Number.isFinite(startedAt) && Number.isFinite(status.startedAtMs) && Math.abs(startedAt-status.startedAtMs) < 30000;
  const running = Boolean(pathMatches && timeMatches);
  return {...paths,pid:status.pid,version:status.appVersion,running,signedIn:running && status.signedIn === true,
    reason:running ? (status.signedIn === true ? 'ready' : 'sign-in-required') : 'stale-status'};
}

export async function ensureDesktopReady({env = process.env, platform = process.platform, state = () => readDesktopState({env}),
  launch = executable => {const child=spawn(executable,[],{detached:true,stdio:'ignore',windowsHide:true});child.on('error',()=>{});child.unref();},
  sleep = delay, timeoutMs = 20000} = {}) {
  if (platform !== 'win32' || env.GROK_BOT_GATEWAY_URL || env.GROK_BOT_GATEWAY_TOKEN) return {skipped:true};
  let current = await state();
  if (current.running && current.signedIn) return current;
  if (current.running) throw Object.assign(new Error('Grok Bot 客户端已启动，请在客户端完成登录后重试。'),{code:'DESKTOP_SIGN_IN_REQUIRED'});
  await launch(current.executable);
  for (let elapsed=0; elapsed<timeoutMs; elapsed+=500) {
    await sleep(500);
    current=await state();
    if (current.running && current.signedIn) return {...current,startedByBridge:true};
  }
  throw Object.assign(new Error('Grok Bot 本机客户端未就绪。请检查客户端登录；本次消息尚未发送。'),{code:'DESKTOP_NOT_READY'});
}
