// Applies saved display preferences before first paint (loaded in <head>).
// Storage can be unavailable (private windows, blocked site data): every
// access is wrapped and the page works with defaults.
(function () {
  'use strict';
  var root = document.documentElement;
  function get(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  var theme = get('td.theme');
  if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
  var motion = get('td.motion');
  if (motion === 'full' || motion === 'reduced' || motion === 'off') root.setAttribute('data-motion', motion);
  var text = parseInt(get('td.text') || '', 10);
  if (text >= 90 && text <= 160) root.style.setProperty('--text-scale', String(text / 100));
  var radius = parseInt(get('td.radius') || '', 10);
  if (radius >= 0 && radius <= 150) root.style.setProperty('--radius-scale', String(radius / 100));
  if (get('td.density') === 'compact') root.setAttribute('data-density', 'compact');
  if (get('td.contrast') === 'high') root.setAttribute('data-contrast', 'high');
  if (get('td.focus') === 'always') root.setAttribute('data-focus', 'always');
  var accent = get('td.accent');
  if (accent && /^#[0-9a-fA-F]{6}$/.test(accent)) {
    root.style.setProperty('--primary', accent);
    root.style.setProperty('--primary-hover', accent);
  }
})();
