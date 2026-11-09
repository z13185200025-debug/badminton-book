import {spawn} from 'node:child_process';

export function keepAwake(log=()=>{},{platform=process.platform,launch=spawn}={}) {
  let command,args;
  if(platform==='darwin'){command='/usr/bin/caffeinate';args=['-i','-w',String(process.pid)];}
  else if(platform==='linux'){
    command='systemd-inhibit';
    args=['--what=idle:sleep','--mode=block','--who=Badminton Book','--why=User started one-time booking',process.execPath,'-e','process.stdin.resume()'];
  } else if(platform==='win32') {
    command='powershell.exe';
    // The helper owns the power request, so exiting it automatically releases
    // that request. A closed parent pipe also ends the helper after a crash.
    args=['-NoProfile','-NonInteractive','-Command',
      'Add-Type -TypeDefinition \'using System.Runtime.InteropServices; public static class BadmintonPower { [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags); }\'; if ([BadmintonPower]::SetThreadExecutionState([uint32]2147483649) -eq 0) { exit 1 }; try { [Console]::In.ReadToEnd() | Out-Null } finally { [BadmintonPower]::SetThreadExecutionState([uint32]2147483648) | Out-Null }'];
  } else return ()=>{};
  let helper,closed=false;
  try{
    helper=launch(command,args,{stdio:['pipe','ignore','ignore'],windowsHide:true});
    helper.on('error',()=>{if(!closed)log('power_inhibit_unavailable',{note:'请在系统电源设置中保持唤醒'});});
    helper.on('exit',code=>{if(!closed&&code!==0)log('power_inhibit_unavailable',{note:'请在系统电源设置中保持唤醒'});});
    helper.stdin.on('error',()=>{});
  }catch{log('power_inhibit_unavailable',{note:'请在系统电源设置中保持唤醒'});}
  return ()=>{closed=true;helper?.stdin?.end();if(platform==='darwin')helper?.kill();};
}
