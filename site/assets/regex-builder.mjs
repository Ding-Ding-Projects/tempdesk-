// ES module entry for the TempDesk regex builder. The implementation lives in regex-builder.js,
// which also works as a classic script (window.TempDeskRegex), as CommonJS and as its own
// evaluation worker. See the API comment at the top of regex-builder.js.
import './regex-builder.js';

const R = globalThis.TempDeskRegex;
if (!globalThis.TempDeskRegexWorkerUrl) {
  try { globalThis.TempDeskRegexWorkerUrl = new URL('./regex-builder.js', import.meta.url).href; } catch { /* no URL support */ }
}
export const { attachRegexBuilder, attachListFilter, attachTabCloser, compile, filterItems, evaluate, explain, tokenize, isCatastrophic, escapeRegex, defaultState, GALLERY, LIMITS, STRINGS } = R;
export default R;
