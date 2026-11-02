#!/usr/bin/env node
// Builds the TempDesk website into site/_site/ (gitignored). No dependencies.
//   node site/build.mjs
// - copies the static site (pages, assets, i18n)
// - renders feature articles from features.json into features/<id>.html
// - renders docs/*.md and component README.md files into docs/<name>.html (own Markdown renderer)
// - copies the TempDesk payload into payload/ with manifest.json (relative paths and SHA-256)
// - copies answerfile/unattend-catalog.json and answerfile/generate.mjs when they exist
// - writes search-index.json for the command palette and the docs search
import { createHash } from 'node:crypto';
import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(SITE, '..');
const OUT = path.join(SITE, '_site');
const BASE_URL = 'https://ding-ding-projects.github.io/tempdesk-/';

// ---------------------------------------------------------------------------------------------
// Markdown renderer (CommonMark subset: headings, paragraphs, lists, code, tables, quotes, links)
// ---------------------------------------------------------------------------------------------
export function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
export function slugify(text, used) {
  let s = String(text).toLowerCase().replace(/<[^>]+>/g, '').replace(/[`*_~]/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s/g, '-');
  if (!s) s = 'section';
  if (used) { let n = s, i = 1; while (used.has(n)) n = s + '-' + (i++); used.add(n); s = n; }
  return s;
}
function safeUrl(u) {
  const s = String(u).trim();
  if (/^(javascript|vbscript|data):/i.test(s)) return '#';
  return s;
}
export function inline(text, linkMap) {
  const codes = [];
  let s = String(text).replace(/`([^`]+)`/g, (m, c) => { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000'; });
  s = escapeHtml(s);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (m, alt, url) => `<img src="${escapeHtml(safeUrl(url))}" alt="${alt}" loading="lazy">`);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (m, label, url) => {
    let href = safeUrl(url.replace(/&amp;/g, '&'));
    if (linkMap) href = linkMap(href);
    const ext = /^https?:/i.test(href) ? ' rel="noopener"' : '';
    return `<a href="${escapeHtml(href)}"${ext}>${label}</a>`;
  });
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (m, pre, url) => `${pre}<a href="${url}" rel="noopener">${url}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^\w*])\*([^*\s][^*]*)\*(?!\w)/g, '$1<em>$2</em>').replace(/(^|[^\w])_([^_\s][^_]*)_(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/\u0000(\d+)\u0000/g, (m, i) => '<code>' + escapeHtml(codes[Number(i)]) + '</code>');
  return s;
}
export function renderMarkdown(md, opts = {}) {
  const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
  const used = new Set();
  const headings = [];
  const out = [];
  let i = 0;
  const isBlank = (l) => /^\s*$/.test(l);
  const listRe = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  function table(start) {
    const rows = [];
    let j = start;
    while (j < lines.length && /^\s*\|.*\|\s*$/.test(lines[j])) { rows.push(lines[j]); j++; }
    if (rows.length < 2 || !/^\s*\|[\s:|-]+\|\s*$/.test(rows[1])) return null;
    const cells = (r) => r.trim().slice(1, -1).split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
    const head = cells(rows[0]);
    let html = '<div class="tablebox" tabindex="0"><table><thead><tr>' + head.map((c) => '<th>' + inline(c, opts.linkMap) + '</th>').join('') + '</tr></thead><tbody>';
    rows.slice(2).forEach((r) => { html += '<tr>' + cells(r).map((c) => '<td>' + inline(c, opts.linkMap) + '</td>').join('') + '</tr>'; });
    return { html: html + '</tbody></table></div>', next: j };
  }
  function list(start) {
    // collects a list block including nested items and continuation lines
    const base = listRe.exec(lines[start]);
    const indent = base[1].length;
    const ordered = /\d/.test(base[2]);
    const items = [];
    let j = start;
    while (j < lines.length) {
      const m = listRe.exec(lines[j]);
      if (m && m[1].length === indent && /\d/.test(m[2]) === ordered) { items.push([m[3]]); j++; continue; }
      if (isBlank(lines[j])) {
        const nx = lines[j + 1];
        if (nx !== undefined && (listRe.test(nx) && listRe.exec(nx)[1].length >= indent || /^\s{2,}\S/.test(nx) && nx.search(/\S/) > indent)) { items[items.length - 1].push(''); j++; continue; }
        break;
      }
      if (lines[j].search(/\S/) > indent || (m && m[1].length > indent)) { items[items.length - 1].push(lines[j].slice(Math.min(lines[j].search(/\S/), indent + (ordered ? 3 : 2)))); j++; continue; }
      if (!m && !isBlank(lines[j]) && !/^(#{1,6}\s|```|\s*>|\s*\|)/.test(lines[j])) { items[items.length - 1].push(lines[j].trim()); j++; continue; }
      break;
    }
    const startNum = ordered ? parseInt(base[2], 10) : 1;
    const html = (ordered ? `<ol${startNum !== 1 ? ` start="${startNum}"` : ''}>` : '<ul>') + items.map((it) => {
      const body = it.join('\n');
      const inner = renderMarkdown(body, Object.assign({}, opts, { nested: true, used })).html;
      return '<li>' + (it.length === 1 || !/\n\s*\n/.test(body) ? inner.replace(/^<p>([\s\S]*?)<\/p>/, '$1') : inner) + '</li>';
    }).join('') + (ordered ? '</ol>' : '</ul>');
    return { html, next: j };
  }
  while (i < lines.length) {
    const l = lines[i];
    if (isBlank(l)) { i++; continue; }
    let m;
    if ((m = /^(\s*)(```+|~~~+)\s*([\w+-]*)/.exec(l))) {
      const fence = m[2], lang = m[3];
      const body = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence)) { body.push(lines[i].slice(Math.min(m[1].length, lines[i].search(/\S|$/)))); i++; }
      i++;
      out.push(`<pre tabindex="0"><code${lang ? ` class="language-${escapeHtml(lang)}"` : ''}>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }
    if ((m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l))) {
      const level = Math.min(6, m[1].length + (opts.shift || 0));
      const id = slugify(m[2], opts.used || used);
      headings.push({ level: m[1].length, id, text: m[2].replace(/[`*]/g, '') });
      out.push(`<h${level} id="${id}">${inline(m[2], opts.linkMap)}</h${level}>`);
      i++; continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { out.push('<hr>'); i++; continue; }
    if (/^\s*>/.test(l)) {
      const body = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) { body.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      out.push('<blockquote>' + renderMarkdown(body.join('\n'), Object.assign({}, opts, { used })).html + '</blockquote>');
      continue;
    }
    if (/^\s*\|/.test(l)) { const tb = table(i); if (tb) { out.push(tb.html); i = tb.next; continue; } }
    if (listRe.test(l)) { const ls = list(i); out.push(ls.html); i = ls.next; continue; }
    const para = [];
    while (i < lines.length && !isBlank(lines[i]) && !/^(#{1,6}\s|```|~~~|\s*>)/.test(lines[i]) && !listRe.test(lines[i]) && !(/^\s*\|/.test(lines[i]) && table(i))) { para.push(lines[i].trim()); i++; }
    if (para.length) out.push('<p>' + inline(para.join(' '), opts.linkMap).replace(/ {2,}$/gm, '<br>') + '</p>');
    else i++;
  }
  return { html: out.join('\n'), headings };
}
export function plainText(md) {
  return String(md).replace(/```[\s\S]*?```/g, ' ').replace(/`([^`]*)`/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[#>*_|]/g, ' ').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------------------------
async function rmrf(p) { await fs.rm(p, { recursive: true, force: true }); }
async function mkdirp(p) { await fs.mkdir(p, { recursive: true }); }
async function copyFile(src, dst) { await mkdirp(path.dirname(dst)); await fs.copyFile(src, dst); }
async function walk(dir, filter, base = dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    const rel = path.relative(base, full).split(path.sep).join('/');
    if (!filter(rel, ent)) continue;
    if (ent.isDirectory()) out.push(...await walk(full, filter, base));
    else if (ent.isFile()) out.push(rel);
  }
  return out.sort();
}
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// Payload exclusions: tests, caches, environment files, dependencies and build output.
export function payloadAllowed(rel, isDir) {
  const parts = rel.split('/');
  const name = parts[parts.length - 1];
  if (parts.some((p) => ['tests', 'test', '__pycache__', 'node_modules', '.pytest_cache', '.git', 'bin', 'obj', '.venv', 'venv'].includes(p))) return false;
  if (/^\.env(\..*)?$/i.test(name) || name === '.env') return false;
  if (!isDir && (/\.(pyc|pyo|log|iso|pfx|key|pem)$/i.test(name) || /^test_.*\.py$/.test(name) || /\.test\.(m?js|ps1)$/i.test(name) || /\.Tests\.ps1$/i.test(name))) return false;
  if (name === '.DS_Store' || name === 'Thumbs.db') return false;
  return true;
}
const PAYLOAD_DIRS = ['server', 'agent', 'client', 'portal'];

// ---------------------------------------------------------------------------------------------
// Page layout
// ---------------------------------------------------------------------------------------------
let LAYOUT = '';
function page({ title, desc, root, url, body, extraHead = '', extraScripts = '', titleKey = '' }) {
  return LAYOUT.replaceAll('{{TITLE}}', escapeHtml(title)).replaceAll('{{DESC}}', escapeHtml(desc)).replaceAll('{{ROOT}}', root)
    .replaceAll('{{URL}}', url).replace('{{BODY}}', body).replace('{{EXTRA_HEAD}}', extraHead).replace('{{EXTRA_SCRIPTS}}', extraScripts).replaceAll('{{TITLE_KEY}}', titleKey);
}

// Docs sources: docs/*.md plus every component README.md (not tests, not caches).
async function docSources() {
  const list = [];
  const used = new Set();
  const add = (file, name, title) => { let n = name, k = 2; while (used.has(n)) n = name + '-' + (k++); used.add(n); list.push({ file, name: n, title }); };
  if (existsSync(path.join(REPO, 'README.md'))) add('README.md', 'overview', 'Overview');
  for (const f of await walk(path.join(REPO, 'docs'), (rel, e) => e.isDirectory() || /\.md$/i.test(rel))) add('docs/' + f, f.replace(/\.md$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-'), null);
  const readmes = await walk(REPO, (rel, e) => {
    const parts = rel.split('/');
    if (parts.some((p) => p.startsWith('.') || ['node_modules', '__pycache__', 'tests', 'site', 'docs', '_site', 'bin', 'obj'].includes(p))) return false;
    return e.isDirectory() || /(^|\/)README\.md$/i.test(rel);
  });
  for (const f of readmes) {
    if (f.toLowerCase() === 'readme.md') continue;
    const dir = f.split('/').slice(0, -1);
    add(f, dir[dir.length - 1].toLowerCase().replace(/[^a-z0-9]+/g, '-'), null);
  }
  return list;
}

async function build() {
  LAYOUT = await fs.readFile(path.join(SITE, 'templates', 'layout.html'), 'utf8');
  await rmrf(OUT);
  await mkdirp(OUT);
  const index = { generated: new Date().toISOString(), pages: [] };

  // 1. static files
  const STATIC_SKIP = new Set(['_site', 'node_modules', 'tests', 'templates', 'build.mjs', 'features.json', 'package.json', 'package-lock.json', 'README.md', 'payload', '.gitignore']);
  const statics = await walk(SITE, (rel, e) => !STATIC_SKIP.has(rel.split('/')[0]) && !rel.split('/').some((p) => p.startsWith('.')) && !(e.isFile() && /\.(py|mjs\.map)$/.test(rel)));
  for (const f of statics) await copyFile(path.join(SITE, f), path.join(OUT, f));
  await fs.writeFile(path.join(OUT, '.nojekyll'), '');

  // 2. features
  const features = JSON.parse(await fs.readFile(path.join(SITE, 'features.json'), 'utf8')).features;
  const seen = new Set();
  for (const ft of features) {
    if (!/^[a-z0-9-]+$/.test(ft.id) || seen.has(ft.id)) throw new Error('Bad or duplicate feature id: ' + ft.id);
    seen.add(ft.id);
    const usedIds = new Set();
    const fixLink = (href) => (/^(https?:|#|mailto:)/.test(href) ? href : '../' + href);
    const secs = ft.sections.map((s) => {
      const id = slugify(s.title, usedIds);
      return { id, title: s.title, html: `<section id="${id}" data-palette="${escapeHtml(s.title)}"><h2>${inline(s.title)}</h2>\n${renderMarkdown(s.body, { linkMap: fixLink, used: usedIds }).html}</section>` };
    });
    const facts = (ft.facts || []).map(([k, v]) => `<div class="fact"><b>${inline(k)}</b><span>${inline(v)}</span></div>`).join('');
    const links = (ft.links || []).map(([label, href]) => `<a class="btn btn-ghost" href="${escapeHtml(fixLink(href))}">${escapeHtml(label)}</a>`).join('');
    const others = features.filter((o) => o.id !== ft.id).map((o) => `<a class="hit" href="${o.id}.html">${escapeHtml(o.title)}<small>${escapeHtml(o.summary)}</small></a>`).join('');
    const body = `<article class="content">
<nav class="crumbs" aria-label="Breadcrumb"><a href="../" data-i18n="nav.home">Home</a><span aria-hidden="true">/</span><a href="../#features" data-i18n="nav.features">Features</a><span aria-hidden="true">/</span><span>${escapeHtml(ft.title)}</span></nav>
<h1>${escapeHtml(ft.title)}</h1>
<p class="lede">${inline(ft.summary)}</p>
<div class="facts">${facts}</div>
${secs.map((s) => s.html).join('\n')}
${links ? `<div class="cta" style="margin-top:28px">${links}</div>` : ''}
<h2 id="more-features" data-i18n="feat.more">More features</h2>
<div class="hits">${others}</div>
</article>`;
    await mkdirp(path.join(OUT, 'features'));
    await fs.writeFile(path.join(OUT, 'features', ft.id + '.html'), page({ title: ft.title + ' | TempDesk', desc: ft.summary, root: '../', url: 'features/' + ft.id + '.html', body }));
    index.pages.push({ url: 'features/' + ft.id + '.html', title: ft.title, summary: ft.summary, kind: 'feature', sections: secs.map((s) => ({ id: s.id, title: s.title })), text: plainText(ft.sections.map((s) => s.title + ' ' + s.body).join(' ')) });
  }
  // feature list on the landing page
  const tiles = features.map((ft) => `<a class="tile" href="features/${ft.id}.html"><h3>${escapeHtml(ft.title)}</h3><p>${escapeHtml(ft.summary)}</p><span class="more" data-i18n="common.readMore">Read more</span></a>`).join('\n      ');
  const home = await fs.readFile(path.join(OUT, 'index.html'), 'utf8');
  await fs.writeFile(path.join(OUT, 'index.html'), home.replace('<!-- filled by build.mjs -->', tiles));
  index.pages.unshift({ url: 'index.html', title: 'Home', summary: 'TempDesk: shared computers, disposable sign-ins.', kind: 'page', sections: [{ id: 'how', title: 'How it works' }, { id: 'deploy', title: 'Pick your domain controller' }, { id: 'download', title: 'Download the Deployer' }, { id: 'tools', title: 'Tools that run in your browser' }, { id: 'features', title: 'Every feature, explained' }] });
  index.pages.push({ url: 'answer-file.html', title: 'Answer file builder', summary: 'Build autounattend.xml in your browser.', kind: 'tool', sections: [] });

  // 3. tools/base64.html
  const b64body = await fs.readFile(path.join(SITE, 'templates', 'base64-body.html'), 'utf8');
  await mkdirp(path.join(OUT, 'tools'));
  await fs.writeFile(path.join(OUT, 'tools', 'base64.html'), page({ title: 'Base64 toolkit | TempDesk', desc: 'Encode and decode Base64 text and files of any size in your browser, with verified output. Nothing is uploaded.', root: '../', url: 'tools/base64.html', body: b64body,
    extraHead: '<link rel="stylesheet" href="../assets/builder.css">\n', extraScripts: '<script src="../assets/base64.js"></script>\n<script src="../assets/zip.js"></script>\n<script src="../assets/history.js"></script>\n<script src="../assets/base64-page.js"></script>\n', titleKey: 'b64.title' }));
  index.pages.push({ url: 'tools/base64.html', title: 'Base64 toolkit', summary: 'Encode and decode text and files locally.', kind: 'tool', sections: [{ id: 'b64-options', title: 'Options' }, { id: 'b64-text', title: 'Text and data: URLs' }, { id: 'b64-files', title: 'Files of any size' }, { id: 'b64-history', title: 'History' }] });

  // 4. docs
  const docs = await docSources();
  const byFile = new Map(docs.map((d) => [d.file.toLowerCase(), d]));
  const docPages = [];
  for (const d of docs) {
    const md = await fs.readFile(path.join(REPO, d.file), 'utf8');
    const dir = path.posix.dirname(d.file);
    const linkMap = (href) => {
      if (/^(https?:|#|mailto:)/.test(href)) return href;
      const [p, hash] = href.split('#');
      const target = path.posix.normalize(path.posix.join(dir, p)).replace(/^\.\//, '');
      const hit = byFile.get(target.toLowerCase()) || byFile.get((target + '/README.md').toLowerCase());
      if (hit) return hit.name + '.html' + (hash ? '#' + hash : '');
      return 'https://github.com/Ding-Ding-Projects/tempdesk-/blob/main/' + target + (hash ? '#' + hash : '');
    };
    const r = renderMarkdown(md, { linkMap });
    const h1 = r.headings.find((x) => x.level === 1);
    d.title = d.title || (h1 ? h1.text : d.name);
    docPages.push({ d, r, md });
  }
  const nav = (cur) => `<nav class="docs-nav" aria-label="Docs"><a href="index.html"${cur === 'index' ? ' aria-current="page"' : ''} data-i18n="docs.home">All docs</a>${docs.map((d) => `<a href="${d.name}.html"${cur === d.name ? ' aria-current="page"' : ''}>${escapeHtml(d.title)}</a>`).join('')}</nav>`;
  await mkdirp(path.join(OUT, 'docs'));
  for (const { d, r, md } of docPages) {
    const toc = r.headings.filter((x) => x.level === 2).map((x) => `<a class="hit" href="#${x.id}">${escapeHtml(x.text)}</a>`).join('');
    const body = `<div class="docs-layout">${nav(d.name)}<div class="docs-main"><article class="content">
<nav class="crumbs" aria-label="Breadcrumb"><a href="../" data-i18n="nav.home">Home</a><span aria-hidden="true">/</span><a href="index.html" data-i18n="nav.docs">Docs</a></nav>
${toc ? `<details style="margin:12px 0"><summary style="min-height:44px;display:flex;align-items:center;cursor:pointer;font-weight:700" data-i18n="docs.toc">On this page</summary><div class="hits">${toc}</div></details>` : ''}
${r.html}
<p class="meter-label" style="margin-top:40px">Source: <a href="https://github.com/Ding-Ding-Projects/tempdesk-/blob/main/${d.file}">${escapeHtml(d.file)}</a></p>
</article></div></div>`;
    await fs.writeFile(path.join(OUT, 'docs', d.name + '.html'), page({ title: d.title + ' | TempDesk docs', desc: plainText(md).slice(0, 180), root: '../', url: 'docs/' + d.name + '.html', body }));
    index.pages.push({ url: 'docs/' + d.name + '.html', title: d.title, summary: 'Docs: ' + d.file, kind: 'doc', sections: r.headings.filter((x) => x.level <= 3 && x.level > 1).map((x) => ({ id: x.id, title: x.text })), text: plainText(md) });
  }
  const docsIndexBody = `<div class="docs-layout">${nav('index')}<div class="docs-main"><div class="content">
<nav class="crumbs" aria-label="Breadcrumb"><a href="../" data-i18n="nav.home">Home</a><span aria-hidden="true">/</span><span data-i18n="nav.docs">Docs</span></nav>
<h1 data-i18n="docs.title">Documentation</h1>
<p class="lede" data-i18n="docs.lead">Guides and reference for every TempDesk component, built from the files in the repository.</p>
<section id="docs-search" data-palette="Search the docs">
<h2 data-i18n="docs.search">Search the docs</h2>
<div class="searchrow"><input type="search" id="docs-q" data-i18n-attr="placeholder:docs.searchPh;aria-label:docs.search" placeholder="Search all docs" aria-label="Search the docs" autocomplete="off"><button type="button" class="iconbtn regex-toggle" id="docs-re" aria-pressed="false" data-i18n-attr="aria-label:search.regex;title:search.regex" aria-label="Regular expression" title="Regular expression">.*</button></div>
<p class="meter-label" id="docs-count" aria-live="polite"></p>
<div class="hits" id="docs-hits"></div>
</section>
<h2 id="all-docs" data-i18n="docs.all">All documents</h2>
<div class="hits">${docs.map((d) => `<a class="hit" href="${d.name}.html">${escapeHtml(d.title)}<small>${escapeHtml(d.file)}</small></a>`).join('')}</div>
</div></div></div>`;
  await fs.writeFile(path.join(OUT, 'docs', 'index.html'), page({ title: 'Documentation | TempDesk', desc: 'Guides and reference for every TempDesk component.', root: '../', url: 'docs/', body: docsIndexBody, extraScripts: '<script src="../assets/docs-search.js"></script>\n', titleKey: 'docs.title' }));
  index.pages.push({ url: 'docs/index.html', title: 'Documentation', summary: 'All docs', kind: 'page', sections: [{ id: 'docs-search', title: 'Search the docs' }] });

  // 5. payload
  const manifest = { schema: 'tempdesk-payload', version: 1, generated: new Date().toISOString(), files: [] };
  for (const top of PAYLOAD_DIRS) {
    const files = await walk(path.join(REPO, top), (rel, e) => payloadAllowed(top + '/' + rel, e.isDirectory()));
    for (const rel of files) {
      const repoRel = top + '/' + rel;
      const buf = await fs.readFile(path.join(REPO, repoRel));
      await copyFile(path.join(REPO, repoRel), path.join(OUT, 'payload', repoRel));
      manifest.files.push({ path: repoRel, size: buf.length, sha256: sha256(buf) });
    }
  }
  await fs.writeFile(path.join(OUT, 'payload', 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  // 6. answer file catalog and generator (owned by answerfile/)
  const af = [];
  for (const f of ['unattend-catalog.json', 'generate.mjs']) {
    const src = path.join(REPO, 'answerfile', f);
    if (existsSync(src)) { await copyFile(src, path.join(OUT, 'answerfile', f)); af.push(f); }
  }

  // 7. search index, sitemap, robots
  await fs.writeFile(path.join(OUT, 'search-index.json'), JSON.stringify(index) + '\n');
  const urls = index.pages.map((p) => BASE_URL + p.url.replace(/index\.html$/, ''));
  await fs.writeFile(path.join(OUT, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls.map((u) => `  <url><loc>${escapeHtml(u)}</loc></url>`).join('\n') + '\n</urlset>\n');
  await fs.writeFile(path.join(OUT, 'robots.txt'), 'User-agent: *\nAllow: /\nSitemap: ' + BASE_URL + 'sitemap.xml\n');
  await fs.writeFile(path.join(OUT, '404.html'), page({ title: 'Page not found | TempDesk', desc: 'This page does not exist.', root: '/tempdesk-/', url: '404.html', body: '<div class="content"><h1 data-i18n="nf.title">Page not found</h1><p class="lede" data-i18n="nf.body">This page does not exist. Try the command palette (Ctrl+Shift+F) or go home.</p><a class="btn btn-primary" href="/tempdesk-/" data-i18n="nav.home">Home</a></div>' }));

  return { features: features.length, docs: docs.length, payload: manifest.files.length, answerfile: af, pages: index.pages.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  build().then((r) => {
    console.log(`Built site/_site: ${r.pages} indexed pages, ${r.features} feature articles, ${r.docs} docs, ${r.payload} payload files` + (r.answerfile.length ? `, answerfile: ${r.answerfile.join(', ')}` : ', answerfile catalog not present yet (builder uses its built-in core subset)'));
  }).catch((e) => { console.error(e); process.exit(1); });
}
export { build };
