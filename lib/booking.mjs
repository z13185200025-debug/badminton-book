import {assertZero,orderFromCells,decideExisting,decideExistingCandidates,sameTarget,paid} from './safety.mjs';
import {solveVisiblePuzzle} from './puzzle.mjs';
import {requestDiagnostics} from './diagnostics.mjs';
import {captchaRecoveryTiming} from './captcha-evidence.mjs';
import {assertNotRateLimited} from './polling.mjs';
import {courtLabelPattern,matchesSession,matchesVenue} from './venues.mjs';
import {venueState,resetVenueEvidence,flushVenueEvidence,dayEvidence} from './venue-evidence.mjs';
import {settleVenueDialogs} from './venue-dialogs.mjs';
import {releaseGate,movedNotice,venueError,validateVenueDay,validateVenueDetail,verifyScheduleCell,validateSubmissionPayload} from './venue-data.mjs';

const delay=ms=>new Promise(r=>setTimeout(r,ms));
const isPath=(response,path)=>new URL(response.url()).pathname.endsWith(path);

async function waitForVenueTable(page) {
  // A valid day can have no schedule, as on the new hall's opening eve.
  // Wait for the rendered table and loading state, not for a bookable cell.
  // The site renders a second visible table for the frozen court-name column.
  // Only the table inside spaceTable owns the time slots (including empty days).
  const table=page.locator('.spaceTable > table:visible');
  await table.first().waitFor({state:'visible',timeout:12000});
  await page.waitForFunction(()=>![...document.querySelectorAll('.ivu-spin-show')].some(el=>el.getBoundingClientRect().height>0));
  if(await table.count()!==1)throw new Error('无法唯一定位场地表格');
  return table;
}

async function checkDayResponse(pending) {
  const response=await pending;await response.finished();
  const body=await response.json().catch(()=>null);
  assertNotRateLimited(body,response.status());
  if(response.status()!==200||(body?.code!==undefined&&Number(body.code)!==200))throw venueError(`场次查询失败：${body?.message||body?.messageEn||'未返回有效排期'}（HTTP ${response.status()}，业务码 ${body?.code??'未知'}）`,releaseGate(body?.message||body?.messageEn)?'RELEASE_NOT_OPEN':'VENUE_DATA_UNAVAILABLE');
}

async function rejectMovedVenue(table,target,log) {
  const text=(await table.locator('.reserveBlock').allTextContents()).find(movedNotice);
  if(text){log('venue_moved',{venueId:target.venueId,notice:text.trim().slice(0,180)});throw Object.assign(new Error(`当前场馆已迁移：${text.trim()}。请使用已核验的新场馆入口。`),{code:'VENUE_MOVED'});}
}

export async function readOrders(page, target, {untilOrder}={}) {
  const collected=[];
  const response=page.waitForResponse(r=>isPath(r,'/api/orders/mine'),{timeout:20000});
  response.catch(()=>{});
  await page.goto(`${target.origin}/venue/orders`,{waitUntil:'domcontentloaded'});
  const initialResponse=await response;await initialResponse.finished();
  assertNotRateLimited(await initialResponse.json().catch(()=>null),initialResponse.status());
  if(!(await page.locator('body').innerText()).includes(target.accountName)) throw new Error('订单页登录账号与配置不一致');
  for(let n=0;n<30;n++) {
    await page.waitForFunction(()=>!document.querySelector('.ivu-spin-show') || !document.querySelector('.ivu-spin-show').getBoundingClientRect().height);
    await page.waitForFunction(()=>[...document.querySelectorAll('tbody tr')].some(r=>/D\d+/.test(r.innerText)) || /(?:Total\s+0|共\s*0)/.test(document.body.innerText));
    const rows=await page.locator('table:visible tbody tr').evaluateAll(rows=>rows.map(r=>[...r.querySelectorAll('td')].map(c=>c.innerText.trim())));
    for(const row of rows) { const order=orderFromCells(row);if(order&&!collected.some(o=>o.number===order.number))collected.push(order); }
    if(untilOrder && collected.some(order=>order.number===untilOrder)) return collected;
    const next=page.locator('.ivu-page-next:not(.ivu-page-disabled)');
    if(!await next.count()) return collected;
    const nextResponse=page.waitForResponse(r=>isPath(r,'/api/orders/mine'),{timeout:20000});
    nextResponse.catch(()=>{});
    const old=await page.locator('table tbody').first().innerText();
    await next.click();const nextResult=await nextResponse;await nextResult.finished();
    assertNotRateLimited(await nextResult.json().catch(()=>null),nextResult.status());
    await page.waitForFunction(old=>document.querySelector('table tbody')?.innerText!==old,old);
  }
  throw new Error('订单分页超过安全上限，停止新增预约');
}

export async function readOrdersWithSessionRefresh(page,target,log=()=>{}) {
  try {return await readOrders(page,target);}
  catch(original) {
    if(original.code==='RATE_LIMITED')throw original;
    const text=await page.locator('body').innerText().catch(()=> '');
    if(!/login|hzsso/.test(page.url())&&!/请登录后访问|Unified identity authentication login/.test(text)) throw original;
    log('renewing_session');
    await page.goto(`${target.origin}/venue/login`,{waitUntil:'domcontentloaded'});
    const sso=page.getByText('Unified identity authentication login',{exact:true});
    await sso.waitFor({state:'visible',timeout:10000});
    await sso.click();
    try {
      await page.waitForURL(url=>url.origin===target.origin&&!/\/login/.test(url.pathname),{timeout:20000});
    } catch {
      throw new Error('学校登录会话失效且单点登录无法自动续期；请运行 npm run login 更新一次会话');
    }
    return await readOrders(page,target);
  }
}

export async function openVenue(page, target, {log=()=>{},preheat=false}={}) {
  venueState(page);resetVenueEvidence(page);
  // Protocols arrive asynchronously after the dates. A one-time count() can miss
  // the late modal and leave the date click waiting for its entire countdown.
  const pending=new Set();let lastActivity=performance.now();
  const relevant=request=>/\/api\/(?:protocols\/code\/|reservation\/(?:day\/info|campus\/venue\/info))/.test(new URL(request.url()).pathname);
  const begin=request=>{if(relevant(request)){pending.add(request);lastActivity=performance.now();}};
  const end=request=>{if(pending.delete(request))lastActivity=performance.now();};
  page.on('request',begin);page.on('requestfinished',end);page.on('requestfailed',end);
  try {
    log('venue_navigation_started');
    const navigation=await page.goto(`${target.origin}/venue/venue-reservation/${target.venueId}`,{waitUntil:'domcontentloaded'});
    if(navigation&&navigation.status()>=400)throw venueError(`场馆入口返回 HTTP ${navigation.status()}`,'VENUE_ROUTE_UNAVAILABLE');
    await page.waitForFunction(()=>[...document.querySelectorAll('.date_box > div,.ivu-modal')].some(el=>el.getBoundingClientRect().height>0),null,{timeout:20000});
    const until=Date.now()+15000;
    while(pending.size||performance.now()-lastActivity<100) {
      if(Date.now()>until)throw new Error('预热场馆数据未加载完毕');
      await delay(25);
    }
    const dialogs=await settleVenueDialogs(page,{allowDeferred:preheat,log,settleMs:150});
    const evidence=await flushVenueEvidence(page);
    if(evidence.details.has(target.venueId))validateVenueDetail(evidence.details.get(target.venueId),target);
    for(const day of evidence.days.values()){
      if(preheat&&day.gate)continue;
      validateVenueDay(day,target);
    }
    const deferred=dialogs.deferred||preheat&&[...evidence.days.values()].some(day=>day.gate);
    if(!deferred)await waitForVenueTable(page);
    const text=await page.locator('body').innerText();
    if(!text.includes(target.accountName)) throw new Error('当前登录账号不匹配或登录已失效');
    if(!matchesVenue(text,target))throw venueError('场馆名称与目录或配置不匹配');
    log('venue_ready',{venueId:target.venueId,deferred});
    return {deferred};
  } finally {page.off('request',begin);page.off('requestfinished',end);page.off('requestfailed',end);}
}

export async function prewarmVenue(page,target,options={}) {
  // Generic venue only: no future date is selected before the release clock.
  await openVenue(page,target,{...options,preheat:true});
  // Before 08:00 the server may deliberately withhold the day's form. The
  // agreement is checked at submission, after the actual schedule is verified.
  options.log?.('prewarm_complete');
}

export async function refreshAvailability(page,target,{log=()=>{}}={}) {
  await settleVenueDialogs(page,{allowDeferred:true,log});
  // Switching an already available day refreshes advanceReservationDays through
  // the site's normal day/info request, without recreating the protocol modal.
  const alternate=page.locator('.date_box > div:not(.active)').first();
  const targetDate=page.locator('.date_box > div:not(.active)').filter({has:page.getByText(target.date.slice(5).replace('-','/'),{exact:true})});
  const refresh=page.locator('button:has(.ivu-icon-md-refresh):visible');
  if(!await alternate.count()&&!await refresh.count()) {
    log('availability_refresh_navigation_fallback');
    await openVenue(page,target,{log});return;
  }
  const response=page.waitForResponse(r=>isPath(r,'/api/reservation/day/info'),{timeout:12000});
  response.catch(()=>{});
  log('availability_refresh_started');
  if(await targetDate.count()===1)await targetDate.click();else if(await refresh.count()===1)await refresh.click();else await alternate.click();
  try{await checkDayResponse(response);}catch(error){await settleVenueDialogs(page,{allowDeferred:true,log});throw error;}
  await flushVenueEvidence(page);
  await settleVenueDialogs(page,{log});
  await waitForVenueTable(page);
  log('availability_refreshed');
}

export async function prepareSelection(page, target, {log=()=>{}}={}) {
  if(target.venueEvidence?.verified){const url=new URL(page.url());if(url.origin!==target.origin||url.pathname!==`/venue/venue-reservation/${target.venueId}`)throw venueError('当前页面入口与已核验场地 ID 不一致');}
  await settleVenueDialogs(page,{log});
  const dateLabel=target.date.slice(5).replace('-','/');
  const date=page.locator('.date_box > div').filter({has:page.getByText(dateLabel,{exact:true})});
  // The venue has already finished loading. A missing date requires a data
  // refresh; waiting three seconds on the unchanged DOM cannot reveal it.
  if(await date.count()!==1) {
    const data=await flushVenueEvidence(page),latest=[...data.days.values()].filter(d=>d.requestId===target.venueId&&d.ok).at(-1);
    log('schedule_dates_observed',{venueId:target.venueId,availableDates:latest?.reservationDates||[],advanceDays:latest?.advanceDays,requestedDate:target.date});
    throw Object.assign(new Error(`目标日期尚未开放（${dateLabel}），保留所选日期，不改订其他日期`),{code:'DATE_NOT_OPEN'});
  }
  let dayResponse;
  if(!(await date.getAttribute('class'))?.split(/\s/).includes('active')) {
    dayResponse=page.waitForResponse(r=>isPath(r,'/api/reservation/day/info'),{timeout:12000});
    dayResponse.catch(()=>{});
    log('date_click_started');
    await date.click();
  }
  // The site's data table is cleared during date changes. Wait for the request and
  // the desired date's populated table; never reuse cells from the previous day.
  if(dayResponse){try{await checkDayResponse(dayResponse);}catch(error){await settleVenueDialogs(page,{allowDeferred:true,log});throw error;}}
  await settleVenueDialogs(page,{log});
  log('date_response_received');
  const table=await waitForVenueTable(page);
  if(!(await date.getAttribute('class'))?.split(/\s/).includes('active')) throw new Error('目标日期没有选中');
  await rejectMovedVenue(table,target,log);
  if(!await table.locator('.reserveBlock').count())throw Object.assign(new Error('目标日期暂无场次排期'),{code:'DATE_EMPTY'});
  log('date_grid_ready');
  let headers=await table.locator('thead td').allTextContents();
  let index=headers.findIndex(x=>x.trim()===target.slot);
  for(let turn=0;index<0&&turn<6;turn++) {
    const firstTime=headers.slice(1).map(t=>t.match(/\d{2}:\d{2}/)?.[0]).find(Boolean);
    const backwards=firstTime && target.slot.slice(0,5)<firstTime;
    const arrow=table.locator(backwards?'thead .ivu-icon-ios-arrow-back':'thead .ivu-icon-ios-arrow-forward');
    if(!await arrow.count()) break;
    const oldHeader=await table.locator('thead').innerText();
    await arrow.click();
    await page.waitForFunction(old=>{const head=document.querySelector('.spaceTable > table thead');return head&&head.innerText!==old;},oldHeader);
    headers=await table.locator('thead td').allTextContents();
    index=headers.findIndex(x=>x.trim()===target.slot);
  }
  if(index<1) throw new Error('未找到指定的一小时时段');
  log('time_window_ready');
  const evidence=await dayEvidence(page,target);
  if(target.venueEvidence?.verified&&!evidence)throw venueError('缺少目标日期的排期接口凭据','VENUE_DATA_UNAVAILABLE');
  const scheduleInfo=evidence?{venueId:evidence.id,requestedDate:target.date,availableDates:evidence.reservationDates,advanceDays:evidence.advanceDays,
    rowCount:evidence.rows.filter(r=>r.date===target.date).length,courts:evidence.rows.filter(r=>r.date===target.date).map(r=>r.court).filter(Boolean)}:null;
  if(evidence){validateVenueDay(evidence,target,{requireDate:true});log('schedule_dates_observed',scheduleInfo);}
  target.scheduleCell=verifyScheduleCell(evidence,target);
  if(evidence)log('schedule_verified',{...scheduleInfo,spaceId:target.scheduleCell.spaceId,timeId:target.scheduleCell.timeId});
  const row=table.locator('tbody tr').filter({has:page.locator('td:first-child').filter({hasText:courtLabelPattern(target.court,target.scheduleCell?.labels||[])})});
  const count=await row.count();
  if(count!==1){
    log('court_lookup_failed',{court:target.court,matches:count,visibleLabels:await table.locator('tbody tr > td:first-child').allTextContents()});
    if(count===0)throw Object.assign(new Error(`当前表格没有场号 ${target.court}，尝试其他候选`),{code:'UNAVAILABLE'});
    throw new Error(`场号 ${target.court} 匹配到多行，停止以避免选错场地`);
  }
  // Respect HTML colspans rather than assuming each TD covers exactly one slot.
  const physical=await row.locator('td').evaluateAll((cells,column)=>{
    let grid=0;for(let i=0;i<cells.length;i++){const span=Number(cells[i].getAttribute('colspan'))||1;if(column>=grid&&column<grid+span)return i;grid+=span;}return -1;
  },index);
  if(physical<1) throw new Error('场次列无法定位');
  const block=row.locator('td').nth(physical).locator('.reserveBlock');
  if(!(await block.getAttribute('class'))?.split(/\s/).includes('free')) throw Object.assign(new Error('指定场次已售罄或暂不可选'),{code:'UNAVAILABLE'});
  assertZero(await block.innerText());
  await block.click();
  log('court_clicked');
  const selected=page.locator('.reserve-msg-row');
  if(await selected.count()!==1) throw new Error('选中的场次数量不是一场');
  const label=await selected.innerText();
  if(!matchesSession(label,target)) throw new Error('选中场次与目标不符');
  assertZero(await page.locator('.action p b').innerText());
  const phone=page.locator('input[placeholder="请输入手机号"]:visible');
  if(await phone.count()!==1 || !/^1\d{10}$/.test(await phone.inputValue())) throw new Error('预约手机号未填妥，请在网页补全');
  return {date:target.date,court:target.court,slot:target.slot,amount:0};
}

export async function createOrder(page, target, options={}) {
  const pattern='**/api/reservation/order/submit*';
  let rejectBlocked;
  const blocked=new Promise((_,reject)=>{rejectBlocked=reject;});blocked.catch(()=>{});
  const guard=async route=>{
    try{
      if(route.request().method()!=='POST')return await route.fallback();
      const request=route.request();
      let payload;try{payload=request.postDataJSON();}catch{}
      if(target.venueEvidence?.verified) {
        validateSubmissionPayload(payload,target);
        options.log?.('submission_identity_verified',{venueId:target.venueId,spaceId:target.scheduleCell.spaceId,timeId:target.scheduleCell.timeId});
      }
      const diagnostics=requestDiagnostics(page);
      if(diagnostics) {
        await diagnostics.flush();
        const evidence=diagnostics.inspect(payload);
        if(evidence.proofStatus==='mismatched'||(evidence.hasObservedCheck&&(!evidence.tokenMatchesChecked||!evidence.checkPassed)))throw Object.assign(new Error('验证码校验与订单提交内容不一致，已停止提交'),{code:'CAPTCHA_CONTINUITY'});
        if(options.captchaRecovery&&evidence.checkPassed&&Number.isFinite(evidence.afterCheckMs)) {
          const waitMs=Math.max(0,captchaRecoveryTiming.afterCheckMs-evidence.afterCheckMs);
          if(waitMs){options.log?.('captcha_recovery_wait',{phase:'before_submit',waitMs});await delay(waitMs);}
        }
        diagnostics.dispatched(request);
      }
      await route.fallback();
    }catch(error){await route.abort().catch(()=>{});rejectBlocked(error);}
  };
  await page.route(pattern,guard);
  try{return await Promise.race([createVerifiedOrder(page,target,options),blocked]);}
  finally{await page.unroute(pattern,guard);}
}

async function createVerifiedOrder(page, target, options={}) {
  const {log=()=>{},onChallenge}=options;
  await settleVenueDialogs(page,{log});
  const evidence=await dayEvidence(page,target);
  if(evidence)verifyScheduleCell(evidence,target);
  await page.locator('label.text-left input[type=checkbox]').check();
  const submit=page.locator('.action .btn:not(.cancel)');
  if(/\bdisab\b/.test(await submit.getAttribute('class')||'')) throw new Error('提交按钮仍被禁用');
  const submission=page.waitForResponse(r=>isPath(r,'/api/reservation/order/submit')&&r.request().method()==='POST',{timeout:(target.captchaTimeoutSeconds+30)*1000});
  // A rejection handler prevents an orphaned rejection if the CAPTCHA fails.
  submission.catch(()=>{});
  const popupEvent=page.waitForEvent('popup',{timeout:(target.captchaTimeoutSeconds+35)*1000});
  popupEvent.catch(()=>{});
  const started=performance.now();
  await submit.click();log('submit_clicked');
  const stage=await Promise.race([
    page.locator('.verifybox:visible').waitFor({timeout:15000}).then(()=> 'captcha'),
    submission.then(()=> 'submitted'),
  ]);
  if(stage==='captcha') {
    log('captcha_detected');
    await solveVisiblePuzzle(page,{onChallenge,attempts:1,log,readyWaitMs:options.captchaRecovery?captchaRecoveryTiming.readyWaitMs:0});
  }
  const response=await submission;
  const json=await response.json();
  log('order_response',{httpStatus:response.status(),code:json.code??json.status??null,sinceSubmitMs:Math.round(performance.now()-started)});
  assertNotRateLimited(json,response.status());
  if(json.code!==200 && !json.data?.tradeNo) {
    const message=String(json.message??json.msg??json.data?.message??'提交被服务器拒绝');
    const soldOut=/售罄|已售出|已被预约|已被预订|已被占用|余量不足|库存不足|sold out|already (reserved|booked)|not available/i.test(message);
    // Rejections are recorded for diagnosis; the caller stops without resubmitting.
    const captchaRejected=Number(json.code)===250&&/验证码(?:非法校验|已失效|已过期|校验失败)|captcha (?:invalid|expired)/i.test(message);
    if(captchaRejected)log('captcha_order_rejected',{code:Number(json.code)});
    throw Object.assign(new Error(captchaRejected?`订单二次验证码校验被拒绝：${message}`:message),{soldOutResponse:soldOut,captchaRejectedResponse:captchaRejected});
  }
  // Check the website's order list once before paying an acknowledged order.
  let popup=null,timer;
  try {
    popup=await Promise.race([popupEvent,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),5000);})]);
    if(popup)await popup.waitForLoadState('domcontentloaded').catch(()=>{});
  } finally {clearTimeout(timer);}
  return {popup,started,number:/^D\d+$/.test(json.data?.tradeNo??'')?json.data.tradeNo:undefined};
}

export async function openPayment(page, {target,order}) {
  // Hidden order-detail dialogs can contain the same number as the live row.
  // The live cell also prefixes the number with "[online purchase]".
  if(!/^D\d+$/.test(order.number))throw new Error('待确认订单号格式不合法');
  const numberCell=page.locator('td:nth-child(2)').filter({hasText:new RegExp(`\\b${order.number}\\b`)});
  const row=page.locator('table:visible tbody tr').filter({has:numberCell});
  // A full account check can leave the table on its final page. Locate the exact
  // existing order again before using Continue payment; never recreate it.
  if(await row.count()!==1) await readOrders(page,target,{untilOrder:order.number});
  if(await row.count()!==1) throw new Error('无法唯一定位待确认订单');
  const continueButton=row.getByRole('button',{name:/Continue payment|继续支付/});
  if(await continueButton.count()!==1) throw new Error('目标订单没有继续支付入口');
  const popup=page.context().waitForEvent('page',{timeout:15000});
  popup.catch(()=>{});
  await continueButton.click();
  const payment=await popup;
  await payment.waitForLoadState('domcontentloaded');
  return payment;
}

export async function verifyBooking(page,target,number) {
  const orders=await readOrders(page,target,{untilOrder:number});
  const order=orders.find(o=>o.number===number);
  if(order && sameTarget(order,target) && paid(order)) {assertZero(order.amount);return order;}
  throw new Error(`确认后一次回查未能证实订单 ${number} 已支付；已停止查询，请到学校订单页核对，不要重复预约`);
}

export async function reconcileSubmittedOrder(page,targets,number,log=()=>{}) {
  const result=decideExistingCandidates(await readOrders(page,targets[0],{untilOrder:number}),targets);
  if(result.action!=='create') {
    if(result.order.number!==number)throw new Error('回查订单号与提交响应不一致，停止确认');
    return result;
  }
  log('order_list_pending',{number});
  throw new Error(`服务器已接收订单 ${number}，但一次回查未显示；已停止查询，请到学校订单页核对，不要重复预约`);
}

export {decideExisting};
