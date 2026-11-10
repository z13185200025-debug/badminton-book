import {prewarmVenue} from './booking.mjs';
import {venueState,flushVenueEvidence,refreshVenueCatalog} from './venue-evidence.mjs';
import {historicalVenueIds,venueError,validateVenueDetail,validateVenueDay} from './venue-data.mjs';
import {matchesVenue,venueInfo} from './venues.mjs';

export function existingVenueCandidates(targets) {
  if(targets[0]?.venueMode==='fixed')return targets;
  const result=[];
  for(const target of targets)for(const id of [...new Set([target.venueId,...historicalVenueIds])]) {
    let venue;try{venue=venueInfo(id,target.venueEvidence);}catch{continue;}
    if(venue.courts.includes(target.court))result.push({...target,venueId:id,venueEvidence:undefined});
  }
  return result;
}

export async function createVenueRouter(initialPage,baseTargets,{log=()=>{},onPage=()=>{}}={}) {
  const base=baseTargets[0],pool=new Map([[base.venueId,{page:initialPage,warmed:false}]]);
  let catalog,active=[],lastRefresh=0,targets=[],announced='',lastSelected;
  const state=venueState(initialPage);
  // A saved URL may still render a convincing old hall even after removal from
  // the catalog. It is a read-only bootstrap; it cannot authorize selection.
  try{await prewarmVenue(initialPage,base,{log});pool.get(base.venueId).warmed=true;}
  catch(error){log('venue_probe_failed',{venueId:base.venueId,reason:error.message.slice(0,220)});}
  await flushVenueEvidence(initialPage);catalog=state.catalog;
  if(!catalog)throw venueError('未能取得当前官方羽毛球场馆目录，已停止新增预约','VENUE_CATALOG_UNAVAILABLE');

  async function applyCatalog(next) {
    catalog=next;lastRefresh=Date.now();
    const priority=Array.isArray(base.venuePriority)?base.venuePriority:historicalVenueIds;
    active=catalog.entries.filter(entry=>base.venueMode!=='fixed'||entry.id===base.venueId)
      .sort((a,b)=>{const rank=id=>priority.includes(id)?priority.indexOf(id):priority.length;return rank(a.id)-rank(b.id);});
    if(active.length>8)throw venueError('同时出现过多羽毛球场馆，请核对学校目录');
    const signature=JSON.stringify(active);
    if(signature!==announced){log('venue_catalog_checked',{eligible:active.map(v=>({id:v.id,name:v.name,courtCount:v.courtCount,advanceDays:v.advanceDays,reservationHour:v.reservationHour})),rejected:catalog.rejected});announced=signature;}
    const available=[];
    for(const entry of active) {
      let item=pool.get(entry.id);
      if(!item){const page=await initialPage.context().newPage();onPage(page);item={page,warmed:false};pool.set(entry.id,item);}
      item.entry=entry;
      const target={...base,venueId:entry.id,venueName:entry.name,venueEvidence:entry};
      try {
        const data=venueState(item.page);
        const reusable=item.warmed&&(data.protocolCode||'')===entry.protocol&&matchesVenue(await item.page.locator('body').innerText(),target);
        if(!reusable)await prewarmVenue(item.page,target,{log});
        const evidence=await flushVenueEvidence(item.page);
        validateVenueDetail(evidence.details.get(entry.id),target);
        for(const day of evidence.days.values())if(!day.gate)validateVenueDay(day,target);
        item.warmed=true;available.push(entry);
      }catch(error){item.warmed=false;log('venue_probe_failed',{venueId:entry.id,reason:error.message.slice(0,220)});}
    }
    targets=[];
    // Keep the user's time preference first, then venue priority, then courts.
    for(const slot of [...new Set(baseTargets.map(t=>t.slot))])for(const entry of available)for(const original of baseTargets.filter(t=>t.slot===slot)) {
      if(entry.courtCount&&Number(original.court.slice(3))>entry.courtCount)continue;
      targets.push({...original,venueId:entry.id,venueName:entry.name,venueEvidence:entry});
    }
    log('venue_candidates_ready',{venueIds:available.map(v=>v.id),count:targets.length});
  }
  await applyCatalog(catalog);
  return {
    get targets(){return targets;},get entries(){return active;},
    async refresh({force=false}={}){
      if(!force&&Date.now()-lastRefresh<2000)return false;
      const before=JSON.stringify(targets.map(t=>[t.venueId,t.court,t.slot]));
      await applyCatalog(await refreshVenueCatalog(initialPage));
      return before!==JSON.stringify(targets.map(t=>[t.venueId,t.court,t.slot]));
    },
    async pageFor(target) {
      const item=pool.get(target.venueId);
      if(item){const url=new URL(item.page.url());if(url.origin!==target.origin||url.pathname!==`/venue/venue-reservation/${target.venueId}`)throw venueError('场馆页面入口已变化','VENUE_CHANGED');}
      if(!active.some(v=>v.id===target.venueId)||!item?.warmed)throw venueError('候选场馆已从当前可预约目录移除','VENUE_CHANGED');
      if(!matchesVenue(await item.page.locator('body').innerText(),target))throw venueError('页面标题与本次选定的官方场馆不一致','VENUE_CHANGED');
      if(lastSelected!==target.venueId){
        lastSelected=target.venueId;const e=item.entry;
        log('venue_detected',{venueId:e.id,venueName:e.name,parentVenueId:e.parentVenueId,campusId:e.campusId,sportType:e.sportType,courtCount:e.courtCount,advanceDays:e.advanceDays,reservationHour:e.reservationHour,protocol:e.protocol,source:e.source});
      }
      return item.page;
    },
  };
}
