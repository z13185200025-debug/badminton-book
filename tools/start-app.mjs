import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
import {browserOptions,validateRuntime} from '../lib/platform.mjs';
import {createInterfaceServer} from './ui-server.mjs';

const root=path.resolve(import.meta.dirname,'..');

export async function startDesktop({projectRoot=root,headless=false,worker}={}) {
  validateRuntime({headless});
  const options=browserOptions();
  const state=path.join(projectRoot,'.state'),lockFile=path.join(state,'interface.lock');
  await fs.mkdir(state,{recursive:true,mode:0o700});
  try {
    const old=JSON.parse(await fs.readFile(lockFile,'utf8'));
    try{process.kill(old.pid,0);throw new Error('此目录的助手已经打开，请使用现有窗口');}catch(error){if(error.code!=='ESRCH')throw error;}
    await fs.unlink(lockFile);
  }catch(error){if(error.code!=='ENOENT')throw error;}
  const lock=await fs.open(lockFile,'wx',0o600);await lock.writeFile(JSON.stringify({pid:process.pid}));
  let server,context,closing,finish;
  const finished=new Promise(resolve=>{finish=resolve;});
  const close=()=>closing||=(async()=>{
    try{await server?.close();await context?.close().catch(()=>{});}
    finally{await lock.close();await fs.unlink(lockFile).catch(()=>{});finish();}
  })();
  try {
    server=await createInterfaceServer({projectRoot,worker});
    context=await chromium.launchPersistentContext(path.join(state,'interface-profile'),{
      ...options,headless,viewport:null,locale:'zh-CN',
      args:headless?[]:[`--app=${server.openUrl}`,'--window-size=1280,960'],
    });
    context.once('close',()=>void close());
    const page=context.pages().find(p=>p.url().startsWith(server.url))||context.pages()[0]||await context.newPage();
    if(!page.url().startsWith(server.url))await page.goto(server.openUrl);
    // Some browsers retain background processes after their last window closes.
    page.once('close',()=>void close());
    await page.locator('#account-list').waitFor({state:'visible',timeout:15000});
    return {server,context,page,close,finished};
  }catch(error){await close();throw error;}
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])) {
  let desktop;
  try {
    const smoke=process.argv.includes('--smoke-test');
    desktop=await startDesktop(smoke?{headless:process.env.BADMINTON_TEST_HEADED!=='1',worker:()=>{throw new Error('Smoke test cannot start a booking');}}:{});
    const shutdown=()=>void desktop.close();
    process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
    console.log('Badminton Book 已打开。关闭助手窗口即可结束所有未完成的本次任务。');
    if(smoke){
      await desktop.page.getByRole('button',{name:'＋ 添加账号'}).waitFor();
      if(desktop.server.getBatch().running)throw new Error('Smoke test unexpectedly started a booking');
      await desktop.page.close();await desktop.finished;
      console.log(JSON.stringify({smoke:true,platform:process.platform,startedIdle:true,closedCleanly:true}));
    }
    await desktop.finished;
    process.removeListener('SIGINT',shutdown);process.removeListener('SIGTERM',shutdown);
  }catch(error){await desktop?.close();console.error(error.message);process.exitCode=1;}
}
