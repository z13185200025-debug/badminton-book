import {releaseGate,movedNotice,venueError} from './venue-data.mjs';
import {assertNotRateLimited} from './polling.mjs';

const noticePattern=/Badminton Court Reservation Management Notice|Reservation Instructions|羽毛球场地预约管理须知|预约须知|预约说明/i;
async function topDialog(dialogs) {
  const index=await dialogs.evaluateAll(elements=>{
    const reachable=elements.map((el,index)=>({el,index})).filter(({el})=>
      [el,...el.querySelectorAll('button')].some(node=>{
        const r=node.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
        if(!r.width||!r.height||x<0||y<0||x>=innerWidth||y>=innerHeight)return false;
        return el.contains(document.elementFromPoint(x,y));
      }));
    if(reachable.length)return reachable.at(-1).index;
    // Offscreen/animating dialogs still use the site's stacking order. Never
    // force a click through another layer; normal actionability remains active.
    return elements.map((el,index)=>{
      let z=0;for(let p=el;p;p=p.parentElement)z=Math.max(z,Number.parseInt(getComputedStyle(p).zIndex)||0);
      return {index,z};
    }).sort((a,b)=>a.z-b.z||a.index-b.index).at(-1)?.index??0;
  });
  return dialogs.nth(index);
}
async function dismiss(page,dialog,button) {
  // Keep this exact element: a :visible.first() locator would retarget the next
  // stacked modal after this one closes, then incorrectly wait for that modal.
  const element=await dialog.elementHandle();
  try{
    await button.click();
    await page.waitForFunction(el=>!el?.isConnected||!el.getBoundingClientRect().height||!el.getBoundingClientRect().width||getComputedStyle(el).visibility==='hidden',element,{timeout:5000});
  }finally{await element?.dispose();}
}
export async function settleVenueDialogs(page,{allowDeferred=false,log=()=>{},timeoutMs=22000,settleMs=0}={}) {
  let deferred=false,quietSince=Date.now();const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline) {
    const dialogs=page.locator('.ivu-modal:visible');
    if(!await dialogs.count()) {
      if(Date.now()-quietSince>=settleMs)return {deferred};
      await page.waitForTimeout(30);continue;
    }
    quietSince=Date.now();const dialog=await topDialog(dialogs),text=(await dialog.innerText()).trim();
    if(movedNotice(text))throw venueError(text.slice(0,240),'VENUE_MOVED');
    const heading=dialog.locator('.ivu-modal-header');
    const isNotice=noticePattern.test(await heading.count()?await heading.innerText():text);
    if(isNotice) {
      const close=dialog.getByRole('button',{name:/^\s*(?:Close|关闭)\s*$/i});
      // A notice may describe the release hour; that is not a release error.
      // Keep the site's reading countdown intact.
      if(await close.count()===1&&await close.isEnabled()){await dismiss(page,dialog,close);log('notice_closed');}
      else await page.waitForTimeout(50);
      continue;
    }
    assertNotRateLimited(text);
    if(releaseGate(text)) {
      const ok=dialog.getByRole('button',{name:/^\s*(?:OK|确定|知道了|关闭|Close)\s*$/i});
      if(await ok.count()!==1||!await ok.isEnabled())throw venueError('放号提示无法正常关闭','RELEASE_NOT_OPEN');
      await dismiss(page,dialog,ok);deferred=true;log('preheat_deferred',{reason:'学校提示 08:00 后才能查看预约'});
      if(!allowDeferred)throw venueError('学校尚未开放预约查询，等待放号后重试','RELEASE_NOT_OPEN');
      continue;
    }
    if(/登录|login|sign.?in/i.test(text))throw venueError('学校登录会话已失效，请重新登录','AUTH_EXPIRED');
    throw venueError(`学校弹窗需要处理：${text.slice(0,200)}`,'VENUE_DIALOG_UNKNOWN');
  }
  throw venueError('学校须知或提示未在规定时间内结束','VENUE_DIALOG_TIMEOUT');
}
