'use strict';
const ui=window.buildDesk;
let current, words;
const $=id=>document.getElementById(id);
function render(){
  if(!current||!words)return;
  document.querySelectorAll('[data-word]').forEach(el=>{el.textContent=words[el.dataset.word];});
  $('revision').textContent=current.version+' · '+words.revision+' '+current.revision;
  $('state').textContent=words[current.phase]+(current.code===null?'':' · '+words.code+' '+current.code);
  const output=$('output'), follow=output.scrollTop+output.clientHeight>=output.scrollHeight-5;
  output.textContent=current.output;
  if(follow)output.scrollTop=output.scrollHeight;
  const busy=['preparing','building'].includes(current.phase);
  document.querySelectorAll('[data-action]').forEach(button=>{button.disabled=busy;});
  $('cancel').disabled=!busy;
  $('open').disabled=!current.directory;
}
async function language(code){
  words=await ui.language(code);
  document.documentElement.lang=code;
  $('language').value=code;
  localStorage.setItem('language',code);
  render();
}
$('language').addEventListener('change',event=>language(event.target.value));
document.querySelectorAll('[data-action]').forEach(button=>button.addEventListener('click',()=>ui.start(button.dataset.action)));
$('open').addEventListener('click',()=>ui.open());
$('cancel').addEventListener('click',()=>ui.cancel());
ui.listen(value=>{current=value;render();});
ui.state().then(value=>{current=value;render();});
language(localStorage.getItem('language')||(navigator.language.startsWith('zh')?'zh-HK':'en'));
