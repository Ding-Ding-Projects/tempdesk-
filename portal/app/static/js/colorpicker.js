// Accessible HSV color picker: a hue ring drawn on canvas around a
// saturation/value square, with hex and RGB inputs. Keyboard: Tab to the
// ring or square, arrow keys adjust (Shift for larger steps), Home/End jump.
// Usage: <div data-colorpicker data-target="#input-id"></div>; the target
// input receives the hex value and an "input" event on every change.
(function () {
  'use strict';
  var doc = document;
  var t = (window.TD && window.TD.t) || function (k) { return k; };

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function hsvToRgb(h, s, v) {
    var c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c, r, g, b;
    if (h < 60) { r = c; g = x; b = 0; } else if (h < 120) { r = x; g = c; b = 0; } else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; } else if (h < 300) { r = x; g = 0; b = c; } else { r = c; g = 0; b = x; }
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  }
  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, h = 0;
    if (d) { if (mx === r) h = 60 * (((g - b) / d) % 6); else if (mx === g) h = 60 * ((b - r) / d + 2); else h = 60 * ((r - g) / d + 4); }
    if (h < 0) h += 360;
    return [h, mx ? d / mx : 0, mx];
  }
  function toHex(rgb) { return '#' + rgb.map(function (v) { return v.toString(16).padStart(2, '0'); }).join('').toUpperCase(); }
  function fromHex(hex) { var m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim()); if (!m) return null; var n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
  function lum(rgb) { var c = rgb.map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
  function contrast(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  window.TDColor = { hsvToRgb: hsvToRgb, rgbToHsv: rgbToHsv, toHex: toHex, fromHex: fromHex, contrast: contrast };

  function build(host) {
    var target = doc.querySelector(host.getAttribute('data-target'));
    var size = 220, ring = 22, inner = size / 2 - ring - 6, sq = Math.floor(inner * Math.SQRT2) - 4;
    var state = { h: 174, s: 0.49, v: 0.95 };
    var start = fromHex(target && target.value) || [124, 243, 230];
    var hsv = rgbToHsv(start[0], start[1], start[2]); state = { h: hsv[0], s: hsv[1], v: hsv[2] };

    host.classList.add('colorpicker');
    var wrap = doc.createElement('div'); wrap.className = 'cp-wheel'; wrap.style.width = wrap.style.height = size + 'px';
    var cv = doc.createElement('canvas'); cv.width = cv.height = size * 2; cv.style.width = cv.style.height = size + 'px'; cv.setAttribute('aria-hidden', 'true');
    var hueKnob = doc.createElement('div'); hueKnob.className = 'cp-knob'; hueKnob.tabIndex = 0;
    hueKnob.setAttribute('role', 'slider'); hueKnob.setAttribute('aria-label', t('Hue')); hueKnob.setAttribute('aria-valuemin', '0'); hueKnob.setAttribute('aria-valuemax', '359');
    var sv = doc.createElement('div'); sv.className = 'cp-square'; sv.tabIndex = 0;
    sv.setAttribute('role', 'slider'); sv.setAttribute('aria-label', t('Saturation and brightness'));
    sv.style.width = sv.style.height = sq + 'px'; sv.style.left = sv.style.top = (size - sq) / 2 + 'px';
    var svKnob = doc.createElement('div'); svKnob.className = 'cp-knob small'; sv.appendChild(svKnob);
    wrap.appendChild(cv); wrap.appendChild(sv); wrap.appendChild(hueKnob);

    var fields = doc.createElement('div'); fields.className = 'cp-fields';
    function field(label, attrs) {
      var f = doc.createElement('label'); f.className = 'cp-field';
      var s = doc.createElement('span'); s.textContent = label; f.appendChild(s);
      var i = doc.createElement('input'); Object.keys(attrs).forEach(function (k) { i.setAttribute(k, attrs[k]); }); f.appendChild(i);
      fields.appendChild(f); return i;
    }
    var hexIn = field('Hex', { type: 'text', maxlength: '7', spellcheck: 'false', class: 'mono' });
    var rIn = field(t('Red'), { type: 'number', min: '0', max: '255', inputmode: 'numeric' });
    var gIn = field(t('Green'), { type: 'number', min: '0', max: '255', inputmode: 'numeric' });
    var bIn = field(t('Blue'), { type: 'number', min: '0', max: '255', inputmode: 'numeric' });
    var swatch = doc.createElement('div'); swatch.className = 'cp-swatch'; swatch.setAttribute('aria-hidden', 'true');
    var report = doc.createElement('p'); report.className = 'hint'; report.setAttribute('aria-live', 'polite');
    host.appendChild(wrap); host.appendChild(fields); host.appendChild(swatch); host.appendChild(report);

    var ctx = cv.getContext('2d');
    function drawRing() {
      var c = size, r1 = c - 12, r0 = r1 - ring * 2;
      ctx.clearRect(0, 0, c * 2, c * 2);
      for (var a = 0; a < 360; a += 1) {
        ctx.beginPath(); ctx.strokeStyle = 'hsl(' + a + ',100%,50%)'; ctx.lineWidth = ring * 2;
        ctx.arc(c, c, (r0 + r1) / 2, (a - 91) * Math.PI / 180, (a - 89) * Math.PI / 180); ctx.stroke();
      }
    }
    function ground() {
      var g = getComputedStyle(doc.documentElement).getPropertyValue('--ground').trim();
      return fromHex(g) || [11, 17, 16];
    }
    function render(fromInputs) {
      var rgb = hsvToRgb(state.h, state.s, state.v), hex = toHex(rgb);
      var ang = (state.h - 90) * Math.PI / 180, rad = size / 2 - 6 - ring / 2;
      hueKnob.style.left = (size / 2 + Math.cos(ang) * rad) + 'px'; hueKnob.style.top = (size / 2 + Math.sin(ang) * rad) + 'px';
      hueKnob.style.background = 'hsl(' + Math.round(state.h) + ',100%,50%)';
      hueKnob.setAttribute('aria-valuenow', String(Math.round(state.h))); hueKnob.setAttribute('aria-valuetext', Math.round(state.h) + ' degrees');
      var pure = hsvToRgb(state.h, 1, 1);
      sv.style.background = 'linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, rgb(' + pure.join(',') + '))';
      svKnob.style.left = (state.s * sq) + 'px'; svKnob.style.top = ((1 - state.v) * sq) + 'px'; svKnob.style.background = hex;
      sv.setAttribute('aria-valuetext', 'saturation ' + Math.round(state.s * 100) + ' percent, brightness ' + Math.round(state.v * 100) + ' percent');
      if (fromInputs !== 'hex') hexIn.value = hex;
      if (fromInputs !== 'rgb') { rIn.value = rgb[0]; gIn.value = rgb[1]; bIn.value = rgb[2]; }
      swatch.style.background = hex;
      var ratio = contrast(rgb, ground());
      report.textContent = ratio >= 4.5 ? t('Contrast {ratio}:1 passes').replace('{ratio}', ratio.toFixed(1)) : t('Contrast {ratio}:1 is too low for text').replace('{ratio}', ratio.toFixed(1));
      report.className = ratio >= 4.5 ? 'hint' : 'error-text';
      if (target) { target.value = hex.toLowerCase(); target.dispatchEvent(new Event('input', { bubbles: true })); }
    }
    function pointer(el, onMove) {
      el.addEventListener('pointerdown', function (e) {
        e.preventDefault(); el.setPointerCapture(e.pointerId); onMove(e); el.focus();
        function mv(ev) { onMove(ev); }
        function up() { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); }
        el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
      });
    }
    pointer(cv, function (e) {
      var r = cv.getBoundingClientRect(), x = e.clientX - r.left - size / 2, y = e.clientY - r.top - size / 2;
      state.h = (Math.atan2(y, x) * 180 / Math.PI + 90 + 360) % 360; render();
    });
    pointer(sv, function (e) {
      var r = sv.getBoundingClientRect();
      state.s = clamp((e.clientX - r.left) / sq, 0, 1); state.v = clamp(1 - (e.clientY - r.top) / sq, 0, 1); render();
    });
    hueKnob.addEventListener('keydown', function (e) {
      var step = e.shiftKey ? 15 : 1, k = e.key;
      if (k === 'ArrowRight' || k === 'ArrowUp') state.h = (state.h + step) % 360;
      else if (k === 'ArrowLeft' || k === 'ArrowDown') state.h = (state.h - step + 360) % 360;
      else if (k === 'Home') state.h = 0; else if (k === 'End') state.h = 359; else return;
      e.preventDefault(); render();
    });
    sv.addEventListener('keydown', function (e) {
      var step = e.shiftKey ? 0.1 : 0.01, k = e.key;
      if (k === 'ArrowRight') state.s = clamp(state.s + step, 0, 1); else if (k === 'ArrowLeft') state.s = clamp(state.s - step, 0, 1);
      else if (k === 'ArrowUp') state.v = clamp(state.v + step, 0, 1); else if (k === 'ArrowDown') state.v = clamp(state.v - step, 0, 1);
      else if (k === 'Home') { state.s = 0; state.v = 1; } else if (k === 'End') { state.s = 1; state.v = 0; } else return;
      e.preventDefault(); render();
    });
    hexIn.addEventListener('input', function () {
      var v = hexIn.value.trim(); if (v && v[0] !== '#') v = '#' + v;
      var rgb = fromHex(v); hexIn.setAttribute('aria-invalid', rgb ? 'false' : 'true'); if (!rgb) return;
      var h = rgbToHsv(rgb[0], rgb[1], rgb[2]); state = { h: h[0], s: h[1], v: h[2] }; render('hex');
    });
    [rIn, gIn, bIn].forEach(function (i) {
      i.addEventListener('input', function () {
        var rgb = [rIn, gIn, bIn].map(function (x) { return clamp(parseInt(x.value, 10) || 0, 0, 255); });
        var h = rgbToHsv(rgb[0], rgb[1], rgb[2]); state = { h: h[0], s: h[1], v: h[2] }; render('rgb');
      });
    });
    host.setColor = function (hex) { var rgb = fromHex(hex); if (!rgb) return; var h = rgbToHsv(rgb[0], rgb[1], rgb[2]); state = { h: h[0], s: h[1], v: h[2] }; render(); };
    drawRing(); render('init');
  }
  Array.prototype.forEach.call(doc.querySelectorAll('[data-colorpicker]'), build);
})();
