import test from 'node:test';
import assert from 'node:assert/strict';
import {assertNotRateLimited} from '../lib/polling.mjs';
import {parseVenueCatalog,parseVenueDay} from '../lib/venue-data.mjs';

test('rate limits are classified from HTTP, business envelopes and bilingual messages without treating no availability as a rate limit',()=>{
  for(const [body,httpStatus] of [[null,429],[{code:429},200],[{code:250,message:'访问频繁，限制访问中...'},200],[{messageEn:'Too many requests'},200]]){
    assert.throws(()=>assertNotRateLimited(body,httpStatus),e=>e.code==='RATE_LIMITED');
  }
  assert.doesNotThrow(()=>assertNotRateLimited({code:200,message:'所有场次均不可预约'}));
  assert.throws(()=>parseVenueCatalog({code:250,message:'访问频繁，限制访问中...'}),e=>e.code==='RATE_LIMITED');
  assert.throws(()=>parseVenueDay({code:250,message:'访问频繁，限制访问中...'}),e=>e.code==='RATE_LIMITED');
});
