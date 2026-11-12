import {browserOptions} from '../lib/platform.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {prepareSelection,readOrders,openPayment,reconcileSubmittedOrder,verifyBooking} from '../lib/booking.mjs';
import {inspectAndPay,waitForPaymentReady} from '../lib/payment.mjs';

test('browser selects a fallback court in a later time window',async()=>{
  const browser=await chromium.launch({...browserOptions(),headless:true});
  try {
    const page=await browser.newPage();
    const html=`<meta charset="utf-8"><div class="date_box"><div><span>11/07</span></div></div>
      <div class="spaceTable"><table><thead></thead><tbody></tbody></table></div><div id="selection"></div>
      <input placeholder="请输入手机号" value="13000000000"><div class="action"><p><b>0.00</b></p></div>
      <script>
      let hour=8;
      function render(){
        const times=Array.from({length:Math.min(5,22-hour)},(_,i)=>String(hour+i).padStart(2,'0')+':00-'+String(hour+i+1).padStart(2,'0')+':00');
        document.querySelector('thead').innerHTML='<tr><td>Venue</td>'+times.map((t,i)=>'<td>'+(i===0&&hour>8?'<i style="display:inline-block;width:20px;height:20px" class="ivu-icon-ios-arrow-back"></i>':'')+'<span>'+t+'</span>'+(i===times.length-1&&hour<18?'<i style="display:inline-block;width:20px;height:20px" class="ivu-icon-ios-arrow-forward"></i>':'')+'</td>').join('')+'</tr>';
        document.querySelector('tbody').innerHTML=[1,2,3,4].map(n=>'<tr><td>No.'+n+'</td>'+times.map(t=>'<td><div class="reserveBlock '+(n===1?'reserved':'free')+'" data-court="No.'+n+'" data-time="'+t+'">'+(n===1?'Sold out':'￥0')+'</div></td>').join('')+'</tr>').join('');
        const next=document.querySelector('.ivu-icon-ios-arrow-forward');if(next)next.onclick=()=>{hour+=5;render()};
        const previous=document.querySelector('.ivu-icon-ios-arrow-back');if(previous)previous.onclick=()=>{hour-=5;render()};
        document.querySelectorAll('.reserveBlock.free').forEach(e=>e.onclick=()=>document.querySelector('#selection').innerHTML='<div class="reserve-msg-row">'+e.dataset.court+'：'+e.dataset.time+' ￥0.00</div>');
      }
      document.querySelector('.date_box>div').onclick=async function(){document.querySelector('tbody').innerHTML='';this.className='active';await fetch('/api/reservation/day/info');render()};render();
      </script>`;
    await page.route('**/*',r=>r.fulfill({status:200,contentType:r.request().url().endsWith('/api/reservation/day/info')?'application/json':'text/html',body:r.request().url().endsWith('/api/reservation/day/info')?'{}':html}));
    await page.goto('https://hzsm.buaa.edu.cn/fixture');
    const target={date:'2026-11-07',court:'No.1',slot:'12:00-13:00'};
    await assert.rejects(()=>prepareSelection(page,target),e=>e.code==='UNAVAILABLE');
    await assert.rejects(()=>prepareSelection(page,{...target,slot:'18:00-19:00'}),e=>e.code==='UNAVAILABLE');
    const earlier=await prepareSelection(page,{...target,court:'No.2'});
    assert.equal(earlier.slot,'12:00-13:00');
    const selected=await prepareSelection(page,{...target,court:'No.2',slot:'18:00-19:00'});
    assert.equal(selected.court,'No.2');assert.equal(selected.slot,'18:00-19:00');
    assert.match(await page.locator('.reserve-msg-row').innerText(),/No\.2：18:00-19:00/);
  }finally{await browser.close();}
});

test('real browser clicks the styled zero-yuan Pay control once',async()=>{
  const browser=await chromium.launch({...browserOptions(),headless:true});
  try {
    const page=await browser.newPage();
    await page.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<meta charset="utf-8">Welcome! 测试用户<br>羽毛球馆 2026年11月07日<br>No.1：12:00-13:00<br>Please pay： ¥0 CNY<div class="btn" onclick="window.clicks=(window.clicks||0)+1">Pay （590s）</div>'}));
    await page.goto('https://hzsm.buaa.edu.cn/venue/venue-reservation/1');
    await inspectAndPay(page,{target:{origin:'https://hzsm.buaa.edu.cn',accountName:'测试用户',date:'2026-11-07',court:'No.1',slot:'12:00-13:00',autoPay:true},order:{number:'DTEST'}});
    assert.equal(await page.evaluate(()=>window.clicks),1);
  }finally{await browser.close();}
});

test('resuming a pending order finds it after a multi-page account check',async()=>{
  const browser=await chromium.launch({...browserOptions(),headless:true});
  try {
    const page=await browser.newPage();
    const html=`<meta charset="utf-8">Welcome! 测试用户
      <table><tbody></tbody></table><button class="ivu-page-next">Next</button>
      <div style="display:none"><table><tbody><tr><td>D123</td><td><button>Continue payment</button></td></tr></tbody></table></div>
      <script>
      let pageNumber=1;
      async function render(){
        await fetch('/api/orders/mine?page='+pageNumber);
        const first=pageNumber===1;
        document.querySelector('tbody').innerHTML='<tr><td>1</td><td>[online purchase] '+(first?'D123':'D124')+'</td><td>Badminton Gymnasium</td><td>2026-11-07</td><td>No.1 12:00-13:00</td><td>Unpaid</td><td>'+(first?'Normal':'Cancelled')+'</td><td>0CNY</td><td>2026-11-05</td><td>'+(first?'<button id="continue">Continue payment （400s）</button>':'')+'</td></tr>';
        document.querySelector('.ivu-page-next').classList.toggle('ivu-page-disabled',!first);
        const resume=document.querySelector('#continue');if(resume)resume.onclick=()=>window.open('/venue/venue-reservation/999','_blank');
      }
      document.querySelector('.ivu-page-next').onclick=()=>{pageNumber++;render()};render();
      </script>`;
    await page.context().route('**/*',r=>r.fulfill({status:200,contentType:'text/html; charset=utf-8',body:r.request().url().includes('/api/orders/mine')?'{}':html}));
    const target={origin:'https://hzsm.buaa.edu.cn',accountName:'测试用户'};
    const orders=await readOrders(page,target);
    assert.deepEqual(orders.map(order=>order.number),['D123','D124']);
    assert.match(await page.locator('table:visible tbody').innerText(),/D124/);
    const popup=await openPayment(page,{target,order:orders[0]});
    assert.equal(new URL(popup.url()).pathname,'/venue/venue-reservation/999');
    assert.match(await page.locator('table:visible tbody').innerText(),/D123/);
  } finally {await browser.close();}
});

test('Pay is not considered ready until asynchronous account and order details render',async()=>{
  const browser=await chromium.launch({...browserOptions(),headless:true});
  try {
    const page=await browser.newPage(),events=[];
    await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<meta charset="utf-8"><div onclick="window.payClicks=(window.payClicks||0)+1">Pay （599s）</div><div id="details"></div><script>setTimeout(()=>document.querySelector('#details').innerText='Welcome! 测试用户\\n羽毛球馆 2026年11月07日\\nNo.1：12:00-13:00\\nPlease pay： ¥0 CNY',350)</script>`}));
    await page.goto('https://hzsm.buaa.edu.cn/venue/venue-reservation/99');
    await waitForPaymentReady(page,{origin:'https://hzsm.buaa.edu.cn',accountName:'测试用户',date:'2026-11-07',court:'No.1',slot:'12:00-13:00'},event=>events.push({event,at:performance.now()}));
    assert.ok(events.find(e=>e.event==='pay_ready').at-events.find(e=>e.event==='pay_visible').at>200);
    assert.equal(await page.evaluate(()=>window.payClicks||0),0);
  }finally{await browser.close();}
});

test('an acknowledged order missing from one list check stops without polling or resubmission',async()=>{
  const browser=await chromium.launch({...browserOptions(),headless:true});let reads=0,posts=0;
  try {
    const page=await browser.newPage();
    await page.route('**/*',async route=>{
      if(route.request().method()==='POST')posts++;
      if(route.request().url().includes('/api/orders/mine')){reads++;return route.fulfill({json:{ready:reads>1}});}
      await route.fulfill({contentType:'text/html; charset=utf-8',body:`<meta charset="utf-8">测试用户<table><tbody></tbody></table><div id="total"></div><script>fetch('/api/orders/mine').then(r=>r.json()).then(data=>{if(data.ready)document.querySelector('tbody').innerHTML='<tr><td>1</td><td>D100</td><td>Badminton</td><td>2026-11-07</td><td>No.1 12:00-13:00</td><td>Unpaid</td><td>Normal</td><td>0CNY</td><td>2026-11-05</td><td></td></tr>';else document.querySelector('#total').textContent='Total 0'})</script>`});
    });
    const target={origin:'https://hzsm.buaa.edu.cn',accountName:'测试用户',date:'2026-11-07',court:'No.1',slot:'12:00-13:00'};
    await assert.rejects(()=>reconcileSubmittedOrder(page,[target],'D100'),/订单 D100.*已停止查询/);
    assert.equal(reads,1);assert.equal(posts,0);
  } finally {await browser.close();}
});

for(const action of ['reconcile','verify-paid','verify-unpaid'])test(`order status is checked once without polling: ${action}`,async()=>{
  const browser=await chromium.launch({...browserOptions(),headless:true});let reads=0;
  try {
    const page=await browser.newPage();
    await page.route('**/*',route=>{
      if(route.request().url().includes('/api/orders/mine')){reads++;return route.fulfill({json:{code:200}});}
      return route.fulfill({contentType:'text/html; charset=utf-8',body:`<meta charset="utf-8">测试用户<table><tbody></tbody></table><script>fetch('/api/orders/mine').then(()=>document.querySelector('tbody').innerHTML='<tr><td>1</td><td>D100</td><td>Badminton</td><td>2026-11-07</td><td>No.1 12:00-13:00</td><td>${action==='verify-paid'?'Paid':'Unpaid'}</td><td>Normal</td><td>0CNY</td><td>2026-11-05</td><td></td></tr>')</script>`});
    });
    const target={origin:'https://hzsm.buaa.edu.cn',accountName:'测试用户',date:'2026-11-07',court:'No.1',slot:'12:00-13:00'};
    if(action==='reconcile')assert.equal((await reconcileSubmittedOrder(page,[target],'D100')).action,'resume');
    else if(action==='verify-paid')assert.equal((await verifyBooking(page,target,'D100')).number,'D100');
    else await assert.rejects(()=>verifyBooking(page,target,'D100'),/订单 D100.*已停止查询/);
    assert.equal(reads,1);
  } finally {await browser.close();}
});
