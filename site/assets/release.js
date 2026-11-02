// Asks the GitHub API for the latest TempDesk release and shows its version and date.
// Shows a truthful "No release yet" state (and hides the download button) when there is none.
(function () {
  'use strict';
  var API = 'https://api.github.com/repos/Ding-Ding-Projects/tempdesk-/releases/latest';
  var line = document.getElementById('release-line');
  var btn = document.getElementById('release-btn');
  if (!line || !btn) return;
  var S = window.TempDeskSite;
  var state = { key: 'release.checking', args: null };
  function show() {
    line.setAttribute('data-i18n', state.key);
    if (state.args) line.setAttribute('data-i18n-args', state.args.join('|')); else line.removeAttribute('data-i18n-args');
    if (S) S.render(line);
  }
  if (S) S.onLang(show);
  function fmtDate(iso) {
    try { return new Date(iso).toLocaleDateString(document.documentElement.lang === 'zh-HK' ? 'zh-HK' : 'en', { year: 'numeric', month: 'short', day: 'numeric' }); }
    catch (e) { return iso.slice(0, 10); }
  }
  var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 10000);
  fetch(API, { headers: { Accept: 'application/vnd.github+json' }, signal: ctl ? ctl.signal : undefined })
    .then(function (r) {
      clearTimeout(timer);
      if (r.status === 404) { state = { key: 'release.none' }; show(); return null; }
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    })
    .then(function (rel) {
      if (!rel) return;
      var asset = (rel.assets || []).filter(function (a) { return a.name === 'Setup.exe'; })[0];
      if (!asset) { state = { key: 'release.noAsset', args: [rel.tag_name || rel.name || ''] }; show(); return; }
      btn.hidden = false;
      btn.href = asset.browser_download_url || btn.href;
      state = { key: 'release.latest', args: [rel.tag_name || rel.name || '', fmtDate(rel.published_at || rel.created_at || '')] };
      show();
    })
    .catch(function () {
      clearTimeout(timer);
      // Unknown (offline or rate limited): do not offer a link that might be dead; the releases page link stays.
      state = { key: 'release.unknown' }; show();
    });
})();
