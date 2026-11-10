import {releaseGate,movedNotice,venueError} from './venue-data.mjs';

const noticePattern=/Badminton Court Reservation Management Notice|Reservation Instructions|羽毛球场地预约管理须知|预约须知|预约说明/i;
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
    quietSince=Date.now();const dialog=dialogs.first(),text=(await dialog.innerText()).trim();
    if(releaseGate(text)) {
      const ok=dialog.getByRole('button',{name:/^\s*(?:OK|确定|知道了|关闭|Close)\s*$/i});
      if(await ok.count()!==1||!await ok.isEnabled())throw venueError('放号提示无法正常关闭','RELEASE_NOT_OPEN');
      await dismiss(page,dialog,ok);deferred=true;log('preheat_deferred',{reason:'学校提示 08:00 后才能查看预约'});
      if(!allowDeferred)throw venueError('学校尚未开放预约查询，等待放号后重试','RELEASE_NOT_OPEN');
      continue;
    }
    if(movedNotice(text))throw venueError(text.slice(0,240),'VENUE_MOVED');
    if(noticePattern.test(text)) {
      const close=dialog.getByRole('button',{name:/^\s*(?:Close|关闭)\s*$/i});
      // A disabled Close remains untouched until the site's reading timer ends.
      if(await close.count()===1&&await close.isEnabled()){await dismiss(page,dialog,close);log('notice_closed');}
      else await page.waitForTimeout(50);
      continue;
    }
    if(/登录|login|sign.?in/i.test(text))throw venueError('学校登录会话已失效，请重新登录','AUTH_EXPIRED');
    throw venueError(`学校弹窗需要处理：${text.slice(0,200)}`,'VENUE_DIALOG_UNKNOWN');
  }
  throw venueError('学校须知或提示未在规定时间内结束','VENUE_DIALOG_TIMEOUT');
}
