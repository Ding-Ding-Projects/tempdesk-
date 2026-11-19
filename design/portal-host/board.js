'use strict';
// Local design rehearsal only. Every system result is a selected fixture.
const steps=[
 ['Check Docker','檢查 Docker'],['Publication receipt','發佈紀錄'],['Configuration','設定檔'],['LAN and project','區域網絡及專案'],['Review deployment','核對部署'],['Start portals','啟動入口網站']
];
const sample={
 image:'ghcr.io/example/tempdesk-portal@sha256:'+'a1'.repeat(32),rev:'2c'.repeat(20),tag:'v1.4.2',
 folder:'portal-config',overlay:'site.compose.yaml',ip:'192.0.2.24',project:'commons-lab',guest:'8080',admin:'8081'
};
const model={step:0,lang:'en',receipt:false,config:false,overlay:false,failure:'none',progress:0,started:false,done:false,paused:false};
const $=id=>document.getElementById(id);
const tx=(en,zh)=>model.lang==='zh-HK'?zh:model.lang==='bi'?en+' / '+zh:en;
function node(tag,text,cls){const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;}
function button(en,zh,fn,primary=false){const b=node('button',tx(en,zh),primary?'primary':'');b.type='button';b.onclick=fn;return b;}
function line(parent,en,zh,value){const r=node('div',null,'line');r.append(node('strong',tx(en,zh)),node('span',value));parent.append(r);}
function input(parent,en,zh,key){const l=node('label',null,'field');const n=node('input');n.value=sample[key];n.oninput=()=>{sample[key]=n.value;updateNext();};l.append(node('span',tx(en,zh)),n);parent.append(l);}
function validNetwork(){const parts=sample.ip.split('.');return parts.length===4&&parts.every(p=>/^\d{1,3}$/.test(p)&&Number(p)<=255)&&parts[0]!=='127'&&parts[0]!=='0'&&/^[a-z0-9][a-z0-9_-]*$/.test(sample.project)&&[sample.guest,sample.admin].every(p=>/^\d+$/.test(p)&&+p>0&&+p<=65535)&&+sample.guest!==+sample.admin;}
function mayAdvance(){return [model.failure!=='engine',model.receipt&&model.failure!=='receipt',model.config,validNetwork(),model.failure!=='conflict'][model.step]??false;}
function updateNext(){if($('next'))$('next').disabled=!mayAdvance();}
function render(focus=false){
 document.documentElement.lang=model.lang==='zh-HK'?'zh-HK':'en';
 const texts={
   language:['Language','語言'],fixture:['Example state','範例狀態'],accent:['Accent','主色'],motion:['Motion','動態'],preview:['Design preview','設計預覽'],
   reopen:['Reopen saved project','重新開啟已儲存專案'],none:['New project','新專案'],engine:['Engine offline','引擎離線'],receipt:['Receipt rejected','紀錄無效'],health:['Admin offline','管理離線'],reuse:['Reuse','重用'],conflict:['Conflict','衝突']
 };
 for(const el of document.querySelectorAll('[data-copy]'))el.textContent=tx(...texts[el.dataset.copy]);
 for(const opt of $('fixture').options)opt.textContent=tx(...texts[opt.value]);
 $('steps').parentElement.setAttribute('aria-label',tx('Setup steps','設定步驟'));
 $('steps').replaceChildren(...steps.map((p,i)=>{const el=node('li',tx(...p));if(i===model.step)el.setAttribute('aria-current','step');return el;}));
 $('phase').textContent=tx('Step','步驟')+' '+(model.step+1)+' / 6';$('label').textContent=tx(...steps[model.step]);
 const c=$('content');c.replaceChildren();const hint=(en,zh)=>c.append(node('p',tx(en,zh)));const warn=(en,zh)=>c.append(node('div',tx(en,zh),'notice'));
 if(model.step===0){hint('Check the Linux engine and Compose before choosing a release.','選擇版本前，先檢查 Linux 引擎及 Compose。');line(c,'Engine','引擎',model.failure==='engine'?tx('Unavailable','無法使用'):'Docker Desktop · Linux');line(c,'Compose','Compose',model.failure==='engine'?'—':'v2');if(model.failure==='engine')warn('Start Docker Desktop, switch to Linux containers, then check again.','請啟動 Docker Desktop 並切換至 Linux 容器，然後重新檢查。');}
 if(model.step===1){hint('Choose a publication receipt and check the release it identifies.','選擇發佈紀錄，讀取及核對版本身分。');c.append(button('Choose example receipt','選擇範例紀錄',()=>{model.receipt=true;render();content.querySelector('button').focus();}));if(model.receipt){line(c,'Receipt','紀錄','tempdesk-portal-publication.json');line(c,'Publication state','發佈狀態',model.failure==='receipt'?'pending':'published');if(model.failure==='receipt')warn('This publication has no accepted image. Choose an accepted receipt.','此發佈未有獲接納的映像檔，請選擇其他紀錄。');else{line(c,'Release','版本',sample.tag);line(c,'Revision','原始碼版本',sample.rev);line(c,'Image digest','映像摘要',sample.image.split('@')[1]);}}}
 if(model.step===2){
   hint('Select the protected configuration directory. Add a reviewed Compose overlay only if this installation uses one.','請選擇受保護的設定資料夾；只有現有部署需要時，才加入已核對的 Compose 覆蓋檔。');
   const dir=button('Choose example directory','選擇範例資料夾',()=>{model.config=true;render();$('choose-dir').focus();});dir.id='choose-dir';c.append(dir);
   if(model.config)line(c,'Directory in place','原位設定資料夾',sample.folder);
   const over=button(model.overlay?'Remove overlay selection':'Select example overlay (optional)',model.overlay?'取消選用覆蓋檔':'選擇範例覆蓋檔（選填）',()=>{model.overlay=!model.overlay;render();$('choose-overlay').focus();});over.id='choose-overlay';c.append(over);
   if(model.overlay)line(c,'Reviewed overlay','已核對的覆蓋檔',sample.overlay);
 }
 if(model.step===3){hint('A generated override binds both services to the selected LAN address and distinct ports. Original configuration stays in place.','產生的覆蓋設定會把兩項服務綁定至所選區域網絡位址及兩個不同連接埠，原有設定保留原位。');input(c,'LAN IPv4 address','區域網絡 IPv4 位址','ip');input(c,'Compose project','Compose 專案','project');input(c,'Guest host port','訪客連接埠','guest');input(c,'Management host port','管理連接埠','admin');}
 if(model.step===4){hint('Review the immutable release, generated override and ownership check before starting.','啟動前請核對固定版本、產生的覆蓋設定及資源擁有權。');line(c,'Release','版本',sample.tag);line(c,'Revision','原始碼版本',sample.rev);line(c,'Image','映像檔',sample.image);line(c,'Directory','資料夾',sample.folder);if(model.overlay)line(c,'Optional overlay','選用覆蓋檔',sample.overlay);line(c,'COMPOSE_PROJECT_NAME','COMPOSE_PROJECT_NAME',sample.project);line(c,'Guest','訪客',sample.ip+':'+sample.guest);line(c,'Management','管理',sample.ip+':'+sample.admin+'/login');line(c,'Resource ownership','資源擁有權',model.failure==='conflict'?tx('Conflict: foreign resources','衝突：資源由其他專案擁有'):model.failure==='reuse'?tx('Verified existing project resources','已核實由此專案擁有的現有資源'):tx('New project; no collisions','新專案，未發現衝突'));if(model.failure==='conflict')warn('Startup blocked. Choose another project or ports and repeat the ownership check.','無法啟動。請選擇其他專案名稱或連接埠，再核對擁有權。');}
 if(model.step===0 && model.failure==='reopen'){
   line(c,'Compose project','Compose 專案',sample.project);line(c,'Release','版本',sample.tag);
   const check=button('Check Docker and Compose','檢查 Docker 及 Compose',()=>{model.engineChecked=true;render(true);});
   const recheck=button('Recheck endpoint health','重新檢查端點狀態',()=>{model.step=5;model.progress=2;model.done=false;model.paused=false;render(true);});
   recheck.disabled=!model.engineChecked;c.append(check,recheck);
 }
 if(model.step===5){
   const stages=[['Pull image by digest','按摘要拉取映像檔'],['Start Compose services','啟動 Compose 服務'],['Verify guest health','驗證訪客服務'],['Verify management health','驗證管理服務']];
   for(let i=model.failure==='reopen'?2:0;i<stages.length;i++)line(c,...stages[i],i<model.progress?tx('Confirmed','已確認'):i===3&&model.failure==='health'?tx('Health check failed','健康檢查失敗'):i===model.progress&&!model.paused?tx('In progress','進行中'):tx('Pending','尚待處理'));
   if(model.paused)warn('Observation paused. Inspect existing services before retrying. Running services were preserved.','已暫停觀察。重試前請檢查現有服務；執行中的服務已保留。');
   else if(model.failure==='health'&&model.progress===3)warn('Management did not pass its health check. Inspect its logs and port mapping, then recheck health.','管理服務未通過檢查。請檢查記錄及連接埠，再驗證健康狀態。');
   for(const [index,label,zh,port,suffix] of [[2,'Guest URL','訪客網址',sample.guest,'/'],[3,'Management URL','管理網址',sample.admin,'/login']]){
     if(model.progress<=index)continue;
     const href='http://'+sample.ip+':'+port+suffix, block=node('div',null,'line'), link=node('a',href,'result');
     link.href=href;link.onclick=e=>{e.preventDefault();$('link-note').textContent=tx('Example link only; no connection opened.','僅為範例連結，未有連線。');};
     block.append(node('strong',tx(label,zh)),link);c.append(block);
   }
   const note=node('p');note.id='link-note';note.setAttribute('role','status');c.append(note);
 }
 const f=$('actions');f.replaceChildren();
 if(model.step>0&&model.step<5)f.append(button('Back','上一步',()=>{model.step--;render(true);}));
 if(model.step<5){const b=button(model.step===4?'Start example deployment':'Next',model.step===4?'啟動範例部署':'下一步',()=>{model.step++;if(model.step===5){model.started=true;model.progress=0;}render(true);},true);b.id='next';f.append(b);updateNext();}
 else if(!model.done && model.failure==='health' && model.progress===3 && !model.paused){
   f.append(button('Recheck health only (example)','只重查健康狀態（範例）',()=>{model.failure='none';$('fixture').value='none';model.progress=4;model.done=true;render(true);},true));
 }else if(!model.done){f.append(button(model.paused?'Resume observation':'Advance example event',model.paused?'繼續觀察':'顯示下一個範例事件',()=>{if(model.paused)model.paused=false;else if(!(model.failure==='health'&&model.progress===3))model.progress++;model.done=model.progress===4;render(true);},true));}
 if(!model.done&&!model.paused)f.append(button(model.started?'Stop observing':'Cancel setup',model.started?'停止觀察':'取消設定',()=>{if(model.started)model.paused=true;else {model.step=0;model.receipt=false;model.config=false;model.overlay=false;}render(true);}));
 if(focus)$('label').focus();
}
$('lang').onchange=e=>{model.lang=e.target.value;render();};$('fixture').onchange=e=>{model.failure=e.target.value;if(model.failure==='reopen'){model.step=0;model.engineChecked=false;model.progress=0;model.done=false;}render();};
$('accent').oninput=e=>document.querySelector('.board').style.setProperty('--accent',e.target.value);
$('motion').onchange=e=>document.body.dataset.motion=e.target.checked?'on':'off';
const query=new URLSearchParams(location.search);
const previewScene=query.get('scene');
if(previewScene==='review'||previewScene==='partial'){
  model.step=previewScene==='review'?4:5;model.receipt=true;model.config=true;model.overlay=true;
  model.started=model.step===5;model.progress=model.started?3:0;model.failure=model.started?'health':'reuse';
  $('fixture').value=model.failure;
}
if(['en','zh-HK','bi'].includes(query.get('lang'))){model.lang=query.get('lang');$('lang').value=model.lang;}
render();
