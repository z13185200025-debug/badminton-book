import {venueInfo,matchesVenue,matchesSession} from './venues.mjs';

export function shanghaiDate(now = new Date(), offset = 0) {
  const day = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const value = new Date(`${day}T12:00:00+08:00`);
  value.setUTCDate(value.getUTCDate()+offset);
  return new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(value);
}

export function assertZero(text) {
  const value = String(text).trim().replace(/[¥￥,\s]/g,'').replace(/(?:CNY|元)$/i,'');
  if (!/^\d+(?:\.\d{1,2})?$/.test(value) || Number(value)!==0) {
    throw new Error(`金额不是明确的零元，停止操作：${text}`);
  }
  return 0;
}

export function orderFromCells(cells) {
  if(cells.length !== 10) return null;
  const number = cells[1].match(/\bD\d+\b/)?.[0];
  if(!number) return null;
  return {number,venue:cells[2],date:cells[3].trim(),session:cells[4].trim(),payment:cells[5].trim(),status:cells[6].trim(),amount:cells[7].trim(),createdAt:cells[8].trim()};
}

export function cancelled(order) {return /cancelled|canceled|已取消|已关闭|已退款/i.test(order.status);}
export function paid(order) {return /^(paid|已支付|已付款|支付成功)$/i.test(order.payment) && /^(normal|正常|有效)$/i.test(order.status);}
export function sameTarget(order, target) {
  return order.date === target.date && matchesVenue(order.venue,target) && matchesSession(order.session,target);
}
export function activeForDay(orders, target) {
  return orders.filter(o=>o.date===target.date && /Badminton|羽毛球/i.test(o.venue) && !cancelled(o));
}
export function decideExisting(orders, target) {
  const active = activeForDay(orders,target);
  if(active.length>1) throw new Error('同一天存在多笔有效羽毛球订单，需人工核对');
  if(!active.length) return {action:'create'};
  const order = active[0];
  if(!sameTarget(order,target)) throw new Error('同一天已有其他羽毛球预约，停止新增');
  assertZero(order.amount);
  if(paid(order)) return {action:'done',order};
  if(/^(unpaid|未支付|待支付)$/i.test(order.payment)) return {action:'resume',order};
  throw new Error(`无法确认已有订单状态：${order.payment}/${order.status}`);
}

export function candidateTargets(config,date,now=new Date()) {
  const choices=config.candidates||[{slot:config.slot,courts:[config.court,...(config.backupCourts||[])]}];
  if(!choices.length)throw new Error('至少配置一个候选时段');
  const result=[];
  for(const choice of choices) {
    if(!Array.isArray(choice.courts)||!choice.courts.length)throw new Error('每个候选时段至少配置一个场号');
    for(const court of choice.courts) {
      const target=validateTarget({...config,court,slot:choice.slot},date,now);
      if(!result.some(t=>t.court===court&&t.slot===choice.slot))result.push(target);
    }
  }
  if(result.length>63)throw new Error('候选场次过多，请控制在 63 个以内');
  return result;
}

export function nextRelease(now,releaseTime='08:00:00',lateSeconds=120) {
  let day=shanghaiDate(now),at=new Date(`${day}T${releaseTime}+08:00`);
  if(now.getTime()>at.getTime()+lateSeconds*1000) {
    day=shanghaiDate(now,1);at=new Date(`${day}T${releaseTime}+08:00`);
  }
  return at;
}
export function decideExistingCandidates(orders,targets) {
  const active=activeForDay(orders,targets[0]);
  if(active.length>1)throw new Error('同一天存在多笔有效羽毛球订单，需人工核对');
  if(!active.length)return {action:'create',target:targets[0]};
  const target=targets.find(t=>sameTarget(active[0],t));
  if(!target)throw new Error('同一天已有不在候选列表中的羽毛球预约，停止新增');
  return {...decideExisting(orders,target),target};
}

export function validateTarget(config, date, now = new Date()) {
  const venue=venueInfo(config.venueId);
  if(config.origin !== 'https://hzsm.buaa.edu.cn' || config.maxAmount !== 0) throw new Error('脚本仅支持学校羽毛球馆的零元预约');
  if(!venue.courts.includes(config.court) || !/^\d{2}:00-\d{2}:00$/.test(config.slot)) throw new Error('场号或时段格式不合法');
  const [start,end] = config.slot.split('-').map(s=>Number(s.slice(0,2)));
  if(start<8||end>22||end-start!==1) throw new Error('仅允许一个小时的场次');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date) || date<shanghaiDate(now)||date>shanghaiDate(now,2)) throw new Error('预约日期不在当前三天窗口内');
  if(!config.schoolAutomationPermissionConfirmed) throw new Error('必须先取得学校允许自动化的授权');
  return {...config,date};
}
