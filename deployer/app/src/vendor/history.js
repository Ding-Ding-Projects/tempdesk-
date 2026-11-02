// TempDesk history: append-only action log with unlimited undo and redo.
// Every state change is one entry. Undo, redo and "restore to" are recorded as new entries, so
// nothing is ever lost. Typing coalesces per field until 1 s idle (or flush() on blur).
// Storage backends: IndexedDB (preferred), localStorage (fallback), memory (tests, private mode).
// Browser: window.TempDeskHistory. Node: module.exports.
(function (root) {
  'use strict';

  function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }

  // ---- storage backends: { append(entry), all(), clear(), bytes() } all returning promises ----
  function memoryStore(shared) {
    var box = shared || { entries: [] };
    return {
      kind: 'memory', box: box,
      append: function (e) { box.entries.push(JSON.stringify(e)); return Promise.resolve(); },
      all: function () { return Promise.resolve(box.entries.map(function (s) { return JSON.parse(s); })); },
      clear: function () { box.entries.length = 0; return Promise.resolve(); },
      bytes: function () { return Promise.resolve(box.entries.reduce(function (n, s) { return n + s.length * 2; }, 0)); }
    };
  }
  function localStore(name, ls) {
    ls = ls || (typeof localStorage !== 'undefined' ? localStorage : null);
    var countKey = name + ':count';
    function count() { try { return parseInt(ls.getItem(countKey), 10) || 0; } catch (e) { return 0; } }
    return {
      kind: 'localStorage',
      append: function (e) {
        return new Promise(function (res, rej) {
          try { var n = count(); ls.setItem(name + ':' + n, JSON.stringify(e)); ls.setItem(countKey, String(n + 1)); res(); }
          catch (err) { rej(err); }
        });
      },
      all: function () {
        var out = [], n = count();
        for (var i = 0; i < n; i++) { try { var s = ls.getItem(name + ':' + i); if (s) out.push(JSON.parse(s)); } catch (e) { /* skip unreadable */ } }
        return Promise.resolve(out);
      },
      clear: function () {
        var n = count();
        try { for (var i = 0; i < n; i++) ls.removeItem(name + ':' + i); ls.removeItem(countKey); } catch (e) { /* ignore */ }
        return Promise.resolve();
      },
      bytes: function () {
        var n = count(), b = 0;
        for (var i = 0; i < n; i++) { try { b += (ls.getItem(name + ':' + i) || '').length * 2; } catch (e) { /* ignore */ } }
        return Promise.resolve(b);
      }
    };
  }
  function idbStore(name) {
    var dbp = null;
    function db() {
      if (!dbp) dbp = new Promise(function (res, rej) {
        var req = indexedDB.open('tempdesk-history', 1);
        req.onupgradeneeded = function () { var d = req.result; if (!d.objectStoreNames.contains('entries')) { var s = d.createObjectStore('entries', { keyPath: 'k', autoIncrement: true }); s.createIndex('log', 'log'); } };
        req.onsuccess = function () { res(req.result); };
        req.onerror = function () { rej(req.error); };
        req.onblocked = function () { rej(new Error('blocked')); };
      });
      return dbp;
    }
    function tx(mode, fn) {
      return db().then(function (d) {
        return new Promise(function (res, rej) {
          var t = d.transaction('entries', mode), out;
          t.oncomplete = function () { res(out); };
          t.onerror = function () { rej(t.error); };
          t.onabort = function () { rej(t.error || new Error('aborted')); };
          out = fn(t.objectStore('entries'), function (v) { out = v; });
        });
      });
    }
    return {
      kind: 'indexedDB',
      ready: function () { return db(); },
      append: function (e) { return tx('readwrite', function (s) { s.add({ log: name, json: JSON.stringify(e) }); }); },
      all: function () {
        return tx('readonly', function (s, set) {
          var rows = [];
          s.index('log').openCursor(IDBKeyRange.only(name)).onsuccess = function (ev) {
            var c = ev.target.result;
            if (c) { rows.push(c.value); c.continue(); } else set(rows.sort(function (a, b) { return a.k - b.k; }).map(function (r) { return JSON.parse(r.json); }));
          };
        });
      },
      clear: function () {
        return tx('readwrite', function (s) {
          s.index('log').openCursor(IDBKeyRange.only(name)).onsuccess = function (ev) { var c = ev.target.result; if (c) { c.delete(); c.continue(); } };
        });
      },
      bytes: function () { return this.all().then(function (a) { return a.reduce(function (n, e) { return n + JSON.stringify(e).length * 2; }, 0); }); }
    };
  }
  // Picks IndexedDB, falls back to localStorage, then memory. Resolves to a store.
  function openStore(name) {
    function tryLocal() {
      try { localStorage.setItem('__td_probe', '1'); localStorage.removeItem('__td_probe'); return localStore(name); }
      catch (e) { return memoryStore(); }
    }
    if (typeof indexedDB === 'undefined') return Promise.resolve(tryLocal());
    var s = idbStore(name);
    return s.ready().then(function () { return s; }, function () { return tryLocal(); });
  }

  // ---- the history engine ---------------------------------------------------------------------
  // opts: { store, initial, redact(state) -> state for storage, coalesceMs (1000), now(), setTimer, clearTimer, onChange }
  function History(opts) {
    this.store = opts.store;
    this.initial = clone(opts.initial);
    this.redact = opts.redact || function (s) { return s; };
    this.coalesceMs = opts.coalesceMs === undefined ? 1000 : opts.coalesceMs;
    this.now = opts.now || function () { return Date.now(); };
    this.setTimer = opts.setTimer || function (fn, ms) { return setTimeout(fn, ms); };
    this.clearTimer = opts.clearTimer || function (t) { clearTimeout(t); };
    this.onChange = opts.onChange || function () {};
    this.entries = [];
    this.pending = null;
    this.timer = null;
    this.writes = Promise.resolve();
    this.state = clone(opts.initial);
  }
  History.prototype.load = function () {
    var self = this;
    return this.store.all().then(function (list) {
      self.entries = list;
      if (!list.length) {
        var e0 = { id: 0, t: self.now(), kind: 'start', msg: { key: 'hist.start' }, state: self.redact(clone(self.initial)), back: null, fwd: null };
        self.entries.push(e0);
        self._persist(e0);
      }
      self.state = clone(self.head().state);
      return self;
    });
  };
  History.prototype.head = function () { return this.entries[this.entries.length - 1]; };
  History.prototype.byId = function (id) { for (var i = this.entries.length - 1; i >= 0; i--) if (this.entries[i].id === id) return this.entries[i]; return null; };
  History.prototype._persist = function (e) {
    var self = this;
    this.writes = this.writes.then(function () { return self.store.append(e); }).catch(function (err) { self.lastError = err; });
    return this.writes;
  };
  History.prototype._append = function (kind, state, msg, back, fwd, extra) {
    var e = { id: this.entries.length ? this.head().id + 1 : 0, t: this.now(), kind: kind, msg: msg, state: this.redact(clone(state)), back: back, fwd: fwd };
    if (extra) for (var k in extra) e[k] = extra[k];
    this.entries.push(e);
    this.state = clone(state);
    this._persist(e);
    this.onChange(e);
    return e;
  };
  // Record a change. msg: { key, args } (rendered by the page) or a plain string.
  // coalesceKey: entries with the same key within coalesceMs merge into one (typing).
  History.prototype.change = function (state, msg, coalesceKey) {
    var self = this;
    if (coalesceKey && this.coalesceMs > 0) {
      if (this.pending && this.pending.key !== coalesceKey) this.flush();
      this.pending = { key: coalesceKey, state: clone(state), msg: msg };
      this.state = clone(state);
      if (this.timer) this.clearTimer(this.timer);
      this.timer = this.setTimer(function () { self.flush(); }, this.coalesceMs);
      return null;
    }
    this.flush();
    return this._append('change', state, msg, this.head().id, null);
  };
  History.prototype.flush = function () {
    if (this.timer) { this.clearTimer(this.timer); this.timer = null; }
    var p = this.pending;
    this.pending = null;
    if (!p) return null;
    if (JSON.stringify(p.state) === JSON.stringify(this.head().state) && !this._redacts()) return null;
    return this._append('change', p.state, p.msg, this.head().id, null, { field: p.key });
  };
  History.prototype._redacts = function () { return false; };
  History.prototype.canUndo = function () { return !!this.pending || this.head().back !== null; };
  History.prototype.canRedo = function () { return !this.pending && this.head().fwd !== null && this.head().fwd !== undefined; };
  History.prototype.undo = function () {
    this.flush();
    var cur = this.head();
    if (cur.back === null) return null;
    var target = this.byId(cur.back);
    return this._append('undo', target.state, { key: 'hist.undo', args: [cur.id] }, target.back, cur.id);
  };
  History.prototype.redo = function () {
    this.flush();
    var cur = this.head();
    if (cur.fwd === null || cur.fwd === undefined) return null;
    var f = this.byId(cur.fwd);
    return this._append('redo', f.state, { key: 'hist.redo', args: [f.id] }, f.back, f.fwd);
  };
  History.prototype.restore = function (id) {
    this.flush();
    var x = this.byId(id);
    if (!x) return null;
    return this._append('restore', x.state, { key: 'hist.restore', args: [x.t] }, this.head().id, null);
  };
  // A labelled snapshot (explicit save, download). Not a state change, but undoable like one.
  History.prototype.mark = function (kind, label) {
    this.flush();
    return this._append(kind, this.state, { key: 'hist.' + kind, args: [label || ''] }, this.head().id, null, { label: label || '' });
  };
  History.prototype.clear = function () {
    var self = this;
    this.flush();
    return this.writes.then(function () { return self.store.clear(); }).then(function () {
      self.entries = [];
      var e0 = { id: 0, t: self.now(), kind: 'start', msg: { key: 'hist.cleared' }, state: self.redact(clone(self.state)), back: null, fwd: null };
      self.entries.push(e0);
      return self._persist(e0);
    });
  };
  History.prototype.settle = function () { return this.writes; };
  History.prototype.exportJson = function (meta) {
    return JSON.stringify({ schema: 'tempdesk-history', version: 1, exported: new Date(this.now()).toISOString(), meta: meta || {}, entries: this.entries }, null, 2) + '\n';
  };

  var api = { History: History, memoryStore: memoryStore, localStore: localStore, idbStore: idbStore, openStore: openStore };
  root.TempDeskHistory = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
