const $=selector=>document.querySelector(selector);
const token=location.hash.slice(1);history.replaceState(null,'',location.pathname);
let current,courts=[],fallbacks=[],initialized=false,submitting=false,disconnected=false;
let selectedId="default",editingId=null,accountsSignature="";
const drafts=new Map(),enabled=new Set(["default"]);
const selectedAccount=()=>current?.accounts.find(a=>a.id===selectedId);
const selectedRun=()=>selectedAccount()?.run||{stage:"idle",events:[],running:false};
const times=Array.from({length:14},(_,i)=>{const h=String(i+8).padStart(2,'0'),e=String(i+9).padStart(2,'0');return `${h}:00-${e}:00`;});
for(const id of ['#slot','#fallback-slot'])for(const value of times){const option=document.createElement('option');option.value=value;option.textContent=value.replace('-',' — ');$(id).append(option);}
function dateText(value){if(!value)return '';return new Intl.DateTimeFormat('zh-CN',{month:'long',day:'numeric',weekday:'long',timeZone:'Asia/Shanghai'}).format(new Date(`${value}T12:00:00+08:00`));}
function clockText(value){return value?new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false,timeZone:'Asia/Shanghai'}).format(new Date(value)):'—';}
function eventTime(value){return new Intl.DateTimeFormat('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit',fractionalSecondDigits:3,hour12:false,timeZone:'Asia/Shanghai'}).format(new Date(value));}
const seconds=value=>Number.isFinite(value)?`${(value/1000).toFixed(3)} s`:'—';
const configuredDelay=()=>Math.round(Number($('#booking-delay').value)*1000);
async function api(path,data){const response=await fetch('/api/'+path,{method:data===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,...(data===undefined?{}:{'Content-Type':'application/json'})},body:data===undefined?undefined:JSON.stringify(data)});const result=await response.json();if(!response.ok)throw new Error(result.error||'操作未完成');return result;}
function showError(error){$('#connection-error').textContent=error.message;$('#connection-error').hidden=false;}
function clearError(){$('#connection-error').hidden=true;}
function updateSummary(){
  const mode=$('input[name=mode]:checked').value,wait=mode==='release';
  $('#date').min=wait?current.defaults.nextReleaseDay:current.defaults.today;
  $('#date').max=wait?current.defaults.nextReleaseTarget:current.defaults.date;
  $('#date-hint').textContent=dateText($('#date').value);
  $('#summary-date').textContent=dateText($('#date').value);
  $('#summary-slot').textContent=$('#slot').value.replace('-',' — ');
  const delayMs=configuredDelay();
  $('#schedule-note').textContent=wait?`仅本次等待：${clockText(current.defaults.nextRelease)} 放号，${clockText(new Date(Date.parse(current.defaults.nextRelease)+delayMs))} 开始选场。`:`页面就绪后等待 ${seconds(delayMs)}，再开始选场。`;
  $('#start').firstChild.textContent=(wait?'开始本次等待':'开始本次预约')+` · ${enabled.size} 个账号 `;
  renderTechnical(selectedRun());renderMetrics(selectedRun());
}
function renderCourts(){
  $('#courts').replaceChildren();
  courts.forEach((court,index)=>{
    const item=document.createElement('div');item.className='court';
    const rank=document.createElement('span');rank.className='rank';rank.textContent=String(index+1).padStart(2,'0');
    const label=document.createElement('strong');label.textContent=court.slice(3)+' 号';item.append(rank,label);
    const move=document.createElement('button');move.type='button';move.textContent='‹';move.setAttribute('aria-label',`${court.slice(3)} 号场优先一级`);move.disabled=index===0;move.addEventListener('click',()=>{[courts[index-1],courts[index]]=[courts[index],courts[index-1]];renderCourts();stashDraft();renderAccounts();});
    const remove=document.createElement('button');remove.type='button';remove.className='remove';remove.textContent='×';remove.setAttribute('aria-label',`移除 ${court.slice(3)} 号场`);remove.disabled=courts.length===1;remove.addEventListener('click',()=>{courts.splice(index,1);renderCourts();stashDraft();renderAccounts();});item.append(move,remove);$('#courts').append(item);
  });$('#restore-courts').hidden=courts.length===current.defaults.availableCourts.length;
  if(current)renderTechnical(selectedRun());
}
function renderFallbacks(){
  $('#fallback-list').replaceChildren();
  fallbacks.forEach((slot,index)=>{const row=document.createElement('div');row.className='fallback-item';const label=document.createElement('span');label.textContent=`备选 ${index+1} · ${slot.replace('-',' — ')}`;const remove=document.createElement('button');remove.type='button';remove.textContent='移除';remove.addEventListener('click',()=>{fallbacks.splice(index,1);renderFallbacks();stashDraft();renderAccounts();});row.append(label,remove);$('#fallback-list').append(row);});
  $('#fallback-count').textContent=fallbacks.length?`${fallbacks.length} 个`:'未添加';
  if(current)renderTechnical(selectedRun());
}
function renderTechnical(run){
  const hasRun=run.kind==='booking',scheduled=hasRun?!!run.releaseAt:$('input[name=mode]:checked').value==='release';
  const release=hasRun?run.releaseAt:scheduled?current.defaults.nextRelease:null;
  const delayMs=hasRun?run.bookingDelayMs:configuredDelay();
  const preheat=hasRun?run.preheatAt:release?new Date(Date.parse(release)-300000).toISOString():null;
  const planned=hasRun?run.plannedStartAt:release?new Date(Date.parse(release)+delayMs).toISOString():null;
  const points=run.milestones||{},duration=(from,to)=>points[from]&&points[to]?points[to].elapsedMs-points[from].elapsedMs:undefined;
  const candidate=run.candidate;
  const rows=[
    ['预约场馆',hasRun?run.venueName:current.defaults.venueName],
    ['场馆目录',run.venueCatalog?run.venueCatalog.map(v=>`${v.id} · ${v.name}`).join(' / ')||'暂无可预约场馆':'运行时从学校目录确认'],
    ['场地 / 上级场馆 / 校区 / 运动',run.venueEvidence?`${run.venueId} / ${run.venueEvidence.parentVenueId} / ${run.venueEvidence.campusId} / ${run.venueEvidence.sportType}`:'—'],
    ['排期场地 ID / 时段 ID',run.schedule?.spaceId?`${run.schedule.spaceId} / ${run.schedule.timeId}`:'—'],
    ['接口可预约日期',run.schedule?.availableDates?.join('、')||'放号后核对，保留所选日期'],
    ['场地数量 / 放号小时',run.venueEvidence?`${run.venueEvidence.courtCount??'待查'} / ${run.venueEvidence.reservationHour??'待查'}`:'—'],
    ['预约须知代码',run.venueEvidence?.protocol||'—'],
    ['预热时间',scheduled?clockText(preheat):'启动后准备页面'],
    ['放号基准',release?clockText(release):'立即模式'],
    ['计划选场',planned?clockText(planned):`页面就绪 + ${seconds(delayMs)}`],
    ['配置延迟 / 实际等待',`${seconds(delayMs)} / ${seconds(run.actualDelayMs)}`],
    ['选场触发偏差',Number.isFinite(run.startLatenessMs)?`+${run.startLatenessMs} ms`:'—'],
    ['候选进度',candidate?`${candidate.index??'—'}/${candidate.total??'—'} · ${candidate.court} · ${candidate.slot}`:`${hasRun?run.candidates.reduce((n,c)=>n+c.courts.length,0):courts.length*(fallbacks.length+1)} 个候选`],
    ['场次选择耗时',seconds(duration('booking_started','selection_verified'))],
    ['验证码阶段',run.captcha?`${run.captcha.attempts||0} 次匹配 · ${run.captcha.code===undefined?'校验中':run.captcha.passed?'通过':'未通过'} · ${seconds(duration('captcha_detected','captcha_result'))}`:'—'],
    ['匹配耗时 / 匹配度',run.captcha?`${run.captcha.matchMs??'—'} ms / ${run.captcha.score??'—'}`:'—'],
    ['订单提交响应',run.orderResponse?`HTTP ${run.orderResponse.httpStatus} · 业务码 ${run.orderResponse.code}`:'—'],
    ['Pay 加载耗时',seconds(duration('pay_visible','pay_ready'))],
    ['放号重试间隔 / 窗口',`${current.defaults.releasePollIntervalMs} ms / ${current.defaults.releaseWindowSeconds} s`],
  ];
  $('#technical').replaceChildren();
  for(const [label,value] of rows){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;$('#technical').append(dt,dd);}
}
function renderMetrics(run){
  const points=run.milestones||{},base=run.releaseMs??0,fromRelease=!!run.releaseAt||run.releaseMs!==undefined||(run.stage==='idle'&&$('input[name=mode]:checked').value==='release');
  const elapsed=name=>points[name]?points[name].elapsedMs-base:undefined;
  const active=points.pay_ready&&points.booking_started?points.pay_ready.elapsedMs-points.booking_started.elapsedMs:undefined;
  const created=run.order?.createdAt,serverTime=created?.match(/\d{2}:\d{2}:\d{2}/)?.[0]||'—';
  const rows=[
    [`${fromRelease?'放号':'启动'} → Pay 就绪`,seconds(elapsed('pay_ready'))],
    ['选场开始 → Pay 就绪',seconds(active)],
    [`${fromRelease?'放号':'启动'} → 确认完成`,seconds(elapsed('confirmed'))],
    ['服务器订单创建时间',serverTime],
  ];
  $('#metrics').replaceChildren();
  rows.forEach(([label,value],index)=>{const box=document.createElement('div'),small=document.createElement('small'),strong=document.createElement('strong');box.className='metric';small.textContent=label;strong.textContent=value;if(index===3){strong.className='server-time';strong.title=created||'尚无订单记录';}box.append(small,strong);$('#metrics').append(box);});
}
function renderDiagnostics(run){
  const requests=Object.values(run.requests||{});$('#requests-table').hidden=!requests.length;$('#requests-empty').hidden=!!requests.length;$('#requests').replaceChildren();
  for(const item of requests){const row=document.createElement('tr');for(const value of [item.label,`${item.durationMs} ms`,String(item.count),`${item.httpStatus??'失败'}${item.failures?' · 累计失败 '+item.failures:''}`]){const td=document.createElement('td');td.textContent=value;row.append(td);}if(item.failures)row.lastChild.className='request-error';$('#requests').append(row);}
  $('#timeline-empty').hidden=!!run.events.length;$('#timeline').replaceChildren();
  $('#timeline-origin').textContent=run.releaseMs===undefined?'本地时间 / 启动后':'本地时间 / 相对放号';
  for(const item of [...run.events].reverse()){
    const li=document.createElement('li'),time=document.createElement('time'),elapsed=document.createElement('span'),label=document.createElement('span');
    time.textContent=eventTime(item.at);time.title=clockText(item.at);elapsed.className='elapsed';label.className='event-label';
    const relative=item.elapsedMs-(run.releaseMs??0);elapsed.textContent=`${relative>=0?'+':''}${(relative/1000).toFixed(3)}s`;label.textContent=item.label;li.append(time,elapsed,label);$('#timeline').append(li);
  }
  $('#telemetry-note').textContent=run.running?'实时更新 · 本机日志':run.events.length?'本次执行记录':'等待本次运行';
}
function renderRun(run){
  const active=run.running||submitting,anyActive=current.busy||submitting;$('#controls').disabled=anyActive;$('#stop').hidden=!current.batch.running;$('#account-button').disabled=anyActive;$('#add-account').disabled=anyActive||current.accounts.length>=current.maxAccounts;$('#save-plans').disabled=anyActive;
  $('#status-dot').className='status-dot'+(active?' running':['confirmed','already_booked','login_verified'].includes(run.stage)?' success':'');
  const success=['confirmed','already_booked','login_verified'].includes(run.stage);
  $('#status-icon').textContent=success?'✓':active?'◌':run.stage==='stopped'?'!':'○';
  $('#status-title').textContent=run.stage==='idle'?'准备就绪':run.message;
  $('#status-description').textContent=run.stage==='idle'?'尚未启动。':success?'本次执行完成。':run.stage==='pay_preview_complete'?'尚未点击 Pay，待支付订单未完成。':run.kind==='login'&&active?'请在 Chrome 完成登录。':run.stage==='armed'||run.stage==='preheated'?'保持应用运行，等待本次触发。':active?'记录本地阶段耗时与服务器返回结果。':'可调整配置后再次开始。';
  if(run.date){$('#summary-date').textContent=dateText(run.date);$('#summary-slot').textContent=run.slot.replace('-',' — ');}
  $('#order').hidden=!run.order;if(run.order)$('#order').textContent=`${run.order.date} · ${run.order.session}\n${run.order.payment} / ${run.order.status} · ${run.order.amount}\n订单 ${run.order.number}${run.order.createdAt?'\n服务器创建：'+run.order.createdAt:''}`;
  renderMetrics(run);renderTechnical(run);renderDiagnostics(run);
  $('#run-error').hidden=!run.error;if(run.error)$('#run-error').textContent=run.error;
}
function stashDraft(){
  if(!initialized||!selectedAccount())return;
  drafts.set(selectedId,{slot:$('#slot').value,courts:[...courts],fallbackSlots:[...fallbacks],bookingDelayMs:configuredDelay(),autoPay:$('#auto-pay').checked,visible:$('#visible').checked});
}
function loadDraft(){
  const a=selectedAccount(),d=drafts.get(selectedId);if(!a||!d)return;
  courts=[...d.courts];fallbacks=[...d.fallbackSlots];$('#slot').value=d.slot;$('#auto-pay').checked=d.autoPay;$('#visible').checked=d.visible;$('#booking-delay').value=d.bookingDelayMs/1000;
  $('#account-name').textContent=a.label;$('#config-title').textContent=`配置 · ${a.label}`;$('#run-account-title').textContent=`运行状态 · ${a.label}`;
  renderCourts();renderFallbacks();updateSummary();
}
function selectAccount(id){stashDraft();selectedId=id;loadDraft();renderAccounts();renderRun(selectedRun());}
function renderAccounts(){
  const state=current.batch;
  $('#batch-summary').textContent=state.kind==='booking'?`本次 ${state.total} 个账号 · 运行 ${state.active||0} · 成功 ${state.success} · 待 Pay ${state.preview} · 失败 ${state.failed} · 已停止 ${state.cancelled}`:`已选择 ${enabled.size} 个账号。点击开始后并行执行，每个账号最多预约一场。`;
  const signature=JSON.stringify([selectedId,current.busy,submitting,[...enabled],current.accounts.map(a=>[a.id,a.label,a.accountName,a.profilePresent,a.run.stage,a.run.running,drafts.get(a.id)])]);
  if(signature===accountsSignature)return;accountsSignature=signature;$('#account-list').replaceChildren();
  for(const a of current.accounts){
    const d=drafts.get(a.id),row=document.createElement('div');row.className='account-row'+(a.id===selectedId?' selected':'');row.dataset.accountId=a.id;
    const choice=document.createElement('label');choice.className='account-choice';const check=document.createElement('input');check.type='checkbox';check.checked=enabled.has(a.id);check.disabled=current.busy||submitting;check.setAttribute('aria-label',`本次使用 ${a.label}`);
    check.addEventListener('change',()=>{if(check.checked)enabled.add(a.id);else enabled.delete(a.id);renderAccounts();updateSummary();});
    const text=document.createElement('span'),name=document.createElement('strong'),identity=document.createElement('small');name.textContent=a.label;identity.textContent=a.accountName||'尚未配置';text.append(name,identity);choice.append(check,text);
    const plan=document.createElement('div');plan.className='account-plan';plan.textContent=d.slot.replace('-',' — ')+` · ${d.autoPay?'自动 Pay':'停在 Pay'} · ${d.courts.length} 个场号`;
    const stage=document.createElement('small');stage.textContent=a.run.stage==='idle'?(a.profilePresent?'已有独立登录资料':'首次使用需登录'):a.run.message;plan.append(stage);
    const actions=document.createElement('div');actions.className='account-actions';
    const button=(label,handler,disabled=false)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.disabled=disabled;b.addEventListener('click',handler);actions.append(b);return b;};
    button('配置',()=>selectAccount(a.id)).setAttribute('aria-label',`配置 ${a.label}`);
    button('登录 / 设置',()=>openSettings(a.id),current.busy||submitting).setAttribute('aria-label',`登录或设置 ${a.label}`);
    if(a.run.running){const b=button('停止',async()=>{try{await api('stop',{accountId:a.id});await refresh();}catch(e){showError(e);}});b.className='stop-one';b.setAttribute('aria-label',`停止 ${a.label}`);}
    row.append(choice,plan,actions);$('#account-list').append(row);
  }
}
async function refresh(){
  try{
    current=await api('state');if(!current.accounts)throw new Error('请退出并重新打开新版应用');disconnected=false;document.body.classList.remove('disconnected');
    for(const a of current.accounts)if(!drafts.has(a.id))drafts.set(a.id,{slot:a.defaults.slot,courts:[...a.defaults.courts],fallbackSlots:[...a.defaults.fallbackSlots],bookingDelayMs:a.defaults.bookingDelayMs,autoPay:a.defaults.autoPay,visible:a.defaults.visible});
    if(!selectedAccount())selectedId=current.accounts[0].id;
    $('#venue-name').textContent=current.defaults.venueName;
    if(!initialized){$('#date').value=current.defaults.date;initialized=true;loadDraft();}
    renderAccounts();renderRun(selectedRun());
  }catch(error){if(!disconnected){showError(new Error('本地连接已断开。请重新打开“羽毛球预约助手”。'));disconnected=true;document.body.classList.add('disconnected');$('#controls').disabled=true;}}
}
function planPayload(){stashDraft();return {date:$('#date').value,mode:$('input[name=mode]:checked').value,accounts:current.accounts.filter(a=>enabled.has(a.id)).map(a=>({accountId:a.id,...drafts.get(a.id)}))};}
$('#booking-form').addEventListener('submit',async event=>{
  event.preventDefault();if(submitting||current?.busy)return;clearError();
  const payload=planPayload();if(!payload.accounts.length){showError(new Error('请先勾选本次参与的账号'));return;}
  const missing=current.accounts.find(a=>enabled.has(a.id)&&(!a.accountName||!a.permissionConfirmed));if(missing){openSettings(missing.id);return;}
  submitting=true;renderRun(selectedRun());renderAccounts();
  try{await api('start',payload);}catch(error){showError(error);}finally{submitting=false;await refresh();}
});
$('#save-plans').addEventListener('click',async()=>{try{await api('plans',planPayload());$('#batch-summary').textContent='已保存所选账号的时段、候选场地和 Pay 设置。';}catch(e){showError(e);}});
$('#stop').addEventListener('click',async()=>{try{$('#stop').disabled=true;await api('stop',{});await refresh();}catch(error){showError(error);}finally{$('#stop').disabled=false;}});
$('#date').addEventListener('change',updateSummary);
$('#slot').addEventListener('change',()=>{fallbacks=fallbacks.filter(slot=>slot!==$('#slot').value);renderFallbacks();updateSummary();stashDraft();renderAccounts();});
$('#booking-delay').addEventListener('input',()=>{if($('#booking-delay').validity.valid){updateSummary();stashDraft();}});
for(const id of ['#auto-pay','#visible'])$(id).addEventListener('change',()=>{stashDraft();renderAccounts();});
for(const radio of document.querySelectorAll('input[name=mode]'))radio.addEventListener('change',()=>{updateSummary();});
$('#restore-courts').addEventListener('click',()=>{courts=[...current.defaults.availableCourts];renderCourts();stashDraft();renderAccounts();});
$('#add-fallback').addEventListener('click',()=>{const value=$('#fallback-slot').value;if(value!==$('#slot').value&&!fallbacks.includes(value)&&fallbacks.length<6){fallbacks.push(value);renderFallbacks();stashDraft();renderAccounts();}});
function openSettings(id=selectedId){
  stashDraft();editingId=id;const a=current.accounts.find(a=>a.id===id);
  $('#settings-title').textContent=a?'账号与登录':'添加账号';$('#settings-label').value=a?.label||'';$('#settings-name').value=a?.accountName||'';$('#permission').checked=a?.permissionConfirmed||false;
  $('#profile-note').textContent=a?.profilePresent?'此账号已有独立浏览器资料，登录过期时在此更新。':'保存后打开此账号的专用 Chrome，完成一次学校登录。';$('#settings-error').hidden=true;$('#account-dialog').showModal();
}
$('#account-button').addEventListener('click',()=>openSettings());$('#add-account').addEventListener('click',()=>openSettings(null));$('#close-settings').addEventListener('click',()=>$('#account-dialog').close());
async function saveSettings(){
  const created=!editingId;
  const result=await api('accounts',{accountId:editingId||undefined,label:$('#settings-label').value,accountName:$('#settings-name').value,permissionConfirmed:$('#permission').checked});
  editingId=result.accountId;if(created)enabled.add(editingId);await refresh();selectAccount(editingId);return editingId;
}
function settingsError(error){$('#settings-error').textContent=error.message;$('#settings-error').hidden=false;}
async function saveOrLogin(login){
  $('#save-settings').disabled=true;$('#login').disabled=true;
  try{const id=await saveSettings();if(login)await api('login',{accountId:id});$('#account-dialog').close();await refresh();}catch(error){settingsError(error);}finally{$('#save-settings').disabled=false;$('#login').disabled=false;}
}
$('#settings-form').addEventListener('submit',async event=>{event.preventDefault();await saveOrLogin(false);});
$('#login').addEventListener('click',()=>saveOrLogin(true));
await refresh();setInterval(refresh,900);
