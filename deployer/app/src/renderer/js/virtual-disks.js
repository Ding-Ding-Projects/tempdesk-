import { h, t, btn, select, superConfirm, searchBox } from './ui.js';

const call = (key, ...args) => window.td.invoke['vd:' + key](...args);
let selected = null;

export async function virtualDiskPage(root) {
  const result = h('div', { role: 'status', 'aria-live': 'polite' });
  const library = h('div', { class: 'list' });
  const detail = h('section', { class: 'card' });
  const status = await call('list');
  root.appendChild(h('div', { class: 'page-head' }, [h('h1', { text: t('nav.virtualDisks') }), h('p', { text: t('vd.lead') })]));
  root.appendChild(result);
  if (!status.available) { result.textContent = t('vd.platform'); return; }
  let files = status.files, matcher = null, processing = false, generation = 0;
  function matching() {
    return files.filter((f) => !matcher || window.TempDeskCore.testMatch(f.file, matcher));
  }
  async function work(fn) {
    if (processing) return;
    processing = true;
    root.setAttribute('aria-busy', 'true');
    result.textContent = t('vd.working');
    try { await fn(); result.textContent = t('vd.done'); }
    catch (e) { result.textContent = String(e.message || e); }
    finally { processing = false; root.removeAttribute('aria-busy'); }
  }
  async function refresh() {
    files = (await call('list')).files;
    drawList();
    if (selected && files.some((item) => item.id === selected)) await inspect(selected);
  }
  async function inspect(id) {
    selected = id;
    const revision = ++generation;
    detail.replaceChildren();
    const d = await call('inspect', id);
    if (revision !== generation) return;
    const entry = files.find((f) => f.id === id);
    const info = h('dl');
    const values = { format: d.format, bytes: d.bytes, attached: d.attached === null ? d.storageReason : t(d.attached ? 'vd.yes' : 'vd.no'), device: d.device, virtualBytes: d.virtualBytes, logicalSector: d.logicalSector };
    for (const [key, value] of Object.entries(values)) {
      if (value !== null && value !== undefined) info.append(h('dt', { text: t('vd.' + key) }), h('dd', { text: String(value) }));
    }
    const actions = h('div', { class: 'row' });
    const action = entry.owned ? 'detach' : 'attach';
    actions.appendChild(btn(t('vd.' + action), () => work(async () => {
      if (!await superConfirm({ title: t('vd.' + action), danger: t('vd.' + action + 'Warn', [entry.file]), word: entry.file.split(/[\\/]/).pop(), action: t('vd.' + action) })) return;
      await call('mount', id, action, entry.file);
      await refresh();
    }), 'btn-primary', { disabled: d.attached === null || (d.attached && !entry.owned) }));
    detail.append(h('h2', { text: entry.file }), info, actions);
    if (d.attached && !entry.owned) detail.appendChild(h('p', { text: t('vd.foreign') }));
    const nativeDetails = Object.fromEntries(['details', 'detailReason', 'partitions', 'partitionReason', 'chainValid', 'snapshots']
      .filter((key) => d[key] !== undefined && d[key] !== null)
      .map((key) => [key, d[key]]));
    if (Object.keys(nativeDetails).length) detail.appendChild(h('pre', { text: JSON.stringify(nativeDetails, null, 2) }));
  }
  function drawList() {
    library.replaceChildren(...matching().map((f) => btn(f.file, () => work(() => inspect(f.id)), 'btn-ghost')));
    if (!matching().length) library.appendChild(h('p', { text: t('vd.empty') }));
  }
  const filter = searchBox({ label: t('vd.search'), onChange(m) { matcher = m.ok && !m.empty ? m : null; drawList(); }, count(m) { return window.TempDeskCore.countMatches(files.map((f) => f.file), m); } });
  root.appendChild(h('section', { class: 'card' }, [h('h2', { text: t('vd.inventory') }), h('div', { class: 'row' }, [
    btn(t('vd.pick'), () => work(async () => { const ids = await call('pick'); selected = ids[0] || selected; await refresh(); }), 'btn-primary'),
    btn(t('vd.discover'), () => work(async () => { await call('discover'); await refresh(); }), 'btn-ghost')
  ]), filter, library]));
  const size = h('input', { type:'number', value:'1024', min:'3', step:'1' });
  const fixed = h('input', { type:'checkbox' });
  const format = select(['vhdx','vhd','vhds'].map((f) => [f,f.toUpperCase()]), 'vhdx', () => {});
  root.append(detail, h('section', { class:'card' }, [h('h2', { text: t('vd.create') }), h('div', { class:'fields2' }, [
    h('label', { class:'lab' }, [t('vd.format'), format]), h('label', { class:'lab' }, [t('vd.capacity'), size]),
    h('label', { class:'check' }, [fixed,t('vd.fixed')])
  ]), btn(t('vd.create'), () => work(async () => {
    const id = await call('create', format.value, size.valueAsNumber, fixed.checked);
    if (id) { selected = id; await refresh(); }
  }), 'btn-primary')]));
  drawList();
  if (selected && files.some((f) => f.id === selected)) await work(() => inspect(selected));
}
