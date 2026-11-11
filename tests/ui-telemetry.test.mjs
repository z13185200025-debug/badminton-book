import test from 'node:test';
import assert from 'node:assert/strict';
import {recordRunEvent} from '../lib/ui-telemetry.mjs';

test('technical state distinguishes intentional delay, local timing, server timestamp and fallback selection',()=>{
  const run={events:[]};let elapsed=0;
  const emit=(event,details={})=>recordRunEvent(run,{event,at:new Date(10000+elapsed).toISOString(),elapsedMs:elapsed,...details});
  emit('release_reached',{clockLatenessMs:3});elapsed=2000;emit('booking_started',{waitMs:1997,clockLatenessMs:0});
  emit('candidate_try',{court:'No.1',slot:'19:00-20:00',index:1,total:8});
  emit('candidate_unavailable');emit('candidate_try',{court:'No.2',slot:'18:00-19:00',index:6,total:8});
  elapsed=6044;emit('pay_ready');
  assert.equal(run.payReadyMs-run.releaseMs,6044);assert.equal(run.actualDelayMs,1997);
  assert.equal(run.candidateTries,2);assert.equal(run.candidate.index,6);assert.equal(run.slot,'18:00-19:00');
  emit('confirmed',{order:{number:'D900',createdAt:'2026-11-09 08:00:06',payment:'Paid',status:'Normal'}});emit('finished');
  assert.equal(run.resultStage,'confirmed');assert.equal(run.order.createdAt,'2026-11-09 08:00:06');assert.equal(run.message,'预约成功');
});
test('interface diagnostics retain safe latency and result fields, count failures, and omit payloads and tokens',()=>{
  const run={events:[]},emit=(event,details={})=>recordRunEvent(run,{event,at:'2026-11-09T00:00:00.000Z',elapsedMs:1,...details});
  emit('request_finished',{endpoint:'/venue-server/api/reservation/day/info',durationMs:1304,httpStatus:200,token:'secret-token',body:'private-body'});
  emit('request_failed',{endpoint:'/venue-server/api/reservation/day/info',durationMs:400});
  const request=run.requests['/api/reservation/day/info'];
  assert.equal(request.count,2);assert.equal(request.failures,1);assert.equal(request.durationMs,400);
  emit('captcha_matched',{attempt:1,matchMs:11.5,score:.92});emit('captcha_result',{repCode:'0000',token:'secret-token'});
  assert.equal(run.captcha.passed,true);assert.equal(run.captcha.attempts,1);
  assert.doesNotMatch(JSON.stringify(run),/secret-token|private-body/);
  for(let i=0;i<200;i++)emit('request_finished',{endpoint:'/venue-server/api/orders/mine',durationMs:50,httpStatus:200});
  assert.equal(run.events.length,80);
});

test('slider success is displayed separately from second-stage server rejection and recovery delay',()=>{
  const run={events:[]},emit=(event,details={})=>recordRunEvent(run,{event,at:'2026-11-11T00:00:00.000Z',elapsedMs:1,...details});
  emit('captcha_result',{repCode:'0000'});
  emit('order_submit_dispatched',{proofStatus:'matched',afterCheckMs:1002,clientHoldMs:498,token:'PRIVATE'});
  emit('captcha_order_rejected',{code:250});emit('captcha_submission_recovery',{attempt:1});
  assert.equal(run.captcha.passed,true);assert.equal(run.captcha.orderRejected,true);assert.equal(run.captcha.afterCheckMs,1002);assert.equal(run.captcha.recoveryAttempt,1);
  assert.doesNotMatch(JSON.stringify(run),/PRIVATE/);
  emit('captcha_detected');assert.equal(run.captcha.passed,false);assert.equal(run.captcha.code,undefined);
  assert.equal(run.captcha.proofStatus,undefined);assert.equal(run.captcha.orderRejected,undefined);
});
