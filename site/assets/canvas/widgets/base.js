// Shared helpers for the setting widgets (DOM). Framework free; uses the canvas dom.js helper.
import { h } from '../dom.js';

let uid = 0;
export const nextId = (p) => (p || 'w') + '-' + (++uid);
export { h };

/** True when the page asks for reduced motion (OS setting or the in-app Motion setting). */
export function reducedMotion() {
  const m = document.documentElement.getAttribute('data-motion');
  if (m === 'off' || m === 'reduced') return true;
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
}
/** Briefly highlights an element after its value changed (class removed after the animation). */
export function flash(el) {
  if (!el || reducedMotion()) return;
  el.classList.remove('w-flash');
  void el.offsetWidth;
  el.classList.add('w-flash');
  setTimeout(() => el.classList.remove('w-flash'), 700);
}
/** A text input wired for widgets. opts: { id, value, mono, placeholder, inputmode, maxLength, describedBy, label, type, autocomplete } */
export function textInput(o) {
  const inp = h('input', {
    type: o.type || 'text', id: o.id, value: o.value == null ? '' : String(o.value), class: 'w-input' + (o.mono ? ' mono' : '') + (o.cls ? ' ' + o.cls : ''),
    placeholder: o.placeholder || undefined, inputmode: o.inputmode || undefined, maxlength: o.maxLength || undefined, spellcheck: 'false',
    autocomplete: o.autocomplete || 'off', autocapitalize: 'off', 'aria-describedby': o.describedBy || undefined, 'aria-label': o.label || undefined
  });
  return inp;
}
/** A small toolbar button (44 px target). */
export function toolButton(text, label, onclick, extra) {
  return h('button', Object.assign({ type: 'button', class: 'w-tool', 'aria-label': label || text, title: label || text, onclick }, extra || {}), [text]);
}
/** Chips for presets: [{ value, label }] -> buttons that call pick(value). */
export function presetChips(presets, pick, t, label) {
  if (!presets || !presets.length) return null;
  return h('div', { class: 'w-chips', role: 'group', 'aria-label': label || t('w.presets', null, 'Suggestions') },
    presets.map((p) => h('button', { type: 'button', class: 'w-chip', title: p.value, onclick: () => pick(p.value) }, [p.label || p.value])));
}
/** Wraps a control with an inline error line owned by the widget. */
export function errorLine(id) { return h('div', { class: 'w-err', id, role: 'status', 'aria-live': 'polite' }); }
/** Builds the keyboard behaviour of a radio group: arrows move and select, Home/End jump. */
export function radioKeys(container, buttons, select) {
  container.addEventListener('keydown', (e) => {
    const i = buttons.indexOf(document.activeElement);
    if (i < 0) return;
    let j = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % buttons.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + buttons.length) % buttons.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = buttons.length - 1;
    if (j < 0) return;
    e.preventDefault();
    buttons[j].focus();
    select(j);
  });
}
/** Sets roving tabindex and aria-checked on a list of radio buttons. */
export function markRadios(buttons, index) {
  buttons.forEach((b, k) => { b.setAttribute('aria-checked', String(k === index)); b.tabIndex = k === index || (index < 0 && k === 0) ? 0 : -1; });
}
/** Debounce helper. */
export function debounce(fn, ms) { let tm; return (...a) => { clearTimeout(tm); tm = setTimeout(() => fn(...a), ms); }; }
/** Copies text to the clipboard when the page allows it. */
export async function copyText(text) { try { await navigator.clipboard.writeText(text); return true; } catch (e) { return false; } }
