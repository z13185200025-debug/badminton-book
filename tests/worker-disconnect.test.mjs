import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {shanghaiDate} from '../lib/safety.mjs';

test('real worker detects lost launcher IPC and exits without browser activity or stale locks',{timeout:20000},async()=>{
  const root=path.resolve(import.meta.dirname,'..'),directory=await fs.mkdtemp(path.join(os.tmpdir(),'badminton worker 中文 '));
  let child;
  try {
    const config={...JSON.parse(await fs.readFile(path.join(root,'config.example.json'),'utf8')),accountName:'离线测试',schoolAutomationPermissionConfirmed:true};
    await fs.copyFile(path.join(root,'booking.mjs'),path.join(directory,'booking.mjs'));
    await fs.cp(path.join(root,'lib'),path.join(directory,'lib'),{recursive:true});
    await fs.symlink(path.join(root,'node_modules'),path.join(directory,'node_modules'),process.platform==='win32'?'junction':'dir');
    await fs.writeFile(path.join(directory,'config.json'),JSON.stringify(config));
    const release=new Date(Date.now()+10*60*1000);
    child=spawn(process.execPath,[path.join(directory,'booking.mjs'),'at','--at',release.toISOString(),'--date',shanghaiDate(release,2)],{cwd:directory,stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
    let stdout='',stderr='';child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});
    const exited=new Promise((resolve,reject)=>{child.once('exit',code=>resolve(code));child.once('error',reject);});
    const until=Date.now()+8000;
    while(!stdout.includes('"event":"armed"')&&child.exitCode===null&&Date.now()<until)await new Promise(r=>setTimeout(r,30));
    assert.match(stdout,/"event":"armed"/,stderr);
    child.disconnect();
    assert.equal(await exited,0,stderr);
    const events=stdout.trim().split('\n').map(JSON.parse);
    assert.ok(events.some(e=>e.event==='cancelled'));
    assert.ok(!events.some(e=>['preheat_wait_complete','request_finished','submit_clicked','pay_clicked'].includes(e.event)));
    await assert.rejects(()=>fs.access(path.join(directory,'.state/run.lock')));
    const timings=JSON.parse(await fs.readFile(path.join(directory,'artifacts/latest-timings.json'),'utf8'));assert.equal(timings.result,'cancelled');
  }finally{
    if(child?.exitCode===null){child.kill();await new Promise(resolve=>child.once('exit',resolve));}
    await fs.rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:250});
  }
});
