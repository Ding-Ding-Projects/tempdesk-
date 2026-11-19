/* Resolve public catalogue identities and published photo links on demand. */
(function (root) {
  'use strict';

  const repository = 'Ding-Ding-Projects/dim-sum-photos';
  const catalogUrl = 'https://raw.githubusercontent.com/' + repository + '/main/catalog/index.json';
  const releaseApi = 'https://api.github.com/repos/' + repository + '/releases';
  const photoBase = 'https://github.com/' + repository + '/releases/download/';
  const timeoutMs = 12000;
  const cacheMs = 5 * 60 * 1000;
  const catalogLimit = 12 * 1024 * 1024;
  const releasePageLimit = 8 * 1024 * 1024;
  const dishId = /^hk-dish-\d{4,8}$/;
  const photoName = /^(hk-dish-\d{4,8})-[a-z0-9][a-z0-9-]{0,200}\.png$/;
  const catalogTag = /^catalog-v1[a-zA-Z0-9._-]{0,60}$/;
  const dimSumCategory = /(?:^|[- ])dim[- ]sum$/i;
  let namesCache;
  let photosCache;

  function cleanName(value) {
    return typeof value === 'string' && value.length <= 200 && value.trim() === value &&
      value.length > 0 && !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value);
  }

  async function fetchJson(url, maxBytes, signal) {
    const response = await root.fetch(url, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
      signal,
    });
    if (!response.ok || !response.body) throw new Error('Public catalogue response is unavailable.');
    const reportedSize = Number(response.headers.get('Content-Length'));
    if (reportedSize > maxBytes) {
      void response.body.cancel().catch(() => {});
      throw new Error('Public catalogue response exceeds its size limit.');
    }

    const stream = response.body.getReader();
    const decoder = new TextDecoder();
    let size = 0;
    let json = '';
    try {
      for (;;) {
        const part = await stream.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > maxBytes) {
          void stream.cancel().catch(() => {});
          throw new Error('Public catalogue response exceeds its size limit.');
        }
        json += decoder.decode(part.value, { stream: true });
      }
      return JSON.parse(json + decoder.decode());
    } finally {
      stream.releaseLock();
    }
  }

  async function getNames(signal) {
    if (namesCache && Date.now() < namesCache.expires) return namesCache.value;
    const catalog = await fetchJson(catalogUrl, catalogLimit, signal);
    if (!Array.isArray(catalog?.dishes) || catalog.dishes.length > 10000) throw new Error('Invalid public catalogue.');
    const names = new Map();
    const duplicates = new Set();
    for (const entry of catalog.dishes) {
      if (typeof entry?.id !== 'string' || !dishId.test(entry.id) ||
          !cleanName(entry.name?.en) || !cleanName(entry.name?.zhHant)) continue;
      if (names.has(entry.id)) duplicates.add(entry.id);
      const path = typeof entry.image?.path === 'string' ? entry.image.path : '';
      const filename = path.startsWith('images/') ? path.slice(7) : '';
      const match = photoName.exec(filename);
      names.set(entry.id, {
        id: entry.id,
        english: entry.name.en,
        cantonese: entry.name.zhHant,
        filename: match?.[1] === entry.id ? filename : null,
        isDimSum: typeof entry.category === 'string' && dimSumCategory.test(entry.category),
      });
    }
    for (const duplicate of duplicates) names.delete(duplicate);
    if (!signal.aborted) namesCache = { value: names, expires: Date.now() + cacheMs };
    return names;
  }

  async function getPhotos(signal) {
    if (photosCache && Date.now() < photosCache.expires) return photosCache.value;
    const photos = new Map();
    for (let page = 1; page <= 3; page++) {
      const releases = await fetchJson(releaseApi + '?per_page=100&page=' + page, releasePageLimit, signal);
      if (!Array.isArray(releases) || releases.length > 100) throw new Error('Invalid release inventory.');
      for (const release of releases) {
        const tag = release?.tag_name;
        if (typeof tag !== 'string' || !catalogTag.test(tag) || release.draft !== false ||
            release.prerelease !== false || !Number.isFinite(Date.parse(release.published_at)) ||
            !Array.isArray(release.assets) || release.assets.length > 1000) continue;
        for (const asset of release.assets) {
          if (typeof asset?.name !== 'string' || !photoName.test(asset.name) ||
              asset.state !== 'uploaded' || !Number.isSafeInteger(asset.size) || asset.size <= 0) continue;
          const expected = photoBase + tag + '/' + asset.name;
          if (asset.browser_download_url === expected && !photos.has(asset.name)) photos.set(asset.name, expected);
        }
      }
      if (releases.length < 100) break;
    }
    if (!signal.aborted) photosCache = { value: photos, expires: Date.now() + cacheMs };
    return photos;
  }

  async function pick(options = {}) {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) return null;
    const { id, signal } = options;
    if (id !== undefined && (typeof id !== 'string' || !dishId.test(id))) return null;
    if (signal !== undefined && (typeof root.AbortSignal !== 'function' || !(signal instanceof root.AbortSignal))) return null;
    if (signal?.aborted || typeof root.fetch !== 'function') return null;

    const controller = new root.AbortController();
    const abort = () => controller.abort();
    const timer = root.setTimeout(abort, timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const [names, photos] = await Promise.all([
        getNames(controller.signal).catch(() => null),
        getPhotos(controller.signal).catch(() => null),
      ]);
      if (!names || signal?.aborted) return null;
      let selected;
      if (id !== undefined) {
        selected = names.get(id);
      } else if (photos) {
        const choices = Array.from(names.values()).filter((entry) => entry.isDimSum && photos.has(entry.filename));
        selected = choices[Math.floor(Math.random() * choices.length)];
      }
      if (!selected) return null;
      return {
        id: selected.id,
        english: selected.english,
        cantonese: selected.cantonese,
        photoUrl: photos?.get(selected.filename) ?? null,
      };
    } finally {
      root.clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }

  const api = Object.freeze({ pick });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TempDeskDimSumCatalog = api;
})(globalThis);
