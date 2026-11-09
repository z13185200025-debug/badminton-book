const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export function bookingDelayMs(config={}) {
  const value=config.bookingDelayMs??2000;
  if(!Number.isInteger(value)||value<0||value>30000)throw new Error('选场前延迟应为 0–30 秒，精确到毫秒');
  return value;
}

// One gate per new booking, outside the candidate/retry loop. Scheduled runs
// anchor to release time, so late preheating never adds a second full delay.
export async function waitForBookingStart({releaseAt=null,delayMs,log=()=>{},stopped=()=>false,now=Date.now,monotonic=()=>performance.now(),wait=sleep}) {
  bookingDelayMs({bookingDelayMs:delayMs});
  const start=now(),started=monotonic(),plannedStart=(releaseAt===null?start:Number(releaseAt))+delayMs;
  if(!Number.isFinite(plannedStart))throw new Error('选场开始时间无效');
  if(stopped())throw new Error('本次任务已停止');
  log('booking_delay_started',{delayMs,plannedStartAt:new Date(plannedStart).toISOString(),remainingMs:Math.max(0,plannedStart-start)});
  while(now()<plannedStart) {
    if(stopped())throw new Error('本次任务已停止');
    await wait(Math.min(200,plannedStart-now()));
  }
  if(stopped())throw new Error('本次任务已停止');
  const details={delayMs,waitMs:Math.round(monotonic()-started),plannedStartAt:new Date(plannedStart).toISOString(),clockLatenessMs:Math.max(0,now()-plannedStart)};
  log('booking_started',details);
  return details;
}
