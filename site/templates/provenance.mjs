import { execFileSync } from 'node:child_process';

export function hostedProvenance(root) {
  const { GITHUB_SHA: revision, GITHUB_RUN_NUMBER: run, GITHUB_RUN_ATTEMPT: attempt } = process.env;
  if (!/^[a-f0-9]{40}$/.test(revision || '') || !/^[1-9]\d*$/.test(run || '') || !/^[1-9]\d*$/.test(attempt || '')) return {};
  const git = args => execFileSync('git', args, {cwd: root, encoding: 'utf8', stdio: ['ignore','pipe','pipe']}).trim();
  if (git(['rev-parse','HEAD']) !== revision || git(['status','--porcelain','--untracked-files=all'])) {
    throw new Error('Website build inputs differ from the declared workflow revision');
  }
  return {version: run + '.' + attempt, revision, updatedUtc: new Date().toISOString()};
}

export function renderProvenance(data, escape) {
  const missing = '<span data-i18n="provenance.unavailable">Unavailable</span>';
  const version = /^[0-9]+(?:\.[0-9]+){1,2}$/.test(data.version || '') ? escape(data.version) : missing;
  const revision = /^[a-f0-9]{40}$/.test(data.revision || '') ? '<code>' + data.revision + '</code>' : missing;
  const stamp = data.updatedUtc;
  const valid = typeof stamp === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(stamp) && Number.isFinite(Date.parse(stamp));
  const updated = valid ? '<time data-build-time datetime="' + stamp + '">' + stamp.slice(0,19).replace('T',' ') + ' UTC</time>' : missing;
  return `<div class="build-provenance"><span><b data-i18n="provenance.version">Running version</b> ${version}</span> <span><b data-i18n="provenance.updated">Build updated</b> ${updated}</span> <span><b data-i18n="provenance.revision">Source revision</b> ${revision}</span></div>`;
}
