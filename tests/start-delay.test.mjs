import test from 'node:test';
import assert from 'node:assert/strict';
import {bookingDelayMs,waitForBookingStart} from '../lib/start-delay.mjs';

function clock(start) {
  let now=start,stop=false;const events=[],waits=[];
  return {events,waits,now:()=>now,monotonic:()=>now,stopped:()=>stop,stop:()=>{stop=true;},wait:async ms=>{assert.ok(ms>0&&ms<=200);waits.push(ms);now+=ms;},log:(event,details)=>events.push({event,...details})};
}
test('configured delay defaults to 2000 ms and rejects invalid values instead of silently disabling the wait',()=>{
  assert.equal(bookingDelayMs({}),2000);assert.equal(bookingDelayMs({bookingDelayMs:0}),0);
  for(const value of [-1,NaN,Infinity,30001,0.5,'2000'])assert.throws(()=>bookingDelayMs({bookingDelayMs:value}),/延迟/);
});
test('scheduled selection begins at release plus two seconds, and a late preheat does not add another two seconds',async()=>{
  const release=Date.parse('2026-11-09T08:00:00+08:00');
  for(const lateness of [0,3,800,2500]){
    const c=clock(release+lateness);
    const result=await waitForBookingStart({...c,releaseAt:release,delayMs:2000});
    assert.equal(c.now(),Math.max(release+2000,release+lateness));
    assert.equal(result.waitMs,Math.max(0,2000-lateness));
    assert.equal(result.clockLatenessMs,Math.max(0,lateness-2000));
    assert.equal(c.events.filter(e=>e.event==='booking_started').length,1);
  }
});
test('immediate mode adds exactly two seconds after page preparation; zero delay starts immediately',async()=>{
  for(const delayMs of [0,2000]){const c=clock(10000);await waitForBookingStart({...c,delayMs});assert.equal(c.now(),10000+delayMs);}
});
test('stopping during the extra delay never emits permission to begin selection',async()=>{
  const c=clock(10000),wait=async ms=>{await c.wait(ms);c.stop();};
  await assert.rejects(()=>waitForBookingStart({...c,wait,delayMs:2000}),/停止/);
  assert.equal(c.events.some(e=>e.event==='booking_started'),false);
  assert.equal(c.now(),10200);
});
