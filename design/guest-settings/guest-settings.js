(() => {
  const $ = id => document.getElementById(id);
  const root = document.documentElement;
  const prefix = 'tempdesk.design.guestSettings.';
  const school = new URLSearchParams(location.search).get('school') === '1';
  const options = [
    ['Language','language',['English','廣東話','English + 廣東話']],
    ['Theme','theme',['System','Dark','Light']],
    ['Motion','motion',['System','Full','Reduced','Off']],
    ['Density','density',['Comfortable','Compact']],
    ['Text size','text',[90,160,5,100]],
    ['High contrast','contrast',null],
    ['Always show the focus ring','focus',null],
    ['Corner roundness','radius',[0,150,10,100]]
  ];
  function load(key, fallback) { try { return JSON.parse(localStorage.getItem(prefix+key)) ?? fallback; } catch { return fallback; } }
  function store(key,value) { try { localStorage.setItem(prefix+key,JSON.stringify(value)); } catch { $('result').textContent='Storage unavailable. Changes apply to this preview only.'; } }
  function bind(input,key,initial,apply) {
    const check=input.type==='checkbox';
    if(check) input.checked=load(key,initial); else input.value=load(key,initial);
    function render(){const value=check?input.checked:input.value;apply(value);return value;}
    render(); input.addEventListener('input',()=>store(key,render()));
  }
  for(const [name,key,values] of options) {
    if (key === 'language' && school) continue;
    const label=document.createElement('label');label.dataset.row='';label.className='field';label.append(name);
    const range=typeof values?.[0]==='number';
    const input=document.createElement(values&&!range?'select':'input');
    if(range) { [input.min,input.max,input.step]=values;input.type='range'; }
    else if(values) for(const value of values)input.add(new Option(value,value));
    else input.type='checkbox';
    label.append(input); $('display').append(label);
    const output=range?document.createElement('output'):null;if(output)label.append(output);
    bind(input,key,range?values[3]:values?values[0]:false,value=>{
      if(output)output.value=value+'%';
      if(key==='text'||key==='radius')root.style.setProperty(key==='text'?'--text-scale':'--radius-scale',Number(value)/100);
      if(['theme','motion','density'].includes(key))root.dataset[key]=String(value).toLowerCase();
      if(key==='contrast')root.dataset.contrast=value?'high':'normal';
      if(key==='focus')root.dataset.focus=value?'always':'normal';
      if(key==='language')root.lang=value==='廣東話'?'zh-HK':'en';
    });
  }
  bind($('sound'),'sound',true,()=>{});$('school-help').hidden=!school;
  // The operating system and board tweak both override the saved demonstration preference.
  const style=document.createElement('style');style.textContent='.board[data-preview-motion="off"] *{animation:none!important;transition:none!important}@media(prefers-reduced-motion:reduce){.board *{animation:none!important;transition:none!important}}';document.head.append(style);
  function filter(matches) {
    for (const group of document.querySelectorAll('main section')) {
      const heading = group.querySelector('h2').textContent;
      for (const row of group.querySelectorAll('[data-row]')) {
        row.hidden = !matches(heading + ' ' + row.textContent);
      }
      group.hidden = !group.querySelector('[data-row]:not([hidden])');
    }
  }
  const input=$('find');
  const runtime=document.createElement('script');
  runtime.src='../../portal/app/static/js/regex-builder.js';
  runtime.onerror=()=>{
    $('result').textContent='Regex builder unavailable in this preview.';
    input.addEventListener('input',()=>filter(text=>text.toLowerCase().includes(input.value.toLowerCase())));
  };
  runtime.onload=()=>window.TempDeskRegex.attachRegexBuilder(input,{label:'Search settings',workerUrl:runtime.src,onChange:(_,compiled)=>{if(compiled.ok)filter(text=>compiled.test(text));}});
  document.head.append(runtime);
})();
