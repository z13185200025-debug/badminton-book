import {normalizeText,courtNumber,isBadminton} from './venue-data.mjs';
export const CURRENT_VENUE_ID=1;
const venues={
  1:{id:1,name:'羽毛球馆（原训练馆）',courtCount:4},
  346:{id:346,name:'羽毛球馆（篮球馆一层）',courtCount:9},
};
export function venueInfo(id,evidence){
  const venue=evidence?.verified&&evidence.id===id?{...evidence,name:evidence.name,courtCount:evidence.courtCount||9}:venues[id];
  if(!venue||!Number.isInteger(id))throw new Error('场馆未经核验，仅支持学校已确认的羽毛球场馆');
  return {...venue,courts:Array.from({length:venue.courtCount},(_,i)=>`No.${i+1}`)};
}
export function configuredVenue(config) {
  if(config.venueMode==='fixed')return venueInfo(config.venueId);
  return {id:config.venueId,name:'自动识别学校当前羽毛球场馆（训练场 / 篮球场）',courtCount:9,courts:Array.from({length:9},(_,i)=>`No.${i+1}`)};
}

// The new venue currently labels courts 1–5 with Basketball Hall and 6–9
// with Badminton Training Hall. Bind the venue to its page/order title;
// accept only these known display suffixes when identifying the court number.
const suffix='(?:Basketball\\s+Hall|Badminton\\s+Training\\s+Hall|(?:室内)?篮球[场馆]|(?:羽毛球)?训练[场馆]|羽毛球馆)';
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function courtLabelPattern(court,labels=[]){
  if(!/^No\.[1-9]\d?$/.test(court))throw new Error('场号格式不合法');
  if(labels.length)return new RegExp(`^\\s*(?:${labels.filter(label=>courtNumber(label)===Number(court.slice(3))).map(label=>escape(normalizeText(label)).replaceAll('\\(','[（(]').replaceAll('\\)','[)）]')).join('|')})\\s*$`,'i');
  const n=Number(court.slice(3));
  return new RegExp(`^\\s*(?:No\\.?\\s*${n}|第?\\s*${n}\\s*号(?:场(?:地)?)?)\\s*(?:[（(]\\s*${suffix}\\s*[)）])?\\s*$`,'i');
}
export function sessionsIn(text){
  const pattern=/(No\.?\s*\d{1,2}|第?\d{1,2}号(?:场(?:地)?)?)(\s*\([^()\r\n]+\))?\s*(?::\s*|\s+)(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})/gi;
  return [...String(text).normalize('NFKC').matchAll(pattern)].map(match=>({court:`No.${courtNumber(match[1])}`,slot:match[3].padStart(5,'0')+'-'+match[4].padStart(5,'0'),label:match[1]+(match[2]||'')}));
}
export function matchesSession(text,target){
  const sessions=sessionsIn(text);
  return sessions.length===1&&sessions[0].court===target.court&&sessions[0].slot===target.slot&&courtLabelPattern(target.court,target.scheduleCell?.labels||[]).test(sessions[0].label);
}
export function matchesVenue(text,target){
  text=normalizeText(text);
  if(target.venueId===undefined)return isBadminton(text);
  if(target.venueEvidence?.verified&&target.venueEvidence.id===target.venueId){
    const names=[target.venueEvidence.name,target.venueEvidence.enName].filter(Boolean).map(normalizeText);
    return names.some(name=>text.toLowerCase().includes(name.toLowerCase()));
  }
  if(!/羽毛球馆|Badminton Gymnasium/i.test(text))return false;
  const basketball=/(?:羽毛球馆\s*[（(]\s*(?:室内)?篮球[场馆]|Badminton Gymnasium\s*[（(]\s*Basketball Hall)\s*[)）]/i.test(text);
  const training=/(?:羽毛球馆\s*[（(]\s*(?:羽毛球)?训练[场馆]|Badminton Gymnasium\s*[（(]\s*Badminton Training Hall)\s*[)）]/i.test(text);
  if(target.venueId===346)return basketball&&!training;
  if(target.venueId===1)return !basketball;
  return false;
}
