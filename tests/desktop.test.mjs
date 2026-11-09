import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {startDesktop} from '../tools/start-app.mjs';

test('desktop starts idle from a Unicode/spaced path; closing its window stops workers and removes its lock',{timeout:30000},async()=>{
  const root=path.resolve(import.meta.dirname,'..'),directory=await fs.mkdtemp(path.join(os.tmpdir(),'badminton 测试 space '));
  let desktop;
  const calls=[];
  const worker=args=>{
    const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.connected=true;
    child.send=(message,callback)=>{calls.push(message);callback();setImmediate(()=>child.emit('exit',0));};
    child.kill=()=>assert.fail('Desktop should gracefully stop the worker using IPC');
    calls.push(args);return child;
  };
  try{
    await fs.cp(path.join(root,'ui'),path.join(directory,'ui'),{recursive:true});
    const config=JSON.parse(await fs.readFile(path.join(root,'config.example.json'),'utf8'));
    Object.assign(config,{accountName:'离线测试',schoolAutomationPermissionConfirmed:true});
    await fs.writeFile(path.join(directory,'config.example.json'),JSON.stringify(config));
    desktop=await startDesktop({projectRoot:directory,headless:process.env.BADMINTON_TEST_HEADED!=='1',worker});
    assert.equal(desktop.server.getBatch().running,false);assert.equal(calls.length,0);
    await assert.rejects(()=>startDesktop({projectRoot:directory,headless:true,worker}),/已经打开/);
    await desktop.page.getByRole('heading',{name:'准备就绪'}).waitFor();
    await desktop.page.getByRole('button',{name:/开始本次预约/}).click();
    await desktop.page.getByRole('button',{name:'停止本次执行',exact:true}).waitFor();
    assert.equal(calls.length,1);assert.equal(calls[0][1],'book');
    await desktop.page.close();await desktop.finished;
    assert.deepEqual(calls[1],{type:'badminton:stop'});
    assert.equal(desktop.server.getBatch().running,false);
    await assert.rejects(()=>fetch(desktop.server.url+'/api/state'));
    await assert.rejects(()=>fs.access(path.join(directory,'.state/interface.lock')));
  }finally{await desktop?.close();await fs.rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
});
