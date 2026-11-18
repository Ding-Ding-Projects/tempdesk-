export function capabilityReader(inventory, docs, catalog, escape) {
  const routes = new Map(docs.map(doc => [doc.file, doc.name + '.html']));
  const label = key => `<span data-i18n="reader.${key}">${escape(catalog['reader.' + key])}</span>`;
  const option = (key, value) => `<option value="${value}" data-i18n="reader.${key}">${escape(catalog['reader.' + key])}</option>`;
  const surfaces = inventory.surfaces.map(s => option(s.id, s.id)).join('');
  const destinations = {
    deployer: 'deployer/README.md', management: 'portal/FEATURES.md', guest: 'portal/README.md',
    kiosk: 'docs/VIRTUAL-COMMONS.md', hosted: 'README.md', offline: 'docs/OFFLINE-GUIDE.md',
    delivery: 'docs/features/release-pipeline/README.md',
  };
  const cards = inventory.features.map(feature => {
    const scope = inventory.scopes[feature.scope];
    const applicable = new Set(scope.appliesTo);
    const rows = inventory.surfaces.map(s => {
      const evidence = feature.progress?.[s.id];
      const state = applicable.has(s.id) ? evidence?.state || 'pending' : 'outside';
      const route = routes.get(destinations[s.id]);
      let details = '';
      if (evidence) {
        details = `<p>${escape(evidence.observation)}</p>${evidence.remaining ? `<p>${label('remaining')} ${escape(evidence.remaining)}</p>` : ''}
          <p>${escape(evidence.method)} · <code>${escape(evidence.revision)}</code> · ${escape(evidence.reference)}</p>`;
      } else if (state === 'outside') {
        details = `<p>${escape(scope.outside)}</p>`;
      } else {
        details = `<p>${label('noEvidence')}</p>`;
      }
      return `<section data-reader-surface="${s.id}" data-reader-state="${state}"><h3>${label(s.id)} · ${label(state)}</h3>${details}
        ${route && state !== 'outside' ? `<a href="${escape(route)}">${label('workflow')} · ${label(s.id)}</a>` : ''}</section>`;
    }).join('');
    const title = feature.id.replaceAll('-', ' ').replace(/^./, c => c.toUpperCase());
    return `<details class="reader-card" id="cap-${feature.id}"><summary>${escape(title)}</summary><code>${feature.id}</code>${rows}</details>`;
  }).join('');
  return `<article class="content capability-reader"><a href="index.html#guided-workflows">${label('back')}</a>
    <h1>${label('title')}</h1><p>${label('lead')}</p>
    <label>${label('search')} <input type="search" id="reader-query" autocomplete="off"></label>
    <label>${label('surface')} <select id="reader-surface">${option('all','')}${surfaces}</select></label>
    <label>${label('state')} <select id="reader-state">${option('all','')}${['verified','partial','pending','outside'].map(s=>option(s,s)).join('')}</select></label>
    <p role="status" id="reader-count"></p>${cards}</article>`;
}
