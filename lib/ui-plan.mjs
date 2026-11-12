import {candidateTargets,shanghaiDate,nextRelease} from './safety.mjs';
import {bookingDelayMs} from './start-delay.mjs';
import {configuredVenue} from './venues.mjs';
import {pollingBaseMs,maxPollIntervalMs,catalogRefreshIntervalMs} from './polling.mjs';

export function interfaceDefaults(config,now=new Date()) {
  const release=nextRelease(now,'08:00:00',0);
  const venue=configuredVenue(config);
  return {
    date:shanghaiDate(now,2),slot:config.candidates?.[0]?.slot||'19:00-20:00',
    courts:config.candidates?.[0]?.courts||venue.courts,
    venueId:venue.id,venueName:venue.name,venueMode:config.venueMode||'auto',availableCourts:venue.courts,
    fallbackSlots:(config.candidates||[]).slice(1).map(item=>item.slot),
    autoPay:config.autoPay===true,visible:config.headless===false,mode:'now',
    bookingDelayMs:bookingDelayMs(config),releaseWindowSeconds:config.releaseWindowSeconds,
    releasePollIntervalMs:pollingBaseMs(config),releasePollMaxIntervalMs:maxPollIntervalMs,catalogRefreshIntervalMs,
    today:shanghaiDate(now),nextRelease:release.toISOString(),
    nextReleaseDay:shanghaiDate(release),nextReleaseTarget:shanghaiDate(release,2),
  };
}

export function makeInterfacePlan(config,input,now=new Date()) {
  if(!input||!['now','release'].includes(input.mode))throw new Error('请选择现在开始或本次等待放号');
  if(typeof input.autoPay!=='boolean'||typeof input.visible!=='boolean')throw new Error('确认方式配置不完整');
  if(!Array.isArray(input.fallbackSlots)||input.fallbackSlots.length>6)throw new Error('备选时段最多六个');
  const venue=configuredVenue(config);
  if(!Array.isArray(input.courts)||!input.courts.length||input.courts.length>venue.courtCount||input.courts.some(court=>!venue.courts.includes(court))||new Set(input.courts).size!==input.courts.length)throw new Error('请选择当前场馆的有效场号，至少一个且不可重复');
  const release=input.mode==='release'?nextRelease(now,'08:00:00',0):null;
  const slots=[input.slot,...input.fallbackSlots];
  if(new Set(slots).size!==slots.length)throw new Error('时段不能重复');
  const effective={...config,autoPay:input.autoPay,headless:!input.visible,daysAhead:2,bookingDelayMs:bookingDelayMs({bookingDelayMs:input.bookingDelayMs??config.bookingDelayMs}),candidates:slots.map(slot=>({slot,courts:input.courts}))};
  const reference=release||now;
  if(input.dateMode!==undefined&&!['auto','manual'].includes(input.dateMode))throw new Error('预约日期选择方式无效');
  const date=input.dateMode==='auto'?shanghaiDate(reference,2):input.date;
  if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(`${date}T12:00:00+08:00`))||new Date(`${date}T12:00:00+08:00`).toISOString().slice(0,10)!==date)throw new Error('预约日期格式无效');
  candidateTargets(effective,date,reference);
  return {config:effective,date,command:release?'at':'book',releaseAt:release?.toISOString()||null};
}
