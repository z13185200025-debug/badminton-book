import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {verifyArchive} from './package-release.mjs';

const archive=process.argv[2];
if(!archive)throw new Error('Usage: node tools/smoke-package.mjs path/to/package.zip');
const {manifest,entries}=verifyArchive(await fs.readFile(archive));
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'badminton 解压测试 space '));
let desktop;
try {
  for(const [name,bytes] of Object.entries(entries)){
    const filename=path.join(directory,name);await fs.mkdir(path.dirname(filename),{recursive:true});await fs.writeFile(filename,bytes);
    if(filename.endsWith('.sh'))await fs.chmod(filename,0o755);
  }
  const unpacked=path.join(directory,manifest.name);
  const {startDesktop}=await import(pathToFileURL(path.join(unpacked,'tools/start-app.mjs')));
  desktop=await startDesktop({projectRoot:unpacked,headless:process.env.BADMINTON_TEST_HEADED!=='1',worker:()=>{throw new Error('A clean package must never book on launch');}});
  await desktop.page.getByRole('button',{name:'＋ 添加账号'}).waitFor();
  const state=await fetch(desktop.server.url+'/api/state',{headers:{Authorization:'Bearer '+desktop.server.token}}).then(r=>r.json());
  if(state.busy||state.accounts.length!==1||state.accounts[0].accountName||state.accounts[0].defaults.autoPay||state.recurring)throw new Error('解压包不是干净、手动启动的初始状态');
  await desktop.page.close();await desktop.finished;
  await fs.access(path.join(unpacked,'.state/interface.lock')).then(()=>{throw new Error('关闭后仍有界面锁');},()=>{});
  let nativeLauncher=false;
  if(process.platform==='win32'&&manifest.platform==='windows'){
    const script=path.join(unpacked,'start-windows.cmd');
    const {stdout}=await promisify(execFile)('cmd.exe',['/d','/s','/c',`""${script}" --smoke-test"`],{cwd:unpacked,windowsHide:true,windowsVerbatimArguments:true,timeout:30000,env:{...process.env,CI:'true'}});
    if(!stdout.includes('"closedCleanly":true'))throw new Error('Windows 启动脚本未完成测试');nativeLauncher=true;
  }
  if(process.platform==='linux'&&manifest.platform==='linux'){
    const {stdout}=await promisify(execFile)('sh',[path.join(unpacked,'start-linux.sh'),'--smoke-test'],{cwd:unpacked,timeout:30000});
    if(!stdout.includes('"closedCleanly":true'))throw new Error('Linux 启动脚本未完成测试');nativeLauncher=true;
  }
  console.log(JSON.stringify({platform:process.platform,version:manifest.version,packagedPlatform:manifest.platform,files:manifest.files.length,startedIdle:true,closedCleanly:true,nativeLauncher,liveBooking:false}));
} finally {await desktop?.close();await fs.rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:250});}
