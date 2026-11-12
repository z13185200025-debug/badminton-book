import {parseVenueCatalog,parseVenueDay,BADMINTON_SPORT,venueError} from './venue-data.mjs';
import {assertNotRateLimited} from './polling.mjs';

const states=new WeakMap();
const catalogPath='/venue-server/api/reservation/campus/venue/info';
const dayPath='/venue-server/api/reservation/day/info';
export function venueState(page) {
  if(states.has(page))return states.get(page);
  const state={catalog:null,catalogRequest:null,days:new Map(),details:new Map(),pending:new Set(),errors:[],generation:0};states.set(page,state);
  page.on('request',request=>{const url=new URL(request.url());if(url.origin==='https://hzsm.buaa.edu.cn'&&url.pathname.includes('/api/protocols/code/'))state.protocolCode=url.pathname.split('/').at(-1);});
  page.on('response',response=>{
    const url=new URL(response.url());
    const detailId=url.pathname.match(/^\/venue-server\/api\/front\/website\/venue_sites\/(\d+)$/)?.[1];
    if(url.origin!=='https://hzsm.buaa.edu.cn'||!detailId&&![catalogPath,dayPath].includes(url.pathname))return;
    const generation=state.generation;
    const task=(async()=>{
      const body=await response.json().catch(()=>null);if(generation!==state.generation)return;
      assertNotRateLimited(body,response.status());
      if(detailId){
        // Retain only identity fields; the response also contains irrelevant contacts.
        const fields=['id','venueSiteId','siteName','enSiteName','venueId','campusId','sportType','sportName','isSupportReservation','notShowSite','disabled','deleted','isDeleted','enabled','reservationProtocolCode'];
        state.details.set(Number(detailId),{code:body?.code,data:body?.data&&Object.fromEntries(fields.map(k=>[k,body.data[k]]))});
      } else if(url.pathname===catalogPath&&Number(url.searchParams.get('sportType'))===BADMINTON_SPORT){
        state.catalog=parseVenueCatalog(body);state.catalogAt=Date.now();
        const headers=response.request().headers();
        state.catalogRequest={url:url.href,headers:Object.fromEntries(Object.entries(headers).filter(([key])=>!/^sec-|^cookie$|^host$|^origin$|^referer$|^user-agent$|^accept-encoding$|^connection$|^content-length$/i.test(key)))};
      } else if(url.pathname===dayPath) {
        const requestId=Number(url.searchParams.get('venueSiteId')),requestDate=url.searchParams.get('searchDate');
        // Fixtures without a real API envelope deliberately omit the schema.
        if(body?.data||body?.code!==undefined&&Number(body.code)!==200)state.days.set(`${requestId}/${requestDate}`,parseVenueDay(body,{httpStatus:response.status(),requestId,requestDate}));
      }
    })().catch(error=>{state.errors.push(error);});
    state.pending.add(task);task.finally(()=>state.pending.delete(task));
  });
  return state;
}
export async function flushVenueEvidence(page) {
  const state=venueState(page);await Promise.all([...state.pending]);
  if(state.errors.length)throw state.errors.shift();return state;
}
export function resetVenueEvidence(page) {
  const state=venueState(page);state.generation++;state.days.clear();state.details.clear();state.errors=[];state.protocolCode='';
  state.catalog=null;state.catalogRequest=null;
}
export async function refreshVenueCatalog(page) {
  const state=await flushVenueEvidence(page),request=state.catalogRequest;
  if(!request)throw venueError('没有取得学校羽毛球官方目录的请求信息','VENUE_CATALOG_UNAVAILABLE');
  // The school signs each request with its timestamp and query. Use its normal
  // read-only GET helper so a five-minute preheat never replays an old signature.
  const result=await page.evaluate(async({url,headers})=>{
    const roots=[...document.querySelectorAll('*')].map(el=>el.__vue__).filter(Boolean);
    const vm=roots.find(vm=>typeof vm.commonMethods?.emitAjax==='function');
    if(vm)return await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('官方场馆目录查询超时')),10000);
      const done=value=>{clearTimeout(timer);resolve(value);};
      vm.commonMethods.emitAjax({path:'/api/reservation/campus/venue/info',type:'GET',data:{sportType:156},notPopUp:true,errorTipExecuteCallback:true,
        success:data=>done({status:200,body:{code:200,data}}),error:error=>done({status:200,body:{code:error?.code||400,message:error?.message||'官方场馆目录查询失败'}})});
    });
    // Unsigned installations and isolated fixtures can use an ordinary GET.
    // Never mutate or replay a signed request if the site's helper is missing.
    if(Object.keys(headers).some(key=>/^(sign|timestamp|app-key)$/i.test(key)))throw new Error('学校请求组件已变化，无法刷新场馆目录');
    const fresh=new URL(url);fresh.searchParams.set('nocache',String(Date.now()));
    const response=await fetch(fresh,{headers,credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(10000)});
    return {status:response.status,body:await response.json()};
  },{url:request.url,headers:request.headers});
  assertNotRateLimited(result.body,result.status);
  if(result.status!==200||Number(result.body?.code)!==200)throw venueError(`场馆目录查询失败（HTTP ${result.status}，业务码 ${result.body?.code??'未知'}）`,'VENUE_CATALOG_UNAVAILABLE');
  state.catalog=parseVenueCatalog(result.body);state.catalogAt=Date.now();return state.catalog;
}
export async function dayEvidence(page,target) {
  const state=await flushVenueEvidence(page);return state.days.get(`${target.venueId}/${target.date}`);
}
