// Mirrors every builder history entry into the desktop workspace (Git or JSON lines), so each
// builder action is also one commit with a readable message. The builder's own store (IndexedDB)
// keeps working unchanged for its in-page undo and redo; the workspace copy is redacted (no
// passwords) by the main process before it is written.
(function () {
  'use strict';
  var HI = window.TempDeskHistory;
  var P = window.parent && window.parent !== window ? window.parent : null;
  if (!HI || !P || !P.td) return;
  var host = P.TempDeskHost || {};
  var original = HI.openStore;
  function describe(e) {
    var m = e.msg;
    var text = typeof m === 'string' ? m : (m && m.key ? window.TempDeskSite.t(m.key, (m.args || []).map(function (a) { return typeof a === 'string' && a.charAt(0) === '@' ? window.TempDeskSite.t(a.slice(1)) : a; })) : e.kind);
    if (e.kind === 'undo') return 'Undo: ' + text;
    if (e.kind === 'redo') return 'Redo: ' + text;
    return String(text || 'Edit answer file').slice(0, 200);
  }
  HI.openStore = function (name) {
    return original(name).then(function (store) {
      var append = store.append.bind(store);
      store.append = function (e) {
        return append(e).then(function () {
          if (e.kind === 'start') return;
          try {
            P.td.invoke['ws:save']('answers/' + name + '.json', e.state, describe(e)).then(function () { if (host.historyChanged) host.historyChanged(); }, function () { /* the builder still has its own history */ });
          } catch (err) { /* ignore */ }
        });
      };
      return store;
    });
  };
})();
