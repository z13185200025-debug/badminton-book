import {browserOptions} from '../lib/platform.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {chromium} from 'playwright-core';
import {createOrder} from '../lib/booking.mjs';
import {observeRequests,requestDiagnostics} from '../lib/diagnostics.mjs';

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

test('completed check responses remain tied to their request when JSON resolves out of order',async()=>{
  const page=new EventEmitter(),logs=[],stop=observeRequests(page,(event,data)=>logs.push({event,...data}));
  let resolveA;
  const a={url:()=> 'https://example.test/api/captcha/check',postDataJSON:()=>({token:'A'}),response:async()=>({status:()=>200,json:()=>new Promise(resolve=>resolveA=resolve)})};
  const b={url:a.url,postDataJSON:()=>({token:'B'}),response:async()=>({status:()=>200,json:async()=>({repCode:'9999'})})};
  page.emit('request',a);page.emit('requestfinished',a);await new Promise(resolve=>setImmediate(resolve));
  page.emit('request',b);page.emit('requestfinished',b);await new Promise(resolve=>setImmediate(resolve));
  resolveA({repCode:'0000'});await requestDiagnostics(page).flush();
  assert.equal(requestDiagnostics(page).inspect({captchaToken:'B'}).checkPassed,false);
  assert.equal(requestDiagnostics(page).inspect({captchaToken:'A'}).checkPassed,true);
  stop();assert.equal(requestDiagnostics(page),undefined);
});

test('fresh-challenge recovery waits after success without rewriting or replaying a proof',async()=>{
  const browser=await chromium.launch({...browserOptions(),headless:true});
  try {
    const context=await browser.newContext(),page=await context.newPage(),events=[],posts=[];
    observeRequests(page,(event,data)=>events.push({event,...data}));
    let checkedAt,token;
    const point='{"x":146,"y":5}';
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.pathname==='/fixture')return route.fulfill({contentType:'text/html',body:`<label class="text-left"><input type="checkbox"></label><div class="action"><button class="btn">Submit</button></div><script>
        document.querySelector('button').onclick=async()=>{
          const g=await(await fetch('/api/captcha/get')).json();const token=g.repData.token,point='${point}';
          await fetch('/api/captcha/check',{method:'POST',body:JSON.stringify({token,pointJson:point})});
          setTimeout(async()=>{await fetch('/api/reservation/order/submit',{method:'POST',body:JSON.stringify({captchaToken:token,captchaVerification:token+'---'+point})});window.open('/payment');},500);
        };</script>`});
      if(url.pathname==='/api/captcha/get'){token='test-'+posts.length;return route.fulfill({json:{repCode:'0000',repData:{token}}});}
      if(url.pathname==='/api/captcha/check'){checkedAt=performance.now();return route.fulfill({json:{repCode:'0000'}});}
      if(url.pathname==='/api/reservation/order/submit'){
        posts.push({body:route.request().postDataJSON(),afterCheckMs:performance.now()-checkedAt});
        return route.fulfill({json:{code:200,data:{tradeNo:'D900'}}});
      }
      if(url.pathname==='/payment')return route.fulfill({body:'Fixture payment'});
      return route.abort();
    });
    for(const captchaRecovery of [false,true]){
      await page.goto('https://example.test/fixture');
      const result=await createOrder(page,{captchaTimeoutSeconds:1},{captchaRecovery,log:(event,data)=>events.push({event,...data})});
      await result.popup.close();
    }
    assert.equal(posts.length,2);
    posts.forEach((p,i)=>assert.deepEqual(p.body,{captchaToken:'test-'+i,captchaVerification:'test-'+i+'---'+point}));
    assert.ok(posts[0].afterCheckMs>=490);assert.ok(posts[1].afterCheckMs>=990);
    const dispatched=events.filter(e=>e.event==='order_submit_dispatched');
    assert.equal(dispatched.length,2);assert.ok(dispatched.every(e=>e.proofStatus==='matched'),JSON.stringify(dispatched));
    assert.equal(events.filter(e=>e.event==='captcha_recovery_wait').length,1);
    assert.ok(dispatched[0].clientHoldMs<150,'first attempt has no deliberate wait');
    assert.ok(dispatched[1].clientHoldMs>=350,'recovery adds the remaining delay only');
  } finally {await browser.close();}
});

test('a proven proof mismatch is blocked before an order request reaches the server',async()=>{
  const browser=await chromium.launch({...browserOptions(),headless:true});
  try{
    const context=await browser.newContext(),page=await context.newPage();let posts=0;
    observeRequests(page,()=>{});
    await context.route('**/*',async route=>{
      const endpoint=new URL(route.request().url()).pathname;
      if(endpoint==='/fixture')return route.fulfill({contentType:'text/html',body:`<label class="text-left"><input type="checkbox"></label><div class="action"><button class="btn" onclick="fetch('/api/reservation/order/submit',{method:'POST',body:JSON.stringify({captchaToken:'A',captchaVerification:'A---wrong'})}).catch(()=>{})">Submit</button></div>`});
      if(endpoint==='/api/captcha/get')return route.fulfill({json:{repCode:'0000',repData:{token:'A'}}});
      if(endpoint==='/api/captcha/check')return route.fulfill({json:{repCode:'0000'}});
      if(endpoint==='/api/reservation/order/submit')posts++;
      return route.abort();
    });
    await page.goto('https://example.test/fixture');
    await page.evaluate(async()=>{await(await fetch('/api/captcha/get')).json();await(await fetch('/api/captcha/check',{method:'POST',body:JSON.stringify({token:'A',pointJson:'{"x":1,"y":5}'})})).json();});
    await requestDiagnostics(page).flush();
    await assert.rejects(()=>createOrder(page,{captchaTimeoutSeconds:1}),e=>e.code==='CAPTCHA_CONTINUITY');
    assert.equal(posts,0);
  }finally{await browser.close();}
});
