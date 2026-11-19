// School mode controls for the offline reader. The local bridge only returns public mode state.
(function (root) {
  'use strict';

  function mount(area, bridge, h, t, changed) {
    var state = { available: false, enabled: true };
    var action = null;
    var busy = false;
    var epoch = 0;
    var note = h('p', { class: 'reader-school-note', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
    var signature;

    function message(key) {
      if (key) note.setAttribute('data-i18n', key);
      else note.removeAttribute('data-i18n');
      note.textContent = key ? t(key) : '';
    }
    function focus(id) {
      var control = area.querySelector('#reader-school-' + id);
      if (control && control.getClientRects().length) control.focus();
    }
    function primary() { return !state.available ? 'retry' : state.enabled ? 'unlock' : 'enable'; }
    function button(id, key, use, style) {
      return h('button', { type: 'button', id: 'reader-school-' + id, class: style || 'btn btn-ghost btn-sm', 'data-i18n': key,
        disabled: busy, onclick: use }, [t(key)]);
    }
    function replaceState(value) {
      var valid = value && typeof value.available === 'boolean' && typeof value.enabled === 'boolean'
        && (value.available === false || (typeof value.name === 'string' && value.name.length <= 40));
      var next = valid && value.available ? value : { available: false, enabled: true };
      var nextSignature = JSON.stringify(next);
      if (signature === nextSignature) return false;
      signature = nextSignature;
      state = next;
      epoch++;
      changed(next);
      return true;
    }
    function receive(next) {
      var active = area.contains(document.activeElement);
      if (!replaceState(next)) return;
      action = null;
      paint(active ? primary() : null);
    }
    async function refresh(refocus) {
      var before = epoch;
      var next;
      try { next = await bridge?.read(); } catch {}
      if (epoch === before) receive(next);
      if (refocus) focus(primary());
    }
    function begin(next) {
      action = next;
      paint(next === 'unlock' ? 'pin' : 'name');
    }
    function field(id, key, values) {
      var control = h('input', Object.assign({ id: 'reader-school-' + id, 'aria-describedby': 'reader-school-result' }, values));
      return { control: control, label: h('label', { class: 'reader-school-field' }, [h('span', { 'data-i18n': key }, [t(key)]), control]) };
    }
    function actionForm() {
      var name = action === 'unlock' ? null : field('name', 'readerSchool.name', { type: 'text', maxlength: 40, value: state.name || '' });
      var pinOptions = { type: 'password', maxlength: 12, inputmode: 'numeric', autocomplete: 'off' };
      var pin = field('pin', action === 'enable' ? 'readerSchool.newPin' : 'readerSchool.pin', pinOptions);
      var confirm = action === 'enable' ? field('confirmation', 'readerSchool.repeatPin', pinOptions) : null;
      var submit = h('button', { type: 'submit', class: 'btn btn-primary btn-sm', id: 'reader-school-submit',
        'data-i18n': 'readerSchool.' + action }, [t('readerSchool.' + action)]);
      var cancel = button('cancel', 'readerSchool.cancel', function () { var previous = action; action = null; paint(previous); });
      var form = h('form', { class: 'reader-school-form', novalidate: true }, [
        name?.label, pin.label, confirm?.label, h('div', { class: 'cta' }, [submit, cancel]),
      ]);
      form.addEventListener('submit', async function (event) {
        event.preventDefault();
        if (busy || !action) return;
        var selected = action;
        var label = name ? name.control.value.trim() : undefined;
        var credential = pin.control.value;
        var repeated = confirm?.control.value;
        pin.control.value = '';
        if (confirm) confirm.control.value = '';
        if (name && (!label || label.length > 40)) { message('readerSchool.badName'); focus('name'); return; }
        if (!/^\d{4,12}$/.test(credential)) { message('readerSchool.badPin'); focus('pin'); return; }
        if (confirm && credential !== repeated) { message('readerSchool.pinMismatch'); focus('pin'); return; }
        busy = true;
        submit.disabled = cancel.disabled = true;
        var before = epoch;
        var answer;
        try { answer = await bridge?.[selected](credential, label); } catch {}
        busy = false;
        if (epoch !== before) {
          action = null;
          await refresh(false);
          paint(primary());
          return;
        }
        if (answer?.ok) {
          action = null;
          replaceState(answer.state);
          paint(selected === 'rename' && state.available && state.enabled ? 'rename' : primary());
          message('readerSchool.updated');
        } else if (answer?.state && replaceState(answer.state)) {
          action = null;
          paint(primary());
          message('readerSchool.saveFailed');
        } else {
          submit.disabled = cancel.disabled = false;
          message(answer?.reason === 'wrongPin' ? 'readerSchool.wrongPin' : 'readerSchool.saveFailed');
          focus('pin');
        }
      });
      return form;
    }
    function paint(refocus) {
      var title = state.available ? state.name : t('readerSchool.sharedSetting');
      var actions;
      if (action && state.available) actions = actionForm();
      else if (!state.available) actions = button('retry', 'readerSchool.retry', function () { void refresh(true); });
      else if (state.enabled) actions = h('div', { class: 'cta' }, [
        button('unlock', 'readerSchool.unlock', function () { begin('unlock'); }, 'btn btn-primary btn-sm'),
        button('rename', 'readerSchool.rename', function () { begin('rename'); }),
      ]);
      else actions = button('enable', 'readerSchool.enable', function () { begin('enable'); }, 'btn btn-primary btn-sm');
      note.id = 'reader-school-result';
      var status = !state.available ? 'readerSchool.unavailable' : state.enabled ? 'readerSchool.on' : 'readerSchool.off';
      area.replaceChildren(h('b', { id: 'reader-school-setting-title', text: title, 'data-i18n': state.available ? null : 'readerSchool.sharedSetting' }),
        h('p', { class: 'help', 'data-i18n': 'readerSchool.help' }, [t('readerSchool.help')]),
        h('p', { class: 'help', 'data-i18n': status }, [t(status)]),
        actions, note);
      message(null);
      if (refocus) focus(refocus);
    }
    paint();
    bridge?.subscribe(receive);
    void refresh(false);
  }

  root.TempDeskReaderSchoolSettings = { mount: mount };
})(window);
