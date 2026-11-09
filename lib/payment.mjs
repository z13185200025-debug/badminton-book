import {assertZero} from './safety.mjs';
import {matchesVenue,matchesSession} from './venues.mjs';

export function validatePaymentText(text,target) {
  if(!text.includes(target.accountName)||!/羽毛球馆|Badminton Gymnasium/i.test(text)||!matchesVenue(text,target)) throw new Error('Pay 页账号或场馆不匹配');
  const match=text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  const date=match?`${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`:null;
  if(date!==target.date) throw new Error('Pay 页预约日期不匹配');
  if(!matchesSession(text,target)) throw new Error('Pay 页场号、时段或场次数量不匹配');
  const price=text.match(/(?:Please pay|应付金额|支付金额)\s*[：:]?\s*[¥￥]?\s*(\d+(?:\.\d+)?)\s*(?:CNY|元)/i);
  if(!price) throw new Error('无法明确识别 Pay 页应付金额');
  assertZero(price[1]);
  return {date,court:target.court,slot:target.slot,amount:0};
}

export async function inspectAndPay(page,{target,order,log=()=>{}}) {
  if(target.autoPay!==true)throw new Error('最终 Pay 未获启用，拒绝点击');
  const url=new URL(page.url());
  if(url.origin!==target.origin||!/^\/venue\/venue-reservation\/\d+$/.test(url.pathname)) throw new Error('Pay 页域名或路径不匹配');
  const details=validatePaymentText(await page.locator('body').innerText(),target);
  // The campus site renders Pay as a styled DIV rather than an HTML button.
  const button=page.getByText(/^\s*(?:Pay|支付|立即支付)\s*(?:[（(]\d+s[)）])?\s*$/).filter({visible:true});
  if(await button.count()!==1) throw new Error('无法唯一识别最后的 Pay 按钮');
  log('pay_checked',{...details,number:order.number});
  // Clicking only this known zero-yuan button finalizes the reservation.
  // Any unexpected follow-up dialog or payment provider is left for inspection.
  await button.click();
}

export async function waitForPaymentReady(page,target,log=()=>{}) {
  await page.waitForURL(url=>url.origin===target.origin&&/^\/venue\/venue-reservation\/\d+$/.test(url.pathname),{waitUntil:'domcontentloaded',timeout:15000});
  const url=new URL(page.url());
  if(url.origin!==target.origin||!/^\/venue\/venue-reservation\/\d+$/.test(url.pathname))throw new Error('Pay 页域名或路径不匹配');
  const button=page.getByText(/^\s*(?:Pay|支付|立即支付)\s*(?:[（(]\d+s[)）])?\s*$/).filter({visible:true});
  await button.waitFor({state:'visible',timeout:15000});
  log('pay_visible',{detailsPending:true});
  // The static Pay control can render before the asynchronous account and order
  // details. Wait for the complete, validated target rather than failing on a
  // half-rendered page. No click is allowed until all checks pass.
  let text,details,lastError;
  const deadline=Date.now()+12000;
  do {
    text=await page.locator('body').innerText();
    try {details=validatePaymentText(text,target);break;}
    catch(error){lastError=error;}
    await new Promise(resolve=>setTimeout(resolve,25));
  } while(Date.now()<deadline);
  if(!details)throw lastError;
  // Trial checks actionability without clicking Pay.
  await button.click({trial:true});
  log('pay_ready',details);
  return {text,details};
}
