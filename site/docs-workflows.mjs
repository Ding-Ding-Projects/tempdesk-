const tasks = [
  {
    id: 'deploy',
    options: 'directory',
    variants: [
      {
        id: 'server',
        filter: 'docs-guide-steps-deploy-server',
        steps: ['media', 'setup', 'health'],
        links: [
          ['quickStart', 'README.md', 'quick-start'],
          ['serverManagement', 'docs/SERVER.md'],
        ],
      },
      {
        id: 'samba',
        filter: 'docs-guide-steps-deploy-samba',
        steps: ['host', 'deploy', 'health'],
        links: [
          ['sambaGuide', 'samba/README.md'],
          ['portalGuide', 'portal/README.md'],
        ],
      },
    ],
  },
  {
    id: 'guest',
    variants: [
      {
        id: 'kiosk',
        filter: 'docs-guide-steps-guest-kiosk',
        steps: ['duration', 'confirmation', 'check'],
        links: [['guestWalkthrough', 'README.md', 'guest-sign-in-walkthrough']],
      },
    ],
  },
  {
    id: 'commons',
    options: 'sessionHost',
    variants: [
      {
        id: 'desktop',
        filter: 'docs-guide-steps-commons-desktop',
        steps: ['host', 'checkout', 'expiry'],
        links: [
          ['appHost', 'server/apphost/README.md'],
          ['configure', 'docs/VIRTUAL-COMMONS.md', 'configure-the-destinations'],
          ['verify', 'docs/VIRTUAL-COMMONS.md', 'verify-a-checkout'],
        ],
      },
      {
        id: 'workstation',
        filter: 'docs-guide-steps-commons-workstation',
        steps: ['network', 'media', 'firmware', 'domain', 'broker', 'download', 'session', 'release'],
        links: [
          ['workstation', 'server/kiosk/README.md'],
          ['configureSeat', 'docs/VIRTUAL-COMMONS.md', 'add-a-kiosk-windows-11-workstation'],
          ['verify', 'docs/VIRTUAL-COMMONS.md', 'verify-a-checkout'],
        ],
      },
      {
        id: 'core',
        filter: 'docs-guide-steps-commons-core',
        steps: ['role', 'guest', 'expiry'],
        links: [
          ['configure', 'docs/VIRTUAL-COMMONS.md', 'configure-the-destinations'],
          ['verify', 'docs/VIRTUAL-COMMONS.md', 'verify-a-checkout'],
        ],
      },
    ],
  },
];

export function relatedDocumentationWorkflows(file, catalog, escape) {
  const links = tasks.flatMap(task => task.variants.filter(variant =>
    variant.links.some(([, source]) => source === file)).map(variant => {
    const label = catalog['docs.guide.' + task.id + '.' + variant.id + '.title'];
    const key = 'docs.guide.' + task.id + '.' + variant.id + '.title';
    return `<a class="hit" href="index.html?task=${task.id}&amp;variant=${variant.id}#guided-workflows" data-i18n="${key}">${escape(label)}</a>`;
  }));
  if (!links.length) return '';
  return `<section><h2 data-i18n="docs.guide.heading">${escape(catalog['docs.guide.heading'])}</h2><div class="hits">${links.join('')}</div></section>`;
}

export function renderDocumentationWorkflows(docPages, catalogs, escape) {
  const articles = new Map(docPages.map(page => [page.d.file, page]));
  function copy(key, tag = 'span') {
    const id = 'docs.guide.' + key;
    const text = catalogs[0][id];
    if (!catalogs.every(catalog => typeof catalog[id] === 'string' && catalog[id].trim())) {
      throw new Error('Missing guided documentation translation: ' + id);
    }
    return `<${tag} data-i18n="${id}">${escape(text)}</${tag}>`;
  }
  function link([label, file, anchor]) {
    const page = articles.get(file);
    if (!page || (anchor && !page.r.headings.some(heading => heading.id === anchor))) {
      throw new Error('Unresolved guided documentation link: ' + file + (anchor ? '#' + anchor : ''));
    }
    const href = page.d.name + '.html' + (anchor ? '#' + anchor : '');
    return `<a href="${href}">${copy('link.' + label)}</a>`;
  }
  function radio(name, value, key, checked) {
    return `<label class="guide-choice"><input type="radio" name="${name}" value="${value}"${checked ? ' checked' : ''}><span class="guide-choice-text">${copy(key)}</span></label>`;
  }
  const taskChoices = tasks.map((task, index) => radio('guide-task', task.id, task.id + '.title', index === 0));
  const variants = tasks.filter(task => task.options).map(task => `
<fieldset data-guide-variants="${task.id}" hidden>
  <legend>${copy(task.options)}</legend>
  <div class="guide-variant-options">${task.variants.map((option, index) =>
    radio('guide-' + task.id, option.id, task.id + '.' + option.id + '.title', index === 0)).join('')}</div>
</fieldset>`);
  const panels = tasks.flatMap(task => task.variants.map(option => {
    const prefix = task.id + '.' + option.id;
    return `
<section class="guide-panel" data-guide-task="${task.id}" data-guide-variant="${option.id}">
  ${copy(prefix + '.title', 'h3')}
  <p class="guide-summary">${copy(prefix + '.summary')}</p>
  <ol class="guide-steps" data-search-surface="${option.filter}" data-search-items=".guide-step" data-search-label="docs.guide.steps">
    ${option.steps.map(step => `<li class="guide-step"><label><input type="checkbox" value="${step}" hidden>${copy(prefix + '.' + step)}</label></li>`).join('')}
  </ol>
  <div class="guide-links">${option.links.map(link).join('')}</div>
</section>`;
  }));
  return `
<section id="guided-workflows" class="docs-workflow" data-guided-docs>
  ${copy('heading', 'h2')}
  ${copy('intro', 'p')}
  <div class="guide-sheet">
    <fieldset data-guide-task-controls hidden>
      <legend>${copy('task')}</legend>
      <div class="guide-task-options">${taskChoices.join('')}</div>
    </fieldset>
    <div>
      ${variants.join('')}
      <p class="guide-status" data-guide-status role="status" hidden></p>
      <p class="guide-status" data-guide-volatile hidden>${copy('temporary')}</p>
      ${panels.join('')}
    </div>
  </div>
</section>`;
}
