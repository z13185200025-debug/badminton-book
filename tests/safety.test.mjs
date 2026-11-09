import test from 'node:test';
import assert from 'node:assert/strict';
import {assertZero,decideExisting,shanghaiDate,validateTarget,candidateTargets,decideExistingCandidates,nextRelease} from '../lib/safety.mjs';
const target={date:'2026-11-07',court:'No.1',slot:'12:00-13:00'};
const order={number:'D123',date:target.date,venue:'Badminton Gymnasium',session:'No.1 12:00-13:00',payment:'Unpaid',status:'Normal',amount:'0CNY'};
test('zero-only confirmation rejects ambiguous and positive amounts',()=>{
  for(const good of ['¥0','￥0.00','0CNY']) assert.equal(assertZero(good),0);
  for(const bad of ['','¥0.01','Free','-0.01','0 or 10','0CNY/unknown']) assert.throws(()=>assertZero(bad));
});
test('retries resume or skip exact order and never create a duplicate',()=>{
  assert.equal(decideExisting([order],target).action,'resume');
  assert.equal(decideExisting([{...order,payment:'Paid'}],target).action,'done');
  assert.equal(decideExisting([{...order,status:'Cancelled'}],target).action,'create');
  assert.throws(()=>decideExisting([{...order,session:'No.2 12:00-13:00'}],target));
  assert.throws(()=>decideExisting([order,{...order,number:'D124'}],target));
  assert.throws(()=>decideExisting([{...order,payment:'Unknown'}],target));
  assert.throws(()=>decideExisting([{...order,payment:'Paid',status:'Unknown'}],target));
});
test('Shanghai release dates cross UTC midnight and year boundary correctly',()=>{
  assert.equal(shanghaiDate(new Date('2026-11-05T16:01:00Z'),2),'2026-11-08');
  assert.equal(shanghaiDate(new Date('2026-12-31T00:00:00Z'),2),'2027-01-02');
});
test('target enforces one court-hour and the current booking window',()=>{
  const config={origin:'https://hzsm.buaa.edu.cn',venueId:1,maxAmount:0,court:'No.1',slot:'12:00-13:00',schoolAutomationPermissionConfirmed:true};
  const now=new Date('2026-11-05T02:00:00Z');
  assert.equal(validateTarget(config,'2026-11-07',now).date,'2026-11-07');
  assert.throws(()=>validateTarget(config,'2026-11-08',now));
  assert.throws(()=>validateTarget({...config,slot:'12:00-14:00'},'2026-11-07',now));
});
test('candidate times and court priorities are ordered and already-booked fallbacks are recognized',()=>{
  const config={origin:'https://hzsm.buaa.edu.cn',venueId:1,maxAmount:0,schoolAutomationPermissionConfirmed:true,candidates:[{slot:'12:00-13:00',courts:['No.1','No.2']},{slot:'18:00-19:00',courts:['No.4']}]};
  const choices=candidateTargets(config,'2026-11-07',new Date('2026-11-05T02:00:00Z'));
  assert.deepEqual(choices.map(c=>`${c.court}/${c.slot}`),['No.1/12:00-13:00','No.2/12:00-13:00','No.4/18:00-19:00']);
  const result=decideExistingCandidates([{...order,session:'No.2 12:00-13:00',payment:'Paid'}],choices);
  assert.equal(result.action,'done');assert.equal(result.target.court,'No.2');
});
test('an evening start aims at the next morning and books two days after release',()=>{
  const release=nextRelease(new Date('2026-11-05T13:00:00Z'));
  assert.equal(release.toISOString(),'2026-11-06T00:00:00.000Z');
  assert.equal(shanghaiDate(release,2),'2026-11-08');
  assert.equal(nextRelease(new Date('2026-11-06T00:01:00Z')).toISOString(),'2026-11-06T00:00:00.000Z');
  assert.equal(nextRelease(new Date('2026-11-06T00:03:00Z')).toISOString(),'2026-11-07T00:00:00.000Z');
});
