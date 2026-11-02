// Command timeline: RunSynchronous and RunAsynchronous (specialize), FirstLogonCommands and
// LogonCommands (oobeSystem) as ordered cards. Drag (or buttons) to reorder or move between
// lists, duplicate, disable, reboot markers (WillReboot) and credentials where the schema allows.
// Writes model.commands (see answer.js COMMAND_LISTS).
import { h, iconButton, clone, ICONS } from './dom.js';
import { startDrag } from './drag.js';

export const LISTS = [
  { id: 'runSync', pass: 'specialize', reboot: true, creds: true },
  { id: 'runAsync', pass: 'specialize', reboot: false, creds: true },
  { id: 'firstLogon', pass: 'oobeSystem', reboot: false, creds: false },
  { id: 'logon', pass: 'oobeSystem', reboot: false, creds: false }
];
// Pure list operations used by the UI (and tests).
export function moveCommand(cmds, from, fromIdx, to, toIdx) {
  const out = clone(cmds);
  const [it] = out[from].splice(fromIdx, 1);
  if (!it) return out;
  const def = LISTS.find((l) => l.id === to);
  if (!def.reboot) delete it.willReboot;
  if (!def.creds) delete it.credentials;
  out[to] = out[to] || [];
  out[to].splice(Math.min(toIdx, out[to].length), 0, it);
  return out;
}

// ctx: { t, get() -> commands, set(commands, msg, coalesceKey), generated(listId) -> [{command, description}] }
export function mountCommands(root, ctx) {
  const t = ctx.t;
  function C() { const c = clone(ctx.get()) || {}; LISTS.forEach((l) => { c[l.id] = c[l.id] || []; }); return c; }
  function commit(c, key, args, co) { ctx.set(c, { key, args }, co); if (!co) draw(); }
  function draw() {
    const cmds = C();
    const lanes = h('div', { class: 'cmd-lanes' });
    const laneEls = [];
    LISTS.forEach((def) => {
      const lane = h('section', { class: 'cmd-lane', 'data-list': def.id, 'aria-label': t('cmd.' + def.id) }, [h('h3', { text: t('cmd.' + def.id) }), h('p', { text: t('cmd.' + def.id + '.help') })]);
      (ctx.generated(def.id) || []).forEach((g) => lane.appendChild(h('div', { class: 'cmd-card disabled', title: t('cmd.fromMode') }, [h('small', { class: 'meter-label', text: t('cmd.fromMode') }), h('code', { style: { overflowWrap: 'anywhere', fontSize: '.78rem' }, text: g.description || g.command })])));
      cmds[def.id].forEach((it, i) => {
        const card = h('div', { class: 'cmd-card' + (it.disabled ? ' disabled' : ''), 'data-i': i });
        const handle = h('span', { class: 'iconbtn handle', html: ICONS.grip, role: 'button', tabindex: '0', 'aria-label': t('cmd.dragHandle', [i + 1]) });
        handle.addEventListener('pointerdown', (e) => startDrag(e, { ghostFrom: card, data: { from: def.id, i }, targets: () => {
          const out = [];
          laneEls.forEach((le) => {
            [...le.querySelectorAll('.cmd-card[data-i]')].forEach((ce) => out.push({ el: ce, accept: () => true, drop: (d) => commit(moveCommand(C(), d.from, d.i, le.dataset.list, Number(ce.dataset.i) - (d.from === le.dataset.list && d.i < Number(ce.dataset.i) ? 1 : 0)), 'hist.cmdMove', [t('cmd.' + le.dataset.list)]) }));
            out.push({ el: le, accept: () => true, drop: (d) => commit(moveCommand(C(), d.from, d.i, le.dataset.list, 9999), 'hist.cmdMove', [t('cmd.' + le.dataset.list)]) });
          });
          return out;
        } }));
        handle.addEventListener('keydown', (e) => {
          if (e.key === 'ArrowUp' && i > 0) { e.preventDefault(); commit(moveCommand(C(), def.id, i, def.id, i - 1), 'hist.cmdMove', [t('cmd.' + def.id)]); }
          if (e.key === 'ArrowDown' && i < cmds[def.id].length - 1) { e.preventDefault(); commit(moveCommand(C(), def.id, i, def.id, i + 1), 'hist.cmdMove', [t('cmd.' + def.id)]); }
        });
        const cmdId = `cmd-${def.id}-${i}`;
        const cmdIn = h('textarea', { id: cmdId, rows: '2', spellcheck: 'false', value: it.command || '' });
        cmdIn.value = it.command || '';
        cmdIn.addEventListener('input', () => { const c = C(); c[def.id][i].command = cmdIn.value; commit(c, 'hist.cmdText', [t('cmd.' + def.id), i + 1], cmdId); });
        cmdIn.addEventListener('blur', () => draw());
        const descIn = h('input', { type: 'text', id: cmdId + '-d', value: it.description || '' });
        descIn.addEventListener('input', () => { const c = C(); c[def.id][i].description = descIn.value; commit(c, 'hist.cmdDesc', [t('cmd.' + def.id), i + 1], cmdId + '-d'); });
        const err = !String(it.command || '').trim() && !it.disabled ? h('div', { class: 'err', role: 'alert', text: t('err.command') }) : null;
        card.appendChild(h('div', { class: 'inline', style: { alignItems: 'center', justifyContent: 'space-between' } }, [
          h('b', { text: '#' + (i + 1) }), handle,
          h('div', { class: 'row-tools', style: { display: 'flex', gap: '4px' } }, [
            iconButton('up', t('list.up'), () => commit(moveCommand(C(), def.id, i, def.id, i - 1), 'hist.cmdMove', [t('cmd.' + def.id)]), { disabled: i === 0 || undefined }),
            iconButton('down', t('list.down'), () => commit(moveCommand(C(), def.id, i, def.id, i + 1), 'hist.cmdMove', [t('cmd.' + def.id)]), { disabled: i === cmds[def.id].length - 1 || undefined }),
            iconButton('dup', t('cmd.duplicate'), () => { const c = C(); c[def.id].splice(i + 1, 0, clone(it)); commit(c, 'hist.cmdDup', [t('cmd.' + def.id), i + 1]); }),
            iconButton('del', t('list.remove'), () => { const c = C(); c[def.id].splice(i, 1); commit(c, 'hist.cmdRemove', [t('cmd.' + def.id), i + 1]); })
          ])
        ]));
        card.appendChild(h('div', { class: 'field' }, [h('label', { for: cmdId, text: t('cmd.command') }), cmdIn, err]));
        card.appendChild(h('div', { class: 'field' }, [h('label', { for: cmdId + '-d', text: t('cmd.description') }), descIn]));
        const dis = h('input', { type: 'checkbox', checked: !!it.disabled });
        dis.addEventListener('change', () => { const c = C(); c[def.id][i].disabled = dis.checked; commit(c, dis.checked ? 'hist.cmdDisable' : 'hist.cmdEnable', [t('cmd.' + def.id), i + 1]); });
        const row = h('div', { class: 'inline', style: { flexWrap: 'wrap', alignItems: 'center' } }, [h('label', { class: 'check' }, [dis, t('cmd.disabled')])]);
        if (def.reboot) {
          const rb = h('select', { 'aria-label': t('cmd.willReboot') }, ['Never', 'Always', 'OnRequest'].map((v) => h('option', { value: v, text: t('cmd.reboot.' + v) })));
          rb.value = it.willReboot || 'Never';
          rb.addEventListener('change', () => { const c = C(); c[def.id][i].willReboot = rb.value; commit(c, 'hist.cmdReboot', [t('cmd.' + def.id), i + 1, rb.value]); });
          row.appendChild(h('label', { class: 'field', style: { flexDirection: 'row', alignItems: 'center', gap: '6px' } }, [t('cmd.willReboot'), rb]));
        }
        card.appendChild(row);
        if (def.creds) {
          const det = h('details', { open: it.credentials && it.credentials.username ? true : undefined }, [h('summary', { style: { minHeight: '44px', display: 'flex', alignItems: 'center', cursor: 'pointer' }, text: t('cmd.credentials') })]);
          const g = h('div', { class: 'grid2' });
          ['domain', 'username', 'password'].forEach((f) => {
            const id = `${cmdId}-c-${f}`;
            const inp = h('input', { type: f === 'password' ? 'password' : 'text', id, value: (it.credentials && it.credentials[f]) || '', autocomplete: 'off' });
            inp.addEventListener('input', () => { const c = C(); c[def.id][i].credentials = Object.assign({ domain: '', username: '', password: '' }, c[def.id][i].credentials, { [f]: inp.value }); commit(c, f === 'password' ? 'hist.setSecret' : 'hist.cmdCred', [t('cmd.' + def.id) + ' #' + (i + 1)], id); });
            g.appendChild(h('div', { class: 'field' }, [h('label', { for: id, text: t('cmd.cred.' + f) }), inp]));
          });
          det.appendChild(g);
          det.appendChild(h('p', { class: 'notice warn', text: t('cmd.credWarn') }));
          card.appendChild(det);
        }
        if (def.reboot && it.willReboot && it.willReboot !== 'Never') card.appendChild(h('span', { class: 'reboot', text: t('cmd.rebootMarker', [t('cmd.reboot.' + it.willReboot)]) }));
        lane.appendChild(card);
      });
      lane.appendChild(h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: t('cmd.add'), onclick: () => { const c = C(); c[def.id].push({ command: '', description: '', willReboot: 'Never', disabled: false }); commit(c, 'hist.cmdAdd', [t('cmd.' + def.id)]); const f = root.querySelector(`#cmd-${def.id}-${c[def.id].length - 1}`); if (f) f.focus(); } }));
      laneEls.push(lane);
      lanes.appendChild(lane);
    });
    root.replaceChildren(h('p', { class: 'meter-label', text: t('cmd.keysHelp') }), lanes);
  }
  draw();
  return { update: draw };
}
