import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {zipSync,unzipSync} from 'fflate';

const root=path.resolve(import.meta.dirname,'..');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export const releaseFiles=['booking.mjs','package.json','package-lock.json','config.example.json','README.md','THIRD_PARTY_NOTICES.md','使用说明.html','使用说明.txt','发布说明.txt'];
export const releaseDirectories=['lib','tests','ui','docs'];
export const releaseTools=['start-app.mjs','ui-server.mjs','test.mjs','package-release.mjs','smoke-package.mjs','run-node.sh'];
const privatePath=/(?:^|\/)(?:\.state|artifacts|config\.json|config\.previous\.json|\.env(?:\.[^/]*)?)(?:\/|$)/;

export function verifyArchive(bytes) {
  const entries=unzipSync(bytes),names=Object.keys(entries);
  if(names.some(name=>name.includes('\\')||name.startsWith('/')||name.split('/').some(p=>p==='..')||privatePath.test(name)))throw new Error('发布包含不允许的路径');
  const manifests=names.filter(name=>/^[^/]+\/MANIFEST\.json$/.test(name));
  if(manifests.length!==1)throw new Error('发布包缺少唯一清单');
  const manifest=JSON.parse(Buffer.from(entries[manifests[0]]).toString('utf8'));
  if(manifests[0]!==`${manifest.name}/MANIFEST.json`)throw new Error('清单根目录不匹配');
  if(names.length!==manifest.files.length+1)throw new Error('文件数量与清单不符');
  const seen=new Set();
  for(const file of manifest.files) {
    if(seen.has(file.path))throw new Error('清单包含重复路径');seen.add(file.path);
    const data=entries[`${manifest.name}/${file.path}`];
    if(!data||data.length!==file.bytes||digest(data)!==file.sha256)throw new Error(`文件校验失败：${file.path}`);
  }
  return {manifest,entries};
}

export async function createPortableArchive({projectRoot=root,platform,outDir=path.join(projectRoot,'release')}={}) {
  if(!['windows','linux','macos'].includes(platform))throw new Error('仅支持 macos、windows、linux');
  const pkg=JSON.parse(await fs.readFile(path.join(projectRoot,'package.json'),'utf8'));
  const name=`badminton-book-${pkg.version}-${platform}`,archive=path.join(outDir,name+'.zip');
  const inputs=[...releaseFiles,...releaseTools.map(file=>'tools/'+file),'start-windows.cmd','start-linux.sh'];
  async function walk(relative) {
    const stat=await fs.lstat(path.join(projectRoot,relative));
    if(stat.isSymbolicLink())throw new Error(`发布文件不能是符号链接：${relative}`);
    if(stat.isDirectory()){for(const entry of (await fs.readdir(path.join(projectRoot,relative))).sort())await walk(relative+'/'+entry);}
    else inputs.push(relative);
  }
  for(const directory of [...releaseDirectories,...Object.keys(pkg.dependencies).map(name=>'node_modules/'+name)])await walk(directory);
  if(platform==='macos'){inputs.push('打开预约助手.command');await walk('羽毛球预约助手.app');}
  const entries={},records=[];
  for(const relative of [...new Set(inputs)].sort()) {
    if(privatePath.test(relative))throw new Error('发布包含本机私有数据');
    const filename=path.join(projectRoot,relative),stat=await fs.lstat(filename);
    if(!stat.isFile()||stat.isSymbolicLink())throw new Error(`发布文件必须是普通文件：${relative}`);
    const data=await fs.readFile(filename),mode=/\.(sh|command)$|\.app\/Contents\/MacOS\//.test(relative)?0o100755:0o100644;
    if(!relative.startsWith('node_modules/')&&data.includes(Buffer.from(projectRoot)))throw new Error(`发布文件包含本机绝对路径：${relative}`);
    entries[`${name}/${relative}`]=[data,{os:3,attrs:(mode<<16)>>>0}];
    records.push({path:relative,bytes:data.length,sha256:digest(data)});
  }
  const manifest={name,version:pkg.version,platform,createdAt:new Date().toISOString(),files:records};
  entries[`${name}/MANIFEST.json`]=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
  const bytes=zipSync(entries,{level:6});verifyArchive(bytes);
  await fs.mkdir(outDir,{recursive:true});
  await fs.writeFile(archive,bytes,{flag:'wx'});
  const sha256=digest(bytes);await fs.writeFile(archive+'.sha256',`${sha256}  ${path.basename(archive)}\n`,{flag:'wx'});
  return {archive,platform,sha256,files:records.length,privateDataIncluded:false};
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])) {
  const selected=process.argv[2]||'all';
  for(const platform of selected==='all'?['macos','windows','linux']:[selected])console.log(JSON.stringify(await createPortableArchive({platform})));
}
