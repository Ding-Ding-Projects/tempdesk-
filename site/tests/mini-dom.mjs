// A very small DOM for unit tests of the framework-free widgets (no dependencies). It covers what the
// widget code uses: elements, attributes, classList, text, events with bubbling, simple selectors,
// focus, and a few form control properties. It is not a browser and does no layout.

class Event {
  constructor(type, init) { this.type = type; this.bubbles = !!(init && init.bubbles); this.defaultPrevented = false; this.target = null; this.currentTarget = null; this._stop = false; Object.assign(this, init || {}); }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this._stop = true; }
}
class KeyboardEvent extends Event {}
class CustomEvent extends Event { constructor(type, init) { super(type, init); this.detail = init && init.detail; } }

class ClassList {
  constructor(el) { this.el = el; }
  _get() { return (this.el.getAttribute('class') || '').split(/\s+/).filter(Boolean); }
  _set(a) { this.el.setAttribute('class', a.join(' ')); }
  add(...c) { const a = this._get(); c.forEach((x) => { if (!a.includes(x)) a.push(x); }); this._set(a); }
  remove(...c) { this._set(this._get().filter((x) => !c.includes(x))); }
  contains(c) { return this._get().includes(c); }
  toggle(c, force) { const has = this.contains(c); const on = force === undefined ? !has : !!force; if (on && !has) this.add(c); if (!on && has) this.remove(c); return on; }
}

class Node {
  constructor(doc) { this.ownerDocument = doc; this.parentNode = null; this.childNodes = []; this._listeners = {}; }
  get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
  appendChild(n) { if (n.nodeType === 11) { [...n.childNodes].forEach((c) => this.appendChild(c)); return n; } if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; this.childNodes.push(n); return n; }
  append(...ns) { ns.forEach((n) => { if (n === null || n === undefined) return; this.appendChild(typeof n === 'string' ? this.ownerDocument.createTextNode(n) : n); }); }
  prepend(...ns) { const keep = this.childNodes; this.childNodes = []; this.append(...ns); keep.forEach((k) => this.childNodes.push(k)); }
  insertBefore(n, ref) { if (!ref) return this.appendChild(n); if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; this.childNodes.splice(this.childNodes.indexOf(ref), 0, n); return n; }
  removeChild(n) { const i = this.childNodes.indexOf(n); if (i >= 0) this.childNodes.splice(i, 1); n.parentNode = null; return n; }
  replaceChildren(...ns) { this.childNodes.forEach((c) => { c.parentNode = null; }); this.childNodes = []; this.append(...ns); }
  replaceWith(n) { const p = this.parentNode; if (!p) return; p.insertBefore(n, this); p.removeChild(this); }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  contains(n) { while (n) { if (n === this) return true; n = n.parentNode; } return false; }
  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(v) { this.replaceChildren(); if (v !== '' && v !== null && v !== undefined) this.appendChild(this.ownerDocument.createTextNode(String(v))); }
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  removeEventListener(type, fn) { this._listeners[type] = (this._listeners[type] || []).filter((f) => f !== fn); }
  dispatchEvent(e) {
    e.target = e.target || this;
    let n = this;
    const bubbles = e.bubbles || ['input', 'change', 'click', 'keydown', 'focusin', 'focusout'].includes(e.type);
    while (n) { e.currentTarget = n; (n._listeners[e.type] || []).slice().forEach((f) => f.call(n, e)); if (e._stop || !bubbles) break; n = n.parentNode; }
    return !e.defaultPrevented;
  }
}
class Text extends Node { constructor(doc, t) { super(doc); this.nodeType = 3; this.data = t; } get textContent() { return this.data; } set textContent(v) { this.data = String(v); } }
class Fragment extends Node { constructor(doc) { super(doc); this.nodeType = 11; } }

const PROP_ATTRS = ['id', 'type', 'title', 'placeholder', 'href', 'name', 'min', 'max', 'step', 'role', 'for', 'accept', 'rel', 'target', 'rows', 'tabindex'];
class Element extends Node {
  constructor(doc, tag) {
    super(doc); this.nodeType = 1; this.tagName = tag.toUpperCase(); this.attributes = new Map(); this.style = {}; this.dataset = {};
    this.classList = new ClassList(this); this._value = ''; this.checked = false; this.disabled = false; this.selectionStart = 0; this.selectionEnd = 0;
    this.files = null;
  }
  setAttribute(k, v) { v = String(v); this.attributes.set(k, v); if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-(\w)/g, (m, c) => c.toUpperCase())] = v; if (k === 'value' && this._value === '') this._value = v; if (k === 'hidden') this._hidden = true; if (k === 'disabled') this.disabled = true; if (k === 'tabindex') this._tab = Number(v); }
  getAttribute(k) { return this.attributes.has(k) ? this.attributes.get(k) : null; }
  hasAttribute(k) { return this.attributes.has(k); }
  removeAttribute(k) { this.attributes.delete(k); if (k === 'hidden') this._hidden = false; }
  get id() { return this.getAttribute('id') || ''; } set id(v) { this.setAttribute('id', v); }
  get className() { return this.getAttribute('class') || ''; } set className(v) { this.setAttribute('class', v); }
  get type() { return this.getAttribute('type') || (this.tagName === 'INPUT' ? 'text' : ''); } set type(v) { this.setAttribute('type', v); }
  get href() { return this.getAttribute('href') || ''; } set href(v) { this.setAttribute('href', v); }
  get hidden() { return !!this._hidden; } set hidden(v) { this._hidden = !!v; if (v) this.attributes.set('hidden', ''); else this.attributes.delete('hidden'); }
  get open() { return this.attributes.has('open'); } set open(v) { const was = this.open; if (v) this.attributes.set('open', ''); else this.attributes.delete('open'); if (was !== !!v) this.dispatchEvent(new Event('toggle')); }
  get tabIndex() { return this._tab === undefined ? 0 : this._tab; } set tabIndex(v) { this.setAttribute('tabindex', String(v)); }
  get value() { return this._value; } set value(v) { this._value = v === null || v === undefined ? '' : String(v); this.selectionStart = this.selectionEnd = this._value.length; }
  get children() { return this.childNodes.filter((c) => c.nodeType === 1); }
  get nextElementSibling() { const s = this.parentNode ? this.parentNode.children : []; return s[s.indexOf(this) + 1] || null; }
  get previousElementSibling() { const s = this.parentNode ? this.parentNode.children : []; return s[s.indexOf(this) - 1] || null; }
  get options() { return this.querySelectorAll('option'); }
  get innerHTML() { return this._html || ''; } set innerHTML(v) { this._html = String(v); this.replaceChildren(); }
  get offsetWidth() { return 100; }
  focus() { this.ownerDocument.activeElement = this; }
  blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body; }
  click() { if (this.disabled) return; this.dispatchEvent(new Event('click', { bubbles: true })); }
  select() {}
  setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; }
  scrollIntoView() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 20, right: 100, bottom: 20 }; }
  matches(sel) { return sel.split(',').some((s) => matchCompound(this, s.trim())); }
  closest(sel) { let n = this; while (n && n.nodeType === 1) { if (n.matches(sel)) return n; n = n.parentNode; } return null; }
  querySelectorAll(sel) { const out = []; const walk = (n) => { n.children.forEach((c) => { if (c.matches(sel)) out.push(c); walk(c); }); }; walk(this); return out; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
// selectors: descendant combinators of compounds like tag.class#id[attr="v"][attr]:not(...)
function matchCompound(el, sel) {
  const parts = sel.split(/\s+(?![^[]*\])/).filter(Boolean);
  if (!matchOne(el, parts[parts.length - 1])) return false;
  let i = parts.length - 2, n = el.parentNode;
  while (i >= 0 && n && n.nodeType === 1) { if (matchOne(n, parts[i])) i--; n = n.parentNode; }
  return i < 0;
}
function matchOne(el, s) {
  let rest = s;
  const nots = [];
  rest = rest.replace(/:not\(([^)]*)\)/g, (m, x) => { nots.push(x); return ''; });
  const attrs = [];
  rest = rest.replace(/\[([\w-]+)(?:([~^$*]?=)"?([^"\]]*)"?)?\]/g, (m, a, op, v) => { attrs.push([a, op, v]); return ''; });
  const m = /^([a-zA-Z0-9]*|\*)?((?:[.#][\w-]+)*)$/.exec(rest);
  if (!m) return false;
  if (m[1] && m[1] !== '*' && el.tagName !== m[1].toUpperCase()) return false;
  for (const p of (m[2] || '').match(/[.#][\w-]+/g) || []) { if (p[0] === '.' && !el.classList.contains(p.slice(1))) return false; if (p[0] === '#' && el.id !== p.slice(1)) return false; }
  for (const [a, op, v] of attrs) { const got = el.getAttribute(a); if (got === null) return false; if (op === '=' && got !== v) return false; }
  for (const x of nots) if (matchOne(el, x)) return false;
  return true;
}
class Document extends Node {
  constructor() { super(null); this.ownerDocument = this; this.nodeType = 9; this.documentElement = new Element(this, 'html'); this.body = new Element(this, 'body'); this.documentElement.appendChild(this.body); this.activeElement = this.body; }
  createElement(tag) { return new Element(this, tag); }
  createElementNS(ns, tag) { return new Element(this, tag); }
  createTextNode(t) { return new Text(this, t); }
  createDocumentFragment() { return new Fragment(this); }
  getElementById(id) { return this.documentElement.querySelector('#' + id); }
  querySelector(s) { return this.documentElement.querySelector(s); }
  querySelectorAll(s) { return this.documentElement.querySelectorAll(s); }
}

/** Installs globals (document, window, Event, ...) and returns { document, window, restore() }. */
export function installDom() {
  const document = new Document();
  const window = { document, Event, KeyboardEvent, CustomEvent, matchMedia: () => ({ matches: false, addEventListener() {} }), getComputedStyle: () => ({}), clipboardData: null };
  const saved = {};
  const set = { document, window, Event, KeyboardEvent, CustomEvent, CSS: { escape: (s) => String(s).replace(/(["\\])/g, '\\$1') } };
  for (const [k, v] of Object.entries(set)) { saved[k] = Object.getOwnPropertyDescriptor(globalThis, k); Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true }); }
  return { document, window, restore() { for (const [k, d] of Object.entries(saved)) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; } } };
}
