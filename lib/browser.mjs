export async function reduceVisualDelay(context) {
  // Only shorten presentation transitions. Loading overlays, the CAPTCHA,
  // countdowns and disabled controls retain their original visibility/logic.
  await context.addInitScript(()=>{
    const install=()=>{
      if(!document.documentElement||document.getElementById('badminton-reduced-motion'))return;
      const style=document.createElement('style');style.id='badminton-reduced-motion';
      style.textContent='.ivu-spin-fix,.ivu-modal,.ivu-modal-wrap,.ivu-modal-mask{transition-duration:0s!important;animation-duration:0s!important;animation-delay:0s!important}';
      document.documentElement.appendChild(style);
    };
    install();document.addEventListener('DOMContentLoaded',install,{once:true});
  });
}
