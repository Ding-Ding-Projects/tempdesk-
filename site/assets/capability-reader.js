(() => {
  const reader = document.querySelector('.capability-reader');
  const query = document.getElementById('reader-query');
  const surface = document.getElementById('reader-surface');
  const state = document.getElementById('reader-state');
  const count = document.getElementById('reader-count');
  const cards = [...reader.querySelectorAll('.reader-card')];
  const site = window.TempDeskSite;
  const regex = window.TempDeskRegex;
  let builder;
  function draw() {
    const candidates = [];
    for (const card of cards) {
      const rows = [...card.querySelectorAll('[data-reader-state]')];
      for (const row of rows) {
        row.hidden = !!((surface.value && row.dataset.readerSurface !== surface.value) ||
          (state.value && row.dataset.readerState !== state.value));
      }
      const visible = rows.filter(row => !row.hidden);
      if (visible.length) candidates.push({card, text: [card.id, card.querySelector('summary').textContent,
        ...visible.map(row => row.textContent)].join(' ')});
    }
    const result = regex.filterItems(candidates, item => item.text, builder?.state || {query:query.value});
    const hits = new Set(result.ok && !result.slow ? result.items.map(item => item.card) : []);
    for (const card of cards) card.hidden = !hits.has(card);
    count.textContent = !result.ok ? site.t('palette.badRegex') : result.slow ? site.t('reader.slow') : site.t('docs.results', [hits.size]);
  }
  builder = regex.attachRegexBuilder(query, {
    t: (key, ...args) => site.t(key, args, key),
    sampleProvider: () => cards.slice(0,40).map(card => card.querySelector('summary').textContent).join('\n'),
    onChange: draw,
  });
  surface.addEventListener('change', draw);
  state.addEventListener('change', draw);
  site.onLang(draw);
  draw();
})();
