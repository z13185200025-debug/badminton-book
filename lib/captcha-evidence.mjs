import {createDecipheriv} from 'node:crypto';

export const captchaRecoveryTiming=Object.freeze({readyWaitMs:600,afterCheckMs:1000});

function decodeObserved(value,key) {
  if(typeof value!=='string')throw new Error('Missing observed value');
  if(!key)return value;
  const bytes=Buffer.from(key,'utf8');
  if(![16,24,32].includes(bytes.length))throw new Error('Unsupported key format');
  const decipher=createDecipheriv(`aes-${bytes.length*8}-ecb`,bytes,null);
  return Buffer.concat([decipher.update(value,'base64'),decipher.final()]).toString('utf8');
}

// Compare values produced by the website; never create or alter a proof.
// Tokens, keys and coordinates are short-lived memory only, never diagnostics.
export class CaptchaEvidence {
  constructor(log=()=>{},now=()=>performance.now()) {
    this.log=log;this.now=now;this.challenges=new Map();this.checks=new Map();this.sequence=0;
  }
  issued(data,at=this.now()) {
    if(String(data?.repCode)!=='0000'||!data.repData?.token)return;
    const {token,secretKey}=data.repData;
    const challenge={token,secretKey,at,sequence:++this.sequence};
    this.challenges.set(token,challenge);
    const check=this.checks.get(token);if(check&&!check.challenge)check.challenge=challenge;
    while(this.challenges.size>8)this.challenges.delete(this.challenges.keys().next().value);
    this.log('captcha_issued',{challengeSequence:challenge.sequence});
  }
  beginCheck(data) {
    const challenge=this.challenges.get(data?.token);
    const check={token:data?.token,challenge,pointJson:data?.pointJson,at:this.now(),passed:false};
    if(check.token)this.checks.set(check.token,check);
    while(this.checks.size>8)this.checks.delete(this.checks.keys().next().value);
    this.log('captcha_check_started',{challengeSequence:challenge?.sequence??null,tokenMatchesChallenge:!!challenge,challengeAgeMs:challenge?Math.round(check.at-challenge.at):null});
    return check;
  }
  finishCheck(check,data,at=this.now()) {
    if(!check)return;
    check.passed=String(data?.repCode)==='0000';check.completedAt=at;
    this.log('captcha_check_finished',{challengeSequence:check.challenge?.sequence??null,checkPassed:check.passed,checkDurationMs:Math.round(check.completedAt-check.at),challengeAgeMs:check.challenge?Math.max(0,Math.round(check.at-check.challenge.at)):null});
  }
  inspect(data) {
    const check=this.checks.get(data?.captchaToken),challenge=check?.challenge;
    let proofStatus='unavailable';
    if(check?.pointJson&&challenge&&typeof data?.captchaVerification==='string') {
      try {
        const point=decodeObserved(check.pointJson,challenge.secretKey);
        const coords=JSON.parse(point);
        if(!Number.isFinite(coords.x)||!Number.isFinite(coords.y))throw new Error('Unsupported point format');
        proofStatus=decodeObserved(data.captchaVerification,challenge.secretKey)===`${check.token}---${point}`?'matched':'mismatched';
      } catch {proofStatus='unreadable';}
    }
    return {
      challengeSequence:challenge?.sequence??null,
      hasCaptchaVerification:typeof data?.captchaVerification==='string'&&data.captchaVerification.length>0,
      tokenMatchesChecked:!!check,
      hasObservedCheck:this.checks.size>0,
      checkPassed:check?.passed===true,
      afterCheckMs:Number.isFinite(check?.completedAt)?Math.round(this.now()-check.completedAt):null,
      challengeAgeMs:challenge?Math.round(check.at-challenge.at):null,
      checkDurationMs:Number.isFinite(check?.completedAt)?Math.round(check.completedAt-check.at):null,
      refreshedSinceCheck:challenge?challenge.sequence!==this.sequence:null,
      proofStatus,
    };
  }
  clear(){this.challenges.clear();this.checks.clear();}
}
