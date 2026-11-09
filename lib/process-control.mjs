import {spawn} from 'node:child_process';

export function installWorkerStop(stop,host=process) {
  const onMessage=message=>{if(message?.type==='badminton:stop')stop();};
  host.once('SIGINT',stop);host.once('SIGTERM',stop);
  // IPC works on Windows as well as POSIX, and disconnection covers an
  // unexpectedly closed launcher. Stop before another booking action starts.
  if(host.send){host.on('message',onMessage);host.once('disconnect',stop);}
  return ()=>{
    host.removeListener('SIGINT',stop);host.removeListener('SIGTERM',stop);
    host.removeListener('message',onMessage);host.removeListener('disconnect',stop);
    if(host.connected)host.disconnect();
  };
}

export function requestWorkerStop(child) {
  if(child.connected&&child.send) {
    try{child.send({type:'badminton:stop'},error=>{if(error)child.kill('SIGTERM');});return;}catch{}
  }
  child.kill('SIGTERM');
}

export async function forceWorkerStop(child,{platform=process.platform,launch=spawn}={}) {
  if(child.exitCode!==null&&child.exitCode!==undefined)return;
  if(platform==='win32'&&Number.isInteger(child.pid)&&child.pid>0) {
    // Kill this worker's descendants only; never kill other Chrome instances.
    await new Promise(resolve=>{
      const killer=launch('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});
      killer.once('error',()=>{child.kill('SIGKILL');resolve();});killer.once('exit',resolve);
    });
  } else child.kill('SIGKILL');
}
