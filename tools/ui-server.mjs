import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {interfaceDefaults,makeInterfacePlan} from '../lib/ui-plan.mjs';
import {recordRunEvent,stageLabels} from '../lib/ui-telemetry.mjs';
import {configuredVenue} from '../lib/venues.mjs';
import {accountPaths,accountConfig,createAccountStore,MAX_ACCOUNTS} from '../lib/accounts.mjs';
import {requestWorkerStop,forceWorkerStop} from '../lib/process-control.mjs';

const root=path.resolve(import.meta.dirname,'..');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const idleRun=()=>({stage:'idle',message:'尚未开始本次预约',events:[],running:false});
const successStages=new Set(['confirmed','already_booked']);

export async function createInterfaceServer({projectRoot=root,worker,token=randomBytes(32).toString('hex'),idleTimeoutMs=0}={}) {
  const state=path.join(projectRoot,'.state'),configFile=path.join(projectRoot,'config.json');
  await fs.mkdir(state,{recursive:true,mode:0o700});await fs.chmod(state,0o700);
  try{await fs.access(configFile);}catch{await fs.copyFile(path.join(projectRoot,'config.example.json'),configFile);}
  const config=()=>fs.readFile(configFile,'utf8').then(JSON.parse);
  const accounts=await createAccountStore(projectRoot,await config());
  const children=new Map(),runs=new Map();
  let busy=false,closing=false,lastAccess=Date.now(),batch=null,server,url;
  const getRun=(id=batch?.accountIds[0]||'default')=>runs.get(id)||idleRun();
  const batchState=()=>{
    if(!batch)return {running:false,total:0,success:0,preview:0,failed:0,cancelled:0};
    const items=batch.accountIds.map(id=>getRun(id));
    return {...batch,running:items.some(r=>r.running),total:items.length,active:items.filter(r=>r.running).length,
      success:items.filter(r=>successStages.has(r.resultStage||r.stage)).length,
      preview:items.filter(r=>(r.resultStage||r.stage)==='pay_preview_complete').length,
      failed:items.filter(r=>!r.running&&(r.resultStage||r.stage)==='stopped').length,
      cancelled:items.filter(r=>!r.running&&(r.resultStage||r.stage)==='cancelled').length};
  };
  const authorize=req=>{const actual=Buffer.from(req.headers.authorization||''),expected=Buffer.from(`Bearer ${token}`);return actual.length===expected.length&&timingSafeEqual(actual,expected);};
  const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  async function externalBusy(id){
    try{const lock=JSON.parse(await fs.readFile(accountPaths(projectRoot,id).lock,'utf8'));process.kill(lock.pid,0);return true;}
    catch(error){if(!['ENOENT','ESRCH'].includes(error.code))throw error;return false;}
  }
  async function stop(id) {
    if(id)accounts.get(id);
    await Promise.all([...children].filter(([key])=>!id||id===key).map(async([,item])=>{
      item.stopping=true;requestWorkerStop(item.child);
      await Promise.race([item.finished,pause(5000)]);
      if(children.get(item.accountId)===item){await forceWorkerStop(item.child);await Promise.race([item.finished,pause(1000)]);}
    }));
  }
  function ensureIdle(){if(busy||children.size)throw new Error('已有任务正在运行，请先停止本次任务');if(closing)throw new Error('应用正在关闭');}
  function preparePlans(current,input,kind,now=new Date()) {
    const inputs=kind==='login'?[{accountId:input.accountId||'default'}]:input.accounts||[{...input,accountId:input.accountId||'default'}];
    if(!Array.isArray(inputs)||!inputs.length||inputs.length>MAX_ACCOUNTS)throw new Error(`请选择 1–${MAX_ACCOUNTS} 个账号`);
    if(new Set(inputs.map(a=>a.accountId)).size!==inputs.length)throw new Error('同一账号不能在本次计划中重复出现');
    return inputs.map(item=>{
      const account=accounts.get(item.accountId),effective=accountConfig(current,account);
      if(!account.accountName?.trim())throw new Error(`${account.label}：请先填写网页显示的账号姓名`);
      if(!account.permissionConfirmed)throw new Error(`${account.label}：请先确认学校自动化使用权限`);
      const plan=kind==='login'?{command:'login',config:effective}:makeInterfacePlan(effective,{...item,date:input.date,mode:input.mode},now);
      return {account,plan};
    });
  }
  function launch({account,plan,snapshot,id}) {
    const argv=[path.join(projectRoot,'booking.mjs'),plan.command,'--config',snapshot];
    if(plan.date)argv.push('--date',plan.date);if(plan.releaseAt)argv.push('--at',plan.releaseAt);
    const kind=plan.command==='login'?'login':'booking';
    const run={id,accountId:account.id,accountLabel:account.label,kind,stage:'starting',message:kind==='login'?'正在打开学校登录页':'正在启动本次预约',running:true,startedAt:new Date().toISOString(),date:plan.date||null,slot:plan.config.candidates?.[0]?.slot,autoPay:kind==='booking'&&plan.config.autoPay===true,releaseAt:plan.releaseAt||null,bookingDelayMs:plan.config.bookingDelayMs??2000,candidates:plan.config.candidates,events:[],venueId:plan.config.venueId,venueName:configuredVenue(plan.config).name};
    if(plan.releaseAt){run.preheatAt=new Date(Date.parse(plan.releaseAt)-300000).toISOString();run.plannedStartAt=new Date(Date.parse(plan.releaseAt)+run.bookingDelayMs).toISOString();}
    runs.set(account.id,run);
    const launcher=worker||((args)=>spawn(process.execPath,args,{cwd:projectRoot,stdio:['ignore','pipe','pipe','ipc'],windowsHide:true}));
    let child;
    try{child=launcher(argv);}catch(error){run.running=false;run.stage='stopped';run.message=stageLabels.stopped;run.error=error.message;return;}
    let finishResolve,buffer='',errorTail='';
    const item={accountId:account.id,child,stopping:false,finished:new Promise(resolve=>{finishResolve=resolve;})};children.set(account.id,item);
    const accept=line=>{let event;try{event=JSON.parse(line);}catch{return;}if(event.accountId&&event.accountId!==account.id)return;recordRunEvent(run,event);};
    child.stdout.on('data',chunk=>{buffer+=chunk.toString();const lines=buffer.split('\n');buffer=lines.pop();for(const line of lines)accept(line);});
    child.stderr.on('data',chunk=>{errorTail=(errorTail+chunk.toString()).slice(-3000);});
    const finish=(code,error)=>{
      if(children.get(account.id)!==item)return;
      if(buffer)accept(buffer);run.running=false;run.finishedAt=new Date().toISOString();
      run.stage=run.resultStage||(item.stopping?'cancelled':code===0?'finished':'stopped');
      run.message=run.resultMessage||stageLabels[run.stage]||'本次执行结束';
      if(error||(code!==0&&!item.stopping))run.error=run.error||error?.message||errorTail.split('\n').find(line=>line.startsWith('Error:'))||'执行未完成，请查看详细记录';
      children.delete(account.id);finishResolve();
    };
    child.once('error',error=>finish(1,error));child.once('exit',code=>finish(code));
  }
  async function start(kind,input={}) {
    ensureIdle();busy=true;
    try {
      const prepared=preparePlans(await config(),input,kind);
      for(const {account} of prepared)if(await externalBusy(account.id))throw new Error(`${account.label} 已有任务正在运行`);
      const batchId=`ui-${Date.now()}-${randomBytes(4).toString('hex')}`,plans=path.join(state,'plans');
      await fs.mkdir(plans,{recursive:true,mode:0o700});
      // All accounts are validated before any process can submit a booking.
      for(const item of prepared){item.id=`${batchId}-${item.account.id}`;item.snapshot=path.join(plans,item.id+'.json');await fs.writeFile(item.snapshot,JSON.stringify(item.plan.config,null,2)+'\n',{mode:0o600});}
      if(kind==='booking')await accounts.savePlans(prepared);
      if(closing)throw new Error('应用正在关闭，未启动预约');
      batch={id:batchId,kind,accountIds:prepared.map(p=>p.account.id),startedAt:new Date().toISOString()};
      // Do not await another account's login, preheat, CAPTCHA or order.
      for(const item of prepared)launch(item);
      return {started:true,accountIds:batch.accountIds};
    }finally{busy=false;}
  }
  async function body(req){let data='';for await(const chunk of req){data+=chunk;if(Buffer.byteLength(data)>64000)throw new Error('请求过大');}try{return JSON.parse(data||'{}');}catch{throw new Error('请求格式无效');}}
  server=http.createServer(async(req,res)=>{
    try {
      const requested=new URL(req.url,url||'http://127.0.0.1');
      if(req.headers.host!==new URL(url).host)return json(res,403,{error:'仅允许本机访问'});
      if(requested.pathname.startsWith('/api/')){
        if(!authorize(req))return json(res,403,{error:'请从应用入口重新打开界面'});
        if(req.headers.origin&&req.headers.origin!==url)return json(res,403,{error:'不允许跨页面操作'});
        lastAccess=Date.now();
        if(req.method==='GET'&&requested.pathname==='/api/state'){
          const current=await config();
          const list=await Promise.all(accounts.list().map(async a=>({...a,defaults:interfaceDefaults(accountConfig(current,a)),profilePresent:await fs.access(accountPaths(projectRoot,a.id).profile).then(()=>true).catch(()=>false),run:getRun(a.id)})));
          const first=list[0];
          return json(res,200,{defaults:first.defaults,accountName:first.accountName,permissionConfirmed:first.permissionConfirmed,profilePresent:first.profilePresent,run:getRun(),accounts:list,batch:batchState(),busy:busy||children.size>0,recurring:false,maxAccounts:MAX_ACCOUNTS});
        }
        if(req.method!=='POST')return json(res,405,{error:'操作方式不支持'});
        const input=await body(req);
        if(requested.pathname==='/api/start')return json(res,200,await start('booking',input));
        if(requested.pathname==='/api/login')return json(res,200,await start('login',input));
        if(requested.pathname==='/api/stop'){await stop(input.accountId);return json(res,200,{stopped:true});}
        if(['/api/settings','/api/accounts','/api/plans'].includes(requested.pathname)){
          ensureIdle();busy=true;
          try{
            if(requested.pathname==='/api/plans'){await accounts.savePlans(preparePlans(await config(),input,'booking'));return json(res,200,{saved:true});}
            const account=await accounts.upsert({...input,accountId:requested.pathname==='/api/settings'?(input.accountId||'default'):input.accountId});
            // Preserve compatibility with the original account's CLI entry point.
            if(account.id==='default'){const current=await config();await fs.writeFile(configFile+'.tmp',JSON.stringify({...current,accountName:account.accountName,schoolAutomationPermissionConfirmed:account.permissionConfirmed},null,2)+'\n',{mode:0o600});await fs.rename(configFile+'.tmp',configFile);}
            return json(res,200,{saved:true,accountId:account.id});
          }finally{busy=false;}
        }
        return json(res,404,{error:'操作不存在'});
      }
      if(req.method!=='GET')return json(res,405,{error:'操作方式不支持'});
      const assets={'/':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/style.css':['style.css','text/css'],'/icon.svg':['icon.svg','image/svg+xml']};
      const asset=assets[requested.pathname];if(!asset)return json(res,404,{error:'页面不存在'});
      res.writeHead(200,{'Content-Type':asset[1]+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"});
      res.end(await fs.readFile(path.join(projectRoot,'ui',asset[0])));
    }catch(error){json(res,400,{error:error.message});}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));url=`http://127.0.0.1:${server.address().port}`;
  let idle;
  const close=async()=>{if(closing)return;closing=true;clearInterval(idle);await stop();await new Promise(resolve=>{server.close(resolve);server.closeIdleConnections();});};
  if(idleTimeoutMs)idle=setInterval(()=>{if(Date.now()-lastAccess>idleTimeoutMs)close();},1000).unref();
  return {url,token,openUrl:`${url}/#${token}`,close,getRun:id=>structuredClone(getRun(id)),getBatch:()=>structuredClone(batchState())};
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])) {
  const instance=await createInterfaceServer();
  const launchFile=path.join(root,'.state/ui-server.json');
  await fs.writeFile(launchFile,JSON.stringify({pid:process.pid,url:instance.openUrl},null,2),{mode:0o600});
  console.log(JSON.stringify({ready:true,url:instance.openUrl}));
  let ending=false;
  const shutdown=async()=>{if(ending)return;ending=true;await instance.close();await fs.unlink(launchFile).catch(()=>{});process.exit(0);};
  process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
  const index=process.argv.indexOf('--parent-pid');
  if(index>=0){const parent=Number(process.argv[index+1]);setInterval(()=>{try{process.kill(parent,0);}catch{shutdown();}},1000).unref();}
}
