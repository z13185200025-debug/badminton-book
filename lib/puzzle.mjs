import { PNG } from 'pngjs';

const decode = uri => PNG.sync.read(Buffer.from(uri.replace(/^data:image\/\w+;base64,/,''),'base64'));
const grey = (data,i) => 0.299*data[i]+0.587*data[i+1]+0.114*data[i+2];

// Match the visible piece against the visible challenge image. No token forging,
// hidden answer fields, CAPTCHA APIs, or third-party solving service is used.
export function matchPuzzle(backgroundURI, pieceURI) {
  const bg=decode(backgroundURI), piece=decode(pieceURI);
  if(bg.height!==piece.height || bg.width<100 || piece.width>=bg.width) throw new Error('不支持的拼图图像尺寸');
  const samples=[];
  for(let y=3;y<piece.height-3;y+=2) for(let x=3;x<piece.width-3;x+=2) {
    const i=(y*piece.width+x)*4;
    // Erode the alpha mask to discard the white outline and transparent edges.
    if([[0,0],[-2,0],[2,0],[0,-2],[0,2]].every(([dx,dy])=>piece.data[((y+dy)*piece.width+x+dx)*4+3]>240)) samples.push({x,y,v:grey(piece.data,i)});
  }
  if(samples.length<30) throw new Error('拼图有效像素不足');
  const mean=samples.reduce((a,p)=>a+p.v,0)/samples.length;
  const variance=samples.reduce((a,p)=>a+(p.v-mean)**2,0);
  if(variance<100) throw new Error('拼图纹理不足，停止猜测');
  const scores=[];
  for(let offset=4;offset<=bg.width-piece.width;offset++) {
    let sum=0,sum2=0,cross=0;
    for(const p of samples) {
      const value=grey(bg.data,(p.y*bg.width+p.x+offset)*4);
      sum+=value;sum2+=value*value;cross+=(p.v-mean)*value;
    }
    const denom=Math.sqrt(variance*Math.max(1,sum2-sum*sum/samples.length));
    scores.push({offset,score:cross/denom});
  }
  scores.sort((a,b)=>b.score-a.score);
  const best=scores[0],second=scores.find(v=>Math.abs(v.offset-best.offset)>=8);
  const margin=best.score-(second?.score??0);
  if(best.score<0.50 || margin<0.025) throw new Error(`拼图匹配不确定，需人工处理（score=${best.score.toFixed(3)}, margin=${margin.toFixed(3)}）`);
  return {...best,margin,imageWidth:bg.width,samples:samples.length};
}

export async function solveVisiblePuzzle(page, {onChallenge, attempts=1, log=()=>{}}={}) {
  for(let attempt=1;attempt<=attempts;attempt++) {
    const panel=page.locator('.verifybox:visible');
    await panel.waitFor({state:'visible',timeout:20000});
    await page.waitForFunction(()=>{
      const nodes=[document.querySelector('.verifybox .verify-img-panel > img'),document.querySelector('.verifybox .verify-sub-block img')];
      return nodes.every(i=>i&&i.complete&&i.naturalWidth>0);
    });
    // A caller controlling this through Codex can require current-challenge approval.
    if(onChallenge) await onChallenge(page,attempt);
    const images=await page.evaluate(()=>({
      background:document.querySelector('.verifybox .verify-img-panel > img').src,
      piece:document.querySelector('.verifybox .verify-sub-block img').src,
    }));
    const matchStarted=performance.now();
    let match;
    try {match=matchPuzzle(images.background,images.piece);}
    catch(error) {
      const refresh=panel.locator('.verify-refresh:visible');
      if(attempt>=attempts||await refresh.count()!==1)throw error;
      log('captcha_refresh',{attempt,reason:'image_match_uncertain'});
      await refresh.click();
      await page.waitForFunction(old=>document.querySelector('.verifybox .verify-img-panel > img')?.src!==old,images.background,{timeout:10000});
      continue;
    }
    log('captcha_matched',{attempt,matchMs:Number((performance.now()-matchStarted).toFixed(2)),score:Number(match.score.toFixed(3))});
    // Hover waits for the popup's animation and loading overlay to finish.
    // Measuring an animating modal can otherwise drag page text instead.
    const sliderElement=panel.locator('.verify-move-block');
    await sliderElement.hover();
    const imageBox=await panel.locator('.verify-img-panel').boundingBox();
    const slider=await sliderElement.boundingBox();
    if(!slider||!imageBox) throw new Error('验证码已变化，停止拖动');
    const dx=match.offset*imageBox.width/match.imageWidth;
    const resultPromise=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/api/captcha/check') && r.request().method()==='POST',{timeout:12000});
    resultPromise.catch(()=>{});
    const x=slider.x+slider.width/2,y=slider.y+slider.height/2;
    await page.mouse.move(x,y);
    await page.mouse.down();
    try {await page.mouse.move(x+dx,y,{steps:20});}
    finally {await page.mouse.up();}
    const response=await resultPromise;
    const body=await response.json();
    const payload=body.data??body;
    const rep=payload.repCode??body.repCode;
    log('captcha_result',{attempt,score:Number(match.score.toFixed(3)),offset:match.offset,repCode:rep??null});
    if(String(rep)==='0000') {
      // The website submits from its own delayed success callback. The caller
      // waits for that server response; polling the panel adds avoidable delay.
      return {passed:true,attempt,score:match.score};
    }
    // Some installations wrap repCode one level deeper; never infer success solely
    // from HTTP 200. A submit response or visible payment page is checked by caller.
    if(rep===undefined) throw new Error('验证码返回结构变化，需检查真实验证结果');
    if(attempt===attempts) throw new Error('滑块验证失败，已停止自动尝试');
    await page.waitForFunction(old=>document.querySelector('.verifybox .verify-img-panel > img')?.src!==old,images.background,{timeout:10000});
  }
}
