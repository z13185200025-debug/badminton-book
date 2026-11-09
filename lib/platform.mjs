import fs from 'node:fs';
import path from 'node:path';

// Keep the UI and every account on the same browser engine. Explicit overrides
// are also used by offline CI; never reuse a user's everyday browser profile.
export function browserOptions({platform=process.platform,env=process.env,exists=fs.existsSync}={}) {
  if(env.BADMINTON_BROWSER_EXECUTABLE) {
    const filename=env.BADMINTON_BROWSER_EXECUTABLE;
    if(!(platform==='win32'?path.win32:path.posix).isAbsolute(filename)||!exists(filename))throw new Error('BADMINTON_BROWSER_EXECUTABLE 必须是已安装浏览器的绝对路径');
    return {executablePath:filename};
  }
  const channel=env.BADMINTON_BROWSER_CHANNEL;
  if(channel) {
    if(!['chrome','msedge','chromium'].includes(channel))throw new Error('浏览器须为 chrome、msedge 或 chromium');
    return channel==='chromium'?{}:{channel};
  }
  if(platform==='win32') {
    for(const [relative,browser] of [['Google/Chrome/Application/chrome.exe','chrome'],['Microsoft/Edge/Application/msedge.exe','msedge']]) {
      for(const base of [env.PROGRAMFILES,env['PROGRAMFILES(X86)'],env.LOCALAPPDATA]) {
        if(base&&exists(path.win32.join(base,relative)))return {channel:browser};
      }
    }
  } else if(platform==='darwin') {
    if(exists('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'))return {channel:'chrome'};
  } else if(platform==='linux') {
    for(const filename of ['/opt/google/chrome/chrome','/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser']) {
      if(exists(filename))return {executablePath:filename};
    }
  }
  throw new Error('未找到 Chrome / Chromium（Windows 也支持 Edge）。请安装浏览器，或设置 BADMINTON_BROWSER_EXECUTABLE 为浏览器绝对路径。');
}

export function validateRuntime({version=process.versions.node,platform=process.platform,env=process.env,headless=false}={}) {
  if(Number(version.split('.')[0])<22)throw new Error('需要 Node.js 22 或更高版本，请安装 Node.js LTS 后重新打开');
  if(!['darwin','win32','linux'].includes(platform))throw new Error('支持 macOS、Windows 和 Linux');
  if(platform==='linux'&&!headless&&!env.DISPLAY&&!env.WAYLAND_DISPLAY)throw new Error('请在 Linux 图形桌面打开助手；首次账号登录需要可见的浏览器窗口');
}
