export const stageLabels={
  run_started:'正在启动',armed:'等待本次放号',preheat_wait_complete:'开始预热',
  orders_checked:'已检查已有订单',preheated:'预热完成，等待放号',release_reached:'已到放号时间',
  booking_delay_started:'等待选场延迟',booking_started:'开始选场',
  selection_verified:'已选中场次',submit_clicked:'已提交场次',
  captcha_detected:'正在处理滑块验证',captcha_result:'滑块检查已返回',
  captcha_submission_recovery:'正在重新获取验证码',order_submit_started:'订单请求已发出',
  order_response:'订单响应已返回',submitted_pending_verification:'正在核对新订单',
  payment_verified:'订单资料核验通过',pay_preview_complete:'已到 Pay，尚未完成预约',
  pay_clicked:'已确认，正在回查订单',confirmed:'预约成功',already_booked:'已有符合条件的预约',
  awaiting_login:'请在学校页面完成登录',login_verified:'登录成功',
  stopped:'本次执行已停止',cancelled:'已停止本次执行',check_complete:'检查完成',finished:'本次执行结束',
  candidate_unavailable:'当前场地不可选，尝试备选',candidate_lost_race:'当前场地被占用，尝试备选',
  venue_moved:'场馆出现迁移提示，正在核对目录',
  preheat_deferred:'预热就绪，学校查询尚未开放',
  venue_recheck_required:'场馆资料变化，正在重新核对',
  waiting_for_date_release:'等待目标日期场次更新',waiting_for_candidate:'暂时无可选场次，继续尝试',
  pay_visible:'Pay 按钮已显示',pay_ready:'Pay 页面已准备好',
};
const eventLabels={availability_refresh_started:'开始更新场次',availability_refreshed:'场次更新完成',date_grid_ready:'目标日期已加载',time_window_ready:'目标时段已加载',captcha_matched:'滑块匹配完成',captcha_refresh:'重新获取滑块',submission_reconcile:'回查提交结果',order_list_pending:'等待订单入列'};
const endpoints={
  '/api/reservation/day/info':'场次查询',
  '/api/reservation/campus/venue/info':'场馆资料',
  '/api/captcha/get':'验证码获取',
  '/api/captcha/check':'验证码校验',
  '/api/reservation/order/submit':'订单提交',
  '/api/orders/mine':'订单回查',
};
const milestones=new Set(['preheated','release_reached','booking_started','selection_verified','submit_clicked','captcha_detected','captcha_result','order_submit_started','order_response','pay_visible','pay_ready','pay_clicked','confirmed']);
const terminal=new Set(['confirmed','already_booked','pay_preview_complete','login_verified','stopped','cancelled']);
const bounded=value=>String(value??'').slice(0,160);

// Keep only displayable fields. No request payloads, tokens or challenge images
// are copied into UI state. Reuse worker events; do not query the venue again.
export function recordRunEvent(run,event) {
  if(typeof event.event!=='string')return;
  const name=event.event,label=stageLabels[name];
  if(label) {
    run.stage=name;run.message=name==='finished'?(run.resultMessage||label):label;
    if(terminal.has(name)){run.resultMessage=label;run.resultStage=name;}
  }
  if(event.error)run.error=String(event.error).slice(0,700);
  if(event.order)run.order=Object.fromEntries(['number','date','session','payment','status','amount','createdAt'].map(key=>[key,event.order[key]]));
  run.milestones??={};
  if(milestones.has(name)&&Number.isFinite(event.elapsedMs)) {
    if(!['preheated','release_reached','booking_started'].includes(name)||!run.milestones[name])run.milestones[name]={at:event.at,elapsedMs:event.elapsedMs};
  }
  if(name==='armed'){run.preheatAt=event.preheat;run.plannedStartAt=event.plannedStartAt;}
  if(name==='booking_delay_started')run.plannedStartAt=event.plannedStartAt;
  if(name==='booking_started'){run.actualDelayMs=event.waitMs;run.startLatenessMs=event.clockLatenessMs;}
  if(name==='release_reached'){run.releaseMs=event.elapsedMs;run.releaseLatenessMs=event.clockLatenessMs;}
  if(name==='pay_visible')run.payVisibleMs=event.elapsedMs;
  if(name==='pay_ready')run.payReadyMs=event.elapsedMs;
  if(name==='confirmed')run.confirmedMs=event.elapsedMs;
  let detail='';
  if(name==='venue_alternate_preheated')detail=`备用入口 ${event.venueId} 已预热 · 放号后按官方目录决定是否使用`;
  if(name==='venue_catalog_checked') {
    run.venueCatalog=(event.eligible||[]).map(v=>({id:v.id,name:bounded(v.name),courtCount:v.courtCount,advanceDays:v.advanceDays,reservationHour:v.reservationHour}));
    run.venueCatalogAt=event.at;
    detail=`官方目录 · ${run.venueCatalog.map(v=>`${v.name} [${v.id}]`).join(' / ')||'暂无可预约羽毛球场馆'}`;
  }
  if(name==='venue_detected') {
    run.venueId=event.venueId;run.venueName=bounded(event.venueName);
    run.venueEvidence=Object.fromEntries(['venueId','parentVenueId','campusId','sportType','courtCount','advanceDays','reservationHour','protocol','source'].map(k=>[k,event[k]]));
    detail=`选用场馆 · ${run.venueName} · ID ${run.venueId} · 目录计数 ${event.courtCount??'待查'}`;
  }
  if(name==='venue_probe_failed'||name==='venue_recheck_required')detail=`场馆 ${event.venueId} · ${event.reason}`;
  if(name==='schedule_verified'||name==='schedule_dates_observed') {
    run.schedule={venueId:event.venueId,spaceId:event.spaceId,timeId:event.timeId,advanceDays:event.advanceDays,requestedDate:event.requestedDate,availableDates:event.availableDates,rowCount:event.rowCount,courts:event.courts};
    detail=name==='schedule_verified'?`排期核验 · 场馆 ${event.venueId} / 场地 ${event.spaceId} / 时段 ${event.timeId}`:`学校开放日期 · ${(event.availableDates||[]).join('、')||'尚无排期'}`;
  }
  if(name==='submission_identity_verified')detail=`提交参数核验 · 场馆 ${event.venueId} / 场地 ${event.spaceId} / 时段 ${event.timeId}`;
  if(name==='court_lookup_failed')detail=`场号识别 · ${event.court} · ${event.matches} 行匹配`;
  if(name==='date_unavailable')detail=event.reason;
  if(name==='venue_moved')detail=`场馆迁移 · ${event.notice}`;
  if(name==='candidate_try') {
    run.candidate={court:bounded(event.court),slot:bounded(event.slot),venueId:event.venueId,index:event.index,total:event.total};
    run.slot=run.candidate.slot;
    run.candidateTries=(run.candidateTries||0)+1;
    detail=`候选 ${event.index??'—'}/${event.total??'—'} · ${event.venueId?'场馆 '+event.venueId+' · ':''}${event.court} · ${event.slot}`;
  }
  if(name==='captcha_matched') {
    run.captcha={...run.captcha,attempts:(run.captcha?.attempts||0)+1,matchMs:event.matchMs,score:event.score};
    detail=`${eventLabels[name]} · ${event.matchMs} ms · 匹配度 ${event.score}`;
  }
  if(name==='captcha_result') {
    run.captcha={...run.captcha,code:bounded(event.repCode),passed:String(event.repCode)==='0000'};
    detail=`滑块校验 ${run.captcha.passed?'通过':'未通过'} · ${run.captcha.code}`;
  }
  if(name==='order_response') {
    run.orderResponse={httpStatus:event.httpStatus,code:bounded(event.code)};
    detail=`订单响应 · HTTP ${event.httpStatus} · 业务码 ${event.code??'—'}`;
  }
  if(name==='booking_delay_started')detail=`选场延迟 · 配置 ${event.delayMs} ms · 剩余 ${event.remainingMs} ms`;
  if(name==='booking_started')detail=`开始选场 · 实际等待 ${event.waitMs} ms · 触发偏差 +${event.clockLatenessMs} ms`;
  if(name==='request_finished'||name==='request_failed') {
    const endpoint=Object.keys(endpoints).find(key=>event.endpoint?.endsWith(key));
    if(endpoint) {
      run.requests??={};const old=run.requests[endpoint]||{count:0,failures:0};
      const failed=name==='request_failed'||Number(event.httpStatus)>=400;
      run.requests[endpoint]={label:endpoints[endpoint],count:old.count+1,failures:old.failures+Number(failed),durationMs:event.durationMs,httpStatus:event.httpStatus??null,errorText:event.errorText?bounded(event.errorText):null,at:event.at};
      detail=`${endpoints[endpoint]} · ${event.durationMs} ms · ${name==='request_failed'?'请求失败 '+(event.errorText||''):'HTTP '+event.httpStatus}`;
    }
  }
  const text=detail||label||eventLabels[name];
  if(text){run.events.push({event:name,at:event.at,label:bounded(text),elapsedMs:event.elapsedMs});run.events=run.events.slice(-80);}
}
