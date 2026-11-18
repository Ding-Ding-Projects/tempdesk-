// The guide stores reader-owned marks on this device; it performs no lab actions.
(() => {
  const site = window.TempDeskSite;
  const guide = document.querySelector('[data-guided-docs]');
  if (!site || !guide) return;

  const prefix = 'td.docs.guide.v1.';
  const temporary = new Map();
  const taskControls = guide.querySelector('[data-guide-task-controls]');
  const groups = [...guide.querySelectorAll('[data-guide-variants]')];
  const panels = [...guide.querySelectorAll('[data-guide-variant]')];
  const status = guide.querySelector('[data-guide-status]');
  const volatile = guide.querySelector('[data-guide-volatile]');
  const markSelector = '.guide-step input[type="checkbox"]';
  const articleRail = document.querySelector('.docs-index-rail');
  const narrow = matchMedia('(max-width: 860px)');

  function read(name) {
    return temporary.has(name) ? temporary.get(name) : site.LS.get(prefix + name, '');
  }

  function save(name, value) {
    if (site.LS.set(prefix + name, value)) temporary.delete(name);
    else temporary.set(name, value);
    volatile.hidden = temporary.size === 0;
  }

  function restoreRadio(group, name, selected = read(name)) {
    const option = [...group.querySelectorAll('input[type="radio"]')].find(input => input.value === selected);
    if (option) option.checked = true;
  }

  function activePanel() {
    const task = taskControls.querySelector('input:checked').value;
    const group = groups.find(item => item.dataset.guideVariants === task);
    const option = group?.querySelector('input:checked')?.value;
    return panels.find(panel => panel.dataset.guideTask === task &&
      (!option || panel.dataset.guideVariant === option));
  }

  function markKey(group, step) {
    return 'mark.' + group.dataset.guideTask + '.' + group.dataset.guideVariant + '.' + step.value;
  }

  function updateProgress() {
    const panel = activePanel();
    const all = [...panel.querySelectorAll(markSelector)];
    status.dataset.i18n = 'docs.guide.progress';
    status.dataset.i18nArgs = [all.filter(step => step.checked).length, all.length].join('|');
    site.render(status);
  }

  function showTask() {
    const panel = activePanel();
    for (const group of groups) group.hidden = group.dataset.guideVariants !== panel.dataset.guideTask;
    for (const candidate of panels) {
      candidate.hidden = candidate !== panel;
      candidate.toggleAttribute('data-guide-active', candidate === panel);
    }
    updateProgress();
  }

  function adaptNavigation() {
    if (articleRail) articleRail.open = !narrow.matches || articleRail.contains(document.activeElement);
  }

  restoreRadio(taskControls, 'task');
  for (const group of groups) restoreRadio(group, 'variant.' + group.dataset.guideVariants);
  const params = new URLSearchParams(location.search);
  const requested = panels.find(panel => panel.dataset.guideTask === params.get('task') &&
    panel.dataset.guideVariant === params.get('variant'));
  if (requested) {
    const { guideTask, guideVariant } = requested.dataset;
    restoreRadio(taskControls, 'task', guideTask);
    const group = groups.find(item => item.dataset.guideVariants === guideTask);
    if (group) restoreRadio(group, 'variant.' + guideTask, guideVariant);
  }
  for (const panel of panels) {
    for (const step of panel.querySelectorAll(markSelector)) {
      step.checked = read(markKey(panel, step)) === '1';
      step.hidden = false;
    }
  }
  taskControls.hidden = false;
  showTask();
  adaptNavigation();
  narrow.addEventListener('change', adaptNavigation);
  site.onLang(() => {
    updateProgress();
    status.hidden = false;
  });

  guide.addEventListener('change', event => {
    const input = event.target;
    if (input.name === 'guide-task') {
      save('task', input.value);
      showTask();
    } else if (input.matches('[data-guide-variants] input[type="radio"]')) {
      save('variant.' + input.closest('[data-guide-variants]').dataset.guideVariants, input.value);
      showTask();
    } else if (input.matches(markSelector)) {
      save(markKey(input.closest('[data-guide-variant]'), input), input.checked ? '1' : '0');
      updateProgress();
    }
  });
})();
