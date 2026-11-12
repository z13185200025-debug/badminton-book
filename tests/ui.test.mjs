import {browserOptions} from '../lib/platform.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {chromium} from 'playwright-core';
import {createInterfaceServer} from '../tools/ui-server.mjs';
import {interfaceDefaults,makeInterfacePlan} from '../lib/ui-plan.mjs';
import {executionSchedule} from '../lib/runtime.mjs';
import {shanghaiDate,nextRelease} from '../lib/safety.mjs';

const root=path.resolve(import.meta.dirname,'..');
const config={...JSON.parse(await fs.readFile(path.join(root,'config.example.json'),'utf8')),accountName:'测试用户',schoolAutomationPermissionConfirmed:true};
const now=new Date('2026-11-05T20:50:00+08:00');
test('manual interface defaults to day after tomorrow at 19:00 and never arms itself',()=>{
  const defaults=interfaceDefaults(config,now);
  assert.equal(defaults.date,'2026-11-07');assert.equal(defaults.slot,'19:00-20:00');assert.equal(defaults.mode,'now');assert.equal(defaults.autoPay,false);
  assert.equal(defaults.bookingDelayMs,2000);
  assert.equal(defaults.venueId,1);assert.equal(defaults.venueMode,'auto');assert.equal(defaults.availableCourts.length,9);assert.equal(defaults.courts.at(-1),'No.9');
  const wait=makeInterfacePlan(config,{...defaults,mode:'release',date:'2026-11-08'},now);
  assert.equal(wait.command,'at');assert.equal(wait.releaseAt,'2026-11-06T00:00:00.000Z');
  const actual=executionSchedule(wait.command,['--at',wait.releaseAt],wait.config,now,shanghaiDate,nextRelease);
  assert.equal(actual.releaseAt.toISOString(),wait.releaseAt);
  assert.equal(wait.config.candidates[0].slot,'19:00-20:00');
  assert.equal(wait.config.bookingDelayMs,2000);
  assert.throws(()=>makeInterfacePlan(config,{...defaults,bookingDelayMs:-2000},now),/延迟/);
  assert.throws(()=>makeInterfacePlan(config,{...defaults,courts:['No.10']},now),/场号/);
  assert.throws(()=>makeInterfacePlan(config,{...defaults,date:'2026-11-08'},now),/日期/);
  assert.throws(()=>makeInterfacePlan(config,{...defaults,date:'bad-date'},now),/日期/);
});

test('real booking child launched by the UI enters one-time waiting and stops before browser activity',{timeout:15000},async t=>{
  const defaults=interfaceDefaults(config),release=Date.parse(defaults.nextRelease);
  if(release-Date.now()<6*60*1000){t.skip('Do not start a real worker close to its browser preheat time');return;}
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'badminton-ui-real-worker-'));
  let server;
  try {
    await fs.writeFile(path.join(directory,'config.json'),JSON.stringify(config));
    await fs.copyFile(path.join(root,'booking.mjs'),path.join(directory,'booking.mjs'));
    await fs.cp(path.join(root,'lib'),path.join(directory,'lib'),{recursive:true});
    await fs.symlink(path.join(root,'node_modules'),path.join(directory,'node_modules'),process.platform==='win32'?'junction':'dir');
    server=await createInterfaceServer({projectRoot:directory});
    const response=await fetch(server.url+'/api/start',{method:'POST',headers:{Authorization:'Bearer '+server.token,'Content-Type':'application/json'},body:JSON.stringify({...defaults,mode:'release',date:defaults.nextReleaseTarget})});
    assert.equal(response.status,200);
    const deadline=Date.now()+7000;
    while(server.getRun().stage!=='armed'&&server.getRun().running&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,25));
    assert.equal(server.getRun().stage,'armed',JSON.stringify(server.getRun()));
    assert.equal(server.getRun().running,true);
    const status=JSON.parse(await fs.readFile(path.join(directory,'.state/status.json'),'utf8'));
    assert.equal(status.command,'at');assert.equal(status.release,defaults.nextRelease);assert.equal(status.target.date,defaults.nextReleaseTarget);
    await server.close();
    const events=(await fs.readFile(path.join(status.runDir,'events.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
    assert.ok(events.some(event=>event.event==='armed'));
    assert.ok(!events.some(event=>['preheat_wait_complete','request_finished','submit_clicked','pay_clicked'].includes(event.event)));
    assert.equal(server.getRun().running,false);
    assert.equal(await fs.access(path.join(directory,'.state/run.lock')).then(()=>true).catch(()=>false),false);
  }finally{await server?.close();await fs.rm(directory,{recursive:true,force:true});}
});

async function fixture(clock) {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'badminton-ui-'));
  await fs.writeFile(path.join(directory,'config.json'),JSON.stringify(config));
  await fs.cp(path.join(root,'ui'),path.join(directory,'ui'),{recursive:true});
  const calls=[];
  const worker=args=>{
    const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();
    child.kill=signal=>{calls.at(-1).signal=signal;setImmediate(()=>child.emit('exit',0));return true;};
    calls.push({args,child});return child;
  };
  const server=await createInterfaceServer({projectRoot:directory,worker,clock});
  const request=(route,data,extra={})=>fetch(server.url+'/api/'+route,{method:data===undefined?'GET':'POST',headers:{Authorization:'Bearer '+server.token,...(data===undefined?{}:{'Content-Type':'application/json'}),...extra},body:data===undefined?undefined:JSON.stringify(data)});
  return {directory,calls,server,request,close:async()=>{await server.close();await fs.rm(directory,{recursive:true,force:true});}};
}

test('opening, refreshing and closing idle UI creates no booking; cross-origin writes are rejected',async()=>{
  const f=await fixture();
  try {
    assert.equal((await fetch(f.server.url+'/api/state')).status,403);
    assert.equal((await f.request('login',{}, {Origin:'https://unrelated.example'})).status,403);
    for(let i=0;i<3;i++){const state=await (await f.request('state')).json();assert.equal(state.run.running,false);assert.equal(state.recurring,false);}
    assert.equal(f.calls.length,0);
  }finally{await f.close();}
});

test('concurrent starts spawn only one worker; closing UI cancels that one run without a recurring job',async()=>{
  const f=await fixture();
  try {
    const settings=(await (await f.request('state')).json()).defaults;
    const responses=await Promise.all([f.request('start',settings),f.request('start',settings)]);
    assert.deepEqual(responses.map(response=>response.status).sort(),[200,400]);
    assert.equal(f.calls.length,1);assert.equal(f.calls[0].args[1],'book');
    assert.ok(!f.calls[0].args.some(value=>/launchctl|watch|daily/.test(value)));
    const saved=JSON.parse(await fs.readFile(path.join(f.directory,'config.json'),'utf8'));assert.equal(saved.autoPay,false);
    await f.server.close();assert.equal(f.calls[0].signal,'SIGTERM');assert.equal(f.server.getRun().running,false);
  }finally{await f.close();}
});

test('interface edits candidates and starts only after the button; stops after user action',async()=>{
  const f=await fixture(),browser=await chromium.launch({...browserOptions(),headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1120,height:960}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(f.server.openUrl);
    await page.getByRole('heading',{name:'准备就绪'}).waitFor();
    await page.waitForFunction(()=>document.querySelector('#slot').value==='19:00-20:00');
    assert.equal(f.calls.length,0);
    assert.equal(await page.locator('#auto-pay').isChecked(),false);
    assert.equal(await page.getByLabel('选场前延迟（秒）').inputValue(),'2');
    assert.match(await page.locator('#venue-name').innerText(),/自动识别.*训练场.*篮球场/);
    assert.equal(await page.getByRole('button',{name:'移除 9 号场',exact:true}).count(),1);
    assert.doesNotMatch(await page.locator('body').innerText(),/留一小时|去打球|安排你的下一场/);
    const chosenDate=await page.locator('#date').inputValue();
    await page.locator('#auto-date').uncheck();
    await page.getByRole('radio',{name:/本次等到/}).check();
    assert.equal(await page.locator('#date').inputValue(),chosenDate,'changing execution mode must preserve the requested date');
    assert.match(await page.locator('#schedule-note').innerText(),/仅本次等待/);
    assert.match(await page.locator('#schedule-note').innerText(),/08:00:02/);
    await page.getByRole('radio',{name:/现在开始/}).check();
    await page.getByLabel('首选时段').selectOption('18:00-19:00');
    await page.getByText('备选时段',{exact:false}).first().click();
    await page.getByLabel('添加备选时段').selectOption('19:00-20:00');await page.getByRole('button',{name:'添加',exact:true}).click();
    await page.getByRole('button',{name:'2 号场优先一级'}).click();
    await page.getByLabel('选场前延迟（秒）').fill('2.5');
    await page.getByRole('button',{name:/开始本次预约/}).click();
    await page.getByRole('button',{name:'停止本次执行'}).waitFor();
    assert.equal(f.calls.length,1);
    const args=f.calls[0].args,plan=JSON.parse(await fs.readFile(args[args.indexOf('--config')+1],'utf8'));
    assert.equal(plan.candidates[0].slot,'18:00-19:00');assert.equal(plan.candidates[0].courts[0],'No.2');assert.equal(plan.candidates[1].slot,'19:00-20:00');assert.equal(plan.autoPay,false);
    assert.equal(plan.bookingDelayMs,2500);
    const emit=(event,elapsedMs,details={})=>f.calls[0].child.stdout.emit('data',Buffer.from(JSON.stringify({event,elapsedMs,at:new Date(Date.parse('2026-11-09T00:00:00Z')+elapsedMs).toISOString(),...details})+'\n'));
    emit('release_reached',0,{clockLatenessMs:0});emit('booking_started',2000,{waitMs:2000,clockLatenessMs:0});
    emit('candidate_try',2200,{court:'No.2',slot:'18:00-19:00',index:2,total:8});
    emit('request_finished',4000,{endpoint:'/venue-server/api/reservation/day/info',durationMs:1304,httpStatus:200});
    emit('pay_ready',6044);
    await page.waitForFunction(()=>document.querySelector('#metrics').textContent.includes('6.044 s'));
    assert.match(await page.locator('#metrics').innerText(),/4\.044 s/);
    assert.match(await page.locator('#requests').innerText(),/1304 ms/);
    assert.match(await page.locator('#technical').innerText(),/2\/8 · No\.2/);
    assert.match(await page.locator('#timeline').innerText(),/08:00:06.044/);
    await page.getByRole('button',{name:'停止本次执行'}).click();
    assert.equal(f.calls[0].signal,'SIGTERM');
    assert.equal(errors.length,0,errors.join('\n'));
  }finally{await browser.close();await f.close();}
});

test('automatic dates follow midnight and the release day while an armed date stays fixed',async()=>{
  let instant=new Date('2026-11-11T23:59:50+08:00');
  const f=await fixture(()=>instant),browser=await chromium.launch({...browserOptions(),headless:true});
  try{
    const page=await browser.newPage();await page.goto(f.server.openUrl);
    await page.waitForFunction(()=>document.querySelector('#date').value==='2026-11-13');
    instant=new Date('2026-11-12T00:00:26+08:00');
    await page.waitForFunction(()=>document.querySelector('#date').value==='2026-11-14');
    await page.getByRole('radio',{name:/本次等到/}).check();
    assert.equal(await page.locator('#date').inputValue(),'2026-11-14');
    await page.getByRole('button',{name:/开始本次等待/}).click();
    await page.getByRole('button',{name:'停止本次执行'}).waitFor();
    const args=f.calls[0].args;assert.equal(args[args.indexOf('--date')+1],'2026-11-14');assert.equal(args[args.indexOf('--at')+1],'2026-11-12T00:00:00.000Z');
    instant=new Date('2026-11-13T00:00:26+08:00');
    await page.waitForFunction(()=>document.querySelector('#date').min==='2026-11-13');
    assert.match(await page.locator('#schedule-note').innerText(),/11\/12 08:00:00/);
    assert.equal(await page.locator('#date').inputValue(),'2026-11-14','running plan must not roll over');
    assert.equal(f.calls.length,1);
  }finally{await browser.close();await f.close();}
});

test('waiting mode advances an automatic date but explicit manual dates remain unchanged',async()=>{
  let instant=new Date('2026-11-11T20:50:00+08:00');
  const f=await fixture(()=>instant),browser=await chromium.launch({...browserOptions(),headless:true});
  try{
    const page=await browser.newPage();await page.goto(f.server.openUrl);
    await page.waitForFunction(()=>document.querySelector('#date').value==='2026-11-13');
    await page.getByRole('radio',{name:/本次等到/}).check();
    assert.equal(await page.locator('#date').inputValue(),'2026-11-14');
    await page.locator('#date').fill('2026-11-13');await page.locator('#slot').focus();
    assert.equal(await page.locator('#auto-date').isChecked(),false);
    instant=new Date('2026-11-12T00:00:26+08:00');
    await page.waitForFunction(()=>document.querySelector('#date-hint').textContent.includes('手动日期'));
    await page.getByRole('radio',{name:/现在开始/}).check();
    assert.equal(await page.locator('#date').inputValue(),'2026-11-13');
    await page.locator('#auto-date').check();await page.waitForFunction(()=>document.querySelector('#date').value==='2026-11-14');
    assert.equal(f.calls.length,0);
  }finally{await browser.close();await f.close();}
});

test('the server resolves an automatic stale date for every account and preserves an explicit date',async()=>{
  const instant=new Date('2026-11-12T00:00:26+08:00');
  const defaults=interfaceDefaults(config,instant);
  assert.equal(makeInterfacePlan(config,{...defaults,mode:'release',date:'2026-11-13',dateMode:'auto'},instant).date,'2026-11-14');
  assert.equal(makeInterfacePlan(config,{...defaults,mode:'release',date:'2026-11-13',dateMode:'manual'},instant).date,'2026-11-13');
  const f=await fixture(()=>instant);
  try{
    const created=await(await f.request('accounts',{label:'第二账号',accountName:'测试二',permissionConfirmed:true})).json();
    const response=await f.request('start',{date:'2026-11-13',dateMode:'auto',mode:'release',accounts:[{...defaults,accountId:'default'},{...defaults,accountId:created.accountId}]});
    assert.equal(response.status,200,await response.text());assert.equal(f.calls.length,2);
    for(const {args} of f.calls)assert.equal(args[args.indexOf('--date')+1],'2026-11-14');
  }finally{await f.close();}
});
