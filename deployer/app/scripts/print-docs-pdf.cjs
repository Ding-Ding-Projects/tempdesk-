'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { app, BrowserWindow, protocol, session } = require('electron');

const scheme = 'tempdesk-print';
const host = 'book';
const bookUrl = scheme + '://' + host + '/book.html';
const images = new Map([
  ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'], ['.gif', 'image/gif'],
]);
const policy = "default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'";
protocol.registerSchemesAsPrivileged([{ scheme, privileges: { standard: true, secure: true } }]);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-background-networking');

function ownsUrl(url) {
  const parsed = URL.parse(url);
  return parsed?.protocol === scheme + ':' && parsed.host === host && !parsed.username && !parsed.password;
}

function inDirectory(root, target) {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

// Runs in the sandboxed Chromium renderer. Source HTML comes from site/build.mjs.
async function populateBook({ edition, labels, info, origin }) {
  const publicRoot = new URL(edition.publicUrl);
  const routes = new Map();
  const groups = new Map([['doc', []], ['feature', []], ['wiki', []]]);
  const rejected = [];
  let internalLinks = 0;
  let onlineImages = 0;

  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const link = (text, href) => {
    const node = element('a', text);
    node.setAttribute('href', href);
    return node;
  };
  const outside = (url) => {
    const name = url.hostname.toLowerCase();
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.port &&
      name.includes('.') && !name.endsWith('.local') && !name.endsWith('.localhost') &&
      !name.endsWith('.test') && !/^[0-9.]+$/.test(name) && !name.startsWith('[');
  };
  const projectPath = (url) => url.origin === publicRoot.origin && url.pathname.startsWith(publicRoot.pathname)
    ? url.pathname.slice(publicRoot.pathname.length) : null;

  for (const article of edition.articles) {
    if (!groups.has(article.kind) || !/^(?:docs|features)\/[a-z0-9-]+\.html$/.test(article.url) ||
        routes.has(article.url)) throw new Error('Invalid article inventory');
    const id = 'chapter-' + (routes.size + 1);
    const template = document.createElement('template');
    template.innerHTML = article.html;
    const content = template.content;
    content.querySelectorAll('script,iframe,object,embed,form,base,link,style,svg,audio,video,input,button').forEach(node => node.remove());
    for (const disclosure of content.querySelectorAll('details')) disclosure.open = true;
    const anchors = new Map();
    for (const node of content.querySelectorAll('[id]')) {
      if (anchors.has(node.id)) throw new Error('Duplicate section in ' + article.url);
      const section = id + '-section-' + (anchors.size + 1);
      anchors.set(node.id, section);
      node.id = section;
    }
    for (const node of content.querySelectorAll('*')) {
      for (const attr of [...node.attributes]) {
        if (attr.name.startsWith('on') || ['target', 'download', 'srcset', 'tabindex'].includes(attr.name)) {
          node.removeAttribute(attr.name);
        }
      }
    }
    const firstHeading = content.querySelector('h1');
    for (const heading of content.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
      const sameTitle = heading === firstHeading && heading.textContent.trim() === article.title.trim();
      const level = Math.min(6, Math.max(3, Number(heading.localName[1]) + 1));
      const replacement = element(sameTitle ? 'span' : 'h' + level);
      if (heading.id) replacement.id = heading.id;
      if (!sameTitle) replacement.append(...heading.childNodes);
      heading.replaceWith(replacement);
    }
    const entry = { ...article, id, anchors, content };
    routes.set(entry.url, entry);
    groups.get(entry.kind).push(entry);
  }

  for (const { url, content } of routes.values()) {
    const base = new URL(url, publicRoot);
    for (const node of content.querySelectorAll('a[href]')) {
      const href = URL.parse(node.getAttribute('href'), base);
      if (!href) { node.removeAttribute('href'); continue; }
      const destination = routes.get(projectPath(href));
      if (destination) {
        const section = href.hash ? destination.anchors.get(decodeURIComponent(href.hash.slice(1))) : destination.id;
        if (!section) {
          rejected.push(url + ' → ' + destination.url + href.hash);
          node.removeAttribute('href');
        } else {
          node.setAttribute('href', '#' + section);
          internalLinks++;
        }
      } else if (outside(href)) {
        node.setAttribute('href', href.href);
      } else {
        node.removeAttribute('href');
      }
    }
    for (const node of content.querySelectorAll('img')) {
      const image = URL.parse(node.getAttribute('src'), base);
      if (!image) throw new Error('Invalid image in ' + url);
      const local = projectPath(image);
      if (local !== null && local !== '') {
        node.src = origin + '/' + local;
        node.loading = 'eager';
      } else {
        const replacement = element('span', node.alt);
        if (outside(image)) {
          if (node.alt) replacement.append(' ');
          replacement.append(link(labels['docs.pdf.image'], image.href));
          onlineImages++;
        }
        node.replaceWith(replacement);
      }
    }
  }
  if (rejected.length) throw new Error('Unresolved article links: ' + rejected.slice(0, 12).join(', '));

  document.title = labels['docs.pdf.title'];
  const main = element('main');
  const title = element('h1', labels['docs.pdf.title']);
  const meta = element('p', info.version, 'edition-meta');
  meta.append(' · ', element('code', info.modified ? labels['docs.pdf.local'] : info.commit));
  const table = element('nav');
  table.id = 'contents';
  table.setAttribute('aria-label', labels['docs.pdf.contents']);
  for (const [kind, group] of groups) {
    if (!group.length) continue;
    const items = element('ul', '', 'contents-list');
    for (const chapter of group) {
      const item = element('li');
      item.append(link(chapter.title, '#' + chapter.id));
      items.append(item);
    }
    table.append(element('p', labels['docs.pdf.' + kind], 'contents-group'), items);
  }
  main.append(title, meta, element('h2', labels['docs.pdf.contents']), table);
  for (const group of groups.values()) {
    for (const { id, title: heading, lang, content, source } of group) {
      const chapter = element('article', '', 'chapter');
      chapter.id = id;
      chapter.lang = lang;
      const chapterLinks = element('p', '', 'chapter-links');
      chapterLinks.append(link(labels['docs.pdf.contents'], '#contents'));
      const publicSource = source && URL.parse(source);
      if (publicSource && outside(publicSource)) chapterLinks.append(link(labels['docs.pdf.source'], source));
      const body = element('div', '', 'article-body');
      body.append(content);
      chapter.append(element('h2', heading), chapterLinks, body);
      main.append(chapter);
    }
  }
  document.body.replaceChildren(main);
  await document.fonts.ready;
  const pictures = [...document.images];
  await Promise.all(pictures.map(async picture => {
    try {
      await picture.decode();
    } catch {
      throw new Error('Unavailable staged image: ' + new URL(picture.src).pathname);
    }
  }));
  return {
    chapters: routes.size, sectionAnchors: [...routes.values()].reduce((total, item) => total + item.anchors.size, 0),
    internalLinks, images: pictures.length, onlineImages,
  };
}

async function main() {
  if (!process.argv[2] || !path.isAbsolute(process.argv[2])) throw new Error('The isolated print options path is required');
  app.setPath('userData', path.join(path.dirname(process.argv[2]), 'pdf-profile'));
  const options = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
  await app.whenReady();
  const root = await fs.realpath(options.website);
  const style = await fs.readFile(options.style, 'utf8');
  const printSession = session.fromPartition('tempdesk-documentation-pdf');
  const blocked = new Set();
  printSession.webRequest.onBeforeRequest(({ url }, reply) => {
    const cancel = !ownsUrl(url);
    if (cancel) blocked.add(URL.parse(url)?.protocol || '(invalid)');
    reply({ cancel });
  });
  printSession.protocol.handle(scheme, async request => {
    if (!ownsUrl(request.url) || request.method !== 'GET') return new Response(null, { status: 400 });
    const url = new URL(request.url);
    let route;
    try { route = decodeURIComponent(url.pathname); } catch { return new Response(null, { status: 400 }); }
    if (url.search) return new Response(null, { status: 400 });
    if (route === '/book.html') {
      const html = '<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8">' +
        '<link rel="stylesheet" href="/assets/site.css"><link rel="stylesheet" href="/phone-edition.css">' +
        '</head><body></body></html>';
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': policy } });
    }
    if (route === '/phone-edition.css') return new Response(style, { headers: { 'Content-Type': 'text/css' } });
    const mime = route === '/assets/site.css' ? 'text/css' : images.get(path.extname(route).toLowerCase());
    const candidate = path.resolve(root, '.' + route);
    if (!mime || !inDirectory(root, candidate)) return new Response(null, { status: 404 });
    try {
      const local = await fs.realpath(candidate);
      if (!inDirectory(root, local) || !(await fs.stat(local)).isFile()) return new Response(null, { status: 404 });
      return new Response(await fs.readFile(local), { headers: { 'Content-Type': mime } });
    } catch (error) {
      if (error.code === 'ENOENT') return new Response(null, { status: 404 });
      throw error;
    }
  });

  const window = new BrowserWindow({
    show: false,
    webPreferences: { session: printSession, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  try {
    await window.loadURL(bookUrl);
    const input = { edition: options.edition, labels: options.labels, info: options.info, origin: scheme + '://' + host };
    const proof = await window.webContents.executeJavaScript('(' + populateBook.toString() + ')(' + JSON.stringify(input) + ')');
    if (blocked.size || proof.chapters !== options.edition.articles.length) throw new Error('The isolated document did not match its article inventory');
    const pdf = await window.webContents.printToPDF({
      printBackground: true, preferCSSPageSize: true, generateTaggedPDF: true, generateDocumentOutline: true,
    });
    if (pdf.length < 2048 || pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error('The documentation PDF is invalid');
    await fs.writeFile(options.output, pdf, { flag: 'wx' });
    console.log('Built the phone PDF with ' + proof.chapters + ' complete articles and ' + proof.internalLinks + ' cross-references.');
  } finally {
    window.destroy();
  }
}

const deadline = setTimeout(() => {
  console.error('Phone PDF rendering exceeded its build deadline.');
  app.exit(1);
}, 150000);
main().then(() => { clearTimeout(deadline); app.exit(0); }, error => {
  clearTimeout(deadline);
  console.error(error.message);
  app.exit(1);
});
