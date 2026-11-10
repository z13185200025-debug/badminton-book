import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {browserOptions} from '../lib/platform.mjs';
import {settleVenueDialogs} from '../lib/venue-dialogs.mjs';

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
