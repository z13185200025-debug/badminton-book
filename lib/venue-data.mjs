// Only public venue/schedule fields survive parsing. Tokens, people, phone
// numbers and order details never enter discovery state or telemetry.
export const BADMINTON_SPORT=156;
export const CAMPUS_ID=187;
export const historicalVenueIds=[1,346];
export const isBadminton=value=>/羽毛球|badminton/i.test(String(value||''));
export const normalizeText=value=>String(value??'').normalize('NFKC').replace(/\s+/g,' ').trim();
const number=value=>value===null||value===undefined||value===''?null:Number(value);
const positive=value=>Number.isInteger(number(value))&&number(value)>0?number(value):null;
const enabled=value=>value===true||number(value)===1;
const safeText=value=>normalizeText(value).slice(0,240);
export const venueError=(message,code='VENUE_IDENTITY_CONFLICT')=>Object.assign(new Error(message),{code});
export const releaseGate=value=>/(?:当日|当天|今日).{0,12}(?:8|八|08).{0,12}(?:以后|之后|后).{0,12}(?:查看|预约)|尚未(?:开放|开始)|未到.{0,8}(?:开放|预约|放号)时间|(?:after|from)\s*0?8(?::00)?\s*(?:am)?|not\s+(?:yet\s+)?open/i.test(String(value||''));
export const movedNotice=value=>/场[地馆].{0,16}(?:移至|迁移|迁至|恢复至|返回)|(?:移回|迁回|恢复到).{0,16}(?:训练|篮球|羽毛球)|court.{0,24}relocat/i.test(String(value||''));
export function courtNumber(value) {
  const match=normalizeText(value).match(/^(?:No\.?\s*(\d{1,2})|第?\s*(\d{1,2})\s*号(?:场(?:地)?)?)(?:\s|\(|$)/i);
  return match?positive(match[1]||match[2]):null;
}

export function parseVenueCatalog(body,{sportType=BADMINTON_SPORT,campusId=CAMPUS_ID}={}) {
  if(Number(body?.code)!==200||!body?.data?.venueSiteInfo||typeof body.data.venueSiteInfo!=='object')throw venueError('官方场馆目录未完整返回，不能据旧链接决定场馆','VENUE_CATALOG_UNAVAILABLE');
  const entries=[],rejected=[],seen=new Set();
  for(const group of Object.values(body.data.venueSiteInfo)) {
    if(!Array.isArray(group))throw venueError('官方场馆目录结构已变化','VENUE_CATALOG_UNAVAILABLE');
    for(const raw of group) {
      const id=positive(raw.id??raw.venueSiteId),reasons=[];
      if(!id){rejected.push({id:null,reasons:['缺少场地 ID']});continue;}
      if(seen.has(id))throw venueError(`官方目录中的场地 ID ${id} 重复`);seen.add(id);
      // venueId is the parent venue/category, NOT the reservation route ID.
      if(raw.venueSiteId!=null&&positive(raw.venueSiteId)!==id)reasons.push('场地 ID 字段冲突');
      if(number(raw.sportType)!==sportType)reasons.push('运动类型不符');
      if(number(raw.campusId)!==campusId)reasons.push('校区不符');
      if(!isBadminton(raw.siteName)&&!isBadminton(raw.enSiteName))reasons.push('场地中英文名称未确认羽毛球');
      if(raw.sportName&&!isBadminton(raw.sportName))reasons.push('运动名称不符');
      if(!enabled(raw.isSupportReservation))reasons.push('未启用预约');
      if(enabled(raw.notShowSite)||enabled(raw.deleted)||enabled(raw.isDeleted)||enabled(raw.disabled)||raw.enabled===false)reasons.push('场地已隐藏或停用');
      const courtCount=positive(raw.spaceCount);
      if(courtCount!==null&&courtCount>99)reasons.push('场号数量异常');
      if(reasons.length){rejected.push({id,reasons});continue;}
      entries.push({id,parentVenueId:positive(raw.venueId),campusId,sportType,
        name:safeText(raw.siteName),enName:safeText(raw.enSiteName),courtCount,
        advanceDays:number(raw.advanceDay),reservationHour:number(raw.reservationHour),
        openStart:safeText(raw.openStartDate),openEnd:safeText(raw.openEndDate),
        protocol:safeText(raw.reservationProtocolCode),isFee:number(raw.isFee),
        maxSessions:number(raw.reservationSpaceCount),maxPerDay:number(raw.equalReservationNumMax),
        verified:true,source:'official-catalog'});
    }
  }
  return {entries,rejected,advanceDays:number(body.data.advanceReservationDays)};
}

export function parseVenueDay(body,{httpStatus=200,requestId,requestDate}={}) {
  const message=safeText(body?.message||body?.messageEn||body?.msg);
  if(httpStatus!==200||Number(body?.code)!==200) {
    return {requestId,requestDate,code:body?.code,httpStatus,message,gate:releaseGate(message),ok:false,rows:[],dates:[]};
  }
  const data=body.data;
  if(!data||typeof data!=='object')return {requestId,requestDate,ok:false,message:'场次数据为空',rows:[],dates:[]};
  const site=data.siteParam||{},id=positive(site.venueSiteId),rows=[];
  const times=new Map((Array.isArray(data.spaceTimeInfo)?data.spaceTimeInfo:[]).map(t=>[String(t.id),`${t.beginTime}-${t.endTime}`]));
  const map=data.reservationDateSpaceInfo||{};
  for(const [date,items] of Object.entries(map)) {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Array.isArray(items))continue;
    for(const row of items) {
      const cn=safeText(row.spaceName),en=safeText(row.enSpaceName),cnNo=courtNumber(cn),enNo=courtNumber(en);
      if(cnNo&&enNo&&cnNo!==enNo)throw venueError('排期中的中英文场号不一致');
      const cells=[];
      for(const [timeId,cell] of Object.entries(row)) {
        if(!cell||typeof cell!=='object'||!times.has(timeId))continue;
        cells.push({timeId:positive(timeId),slot:times.get(timeId),status:number(cell.reservationStatus),fee:number(cell.orderFee),
          start:safeText(cell.startDate),end:safeText(cell.endDate),blocked:enabled(cell.takeUp)||enabled(cell.adminTake),
          notice:movedNotice(cell.takeUpExplain)||movedNotice(cell.adminRemark)?'学校排期提示场馆迁移':''});
      }
      rows.push({date,siteId:positive(row.venueSiteId),spaceId:positive(row.id),court:cnNo||enNo?`No.${cnNo||enNo}`:null,labels:[cn,en].filter(Boolean),cells});
    }
  }
  return {requestId,requestDate,ok:true,id,name:safeText(site.siteName),parentName:safeText(site.venueName),campusName:safeText(site.campusName),
    advanceDays:number(data.advanceReservationDays),reservationHour:number(site.reservationHour),
    dates:Object.keys(map),reservationDates:(data.reservationDateList||[]).filter(d=>typeof d==='string'),rows,
    isFee:number(data.isFee),notReserveType:data.notReserveType??null,blocked:enabled(data.isTakeUp),notice:movedNotice(data.takeUpExplain)?'学校排期提示场馆迁移':'',
    gate:false,code:body.code,httpStatus};
}

export function validateVenueDay(day,target,{requireDate=false}={}) {
  if(!day)return;
  if(!day.ok)throw venueError(day.message||'场次查询没有成功',day.gate?'RELEASE_NOT_OPEN':'VENUE_DATA_UNAVAILABLE');
  if(day.requestId!==target.venueId||day.id!==target.venueId||day.rows.some(row=>row.siteId!==target.venueId))throw venueError('目录、请求参数、siteParam 或场号所属场地 ID 不一致');
  if(!isBadminton(day.name))throw venueError('排期场地名称不再是羽毛球场馆');
  const expected=target.venueEvidence;
  if(expected?.verified&&day.name&&![expected.name,expected.enName].map(normalizeText).includes(normalizeText(day.name)))throw venueError('场馆目录与排期中的场地名称不一致');
  if(requireDate&&day.requestDate!==target.date)throw venueError('排期响应不属于当前目标日期');
  if(requireDate&&(day.blocked||day.notReserveType!==null&&Number(day.notReserveType)!==0))throw venueError(day.notice||'本日场馆暂停预约',movedNotice(day.notice)?'VENUE_MOVED':'VENUE_UNAVAILABLE');
  if(movedNotice(day.notice))throw venueError(day.notice,'VENUE_MOVED');
}

export function verifyScheduleCell(day,target) {
  validateVenueDay(day,target,{requireDate:true});
  if(!day)return null;
  const rows=day.rows.filter(row=>row.date===target.date&&row.court===target.court);
  if(!rows.length)throw venueError('目标日期排期中没有此场号','UNAVAILABLE');
  if(rows.length!==1)throw venueError('目标场号在排期中不唯一');
  const row=rows[0],cells=row.cells.filter(cell=>cell.slot===target.slot);
  if(cells.length!==1)throw venueError('目标时段在排期中缺失或不唯一','UNAVAILABLE');
  const cell=cells[0];
  if(movedNotice(cell.notice))throw venueError(cell.notice,'VENUE_MOVED');
  if(cell.status!==1||cell.blocked)throw venueError('排期接口显示场次不可预约','UNAVAILABLE');
  if(cell.fee!==null&&cell.fee!==0)throw venueError('排期金额不是零元');
  if(cell.start!==`${target.date} ${target.slot.split('-')[0]}`||cell.end!==`${target.date} ${target.slot.split('-')[1]}`)throw venueError('排期日期或时段与目标不一致');
  if(!row.spaceId||!cell.timeId)throw venueError('排期缺少场地或时间段标识');
  return {spaceId:row.spaceId,timeId:cell.timeId,labels:row.labels};
}

export function validateVenueDetail(body,target) {
  if(Number(body?.code)!==200||!body?.data||typeof body.data!=='object')throw venueError('场馆详情接口未返回有效资料','VENUE_DATA_UNAVAILABLE');
  const parsed=parseVenueCatalog({code:200,data:{venueSiteInfo:{site:[body.data]}}});
  const detail=parsed.entries[0],expected=target.venueEvidence;
  if(!detail||detail.id!==target.venueId)throw venueError('场馆详情的运动类型、校区、可预约标志或场地 ID 不符');
  if(expected?.verified)for(const key of ['parentVenueId','campusId','sportType','name','enName','protocol']) {
    if(detail[key]&&expected[key]&&detail[key]!==expected[key])throw venueError(`场馆目录与详情字段不一致：${key}`);
  }
  return detail;
}

export function validateSubmissionPayload(payload,target) {
  if(!payload||!target.scheduleCell)throw venueError('缺少已核验场次，停止提交');
  if(number(payload.venueSiteId)!==target.venueId||payload.reservationDate!==target.date)throw venueError('提交参数的场馆或日期与已核验目标不一致');
  let cells;try{cells=typeof payload.reservationOrderJson==='string'?JSON.parse(payload.reservationOrderJson):payload.reservationOrderJson;}catch{throw venueError('提交场次格式无法识别');}
  if(!Array.isArray(cells)||cells.length!==1||number(cells[0].spaceId)!==target.scheduleCell.spaceId||number(cells[0].timeId)!==target.scheduleCell.timeId)throw venueError('提交的场地或时段 ID 与排期不一致');
  if(cells[0].venueSpaceGroupId!=null&&Number(cells[0].venueSpaceGroupId)!==0)throw venueError('提交意外包含整组场地');
  for(const key of ['totalAmt','orderPrice'])if(payload[key]!=null&&payload[key]!==''&&number(payload[key])!==0)throw venueError('提交金额不是零元');
  return true;
}
