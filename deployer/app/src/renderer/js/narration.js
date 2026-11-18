import { h, state, onNotify } from './ui.js';

const storageKey = 'tempdesk.narration.v1';
const defaults = { enabled: false, reader: false, mode: 'en', en: '', 'zh-HK': '', rate: 1, pitch: 1 };
let prefs = { ...defaults };
try { Object.assign(prefs, JSON.parse(localStorage.getItem(storageKey)) || {}); } catch {}
const engine = window.speechSynthesis;
let generation = 0;
let speaking = false;
const pending = [];
const recent = new Map();

function voices(lang) {
  return (engine?.getVoices() || []).filter(v => v.localService &&
    (lang === 'en' ? /^en(?:-|$)/i : /^(?:zh-HK|yue(?:-Hant)?-HK)(?:-|$)/i).test(v.lang.replaceAll('_', '-')));
}
function effective(lang) {
  const choices = voices(lang);
  return choices.find(v => v.voiceURI === prefs[lang]) || choices.find(v => v.default) || choices[0];
}
function stop() {
  generation++;
  pending.length = 0;
  speaking = false;
  engine?.cancel();
}
function next() {
  if (speaking || !pending.length || !prefs.enabled || prefs.reader) return;
  const { lang, text } = pending.shift();
  const voice = effective(lang);
  if (!voice) { queueMicrotask(next); return; }
  const id = generation;
  const line = new SpeechSynthesisUtterance(text);
  line.voice = voice;
  line.lang = voice.lang;
  line.rate = prefs.rate;
  line.pitch = prefs.pitch;
  speaking = true;
  const finished = () => {
    if (generation !== id) return;
    speaking = false;
    next();
  };
  line.onend = finished;
  line.onerror = finished;
  try { engine.speak(line); } catch { finished(); }
}
onNotify(() => {
  const record = state.notifications[0];
  const app = window.TempDeskApp;
  if (!record || !app || !engine || !prefs.enabled || prefs.reader) return;
  const urgent = ['error', 'warning', 'warn'].includes(record.kind);
  const now = performance.now();
  if (!urgent && now - (recent.get(record.kind) ?? -Infinity) < 1500) return;
  if (!urgent && pending.length >= 8) return;
  recent.set(record.kind, now);
  const tracks = state.school.enabled ? ['en'] : prefs.mode === 'both' ? ['en', 'zh-HK'] : [prefs.mode];
  for (const lang of tracks) {
    const translate = window.TempDeskCore.makeTranslator({
      mode: lang, funny: state.school.enabled ? 0 : app.settings.funny,
      wording: state.school.enabled ? null : app.wording,
      catalogs: record.catalogue === 'studio' ? app.studioCatalogs : app.catalogs
    });
    // A literal message has no second-language rendition to speak.
    if (typeof record.message === 'string' && lang !== (state.school.enabled ? 'en' : app.settings.language === 'zh-HK' ? 'zh-HK' : 'en')) continue;
    const text = window.TempDeskWording.renderNotice(record.message, translate);
    if (text && effective(lang)) pending.push({ lang, text });
  }
  next();
});

let unregister = () => {};
export function narrationControls() {
  unregister();
  const language = state.school.enabled ? 'en' : state.settings.language;
  const label = (en, zh) => language === 'zh-HK' ? zh : language === 'bilingual' ? en + ' / ' + zh : en;
  const box = h('fieldset', { class: 'field set-row', 'data-row': 'narration', 'data-keywords': 'voice speech narration cantonese' });
  box.dataset.palette = label('Spoken notifications', '語音通知');
  box.append(h('legend', { text: box.dataset.palette }), h('p', { class: 'help', text: label('Read notifications using voices installed on this computer.', '使用本機已安裝的語音朗讀通知。') }));
  if (!engine) {
    box.append(h('p', { text: label('Speech is unavailable on this computer.', '此電腦無法播放語音。') }));
    return box;
  }
  function save(key, value) {
    prefs[key] = value;
    try { localStorage.setItem(storageKey, JSON.stringify(prefs)); } catch {}
    stop();
  }
  function add(name, control) { box.append(h('label', { class: 'field' }, [name, control])); }
  for (const [key, title] of [['enabled', label('Read new notifications aloud', '朗讀新通知')], ['reader', label('Pause narration for a screen reader', '使用讀屏器時暫停朗讀')]]) {
    const input = h('input', { type: 'checkbox', checked: prefs[key] });
    input.onchange = () => save(key, input.checked);
    add(title, input);
  }
  const select = h('select');
  for (const [value, name] of [['en', 'English'], ['zh-HK', '廣東話'], ['both', label('English then Cantonese', '英文後讀廣東話')]]) select.add(new Option(name, value));
  select.value = prefs.mode;
  select.onchange = () => save('mode', select.value);
  add(label('Spoken language', '朗讀語言'), select);
  const updates = [];
  for (const lang of ['en', 'zh-HK']) {
    const picker = h('select');
    const status = h('small', { role: 'status' });
    add(lang === 'en' ? label('English voice', '英文語音') : label('Hong Kong Cantonese voice', '香港廣東話語音'), picker);
    box.append(status);
    const refresh = () => {
      picker.replaceChildren(new Option(label('Choose automatically', '自動選擇'), ''));
      const installed = voices(lang);
      for (const v of installed) picker.add(new Option(v.name, v.voiceURI));
      if (prefs[lang] && !installed.some(v => v.voiceURI === prefs[lang])) picker.add(new Option(label('Saved voice unavailable', '已儲存的語音無法使用'), prefs[lang]));
      picker.value = prefs[lang];
      status.textContent = effective(lang)?.name || label('No local voice installed for this language.', '未安裝此語言的本機語音。');
    };
    picker.onchange = () => { save(lang, picker.value); refresh(); };
    updates.push(refresh);
  }
  for (const [key, title, min, max] of [['rate', label('Speed', '速度'), 0.1, 10], ['pitch', label('Pitch', '音調'), 0, 2]]) {
    const input = h('input', { type: 'range', min, max, step: 0.1, value: prefs[key] });
    input.onchange = () => save(key, Number(input.value));
    add(title, input);
  }
  const update = () => updates.forEach(refresh => refresh());
  update();
  engine.addEventListener('voiceschanged', update);
  unregister = () => engine.removeEventListener('voiceschanged', update);
  return box;
}
