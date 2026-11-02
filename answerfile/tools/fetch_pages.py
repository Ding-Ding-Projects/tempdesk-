"""Download the Microsoft unattend reference pages used to build unattend-catalog.json.

Usage: python3 -I fetch_pages.py <workdir>
Creates <workdir>/ms (current reference) and <workdir>/old (archived Windows 8.1 reference),
then run extract_pages.py <workdir> and build_catalog.py <workdir> <catalog.json>.
"""
import json, os, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

W = sys.argv[1]
CUR = 'https://learn.microsoft.com/en-us/windows-hardware/customize/desktop/unattend/'
OLD = 'https://learn.microsoft.com/en-us/previous-versions/windows/it-pro/windows-8.1-and-8/'
# components documented only in the archived reference
LEGACY = {'Microsoft-Windows-AllUserInstallAgent', 'Microsoft-Windows-ehome-reg-inf', 'Microsoft-Windows-MigrationWizardApplication',
          'Microsoft-Windows-PerfCenterCPL', 'Microsoft-Windows-Security-Licensing-SLC', 'Microsoft-Windows-Security-Licensing-SLCC',
          'Microsoft-Windows-Security-Licensing-SLC-UX', 'Microsoft-Windows-Sidebar', 'Microsoft-Windows-Store-Client-UI',
          'Microsoft-Windows-SystemSettings', 'UDDI-Setup'}

def get(url, path):
    if os.path.exists(path) and os.path.getsize(path):
        return
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                data = r.read()
            with open(path, 'wb') as f:
                f.write(data)
            return
        except Exception as e:  # noqa: BLE001
            if attempt == 3:
                print('FAIL', url, e)
            time.sleep(2 * (attempt + 1))

def hrefs(nodes, out):
    for n in nodes:
        if n.get('href'):
            out.append(n['href'])
        hrefs(n.get('children', []), out)
    return out

def find_components(nodes):
    for c in nodes:
        if c.get('toc_title') == 'Components':
            return c
        r = find_components(c.get('children', []))
        if r:
            return r

for sub in ('ms/pages', 'old/pages'):
    os.makedirs(os.path.join(W, sub), exist_ok=True)
get(CUR + 'toc.json', os.path.join(W, 'ms/toc.json'))
get(OLD + 'toc.json', os.path.join(W, 'old/toc.json'))
cur = json.load(open(os.path.join(W, 'ms/toc.json')))['items'][0]['children'][4]['children']
old = find_components(json.load(open(os.path.join(W, 'old/toc.json')))['items'])['children']

jobs = [(CUR + h, os.path.join(W, 'ms/pages', h + '.html')) for h in hrefs(cur, [])]
# Gaming-Configuration is linked from the components index but missing from the TOC
for h in ['microsoft-windows-gaming-configuration'] + ['microsoft-windows-gaming-configuration-' + x for x in
          ('gaminghomeapp', 'oemapppathsandname1', 'oemapppathsandname2', 'oemapppathsandname3', 'oemgamebarwidget', 'startuptogaminghome')]:
    jobs.append((CUR + h, os.path.join(W, 'ms/pages', h + '.html')))

legacy = [c for c in old if c['toc_title'] in LEGACY]
json.dump(legacy, open(os.path.join(W, 'old/legacy-toc.json'), 'w'), indent=1)
jobs += [(OLD + h, os.path.join(W, 'old/pages', h + '.html')) for h in hrefs(legacy, [])]

# settings the archive documents for components that are still current, but the current reference dropped
def paths(n, p=''):
    out = {}
    for c in n.get('children', []):
        q = p + '/' + c['toc_title'].strip()
        out[q.lower()] = (q, c['href'])
        out.update(paths(c, q))
    return out
curby = {c['toc_title'].lower(): c for c in cur}
extra = {}
for c in old:
    k = c['toc_title'].lower()
    if k in curby:
        a, b = paths(c), paths(curby[k])
        d = [a[x] for x in a if x not in b]
        if d:
            extra[c['toc_title']] = d
json.dump(extra, open(os.path.join(W, 'old/extra.json'), 'w'), indent=1)
jobs += [(OLD + h, os.path.join(W, 'old/pages', h + '.html')) for v in extra.values() for _, h in v]

with ThreadPoolExecutor(12) as ex:
    list(ex.map(lambda j: get(*j), jobs))
print('pages requested', len(jobs))
