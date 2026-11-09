import {browserOptions} from '../lib/platform.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {chromium} from 'playwright-core';
import {accountPaths,createAccountStore,accountConfig} from '../lib/accounts.mjs';
import {createInterfaceServer} from '../tools/ui-server.mjs';

const root=path.resolve(import.meta.dirname,'..');
const base={...JSON.parse(await fs.readFile(path.join(root,'config.example.json'),'utf8')),accountName:'测试甲',schoolAutomationPermissionConfirmed:true};
async function fixture({real=false}={}) {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'badminton-accounts-'));
  await fs.writeFile(path.join(directory,'config.json'),JSON.stringify(base));
  await fs.cp(path.join(root,'ui'),path.join(directory,'ui'),{recursive:true});
  const calls=[];
  const worker=args=>{const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();const call={args,child,launchedAt:performance.now()};child.kill=signal=>{call.signal=signal;setImmediate(()=>child.emit('exit',0));return true;};calls.push(call);return child;};
  if(real){await fs.copyFile(path.join(root,'booking.mjs'),path.join(directory,'booking.mjs'));await fs.cp(path.join(root,'lib'),path.join(directory,'lib'),{recursive:true});await fs.symlink(path.join(root,'node_modules'),path.join(directory,'node_modules'),process.platform==='win32'?'junction':'dir');}
  const server=await createInterfaceServer({projectRoot:directory,...(real?{}:{worker})});
  const request=(route,data)=>fetch(server.url+'/api/'+route,{method:data===undefined?'GET':'POST',headers:{Authorization:'Bearer '+server.token,...(data===undefined?{}:{'Content-Type':'application/json'})},body:data===undefined?undefined:JSON.stringify(data)});
  const add=async()=>{const response=await request('accounts',{label:'账号乙',accountName:'测试乙',permissionConfirmed:true});assert.equal(response.status,200);return (await response.json()).accountId;};
  const state=()=>request('state').then(r=>r.json());
  const payload=async ids=>{const s=await state();return {date:s.defaults.date,mode:'now',accounts:ids.map((id,i)=>({accountId:id,...s.accounts.find(a=>a.id===id).defaults,slot:i?'20:00-21:00':'19:00-20:00',autoPay:i===1}))};};
  return {directory,calls,server,request,add,state,payload,close:async()=>{await server.close();await fs.rm(directory,{recursive:true,force:true});}};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const emit=(call,event,extra={})=>call.child.stdout.emit('data',Buffer.from(JSON.stringify({event,elapsedMs:10,at:new Date().toISOString(),...extra})+'\n'));

test('original profile remains in place; new accounts get private, persistent, distinct state paths',async()=>{
  const f=await fixture();
  try{
    const original=accountPaths(f.directory);await fs.mkdir(original.profile,{recursive:true});await fs.writeFile(path.join(original.profile,'original-marker'),'keep');
    const id=await f.add(),other=accountPaths(f.directory,id);assert.notEqual(original.profile,other.profile);assert.notEqual(original.lock,other.lock);
    assert.equal(await fs.readFile(path.join(original.profile,'original-marker'),'utf8'),'keep');
    const store=await createAccountStore(f.directory,base);assert.equal(store.list().length,2);assert.equal(accountConfig(base,store.get(id)).accountName,'测试乙');
    assert.equal(accountConfig({...base,autoPay:true},store.get(id)).autoPay,false);
    await store.upsert({accountId:'default',accountName:base.accountName,permissionConfirmed:true});
    assert.equal(accountConfig({...base,autoPay:true},store.get('default')).autoPay,true);
    if(process.platform!=='win32')assert.equal((await fs.stat(path.join(f.directory,'.state/accounts.json'))).mode&0o777,0o600);
    for(const id of ['../profile','a-../../bad','',42])assert.throws(()=>accountPaths(f.directory,id),/标识/);
    const response=await f.request('accounts',{accountName:'测试甲',label:'重复账号',permissionConfirmed:true});assert.equal(response.status,400);
    assert.equal(f.calls.length,0);
  }finally{await f.close();}
});

test('batch validates every account before starting any worker, including duplicates and account scope',async()=>{
  const f=await fixture();
  try{
    const id=await f.add(),valid=await f.payload(['default',id]);
    for(const input of [{...valid,accounts:[]},{...valid,accounts:[valid.accounts[0],valid.accounts[0]]},{...valid,accounts:[valid.accounts[0],{...valid.accounts[1],accountId:'a-0000000000000000'}]},{...valid,accounts:[valid.accounts[0],{...valid.accounts[1],courts:['No.10']}]}])assert.equal((await f.request('start',input)).status,400);
    await f.request('accounts',{accountId:id,accountName:'测试乙',permissionConfirmed:false});
    assert.equal((await f.request('start',valid)).status,400);assert.equal(f.calls.length,0);
  }finally{await f.close();}
});

test('two accounts start concurrently with distinct snapshots, and one failure never stops the other',async()=>{
  const f=await fixture();
  try{
    const id=await f.add(),input=await f.payload(['default',id]);const s=await f.state();input.mode='release';input.date=s.defaults.nextReleaseTarget;
    const results=await Promise.all([f.request('start',input),f.request('start',input)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);assert.equal(f.calls.length,2);
    const plans=await Promise.all(f.calls.map(c=>fs.readFile(c.args[c.args.indexOf('--config')+1],'utf8').then(JSON.parse)));
    assert.deepEqual(plans.map(p=>p.accountId),['default',id]);assert.deepEqual(plans.map(p=>p.accountName),['测试甲','测试乙']);assert.deepEqual(plans.map(p=>p.candidates[0].slot),['19:00-20:00','20:00-21:00']);assert.deepEqual(plans.map(p=>p.autoPay),[false,true]);
    assert.equal(f.calls[0].args.at(-1),f.calls[1].args.at(-1));assert.ok(f.calls[1].launchedAt-f.calls[0].launchedAt<500);
    emit(f.calls[0],'stopped',{error:'账号甲网络超时'});f.calls[0].child.emit('exit',1);await tick();
    assert.equal(f.server.getRun('default').stage,'stopped');assert.equal(f.server.getRun(id).running,true);assert.equal(f.calls[1].signal,undefined);
    emit(f.calls[1],'confirmed',{order:{number:'DTEST',date:input.date,session:'No.9 20:00-21:00',payment:'Paid',status:'Normal',amount:'0'}});f.calls[1].child.emit('exit',0);await tick();
    assert.equal(f.server.getBatch().success,1);assert.equal(f.server.getBatch().failed,1);assert.equal(f.server.getBatch().running,false);
    assert.equal(f.server.getRun('default').order,undefined);assert.equal(f.server.getRun(id).order.number,'DTEST');
  }finally{await f.close();}
});

test('single-account stop leaves another running; close stops all remaining workers',async()=>{
  const f=await fixture();
  try{
    const id=await f.add();await f.request('start',await f.payload(['default',id]));
    assert.equal((await f.request('login',{accountId:id})).status,400);
    assert.equal((await f.request('accounts',{accountName:'测试丙',permissionConfirmed:true})).status,400);
    await f.request('stop',{accountId:'default'});assert.equal(f.calls[0].signal,'SIGTERM');assert.equal(f.calls[1].signal,undefined);assert.equal(f.server.getRun(id).running,true);
    await f.server.close();assert.equal(f.calls[1].signal,'SIGTERM');assert.equal(f.server.getRun(id).running,false);
  }finally{await f.close();}
});

test('login uses only the selected account; saving two plans persists without starting any booking',async()=>{
  const f=await fixture();
  try{
    const id=await f.add(),input=await f.payload(['default',id]);await f.request('plans',input);assert.equal(f.calls.length,0);
    const s=await f.state();assert.equal(s.accounts[1].defaults.slot,'20:00-21:00');assert.equal(s.accounts[0].defaults.autoPay,false);assert.equal(s.accounts[1].defaults.autoPay,true);
    const result=await f.request('login',{accountId:id});assert.equal(result.status,200);assert.equal(f.calls.length,1);assert.equal(f.calls[0].args[1],'login');
    const plan=JSON.parse(await fs.readFile(f.calls[0].args[3],'utf8'));assert.equal(plan.accountId,id);assert.equal(plan.accountName,'测试乙');
  }finally{await f.close();}
});

test('real parallel workers both arm for the same release, keep separate locks/logs, and stop before browser activity',{timeout:20000},async t=>{
  const f=await fixture({real:true});
  try{
    const id=await f.add(),s=await f.state();if(Date.parse(s.defaults.nextRelease)-Date.now()<6*60*1000){t.skip('Avoid browser preheat');return;}
    const input=await f.payload(['default',id]);input.mode='release';input.date=s.defaults.nextReleaseTarget;
    assert.equal((await f.request('start',input)).status,200);
    const until=Date.now()+8000;while(Date.now()<until&&!['default',id].every(key=>f.server.getRun(key).stage==='armed'))await new Promise(r=>setTimeout(r,25));
    const statuses=await Promise.all(['default',id].map(key=>fs.readFile(accountPaths(f.directory,key).status,'utf8').then(JSON.parse)));
    assert.ok(statuses.every(s=>s.stage==='armed'));assert.notEqual(statuses[0].pid,statuses[1].pid);assert.notEqual(statuses[0].runDir,statuses[1].runDir);assert.equal(statuses[0].release,statuses[1].release);
    await f.request('stop',{accountId:'default'});assert.equal(f.server.getRun(id).running,true);await f.server.close();
    for(const [i,key] of ['default',id].entries()){
      const events=(await fs.readFile(path.join(statuses[i].runDir,'events.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
      assert.ok(events.every(e=>e.accountId===key));assert.ok(!events.some(e=>['request_finished','preheat_wait_complete','submit_clicked','pay_clicked'].includes(e.event)));
      assert.equal(await fs.access(accountPaths(f.directory,key).lock).then(()=>true).catch(()=>false),false);
    }
  }finally{await f.close();}
});

test('Chrome cookies and storage are isolated and persist only inside their matching account profile',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'badminton-profiles-'));const contexts=[];
  try{
    for(const [index,id] of ['default','a-1234567890abcdef'].entries()){
      const context=await chromium.launchPersistentContext(accountPaths(directory,id).profile,{...browserOptions(),headless:true});contexts.push(context);
      await context.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<title>Offline account isolation fixture</title>'}));
      const page=await context.newPage();await page.goto('https://account-fixture.invalid');
      assert.equal(await page.evaluate(()=>localStorage.getItem('identity')),null);await page.evaluate(value=>localStorage.setItem('identity',value),String(index));
      await context.addCookies([{name:'fixture-session',value:String(index),url:'https://account-fixture.invalid',expires:Math.floor(Date.now()/1000)+3600}]);
    }
    for(let i=0;i<contexts.length;i++){assert.equal((await contexts[i].cookies())[0].value,String(i));await contexts[i].close();}contexts.length=0;
    const reopened=await chromium.launchPersistentContext(accountPaths(directory,'a-1234567890abcdef').profile,{...browserOptions(),headless:true});contexts.push(reopened);
    await reopened.route('**/*',r=>r.fulfill({contentType:'text/html',body:'fixture'}));const page=await reopened.newPage();await page.goto('https://account-fixture.invalid');assert.equal(await page.evaluate(()=>localStorage.getItem('identity')),'1');assert.equal((await reopened.cookies())[0].value,'1');
  }finally{await Promise.all(contexts.map(c=>c.close()));await fs.rm(directory,{recursive:true,force:true});}
});

test('UI adds a second account and independently edits 19-20 / 20-21, with per-account results and stop',async()=>{
  const f=await fixture(),browser=await chromium.launch({...browserOptions(),headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1120,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(f.server.openUrl);await page.getByRole('heading',{name:'准备就绪'}).waitFor();
    await page.getByRole('button',{name:'＋ 添加账号'}).click();await page.getByLabel('账号备注',{exact:true}).fill('账号乙');await page.getByLabel('网页右上角显示的姓名').fill('测试乙');await page.getByLabel('我已获准使用此账号及学校自动化预约').check();await page.getByRole('button',{name:'保存设置',exact:true}).click();
    await page.getByRole('heading',{name:'配置 · 账号乙',exact:true}).waitFor();await page.getByLabel('首选时段',{exact:true}).selectOption('20:00-21:00');await page.locator('#auto-pay').check();
    await page.getByRole('button',{name:'配置 测试甲',exact:true}).click();assert.equal(await page.locator('#slot').inputValue(),'19:00-20:00');assert.equal(await page.locator('#auto-pay').isChecked(),false);
    await page.getByRole('button',{name:'配置 账号乙',exact:true}).click();assert.equal(await page.locator('#slot').inputValue(),'20:00-21:00');assert.equal(await page.locator('#auto-pay').isChecked(),true);
    assert.equal(f.calls.length,0);assert.match(await page.locator('#account-list').innerText(),/19:00 — 20:00/);assert.match(await page.locator('#account-list').innerText(),/20:00 — 21:00/);
    await page.getByRole('button',{name:/开始本次预约/}).click();await page.getByRole('button',{name:'停止本次执行',exact:true}).waitFor();assert.equal(f.calls.length,2);
    emit(f.calls[0],'stopped',{error:'测试甲独立错误'});f.calls[0].child.emit('exit',1);emit(f.calls[1],'pay_ready');
    await page.waitForFunction(()=>document.querySelector('#batch-summary').textContent.includes('失败 1'));assert.equal(await page.locator('#run-error').isVisible(),false);
    await page.getByRole('button',{name:'配置 测试甲',exact:true}).click();assert.match(await page.locator('#run-error').innerText(),/测试甲独立错误/);
    await page.getByRole('button',{name:'停止 账号乙',exact:true}).click();assert.equal(f.calls[1].signal,'SIGTERM');assert.deepEqual(errors,[]);
  }finally{await browser.close();await f.close();}
});
