import test from 'node:test';
import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
import {matchPuzzle} from '../lib/puzzle.mjs';
test('visible-image matcher locates a dimmed image patch and ignores alpha padding',()=>{
  const bg=new PNG({width:310,height:155}),piece=new PNG({width:47,height:155});
  let seed=7;
  for(let y=0;y<155;y++)for(let x=0;x<310;x++) {
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const i=(y*310+x)*4;
    bg.data[i]=seed&255;bg.data[i+1]=(seed>>>8)&255;bg.data[i+2]=(seed>>>16)&255;bg.data[i+3]=255;
  }
  const offset=121;
  for(let y=80;y<130;y++)for(let x=5;x<42;x++) {
    const dst=(y*47+x)*4,src=(y*310+x+offset)*4;
    for(let c=0;c<3;c++){piece.data[dst+c]=bg.data[src+c];bg.data[src+c]=Math.round(bg.data[src+c]*0.55);}
    piece.data[dst+3]=255;
  }
  const uri=p=>'data:image/png;base64,'+PNG.sync.write(p).toString('base64');
  const result=matchPuzzle(uri(bg),uri(piece));
  assert.equal(result.offset,offset);assert.ok(result.score>0.95);
});
test('blank or unsupported challenge is rejected instead of guessing',()=>{
  const bg=new PNG({width:310,height:155}),piece=new PNG({width:47,height:155});
  const uri=p=>'data:image/png;base64,'+PNG.sync.write(p).toString('base64');
  assert.throws(()=>matchPuzzle(uri(bg),uri(piece)));
});
