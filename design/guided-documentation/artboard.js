(() => {
  const root = document.getElementById('guide-reference');
  if (!root) return;
  const bilingual = root.dataset.language === 'bi';
  const copy = (en, zh) => bilingual ? en + '<span class="bi-sub" lang="zh-HK">' + zh + '</span>' : en;
  const choice = (name, value, label, checked = false) =>
    '<label class="guide-choice"><input type="radio" name="' + name + '" value="' + value + '"' +
    (checked ? ' checked' : '') + '><span class="guide-choice-text">' + label + '</span></label>';
  const variants = {
    deploy: [
      copy('Deploy TempDesk', '部署 TempDesk'),
      ['Choose a domain controller', 'Follow the deployment guide', 'Check the guest portal'],
      copy('Build a directory and make the guest portal reachable.', '建立目錄，再確認訪客可以連線。'),
    ],
    guest: [
      copy('Get a guest sign-in', '取得訪客登入'),
      ['Choose a duration', 'Read the confirmation', 'Check when the sign-in expires'],
      copy('Create a temporary account from the guest portal.', '喺訪客入口建立臨時帳戶。'),
    ],
    desktop: [
      copy('Desktop Experience session host', '桌面體驗工作階段主機'),
      ['Check the session host', 'Download the connection file and sign in', 'Verify that expiry ends the session'],
      copy('Use a separate session host and check the route from the guest computer.', '工作階段主機要分開，再用訪客電腦檢查路線。'),
    ],
    core: [
      copy('Check Server Core readiness', '檢查 Server Core 準備情況'),
      [copy('Review supported roles', '睇支援嘅角色'), copy('Verify a standard-user guest sign-in', '驗證一般訪客登入'), copy('Confirm the session ends at expiry', '確認到期會結束工作階段')],
      copy('The supplied App Host requires Desktop Experience.', '隨附嘅 App Host 需要桌面體驗。'),
    ],
  };
  root.innerHTML = '<header class="topbar"><strong class="logo">TempDesk</strong>' +
    '<span>' + copy('Design preview', '設計預覽') + '</span></header>' +
    '<main class="docs-layout docs-index-layout"><div class="docs-main"><div class="content">' +
    '<h1>' + copy('Documentation', '文件') + '</h1>' +
    '<p class="lede">' + copy('Guides and reference for TempDesk.', 'TempDesk 指南同參考資料。') + '</p>' +
    '<div class="searchrow"><input type="search" aria-label="Search the docs" placeholder="Search the docs">' +
    '<button type="button" class="btn btn-ghost" aria-label="Regular expression" aria-pressed="false">Regex</button></div>' +
    '<section class="docs-workflow"><h2>' + copy('Choose a task', '揀一項工作') + '</h2>' +
    '<p>' + copy('Use the checklist as you work. Progress belongs to this reader.', '跟住清單做，進度只屬於呢個閱讀器。') + '</p>' +
    '<div class="guide-sheet"><fieldset><legend>' + copy('Task', '工作') + '</legend><div class="guide-task-options">' +
    choice('task', 'deploy', variants.deploy[0]) + choice('task', 'guest', variants.guest[0]) +
    choice('task', 'commons', copy('Verify Virtual Commons', '驗證 Virtual Commons'), true) + '</div></fieldset>' +
    '<div><fieldset id="guide-edition"><legend>' + copy('Session host', '工作階段主機') + '</legend><div class="guide-variant-options">' +
    choice('edition', 'desktop', variants.desktop[0], root.dataset.edition === 'desktop') +
    choice('edition', 'core', variants.core[0], root.dataset.edition === 'core') + '</div></fieldset>' +
    '<p id="guide-progress" class="guide-status" role="status"></p><div id="guide-preview-panel" class="guide-panel"></div></div></div></section>' +
    '<label>Accent colour <input id="accent-preview" type="color" value="#006A61"></label> ' +
    '<label><input id="motion-preview" type="checkbox" checked> Motion</label></div></div>' +
    '<details class="docs-index-rail" open><summary>' + copy('Article navigation', '文章導覽') + '</summary>' +
    '<nav class="docs-nav" aria-label="Article navigation"><a href="#guide-preview-panel">Operator wiki</a><a href="#guide-preview-panel">Virtual Commons</a></nav></details></main>';

  const selected = () => root.querySelector('[name="task"]:checked').value;
  const key = () => selected() === 'commons' ? root.querySelector('[name="edition"]:checked').value : selected();
  const checked = new Map();
  const panel = root.querySelector('#guide-preview-panel');
  const progress = root.querySelector('#guide-progress');
  const media = matchMedia('(max-width: 860px)');
  const rail = root.querySelector('.docs-index-rail');
  const adaptRail = () => { rail.open = !media.matches; };
  adaptRail();
  media.addEventListener('change', adaptRail);

  function updateProgress() {
    const marks = panel.querySelectorAll('input:checked').length;
    progress.textContent = marks + ' of ' + variants[key()][1].length + ' marked';
  }
  function showPath() {
    const choiceKey = key();
    const [heading, steps, summary] = variants[choiceKey];
    root.querySelector('#guide-edition').hidden = selected() !== 'commons';
    panel.innerHTML = '<h3>' + heading + '</h3><p class="guide-summary">' + summary + '</p><ol class="guide-steps">' +
      steps.map((step, i) => '<li class="guide-step"><label><input type="checkbox" data-mark="' + i + '"' +
        (checked.get(choiceKey + ':' + i) ? ' checked' : '') + '><span>' + step + '</span></label></li>').join('') +
      '</ol><div class="guide-links"><a href="#guide-preview-panel">' + copy('Read the guide', '睇指南') + '</a></div>';
    panel.setAttribute('data-guide-active', '');
    updateProgress();
  }
  function applyTweaks() {
    const accent = root.querySelector('#accent-preview');
    const motion = root.querySelector('#motion-preview');
    const draft = root.style.getPropertyValue('--artboard-accent').trim();
    if (/^#[0-9a-f]{6}$/i.test(draft)) accent.value = draft;
    if (root.dataset.artboardMotion === 'false') motion.checked = false;
    const apply = () => {
      if (accent.value === '#006a61') root.style.removeProperty('--guide-accent');
      else root.style.setProperty('--guide-accent', accent.value);
      document.documentElement.dataset.motion = motion.checked ? 'full' : 'off';
    };
    accent.addEventListener('input', apply);
    motion.addEventListener('change', apply);
    apply();
  }

  root.addEventListener('change', event => {
    if (event.target.name === 'task' || event.target.name === 'edition') showPath();
    else if (event.target.hasAttribute('data-mark')) {
      checked.set(key() + ':' + event.target.dataset.mark, event.target.checked);
      updateProgress();
    }
  });
  const regex = root.querySelector('.searchrow button');
  regex.addEventListener('click', () => regex.setAttribute('aria-pressed', String(regex.getAttribute('aria-pressed') !== 'true')));
  applyTweaks();
  showPath();
})();
