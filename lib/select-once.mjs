import {refreshAvailability,prepareSelection} from './booking.mjs';

export async function selectCandidateOnce(router,{refresh=false,deadline,stopped=()=>false,onCandidate=()=>{},log=()=>{}}={}) {
  const targets=router.targets,refreshed=new Set();
  if(!targets.length)throw new Error('没有已核验的可用场馆，停止本次运行，不重复查询');
  for(const [index,target] of targets.entries()) {
    if(stopped())throw new Error('本次任务已停止');
    if(deadline&&Date.now()>=deadline)throw new Error('已超过本次放号窗口，停止查询');
    onCandidate(target);
    log('candidate_try',{venueId:target.venueId,venueName:target.venueName,court:target.court,slot:target.slot,index:index+1,total:targets.length});
    const page=await router.pageFor(target);
    if(refresh&&!refreshed.has(target.venueId)) {
      await refreshAvailability(page,target,{log});
      refreshed.add(target.venueId);
    }
    try {
      await prepareSelection(page,target,{log});
      return {page,target};
    } catch(error) {
      if(error.code!=='UNAVAILABLE')throw error;
      log('candidate_unavailable',{court:target.court});
    }
  }
  throw new Error('本轮所有候选场地均不可用，已停止，不刷新或重复查询');
}
