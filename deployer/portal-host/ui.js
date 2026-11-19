(() => {
  'use strict';
  const api = window.portalHost;
  const byId = id => document.getElementById(id);
  const steps = ['docker','receipt','config','network','review','launch'];
  const copy = {
    docker:['Check Docker','檢查 Docker'], receipt:['Publication receipt','發佈憑證'], config:['Configuration','設定'],
    network:['LAN and project','區域網絡及專案'], review:['Review deployment','覆核部署'], launch:['Start and verify','啟動及驗證'],
    lang:['Language','語言'], motion:['Motion','動態效果'], step:['Step','步驟'], version:['Version','版本'], revision:['Source revision','原始碼修訂版本'],
    release:['Release','發佈版本'], digest:['Image digest','映像摘要'], file:['Selected receipt','所選憑證'], empty:['Not selected','未選擇'],
    unavailable:['Unavailable','未能使用'], next:['Next','下一步'], back:['Back','上一步'], check:['Check Docker and Compose','檢查 Docker 及 Compose'],
    dockerHelp:['Check the local Linux engine and Compose before selecting a publication.','選擇發佈版本前，先檢查本機 Linux 引擎及 Compose。'],
    receiptHelp:['Choose the publication receipt for the immutable image you want to host.','選擇要託管的固定映像所屬的發佈憑證。'],
    configHelp:['Choose the existing protected configuration directory. Add a reviewed Compose overlay only if needed.','選擇現有受保護設定資料夾。如有需要，可另外選擇已覆核的 Compose 覆寫檔。'],
    networkHelp:['Choose the LAN address guests can reach and two different ports.','選擇訪客可以連接的區域網絡位址，以及兩個不同連接埠。'],
    reviewHelp:['Review both endpoint candidates before starting the project.','啟動專案前，請覆核兩個預定端點。'],
    chooseReceipt:['Choose receipt','選擇憑證'], chooseConfig:['Choose configuration directory','選擇設定資料夾'],chooseOverlay:['Choose optional overlay','選擇選用覆寫檔'],
    clearOverlay:['Clear optional overlay','清除選用覆寫檔'],
    directory:['Configuration directory','設定資料夾'], overlay:['Optional overlay','選用覆寫檔'], project:['Compose project','Compose 專案'],
    address:['LAN address','區域網絡位址'], guestPort:['Guest port','訪客連接埠'],managementPort:['Management port','管理連接埠'],none:['None','無'],
    start:['Start portals','啟動入口網站'],recheck:['Recheck endpoint health','重新檢查端點狀態'],stop:['Request cancellation','要求取消'],
    stopHelp:['Cancellation takes effect before startup. An underway start finishes and reports its outcome.','取消會喺啟動前生效。已開始嘅啟動會完成並報告結果。'],
    guest:['Guest portal','訪客入口網站'],management:['Management portal','管理入口網站'],open:['Open','開啟'],
    unchecked:['Not checked','尚未檢查'],checking:['Checking','檢查中'],ready:['Ready','已就緒'],
    idle:['Not started','尚未啟動'],preparing:['Preparing','準備中'],pulling:['Pulling image','正在下載映像'],starting:['Starting containers','正在啟動容器'],
    succeeded:['Both portals verified','兩個入口網站已驗證'],partial:['Partially available','部分可用'],failed:['Deployment failed','部署失敗'],cancelled:['Cancelled before startup','已喺啟動前取消'],
    code:['Exit code','結束代碼'],elapsed:['Elapsed seconds','經過秒數'],phase:['Operation','操作狀態'],verified:['Verified','已驗證'],
    started:['Started, health unverified','已啟動，健康狀態未驗證'],unverified:['Unverified','未驗證'],cancelling:['Cancellation requested','已要求取消'],
    ownership:['Project ownership','專案擁有權'],ownershipUnknown:['Ownership has not been verified. Startup checks the selected project before changing it.','尚未驗證擁有權。啟動前會先檢查所選專案。'],
    cancelSetup:['Cancel setup','取消設定'], reasonReceipt:['The publication receipt is missing or was not accepted. Choose a valid release receipt.','缺少發佈憑證或憑證未獲接納。請選擇有效的發佈憑證。'],
    reasonDependency:['Docker or Compose is unavailable. Check the engine and try again.','Docker 或 Compose 未能使用。請檢查引擎後再試。'],
    reasonRuntime:['The bundled hosting runtime is unavailable. Reopen the matching published wizard.','隨附的託管元件未能使用。請重新開啟對應的已發佈精靈。'],
    reasonPull:['The immutable image could not be pulled. Check registry access and retry.','未能下載所選固定映像。請檢查登錄庫存取權後再試。'],
    reasonStartup:['The hosting operation did not start successfully. Review the selected configuration.','未能成功啟動託管操作。請覆核所選設定。'],
    reasonVerify:['Endpoint verification did not complete. Recheck health when the service is ready.','端點驗證未完成。服務就緒後請重新檢查。'],
    conflict:['Project ownership or configuration conflict. Review the configuration and project before retrying.','專案擁有權或設定有衝突。請覆核設定及專案後再試。'],
    operationError:['The operation could not be completed.','未能完成操作。'], invalid:['Select a LAN address, a project name and distinct ports from 1 to 65535.','請選擇區域網絡位址、填寫專案名稱及兩個不同的連接埠（1 至 65535）。'],
    candidate:['Candidate','預定位址'],engine:['Docker and Compose','Docker 及 Compose'], evidence:['Engine detail','引擎資料'],
    refresh:['Reload state','重新載入狀態'], loading:['Reading local host state…','正在讀取本機狀態…'], busy:['Working…','處理中…']
  };
  function read(key, fallback) { try { return localStorage.getItem('td.host.' + key) ?? fallback; } catch { return fallback; } }
  function save(key,value) { try { localStorage.setItem('td.host.' + key,String(value)); } catch { /* Choices remain active for this window. */ } }
  let lang = read('lang','en');
  if (!['en','zh-HK','bi'].includes(lang)) lang = 'en';
  let step = Math.max(0, Math.min(5, Math.trunc(Number(read('step','0'))) || 0));
  let snapshot, form, pending = false, rechecking = false, error = '', lastPhase = '';
  const active = run => ['preparing','pulling','starting','checking'].includes(run?.phase);
  function t(key) {
    const pair = copy[key] || copy.unavailable;
    return lang === 'bi' ? pair.join(' / ') : pair[lang === 'zh-HK' ? 1 : 0];
  }
  function element(tag,text) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node; }
  function button(parent,id,key,handler,primary=false,disabled=false) {
    const b=element('button',t(key)); b.type='button'; b.id=id; b.classList.toggle('primary',primary); b.disabled=disabled || pending;
    b.addEventListener('click',handler); parent.append(b); return b;
  }
  function details(container,entries) {
    const list=element('dl');
    for (const [key,value] of entries) {
      const row=element('div'); const dd=element('dd',String(value ?? t('unavailable'))); if(key==='elapsed')dd.id='elapsed'; row.append(element('dt',t(key)),dd); list.append(row);
    }
    container.append(list);
  }
  function received(value) {
    if (!value) return;
    snapshot=value;
    if (!active(value.run)) rechecking=false;
    if (active(value.run)) step=5;
    else if (step!==5 || value.run.phase==='idle') {
      if (value.docker!=='ready') step=0;
      else if (!value.draft.receipt) step=Math.min(step,1);
      else if (!value.draft.configuration) step=Math.min(step,2);
      else if (!value.addresses.includes(value.draft.address) || !value.draft.project) step=Math.min(step,3);
    }
    if (value.run.phase!==lastPhase) { lastPhase=value.run.phase; byId('live').textContent=t(lastPhase); }
  }
  async function call(method,args=[],after,restore) {
    if (pending) return;
    pending=true; error=''; render();
    try {
      const value=await api[method](...args);
      if (value) { received(value); if (after) after(value); }
    } catch { error='operationError'; }
    finally { pending=false; render(restore); }
  }
  function go(n) { step=n; save('step',n); error=''; render('heading'); }
  function valid(values) {
    const port = n => Number.isInteger(n) && n>=1 && n<=65535;
    return snapshot.addresses.includes(values.address) && /^[a-z0-9][a-z0-9_-]{0,47}$/.test(values.project) &&
      port(values.guestPort) && port(values.managementPort) && values.guestPort!==values.managementPort;
  }
  function field(box,key,initial,choices) {
    const label=element('label',t(key));label.className='field';
    const input=element(choices?'select':'input'); input.id='field-'+key;
    if (choices) {
      for (const item of ['',...choices]) {const o=element('option',item || t('empty'));o.value=item;input.append(o);}
    } else if (key.endsWith('Port')) {input.type='number';input.min='1';input.max='65535';input.step='1';}
    else {input.type='text';input.autocomplete='off';input.maxLength=48;}
    input.value=initial ?? '';input.disabled=pending;
    input.addEventListener('input',()=>{form[key]=key.endsWith('Port')?input.valueAsNumber:input.value;});
    label.append(input);box.append(label);
  }
  function localize() {
    document.documentElement.lang=lang==='zh-HK'?'zh-HK':'en';
    byId('language').value=lang; byId('language-label').textContent=t('lang'); byId('motion-label').textContent=t('motion');
    document.querySelector('nav').setAttribute('aria-label',t('step'));
  }
  function render(focusId) {
    const previousFocus=focusId || document.activeElement?.id;
    localize();
    const body=byId('body'),actions=byId('actions'),rail=byId('steps');
    body.replaceChildren();actions.replaceChildren();rail.replaceChildren();
    steps.forEach((key,n)=>{const li=element('li',t(key));if(n===step)li.setAttribute('aria-current','step');rail.append(li);});
    byId('position').textContent=t('step')+' '+(step+1)+' / 6';
    byId('heading').textContent=t(steps[step]);
    byId('build').textContent=t('version')+' '+(snapshot?.version || t('unavailable'))+' · '+t('revision')+' '+(snapshot?.revision || t('unavailable'));
    if (!snapshot) {
      body.append(element('p',t(pending?'loading':'unavailable')));
      button(actions,'refresh','refresh',()=>call('state'),true);
    } else {
      const {draft:d,run:r}=snapshot;
      const help=['dockerHelp','receiptHelp','configHelp','networkHelp','reviewHelp','stopHelp'][step];
      body.append(element('p',t(help)));
      if (step===0) {
        details(body,[['engine',t(snapshot.docker)]]);
        button(body,'check','check',()=>call('check',[],null,'check'));
      } else if (step===1) {
        button(body,'pick-receipt','chooseReceipt',()=>call('choose',['receipt'],null,'pick-receipt'));
        details(body,[['file',d.receipt?.name || t('empty')],['release',d.receipt?.releaseTag],['version',d.receipt?.version],['revision',d.receipt?.revision],['digest',d.receipt?.digest]]);
      } else if (step===2) {
        details(body,[['directory',d.configuration || t('empty')],['overlay',d.overlay || t('none')]]);
        for (const [kind,key] of [['configuration','chooseConfig'],['overlay','chooseOverlay']]) button(body,'pick-'+kind,key,()=>call('choose',[kind],null,'pick-'+kind));
        if (d.overlay) button(body,'clear-overlay','clearOverlay',()=>call('clearOverlay',[],null,'pick-overlay'));
      } else if (step===3) {
        form ||= {project:d.project,address:d.address,guestPort:d.guestPort,managementPort:d.managementPort};
        for(const key of ['project','address','guestPort','managementPort'])field(body,key,form[key],key==='address'?snapshot.addresses:null);
      } else if (step===4) {
        details(body,[['release',d.receipt?.releaseTag],['revision',d.receipt?.revision],['digest',d.receipt?.digest],['directory',d.configuration],['overlay',d.overlay || t('none')],['project',d.project],['ownership',t('ownershipUnknown')],['guest',d.address+':'+d.guestPort+' ('+t('candidate')+')'],['management',d.address+':'+d.managementPort+' ('+t('candidate')+')']]);
      } else {
        details(body,[['phase',t(r.phase)],['code',r.code],...(r.startedAt && active(r)?[['elapsed',Math.max(0,Math.floor((Date.now()-r.startedAt)/1000))]]:[])]);
        for(const endpoint of r.endpoints || []) {
          if (!['guest','management'].includes(endpoint.role))continue;
          details(body,[[endpoint.role,t(endpoint.verified?'verified':endpoint.started?'started':'unverified')],...(endpoint.url?[[endpoint.role,endpoint.url]]:[])]);
          if(endpoint.verified && endpoint.url) {
            const b=button(body,'open-'+endpoint.role,'open',()=>call('open',[endpoint.role],null,'open-'+endpoint.role));
            b.textContent=t('open')+' '+t(endpoint.role);
          }
        }
        if(active(r) && !rechecking)button(actions,'stop',r.cancelRequested?'cancelling':'stop',()=>call('cancel'),false,r.cancelRequested);
        else if (!active(r) && r.phase!=='idle') button(actions,'recheck','recheck',()=>{rechecking=true;call('recheck');},true);
      }
      if(step>0 && !active(r)) button(actions,'back','back',()=>go(step-1));
      if(step<4)button(actions,'next','next',()=>{
        if(step!==3){go(step+1);return;}
        if(!valid(form)){error='invalid';render('field-project');return;}
        call('configure',[{...form}],value=>{
          if(value.run.reason!=='configuration' && Object.keys(form).every(key=>value.draft[key]===form[key])){form=null;go(4);}
        },'heading');
      },true,step===0?snapshot.docker!=='ready':step===1?!d.receipt:step===2?!d.configuration:false);
      if(step>0 && step<5)button(actions,'cancel-setup','cancelSetup',()=>{ form=null;go(0); });
      if(step===4)button(actions,'start','start',()=>{go(5);call('start');},true);
      if (!error && r.reason) {
        const reasons={configuration:'conflict',receipt:'reasonReceipt',startup:'reasonStartup',dependency:'reasonDependency',runtime:'reasonRuntime',pull:'reasonPull',verify:'reasonVerify'};
        body.append(element('p',t('evidence')+': '+t(reasons[r.reason] || 'operationError')));
        if (r.reason==='configuration') byId('live').textContent=t('conflict');
      }
    }
    if (pending) actions.append(element('span',t('busy')));
    byId('error').hidden=!error;byId('error').textContent=error?t(error):'';
    if(previousFocus)byId(previousFocus)?.focus({preventScroll:true});
  }
  byId('language').addEventListener('change',e=>{lang=e.target.value;save('lang',lang);render('language');});
  function motion() { document.documentElement.dataset.motion=byId('motion').checked?'on':'off'; }
  byId('motion').checked=read('motion','on')!=='off';motion();
  byId('motion').addEventListener('change',()=>{motion();save('motion',document.documentElement.dataset.motion);});
  window.setInterval(()=>{
    const clock=byId('elapsed');
    if(clock && snapshot?.run.startedAt && active(snapshot.run))clock.textContent=String(Math.max(0,Math.floor((Date.now()-snapshot.run.startedAt)/1000)));
  },1000);
  if(api) {api.onState(value=>{received(value);render();});call('state');} else render();
})();
