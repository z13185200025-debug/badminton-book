import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {zipSync,unzipSync} from 'fflate';
import {createPortableArchive,verifyArchive,releaseFiles,releaseDirectories,releaseTools} from '../tools/package-release.mjs';

test('portable packages include dependencies and correct launchers, exclude private data, and detect corrupt or unexpected files',async()=>{
  const root=path.resolve(import.meta.dirname,'..'),directory=await fs.mkdtemp(path.join(os.tmpdir(),'badminton-package-'));
  try{
    for(const relative of [...releaseFiles,...releaseDirectories,...releaseTools.map(p=>'tools/'+p),'start-linux.sh','start-windows.cmd','node_modules']){
      const to=path.join(directory,relative);await fs.mkdir(path.dirname(to),{recursive:true});await fs.cp(path.join(root,relative),to,{recursive:true});
    }
    const secret=randomUUID();
    await fs.mkdir(path.join(directory,'.state'));await fs.writeFile(path.join(directory,'.state','secret'),secret);
    await fs.writeFile(path.join(directory,'config.json'),JSON.stringify({accountName:secret}));
    for(const platform of ['windows','linux']){
      const result=await createPortableArchive({projectRoot:directory,platform});
      const bytes=await fs.readFile(result.archive),{manifest,entries}=verifyArchive(bytes);
      assert.ok(manifest.files.some(f=>f.path==='node_modules/playwright-core/package.json'));
      assert.ok(manifest.files.some(f=>f.path===(platform==='windows'?'start-windows.cmd':'start-linux.sh')));
      assert.ok(manifest.files.some(f=>f.path==='start-linux.sh'));assert.ok(manifest.files.some(f=>f.path==='start-windows.cmd'));
      assert.ok(!Object.values(entries).some(bytes=>Buffer.from(bytes).includes(Buffer.from(secret))));
      const corrupted=unzipSync(bytes);corrupted[`${manifest.name}/config.example.json`]=Buffer.from('{}');assert.throws(()=>verifyArchive(zipSync(corrupted)),/校验失败/);
      const extra=unzipSync(bytes);extra[`${manifest.name}/.state/session`]=Buffer.from('session');assert.throws(()=>verifyArchive(zipSync(extra)),/不允许/);
      await assert.rejects(()=>createPortableArchive({projectRoot:directory,platform}),error=>error.code==='EEXIST');
    }
    await assert.rejects(()=>createPortableArchive({projectRoot:directory,platform:'macos'}),/原始/);
  }finally{await fs.rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
});
