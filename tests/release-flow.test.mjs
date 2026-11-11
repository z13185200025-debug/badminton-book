import {browserOptions} from '../lib/platform.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium} from 'playwright-core';
import {PNG} from 'pngjs';
import {prewarmVenue,refreshAvailability,prepareSelection,createOrder} from '../lib/booking.mjs';
import {waitForPaymentReady,inspectAndPay} from '../lib/payment.mjs';
import {reduceVisualDelay} from '../lib/browser.mjs';
import {waitForBookingStart} from '../lib/start-delay.mjs';

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function puzzle() {
  const bg=new PNG({width:310,height:155}),piece=new PNG({width:47,height:155});let seed=7;
  for(let y=0;y<155;y++)for(let x=0;x<310;x++){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;const i=(y*310+x)*4;
    bg.data[i]=seed&255;bg.data[i+1]=(seed>>>8)&255;bg.data[i+2]=(seed>>>16)&255;bg.data[i+3]=255;
  }
  for(let y=80;y<130;y++)for(let x=5;x<42;x++){
    const a=(y*47+x)*4,b=(y*310+x+121)*4;
    for(let c=0;c<3;c++){piece.data[a+c]=bg.data[b+c];bg.data[b+c]=Math.round(bg.data[b+c]*.55);}piece.data[a+3]=255;
  }
  const uri=image=>'data:image/png;base64,'+PNG.sync.write(image).toString('base64');
  return {background:uri(bg),piece:uri(piece)};
}

for(const captchaRecovery of [false,true])test(`preheated release reaches Pay without paying (${captchaRecovery?'conservative CAPTCHA recovery':'first attempt'})`,async t=>{
  const browser=await chromium.launch({...browserOptions(),headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await reduceVisualDelay(context);
  const target={origin:'https://hzsm.buaa.edu.cn',venueId:1,accountName:'测试用户',date:'2026-11-07',court:'No.1',slot:'12:00-13:00',autoPay:false,captchaTimeoutSeconds:10,maxCaptchaAttempts:1};
  let released=false,venueLoads=0,protocolLoads=0,submits=0,captchaChecks=0;
  const dateRequests=[],images=puzzle();
  const html=`<meta charset="utf-8">Welcome! 测试用户 Badminton Gymnasium（Badminton Training Hall）
    <div class="date_box"></div><div class="spaceTable"><table><thead><tr><td>Venue</td><td>12:00-13:00</td></tr></thead><tbody></tbody></table></div>
    <div id="selection"></div><input placeholder="请输入手机号" value="13000000000">
    <label class="text-left"><input type="checkbox">Read</label><div class="action"><p><b>0.00</b></p><button class="btn">Submit</button></div>
    <div class="ivu-modal" style="display:none;position:fixed;inset:0;background:white;z-index:10">Badminton Court Reservation Management Notice<button id="close">Close</button></div>
    <div class="verifybox" style="display:none;position:fixed;top:300px;left:400px;background:white">
    <div class="verify-img-panel" style="position:relative;width:310px;height:155px"><img src="${images.background}" width="310" height="155"><div class="verify-sub-block" style="position:absolute;top:0;left:0"><img src="${images.piece}" width="47" height="155"></div></div>
    <div class="verify-move-block" style="width:40px;height:40px;background:gray"></div></div>
    <script>
    let day='2026-11-05',drag=false,dragX=0;
    async function load(){
      document.querySelector('tbody').innerHTML='';
      const data=await(await fetch('/api/reservation/day/info?searchDate='+day)).json();
      document.querySelector('.date_box').innerHTML=Array.from({length:data.days},(_,i)=>'<div class="'+(day==='2026-11-0'+(5+i)?'active':'')+'" data-day="2026-11-0'+(5+i)+'"><span>11/0'+(5+i)+'</span></div>').join('');
      document.querySelectorAll('.date_box>div').forEach(el=>el.onclick=()=>{day=el.dataset.day;load()});
      document.querySelector('tbody').innerHTML='<tr><td>No.1</td><td><div class="reserveBlock free">￥0</div></td></tr>';
      document.querySelector('.reserveBlock').onclick=()=>document.querySelector('#selection').innerHTML='<div class="reserve-msg-row">No.1：12:00-13:00 ￥0</div>';
    }
    fetch('/api/protocols/code/BADMINTON_PROTOCOL').then(()=>document.querySelector('.ivu-modal').style.display='block');
    document.querySelector('#close').onclick=()=>document.querySelector('.ivu-modal').style.display='none';
    document.querySelector('.action .btn').onclick=()=>document.querySelector('.verifybox').style.display='block';
    document.querySelector('.verify-move-block').onmousedown=e=>{drag=true;dragX=e.clientX};
    document.addEventListener('mouseup',async e=>{
      if(!drag)return;drag=false;
      const check=await(await fetch('/api/captcha/check',{method:'POST',body:JSON.stringify({distance:e.clientX-dragX})})).json();
      if(check.data.repCode!=='0000')return;
      setTimeout(async()=>{
        document.querySelector('.verifybox').style.display='none';
        await fetch('/api/reservation/order/submit',{method:'POST'});
        window.open('/venue/venue-reservation/99','_blank');
      },500);
    });load();</script>`;
  try {
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.pathname==='/venue/venue-reservation/1'){venueLoads++;await route.fulfill({contentType:'text/html; charset=utf-8',body:html});}
      else if(url.pathname.includes('/api/protocols/code/')){protocolLoads++;await delay(180);await route.fulfill({json:{data:{autoPopup:true,staySec:8,noAllowClose:false}}});}
      else if(url.pathname.endsWith('/api/reservation/day/info')){
        dateRequests.push({date:url.searchParams.get('searchDate'),afterRelease:released});await delay(60);await route.fulfill({json:{days:released?3:2}});
      } else if(url.pathname.endsWith('/api/captcha/check')){
        captchaChecks++;const distance=JSON.parse(route.request().postData()).distance;await delay(70);await route.fulfill({json:{data:{repCode:Math.abs(distance-121)<3?'0000':'9999'}}});
      } else if(url.pathname.endsWith('/api/reservation/order/submit')){submits++;await delay(120);await route.fulfill({json:{code:200,data:{tradeNo:'D900'}}});}
      else if(url.pathname==='/venue/venue-reservation/99')await route.fulfill({contentType:'text/html; charset=utf-8',body:'<meta charset="utf-8">Welcome! 测试用户<br>羽毛球馆 2026年11月07日<br>No.1：12:00-13:00<br>Please pay： ¥0 CNY<div onclick="window.payClicks=(window.payClicks||0)+1">Pay （599s）</div>'});
      else await route.abort();
    });
    const page=await context.newPage(),events=[];
    let releaseStart;
    const log=(event,details={})=>events.push({event,...details,elapsedMs:releaseStart===undefined?null:Math.round(performance.now()-releaseStart)});
    await prewarmVenue(page,target,{log});
    assert.equal(await page.locator('.ivu-modal').isVisible(),false);
    assert.ok(!dateRequests.some(request=>request.date===target.date));
    const beforeMissing=performance.now();
    await assert.rejects(()=>prepareSelection(page,target),error=>error.code==='DATE_NOT_OPEN');
    assert.ok(performance.now()-beforeMissing<250,'a missing date must not stall for three seconds');
    released=true;releaseStart=performance.now();
    const queriesBeforeDelay=dateRequests.length;
    await waitForBookingStart({releaseAt:Date.now(),delayMs:2000,log});
    assert.ok(performance.now()-releaseStart>=1999,'selection must not begin before the configured two-second delay');
    assert.equal(dateRequests.length,queriesBeforeDelay,'the delay must not send venue queries or create orders');
    await refreshAvailability(page,target,{log});
    await prepareSelection(page,target,{log});log('selection_verified');
    const created=await createOrder(page,target,{log,captchaRecovery});
    assert.equal(created.number,'D900');
    await waitForPaymentReady(created.popup,target,log);
    assert.equal(await created.popup.evaluate(()=>window.payClicks||0),0);
    await assert.rejects(()=>inspectAndPay(created.popup,{target,order:{number:'D900'}}),/未获启用/);
    assert.equal(await created.popup.evaluate(()=>window.payClicks||0),0);
    assert.equal(venueLoads,1);assert.equal(protocolLoads,1);assert.equal(submits,1);assert.equal(captchaChecks,1);
    assert.equal(events.filter(event=>event.event==='booking_started').length,1);
    const wait=events.find(event=>event.event==='captcha_recovery_wait');
    assert.equal(!!wait,captchaRecovery);
    if(wait){assert.equal(wait.waitMs,600);assert.ok(events.find(e=>e.event==='captcha_matched').elapsedMs-wait.elapsedMs>=590);}
    assert.ok(dateRequests.every(request=>request.date!==target.date||request.afterRelease));
    const record={scope:'Isolated browser fixture; synthetic CAPTCHA and explicitly mocked network, not live booking speed',payClicked:false,releaseToPayVisibleMs:events.find(event=>event.event==='pay_visible').elapsedMs,releaseToPayReadyMs:events.find(event=>event.event==='pay_ready').elapsedMs,events};
    await fs.mkdir('artifacts/optimization-20261105',{recursive:true});
    await fs.writeFile(`artifacts/optimization-20261105/fixture-release-${captchaRecovery?'recovery':'result'}.json`,JSON.stringify(record,null,2)+'\n');
    t.diagnostic(JSON.stringify({fixtureReleaseToPayVisibleMs:record.releaseToPayVisibleMs,fixtureReleaseToPayReadyMs:record.releaseToPayReadyMs,payClicked:false}));
  } finally {await browser.close();}
});
