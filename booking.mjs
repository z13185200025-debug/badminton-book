#!/usr/bin/env node
import {chromium} from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {shanghaiDate,candidateTargets,decideExistingCandidates,nextRelease} from './lib/safety.mjs';
import {readOrders,readOrdersWithSessionRefresh,openVenue,refreshAvailability,prepareSelection,createOrder,openPayment,verifyBooking,reconcileSubmittedOrder} from './lib/booking.mjs';
import {waitForPaymentReady} from './lib/payment.mjs';
import {observeRequests} from './lib/diagnostics.mjs';
import {reduceVisualDelay} from './lib/browser.mjs';
import {configurationPath,executionSchedule} from './lib/runtime.mjs';
import {bookingDelayMs,waitForBookingStart} from './lib/start-delay.mjs';
import {accountPaths} from './lib/accounts.mjs';
import {browserOptions} from './lib/platform.mjs';
import {installWorkerStop} from './lib/process-control.mjs';
import {keepAwake} from './lib/keep-awake.mjs';
import {createVenueRouter,existingVenueCandidates} from './lib/venue-router.mjs';

const root=import.meta.dirname;
process.umask(0o077);
const args=process.argv.slice(2),command=args[0]||'check';
const flag=name=>args.includes(name);
const option=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
const configPath=configurationPath(root,args);
let config=JSON.parse(await fs.readFile(configPath,'utf8'));
const accountId=config.accountId||'default';
const paths=accountPaths(root,accountId),stateDir=paths.state;
await fs.mkdir(stateDir,{recursive:true,mode:0o700});
await fs.chmod(stateDir,0o700);
bookingDelayMs(config);
if(typeof config.accountName!=='string'||!config.accountName.trim())throw new Error('请先完成首次配置，填写网页显示的账号姓名');
if(flag('--pay-once')) throw new Error('一次性 Pay 授权已撤销；当前所有入口遵守 config.json 的 autoPay 设置');
const scheduled=['daily','watch','at'].includes(command);
const {releaseAt,preheatAt,reference}=executionSchedule(command,args,config,new Date(),shanghaiDate,nextRelease);
let date=option('--date')||shanghaiDate(reference,config.daysAhead);
let candidates=candidateTargets(config,date,reference);
let target=candidates[0];
const runStartedAt=new Date().toISOString();
const runId=runStartedAt.replace(/[:.]/g,'-')+`-${accountId}-${process.pid}`;
const runDir=path.join(root,'artifacts','runs',runId);
await fs.mkdir(runDir,{recursive:true});
let status={runId,accountId,pid:process.pid,command,target:{date,court:target.court,slot:target.slot,amount:0},runDir};
const statusPath=path.join(stateDir,'status.json');
const start=performance.now();
const entryStartedAt=Number(option('--launched-at'));
const entryOffsetMs=Number.isFinite(entryStartedAt)&&entryStartedAt>0&&Date.now()>=entryStartedAt&&Date.now()-entryStartedAt<60000?Date.now()-entryStartedAt:null;
const events=[];
let logWrites=Promise.resolve();
const log=(event,details={})=>{
  const record={...details,accountId,at:new Date().toISOString(),event,elapsedMs:Math.round(performance.now()-start)};
  events.push(record);
  console.log(JSON.stringify(record));
  logWrites=logWrites.then(()=>fs.appendFile(path.join(runDir,'events.jsonl'),JSON.stringify(record)+'\n'));
};
async function setStatus(stage,extra={}) {status={...status,stage,...extra};await fs.writeFile(statusPath,JSON.stringify(status,null,2));log(stage,extra);}
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function waitApproval(kind,id,seconds) {
  const waitingFrom=performance.now();
  const filename=path.join(stateDir,`${kind}-${id}.approved`);
  await setStatus(`awaiting_${kind}_approval`,{approvalFile:filename});
  const until=Date.now()+seconds*1000;
  while(Date.now()<until) {
    try {await fs.access(filename);await fs.unlink(filename);log('approval_received',{kind,waitMs:Math.round(performance.now()-waitingFrom)});return;}catch{}
    await delay(200);
  }
  throw new Error(`${kind} 确认等待超时，未继续操作`);
}

let lock;
try {
  const prior=JSON.parse(await fs.readFile(path.join(stateDir,'run.lock'),'utf8'));
  try {process.kill(prior.pid,0);throw new Error(`另一个预订进程正在运行（PID ${prior.pid}）`);}catch(e){if(e.code!=='ESRCH')throw e;}
  await fs.unlink(path.join(stateDir,'run.lock'));
} catch(e){if(e.code!=='ENOENT')throw e;}
lock=await fs.open(path.join(stateDir,'run.lock'),'wx',0o600);
await lock.writeFile(JSON.stringify({pid:process.pid,runId}));
let context,page;
let awake;
let succeeded=false;
let stopping=false;
const stop=()=>{stopping=true;context?.close().catch(()=>{});};
const removeStop=installWorkerStop(stop);
try {
  if(!['login','check','book','daily','watch','at'].includes(command)) throw new Error('命令应为 login、check、book、daily、watch 或 at');
  log('run_started',{payMode:config.autoPay===true?'configured_auto_pay':'preview',entryOffsetMs,bookingDelayMs:bookingDelayMs(config)});
  if(command==='daily') {
    const release=Date.parse(`${shanghaiDate()}T${config.releaseTime}+08:00`);
    if(Date.now()>release+config.releaseWindowSeconds*1000) throw new Error('已经错过今日放号窗口，停止补抢');
    if(Date.now()<release-15*60*1000) throw new Error('请在 07:45 以后启动预热');
  }
  if(scheduled)awake=keepAwake(log);
  if(['watch','at'].includes(command)) {
    await setStatus('armed',{release:releaseAt.toISOString(),preheat:new Date(preheatAt).toISOString(),plannedStartAt:new Date(releaseAt.getTime()+bookingDelayMs(config)).toISOString(),autoPay:config.autoPay===true,candidates:config.candidates});
    const waitStarted=performance.now();
    while(Date.now()<preheatAt){if(stopping)throw new Error('后台任务已停止');await delay(Math.min(1000,preheatAt-Date.now()));}
    log('preheat_wait_complete',{waitMs:Math.round(performance.now()-waitStarted)});
    config=JSON.parse(await fs.readFile(configPath,'utf8'));
    if((config.accountId||'default')!==accountId)throw new Error('运行中账号标识发生变化，停止执行');
    date=option('--date')||shanghaiDate(releaseAt,config.daysAhead);
    candidates=candidateTargets(config,date,releaseAt);
    target=candidates[0];status.target={date,court:target.court,slot:target.slot,amount:0};
    log('configuration_reloaded',{candidates:config.candidates,autoPay:config.autoPay===true});
  }
  if(scheduled&&Date.now()>releaseAt.getTime()+config.releaseWindowSeconds*1000)throw new Error('已错过本次放号窗口，停止补抢');
  if(stopping)throw new Error('本次任务已停止');
  context=await chromium.launchPersistentContext(paths.profile,{
    ...browserOptions(),headless:command==='login'?false:config.headless!==false,viewport:{width:1440,height:1000},locale:'en-US',timezoneId:config.timezone,reducedMotion:'reduce',
  });
  if(stopping)throw new Error('本次任务已停止');
  if(command!=='login')await reduceVisualDelay(context);
  context.setDefaultTimeout(12000);
  page=context.pages()[0]||await context.newPage();
  observeRequests(page,log);
  if(command==='login') {
    await page.goto(`${config.origin}/venue/login`);
    await setStatus('awaiting_login');
    await page.waitForFunction(()=>location.origin==='https://hzsm.buaa.edu.cn'&&!!localStorage.getItem('dataSix'),{},{timeout:10*60*1000});
    await readOrders(page,target);
    await setStatus('login_verified');succeeded=true;
  } else {
    const ordersPage=await context.newPage();
    observeRequests(ordersPage,log);
    const orders=await readOrdersWithSessionRefresh(ordersPage,target,log);
    if(config.headless===false)await page.bringToFront();
    let orderCandidates=existingVenueCandidates(candidates);
    const existing=decideExistingCandidates(orders,orderCandidates);
    target=existing.target;
    status.target={date,court:target.court,slot:target.slot,amount:0};
    await setStatus('orders_checked',{existingAction:existing.action});
    let paymentPage,paymentReadiness,submittedNumber,order=existing.order;
    if(command==='check' && existing.action!=='create') {
      await setStatus('check_complete',{order,existingAction:existing.action});succeeded=true;
    } else if(existing.action==='done') {
      await ordersPage.screenshot({path:path.join(runDir,'confirmed-order.png'),fullPage:true});
      await setStatus('already_booked',{order});succeeded=true;
    } else {
      if(existing.action==='create') {
        const requestedCandidates=candidates;
        const router=await createVenueRouter(page,requestedCandidates,{log,onPage:p=>observeRequests(p,log),warmAlternates:scheduled});
        candidates=router.targets;
        if(candidates.length){target=candidates[0];page=await router.pageFor(target);}
        let releaseDeadline;
        if(scheduled) {
          const release=releaseAt.getTime();
          await setStatus('preheated',{release:new Date(release).toISOString()});
          const waitStarted=performance.now();
          while(Date.now()<release){if(stopping)throw new Error('后台任务已停止');await delay(Math.min(1000,release-Date.now()));}
          log('release_reached',{waitMs:Math.round(performance.now()-waitStarted),clockLatenessMs:Date.now()-release});
          releaseDeadline=release+config.releaseWindowSeconds*1000;
        }
        await waitForBookingStart({releaseAt:scheduled?releaseAt.getTime():null,delayMs:bookingDelayMs(config),log,stopped:()=>stopping});
        if(releaseDeadline&&Date.now()>releaseDeadline)throw new Error('已超过本次放号窗口，停止新增提交');
        await router.refresh({force:true});candidates=router.targets;
        orderCandidates=[...candidates,...existingVenueCandidates(requestedCandidates)];
        let acquired=false,needsRefresh=scheduled,captchaSubmissionRetries=0,venueRefreshes=0;
        while(!acquired) {
          if(stopping)throw new Error('本次任务已停止');
          await router.refresh();candidates=router.targets;
          orderCandidates=[...candidates,...existingVenueCandidates(requestedCandidates)];
          const refreshRound=needsRefresh,refreshed=new Set(),unavailableVenues=new Set();
          needsRefresh=false;
          let dateNotOpen=!candidates.length,retryFreshCaptcha=false,venueChanged=false;
          for(const [index,candidate] of candidates.entries()) {
            if(unavailableVenues.has(candidate.venueId))continue;
            target=candidate;
            status.target={date,court:target.court,slot:target.slot,amount:0,venueId:target.venueId,venueName:target.venueName};
            log('candidate_try',{venueId:target.venueId,venueName:target.venueName,court:target.court,slot:target.slot,index:index+1,total:candidates.length});
            try {
              page=await router.pageFor(target);
              if(refreshRound&&!refreshed.has(target.venueId)){await refreshAvailability(page,target,{log});refreshed.add(target.venueId);}
              await prepareSelection(page,target,{log});
            }
            catch(error) {
              if(error.code==='UNAVAILABLE'){log('candidate_unavailable',{court:target.court});continue;}
              if(['DATE_NOT_OPEN','DATE_EMPTY','RELEASE_NOT_OPEN','VENUE_UNAVAILABLE'].includes(error.code)){log('date_unavailable',{venueId:target.venueId,reason:error.message});dateNotOpen=true;unavailableVenues.add(target.venueId);continue;}
              if(['VENUE_CHANGED','VENUE_MOVED','VENUE_IDENTITY_CONFLICT'].includes(error.code)){log('venue_recheck_required',{venueId:target.venueId,reason:error.message});venueChanged=true;unavailableVenues.add(target.venueId);continue;}
              throw error;
            }
            await setStatus('selection_verified');
            if(command==='check') {
              await page.screenshot({path:path.join(runDir,'selection.png'),fullPage:true,mask:[page.locator('input[placeholder="请输入手机号"]:visible')]});
              await setStatus('check_complete');succeeded=true;acquired=true;break;
            }
            if(releaseDeadline && Date.now()>releaseDeadline)throw new Error('已超过本次放号窗口，停止新增提交');
            try {
              const result=await createOrder(page,target,{
                log,
                captchaRecovery:captchaSubmissionRetries>0,
                onChallenge:flag('--captcha-gate')?async p=>{
                  const src=await p.locator('.verifybox .verify-img-panel > img').getAttribute('src');
                  const id=createHash('sha256').update(src).digest('hex').slice(0,16);
                  const screenshot=path.join(runDir,`captcha-${id}.png`);
                  await p.locator('.verifybox:visible').screenshot({path:screenshot});
                  await setStatus('captcha_present',{challengeId:id,screenshot});
                  await waitApproval('captcha',id,config.captchaTimeoutSeconds);
                }:undefined,
              });
              paymentPage=result.popup;submittedNumber=result.number;acquired=true;
              if(paymentPage) {
                paymentReadiness=waitForPaymentReady(paymentPage,target,log);
                paymentReadiness.catch(()=>{});
              }
              await setStatus('submitted_pending_verification');
              break;
            } catch(error) {
              // Reconcile every failed submission before considering another court.
              // Explicit CAPTCHA rejection can receive one fresh challenge after
              // confirming there is no order. Never reuse the rejected proof.
              log('submission_reconcile',{court:target.court,reason:error.message});
              const observed=decideExistingCandidates(await readOrders(ordersPage,target),orderCandidates);
              if(observed.action!=='create') {
                target=observed.target;order=observed.order;
                status.target={date,court:target.court,slot:target.slot,amount:0};
                acquired=true;break;
              }
              if(error.captchaRejectedResponse&&captchaSubmissionRetries<1) {
                captchaSubmissionRetries++;
                log('captcha_submission_recovery',{attempt:captchaSubmissionRetries,reason:error.message});
                await openVenue(page,target,{log});
                retryFreshCaptcha=true;break;
              }
              if(!error.soldOutResponse)throw error;
              log('candidate_lost_race',{court:target.court});
              await refreshAvailability(page,target,{log});
            }
          }
          if(retryFreshCaptcha)continue;
          if(!acquired) {
            if(venueChanged&&venueRefreshes++<3&&await router.refresh({force:true})){needsRefresh=true;continue;}
            if(!scheduled||Date.now()>=releaseDeadline)throw new Error(dateNotOpen?'目标日期尚未开放或暂无场次，停止本次运行':'所有候选场地均不可用，停止本次运行');
            log(dateNotOpen?'waiting_for_date_release':'waiting_for_candidate');
            await delay(Number.isFinite(config.releasePollIntervalMs)?Math.min(2000,Math.max(250,config.releasePollIntervalMs)):500);
            needsRefresh=true;
          }
        }
      }
      if(!succeeded) {
        const current=submittedNumber?await reconcileSubmittedOrder(ordersPage,orderCandidates,submittedNumber,log):decideExistingCandidates(await readOrders(ordersPage,target),orderCandidates);
        target=current.target;
        status.target={date,court:target.court,slot:target.slot,amount:0};
        if(current.action==='create') throw new Error('提交后没有有效订单，停止，避免盲目重试');
        if(current.action==='done') {order=current.order;succeeded=true;await setStatus('confirmed',{order});}
        else {
          order=current.order;
          if(submittedNumber&&submittedNumber!==order.number)throw new Error('新提交订单与账户订单不一致，停止确认');
          if(!paymentPage||paymentPage.isClosed()) {
            paymentPage=await openPayment(ordersPage,{target,order});
            paymentReadiness=waitForPaymentReady(paymentPage,target,log);
          }
          await paymentReadiness;
          const screenshot=path.join(runDir,'before-pay.png');
          await paymentPage.screenshot({path:screenshot,fullPage:true});
          await fs.writeFile(path.join(runDir,'before-pay.txt'),await paymentPage.locator('body').innerText());
          await setStatus('payment_verified',{order,screenshot,paymentPath:new URL(paymentPage.url()).pathname});
          const {inspectAndPay}=await import('./lib/payment.mjs');
          if(config.autoPay!==true) {
            const {validatePaymentText}=await import('./lib/payment.mjs');
            validatePaymentText(await paymentPage.locator('body').innerText(),target);
            await setStatus('pay_preview_complete',{order,note:'autoPay=false；未点击 Pay，待支付订单可能约十分钟后失效。'});succeeded=true;
          } else {
            if(flag('--pay-gate')) await waitApproval('pay',order.number,600);
            const liveConfig=JSON.parse(await fs.readFile(configPath,'utf8'));
            if(liveConfig.autoPay!==true)throw new Error('最终 Pay 已停用，本次未点击');
            await inspectAndPay(paymentPage,{target,order,log});
            await setStatus('pay_clicked',{number:order.number});
            order=await verifyBooking(ordersPage,target,order.number);
            await ordersPage.screenshot({path:path.join(runDir,'confirmed-order.png'),fullPage:true});
            await fs.writeFile(path.join(runDir,'receipt.json'),JSON.stringify({target:status.target,order,verifiedAt:new Date().toISOString()},null,2));
            await setStatus('confirmed',{order});succeeded=true;
          }
        }
      }
    }
  }
} catch(error) {
  await setStatus(stopping?'cancelled':'stopped',stopping?{note:'当前后台等待已按停止指令结束，定时配置保留。'}:{error:error.message});
  if(page&&!page.isClosed()) await page.screenshot({path:path.join(runDir,'stopped.png'),fullPage:true}).catch(()=>{});
  process.exitCode=stopping?0:1;
} finally {
  removeStop();
  awake?.();
  if(context) await context.close().catch(()=>{});
  await lock?.close();await fs.unlink(path.join(stateDir,'run.lock')).catch(()=>{});
  if(succeeded) log('finished');
  await logWrites;
  const point=name=>events.find(e=>e.event===name&&(name!=='captcha_result'||String(e.repCode)==='0000'))?.elapsedMs;
  const duration=(from,to)=>point(from)!==undefined&&point(to)!==undefined?point(to)-point(from):null;
  const totalMs=Math.round(performance.now()-start);
  const waitMs=events.filter(e=>['preheat_wait_complete','release_reached','approval_received','booking_started'].includes(e.event)).reduce((sum,e)=>sum+(e.waitMs||0),0);
  const timings={runId,accountId,startedAt:runStartedAt,target:status.target,result:status.stage,totalMs,waitingMs:waitMs,activeMs:totalMs-waitMs,
    entryStartedAt:entryOffsetMs===null?null:new Date(entryStartedAt).toISOString(),
    entryToPayReadyMs:entryOffsetMs===null||point('pay_ready')===undefined?null:entryOffsetMs+point('pay_ready'),
    entryToConfirmedMs:entryOffsetMs===null||point('confirmed')===undefined?null:entryOffsetMs+point('confirmed'),
    launchToPayReadyMs:point('pay_ready')??null,
    launchToConfirmedMs:point('confirmed')??null,
    launchToSelectionMs:point('selection_verified')??null,
    configuredBookingDelayMs:bookingDelayMs(config),
    actualBookingDelayMs:events.find(e=>e.event==='booking_started')?.waitMs??null,
    serverCreatedAt:status.order?.createdAt??null,
    releaseToBookingStartMs:duration('release_reached','booking_started'),
    bookingStartToPayReadyMs:duration('booking_started','pay_ready'),
    releaseToOrderResponseMs:duration('release_reached','order_response'),
    releaseToConfirmedMs:duration('release_reached','confirmed'),
    releaseToPayReadyMs:duration('release_reached','pay_ready'),
    releaseToPayVisibleMs:duration('release_reached','pay_visible'),
    releaseToSelectionMs:duration('release_reached','selection_verified'),
    releaseToSubmitMs:duration('release_reached','submit_clicked'),
    submitToCaptchaMs:duration('submit_clicked','captcha_detected'),
    captchaSuccessToPayReadyMs:duration('captcha_result','pay_ready'),
    payToConfirmedMs:duration('pay_clicked','confirmed'),
    stages:events.map(({at,event,elapsedMs,matchMs,durationMs,endpoint})=>({at,event,elapsedMs,...(matchMs===undefined?{}:{matchMs}),...(durationMs===undefined?{}:{durationMs}),...(endpoint===undefined?{}:{endpoint})})),
  };
  await fs.writeFile(path.join(runDir,'timings.json'),JSON.stringify(timings,null,2));
  const historyDir=accountId==='default'?path.join(root,'artifacts'):path.join(root,'artifacts','accounts',accountId);
  await fs.mkdir(historyDir,{recursive:true});
  await fs.appendFile(path.join(historyDir,'timing-history.jsonl'),JSON.stringify(timings)+'\n');
  await fs.writeFile(path.join(historyDir,'latest-timings.json'),JSON.stringify(timings,null,2));
}
