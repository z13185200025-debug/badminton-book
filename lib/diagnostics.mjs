import {CaptchaEvidence} from './captcha-evidence.mjs';

const tracked=/\/api\/(?:protocols\/code\/|reservation\/(?:day\/info|campus\/venue\/info|order\/submit)|captcha\/(?:get|check)|orders\/mine)/;
const observers=new WeakMap();
export const requestDiagnostics=page=>observers.get(page);

export function observeRequests(page, log) {
  if(observers.has(page))return observers.get(page).stop;
  const starts=new WeakMap(),pending=new Set(),captcha=new CaptchaEvidence(log);
  const begin=request=>{
    const endpoint=new URL(request.url()).pathname;
    if(!tracked.test(endpoint))return;
    const item={endpoint,at:performance.now()};starts.set(request,item);
    let data;try{data=request.postDataJSON();}catch{}
    if(endpoint.endsWith('/api/captcha/check'))item.check=captcha.beginCheck(data);
    if(endpoint.endsWith('/api/reservation/order/submit'))log('order_submit_started',captcha.inspect(data));
  };
  const finish=async request=>{
    const item=starts.get(request);if(!item)return;
    const response=await request.response().catch(()=>null),at=performance.now();
    log('request_finished',{endpoint:item.endpoint,durationMs:Math.round(at-(item.dispatchedAt??item.at)),totalDurationMs:Math.round(at-item.at),httpStatus:response?.status()??null});
    if(item.endpoint.endsWith('/api/captcha/get')&&response) {
      const body=await response.json().catch(()=>null);captcha.issued(body?.data??body,at);
    }
    if(item.endpoint.endsWith('/api/captcha/check')&&response) {
      const body=await response.json().catch(()=>null);captcha.finishCheck(item.check,body?.data??body,at);
    }
    if(item.endpoint.includes('/api/protocols/code/')&&response) {
      const body=await response.json().catch(()=>null),data=body?.data;
      if(data)log('notice_settings',{autoPopup:!!data.autoPopup,staySec:data.staySec??null,noAllowClose:!!data.noAllowClose});
    }
  };
  const finished=request=>{
    const job=finish(request);pending.add(job);
    job.catch(()=>{}).finally(()=>pending.delete(job));
  };
  const failed=request=>{const item=starts.get(request);if(item)log('request_failed',{endpoint:item.endpoint,durationMs:Math.round(performance.now()-(item.dispatchedAt??item.at)),errorText:request.failure?.()?.errorText??null});};
  const observer={
    inspect:data=>captcha.inspect(data),
    flush:async()=>{while(pending.size)await Promise.allSettled([...pending]);},
    dispatched(request){
      const item=starts.get(request);if(item)item.dispatchedAt=performance.now();
      let data;try{data=request.postDataJSON();}catch{}
      log('order_submit_dispatched',{...captcha.inspect(data),clientHoldMs:item?Math.round(item.dispatchedAt-item.at):null});
    },
    stop(){page.off('request',begin);page.off('requestfinished',finished);page.off('requestfailed',failed);page.off('close',observer.stop);observers.delete(page);captcha.clear();},
  };
  observers.set(page,observer);
  page.on('request',begin);page.on('requestfinished',finished);page.on('requestfailed',failed);page.on('close',observer.stop);
  return observer.stop;
}
