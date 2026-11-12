import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {browserOptions} from '../lib/platform.mjs';
import {selectCandidateOnce} from '../lib/select-once.mjs';

async function fixture({freeCourt=0,rateLimited=false}={},check) {
  const browser=await chromium.launch({...browserOptions(),headless:true});
  const counts={reads:0,posts:0,visits:0},events=[];
  try {
    const page=await browser.newPage();
    await page.route('**/*',route=>{
      if(route.request().method()==='POST')counts.posts++;
      if(new URL(route.request().url()).pathname==='/api/reservation/day/info'){
        counts.reads++;
        return route.fulfill({status:rateLimited?429:200,json:rateLimited?{message:'访问频繁，限制访问中...'}:{code:200}});
      }
      return route.fulfill({contentType:'text/html; charset=utf-8',body:`<meta charset="utf-8">
        <div class="date_box"><div class="active"><span>11/13</span></div><div id="target"><span>11/15</span></div></div>
        <div class="spaceTable"><table><thead><tr><td>Venue</td><td>19:00-20:00</td></tr></thead><tbody>
        ${Array.from({length:9},(_,i)=>`<tr><td>No.${i+1}</td><td><div class="reserveBlock ${i+1===freeCourt?'free':'reserved'}" data-court="No.${i+1}">${i+1===freeCourt?'￥0':'Sold out'}</div></td></tr>`).join('')}
        </tbody></table></div><div id="selection"></div><input placeholder="请输入手机号" value="13000000000"><div class="action"><p><b>0.00</b></p></div>
        <script>
        document.querySelector('#target').onclick=async function(){await fetch('/api/reservation/day/info');document.querySelector('.active').className='';this.className='active'};
        document.querySelectorAll('.reserveBlock.free').forEach(el=>el.onclick=()=>document.querySelector('#selection').innerHTML='<div class="reserve-msg-row">'+el.dataset.court+'：19:00-20:00 ￥0</div>');
        </script>`});
    });
    await page.goto('https://hzsm.buaa.edu.cn/fixture');
    const targets=Array.from({length:9},(_,i)=>({venueId:1,date:'2026-11-15',court:`No.${i+1}`,slot:'19:00-20:00'}));
    const router={targets,pageFor:async()=>{counts.visits++;return page;}};
    await check({router,counts,events,log:(event,data)=>events.push({event,...data})});
  } finally {await browser.close();}
}

test('all nine unavailable candidates stop after one schedule read without another round',async()=>{
  await fixture({},async({router,counts,events,log})=>{
    await assert.rejects(()=>selectCandidateOnce(router,{refresh:true,log}),/本轮所有候选.*已停止/);
    assert.equal(counts.reads,1);assert.equal(counts.posts,0);assert.equal(counts.visits,9);
    assert.equal(events.filter(e=>e.event==='candidate_try').length,9);
    assert.equal(events.filter(e=>e.event==='availability_refresh_started').length,1);
  });
});

test('fallback court selection reuses the first query and retains candidate priority',async()=>{
  await fixture({freeCourt:2},async({router,counts,log})=>{
    const result=await selectCandidateOnce(router,{refresh:true,log});
    assert.equal(result.target.court,'No.2');assert.equal(counts.reads,1);assert.equal(counts.visits,2);assert.equal(counts.posts,0);
  });
});

test('a limited schedule request stops before other candidates or venue entries',async()=>{
  await fixture({rateLimited:true},async({router,counts,log})=>{
    router.targets.push({...router.targets[0],venueId:2});
    await assert.rejects(()=>selectCandidateOnce(router,{refresh:true,log}),e=>e.code==='RATE_LIMITED');
    assert.equal(counts.reads,1);assert.equal(counts.visits,1);assert.equal(counts.posts,0);
  });
});

test('an invalid venue or expired release window stops without another venue probe',async()=>{
  let probes=0;
  const router={targets:[{venueId:1},{venueId:2}],pageFor:async()=>{probes++;throw Object.assign(new Error('场馆已变化'),{code:'VENUE_CHANGED'});}};
  await assert.rejects(()=>selectCandidateOnce(router),e=>e.code==='VENUE_CHANGED');
  assert.equal(probes,1);
  await assert.rejects(()=>selectCandidateOnce(router,{deadline:Date.now()-1}),/超过本次放号窗口/);
  assert.equal(probes,1);
});
