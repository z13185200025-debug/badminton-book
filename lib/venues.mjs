export const CURRENT_VENUE_ID=346;
const venues={
  1:{id:1,name:'羽毛球馆（原训练馆）',courtCount:4},
  346:{id:346,name:'羽毛球馆（篮球馆一层）',courtCount:9},
};
export function venueInfo(id){
  const venue=venues[id];
  if(!venue||!Number.isInteger(id))throw new Error('场馆未经核验，仅支持学校已确认的羽毛球场馆');
  return {...venue,courts:Array.from({length:venue.courtCount},(_,i)=>`No.${i+1}`)};
}

// The new venue currently labels courts 1–5 with Basketball Hall and 6–9
// with Badminton Training Hall. Bind the venue to its page/order title;
// accept only these known display suffixes when identifying the court number.
const suffix='(?:Basketball\\s+Hall|Badminton\\s+Training\\s+Hall|(?:室内)?篮球馆|羽毛球(?:训练)?馆)';
export function courtLabelPattern(court){
  if(!/^No\.[1-9]$/.test(court))throw new Error('场号格式不合法');
  return new RegExp(`^\\s*${court.replace('.','\\.')}\\s*(?:[（(]\\s*${suffix}\\s*[)）])?\\s*$`,'i');
}
export function sessionsIn(text){
  const pattern=/\b(No\.\d+)(\s*[（(][^（）()\r\n]+[)）])?\s*(?:[：:]\s*|\s+)(\d{2}:\d{2}-\d{2}:\d{2})/g;
  return [...String(text).matchAll(pattern)].map(match=>({court:match[1],slot:match[3],label:match[1]+(match[2]||'')}));
}
export function matchesSession(text,target){
  const sessions=sessionsIn(text);
  return sessions.length===1&&sessions[0].court===target.court&&sessions[0].slot===target.slot&&courtLabelPattern(target.court).test(sessions[0].label);
}
export function matchesVenue(text,target){
  if(target.venueId===undefined)return /羽毛球|Badminton/i.test(text);
  if(!/羽毛球馆|Badminton Gymnasium/i.test(text))return false;
  const basketball=/(?:羽毛球馆\s*[（(]\s*(?:室内)?篮球馆|Badminton Gymnasium\s*[（(]\s*Basketball Hall)\s*[)）]/i.test(text);
  const training=/(?:羽毛球馆\s*[（(]\s*(?:羽毛球)?训练馆|Badminton Gymnasium\s*[（(]\s*Badminton Training Hall)\s*[)）]/i.test(text);
  if(target.venueId===CURRENT_VENUE_ID)return basketball&&!training;
  if(target.venueId===1)return !basketball;
  return false;
}
