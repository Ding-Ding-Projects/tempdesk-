// The catalog works independently of the filter used for bulk tab closure.
import { h, t, dialog, btn, searchBox, icon } from './ui.js';

export function editTabGroup(app, name, save) {
  dialog(t('tabs.group'), close => {
    const input = h('input', { maxlength: '64', value: app.tabs.groups[name] || '' });
    const apply = () => { save(input.value.trim()); close(); };
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); apply(); }
    });
    return [h('label', { class: 'field' }, [t('tabs.groupName'), input]), btn(t('tabs.saveGroup'), apply, 'btn-primary')];
  });
}

export function showTabCatalog(app, destinations, openDestination, openAll) {
  let dispose;
  dialog(t('tabs.catalog'), close => {
    const list = h('div', { class: 'list', 'data-search-surface': 'tab-catalog' });
    const records = destinations.map(([id, glyph]) => ({
      title: t('nav.' + id), glyph, group: '', open: () => openDestination(id)
    }));
    for (const key of Object.keys(app.catalogs.en || {})) {
      if (!key.startsWith('set.sec.')) continue;
      const section = key.slice('set.sec.'.length);
      records.push({ title: t(key), group: t('nav.settings'), glyph: 'settings',
        open: () => openDestination('settings', { focus: '#sec-' + CSS.escape(section) }) });
    }
    const seen = new Set();
    function addDeployment(name) {
      if (seen.has(name)) return;
      seen.add(name);
      records.push({ title: name, group: app.tabs.groups[name] || '', glyph: 'deployments', open: () => app.openTab(name) });
    }
    app.tabs.open.forEach(addDeployment);
    const render = matcher => {
      list.replaceChildren(...records.filter(item => matcher.ok && window.TempDeskCore.testMatch(item.group + ' ' + item.title, matcher)).map(item =>
        h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { close(); item.open(); } },
          [icon(item.glyph), item.group ? item.group + ' / ' + item.title : item.title])));
    };
    const search = searchBox({ label: t('tabs.catalog'), onChange: render });
    dispose = () => search.builder?.destroy();
    search.refresh();
    const status = h('p', { role: 'status' });
    window.td.invoke['dep:list']().then(saved => {
      if (!list.isConnected) return;
      saved.forEach(item => addDeployment(item.name));
      search.refresh();
    }).catch(error => { status.textContent = String(error.message || error); });
    return [search, btn(t('tabs.openAll'), () => { close(); openAll(); }, 'btn-ghost'), list, status];
  }, { wide: true, focus: 'input', onClose: () => dispose?.() });
}
