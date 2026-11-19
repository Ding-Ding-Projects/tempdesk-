'use strict';
// Local design rehearsal only. Every system result is a selected fixture.
const steps=[
 ['Check Docker','檢查 Docker'],['Publication receipt','發佈紀錄'],['Configuration','設定檔'],['LAN and project','區域網絡及專案'],['Review deployment','核對部署'],['Start portals','啟動入口網站']
];
const sample={
 image:'ghcr.io/example/tempdesk-portal@sha256:'+'a1'.repeat(32),rev:'2c'.repeat(20),tag:'v1.4.2',
 folder:'portal-config',overlay:'site.compose.yaml',ip:'192.0.2.24',project:'commons-lab',guest:'8080',admin:'8081'
};
const model={step:0,lang:'en',receipt:false,config:false,kind:'directory',failure:'none',progress:0,started:false,done:false,paused:false};
const $=id=>document.getElementById(id);
const tx=(en,zh)=>model.lang==='zh-HK'?zh:model.lang==='bi'?en+' / '+zh:en;
function node(tag,text,cls){const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;}
function button(en,zh,fn,primary=false){const b=node('button',tx(en,zh),primary?'primary':'');b.type='button';b.onclick=fn;return b;}
function line(parent,en,zh,value){const r=node('div',null,'line');r.append(node('strong',tx(en,zh)),node('span',value));parent.append(r);}
function input(parent,en,zh,key){const l=node('label',null,'field');const n=node('input');n.value=sample[key];n.oninput=()=>{sample[key]=n.value;updateNext();};l.append(node('span',tx(en,zh)),n);parent.append(l);}
function validNetwork(){const parts=sample.ip.split('.');return parts.length===4&&parts.every(p=>/^\d{1,3}$/.test(p)&&Number(p)<=255)&&parts[0]!=='127'&&parts[0]!=='0'&&/^[a-z0-9][a-z0-9_-]*$/.test(sample.project)&&[sample.guest,sample.admin].every(p=>/^\d+$/.test(p)&&+p>0&&+p<=65535)&&+sample.guest!==+sample.admin;}
function mayAdvance(){return [model.failure!=='engine',model.receipt&&model.failure!=='receipt',model.config,validNetwork(),true][model.step]??false;}
function updateNext(){if($('next'))$('next').disabled=!mayAdvance();}
function render(focus=false){
 document.documentElement.lang=model.lang==='zh-HK'?'zh-HK':'en';
 $('steps').replaceChildren(...steps.map((p,i)=>{const el=node('li',tx(...p));if(i===model.step)el.setAttribute('aria-current','step');return el;}));
 $('phase').textContent=tx('Step','步驟')+' '+(model.step+1)+' / 6';$('label').textContent=tx(...steps[model.step]);
 const c=$('content');c.replaceChildren();const hint=(en,zh)=>c.append(node('p',tx(en,zh)));const warn=(en,zh)=>c.append(node('div',tx(en,zh),'notice'));
 if(model.step===0){hint('Check the Linux engine and Compose before choosing a release.','選擇版本前，先檢查 Linux 引擎及 Compose。');line(c,'Engine','引擎',model.failure==='engine'?tx('Unavailable','無法使用'):'Docker Desktop · Linux');line(c,'Compose','Compose',model.failure==='engine'?'—':'v2');if(model.failure==='engine')warn('Start Docker Desktop, switch to Linux containers, then check again.','請啟動 Docker Desktop 並切換至 Linux 容器，然後重新檢查。');}
 if(model.step===1){hint('Read the signed-in operator’s selected publication receipt before accepting its release identity.','選擇發佈紀錄，讀取及核對版本身分。');c.append(button('Choose example receipt','選擇範例紀錄',()=>{model.receipt=true;render();}));if(model.receipt){line(c,'Receipt','紀錄','tempdesk-portal-publication.json');line(c,'Publication state','發佈狀態',model.failure==='receipt'?'pending':'published');if(model.failure==='receipt')warn('This publication has no accepted image. Choose an accepted receipt.','此發佈未有獲接納的映像檔，請選擇其他紀錄。');else{line(c,'Release','版本',sample.tag);line(c,'Revision','原始碼版本',sample.rev);line(c,'Image digest','映像摘要',sample.image.split('@')[1]);}}}
 if(model.step===2){hint('Use existing configuration in place. Its protected contents are never shown.','直接使用現有設定，受保護內容不會顯示。');const row=node('div',null,'row');for(const [k,en,zh] of [['directory','Configuration directory','設定資料夾'],['overlay','Existing Compose overlay','現有 Compose 覆蓋檔']]){const b=button(en,zh,()=>{model.kind=k;model.config=true;render();});b.setAttribute('aria-pressed',String(model.config&&model.kind===k));row.append(b);}c.append(row);if(model.config){line(c,'Selection','已選擇',model.kind==='directory'?sample.folder:sample.overlay);line(c,'Access','存取方式',tx('Use in place','原位使用'));}}
 if(model.step===3){hint('Choose the LAN address and an isolated Compose project. Existing overlay mappings stay authoritative.','選擇區域網絡位址及獨立的 Compose 專案。現有覆蓋檔的連接埠設定優先。');input(c,'LAN IPv4 address','區域網絡 IPv4 位址','ip');input(c,'Compose project','Compose 專案','project');if(model.kind==='directory'){input(c,'Guest host port','訪客連接埠','guest');input(c,'Management host port','管理連接埠','admin');}else{line(c,'Resolved ports','解析後的連接埠',sample.guest+' / '+sample.admin);}}
 if(model.step===4){hint('Start will pull this immutable image and start the two services.','啟動時會拉取此固定映像檔及啟動兩項服務。');line(c,'Release and revision','版本及原始碼',sample.tag+' · '+sample.rev);line(c,'Image','映像檔',sample.image);line(c,'Configuration','設定',model.kind==='directory'?sample.folder:sample.overlay);line(c,'Project','專案',sample.project);line(c,'Guest','訪客',sample.ip+':'+sample.guest);line(c,'Management','管理',sample.ip+':'+sample.admin+'/login');}
 if(model.step===5){
   const stages=[['Pull image by digest','按摘要拉取映像檔'],['Start Compose services','啟動 Compose 服務'],['Verify guest health','驗證訪客服務'],['Verify management health','驗證管理服務']];
   for(let i=0;i<stages.length;i++)line(c,...stages[i],i<model.progress?tx('Confirmed','已確認'):i===model.progress&&!model.paused?tx('In progress','進行中'):tx('Pending','尚待處理'));
   if(model.paused)warn('Observation paused. Inspect existing services before retrying. Running services were preserved.','已暫停觀察。重試前請檢查現有服務；執行中的服務已保留。');
   else if(model.failure==='health'&&model.progress===3)warn('Management did not pass its health check. Inspect its logs and port mapping, then recheck health.','管理服務未通過檢查。請檢查記錄及連接埠，再驗證健康狀態。');
   if(model.done){hint('Both example endpoints returned the expected revision.','兩個範例端點均傳回預期的版本。');line(c,'Guest URL','訪客網址','http://'+sample.ip+':'+sample.guest+'/');line(c,'Management URL','管理網址','http://'+sample.ip+':'+sample.admin+'/login');}
 }
 const f=$('actions');f.replaceChildren();
 if(model.step>0&&model.step<5)f.append(button('Back','上一步',()=>{model.step--;render(true);}));
 if(model.step<5){const b=button(model.step===4?'Start example deployment':'Next',model.step===4?'啟動範例部署':'下一步',()=>{model.step++;if(model.step===5){model.started=true;model.progress=0;}render(true);},true);b.id='next';f.append(b);updateNext();}
 else if(!model.done){f.append(button(model.paused?'Resume observation':'Advance example event',model.paused?'繼續觀察':'顯示下一個範例事件',()=>{if(model.paused)model.paused=false;else if(!(model.failure==='health'&&model.progress===3))model.progress++;model.done=model.progress===4;render(true);},true));}
 if(!model.done&&!model.paused)f.append(button(model.started?'Stop observing':'Cancel setup',model.started?'停止觀察':'取消設定',()=>{if(model.started)model.paused=true;else {model.step=0;model.receipt=false;model.config=false;}render(true);}));
 if(focus)$('label').focus();
}
$('lang').onchange=e=>{model.lang=e.target.value;render();};$('fixture').onchange=e=>{model.failure=e.target.value;render();};
$('accent').oninput=e=>document.documentElement.style.setProperty('--accent',e.target.value);
$('motion').onchange=e=>document.body.dataset.motion=e.target.checked?'on':'off';
render();
