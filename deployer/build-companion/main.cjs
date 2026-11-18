'use strict';

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const source = require('./source.json');
const actions = new Map([['build',['build.bat']],['run',['build.bat','--run']],['installer',['build-installer.bat']]]);
let window, active, lastDirectory;
let status = { phase:'idle', output:'', revision:source.revision, version:source.version, directory:'', code:null };

function update(values) {
  status = { ...status, ...values };
  if (window && !window.isDestroyed()) window.webContents.send('build:status',status);
}
function log(text) { update({ output:(status.output + text).slice(-16000) }); }
async function hash(file) {
  const h = crypto.createHash('sha256');
  for await (const bytes of fs.createReadStream(file)) h.update(bytes);
  return h.digest('hex');
}
function command(job, exe, args, cwd, inputFile) {
  if (job.cancelled) return Promise.reject(new Error('Cancelled'));
  return new Promise((resolve,reject) => {
    const p = spawn(exe,args,{ cwd, env:job.env, windowsHide:true, stdio:[inputFile?'pipe':'ignore','pipe','pipe'] });
    job.child=p;
    if (inputFile) {
      const stream = fs.createReadStream(inputFile);
      stream.on('error', error => p.stdin.destroy(error));
      p.stdin.on('error', error => { stream.destroy(); if (error.code !== 'EPIPE') reject(error); });
      p.once('close',() => stream.destroy());
      stream.pipe(p.stdin);
    }
    p.stdout.on('data',bytes => log(bytes.toString()));
    p.stderr.on('data',bytes => log(bytes.toString()));
    p.once('error',reject);
    p.once('close',code => {
      job.child=null;
      if (job.cancelled) return reject(new Error('Cancelled'));
      if (code !== 0) { const error=new Error('Child process exited with code ' + code); error.exitCode=code; return reject(error); }
      resolve();
    });
  });
}

async function execute(action) {
  const job = { child:null, cancelled:false, env:{ ...process.env } };
  active=job;
  update({ phase:'preparing',output:'',directory:'',code:null });
  try {
    // Each invocation gets its own user-owned checkout, including failed jobs.
    const builds=path.join(app.getPath('userData'),'builds');
    await fsp.mkdir(builds,{recursive:true});
    const directory=await fsp.mkdtemp(path.join(builds,source.revision.slice(0,10)+'-'));
    lastDirectory=directory;
    update({directory});
    const system=path.join(process.env.SystemRoot,'System32');
    const zip=path.join(process.resourcesPath,'git.zip');
    const pack=path.join(process.resourcesPath,'source.pack');
    if (await hash(pack)!==source.packHash || await hash(zip)!==source.gitHash) throw new Error('Bundled source or tool checksum mismatch.');
    const tools=path.join(directory,'tools');
    const repo=path.join(directory,'source');
    await Promise.all([fsp.mkdir(tools),fsp.mkdir(repo)]);
    for (const key of Object.keys(job.env)) if (/^(GIT_|GITHUB_|SILENT$|NODE_OPTIONS$|TEMPDESK_VERSION$)/i.test(key)) delete job.env[key];
    const pathKey=Object.keys(job.env).find(key=>key.toLowerCase()==='path') || 'Path';
    job.env[pathKey]=path.join(tools,'cmd')+';'+job.env[pathKey];
    job.env.GIT_CONFIG_NOSYSTEM='1';
    job.env.GIT_CONFIG_GLOBAL='NUL';
    await command(job,path.join(system,'tar.exe'),['-xf',zip,'-C',tools],directory);
    const git=path.join(tools,'cmd','git.exe');
    await command(job,git,['init','-b','source'],repo);
    await command(job,git,['index-pack','--stdin'],repo,pack);
    await fsp.writeFile(path.join(repo,'.git','shallow'),source.revision+'\n');
    await command(job,git,['update-ref','refs/heads/source',source.revision],repo);
    await command(job,git,['restore','--source=HEAD','--staged','--worktree','.'],repo);
    const options=actions.get(action);
    update({ phase:'building' });
    // All command words come from the fixed map. The checkout path is only cwd.
    await command(job,path.join(system,'cmd.exe'),['/d','/c',...options],repo);
    update({ phase:'finished',code:0 });
  } catch (error) {
    log('\n'+error.message+'\n');
    update({ phase:job.cancelled?'cancelled':'failed',code:error.exitCode??null });
  } finally { active=null; }
}

function valid(event) { return window && event.senderFrame===window.webContents.mainFrame; }
app.whenReady().then(() => {
  window=new BrowserWindow({ width:900,height:660,minWidth:440,minHeight:430,autoHideMenuBar:true,webPreferences:{
    preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,
  }});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',event=>event.preventDefault());
  window.on('close',event=>{ if(active) event.preventDefault(); });
  const words={ en:require('./en.json'), 'zh-HK':require('./zh-HK.json') };
  ipcMain.handle('build:language',(event,code)=>valid(event)?words[code==='zh-HK'?'zh-HK':'en']:null);
  ipcMain.handle('build:status',event=>valid(event)?status:null);
  ipcMain.handle('build:start',(event,action)=>{
    if (!valid(event)||active||!actions.has(action)) return false;
    void execute(action);
    return true;
  });
  ipcMain.handle('build:cancel',event=>{
    if (!valid(event)||!active) return false;
    const current=active;
    current.cancelled=true;
    if (current.child?.pid && current.child.exitCode===null) {
      const killer=spawn(path.join(process.env.SystemRoot,'System32','taskkill.exe'),['/pid',String(current.child.pid),'/t','/f'],{windowsHide:true,stdio:'ignore'});
      killer.on('error',error=>log('\n'+error.message+'\n'));
    }
    return true;
  });
  ipcMain.handle('build:open',event=>valid(event)&&lastDirectory?shell.openPath(lastDirectory):'');
  window.loadFile(path.join(__dirname,'index.html'));
});
app.on('window-all-closed',()=>app.quit());
