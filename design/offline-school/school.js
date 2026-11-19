(() => {
  const $=id=>document.getElementById(id), card=$('card'), others=$('others');
  const states=['off','enable','on','unlock','incorrect','rename','rename-incorrect','rename-success','unavailable'];
  const params=new URLSearchParams(location.search);
  let scene=states.includes(params.get('scene'))?params.get('scene'):'off';
  let saved=['en','zh','bi'].includes(params.get('lang'))?params.get('lang'):'en', label='Classroom', proposed='Study room';
  const neutral={Theme:'System',Motion:'System','Text size':'100%'};
  const words={title:['School mode','學校模式'],off:['Off','已關閉'],enable:['Enable School mode','開啟學校模式'],name:['Display name','顯示名稱'],pin:['New PIN (4–12 digits)','新 PIN（4 至 12 位數字）'],confirm:['Confirm new PIN','確認新 PIN'],current:['Current PIN','目前 PIN'],cancel:['Cancel','取消'],save:['Save name','儲存名稱'],unavailable:['Shared state unavailable','無法讀取共用狀態'],retry:['Retry','再試'],unknown:['Reopen the shared state before changing settings.','請先重新讀取共用狀態，再更改設定。'],help:['Use English and pause personal wording and action sounds while this mode is on.','開啟此模式時使用英文，並暫停個人用字及操作音效。'],language:['Language','語言'],wording:['Personal wording','個人用字'],upload:['Choose JSON file','選擇 JSON 檔案'],sound:['Action sounds','操作音效'],settings:['Settings','設定'],search:['Search settings','搜尋設定']};
  function tr(key){const pair=words[key];const use=['off','enable'].includes(scene)?saved:'en';return use==='bi'?pair.join(' / '):pair[use==='zh'?1:0];}
  function el(tag,text){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;}
  function action(where,id,text,next,primary=false){const b=el('button',text);b.id=id;b.type='button';b.classList.toggle('primary',primary);b.onclick=()=>{if(next==='enabled'||next==='renamed'){label=$('display-name').value.trim()||'Classroom';move('on',next==='renamed'?'rename':'unlock');}else if(next==='cancel')move(scene==='enable'?'off':'on',scene==='enable'?'enable':scene.startsWith('rename')?'rename':'unlock');else move(next);};where.append(b);return b;}
  function field(text,id,credential=false){const l=el('label',text);l.className='field';const input=el('input');input.id=id;input.type=credential?'password':'text';input.autocomplete='off';if(credential){input.readOnly=true;input.inputMode='numeric';input.setAttribute('aria-describedby','example-note');}else{input.value=scene.startsWith('rename')?proposed:label;input.maxLength=48;input.oninput=()=>{proposed=input.value;};}l.append(input);card.append(l);}
  function move(next,focus){
    const was=scene;
    if(next==='rename-incorrect' && was==='rename'){
      scene=next;$('scene').value=next;
      const pin=$('current');pin.value='';pin.setAttribute('aria-invalid','true');pin.setAttribute('aria-describedby','example-note result');
      $('result').textContent='Incorrect PIN. Your new name is unchanged.';pin.focus();return;
    }
    if(next==='rename-success'){label=proposed.trim()||label;next='on';focus='rename';}
    if(next==='rename' && was==='on')proposed=label;
    scene=next;$('query').value='';render();
    ($(focus)||(['incorrect','rename-incorrect'].includes(scene)?$('current'):null)||$('display-name')||$('current')||$('enable')||$('unlock')||$('retry')||card).focus();
  }
  function filter(){const q=$('query').value.trim().toLocaleLowerCase();for(const n of [card,...others.children])n.hidden=!!q&&!n.textContent.toLocaleLowerCase().includes(q);}
  function render(){
    const active=['on','rename','rename-incorrect','unlock','incorrect'].includes(scene);
    document.documentElement.lang=(!active && scene!=='unavailable' && saved==='zh')?'zh-HK':'en';
    $('scene').value=scene;$('heading').textContent=tr('settings');$('searchlabel').textContent=tr('search');
    card.replaceChildren(el('h3',active?label:tr('title')));others.replaceChildren();$('result').textContent='';
    if(scene==='off'){card.append(el('p',tr('off')),el('p',tr('help')));action(card,'enable',tr('enable'),'enable',true);}
    if(scene==='unavailable'){card.append(el('p',tr('unavailable')),el('p',tr('unknown')));action(card,'retry',tr('retry'),'on');}
    if(scene==='on'){card.append(el('p','On · English only'),el('p','Action sounds are paused. Unlock to restore your saved preferences.'));const a=el('div');a.className='actions';card.append(a);action(a,'unlock','Unlock','unlock',true);action(a,'rename','Rename','rename');}
    if(['enable','unlock','incorrect','rename','rename-incorrect'].includes(scene)){
      if(['enable','rename','rename-incorrect'].includes(scene))field(tr('name'),'display-name');
      if(scene==='enable'){field(tr('pin'),'new-pin',true);field(tr('confirm'),'confirm-pin',true);}else field(tr('current'),'current',true);
      const note=el('small','Design preview: PIN entry is unavailable.');note.id='example-note';card.append(note);
      const a=el('div');a.className='actions';card.append(a);
      const submit=action(a,'submit',scene==='enable'?tr('enable'):scene.startsWith('rename')?tr('save'):'Unlock',scene==='enable'?'enabled':scene.startsWith('rename')?'renamed':'off',true);
      submit.disabled=true;action(a,'cancel',tr('cancel'),'cancel');
      if(['incorrect','rename-incorrect'].includes(scene)){$('current').setAttribute('aria-invalid','true');$('current').setAttribute('aria-describedby','example-note result');$('result').textContent=scene==='rename-incorrect'?'Incorrect PIN. Your new name is unchanged.':'Incorrect PIN. Try again.';}
    }
    if(['off','enable'].includes(scene)){
      const group=el('section');group.className='set-group';const l=el('label',tr('language'));l.className='field';const select=el('select');['English','廣東話','English + 廣東話'].forEach((v,i)=>select.add(new Option(v,['en','zh','bi'][i])));select.value=saved;select.id='pref-lang';select.onchange=()=>{saved=select.value;render();$('pref-lang').focus();};l.append(select);group.append(l);others.append(group);
      const wg=el('section');wg.className='set-group';wg.append(el('h3',tr('wording')));const w=el('button',tr('upload'));w.type='button';w.disabled=true;wg.append(w);others.append(wg);
      const ag=el('section');ag.className='set-group';ag.append(el('h3',tr('sound')));others.append(ag);
    }
    const labels={Theme:'主題',Motion:'動態效果','Text size':'文字大小',System:'跟隨系統',Light:'淺色',Dark:'深色',Full:'完整',Reduced:'減少',Off:'關閉'};
    function visible(value){const localized=labels[value];if(active||scene==='unavailable'||saved==='en'||!localized)return value;return saved==='bi'?value+' / '+localized:localized;}
    for(const [name,choices] of Object.entries({Theme:['System','Light','Dark'],Motion:['System','Full','Reduced','Off'],'Text size':['90%','100%','115%','130%']})){
      const group=el('section');group.className='set-group';group.dataset.neutral=name;
      const l=el('label',visible(name));l.className='field';const control=el('select');
      choices.forEach(v=>control.add(new Option(visible(v),v)));control.value=neutral[name];
      control.onchange=()=>{neutral[name]=control.value;if(name==='Theme')document.documentElement.dataset.theme=control.value.toLowerCase();if(name==='Motion')document.documentElement.dataset.motion=control.value.toLowerCase();if(name==='Text size')document.documentElement.style.fontSize=control.value;};
      l.append(control);group.append(l);others.append(group);
    }
    filter();
  }
  const panel=document.querySelector('.settings');
  $('close-settings').onclick=()=>{panel.hidden=true;$('open-settings').focus();};
  $('open-settings').onclick=()=>{panel.hidden=false;$('query').focus();};
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!event.defaultPrevented&&!panel.hidden&&!document.querySelector('.rxb-pop:not([hidden])'))$('close-settings').click();});
  $('query').oninput=filter;$('scene').onchange=e=>move(e.target.value);render();
})();
const schoolSearch = document.getElementById('query');
const engine = document.createElement('script');
engine.src = location.pathname.includes('/.tools/local-test/') ? '../../site/assets/regex-builder.js' : '../../site/assets/regex-builder.js';
engine.onload = () => {
  if (!window.TempDeskRegex) return;
  window.TempDeskRegex.attachRegexBuilder(schoolSearch, {
    label: document.getElementById('searchlabel').textContent,
    workerUrl: engine.src,
    onChange: (_, compiled) => {
      if (!compiled.ok) return;
      for (const item of [document.getElementById('card'), ...document.getElementById('others').children]) {
        item.hidden = !compiled.test(item.textContent);
      }
    }
  });
};
document.head.append(engine);
