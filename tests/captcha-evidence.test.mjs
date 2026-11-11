import test from 'node:test';
import assert from 'node:assert/strict';
import {createCipheriv} from 'node:crypto';
import {CaptchaEvidence} from '../lib/captcha-evidence.mjs';

const key='1234567890123456';
function encrypt(text) {
  const cipher=createCipheriv('aes-128-ecb',Buffer.from(key),null);
  return Buffer.concat([cipher.update(text,'utf8'),cipher.final()]).toString('base64');
}
const issued=token=>({repCode:'0000',repData:{token,secretKey:key}});

test('order proof must contain the exact token and point accepted by its own slider check',()=>{
  let now=0;const logs=[],evidence=new CaptchaEvidence((event,data)=>logs.push({event,...data}),()=>now);
  const token='PRIVATE_TOKEN',point='{"x":146,"y":5}';
  evidence.issued(issued(token));now=400;
  const check=evidence.beginCheck({token,pointJson:encrypt(point)});now=480;evidence.finishCheck(check,{repCode:'0000'});now=980;
  const payload={captchaToken:token,captchaVerification:encrypt(token+'---'+point)};
  const result=evidence.inspect(payload);
  assert.equal(result.proofStatus,'matched');assert.equal(result.afterCheckMs,500);assert.equal(result.checkDurationMs,80);assert.equal(result.challengeAgeMs,400);
  assert.equal(evidence.inspect({...payload,captchaVerification:encrypt(token+'---{"x":147,"y":5}')}).proofStatus,'mismatched');
  assert.equal(evidence.inspect({...payload,captchaVerification:encrypt('OTHER---'+point)}).proofStatus,'mismatched');
  assert.equal(evidence.inspect({...payload,captchaToken:'OTHER'}).tokenMatchesChecked,false);
  assert.equal(evidence.inspect({...payload,captchaVerification:'unsupported-proof'}).proofStatus,'unreadable');
  assert.doesNotMatch(JSON.stringify([...logs,result]),/PRIVATE_TOKEN|1234567890123456|pointJson|captchaVerification/);
});

test('out-of-order responses cannot mark a different or newer check as passed',()=>{
  const evidence=new CaptchaEvidence();evidence.issued(issued('A'));evidence.issued(issued('B'));
  const a=evidence.beginCheck({token:'A'}),b=evidence.beginCheck({token:'B'});
  evidence.finishCheck(b,{repCode:'9999'});evidence.finishCheck(a,{repCode:'0000'});
  assert.equal(evidence.inspect({captchaToken:'B'}).checkPassed,false);
  assert.equal(evidence.inspect({captchaToken:'A'}).checkPassed,true);
  const again=evidence.beginCheck({token:'A'});evidence.finishCheck(a,{repCode:'0000'});
  assert.equal(evidence.inspect({captchaToken:'A'}).checkPassed,false);
  evidence.finishCheck(again,{repCode:'9999'});
  assert.equal(evidence.inspect({captchaToken:'A'}).checkPassed,false);
});

test('refreshing another challenge preserves the submitted proof evidence and state stays bounded',()=>{
  const evidence=new CaptchaEvidence(),point='{"x":12,"y":5}';evidence.issued(issued('A'));
  const check=evidence.beginCheck({token:'A',pointJson:encrypt(point)});evidence.finishCheck(check,{repCode:'0000'});
  evidence.issued(issued('B'));
  const result=evidence.inspect({captchaToken:'A',captchaVerification:encrypt('A---'+point)});
  assert.equal(result.proofStatus,'matched');assert.equal(result.refreshedSinceCheck,true);
  for(let i=0;i<30;i++){evidence.issued(issued(String(i)));evidence.beginCheck({token:String(i)});}
  assert.equal(evidence.challenges.size,8);assert.equal(evidence.checks.size,8);
  evidence.clear();assert.equal(evidence.inspect({captchaToken:'A'}).hasObservedCheck,false);
});

test('late challenge-body parsing still binds the check to its own issuance timestamp',()=>{
  let now=400;const evidence=new CaptchaEvidence(()=>{},()=>now),point='{"x":146,"y":5}';
  const check=evidence.beginCheck({token:'A',pointJson:encrypt(point)});
  evidence.issued(issued('A'),0);now=480;evidence.finishCheck(check,{repCode:'0000'});
  const result=evidence.inspect({captchaToken:'A',captchaVerification:encrypt('A---'+point)});
  assert.equal(result.proofStatus,'matched');assert.equal(result.challengeAgeMs,400);
});
