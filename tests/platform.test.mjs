import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {browserOptions,validateRuntime} from '../lib/platform.mjs';
import {installWorkerStop,requestWorkerStop,forceWorkerStop} from '../lib/process-control.mjs';

test('Windows detects Chrome or Edge without shell expansion, including paths with spaces',()=>{
  const env={PROGRAMFILES:'C:\\Program Files',LOCALAPPDATA:'C:\\Users\\测试 用户\\AppData\\Local'};
  assert.deepEqual(browserOptions({platform:'win32',env,exists:p=>p==='C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'}),{channel:'msedge'});
  assert.deepEqual(browserOptions({platform:'win32',env,exists:p=>p==='C:\\Users\\测试 用户\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'}),{channel:'chrome'});
  assert.throws(()=>browserOptions({platform:'win32',env,exists:()=>false}),/未找到/);
});
test('Linux Chromium and explicit CI/browser selection are validated',()=>{
  assert.deepEqual(browserOptions({platform:'linux',env:{},exists:p=>p==='/usr/bin/chromium'}),{executablePath:'/usr/bin/chromium'});
  assert.deepEqual(browserOptions({env:{BADMINTON_BROWSER_CHANNEL:'chromium'}}),{});
  assert.deepEqual(browserOptions({platform:'win32',env:{BADMINTON_BROWSER_EXECUTABLE:'C:\\Program Files\\Browser\\app.exe'},exists:()=>true}),{executablePath:'C:\\Program Files\\Browser\\app.exe'});
  assert.throws(()=>browserOptions({env:{BADMINTON_BROWSER_CHANNEL:'firefox'}}),/浏览器/);
  assert.throws(()=>browserOptions({env:{BADMINTON_BROWSER_EXECUTABLE:'relative/chrome'},exists:()=>true}),/绝对路径/);
});
test('runtime refuses old Node and a Linux desktop launch without a display',()=>{
  assert.throws(()=>validateRuntime({version:'20.0.0'}),/Node.js/);
  assert.throws(()=>validateRuntime({platform:'linux',env:{}}),/图形桌面/);
  validateRuntime({version:'22.0.0',platform:'linux',env:{WAYLAND_DISPLAY:'wayland-0'}});
  validateRuntime({platform:'linux',env:{},headless:true});
});
test('workers stop via IPC and parent disappearance, then remove listeners cleanly',()=>{
  const host=new EventEmitter();host.send=()=>{};host.connected=true;host.disconnect=()=>{host.connected=false;host.emit('disconnect');};
  let stops=0;const remove=installWorkerStop(()=>{stops++;},host);
  host.emit('message',{type:'unrelated'});assert.equal(stops,0);
  host.emit('message',{type:'badminton:stop'});assert.equal(stops,1);
  host.emit('disconnect');assert.equal(stops,2);remove();assert.equal(stops,2);
  assert.equal(host.listenerCount('message'),0);assert.equal(host.connected,false);
});
test('graceful stop sends IPC before any Windows termination signal; forced stop targets only its own tree',async()=>{
  const messages=[],signals=[],calls=[];
  const child={pid:123456,exitCode:null,connected:true,send:(message,callback)=>{messages.push(message);callback();},kill:signal=>signals.push(signal)};
  requestWorkerStop(child);assert.deepEqual(messages,[{type:'badminton:stop'}]);assert.deepEqual(signals,[]);
  await forceWorkerStop(child,{platform:'win32',launch:(command,args,options)=>{calls.push({command,args,options});const p=new EventEmitter();setImmediate(()=>p.emit('exit',0));return p;}});
  assert.equal(calls[0].command,'taskkill.exe');assert.deepEqual(calls[0].args,['/PID','123456','/T','/F']);assert.deepEqual(signals,[]);
});
