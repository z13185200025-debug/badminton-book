import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';

export const MAX_ACCOUNTS=8;
export function accountPaths(root,id='default') {
  if(id!=='default'&&!/^a-[a-f0-9]{16}$/.test(id))throw new Error('账号标识无效');
  const state=id==='default'?path.join(root,'.state'):path.join(root,'.state','accounts',id);
  return {state,profile:path.join(state,'profile'),lock:path.join(state,'run.lock'),status:path.join(state,'status.json')};
}
export function accountConfig(base,account) {
  return {...base,...account.preferences,accountId:account.id,accountName:account.accountName,schoolAutomationPermissionConfirmed:account.permissionConfirmed===true};
}
export function planPreferences(config) {
  return Object.fromEntries(['candidates','autoPay','headless','bookingDelayMs'].map(key=>[key,config[key]]));
}
export async function createAccountStore(root,base) {
  const filename=path.join(root,'.state','accounts.json');
  let document;
  try{document=JSON.parse(await fs.readFile(filename,'utf8'));}
  catch(error){if(error.code!=='ENOENT')throw error;document={version:1,accounts:[{id:'default',label:base.accountName||'主账号',accountName:base.accountName||'',permissionConfirmed:base.schoolAutomationPermissionConfirmed===true}]};}
  if(document.version!==1||!Array.isArray(document.accounts)||!document.accounts.length||document.accounts.length>MAX_ACCOUNTS)throw new Error('账号资料格式无效，请保留文件并检查');
  for(const account of document.accounts)accountPaths(root,account.id);
  if(new Set(document.accounts.map(a=>a.id)).size!==document.accounts.length)throw new Error('账号资料包含重复标识');
  const save=async next=>{await fs.writeFile(filename+'.tmp',JSON.stringify(next,null,2)+'\n',{mode:0o600});await fs.rename(filename+'.tmp',filename);document=next;};
  const get=id=>{const account=document.accounts.find(a=>a.id===id);if(!account)throw new Error('账号不存在');return structuredClone(account);};
  return {
    list:()=>structuredClone(document.accounts),get,
    async upsert(input) {
      const id=input.accountId||`a-${randomBytes(8).toString('hex')}`;
      const previous=input.accountId?get(id):null;
      if(!previous&&document.accounts.length>=MAX_ACCOUNTS)throw new Error(`最多添加 ${MAX_ACCOUNTS} 个账号`);
      const accountName=String(input.accountName||'').trim(),label=String(input.label||accountName).trim();
      if(!accountName||accountName.length>60)throw new Error('请输入网页显示的账号姓名');
      if(!label||label.length>40)throw new Error('账号备注须为 1–40 个字符');
      if(document.accounts.some(a=>a.id!==id&&a.accountName===accountName))throw new Error('此姓名已有账号，请使用已有账号，避免重复登录同一账号');
      const account={...(previous||{preferences:{autoPay:false}}),id,label,accountName,permissionConfirmed:input.permissionConfirmed===true};
      // A renamed login identity must not inherit a verified-login claim.
      if(previous?.accountName!==accountName)delete account.lastLoginVerifiedAt;
      await save({...document,accounts:previous?document.accounts.map(a=>a.id===id?account:a):[...document.accounts,account]});
      return structuredClone(account);
    },
    async savePlans(plans) {
      const updates=new Map(plans.map(({account,plan})=>[account.id,planPreferences(plan.config)]));
      await save({...document,accounts:document.accounts.map(a=>updates.has(a.id)?{...a,preferences:updates.get(a.id)}:a)});
    },
  };
}
