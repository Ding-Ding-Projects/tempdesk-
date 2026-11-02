// Bundled by site/build-vendor.mjs into site/assets/vendor/codemirror.js (committed, no CDN).
// Exposes one function: createCodeEditor(parent, options) -> controller.
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightSpecialChars } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { foldGutter, foldKeymap, indentOnInput, bracketMatching, syntaxHighlighting, HighlightStyle, codeFolding } from '@codemirror/language';
import { xml } from '@codemirror/lang-xml';
import { json, jsonParseLinter } from '@codemirror/lang-json';
import { search, searchKeymap, highlightSelectionMatches, openSearchPanel } from '@codemirror/search';
import { linter, lintGutter, lintKeymap, forceLinting } from '@codemirror/lint';
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { tags } from '@lezer/highlight';

// Dark editorial tokens, read from the page's CSS variables so light and dark themes both work.
const theme = EditorView.theme({
  '&': { color: 'var(--x-text)', backgroundColor: 'var(--s1)', height: '100%', fontSize: '0.8rem' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.6' },
  '.cm-content': { caretColor: 'var(--primary)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--primary)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'color-mix(in srgb, var(--primary) 28%, transparent) !important' },
  '.cm-gutters': { backgroundColor: 'var(--rail)', color: 'var(--muted2)', borderRight: '1px solid var(--outline)' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--primary) 6%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'color-mix(in srgb, var(--primary) 12%, transparent)', color: 'var(--text)' },
  '.cm-foldPlaceholder': { backgroundColor: 'var(--s3)', border: '1px solid var(--outline2)', color: 'var(--muted)' },
  '.cm-tooltip': { backgroundColor: 'var(--s1)', border: '1px solid var(--outline3)', color: 'var(--text)', borderRadius: '8px' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--primary-soft)', color: 'var(--text)' },
  '.cm-panels': { backgroundColor: 'var(--s2)', color: 'var(--text)', borderTop: '1px solid var(--outline)' },
  '.cm-panel input, .cm-panel button': { font: 'inherit', fontSize: '0.85rem', minHeight: '32px' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--warn) 30%, transparent)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'color-mix(in srgb, var(--warn) 55%, transparent)' },
  '.cm-matchingBracket': { outline: '1px solid var(--primary)' },
  '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--danger)' },
  '.cm-lintRange-warning': { backgroundImage: 'none', textDecoration: 'underline wavy var(--warn)' },
  '.cm-diagnostic-error': { borderLeftColor: 'var(--danger)' },
  '.cm-diagnostic-warning': { borderLeftColor: 'var(--warn)' },
}, { dark: true });
const highlight = HighlightStyle.define([
  { tag: [tags.tagName, tags.angleBracket], color: 'var(--x-tag)' },
  { tag: tags.attributeName, color: 'var(--x-attr)' },
  { tag: [tags.attributeValue, tags.string], color: 'var(--x-val)' },
  { tag: [tags.comment, tags.processingInstruction, tags.meta], color: 'var(--x-com)', fontStyle: 'italic' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--x-attr)' },
  { tag: tags.propertyName, color: 'var(--x-tag)' },
  { tag: tags.invalid, color: 'var(--danger)' },
]);

// options: { doc, lang: 'xml'|'json'|'text', readOnly, label, schema: { elements, attributes } (lang-xml),
//            lint: (text) => [{ from, to, severity, message }], onChange(text) }
export function createCodeEditor(parent, o) {
  o = o || {};
  const lang = new Compartment();
  const lintC = new Compartment();
  const ro = new Compartment();
  const langExt = (s) => (o.lang === 'xml' ? xml(s || o.schema || {}) : o.lang === 'json' ? json() : []);
  const lintExt = (fn) => (fn ? [linter((view) => fn(view.state.doc.toString()), { delay: 400 }), lintGutter()] : o.lang === 'json' ? [linter(jsonParseLinter()), lintGutter()] : []);
  let silent = false;
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: o.doc || '',
      extensions: [
        lineNumbers(), highlightActiveLineGutter(), highlightSpecialChars(), history(), foldGutter(), codeFolding(), drawSelection(), dropCursor(),
        EditorState.allowMultipleSelections.of(true), indentOnInput(), syntaxHighlighting(highlight), bracketMatching(), closeBrackets(),
        autocompletion(), rectangularSelection(), crosshairCursor(), highlightActiveLine(), highlightSelectionMatches(), search({ top: true }),
        keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap, ...lintKeymap, indentWithTab]),
        theme, lang.of(langExt()), lintC.of(lintExt(o.lint)), ro.of(EditorState.readOnly.of(!!o.readOnly)),
        EditorView.contentAttributes.of({ 'aria-label': o.label || 'Code editor' }),
        EditorView.updateListener.of((u) => { if (u.docChanged && !silent && o.onChange) o.onChange(u.state.doc.toString()); }),
      ],
    }),
  });
  return {
    view,
    get value() { return view.state.doc.toString(); },
    set(text) {
      if (text === view.state.doc.toString()) return;
      silent = true;
      const sel = view.state.selection.main;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: Math.min(sel.anchor, text.length) } });
      silent = false;
    },
    setSchema(schema) { view.dispatch({ effects: lang.reconfigure(langExt(schema)) }); },
    relint() { forceLinting(view); },
    focus() { view.focus(); },
    select(from, to) { view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true }); view.focus(); },
    openSearch() { openSearchPanel(view); },
    hasFocus() { return view.hasFocus; },
    destroy() { view.destroy(); },
  };
}
