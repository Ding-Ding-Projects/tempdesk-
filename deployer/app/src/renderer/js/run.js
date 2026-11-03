// Progress UI for every long engine step: step list (done checks, pulsing current step, pending
// outlines), progress bar, live log, cancel, resume from the failed step, recovery hint, and a
// success celebration. Mirrors design/project/Deployer.dc.html.
import { h, t, btn, toast, play, announce, state, contextMenu, listFilter } from './ui.js';

const td = window.td;
const Core = window.TempDeskCore;
const running = new Map();
td.on['engine:event']((ev) => { const r = running.get(ev.run); if (r) r.onEvent(ev); });

export const PHASE_STEPS = {
  Media: ['folder', 'zip', 'iso'],
  ServerMonitor: ['trust', 'reach', 'stage-copy', 'stage-network', 'stage-forest', 'stage-adws', 'stage-domain', 'stage-agent', 'stage-portals', 'stage-ready', 'keys', 'envs'],
  ServerAdvanced: ['trust', 'reach', 'copy', 'forest', 'adws', 'domain', 'agent', 'keys', 'envs'],
  ServerUpdate: ['trust', 'reach', 'copy', 'domain', 'agent', 'keys', 'envs'],
  Lite: ['connect', 'docker', 'upload', 'config', 'up', 'health', 'keys', 'envs'],
  Portals: ['portals'],
  Uninstall: ['uninstall']
};

// opts: { kicker, title, phase, stepsKey, config, secrets(), noIso, onDone(result), logName }
// Names of deployments with a run in progress (their tabs are protected from bulk close).
export function busyNames() { return [...running.values()].map((r) => r.name).filter(Boolean); }
export function progressPanel(opts) {
  const stepIds = (PHASE_STEPS[opts.stepsKey || opts.phase] || []).filter((id) => opts.filterStep ? opts.filterStep(id) : true);
  const steps = new Map();
  const list = h('ol', { class: 'steps', 'aria-label': t('run.steps') });
  const bar = h('i');
  const barWrap = h('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0', 'aria-label': t('run.progress') }, [bar]);
  const log = h('div', { class: 'log', role: 'log', 'aria-live': 'polite', 'aria-label': t('run.log'), tabindex: '0' });
  const logLines = [];
  const status = h('div', { role: 'status', class: 'small muted' });
  const hintBox = h('div', { class: 'notice warn', role: 'alert', hidden: true });
  const startBtn = btn(opts.startLabel || t('run.start'), () => start(false), 'btn-primary');
  const resumeBtn = btn(t('run.resume'), () => start(false), 'btn-primary', { hidden: true });
  const restartBtn = btn(t('run.restart'), () => start(true), 'btn-ghost', { hidden: true });
  const cancelBtn = btn(t('run.cancel'), () => cancel(), 'btn-ghost', { hidden: true });
  const exportBtn = btn(t('run.exportLog'), () => exportLog(), 'btn-ghost btn-sm');
  let runId = null, started = 0, timer = null, lastResult = null;

  function addStep(id, title) {
    if (steps.has(id)) return steps.get(id);
    const mark = h('span', { class: 'mark', 'aria-hidden': 'true' });
    const label = h('span', { class: 'lbl', text: title || t('step.' + id) });
    const when = h('span', { class: 'when' });
    const hint = h('span', { class: 'hint', hidden: true });
    const sr = h('span', { class: 'sr-only' });
    const li = h('li', { class: 'step', 'data-state': 'pending', 'data-id': id, tabindex: '-1' }, [mark, h('span', { style: { minWidth: 0 } }, [label, sr, hint]), when]);
    const st = { li, mark, label, when, hint, sr, state: 'pending', t0: 0 };
    contextMenu(li, () => [{ label: t('run.copyStep'), run: () => td.invoke['clipboard:write'](label.textContent + ': ' + t('state.' + st.state)) }, { label: t('run.resume'), run: () => start(false), disabled: !!runId }]);
    steps.set(id, st);
    list.appendChild(li);
    setState(id, 'pending');
    return st;
  }
  function setState(id, s, info) {
    const st = steps.get(id) || addStep(id, info && info.title);
    if (info && info.title && !t('step.' + id).startsWith('step.') === false) st.label.textContent = info.title;
    st.state = s;
    st.li.dataset.state = s;
    st.mark.textContent = s === 'done' || s === 'skipped' ? '✓' : s === 'failed' ? '!' : '';
    st.sr.textContent = ', ' + t('state.' + s);
    if (s === 'running') { st.t0 = Date.now(); st.li.setAttribute('aria-current', 'step'); } else st.li.removeAttribute('aria-current');
    if (s === 'done' && st.t0) st.when.textContent = dur(Date.now() - st.t0);
    if (s === 'skipped') st.when.textContent = t('state.skipped');
    if (s === 'failed') {
      const hint = info && info.hint ? info.hint : t('hint.' + id);
      st.hint.hidden = false; st.hint.textContent = hint.startsWith('hint.') ? t('hint.generic') : hint;
      hintBox.hidden = false; hintBox.replaceChildren(h('strong', { text: t('run.failedAt', [st.label.textContent]) }), h('div', { text: st.hint.textContent }));
      announce(t('run.failedAt', [st.label.textContent]));
    } else st.hint.hidden = true;
    progress();
  }
  function progress() {
    const all = [...steps.values()];
    const done = all.filter((s) => s.state === 'done' || s.state === 'skipped').length;
    const pct = all.length ? Math.round(done / all.length * 100) : 0;
    bar.style.width = pct + '%';
    barWrap.setAttribute('aria-valuenow', String(pct));
  }
  function dur(ms) { const s = Math.round(ms / 1000); return s < 60 ? t('run.secs', [s]) : t('run.mins', [Math.round(s / 60)]); }
  function addLog(level, text) {
    const time = new Date().toTimeString().slice(0, 8);
    logLines.push({ time: new Date().toISOString(), level, text });
    log.appendChild(h('div', { class: level }, [time + ' ' + text]));
    while (log.childNodes.length > 2000) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
  }
  function onEvent(ev) {
    if (ev.type === 'log') addLog(ev.level || 'info', ev.text);
    else if (ev.type === 'step') setState(ev.id, ev.state, ev);
    else if (ev.type === 'result') lastResult = ev;
    else if (ev.type === 'exit') finish(ev);
  }
  async function start(reset) {
    if (runId) return;
    const pre = opts.before ? await opts.before() : true;
    if (!pre) return;
    hintBox.hidden = true;
    steps.forEach((st, id) => { if (reset || st.state !== 'done') setState(id, 'pending'); });
    const secrets = opts.secrets ? opts.secrets() : {};
    started = Date.now();
    runId = await td.invoke['engine:start']({ phase: opts.phase, config: opts.config(), secrets, reset: !!reset, noIso: !!(opts.noIso && opts.noIso()) });
    let runName = ''; try { const c = opts.config(); runName = (c && c.name) || ''; } catch (e) { /* ignore */ }
    running.set(runId, { onEvent, name: runName });
    startBtn.hidden = true; resumeBtn.hidden = true; restartBtn.hidden = true; cancelBtn.hidden = false;
    status.textContent = t('run.running');
    timer = setInterval(() => { status.textContent = t('run.elapsed', [dur(Date.now() - started)]); }, 1000);
    addLog('info', t('run.started', [opts.title]));
  }
  async function cancel() { if (runId) { await td.invoke['engine:cancel'](runId); addLog('warn', t('run.cancelling')); } }
  async function finish(ev) {
    clearInterval(timer);
    running.delete(runId); runId = null;
    cancelBtn.hidden = true;
    if (ev.ok) {
      status.textContent = t('run.doneIn', [dur(Date.now() - started)]);
      steps.forEach((st, id) => { if (st.state === 'pending' && opts.pendingDoneOnSuccess) setState(id, 'skipped'); });
      startBtn.hidden = false; restartBtn.hidden = false;
      wrap.classList.remove('success-burst'); void wrap.offsetWidth; if (!state.motionOff) wrap.classList.add('success-burst');
      play('done');
      toast(t('run.success', [opts.title]), 'success');
      if (opts.onDone) opts.onDone(lastResult && lastResult.data);
    } else {
      // Trust failed: ask for the Windows consent prompt (never bypassed), then resume.
      const trust = steps.get('trust');
      if (trust && trust.state === 'failed' && opts.trustAddress && !ev.cancelled) {
        addLog('info', t('trust.asking'));
        const r = await td.invoke['engine:trust'](opts.trustAddress());
        if (r.ok) { addLog('info', t('trust.ok')); setState('trust', 'pending'); start(false); return; }
        if (r.cancelled) { addLog('warn', t('trust.cancelled')); trust.hint.textContent = t('trust.incomplete'); hintBox.replaceChildren(h('strong', { text: t('trust.incomplete') })); setState('trust', 'failed', { hint: t('trust.incomplete') }); }
        else addLog('error', r.error || t('trust.failed'));
      }
      status.textContent = ev.cancelled ? t('run.cancelled') : t('run.failed');
      const anyDone = [...steps.values()].some((s) => s.state === 'done');
      resumeBtn.hidden = !anyDone; startBtn.hidden = anyDone; restartBtn.hidden = !anyDone;
      if (!ev.cancelled) { play('error'); toast(t('run.failedToast', [opts.title]), 'error'); }
    }
  }
  async function exportLog() {
    const fmt = await new Promise((res) => {
      import('./ui.js').then(({ dialog }) => dialog(t('export.title'), (close) => [h('p', { text: t('export.logHelp') }), h('div', { class: 'row' }, ['json', 'csv', 'html', 'txt'].map((f) => btn(f.toUpperCase(), () => { close(); res(f); }, 'btn-ghost')))], { onClose: () => res(null) }));
    });
    if (!fmt) return;
    const name = (opts.logName || 'tempdesk-log') + '.' + fmt;
    let text;
    if (fmt === 'json') text = JSON.stringify({ title: opts.title, exported: new Date().toISOString(), steps: [...steps].map(([id, s]) => ({ id, title: s.label.textContent, state: s.state })), log: logLines }, null, 2) + '\n';
    else if (fmt === 'csv') text = Core.toCsv(logLines, ['time', 'level', 'text']);
    else if (fmt === 'html') text = Core.toHtml(opts.title, logLines, ['time', 'level', 'text']);
    else text = logLines.map((l) => l.time + ' ' + l.level.toUpperCase() + ' ' + l.text).join('\r\n') + '\r\n';
    const r = await td.invoke['file:save']({ name, text, filters: [{ name: fmt.toUpperCase(), extensions: [fmt] }] });
    if (r.ok) toast(t('export.saved', [r.path]), 'success');
  }
  stepIds.forEach((id) => addStep(id));
  const wrap = h('div', { class: 'progress-wrap' }, [
    h('div', { class: 'steps-col' }, [
      h('div', null, [opts.kicker ? h('div', { class: 'kicker', text: opts.kicker }) : null, h('h2', { style: { fontSize: '1.5rem', margin: '4px 0 0' }, text: opts.title })]),
      listFilter(list, 'run-steps', t('run.steps')), hintBox, h('div', { style: { marginTop: 'auto' } }, [barWrap]), status,
      h('div', { class: 'row' }, [startBtn, resumeBtn, restartBtn, cancelBtn])]),
    h('div', { class: 'log-col' }, [h('div', { class: 'row between' }, [h('h3', { style: { margin: 0 }, text: t('run.log') }), exportBtn]), listFilter(log, 'run-log', t('run.log'))])
  ]);
  wrap.start = start;
  return wrap;
}
