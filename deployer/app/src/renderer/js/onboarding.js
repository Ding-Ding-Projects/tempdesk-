// First-run onboarding: pick a path (Server Core or Lite), check real prerequisites (PowerShell,
// OpenSSH client, Docker, network, Git), choose language and look, then open the workspace.
// Back/Next, progress dots, skip for optional steps, and the step is saved so it resumes.
import { h, t, btn, state, select, toast, listFilter } from './ui.js';

const td = window.td;

export function runOnboarding(app) {
  const s = app.settings;
  const ob = Object.assign({ step: 0, path: 'server', skipped: [] }, s.onboarding);
  const STEPS = ['welcome', 'path', 'prereqs', 'look', 'done'];
  const wrap = h('div', { class: 'onb', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'onb-h' });
  const prev = document.activeElement;
  let prereqs = null;
  async function save() { await td.invoke['settings:set']({ onboarding: { step: ob.step, path: ob.path, skipped: ob.skipped } }, null); }
  async function finish() {
    await app.applySettings({ onboarded: true, onboarding: { step: STEPS.length - 1, path: ob.path, skipped: ob.skipped } }, t('hist.onboardDone'));
    wrap.remove();
    app.go('deploy');
    if (prev && prev.focus) prev.focus();
  }
  function draw() {
    const id = STEPS[ob.step];
    const body = h('div', { class: 'stack' });
    if (id === 'welcome') body.append(h('p', { class: 'muted', text: t('onb.welcomeLead') }), h('p', { text: t('onb.welcomeBody') }));
    if (id === 'path') {
      body.append(h('p', { class: 'muted', text: t('onb.pathLead') }), h('div', { class: 'choice', role: 'group', 'aria-label': t('onb.path') }, ['server', 'lite'].map((p) => h('button', { type: 'button', 'aria-pressed': String(ob.path === p), onclick: () => { ob.path = p; save(); draw(); } }, [h('div', { style: { fontWeight: '800', fontSize: '1.05rem' }, text: t('onb.path.' + p) }), h('div', { class: 'small muted', text: t('onb.path.' + p + '.help') })]))));
    }
    if (id === 'prereqs') {
      const listEl = h('div', { 'aria-live': 'polite' });
      body.append(h('p', { class: 'muted', text: t('onb.prereqLead') }), listFilter(listEl, 'onboarding-prereqs', t('onb.prereqLead'), { items: (l) => [...l.querySelectorAll('.prereq')] }), btn(t('onb.recheck'), () => check(listEl), 'btn-ghost btn-sm'));
      check(listEl);
    }
    if (id === 'look') {
      body.append(h('p', { class: 'muted', text: t('onb.lookLead') }),
        h('div', { class: 'field' }, [h('label', { for: 'onb-lang', text: t('set.language') }), Object.assign(select([['en', t('lang.en')], ['zh-HK', t('lang.zh-HK')], ['bilingual', t('lang.bilingual')]], s.language, (v) => app.applySettings({ language: v }, t('hist.setField', [t('set.language'), v])).then(draw)), { id: 'onb-lang', disabled: state.school.enabled })]),
        h('div', { class: 'field' }, [h('label', { for: 'onb-theme', text: t('set.theme') }), Object.assign(select([['dark', t('opt.dark')], ['light', t('opt.light')], ['system', t('opt.system')]], s.theme, (v) => app.applySettings({ theme: v }, t('hist.setField', [t('set.theme'), v])).then(draw)), { id: 'onb-theme' })]),
        h('div', { class: 'field' }, [h('label', { for: 'onb-motion', text: t('set.motion') }), Object.assign(select([['system', t('opt.motionSystem')], ['on', t('opt.on')], ['off', t('opt.off')]], s.motion, (v) => app.applySettings({ motion: v }, t('hist.setField', [t('set.motion'), v])).then(draw)), { id: 'onb-motion' })]));
    }
    if (id === 'done') body.append(h('p', { text: t('onb.doneBody.' + ob.path) }));
    const optional = id === 'look' || id === 'prereqs';
    wrap.replaceChildren(h('div', { class: 'wrap' }, [
      h('div', { class: 'kicker', text: t('onb.kicker', [ob.step + 1, STEPS.length]) }),
      h('h1', { id: 'onb-h', text: t('onb.' + id) }),
      h('div', { class: 'dots', role: 'progressbar', 'aria-valuemin': '1', 'aria-valuemax': String(STEPS.length), 'aria-valuenow': String(ob.step + 1), 'aria-label': t('onb.progress') }, STEPS.map((x, i) => h('i', { class: i <= ob.step ? 'on' : '' }))),
      h('div', { class: 'card stagger' }, [body]),
      h('div', { class: 'row between', style: { marginTop: '18px' } }, [
        btn(t('onb.back'), () => { ob.step = Math.max(0, ob.step - 1); save(); draw(); }, 'btn-ghost', { disabled: ob.step === 0 || undefined }),
        h('div', { class: 'row' }, [
          optional ? btn(t('onb.skip'), () => { if (!ob.skipped.includes(id)) ob.skipped.push(id); ob.step++; save(); draw(); }, 'btn-ghost') : null,
          id === 'done' ? btn(t('onb.open'), finish, 'btn-primary') : btn(t('onb.next'), () => { ob.step++; save(); draw(); }, 'btn-primary')])])]));
    const f = wrap.querySelector('h1'); f.setAttribute('tabindex', '-1'); f.focus();
  }
  async function check(listEl) {
    listEl.replaceChildren(h('p', { class: 'muted', text: t('onb.checking') }));
    prereqs = await td.invoke['engine:prereqs']();
    const need = { powershell: true, openssh: ob.path === 'lite', docker: false, git: false };
    const rows = [['powershell', prereqs.powershell], ['openssh', prereqs.openssh], ['docker', prereqs.docker], ['git', prereqs.git], ['network', prereqs.network && prereqs.network.length ? prereqs.network.join(', ') : null]];
    listEl.replaceChildren(...rows.map(([k, v]) => h('div', { class: 'prereq' }, [
      h('span', { class: 'chip ' + (v ? 'ok' : need[k] || k === 'network' ? 'bad' : 'warn'), text: v ? t('onb.found') : need[k] || k === 'network' ? t('onb.missing') : t('onb.optional') }),
      h('div', { style: { flex: '1', minWidth: '200px' } }, [h('div', { style: { fontWeight: '700' }, text: t('onb.pr.' + k) }), h('div', { class: 'small muted', text: v ? String(v) : t('onb.pr.' + k + '.fix') })])])));
    if (!prereqs.powershell) toast(t('onb.psMissing'), 'error');
  }
  wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); toast(t('onb.escHint')); } });
  document.body.appendChild(wrap);
  draw();
}
