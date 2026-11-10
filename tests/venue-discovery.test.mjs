import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {browserOptions} from '../lib/platform.mjs';
import {parseVenueCatalog,parseVenueDay,validateVenueDay,validateVenueDetail,verifyScheduleCell,validateSubmissionPayload,courtNumber} from '../lib/venue-data.mjs';
import {createVenueRouter,existingVenueCandidates} from '../lib/venue-router.mjs';
import {prewarmVenue,refreshAvailability,prepareSelection,createOrder} from '../lib/booking.mjs';
import {settleVenueDialogs} from '../lib/venue-dialogs.mjs';
import {decideExistingCandidates} from '../lib/safety.mjs';
import {recordRunEvent} from '../lib/ui-telemetry.mjs';
import {venueState,refreshVenueCatalog} from '../lib/venue-evidence.mjs';

const origin='https://hzsm.buaa.edu.cn',date='2026-11-12';
const entry=(id=1,changes={})=>({id,venueId:1,siteName:`羽毛球馆（${id===346?'篮球场':'训练场'}）`,enSiteName:`Badminton Gymnasium（${id===346?'Basketball Hall':'Badminton Training Hall'}）`,sportType:156,sportName:'羽毛球',campusId:187,campusName:'北航国新院',isSupportReservation:1,notShowSite:0,spaceCount:id===346?9:4,advanceDay:2,reservationHour:8,reservationProtocolCode:'BADMINTON_PROTOCOL',...changes});
const catalog=(entries=[entry()])=>({code:200,data:{venueSiteInfo:{1:entries},advanceReservationDays:2}});
const target=(id=1,changes={})=>({origin,accountName:'测试用户',venueId:id,venueMode:'auto',date,court:'No.1',slot:'19:00-20:00',...changes});
const day=(id=1,dayDate=date,{status=1,changes={}}={})=>({code:200,data:{advanceReservationDays:2,isFee:0,notReserveType:null,isTakeUp:0,reservationDateList:[dayDate],siteParam:{venueSiteId:id,siteName:entry(id).siteName,reservationHour:8},spaceTimeInfo:[{id:500,beginTime:'19:00',endTime:'20:00'}],reservationDateSpaceInfo:{[dayDate]:[{id:id===346?76:1,venueSiteId:id,spaceName:`1号（${id===346?'篮球场':'训练场'}）`,enSpaceName:`No.1（${id===346?'Basketball Hall':'Badminton Training Hall'}）`,500:{reservationStatus:status,orderFee:null,startDate:dayDate+' 19:00',endDate:dayDate+' 20:00',takeUp:false,adminTake:false}}]},...changes}});
const parseDay=(body,id=1,requestDate=date)=>parseVenueDay(body,{requestId:id,requestDate});

test('catalog uses site id rather than parent venueId and excludes hidden, disabled, wrong sport and wrong campus entries',()=>{
  const parsed=parseVenueCatalog(catalog([entry(346),entry(2,{sportType:2}),entry(3,{campusId:188}),entry(4,{notShowSite:1}),entry(5,{isSupportReservation:0}),entry(6,{venueSiteId:9}),entry(7,{sportName:'篮球'}),entry(8,{disabled:1})]));
  assert.deepEqual(parsed.entries.map(e=>e.id),[346]);assert.equal(parsed.entries[0].parentVenueId,1);assert.equal(parsed.rejected.length,7);
  assert.throws(()=>parseVenueCatalog(catalog([entry(),entry()])),/重复/);
  assert.throws(()=>parseVenueCatalog({code:200}),/未完整/);
  assert.equal(parseVenueCatalog(catalog([])).entries.length,0);
  assert.equal(parseVenueCatalog(catalog([entry(999)])).entries[0].id,999,'new official badminton IDs are supported without a code patch');
});
test('details, schedule site IDs, bilingual names, dates, fees and availability must agree',()=>{
  const t=target(1,{venueEvidence:parseVenueCatalog(catalog()).entries[0]});
  assert.equal(validateVenueDetail({code:200,data:entry()},t).id,1);
  assert.throws(()=>validateVenueDetail({code:200,data:entry(346)},t),/不符/);
  assert.throws(()=>validateVenueDetail({code:200,data:entry(1,{reservationProtocolCode:'OTHER'})},t),/不一致/);
  const d=parseDay(day());assert.equal(verifyScheduleCell(d,t).spaceId,1);
  for(const mutate of [x=>x.id=346,x=>x.requestId=346,x=>x.rows[0].siteId=346,x=>x.name='游泳馆',x=>x.requestDate='2026-11-11',x=>x.rows[0].cells[0].start='2026-11-11 19:00',x=>x.rows[0].cells[0].fee=1]){
    const changed=structuredClone(d);mutate(changed);assert.throws(()=>verifyScheduleCell(changed,t));
  }
  for(const mutate of [x=>x.rows[0].cells[0].status=4,x=>x.rows[0].cells[0].blocked=true]){const changed=structuredClone(d);mutate(changed);assert.throws(()=>verifyScheduleCell(changed,t),e=>e.code==='UNAVAILABLE');}
  const occupied=parseDay(day(1,date,{changes:{isTakeUp:1}}));validateVenueDay(occupied,t);assert.throws(()=>verifyScheduleCell(occupied,t),e=>e.code==='VENUE_UNAVAILABLE');
  const wrongNames=day();wrongNames.data.reservationDateSpaceInfo[date][0].enSpaceName='No.2';assert.throws(()=>parseDay(wrongNames),/中英文场号/);
  for(const [label,n] of [['No.1（Training Hall）',1],['No.10',10],['1号（训练场）',1],['第9号场地',9]])assert.equal(courtNumber(label),n);
});
test('submission validates route site ID, real space/time IDs, date and exactly one zero-cost session',()=>{
  const t=target(346,{scheduleCell:verifyScheduleCell(parseDay(day(346),346),target(346))});
  assert.equal(t.scheduleCell.spaceId,76,'court number one is not spaceId one');
  const body={venueSiteId:'346',reservationDate:date,reservationOrderJson:JSON.stringify([{spaceId:'76',timeId:'500'}]),totalAmt:0,orderPrice:null};
  assert.ok(validateSubmissionPayload(body,t));
  for(const changed of [{venueSiteId:1},{reservationDate:'2026-11-11'},{reservationOrderJson:'[]'},{reservationOrderJson:'[{"spaceId":1,"timeId":500}]'},{reservationOrderJson:'[{"spaceId":76,"timeId":501}]'},{reservationOrderJson:'[{"spaceId":76,"timeId":500},{"spaceId":77,"timeId":500}]'},{orderPrice:1},{reservationOrderJson:'broken'}])assert.throws(()=>validateSubmissionPayload({...body,...changed},t));
});
test('existing orders in either historical hall are reconciled before a fresh venue is selected',()=>{
  const candidates=existingVenueCandidates([target(1)]);
  const order={number:'D123',date,venue:entry(346).enSiteName,session:'No.1（Basketball Hall） 19:00-20:00',amount:'0',payment:'Paid',status:'Normal'};
  assert.equal(decideExistingCandidates([order],candidates).action,'done');
  assert.equal(decideExistingCandidates([order],candidates).target.venueId,346);
  assert.throws(()=>decideExistingCandidates([{...order,session:'No.2 20:00-21:00'}],candidates),/已有/);
});

function html(id){return `<meta charset="utf-8">测试用户 ${entry(id).enSiteName}
<div class="date_box"></div><button id="refresh"><i class="ivu-icon-md-refresh"></i></button>
<div class="spaceTable"><table><thead><tr><td>Court</td><td>19:00-20:00</td></tr></thead><tbody></tbody></table></div>
<label class="text-left"><input type="checkbox"></label><input placeholder="请输入手机号" value="13000000000"><div id="selected"></div><div class="action"><p><b>0</b></p><button class="btn">Submit</button></div>
<div id="notice" class="ivu-modal" style="display:none">Reservation Instructions <button disabled>Close</button></div><div id="gate" class="ivu-modal" style="display:none">System prompt 当日8点以后才能查看当天的预约 <button>OK</button></div>
<script>
let day='2026-11-10';window.clicks=0;
const load=async()=>{const r=await (await fetch('/venue-server/api/reservation/day/info?venueSiteId=${id}&searchDate='+day)).json();document.querySelector('.date_box').innerHTML=['2026-11-10','${date}'].map(d=>'<div class="'+(d===day?'active':'')+'" data-date="'+d+'"><span>'+d.slice(5).replace('-','/')+'</span></div>').join('');document.querySelectorAll('.date_box>div').forEach(e=>e.onclick=()=>{day=e.dataset.date;load()});if(r.code!==200){document.querySelector('#gate').style.display='block';return;}document.querySelector('tbody').innerHTML='<tr><td>1号（${id===346?'篮球场':'训练场'}）</td><td><div class="reserveBlock free">¥0</div></td></tr>';document.querySelector('.reserveBlock').onclick=()=>{window.clicks++;document.querySelector('#selected').innerHTML='<div class="reserve-msg-row">1号（${id===346?'篮球场':'训练场'}）：19:00-20:00</div>';};};
fetch('/venue-server/api/front/website/venue_sites/${id}');fetch('/venue-server/api/reservation/campus/venue/info?sportType=156');
fetch('/venue-server/api/protocols/code/BADMINTON_PROTOCOL').then(()=>{const n=document.querySelector('#notice');n.style.display='block';setTimeout(()=>n.querySelector('button').disabled=false,75);});
document.querySelector('#notice button').onclick=()=>document.querySelector('#notice').style.display='none';document.querySelector('#gate button').onclick=()=>document.querySelector('#gate').style.display='none';document.querySelector('#refresh').onclick=load;
document.querySelector('.action .btn').onclick=()=>fetch('/venue-server/api/reservation/order/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({venueSiteId:346,reservationDate:'${date}',reservationOrderJson:'[{"spaceId":76,"timeId":500}]'})});load();
</script>`;}
async function fixture(fn){
 const browser=await chromium.launch({...browserOptions(),headless:true});
 try{
  const context=await browser.newContext();const state={entries:[entry()],gate:false,requests:[],writes:0};
  await context.route('**/*',async route=>{
   const r=route.request(),u=new URL(r.url());state.requests.push(u.pathname+u.search);
   if(r.method()!=='GET'){state.writes++;return route.fulfill({json:{code:200,data:{tradeNo:'D999'}}});}
   if(u.pathname.includes('/campus/venue/info'))return route.fulfill({json:catalog(state.entries)});
   if(u.pathname.includes('/front/website/venue_sites/'))return route.fulfill({json:{code:200,data:entry(Number(u.pathname.split('/').at(-1)))}});
   if(u.pathname.includes('/day/info'))return route.fulfill({json:state.gate?{code:400,message:'当日8点以后才能查看当天的预约'}:day(Number(u.searchParams.get('venueSiteId')),u.searchParams.get('searchDate'))});
   if(u.pathname.includes('/protocols/'))return route.fulfill({json:{code:200}});
   if(u.pathname.startsWith('/venue/venue-reservation/'))return route.fulfill({contentType:'text/html; charset=utf-8',body:html(Number(u.pathname.split('/').at(-1)))});
   return route.abort();
  });
  const page=await context.newPage();await fn(page,state);assert.equal(state.writes,0,'no order or other server write is allowed');
 }finally{await browser.close();}
}
test('automatic routing handles basketball to training, the reverse, both active and a newly assigned official ID',async()=>{
 await fixture(async(page,state)=>{
  state.entries=[entry(346)];const events=[];
  const router=await createVenueRouter(page,[target(1),target(1,{court:'No.9'})],{log:(event,details)=>events.push({event,...details})});
  assert.deepEqual(router.targets.map(t=>[t.venueId,t.court]),[[346,'No.1'],[346,'No.9']]);
  state.entries=[entry(1)];await router.refresh({force:true});assert.deepEqual(router.targets.map(t=>[t.venueId,t.court]),[[1,'No.1']]);
  await prepareSelection(await router.pageFor(router.targets[0]),router.targets[0]);
  assert.equal(router.targets[0].scheduleCell.spaceId,1);
  state.entries=[entry(346)];await router.refresh({force:true});assert.equal(router.targets[0].venueId,346);
  state.entries=[entry(346),entry(1)];await router.refresh({force:true});assert.deepEqual(router.targets.map(t=>t.venueId),[1,346,346]);
  state.entries=[entry(999)];await router.refresh({force:true});assert.equal(router.targets[0].venueId,999);
  state.entries=[];await router.refresh({force:true});assert.equal(router.targets.length,0);
  assert.ok(events.some(e=>e.event==='venue_catalog_checked'&&e.eligible[0]?.id===1));
 });
});
test('stale zero-price basketball page is never eligible when only training appears in official catalog',async()=>{
 await fixture(async(page,state)=>{
  state.entries=[entry(1)];const router=await createVenueRouter(page,[target(346)]);
  assert.deepEqual(router.targets.map(t=>t.venueId),[1]);assert.equal(await page.evaluate(()=>window.clicks),0);
  await assert.rejects(()=>router.pageFor(target(346)),e=>e.code==='VENUE_CHANGED');
 });
});
test('catalog refresh uses the school request helper instead of replaying an expired signature',async()=>{
 await fixture(async page=>{
  await createVenueRouter(page,[target()]);
  venueState(page).catalogRequest.headers.sign='expired-test-signature';
  await assert.rejects(()=>refreshVenueCatalog(page),/请求组件已变化/);
  await page.locator('body').evaluate(body=>{body.__vue__={commonMethods:{emitAjax:async options=>{window.helperCalls=(window.helperCalls||0)+1;const r=await fetch('/venue-server/api/reservation/campus/venue/info?sportType=156');options.success((await r.json()).data);}}};});
  assert.equal((await refreshVenueCatalog(page)).entries[0].id,1);
  assert.equal(await page.evaluate(()=>window.helperCalls),1);
 });
});
test('scheduled preheat warms both known halls without making inactive routes eligible or rereading their notice at release',async()=>{
 await fixture(async(page,state)=>{
  state.entries=[entry(1)];const router=await createVenueRouter(page,[target()],{warmAlternates:true});
  assert.deepEqual(router.targets.map(t=>t.venueId),[1]);
  assert.ok(state.requests.includes('/venue/venue-reservation/346'));
  assert.ok(!state.requests.some(p=>p.includes('searchDate='+date)));
  const loads=state.requests.filter(p=>p.startsWith('/venue/venue-reservation/')).length;
  state.entries=[entry(346)];await router.refresh({force:true});
  assert.deepEqual(router.targets.map(t=>t.venueId),[346]);
  assert.equal(state.requests.filter(p=>p.startsWith('/venue/venue-reservation/')).length,loads,'already-read notice must not be opened again');
  assert.equal(await (await router.pageFor(router.targets[0])).evaluate(()=>window.clicks),0);
 });
});
test('08:00 system prompt is a deferred preheat, then refreshed schedule can be selected after release',async()=>{
 await fixture(async(page,state)=>{
  state.gate=true;const events=[];await prewarmVenue(page,target(),{log:(event,details)=>events.push({event,...details})});
  assert.equal(await page.locator('input[type=checkbox]').isChecked(),false);
  assert.equal(await page.locator('.ivu-modal:visible').count(),0);
  assert.ok(events.some(e=>e.event==='preheat_deferred'));
  assert.ok(!state.requests.some(u=>u.includes('searchDate='+date)));
  state.gate=false;await refreshAvailability(page,target());
  const t=target(1,{venueEvidence:parseVenueCatalog(catalog()).entries[0]});await prepareSelection(page,t);
  assert.equal(t.scheduleCell.spaceId,1);assert.equal(await page.evaluate(()=>window.clicks),1);
 });
});
test('unknown popup is not acknowledged and a mismatched POST is blocked before the network',async()=>{
 await fixture(async page=>{
  await prewarmVenue(page,target());
  await page.locator('body').evaluate(body=>{const d=document.createElement('div');d.className='ivu-modal';d.textContent='Unexpected policy change';body.append(d);});
  await assert.rejects(()=>settleVenueDialogs(page),e=>e.code==='VENUE_DIALOG_UNKNOWN');await page.locator('.ivu-modal').last().evaluate(el=>el.remove());
  const t=target(1,{venueEvidence:parseVenueCatalog(catalog()).entries[0],captchaTimeoutSeconds:1});await prepareSelection(page,t);
  await assert.rejects(()=>createOrder(page,t),e=>e.code==='VENUE_IDENTITY_CONFLICT');
 });
});
test('UI diagnostics expose verified venue and schedule identities without copying other response fields',()=>{
 const run={events:[]};recordRunEvent(run,{event:'venue_detected',venueId:1,venueName:'羽毛球馆（训练场）',parentVenueId:1,campusId:187,sportType:156,phone:'private',token:'private'});
 recordRunEvent(run,{event:'schedule_verified',venueId:1,spaceId:1,timeId:500,availableDates:[date],requestedDate:date,token:'private'});
 assert.equal(run.venueId,1);assert.equal(run.schedule.timeId,500);assert.ok(!JSON.stringify(run).includes('private'));
});
