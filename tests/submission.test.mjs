import {browserOptions} from '../lib/platform.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {chromium} from 'playwright-core';
import {createOrder} from '../lib/booking.mjs';
import {observeRequests} from '../lib/diagnostics.mjs';

test('only an explicit CAPTCHA rejection is eligible for a fresh challenge',async()=>{
  const browser=await chromium.launch({...browserOptions(),headless:true});
  try {
    const page=await browser.newPage();let payload,posts=0;
    await page.route('**/*',async route=>{
      if(route.request().method()==='POST'){posts++;return route.fulfill({json:payload});}
      return route.fulfill({contentType:'text/html',body:`<label class="text-left"><input type="checkbox"></label><div class="action"><button class="btn" onclick="fetch('/api/reservation/order/submit',{method:'POST'})">Submit</button></div>`});
    });
    for(const [body,eligible] of [
      [{code:250,message:'验证码非法校验'},true],
      [{code:250,message:'验证码已过期'},true],
      [{code:500,message:'系统异常，请稍后重试'},false],
      [{code:500,message:'验证码非法校验'},false],
    ]) {
      payload=body;await page.goto('https://hzsm.buaa.edu.cn/fixture');
      await assert.rejects(()=>createOrder(page,{captchaTimeoutSeconds:1}),error=>error.captchaRejectedResponse===eligible);
    }
    assert.equal(posts,4,'createOrder never retries a failed POST itself');
  } finally {await browser.close();}
});

test('request diagnostics check challenge continuity without logging secrets',async()=>{
  const page=new EventEmitter(),logs=[];
  const unobserve=observeRequests(page,(event,data)=>logs.push({event,...data}));
  const token='PRIVATE_CHALLENGE_SENTINEL',proof='PRIVATE_PROOF_SENTINEL';
  const fire=async(endpoint,data,body)=>{
    const response={status:()=>200,json:async()=>body};
    const request={url:()=>`https://hzsm.buaa.edu.cn/venue-server${endpoint}`,postDataJSON:()=>data,response:async()=>response};
    page.emit('request',request);page.emit('requestfinished',request);
    await new Promise(resolve=>setImmediate(resolve));
  };
  await fire('/api/captcha/get',{}, {data:{repCode:'0000',repData:{token,secretKey:'PRIVATE_KEY_SENTINEL'}}});
  await fire('/api/captcha/check',{token},{data:{repCode:'0000'}});
  await fire('/api/reservation/order/submit',{captchaToken:token,captchaVerification:proof},{code:250});
  const submission=logs.find(log=>log.event==='order_submit_started');
  assert.equal(submission.tokenMatchesChecked,true);
  assert.equal(submission.checkPassed,true);
  assert.equal(submission.hasCaptchaVerification,true);
  assert.equal(logs.find(log=>log.event==='captcha_check_started').tokenMatchesChallenge,true);
  assert.doesNotMatch(JSON.stringify(logs),/PRIVATE_/);
  const failed={url:()=> 'https://hzsm.buaa.edu.cn/venue-server/api/reservation/day/info',postDataJSON:()=>null,failure:()=>({errorText:'net::ERR_CONNECTION_TIMED_OUT'})};
  page.emit('request',failed);page.emit('requestfailed',failed);
  assert.equal(logs.find(log=>log.event==='request_failed').errorText,'net::ERR_CONNECTION_TIMED_OUT');
  unobserve();assert.equal(page.listenerCount('request'),0);
});
