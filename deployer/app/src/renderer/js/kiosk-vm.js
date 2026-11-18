import { btn, field, h, promptDialog, select, t } from './ui.js';

const sessions = new WeakMap();
const machineName = /^(?![0-9]+$)[A-Za-z0-9][A-Za-z0-9-]{0,13}[A-Za-z0-9]$/;
const providers = ['Auto', 'VMware', 'VirtualBox'];

// Listen before starting: an immediate engine error can arrive before IPC returns the run id.
async function invokePhase(phase, config, onLog) {
  const bridge = window.td;
  const early = [];
  let id;
  let result;
  let finish;
  const terminal = new Promise(resolve => { finish = resolve; });
  function receive(event) {
    if (!id) {
      if (early.length < 256) early.push(event);
      return;
    }
    if (event.run !== id) return;
    if (event.type === 'log') onLog(event.text);
    if (event.type === 'result') result = event;
    if (event.type === 'exit') finish(event);
  }
  const unsubscribe = bridge.on['engine:event'](receive);
  try {
    id = await bridge.invoke['engine:start']({ phase, config });
    for (const event of early) receive(event);
    const exit = await terminal;
    if (!exit.ok || !result?.ok) throw new Error(result?.data?.error || t('kioskVm.incomplete'));
    return result.data;
  } finally {
    unsubscribe();
  }
}

// The caller owns draft persistence. The typed creation confirmation is never stored in the draft.
export function kioskVmCard(draft, onChange = () => {}) {
  if (!draft.kioskVm) draft.kioskVm = {};
  const profile = draft.kioskVm;
  if (!providers.includes(profile.hypervisor)) profile.hypervisor = 'Auto';
  if (!profile.privateNetwork) profile.privateNetwork = 'CommonsLab';
  let job = sessions.get(draft);
  if (!job) {
    job = { busy: false, preview: '', digest: '', receipt: '', status: 'kioskVm.idle', details: '', logs: [] };
    sessions.set(draft, job);
  }
  const controls = [];
  const status = h('p', { role: 'status', 'aria-live': 'polite' });
  const details = h('p', { class: 'mono small', style: { overflowWrap: 'anywhere' } });
  const output = h('pre', { class: 'log', tabindex: '0', 'aria-label': t('run.log'), style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } });
  const spec = () => ({
    name: String(profile.name || '').trim(),
    windowsIso: String(profile.windowsIso || '').trim(),
    windowsIsoSha256: String(profile.windowsIsoSha256 || '').trim(),
    storageParent: String(profile.storageParent || '').trim(),
    hypervisor: profile.hypervisor,
    privateNetwork: profile.hypervisor === 'VMware' ? 'CommonsLab' : String(profile.privateNetwork || '').trim(),
  });
  function update(key, value) {
    profile[key] = value;
    job.preview = '';
    job.digest = '';
    job.receipt = '';
    job.status = 'kioskVm.idle';
    job.details = '';
    job.logs = [];
    job.render();
    onChange();
  }
  function entry(key, label, picker) {
    const input = h('input', { type: 'text', value: profile[key] || '', autocomplete: 'off', spellcheck: 'false' });
    input.addEventListener('input', () => update(key, input.value));
    controls.push(input);
    const wrapper = field({ label: t(label), control: input });
    if (picker) {
      const browse = btn(t('vm.browse'), async () => {
        const selected = await window.td.invoke[picker]();
        if (selected && !job.busy) {
          input.value = selected;
          update(key, selected);
        }
      }, 'btn-ghost btn-sm');
      controls.push(browse);
      wrapper.append(browse);
    }
    return wrapper;
  }
  const engine = select(providers.map(p => [p, t('kioskVm.provider.' + p)]), profile.hypervisor,
    value => update('hypervisor', value));
  controls.push(engine);
  const name = entry('name', 'vm.name');
  const iso = entry('windowsIso', 'vm.iso', 'file:pickIso');
  const digest = entry('windowsIsoSha256', 'kioskVm.inputDigest');
  const storage = entry('storageParent', 'vm.folder', 'file:pickFolder');
  const network = entry('privateNetwork', 'kioskVm.network');
  function log(text) {
    if (typeof text !== 'string' || !text) return;
    job.logs.push(text.slice(0, 2048));
    if (job.logs.length > 120) job.logs.shift();
    job.render();
  }
  async function run(create) {
    if (job.busy) return;
    const snapshot = spec();
    const key = JSON.stringify(snapshot);
    if (create && job.preview !== key) return;
    job.busy = true;
    job.render();
    try {
      if (create) {
        const answer = await promptDialog(t('kioskVm.confirmTitle'), t('kioskVm.confirm', [snapshot.name]), '', {
          ok: t('kioskVm.create'), validate: value => value === snapshot.name ? '' : t('kioskVm.exactName'),
        });
        if (answer !== snapshot.name) return;
        snapshot.confirmCreate = answer;
        snapshot.windowsIsoSha256 = job.digest;
      }
      job.status = create ? 'kioskVm.creating' : 'kioskVm.previewing';
      job.receipt = '';
      job.details = '';
      job.logs = [];
      job.preview = '';
      job.render();
      const data = await invokePhase(create ? 'KioskVmCreate' : 'KioskVmPreview', {
        name: draft.name || 'lab', kioskVm: snapshot,
      }, log);
      if (data.name !== snapshot.name || data.enrolled !== false) throw new Error(t('kioskVm.incomplete'));
      if (!create && data.state === 'PreviewOnly' && /^[0-9a-f]{64}$/i.test(data.windowsIsoSha256) && Number.isSafeInteger(data.windowsIsoBytes) && data.windowsIsoBytes > 0) {
        job.digest = data.windowsIsoSha256;
        job.details = t('kioskVm.previewPin', [data.windowsIsoBytes.toLocaleString(), job.digest]);
        job.preview = key;
        job.status = 'kioskVm.previewed';
      } else if (create && data.configuration && data.hypervisor === 'VMware' && data.state === 'RequiresWorkstationEncryptionAndTpm') {
        job.receipt = typeof data.guestMediaReceipt === 'string' ? data.guestMediaReceipt : '';
        job.details = data.configuration;
        job.status = 'kioskVm.vmwareNext';
      } else if (create && data.configuration && data.hypervisor === 'VirtualBox' && data.state === 'RequiresSecureBootVerification') {
        job.receipt = typeof data.guestMediaReceipt === 'string' ? data.guestMediaReceipt : '';
        job.details = data.configuration;
        job.status = 'kioskVm.boxNext';
      } else {
        throw new Error(t('kioskVm.incomplete'));
      }
    } catch (error) {
      job.status = 'kioskVm.incomplete';
      log(error.message);
    } finally {
      job.busy = false;
      job.render();
    }
  }
  const preview = btn(t('kioskVm.preview'), () => run(false), 'btn-primary');
  const create = btn(t('kioskVm.create'), () => run(true), 'btn-ghost');
  const reveal = btn(t('kioskVm.revealReceipt'), () => window.td.invoke['file:reveal'](job.receipt), 'btn-ghost');
  job.render = () => {
    const settings = spec();
    const valid = machineName.test(settings.name) && /\.iso$/i.test(settings.windowsIso) && settings.storageParent
      && (!settings.windowsIsoSha256 || /^[A-Fa-f0-9]{64}$/.test(settings.windowsIsoSha256))
      && /^[A-Za-z0-9_-]{1,48}$/.test(settings.privateNetwork);
    for (const control of controls) control.disabled = job.busy;
    network.hidden = settings.hypervisor === 'VMware';
    preview.disabled = job.busy || !valid;
    create.disabled = job.busy || !valid || job.preview !== JSON.stringify(settings);
    status.textContent = t(job.status);
    reveal.hidden = !job.receipt;
    details.textContent = job.details;
    details.hidden = !job.details;
    output.textContent = job.logs.join('\n');
    output.hidden = !job.logs.length;
  };
  job.render();
  return h('section', { class: 'card', 'aria-label': t('kioskVm.title'), 'data-kiosk-vm': '1' }, [
    h('h2', { text: t('kioskVm.title') }), h('p', { class: 'muted', text: t('kioskVm.lead') }),
    h('div', { class: 'fields2' }, [name, field({ label: t('kioskVm.provider'), control: engine }), iso, storage, digest, network]),
    h('div', { class: 'row' }, [preview, create]), status, details, reveal, output,
  ]);
}
