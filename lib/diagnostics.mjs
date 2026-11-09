const tracked = /\/api\/(?:protocols\/code\/|reservation\/(?:day\/info|campus\/venue\/info|order\/submit)|captcha\/(?:get|check)|orders\/mine)/;

// Sensitive values stay in memory solely for equality checks. Never record
// headers, tokens, challenge images, encrypted proofs or form bodies.
export function observeRequests(page, log) {
  const starts=new WeakMap();
  let challenge=null,checked=null,sequence=0;
  const begin=request=>{
    const endpoint=new URL(request.url()).pathname;
    if(!tracked.test(endpoint))return;
    const at=performance.now();starts.set(request,{endpoint,at});
    let data;try{data=request.postDataJSON();}catch{}
    if(endpoint.endsWith('/api/captcha/check')) {
      checked={token:data?.token,at,passed:false};
      log('captcha_check_started',{challengeSequence:challenge?.sequence??null,tokenMatchesChallenge:!!data?.token&&data.token===challenge?.token,challengeAgeMs:challenge?Math.round(at-challenge.at):null});
    }
    if(endpoint.endsWith('/api/reservation/order/submit'))log('order_submit_started',{
      challengeSequence:challenge?.sequence??null,
      hasCaptchaVerification:typeof data?.captchaVerification==='string'&&data.captchaVerification.length>0,
      tokenMatchesChecked:!!data?.captchaToken&&data.captchaToken===checked?.token,
      checkPassed:checked?.passed===true,
      afterCheckMs:checked?.completedAt?Math.round(at-checked.completedAt):null,
    });
  };
  const finish=async request=>{
    const item=starts.get(request);if(!item)return;
    const response=await request.response().catch(()=>null);
    log('request_finished',{endpoint:item.endpoint,durationMs:Math.round(performance.now()-item.at),httpStatus:response?.status()??null});
    if(item.endpoint.endsWith('/api/captcha/get')&&response) {
      const body=await response.json().catch(()=>null),data=body?.data??body;
      if(data?.repCode==='0000'&&data.repData?.token) {
        challenge={token:data.repData.token,at:performance.now(),sequence:++sequence};
        log('captcha_issued',{challengeSequence:sequence});
      }
    }
    if(item.endpoint.endsWith('/api/captcha/check')&&response) {
      const body=await response.json().catch(()=>null),data=body?.data??body;
      if(checked){checked.passed=String(data?.repCode)==='0000';checked.completedAt=performance.now();}
    }
    if(item.endpoint.includes('/api/protocols/code/')&&response) {
      const body=await response.json().catch(()=>null),data=body?.data;
      if(data)log('notice_settings',{autoPopup:!!data.autoPopup,staySec:data.staySec??null,noAllowClose:!!data.noAllowClose});
    }
  };
  const failed=request=>{const item=starts.get(request);if(item)log('request_failed',{endpoint:item.endpoint,durationMs:Math.round(performance.now()-item.at),errorText:request.failure?.()?.errorText??null});};
  page.on('request',begin);page.on('requestfinished',finish);page.on('requestfailed',failed);
  return ()=>{page.off('request',begin);page.off('requestfinished',finish);page.off('requestfailed',failed);};
}
