import test from 'node:test';
import assert from 'node:assert/strict';
import {pollingBaseMs,pollingDelayMs,catalogRefreshIntervalMs,assertNotRateLimited} from '../lib/polling.mjs';
import {parseVenueCatalog,parseVenueDay} from '../lib/venue-data.mjs';

test('empty rounds back off and old 500 ms configurations cannot retain the aggressive loop',()=>{
  assert.equal(pollingBaseMs({releasePollIntervalMs:500}),1000);
  assert.deepEqual(Array.from({length:7},(_,i)=>pollingDelayMs({},i)),[1000,2000,4000,8000,8000,8000,8000]);
  let elapsed=0,rounds=1;
  for(let round=0;;round++){
    elapsed+=pollingDelayMs({},round);if(elapsed>34000)break;rounds++;
  }
  assert.equal(rounds,7);assert.equal(catalogRefreshIntervalMs,15000);
  assert.ok(rounds*2+Math.ceil(34000/catalogRefreshIntervalMs)<20,'even the two-request day-switch fallback stays below 20 reads in this 34-second simulation');
});

test('rate limits are classified from HTTP, business envelopes and bilingual messages without treating no availability as a rate limit',()=>{
  for(const [body,httpStatus] of [[null,429],[{code:429},200],[{code:250,message:'访问频繁，限制访问中...'},200],[{messageEn:'Too many requests'},200]]){
    assert.throws(()=>assertNotRateLimited(body,httpStatus),e=>e.code==='RATE_LIMITED');
  }
  assert.doesNotThrow(()=>assertNotRateLimited({code:200,message:'所有场次均不可预约'}));
  assert.throws(()=>parseVenueCatalog({code:250,message:'访问频繁，限制访问中...'}),e=>e.code==='RATE_LIMITED');
  assert.throws(()=>parseVenueDay({code:250,message:'访问频繁，限制访问中...'}),e=>e.code==='RATE_LIMITED');
});
