"""Extract structured facts from downloaded Microsoft Learn unattend pages into raw.json.
Usage: python3 -I extract_pages.py <dir containing ms/ and old/>
"""
import re, html, json, sys, os

D = sys.argv[1]

def clean(s):
    s = re.sub(r'<br\s*/?>', ' ', s)
    s = re.sub(r'<[^>]+>', ' ', s)
    s = html.unescape(s).replace('\xa0', ' ')
    return re.sub(r'\s+', ' ', s).strip()

def content_of(t):
    i = t.find('id="center-doc-outline"')
    if i < 0:
        i = 0
    m = re.compile(r'<div class="content">(.*?)<div\s+id="ms--inline-notifications"', re.S).search(t, i)
    return m.group(1) if m else None

def sections(c):
    parts = re.split(r'<h2 id="([^"]+)"[^>]*>.*?</h2>', c, flags=re.S)
    secs = {}
    for i in range(1, len(parts), 2):
        secs[parts[i]] = secs.get(parts[i], '') + parts[i + 1]
    return parts[0], secs

def rows(tbl):
    out = []
    for tr in re.findall(r'<tr[^>]*>(.*?)</tr>', tbl, re.S):
        if '<th' in tr:
            continue
        tds = re.findall(r'<td[^>]*>(.*?)</td>', tr, re.S)
        if not tds:
            continue
        first = tds[0]
        kind = 'bold' if re.search(r'<strong>|<b>', first) else ('italic' if '<em>' in first else 'plain')
        out.append({'term': clean(first), 'kind': kind, 'desc': clean(' '.join(tds[1:])),
                    'href': (re.findall(r'href="([^"#]+)"', first) or [None])[0]})
    return out

def parse(path, href):
    t = open(path, encoding='utf-8').read()
    title = re.search(r'<h1[^>]*>(.*?)</h1>', t, re.S)
    title = clean(title.group(1)) if title else ''
    title = re.sub(r'\s*\(.*\)$', '', title)
    sp = re.search(r'name="source_path" content="[^"]*/([^/"]+)\.md"', t)
    c = content_of(t) or ''
    intro, secs = sections(c)
    paras = [clean(p) for p in re.findall(r'<p>(.*?)</p>', intro, re.S)]
    paras = [p for p in paras if p and p not in ('Note', 'Important', 'Caution', 'Warning')]
    if not paras:
        paras = [clean(intro)]
    r = {'href': href, 'title': title, 'intro': paras[:3], 'source': sp.group(1) if sp else None}
    for key, body in secs.items():
        k = key.rstrip('-')
        if k in ('values', 'value'):
            r['values'] = rows(body)
            r['valuesText'] = clean(re.sub(r'<table.*?</table>', ' ', body, flags=re.S))[:600]
        elif k in ('child-elements', 'child-element', 'in-this-section', 'component-settings'):
            r['children'] = rows(body)
        elif k == 'type':
            r['type'] = clean(body)[:60]
        elif k in ('valid-configuration-passes', 'valid-passes'):
            r['passes'] = clean(body)
        elif k == 'parent-hierarchy':
            r['hierarchy'] = [clean(x) for x in re.split(r'\|', re.sub(r'<p>|</p>', '', body))]
        elif k == 'applies-to':
            r['appliesTo'] = clean(body)[:1500]
    r['allxml'] = [html.unescape(re.sub(r'<[^>]+>', '', x)) for x in re.findall(r'<pre[^>]*><code[^>]*>(.*?)</code></pre>', c, re.S)]
    r['bodyText'] = clean(re.sub(r'<pre.*?</pre>', ' ', c, flags=re.S))[:4000]
    return r

def walk_toc(nodes):
    return [{'title': n.get('toc_title'), 'href': n.get('href'), 'children': walk_toc(n.get('children', []))} for n in nodes]

def find_components(nodes):
    for c in nodes:
        if c.get('toc_title') == 'Components':
            return c
        r = find_components(c.get('children', []))
        if r:
            return r

result = {'current': [], 'legacy': []}
toc = json.load(open(os.path.join(D, 'ms/toc.json')))['items'][0]['children'][4]['children']
result['current'] = walk_toc(toc)
gam = parse(os.path.join(D, 'ms/pages/microsoft-windows-gaming-configuration.html'), 'microsoft-windows-gaming-configuration')
result['current'].append({'title': 'Microsoft-Windows-Gaming-Configuration', 'href': 'microsoft-windows-gaming-configuration',
                          'children': [{'title': ch['term'], 'href': ch['href'], 'children': []} for ch in gam.get('children', [])]})
result['legacy'] = walk_toc(json.load(open(os.path.join(D, 'old/legacy-toc.json'))))

def fix_misfiled(node):
    """Move a TOC entry whose page slug names a different sibling (a TOC typo) under that sibling."""
    kids = node['children']
    for k in list(kids):
        for c in list(k['children']):
            if k['href'] and not c['href'].startswith(k['href'] + '-'):
                for other in kids:
                    if other is not k and other['href'] and c['href'].startswith(other['href'] + '-') \
                            and not any(x['title'] == c['title'] for x in other['children']):
                        k['children'].remove(c)
                        other['children'].append(c)
                        break
    for k in kids:
        fix_misfiled(k)
for n in result['current']:
    fix_misfiled(n)

pages = {}
def collect(node, folder):
    p = os.path.join(D, folder, 'pages', node['href'] + '.html')
    pages[folder + ':' + node['href']] = parse(p, node['href']) if os.path.exists(p) else {'missing': True, 'href': node['href']}
    for ch in node['children']:
        collect(ch, folder)
for n in result['current']:
    collect(n, 'ms')
for n in result['legacy']:
    collect(n, 'old')

# archived-only settings of components that still exist in the current reference
extra = json.load(open(os.path.join(D, 'old/extra.json')))
oldcomps = {x['toc_title']: x for x in find_components(json.load(open(os.path.join(D, 'old/toc.json')))['items'])['children']}
grafts = {}
for comp, lst in extra.items():
    hrefs = {h for _, h in lst}
    def prune(n):
        kids = [k for k in (prune(c) for c in n.get('children', [])) if k]
        if n.get('href') in hrefs or kids:
            return {'title': n['toc_title'], 'href': n['href'], 'children': kids, 'archivedOnly': n.get('href') in hrefs}
        return None
    tree = prune(oldcomps[comp])
    grafts[comp] = tree
    def coll(n):
        if n['archivedOnly']:
            pages['old:' + n['href']] = parse(os.path.join(D, 'old', 'pages', n['href'] + '.html'), n['href'])
        for c in n['children']:
            coll(c)
    coll(tree)
result['grafts'] = grafts
result['pages'] = pages
json.dump(result, open(os.path.join(D, 'raw.json'), 'w'), indent=1)
print('pages', len(pages), 'missing', sum(1 for p in pages.values() if p.get('missing')), 'grafted', len(grafts))
