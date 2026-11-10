import {browserOptions} from '../lib/platform.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {venueInfo,courtLabelPattern,matchesSession,matchesVenue} from '../lib/venues.mjs';
import {validateTarget,decideExistingCandidates,candidateTargets} from '../lib/safety.mjs';
import {validatePaymentText} from '../lib/payment.mjs';
import {openVenue,prewarmVenue,prepareSelection,refreshAvailability} from '../lib/booking.mjs';

const config={origin:'https://hzsm.buaa.edu.cn',venueId:346,accountName:'测试用户',maxAmount:0,schoolAutomationPermissionConfirmed:true};
const target={...config,date:'2026-11-11',court:'No.9',slot:'19:00-20:00'};
test('only verified badminton venues and their own court ranges are accepted',()=>{
  assert.equal(venueInfo(346).courtCount,9);assert.equal(venueInfo(1).courtCount,4);
  assert.equal(validateTarget(target,target.date,new Date('2026-11-09T08:00:00+08:00')).court,'No.9');
  for(const changed of [{venueId:999},{venueMode:'fixed',venueId:1,court:'No.9'},{court:'No.10'},{maxAmount:1}])assert.throws(()=>validateTarget({...target,...changed},target.date,new Date('2026-11-09T08:00:00+08:00')));
});
test('mixed live court suffixes identify full numbers without conflating No.1 and No.10',()=>{
  for(const label of ['No.9','No.9（Basketball Hall）','No.9（Badminton Training Hall）','No.9 (篮球馆)']) {
    assert.ok(courtLabelPattern('No.9').test(label));
    assert.ok(matchesSession(`${label}：19:00-20:00 ￥0`,target));
    assert.ok(matchesSession(`${label} 19:00-20:00`,target));
  }
  for(const label of ['No.90','No.9（Swimming Pool）','No.9 additional court'])assert.equal(courtLabelPattern('No.9').test(label),false);
  assert.equal(courtLabelPattern('No.1').test('No.10'),false);
  assert.equal(matchesSession('No.9：19:00-20:00\nNo.8：19:00-20:00',target),false);
});
test('new-hall payment validates the venue independently of the leftover training-hall court suffix',()=>{
  const text='测试用户\nBadminton Gymnasium（Basketball Hall） 2026年11月11日\nNo.9（Badminton Training Hall）：19:00-20:00\nPlease pay：¥0 CNY';
  assert.equal(validatePaymentText(text,target).court,'No.9');
  for(const changed of [text.replace('Gymnasium（Basketball Hall）','Gymnasium（Badminton Training Hall）'),text.replace('No.9','No.1'),text.replace('¥0','¥1'),text+'\nNo.8：19:00-20:00',text+'\nBadminton Gymnasium（Badminton Training Hall）'])assert.throws(()=>validatePaymentText(changed,target));
  assert.equal(matchesVenue('Basketball Hall',target),false);
});
test('existing new-hall ninth-court orders resume and old-hall orders prevent a duplicate booking',()=>{
  const candidates=candidateTargets({...config,candidates:[{slot:target.slot,courts:venueInfo(346).courts}]},target.date,new Date('2026-11-09T08:00:00+08:00'));
  const order={number:'D900',venue:'Sports and Fitness VenuesBadminton Gymnasium（Basketball Hall）',date:target.date,session:'No.9（Badminton Training Hall） 19:00-20:00',payment:'Unpaid',status:'Normal',amount:'0CNY'};
  assert.equal(decideExistingCandidates([order],candidates).action,'resume');
  assert.equal(decideExistingCandidates([order],candidates).target.court,'No.9');
  assert.equal(decideExistingCandidates([{...order,payment:'Paid'}],candidates).action,'done');
  assert.throws(()=>decideExistingCandidates([{...order,venue:'Badminton Gymnasium（Badminton Training Hall）'}],candidates),/已有/);
});

function gridFixture({emptyToday=false,emptyTarget=false,moved=false,duplicate=false}={}) {
  return `<meta charset="utf-8">测试用户 Badminton Gymnasium（Basketball Hall）
    <div class="date_box"><div class="active"><span>11/09</span></div><div><span>11/11</span></div></div>
    <div class="spaceTable"><table><thead><tr><td>Venue</td><td>19:00-20:00</td></tr></thead><tbody></tbody></table></div>
    <table class="fixed-column"><thead><tr><td>Venue</td></tr></thead><tbody><tr><td>No.9（Badminton Training Hall）</td></tr></tbody></table>
    <label class="text-left"><input type="checkbox"></label><input placeholder="请输入手机号" value="13000000000">
    <div id="selection"></div><div class="action"><p><b>0.00</b></p></div>
    <script>
    let today=true;window.clicks=0;
    function render(){
      const empty=today?${emptyToday}:${emptyTarget};
      const numbers=${duplicate?'[9,9]':'[1,2,3,4,5,6,7,8,9]'};
      document.querySelector('tbody').innerHTML=empty?'':numbers.map(n=>'<tr><td>No.'+n+'（'+(n<=5?'Basketball Hall':'Badminton Training Hall')+'）</td><td><div class="reserveBlock '+(${moved}?'disabled':n===9?'free':'reserved')+'" data-court="'+n+'">'+(${moved}?'场地移至篮球馆请选择篮球馆场地':n===9?'￥0':'Sold out')+'</div></td></tr>').join('');
      document.querySelectorAll('.reserveBlock').forEach(block=>block.onclick=()=>{window.clicks++;document.querySelector('#selection').innerHTML='<div class="reserve-msg-row">No.'+block.dataset.court+'（Badminton Training Hall）：19:00-20:00 ￥0</div>';});
    }
    document.querySelectorAll('.date_box>div').forEach((el,index)=>el.onclick=async()=>{today=index===0;document.querySelectorAll('.date_box>div').forEach(d=>d.className='');el.className='active';document.querySelector('tbody').innerHTML='';await fetch('/api/reservation/day/info');render();});render();
    </script>`;
}
async function browserFixture(options,fn) {
  const browser=await chromium.launch({...browserOptions(),headless:true});
  try {
    const page=await browser.newPage();let writes=0;
    await page.route('**/*',route=>{if(route.request().method()!=='GET')writes++;return route.fulfill(new URL(route.request().url()).pathname.endsWith('/api/reservation/day/info')?{json:{code:200}}:{contentType:'text/html; charset=utf-8',body:gridFixture(options)});});
    await page.goto(config.origin+'/venue/venue-reservation/346');await fn(page);assert.equal(writes,0);
  } finally {await browser.close();}
}
test('new-hall preheat accepts an empty day and ignores the frozen-column table when selecting court nine',async()=>{
  await browserFixture({emptyToday:true},async page=>{
    await prewarmVenue(page,target);
    assert.equal(await page.locator('.reserveBlock').count(),0);
    assert.equal(await page.locator('table:visible').count(),2);
    const selected=await prepareSelection(page,target);
    assert.equal(selected.court,'No.9');assert.equal(await page.evaluate(()=>window.clicks),1);
  });
});
test('all nine candidates can be checked and a missing court safely advances to an existing fallback',async()=>{
  await browserFixture({},async page=>{
    for(let n=1;n<=8;n++)await assert.rejects(()=>prepareSelection(page,{...target,court:`No.${n}`}),e=>e.code==='UNAVAILABLE');
    await page.locator('tbody tr').first().evaluate(row=>row.remove());
    await assert.rejects(()=>prepareSelection(page,{...target,court:'No.1'}),e=>e.code==='UNAVAILABLE');
    assert.equal((await prepareSelection(page,target)).court,'No.9');
    assert.equal(await page.evaluate(()=>window.clicks),1);
  });
});
test('migration notices and duplicate court rows stop before any court is clicked',async()=>{
  await browserFixture({moved:true},async page=>{await assert.rejects(()=>prepareSelection(page,target),e=>e.code==='VENUE_MOVED');assert.equal(await page.evaluate(()=>window.clicks),0);});
  await browserFixture({duplicate:true},async page=>{await assert.rejects(()=>prepareSelection(page,target),/匹配到多行/);assert.equal(await page.evaluate(()=>window.clicks),0);});
});
test('empty target schedules refresh without waiting for a nonexistent cell, and a wrong venue title is rejected',async()=>{
  await browserFixture({emptyToday:true,emptyTarget:true},async page=>{
    await refreshAvailability(page,target);
    await assert.rejects(()=>prepareSelection(page,target),e=>e.code==='DATE_EMPTY');
    assert.equal(await page.evaluate(()=>window.clicks),0);
  });
  await browserFixture({},async page=>{
    await page.route('**/venue/venue-reservation/346',route=>route.fulfill({contentType:'text/html',body:gridFixture().replace('Badminton Gymnasium（Basketball Hall）','Badminton Gymnasium（Badminton Training Hall）')}));
    await assert.rejects(()=>openVenue(page,target),/场馆名称/);
  });
});
