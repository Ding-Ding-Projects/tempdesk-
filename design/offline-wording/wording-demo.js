(() => {
  const $=id=>document.getElementById(id), shell=document.querySelector('.preview'), layer=document.querySelector('.layer');
  const words={lang:['Language','語言'],article:['Prepare a shared workspace','準備共用工作區'],intro:['Follow this guide and keep track of the steps you have completed.','跟隨本指南，記錄已完成的步驟。'],task:['Check the available workspace','檢查可用的工作區'],drop:['Drop a wording JSON file anywhere in the window, or choose one in Settings.','把用字 JSON 檔案拖放到視窗任何位置，或在設定中選取檔案。'],settings:['Settings','設定'],upload:['Choose wording JSON','選擇用字 JSON'],audio:['Feedback','回饋'],switch:['Play action sounds','播放操作音效'],volume:['Sound volume','音量'],reject:['This file could not be applied. Your current wording is unchanged.','無法套用此檔案。現有用字維持不變。'],dismiss:['Dismiss notice','關閉通知'],fixture:['Design preview','設計預覽'],valid:['Preview saved import','預覽已儲存的匯入結果'],invalid:['Preview rejected import','預覽未能匯入的結果'],success:['Personal wording applied','已套用個人用字'],sample:['This design does not read personal files. Use the example outcomes.','本設計不會讀取個人檔案。請使用範例結果。']};
  const lang=$('lang');
  function text(key){return lang.value==='bi'?words[key].join(' / '):words[key][lang.value==='zh'?1:0];}
  function translate(){document.documentElement.lang=lang.value==='zh'?'zh-HK':'en';document.querySelectorAll('[data-t]').forEach(el=>el.textContent=text(el.dataset.t));}
  let timer,previous;
  function outcome(valid){
    clearTimeout(timer);layer.hidden=!valid;
    const notice = $('notice');
    if (valid) {
      notice.hidden = true;
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches || shell.dataset.motion === 'false';
      timer = setTimeout(() => { layer.hidden = true; }, reduced ? 3000 : 3180);
    } else {
      if (!notice.contains(document.activeElement)) previous = document.activeElement;
      notice.hidden = false;
    }
    $('status').textContent=text(valid?'success':'reject');
  }
  $('valid').onclick=()=>outcome(true);$('invalid').onclick=()=>outcome(false);
  $('dismiss').onclick = () => {
    $('notice').hidden = true;
    const target = previous?.isConnected && previous.getClientRects().length ? previous : $('invalid');
    target.focus();
  };
  $('vol').oninput=()=>{$('level').value=$('vol').value+'%';};
  $('sound').onchange=()=>{$('vol').disabled=!$('sound').checked;};
  lang.onchange=translate;
  function previewOnly(){$('status').textContent=text('sample');$('upload').value='';}
  $('choose').onclick = () => $('upload').click();
  $('upload').onchange=previewOnly;
  function files(e){return Array.from(e.dataTransfer?.types||[]).includes('Files');}
  window.addEventListener('dragover',e=>{if(files(e)){e.preventDefault();shell.classList.add('dragging');}});
  window.addEventListener('dragleave',e=>{if(!e.relatedTarget)shell.classList.remove('dragging');});
  window.addEventListener('drop',e=>{if(files(e)){e.preventDefault();shell.classList.remove('dragging');previewOnly();}});
  translate();
})();
