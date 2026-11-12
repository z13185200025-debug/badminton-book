import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {browserOptions} from '../lib/platform.mjs';
import {settleVenueDialogs} from '../lib/venue-dialogs.mjs';
import {refreshAvailability} from '../lib/booking.mjs';

async function withPage(fn){const browser=await chromium.launch({...browserOptions(),headless:true});try{const page=await browser.newPage();page.setDefaultTimeout(1200);await fn(page);}finally{await browser.close();}}
test('overlapping system and notice dialogs are handled from the top layer without clicking through overlays',async()=>{
 await withPage(async page=>{
  await page.setContent(`<style>.ivu-modal-wrap{position:fixed;inset:0;background:white}.ivu-modal{padding:30px}</style>
  <div class="ivu-modal-wrap" style="z-index:100"><div class="ivu-modal">Reservation Instructions <button onclick="window.closes=(window.closes||[]).concat('notice');this.parentElement.parentElement.remove()">Close</button></div></div>
  <div class="ivu-modal-wrap" style="z-index:101"><div class="ivu-modal">System prompt 当日8点以后才能查看当天的预约 <button onclick="window.closes=(window.closes||[]).concat('gate');this.parentElement.parentElement.remove()">OK</button></div></div>`);
  const result=await settleVenueDialogs(page,{allowDeferred:true,timeoutMs:1800});
  assert.equal(result.deferred,true);assert.deepEqual(await page.evaluate(()=>window.closes),['gate','notice']);
 });
});
test('a notice mentioning opening after 08:00 is read normally and honors its disabled close countdown',async()=>{
 await withPage(async page=>{
  await page.setContent(`<div class="ivu-modal">Reservation Instructions: reservations open after 08:00. <button disabled onclick="this.parentElement.remove()">Close</button></div>`);
  await page.evaluate(()=>setTimeout(()=>document.querySelector('button').disabled=false,150));
  assert.equal((await settleVenueDialogs(page,{allowDeferred:true,timeoutMs:1800})).deferred,false);
 });
});

test('a rate-limit dialog remains visible and stops immediately without clicking OK or issuing requests',async()=>{
 await withPage(async page=>{
  await page.setContent('<div class="ivu-modal">System prompt 访问频繁，限制访问中... <button onclick="window.acknowledged=true">OK</button></div>');
  let requests=0;page.on('request',()=>requests++);
  await assert.rejects(()=>settleVenueDialogs(page,{allowDeferred:true}),e=>e.code==='RATE_LIMITED');
  assert.equal(await page.evaluate(()=>!!window.acknowledged),false);assert.equal(requests,0);
  assert.equal(await page.locator('.ivu-modal').isVisible(),true);
 });
});

test('refresh selects an already exposed target date directly instead of querying another day first',async()=>{
 await withPage(async page=>{
  const dates=[];
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname.endsWith('/api/reservation/day/info')){dates.push(url.searchParams.get('searchDate'));return route.fulfill({json:{fixture:true}});}
   return route.fulfill({contentType:'text/html',body:`<div class="date_box"><div class="active"><span>11/12</span></div><div id="target"><span>11/14</span></div></div><div class="spaceTable"><table><tbody><tr><td>No.1</td><td>fixture</td></tr></tbody></table></div><script>document.querySelector('#target').onclick=async()=>{document.querySelector('.active').classList.remove('active');document.querySelector('#target').classList.add('active');await fetch('/venue-server/api/reservation/day/info?searchDate=2026-11-14');};</script>`});
  });
  await page.goto('https://hzsm.buaa.edu.cn/fixture');
  await refreshAvailability(page,{date:'2026-11-14'});
  assert.deepEqual(dates,['2026-11-14']);
  assert.match(await page.locator('#target').getAttribute('class'),/active/);
 });
});
