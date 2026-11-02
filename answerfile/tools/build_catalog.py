"""Turn raw.json (extracted Microsoft Learn pages) into answerfile/unattend-catalog.json."""
import json, re, sys, os, datetime

D = sys.argv[1]
OUT = sys.argv[2]
raw = json.load(open(os.path.join(D, 'raw.json')))
P = raw['pages']
PASSES = ["windowsPE", "offlineServicing", "generalize", "specialize", "auditSystem", "auditUser", "oobeSystem"]
PLOW = {p.lower(): p for p in PASSES}
NAME_RE = re.compile(r'^[A-Za-z_][A-Za-z0-9_.-]*$')

# list item elements seen repeated or with wcm:action="add" in the documented XML examples
LIST_ITEMS = {'Accelerator', 'AddonGuidItem', 'AssociationElement', 'AsynchronousCommand', 'Cache', 'CreatePartition',
              'DataImage', 'DeviceElement', 'Disk', 'DomainAccount', 'DomainAccountList', 'DomainName', 'FavoriteBarItem',
              'FavoriteItem', 'FeedItem', 'FirewallGroup', 'Interface', 'IpAddress', 'LocalAccount', 'MetaData',
              'ModifyPartition', 'OfflineDomainAccount', 'PathAndCredentials', 'Portrule', 'QuickLinkItem', 'Region',
              'RegionalOverride', 'Route', 'RunAsynchronousCommand', 'RunSynchronousCommand', 'Scope', 'StartPage',
              'SynchronousCommand', 'TrapConfigurationItems', 'User', 'ValidCommunity', 'Cluster', 'CodeAction'}
# list items whose Key child is written as the wcm:keyValue attribute (seen in the examples)
KEYVALUE_ITEMS = {'AssociationElement', 'DeviceElement', 'DomainName', 'FirewallGroup', 'IpAddress', 'PathAndCredentials',
                  'Portrule', 'ValidCommunity'}
# documented identifying child for keyed lists without a Key child
KEY_MAP = {'RunSynchronousCommand': 'Order', 'RunAsynchronousCommand': 'Order', 'SynchronousCommand': 'Order',
           'AsynchronousCommand': 'Order', 'CreatePartition': 'Order', 'ModifyPartition': 'Order', 'DataImage': 'Order',
           'Disk': 'DiskID', 'LocalAccount': 'Name', 'DomainAccountList': 'Domain', 'DomainAccount': 'Name',
           'OfflineDomainAccount': 'SID', 'Interface': 'Identifier', 'Route': 'Identifier', 'MetaData': 'Key',
           'Scope': 'ScopeKey', 'FavoriteItem': 'FavID', 'FeedItem': 'FeedKey', 'Accelerator': 'ItemKey',
           'FavoriteBarItem': 'ItemKey', 'StartPage': 'StartPageKey', 'QuickLinkItem': 'QLID', 'Region': 'Key',
           'RegionalOverride': 'Order', 'Cache': 'CacheID', 'TrapConfigurationItems': 'Community_Name',
           'ProtectedVolumeEntry': 'DriveLetter', 'AddonGuidItem': 'AddonGuid', 'User': 'Key', 'Cluster': 'ClusterIpAddress',
           'CodeAction': 'ReturnCode'}
LIST_ITEMS.add('ProtectedVolumeEntry')
COMPONENT_NAME_FIX = {'Microsoft-Windows-WDF-Kernel Library': 'Microsoft-Windows-WDF-KernelLibrary',
                      'microsoft-windows-security-spp-ux-sppcc-': 'Microsoft-Windows-Security-SPP-UX-SPPCC'}
ENCODED_PASSWORD_PARENTS = set()  # filled while walking: containers with Value + PlainText

def parse_passes(s):
    if not s:
        return []
    found = []
    for tok in re.findall(r'[A-Za-z]+', s):
        p = PLOW.get(tok.lower())
        if p and p not in found:
            found.append(p)
    return [p for p in PASSES if p in found]

def clean_text(t):
    t = re.sub(r'\s+', ' ', t or '').strip()
    t = re.sub(r'\s+([.,;:)])', r'\1', t)
    t = t.replace('\u2014', ', ').replace('\u2013', '-').replace('\u2019', "'").replace('\u201c', '"').replace('\u201d', '"')
    return t.replace('\u00ae', '').replace('\u2122', '')

def sentences(t):
    t = clean_text(t)
    out = re.split(r'(?<=[.!?])\s+(?=[A-Z(])', t)
    return [x.strip() for x in out if x.strip()]

def first_sentence(t):
    ss = sentences(t)
    return ss[0] if ss else ''

SKIP_SENT = re.compile(r'(?i)^(applies to:|note\b|important\b|warning\b|caution\b|tip\b|is new in|new in|this (setting|component|information) (has been|is|was) (deprecated|removed|not supported|provided|for reference)|this setting is deprecated|these settings? (are|is) deprecated|do not use these settings|in windows 10, (the|this)|this setting has no effect|this component is removed|the information about this deprecated|this was added)')

def paraphrase(name, text, maxlen=180):
    """Condense the documentation's descriptive sentence into a short help line in plain words."""
    text = re.sub(r'^Applies To:.*?(Windows Vista|Windows 7|Windows 8\.1|Windows 8|Server 2012 R2|Server 2012|Server 2008 R2|Server 2008)(?=\s+[A-Z])\s+', '', clean_text(text))
    ss = [x for x in sentences(text) if not SKIP_SENT.match(x)]
    if not ss:
        return ''
    s = ss[0]
    if s.endswith(':'):
        s = s[:-1] + ' (see the reference for the full list).'
    n = re.escape(name)
    s = re.sub(r'^(The\s+)?' + n + r'\s+(setting|component|element|list item|item|module)?\s*', '', s, flags=re.I)
    rules = [
        (r'^specifies whether (or not )?to ', 'Choose whether to '),
        (r'^(specifies|determines|indicates) (if|whether) (or not )?', 'Whether '),
        (r'^(specifies|determines|indicates) (the|a|an) ', 'The '),
        (r'^(specifies|determines|indicates) ', ''),
        (r'^contains (the )?settings ', 'Settings '),
        (r'^contains ', 'Holds '),
        (r'^is a list item type (and|that) specifies (the |a |an )?', 'One list entry for '),
        (r'^is a list item (type )?(that )?(specifies|contains) (the |a |an )?', 'One list entry for '),
        (r'^is a container for ', 'Holds '),
        (r'^is (an optional setting )?(that is )?used (with|to) ', r'Used \3 '),
        (r'^is ', 'This is '),
        (r'^enables (you|a|an|the|users?|end users|oems|it)\b', r'Lets \1'),
        (r'^enables ', 'Turns on '),
        (r'^configures ', 'Sets '),
        (r'^defines ', 'Sets '),
        (r'^allows ', 'Lets '),
        (r'^implements: ', ''),
    ]
    for pat, rep in rules:
        if re.match(pat, s, flags=re.I):
            s = re.sub(pat, rep, s, count=1, flags=re.I)
            break
    s = s.strip(' ,')
    if s and s[0].islower():
        s = s[0].upper() + s[1:]
    if len(s) > maxlen:
        s = s[:maxlen].rsplit(' ', 1)[0].rstrip(',;:') + '...'
    if s and s[-1] not in '.!?' and not s.endswith('...'):
        s += '.'
    return s

def label_of(desc):
    s = first_sentence(desc or '')
    s = re.sub(r'^Specifies that\s+', '', s, flags=re.I)
    s = re.sub(r'^Specifies\s+', '', s, flags=re.I)
    s = s.replace('—', ', ').replace('’', "'")
    if s and s[0].islower():
        s = s[0].upper() + s[1:]
    if len(s) > 120:
        s = s[:120].rsplit(' ', 1)[0] + '...'
    return s

PLACEHOLDER_WORDS = re.compile(r'(?i)^(unsigned int|integer|int|string|dword|value|number|true or false)$')

def is_literal(term, kind):
    if not term:
        return False
    if kind == 'italic' and not re.fullmatch(r'-?\d+|true|false', term, flags=re.I):
        return False
    if PLACEHOLDER_WORDS.match(term):
        return False
    return bool(re.fullmatch(r'[\w.@:{}#\-/\\+*,=]+', term)) and len(term) <= 60

NAME_FIX = {'allowdimcapable': 'AllowDimCapable', 'allowlockcapable': 'AllowLockCapable', 'allowwakecapable': 'AllowWakeCapable'}
# grouping pages whose documented Parent Hierarchy puts their settings directly under the component
TRANSPARENT = {'microsoft-windows-sensors-core-humanpresencesetting'}

def resolve_name(node, page, parent_page_source):
    t = (node['title'] or '').strip()
    m = re.match(r'(?i)^microsoft-windows-[\w-]+?-([A-Z][A-Za-z0-9]+)$', t)
    if m and t.lower().startswith('microsoft-windows-tpm-tasks-'):
        return m.group(1), False
    if NAME_RE.match(t):
        return t, False
    src = page.get('source') or ''
    if parent_page_source and src.lower().startswith(parent_page_source.lower() + '-'):
        cand = src[len(parent_page_source) + 1:]
    else:
        cand = src.split('-')[-1]
    inferred = True
    if cand.lower() in NAME_FIX:
        return NAME_FIX[cand.lower()], True
    if cand and cand == cand.lower():
        # page file name is all lowercase; rebuild the casing from the page title words
        words = re.findall(r'[A-Za-z0-9]+', t)
        joined = ''.join(w[0].upper() + w[1:] for w in words)
        if joined.lower() == cand.lower():
            cand = joined
        else:
            cand = cand[0].upper() + cand[1:]
        inferred = True
    return cand, inferred

def detect_type_and_values(name, page, parent_children_names, parent_name):
    vals = page.get('values') or []
    text = ' '.join([page.get('valuesText') or ''] + [v['desc'] for v in vals] + (page.get('intro') or []))
    declared = (page.get('type') or '').lower()
    out = {}
    vals = [dict(v, term=re.match(r'^(true|false)\s*\(', v['term'], flags=re.I).group(1)) if re.match(r'^(true|false)\s*\(', v['term'], flags=re.I) else v for v in vals]
    literal = [v for v in vals if is_literal(v['term'], v['kind'])]
    default = None
    for v in vals:
        if re.search(r'(?i)this is the default|is the default value|\(default\)|default setting|^default value|\bdefault value\.', v['desc']):
            default = v['term'] if is_literal(v['term'], v['kind']) else default
    if default is None:
        m = re.search(r'(?i)the default (?:value )?is\s+\**([\w\-]+(?:\.[\w\-]+)*)\**(?=[,;]|\.(?:\s|$)|\s|$)', text)
        if m and m.group(1).lower() not in ('to', 'that', 'the', 'a', 'an', 'not', 'set', 'used', 'based', 'determined', 'empty', 'no', 'none', 'blank', 'specified', 'false.'):
            default = m.group(1)
    lower_terms = {v['term'].lower() for v in literal}
    if literal and lower_terms <= {'true', 'false'} and len(literal) >= 1:
        typ = 'boolean'
        out['values'] = []
        for v in literal:
            if v['term'].lower() not in [x['value'] for x in out['values']]:
                out['values'].append({'value': v['term'].lower(), 'label': label_of(v['desc'])})
        if default:
            default = default.lower()
    elif literal and (len(literal) == len(vals) or (len(literal) >= 2 and not any(v['kind'] == 'italic' for v in vals))):
        typ = 'enum'
        seen = set()
        out['values'] = []
        for v in literal:
            if v['term'] in seen:
                continue
            seen.add(v['term'])
            out['values'].append({'value': v['term'], 'label': label_of(v['desc'])})
    else:
        placeholder = ' '.join(v['term'] for v in vals if v['kind'] == 'italic' or not is_literal(v['term'], v['kind']))
        numeric_name = re.search(r'(?i)(number|count|order|metric|size|megabytes|seconds|minutes|hours|days|_mb|percent|timeout|port|level|_id$|^id$|integer|dword)', placeholder)
        says_string = re.search(r'(?i)\bis an? (\d+-character )?string\b', text)
        if 'int' in declared or (numeric_name and not says_string and not re.search(r'(?i)string|name|path|url|text|identifier', placeholder)) or re.search(r'(?i)\b(is an? (unsigned )?integer|integer value|is a DWORD|DWORD value|unsigned int|is a number|integer from|integer between|integer that)', text):
            typ = 'integer'
        elif 'bool' in declared:
            typ = 'boolean'
            out['values'] = [{'value': 'true', 'label': 'Enabled'}, {'value': 'false', 'label': 'Disabled'}]
        else:
            typ = 'string'
        if literal and typ != 'boolean':
            # mixed: some documented literal choices plus free text
            out['suggestions'] = [{'value': v['term'], 'label': label_of(v['desc'])} for v in literal]
    m = re.search(r'(?i)(?:from|between|range of|in the range)\s+(-?\d[\d,]*)\s+(?:through|to|and|-)\s+(-?\d[\d,]*)', text)
    if m and typ in ('integer', 'string'):
        a, b = int(m.group(1).replace(',', '')), int(m.group(2).replace(',', ''))
        if a <= b:
            if typ == 'string' and re.search(r'(?i)characters', text[m.start():m.end() + 30]):
                out['maxLength'] = b
            elif typ == 'integer':
                out['min'], out['max'] = a, b
            else:
                out['rangeNote'] = '%d-%d' % (a, b)
    m = (re.search(r'(?i)maximum length of\s+(\d[\d,]*)\s+(?:\w+\s+)?(?:characters|bytes)', text)
         or re.search(r'(?i)(?:maximum of|no more than|at most|cannot exceed|cannot be longer than)\s+(\d[\d,]*)\s+(?:\w+\s+)?characters', text))
    if m and typ in ('string', 'password'):
        out['maxLength'] = int(m.group(1).replace(',', ''))
    if default is not None:
        out['default'] = default
    # passwords and keys
    low = name.lower()
    sensitive = False
    if 'password' in low or (name == 'Value' and parent_name and 'password' in parent_name.lower()):
        typ = 'password'
        out.pop('values', None)
        sensitive = True
    if typ == 'password' and 'maxLength' not in out:
        m = re.search(r'(?i)maximum length of\s+(\d+)', text)
        if m:
            out['maxLength'] = int(m.group(1))
    if re.search(r'(?i)product key|key used to install and to activate', text) and typ == 'string' and 'key' in low:
        sensitive = True
    if (name == 'Key' and parent_name == 'ProductKey') or low in ('productkey', 'ocurproductkey') or re.search(r'(?i)product key', ' '.join(page.get('intro') or [])[:200]) and typ == 'string' and 'key' in low:
        sensitive = True
    if name == 'PlainText':
        typ = 'boolean'
        out['values'] = out.get('values') or [{'value': 'true', 'label': 'Value is stored as plain text'}, {'value': 'false', 'label': 'Value is encoded'}]
    return typ, out, sensitive

def is_deprecated(page):
    t = ' '.join(page.get('intro') or [])[:600]
    if re.search(r'(?i)^Applies To:', t):
        t = t[t.find(' ', 40):]
    return bool(re.search(r'(?i)\b(is|are|has been|have been|setting is|component is|settings are) (now )?(deprecated|removed|not supported|no longer supported)|\bdeprecated\b|this setting is not supported|intended for Microsoft internal use only', t))

stats = {'settings': 0, 'leaves': 0, 'leavesWithHelp': 0, 'leavesTyped': 0, 'leavesWithPasses': 0, 'inferredNames': 0}

def build_node(node, folder, parent_path, parent_page, comp_passes_acc, inherited_passes, parent_name, item_base=None):
    key = folder + ':' + node['href']
    page = P.get(key, {})
    name, inferred = resolve_name(node, page, (parent_page or {}).get('source'))
    if inferred:
        stats['inferredNames'] += 1
    path = (parent_path + '/' + name) if parent_path else name
    own = parse_passes(page.get('passes'))
    passes = own or inherited_passes
    kids_raw = node['children']
    s = {'path': path, 'name': name}
    help_text = paraphrase(name, ' '.join(page.get('intro') or [])) or paraphrase(name, page.get('bodyText', ''))
    dep = is_deprecated(page)
    child_names = [c['title'] for c in kids_raw]
    is_list = name in LIST_ITEMS and (kids_raw or name in ('Cluster',))
    if kids_raw:
        children = []
        sub_base = path if is_list else item_base
        for c in kids_raw:
            children.append(build_node(c, folder, path, page, comp_passes_acc, passes, name, sub_base))
        names = [c['name'] for c in children]
        union = []
        for ch in children:
            for p in ch.get('passes', []):
                if p not in union:
                    union.append(p)
        cp = [p for p in PASSES if p in union] or passes
        if is_list:
            s['type'] = 'list'
            s['passes'] = cp
            keyname = 'Key' if 'Key' in names else KEY_MAP.get(name)
            if keyname not in names:
                keyname = next((n for n in names if n in ('Order', 'Identifier', 'Name')), None)
            li = {'action': 'add', 'keyed': keyname is not None}
            if keyname:
                li['key'] = keyname
            li['keyStyle'] = 'keyValue' if (name in KEYVALUE_ITEMS and 'Key' in names) else 'element'
            li['valueStyle'] = 'text' if (li['keyStyle'] == 'keyValue' and sorted(names) == ['Key', 'Value']) else 'children'
            li['settings'] = children
            s['listItem'] = li
        else:
            s['type'] = 'container'
            s['passes'] = cp
            s['children'] = children
            if 'Value' in names and 'PlainText' in names:
                s['encodedPassword'] = True
                s['passwordSuffix'] = 'AdministratorPassword' if name.endswith('AdministratorPassword') else 'Password'
                s['sensitive'] = True
        stats['settings'] += 1
    else:
        typ, extra, sensitive = detect_type_and_values(name, page, child_names, parent_name)
        s['type'] = typ
        s['passes'] = passes
        for k in ('values', 'suggestions', 'min', 'max', 'maxLength', 'default', 'rangeNote'):
            if k in extra:
                s[k] = extra[k]
        if sensitive:
            s['sensitive'] = True
        stats['settings'] += 1
        stats['leaves'] += 1
        stats['leavesWithHelp'] += 1 if help_text else 0
        stats['leavesTyped'] += 1
        stats['leavesWithPasses'] += 1 if passes else 0
    if item_base:
        s['itemPath'] = path[len(item_base) + 1:]
    s['help'] = help_text or ('Setting ' + name + '.')
    if dep:
        s['deprecated'] = True
    if inferred:
        s['nameInferred'] = True
    s['doc'] = node['href']
    for p in s.get('passes', []):
        if p not in comp_passes_acc:
            comp_passes_acc.append(p)
    return s

def applies_to(page):
    t = page.get('appliesTo') or ''
    if 'Windows edition' not in t and 'Windows SIM' in t:
        return None
    if not re.search(r'(?i)Windows edition', t):
        return None
    # legacy table text: "<edition> x86 amd64 Not available ..."
    rows = re.findall(r'(Windows[^.]*?)\s+((?:(?:x86|amd64|ia64|arm64?|Not available)\s*){1,4})(?=Windows|$)', t[t.find('architectures') + 13:])
    client = server = False
    for ed, arch in rows:
        if ed.startswith('Windows edition'):
            continue
        avail = re.search(r'x86|amd64|ia64|arm', arch)
        if not avail:
            continue
        if 'Server' in ed:
            server = True
        else:
            client = True
    out = [x for x, f in (('client', client), ('server', server)) if f]
    return out or None

def build_component(node, folder, reference):
    page = P[folder + ':' + node['href']]
    title = node['title']
    h1 = page.get('title') or ''
    if title in COMPONENT_NAME_FIX:
        name = COMPONENT_NAME_FIX[title]
    elif NAME_RE.match(title):
        name = title
    else:
        name = h1
    acc = []
    settings = []
    for c in node['children']:
        if c['href'] in TRANSPARENT:
            gpage = P[folder + ':' + c['href']]
            for g in c['children']:
                settings.append(build_node(g, folder, '', gpage, acc, parse_passes(gpage.get('passes')), name))
        else:
            settings.append(build_node(c, folder, '', page, acc, [], name))
    intro = ' '.join(page.get('intro') or [])
    comp = {'name': name, 'summary': paraphrase(name, intro, 220) or ('Settings for ' + name + '.'),
            'passes': [p for p in PASSES if p in acc]}
    at = applies_to(page)
    if at:
        comp['appliesTo'] = at
    dep = is_deprecated(page) or reference != 'current' or bool(re.search(r'(?i)removed from Unattend|retired', intro))
    comp['deprecated'] = dep
    comp['reference'] = reference
    comp['doc'] = node['href']
    comp['settings'] = settings
    return comp

# Reviewed corrections for the most used components, where the documentation states a rule in prose
OVERRIDES = {
    ('Microsoft-Windows-Shell-Setup', 'ComputerName'): {'maxLength': 15, 'help': 'Network name of the computer (up to 15 bytes, no spaces or special characters); use * for a random name.'},
    ('Microsoft-Windows-Setup', 'DiskConfiguration/Disk/ModifyPartitions/ModifyPartition/Letter'): {'type': 'enum', 'values': [{'value': c, 'label': c + ':'} for c in 'CDEFGHIJKLMNOPQRSTUVWXYZ']},
    ('Microsoft-Windows-Setup', 'Display/ColorDepth'): {'type': 'integer'},
    ('Microsoft-Windows-Setup', 'Display/HorizontalResolution'): {'type': 'integer'},
    ('Microsoft-Windows-Setup', 'Display/VerticalResolution'): {'type': 'integer'},
    ('Microsoft-Windows-Setup', 'Display/RefreshRate'): {'type': 'integer'},
    ('Microsoft-Windows-Shell-Setup', 'LogonCommands/AsynchronousCommand/Order'): {'type': 'integer', 'min': 1, 'max': 500},
    ('Microsoft-Windows-Shell-Setup', 'OOBE/ProtectYourPC'): {'help': 'Whether OOBE Express settings (diagnostics, location, advertising ID and similar) are turned on: 1 or 2 turn them on, 3 turns them off.'},
    ('Microsoft-Windows-TCPIP', 'Interfaces/Interface/UnicastIpAddresses/IpAddress/Value'): {'type': 'string', 'help': 'A unicast IPv4 or IPv6 address in CIDR form, for example 192.168.0.10/24.'},
    ('Microsoft-Windows-TCPIP', 'Interfaces/Interface/Routes/Route/Prefix'): {'type': 'string', 'help': 'Destination prefix for the route in CIDR form, for example 0.0.0.0/0 for the default route.'},
    ('Microsoft-Windows-UnattendedJoin', 'Identification/Provisioning/AccountData'): {'type': 'string', 'sensitive': True},
    ('Microsoft-Windows-UnattendedJoin', 'OfflineIdentification/Provisioning/AccountData'): {'type': 'string', 'sensitive': True},
    ('Security-Malware-Windows-Defender', 'FallbackOrder'): {'type': 'string'},
    ('Security-Malware-Windows-Defender', 'TrustedImageIdentifier'): {'type': 'string'},
    ('Security-Malware-Windows-Defender', 'DisableAntiSpyware'): {'type': 'boolean'},
    ('Microsoft-Windows-Deployment', 'Reseal/Mode'): {'type': 'enum'},
}

def walk_settings(ss):
    for s in ss:
        yield s
        yield from walk_settings(s.get('children', []))
        yield from walk_settings(s.get('listItem', {}).get('settings', []))

def apply_overrides(comp):
    for s in walk_settings(comp['settings']):
        o = OVERRIDES.get((comp['name'], s['path']))
        if o:
            for k, v in o.items():
                s[k] = v
            if s['type'] in ('string', 'integer', 'password') and 'values' in s and 'values' not in o:
                del s['values']
            s['reviewed'] = True

def graft(comp, tree):
    """Add settings that only the archived Windows 8.1 reference documents, marked deprecated."""
    acc = list(comp['passes'])
    def place(container_list, parent_path, node, parent_page, item_base=None):
        page = P.get('old:' + node['href'], {})
        if node['archivedOnly']:
            s = build_node(node, 'old', parent_path, parent_page, acc, [], comp['name'], item_base)
            for x in walk_settings([s]):
                x['deprecated'] = True
                x['archivedOnly'] = True
            if not any(e['name'] == s['name'] for e in container_list):
                container_list.append(s)
            return
        name = node['title'].strip()
        target = next((e for e in container_list if e['name'].lower() == name.lower()), None)
        if target is None:
            return
        sub = target['listItem']['settings'] if 'listItem' in target else target.setdefault('children', [])
        sub_path = target['path']
        base = target['path'] if 'listItem' in target else item_base
        for c in node['children']:
            place(sub, sub_path, c, page, base)
    for c in tree['children']:
        place(comp['settings'], '', c, P.get('old:' + tree['href'], {}))
    comp['passes'] = [p for p in PASSES if p in acc]

components = []
for n in raw['current']:
    components.append(build_component(n, 'ms', 'current'))
for n in raw['legacy']:
    components.append(build_component(n, 'old', 'archive-windows-8.1'))
POPULAR = ['Microsoft-Windows-Setup', 'Microsoft-Windows-Shell-Setup', 'Microsoft-Windows-International-Core',
    'Microsoft-Windows-International-Core-WinPE', 'Microsoft-Windows-UnattendedJoin', 'Microsoft-Windows-TCPIP',
    'Microsoft-Windows-DNS-Client', 'Microsoft-Windows-Deployment', 'Microsoft-Windows-PnpCustomizationsWinPE',
    'Microsoft-Windows-PnpCustomizationsNonWinPE', 'Microsoft-Windows-Security-SPP', 'Microsoft-Windows-Security-SPP-UX',
    'Microsoft-Windows-LUA-Settings', 'Microsoft-Windows-TerminalServices-LocalSessionManager',
    'Microsoft-Windows-TerminalServices-RDP-WinStationExtensions', 'Networking-MPSSVC-Svc', 'Microsoft-Windows-IE-ESC',
    'Microsoft-Windows-ServerManager-SvrMgrNc', 'Microsoft-Windows-OutOfBoxExperience', 'Microsoft-Windows-PnpSysprep',
    'Microsoft-Windows-SystemRestore-Main', 'Security-Malware-Windows-Defender', 'Microsoft-Windows-ErrorReportingCore',
    'Microsoft-Windows-SQMAPI', 'Microsoft-Windows-WinRE-RecoveryAgent', 'Microsoft-Windows-PowerCPL',
    'Microsoft-Windows-Tpm-Tasks', 'Microsoft-Windows-DeviceGuard-Unattend', 'Microsoft-Windows-CodeIntegrity',
    'Microsoft-Windows-SecureStartup-FilterDriver', 'Microsoft-Windows-NetBT', 'Microsoft-Windows-WorkstationService',
    'Microsoft-Windows-SMBServer', 'Microsoft-Windows-IE-InternetExplorer', 'Microsoft-Windows-MicrosoftEdgeBrowser',
    'Microsoft-Windows-Embedded-ShellLauncher', 'Microsoft-Windows-Embedded-UnifiedWriteFilter',
    'Microsoft-Windows-RemoteAssistance-Exe', 'Microsoft-Windows-PartitionManager',
    'Microsoft-Windows-TerminalServices-RemoteConnectionManager']
assert len(POPULAR) == 40

def finish(comp):
    full = True
    for x in walk_settings(comp['settings']):
        if not x.get('passes'):
            x['passes'] = list(comp['passes'])
            x['passesUndocumented'] = True
        if x['type'] in ('container', 'list'):
            continue
        vals = [v['value'] for v in x.get('values', [])]
        if x['type'] == 'enum' and vals == [x['name']]:
            x['type'] = 'integer' if re.fullmatch(r'\d+', str(x.get('default', ''))) else 'string'
            del x['values']
        d = x.get('default')
        if x['type'] == 'enum' and d is not None and d not in vals and re.fullmatch(r'\d+', d) and all(re.fullmatch(r'\d+', v) for v in vals):
            # documented as combinable bit flags (the default is a sum of values)
            x['type'] = 'integer'
            x['flags'] = True
            x['suggestions'] = x.pop('values')
        if x['type'] == 'string' and d is not None and re.fullmatch(r'\d+', d) and not x.get('suggestions'):
            x['type'] = 'integer'
        if not x.get('help') or x['help'].startswith('Setting ') or x.get('passesUndocumented'):
            full = False
        if x['type'] in ('enum', 'boolean') and not x.get('values'):
            full = False
    comp['detail'] = 'full' if full else 'basic'
    if comp['name'] in POPULAR:
        comp['popular'] = True

byname = {c['name'].lower(): c for c in components}
for cname, tree in raw.get('grafts', {}).items():
    graft(byname[cname.lower()], tree)
for c in components:
    apply_overrides(c)
    finish(c)
missing_popular = [n for n in POPULAR if n.lower() not in byname]
assert not missing_popular, missing_popular
components.sort(key=lambda c: c['name'].lower())

# Ensure every component has passes; fall back to settings union already computed.
unverified = [
    {'name': 'Microsoft-Windows-Web-Services-for-Management-Core',
     'reason': 'Not listed in the current reference or the archived Windows 8.1 and Windows 7 component lists; the expected page URL returns HTTP 404.'},
    {'name': 'Microsoft-Windows-Firewall-Core',
     'reason': 'Not listed in the current reference or the archived component lists; the expected page URL returns HTTP 404. Firewall settings are documented under Networking-MPSSVC-Svc.'},
    {'name': 'Microsoft-Windows-Edge-* (other than MicrosoftEdgeBrowser)',
     'reason': 'The reference documents only Microsoft-Windows-MicrosoftEdgeBrowser; no other Edge component pages exist.'},
    {'name': 'Microsoft-Windows-Printing-* (other than Printing-Spooler-Core)',
     'reason': 'The reference documents only Microsoft-Windows-Printing-Spooler-Core; Microsoft-Windows-Printing-Spooler-Networkclient returns HTTP 404.'},
]

catalog = {
    'schemaVersion': 1,
    'source': 'Microsoft Unattended Windows Setup Reference (paraphrased)',
    'sourceUrls': {
        'current': 'https://learn.microsoft.com/en-us/windows-hardware/customize/desktop/unattend/',
        'archive-windows-8.1': 'https://learn.microsoft.com/en-us/previous-versions/windows/it-pro/windows-8.1-and-8/'
    },
    'generated': datetime.date.today().isoformat(),
    'passes': PASSES,
    'namespaces': {'unattend': 'urn:schemas-microsoft-com:unattend', 'wcm': 'http://schemas.microsoft.com/WMIConfig/2002/State',
                   'xsi': 'http://www.w3.org/2001/XMLSchema-instance'},
    'componentAttributes': {'publicKeyToken': '31bf3856ad364e35', 'language': 'neutral', 'versionScope': 'nonSxS'},
    'architectures': ['amd64', 'x86', 'arm64'],
    'components': components,
    'unverifiedComponents': unverified,
}
json.dump(catalog, open(OUT, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
print(json.dumps(stats))
print('components', len(components), 'full', sum(1 for c in components if c['detail'] == 'full'),
      'popular full', sum(1 for c in components if c.get('popular') and c['detail'] == 'full'))
print('basic:', [c['name'] for c in components if c['detail'] != 'full'])
