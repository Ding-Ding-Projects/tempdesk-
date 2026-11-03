// Deployment map: domain controller, portals host, app host, guest PC template and the network,
// edited as connected nodes. Writes back the TempDesk server fields (firstboot.json), the guest PC
// join settings and model.deploy. Pure helpers are exported for tests.
import { h, clone } from './dom.js';
import { quickField } from './widgets/index.js';
import { attachRegexBuilder, compile } from '../regex-builder.mjs';

// Widget for each map field (the map edits the same values as the Guided fields).
const MAP_HINTS = { 'map-prefix': { widget: 'number', min: 1, max: 32, unit: 'bits' }, 'map-gw': { widget: 'ipv4' }, 'map-dns': { widget: 'string-list', sep: ',' }, 'map-dc-ip': { widget: 'ipv4' },
  'map-dc-name': { widget: 'text', format: 'computername', maxLength: 15 }, 'map-dc-domain': { widget: 'text', format: 'fqdn' }, 'map-portals-ip': { widget: 'ipv4' }, 'map-app-ip': { widget: 'ipv4' },
  'map-guest-dns': { widget: 'ipv4' }, 'map-guest-ou': { widget: 'text', format: 'dn' }, 'map-portals-name': { widget: 'text', format: 'computername' }, 'map-app-name': { widget: 'text', format: 'computername' } };

export function ipToInt(ip) { const p = String(ip).split('.').map(Number); return p.length === 4 && p.every((x) => x >= 0 && x <= 255 && Number.isInteger(x)) ? ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3] : null; }
export function inCidr(ip, cidr) {
  const [base, bits] = String(cidr).split('/');
  const a = ipToInt(ip), b = ipToInt(base), n = parseInt(bits, 10);
  if (a === null || b === null || !(n >= 0 && n <= 32)) return null;
  const mask = n === 0 ? 0 : (0xffffffff << (32 - n)) >>> 0;
  return ((a & mask) >>> 0) === ((b & mask) >>> 0);
}
export function cidrFrom(ip, prefix) {
  const a = ipToInt(ip), n = parseInt(prefix, 10);
  if (a === null || !(n >= 0 && n <= 32)) return '';
  const mask = n === 0 ? 0 : (0xffffffff << (32 - n)) >>> 0;
  const net = (a & mask) >>> 0;
  return [net >>> 24, (net >> 16) & 255, (net >> 8) & 255, net & 255].join('.') + '/' + n;
}
// Pure: apply a deployment-map edit to the model. field: 'dc.ip' | 'dc.name' | 'dc.domain' | 'net.prefix' | 'net.gateway' | 'portals.mode' | 'portals.ip' | ...
export function applyMapEdit(model, field, value) {
  const m = clone(model);
  const s = m.server, g = m.guest, d = m.deploy;
  switch (field) {
    case 'dc.ip': {
      const old = s.ipAddress; s.ipAddress = value;
      if (g.dnsServer === old || !g.dnsServer) g.dnsServer = value;
      d.network.cidr = cidrFrom(value, s.prefixLength) || d.network.cidr;
      break;
    }
    case 'dc.name': s.computerName = value; break;
    case 'dc.domain': { const oldN = s.netbiosName, auto = !oldN || oldN === (s.domainName || '').split('.')[0].toUpperCase().slice(0, 15); s.domainName = value; if (auto) s.netbiosName = String(value).split('.')[0].replace(/[^A-Za-z0-9-]/g, '').slice(0, 15).toUpperCase(); if (!g.domainName || g.domainName === model.server.domainName) g.domainName = value; break; }
    case 'net.prefix': s.prefixLength = value; d.network.cidr = cidrFrom(s.ipAddress, value) || d.network.cidr; break;
    case 'net.gateway': s.gateway = value; break;
    case 'net.dns': s.dnsServers = value; break;
    case 'portals.mode': s.portalsMode = value === 'native' ? 'native' : 'none'; if (s.portalsMode === 'native') d.portalsHost.ip = s.ipAddress; break;
    case 'agent.tls': s.agentTls = !!value; break;
    case 'guest.dns': g.dnsServer = value; break;
    case 'guest.ou': g.ou = value; break;
    default: {
      const [node, f] = field.split('.');
      if (d[node] && f in d[node]) d[node][f] = String(value);
    }
  }
  return m;
}
export function mapWarnings(model) {
  const s = model.server, g = model.guest, d = model.deploy, out = [];
  const cidr = cidrFrom(s.ipAddress, s.prefixLength);
  if (cidr && s.gateway && inCidr(s.gateway, cidr) === false) out.push('map.warnGateway');
  if (g.dnsMode !== 'dhcp' && g.dnsServer && String(g.dnsServer).split(/[\s,]+/)[0] !== s.ipAddress) out.push('map.warnGuestDns');
  if (g.domainName && s.domainName && g.domainName.toLowerCase() !== s.domainName.toLowerCase()) out.push('map.warnDomain');
  if (d.appHost.ip && d.appHost.ip === s.ipAddress) out.push('map.warnAppHostDc');
  [d.appHost.ip, d.portalsHost.ip].forEach((ip) => { if (ip && cidr && inCidr(ip, cidr) === false) out.push('map.warnSubnet'); });
  return [...new Set(out)];
}

// ctx: { t, getModel(), setModel(model, msg, coalesceKey) }
export function mountDeploy(root, ctx) {
  const t = ctx.t;
  // search-surface: map-find (dims map nodes that do not match; node text includes field values)
  const findIn = h('input', { type: 'search', class: 'rxb-in', 'aria-label': t('map.find'), placeholder: t('map.find'), autocomplete: 'off', spellcheck: 'false' });
  const findSt = h('span', { class: 'meter-label', role: 'status', 'aria-live': 'polite' });
  const finder = h('div', { class: 'rxb-filter', role: 'search' }, [h('div', { class: 'rxb-host' }, [findIn]), findSt]);
  let findState = null;
  const nodeText = (n) => n.textContent + ' ' + [...n.querySelectorAll('input, select, textarea')].map((x) => x.value).join(' ');
  function applyFind() {
    const nodes = [...root.querySelectorAll('.map .node')];
    const st = findState || { query: '' };
    const c = compile(st.regex ? st.pattern : st.query, st);
    if (!c.ok) { findSt.textContent = t('palette.badRegex'); return; }
    let n = 0;
    nodes.forEach((nd) => { const hit = c.empty || c.test(nodeText(nd)); nd.classList.toggle('rxb-tab-miss', !hit); nd.classList.toggle('found', !c.empty && hit); if (hit) n++; });
    findSt.textContent = c.empty ? '' : t('search.listCount', [n, nodes.length]);
  }
  attachRegexBuilder(findIn, { label: t('map.find'), t: (k, ...a) => t(k, a), sampleProvider: () => [...root.querySelectorAll('.map .node')].map(nodeText).join('\n'), onChange: (st) => { findState = st; applyFind(); } });
  function field(id, label, value, onInput, opts) {
    opts = opts || {};
    const hint = opts.options ? { widget: 'segmented', values: opts.options.map((o) => ({ value: o[0], label: o[1] })), valueHelp: Object.fromEntries(opts.options.map((o) => [o[0], o[1] + '.'])) } : Object.assign({ widget: 'text' }, MAP_HINTS[id] || {});
    let tm;
    const card = quickField({ id, label, hint, value, t, noUnset: true, onChange: (v) => {
      if (opts.options) { onInput(v || '', id); return; }
      clearTimeout(tm); tm = setTimeout(() => onInput(v || '', id), 250);
    } });
    if (!opts.options) card.input.addEventListener('blur', () => setTimeout(() => { if (!root.contains(document.activeElement) || !root.querySelector('#' + CSS.escape(id))?.closest('.wf')?.contains(document.activeElement)) draw(); }, 300));
    card.el.setAttribute('data-palette-field', label); card.el.setAttribute('data-palette-group', t('tab.map'));
    return card.el;
  }
  function edit(f, label) { return (v, id) => { ctx.setModel(applyMapEdit(ctx.getModel(), f, v), { key: 'hist.mapSet', args: [label, v] }, id); }; }
  function draw() {
    const m = ctx.getModel(), s = m.server, g = m.guest, d = m.deploy;
    const native = s.portalsMode === 'native';
    const agentPort = s.agentTls ? 8443 : 8080;
    const nodes = [];
    nodes.push(h('div', { class: 'node net', id: 'map-net' }, [h('h3', { text: t('map.network') }),
      h('div', { class: 'ports' }, [h('span', { text: cidrFrom(s.ipAddress, s.prefixLength) || '?' })]),
      field('map-prefix', t('f.prefixLength'), s.prefixLength, edit('net.prefix', t('f.prefixLength'))),
      field('map-gw', t('f.gateway'), s.gateway, edit('net.gateway', t('f.gateway'))),
      field('map-dns', t('f.dnsServers'), s.dnsServers, edit('net.dns', t('f.dnsServers')))]));
    nodes.push(h('div', { class: 'node', id: 'map-dc' }, [h('h3', { text: t('map.dc') }),
      h('div', { class: 'ports' }, [h('span', { text: 'DNS 53' }), h('span', { text: 'LDAP 389' }), h('span', { text: 'Kerberos 88' }), h('span', { text: 'SMB 445' }), h('span', { text: 'WinRM 5985' }), h('span', { text: (s.agentTls ? 'HTTPS ' : 'HTTP ') + agentPort + ' agent' })].concat(native ? [h('span', { text: '8081 guest' }), h('span', { text: '8082 admin' })] : [])),
      field('map-dc-name', t('f.computerName'), s.computerName, edit('dc.name', t('f.computerName'))),
      field('map-dc-ip', t('f.ipAddress'), s.ipAddress, edit('dc.ip', t('f.ipAddress'))),
      field('map-dc-domain', t('f.domainName'), s.domainName, edit('dc.domain', t('f.domainName'))),
      field('map-tls', t('f.agentTls'), s.agentTls ? 'on' : 'off', (v) => ctx.setModel(applyMapEdit(ctx.getModel(), 'agent.tls', v === 'on'), { key: 'hist.mapSet', args: [t('f.agentTls'), v] }), { options: [['off', t('map.tlsOff')], ['on', t('map.tlsOn')]] })]));
    nodes.push(h('div', { class: 'node', id: 'map-portals' }, [h('h3', { text: t('map.portals') }),
      field('map-portals-mode', t('f.portalsMode'), s.portalsMode, (v) => { ctx.setModel(applyMapEdit(ctx.getModel(), 'portals.mode', v), { key: 'hist.mapSet', args: [t('f.portalsMode'), v] }); draw(); }, { options: [['none', t('opt.portals.none')], ['native', t('opt.portals.native')]] }),
      native ? h('p', { class: 'help', text: t('map.portalsNative', [s.ipAddress]) }) : field('map-portals-ip', t('map.hostIp'), d.portalsHost.ip, edit('portalsHost.ip', t('map.portals'))),
      native ? null : field('map-portals-name', t('map.hostName'), d.portalsHost.name, edit('portalsHost.name', t('map.portals'))),
      h('div', { class: 'ports' }, [h('span', { text: ':' + d.portalsHost.guestPort + ' guest' }), h('span', { text: ':' + d.portalsHost.adminPort + ' admin' })])]));
    nodes.push(h('div', { class: 'node', id: 'map-apphost' }, [h('h3', { text: t('map.appHost') }),
      h('p', { class: 'help', text: t('map.appHostHelp') }),
      field('map-app-name', t('map.hostName'), d.appHost.name, edit('appHost.name', t('map.appHost'))),
      field('map-app-ip', t('map.hostIp'), d.appHost.ip, edit('appHost.ip', t('map.appHost'))),
      h('div', { class: 'ports' }, [h('span', { text: 'RDP 3389' })])]));
    nodes.push(h('div', { class: 'node', id: 'map-guest' }, [h('h3', { text: t('map.guestPc') }),
      field('map-guest-dns', t('f.dnsServer'), g.dnsServer, edit('guest.dns', t('f.dnsServer'))),
      field('map-guest-ou', t('f.ou'), g.ou, edit('guest.ou', t('f.ou'))),
      h('p', { class: 'help', text: t('map.guestJoins', [g.domainName || s.domainName, g.ou || ('OU=Computers,OU=TempDesk,' + String(g.domainName || s.domainName).split('.').map((x) => 'DC=' + x).join(','))]) })]));
    const map = h('div', { class: 'map' }, nodes);
    const warn = mapWarnings(m).map((k) => h('p', { class: 'notice warn', role: 'alert', text: t(k) }));
    root.replaceChildren(h('p', { class: 'meter-label', text: t('map.help') }), finder, ...warn, map);
    applyFind();
    requestAnimationFrame(() => links(map));
  }
  function links(map) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'links'); svg.setAttribute('aria-hidden', 'true');
    const r0 = map.getBoundingClientRect();
    const net = map.querySelector('#map-net');
    if (!net) return;
    const c = (el) => { const r = el.getBoundingClientRect(); return [r.left - r0.left + r.width / 2, r.top - r0.top + r.height / 2]; };
    const [nx, ny] = c(net);
    ['#map-dc', '#map-portals', '#map-apphost', '#map-guest'].forEach((sel) => {
      const el = map.querySelector(sel); if (!el) return;
      const [x, y] = c(el);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', nx); line.setAttribute('y1', ny); line.setAttribute('x2', x); line.setAttribute('y2', y);
      line.setAttribute('stroke', 'var(--outline3)'); line.setAttribute('stroke-width', '2'); line.setAttribute('stroke-dasharray', '6 6');
      svg.appendChild(line);
    });
    map.prepend(svg);
  }
  draw();
  return { update: draw };
}
