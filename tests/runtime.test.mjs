import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {executionSchedule,configurationPath} from '../lib/runtime.mjs';
import {shanghaiDate,nextRelease} from '../lib/safety.mjs';
const config={releaseTime:'08:00:00',preheatTime:'07:55',releaseWindowSeconds:120};
test('one-time plan preheats five minutes before its explicit time and keeps the correct target day',()=>{
  const schedule=executionSchedule('at',['--at','2026-11-05T12:10:00+08:00'],config,new Date('2026-11-05T04:00:00Z'),shanghaiDate,nextRelease);
  assert.equal(schedule.releaseAt.toISOString(),'2026-11-05T04:10:00.000Z');
  assert.equal(schedule.preheatAt.toISOString(),'2026-11-05T04:05:00.000Z');
  assert.equal(shanghaiDate(schedule.reference,2),'2026-11-07');
});
test('missed or ambiguous one-time plans do not silently move to another day',()=>{
  const now=new Date('2026-11-05T04:13:00Z');
  assert.throws(()=>executionSchedule('at',['--at','2026-11-05T12:10:00+08:00'],config,now,shanghaiDate,nextRelease));
  assert.throws(()=>executionSchedule('at',['--at','12:10'],config,now,shanghaiDate,nextRelease));
});
test('UI ISO timestamps with milliseconds preserve the Beijing release and preheat time',()=>{
  for(const at of ['2026-11-06T00:00:00.000Z','2026-11-06T08:00:00.000+08:00','2026-11-06T08:00:00+08:00']) {
    const schedule=executionSchedule('at',['--at',at],config,new Date('2026-11-05T13:00:00Z'),shanghaiDate,nextRelease);
    assert.equal(schedule.releaseAt.toISOString(),'2026-11-06T00:00:00.000Z');
    assert.equal(schedule.preheatAt.toISOString(),'2026-11-05T23:55:00.000Z');
    assert.equal(shanghaiDate(schedule.reference,2),'2026-11-08');
  }
  for(const at of ['2026-11-06T08:00:00.000','2026-11-06T00:00:00.0000Z','2026-11-06T25:00:00.000Z'])assert.throws(()=>executionSchedule('at',['--at',at],config,new Date('2026-11-05T13:00:00Z'),shanghaiDate,nextRelease));
});
test('evening watch still targets next morning, independent of the one-time test',()=>{
  const schedule=executionSchedule('watch',[],config,new Date('2026-11-05T13:00:00Z'),shanghaiDate,nextRelease);
  assert.equal(schedule.releaseAt.toISOString(),'2026-11-06T00:00:00.000Z');
  assert.equal(shanghaiDate(schedule.reference,2),'2026-11-08');
});
test('isolated plan configuration does not change the daily configuration path',()=>{
  assert.equal(configurationPath(path.resolve('example'),[]),path.resolve('example/config.json'));
  assert.equal(configurationPath(path.resolve('example'),['--config','.state/plan.json']),path.resolve('example/.state/plan.json'));
  assert.throws(()=>configurationPath('/example',['--config']));
});
