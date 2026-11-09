import path from 'node:path';

export function executionSchedule(command,args,config,now,shanghaiDate,nextRelease) {
  const index=args.indexOf('--at');
  let releaseAt;
  if(command==='at') {
    const value=index<0?'':args[index+1];
    // Date.toISOString(), used by the native UI, includes milliseconds. Accept
    // that standard representation as well as the original second-only CLI form.
    if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:\+08:00|Z)$/.test(value||''))throw new Error('启动时间格式无效，请重新选择开始方式');
    releaseAt=new Date(value);
    if(!Number.isFinite(releaseAt.getTime())||now.getTime()>releaseAt.getTime()+config.releaseWindowSeconds*1000)throw new Error('本次指定的启动时间已过期');
  } else releaseAt=command==='watch'?nextRelease(now,config.releaseTime,config.releaseWindowSeconds):new Date(`${shanghaiDate(now)}T${config.releaseTime}+08:00`);
  const preheatAt=command==='at'?new Date(releaseAt.getTime()-5*60*1000):new Date(`${shanghaiDate(releaseAt)}T${config.preheatTime}:00+08:00`);
  return {releaseAt,preheatAt,reference:['watch','at'].includes(command)?releaseAt:now};
}

export function configurationPath(root,args) {
  const index=args.indexOf('--config');
  if(index<0)return path.join(root,'config.json');
  if(!args[index+1])throw new Error('--config 缺少文件名');
  return path.resolve(root,args[index+1]);
}
