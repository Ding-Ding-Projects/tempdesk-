// Unattend settings catalog: loading, normalizing and rendering as forms.
// The full catalog (answerfile/unattend-catalog.json, built by another component) is copied into the
// site at build time. Until it exists, a small built-in core subset is used and the page says so.
// Framework-free ES module; operates on model.all = { "pass|Component": value } (see answer.js).
import { h, iconButton, clone } from './dom.js';

export const PASSES = ['windowsPE', 'offlineServicing', 'generalize', 'specialize', 'auditSystem', 'auditUser', 'oobeSystem'];

// ---- normalizing ------------------------------------------------------------------------------
const TYPE_MAP = { bool: 'boolean', boolean: 'boolean', switch: 'boolean', int: 'integer', integer: 'integer', number: 'integer', unsignedint: 'integer', uint: 'integer', long: 'integer',
  enum: 'enum', choice: 'enum', select: 'enum', password: 'password', secret: 'password', list: 'list', array: 'list', collection: 'list', repeat: 'list',
  container: 'container', complex: 'container', object: 'container', group: 'container', string: 'string', text: 'string', path: 'string' };
function arr(v) { return Array.isArray(v) ? v : v && typeof v === 'object' ? Object.keys(v).map((k) => Object.assign({ name: k }, v[k])) : []; }
function passesOf(x) {
  const p = x.passes || x.validPasses || x.configurationPasses || x.pass;
  return (Array.isArray(p) ? p : typeof p === 'string' ? p.split(/[\s,]+/) : []).filter((q) => PASSES.includes(q));
}
function platformsOf(x) {
  const out = new Set();
  const p = x.platforms || x.appliesTo || x.editions || x.os;
  if (Array.isArray(p) && p.length === 0) return ['client', 'server'];
  (Array.isArray(p) ? p : typeof p === 'string' ? [p] : []).forEach((v) => {
    const s = String(v).toLowerCase();
    if (/server/.test(s)) out.add('server');
    if (/client|windows ?1[01]|desktop|workstation|^windows$/.test(s)) out.add('client');
  });
  if (x.client === true) out.add('client');
  if (x.server === true) out.add('server');
  if (!out.size) { out.add('client'); out.add('server'); }
  return [...out];
}
function normSetting(s, parentPath) {
  const name = s.name || s.id || s.key;
  if (!name) return null;
  const path = parentPath ? parentPath + '/' + name : name;
  const li = s.listItem && typeof s.listItem === 'object' ? s.listItem : null;
  const keyValueStyle = !!(li && li.keyStyle === 'keyValue');
  const textItems = !!(li && li.valueStyle === 'text');
  let srcKids = li ? arr(li.settings) : arr(s.children || s.settings || s.properties || s.items || s.fields);
  if (keyValueStyle && li.key) srcKids = srcKids.filter((c) => c.name !== li.key);
  if (textItems) srcKids = [];
  const kids = srcKids.map((c) => normSetting(c, path)).filter(Boolean);
  let raw = String(s.type || s.kind || '').toLowerCase();
  let type = TYPE_MAP[raw] || (kids.length ? 'container' : 'string');
  if (li) type = 'list';
  // An encoded password container (Value + PlainText) is one password control. A bare password leaf
  // (for example Credentials/Password) is written as plain text, so it is a masked string.
  if (s.encodedPassword) type = 'password';
  else if (type === 'password') type = 'string';
  const values = (s.values || s.enum || s.allowedValues || s.options || []).map((v) => (v && typeof v === 'object' ? { value: String(v.value ?? v.name ?? v.id), label: String(v.label ?? v.value ?? v.name ?? v.id), help: v.help || v.description || '' } : { value: String(v), label: String(v) }));
  if (s.list === true || s.repeat === true || s.multiple === true || s.wcmAction === 'add' || s['wcm:action'] === 'add') type = 'list';
  if (type === 'string' && values.length) type = 'enum';
  if (type === 'boolean' && values.length && !values.every((v) => /^(true|false)$/i.test(v.value))) type = 'enum';
  if (type === 'list' && !kids.length) type = 'stringList';
  return {
    name, path, type, children: type === 'password' ? [] : kids, values, suggestions: (s.suggestions || []).map((v) => (v && typeof v === 'object' ? String(v.value ?? v.name) : String(v))),
    min: s.min ?? s.minimum, max: s.max ?? s.maximum, maxLength: s.maxLength,
    help: s.help || s.description || '', passes: passesOf(s), sensitive: !!(s.sensitive || type === 'password' || /password/i.test(name) && type !== 'container'),
    keyed: !!(keyValueStyle || s.keyValue || s['wcm:keyValue']), deprecated: !!s.deprecated, default: s.default
  };
}
export function normalizeCatalog(src, origin) {
  const comps = arr(src && (src.components || src.Components || src)).map((c) => {
    const name = c.name || c.id;
    if (!name || !/^[A-Za-z0-9.-]+$/.test(name)) return null;
    return { name, passes: passesOf(c), platforms: platformsOf(c), help: c.summary || c.help || c.description || '', settings: arr(c.settings || c.children || c.properties).map((s) => normSetting(s, '')).filter(Boolean), deprecated: !!c.deprecated, popular: !!c.popular };
  }).filter((c) => c && c.passes.length);
  comps.sort((a, b) => (b.popular - a.popular) || (a.deprecated - b.deprecated) || a.name.localeCompare(b.name));
  const byName = new Map(comps.map((c) => [c.name, c]));
  return { origin: origin || 'core', version: (src && (src.version || src.schemaVersion)) || '', components: comps, byName };
}

// ---- built-in core subset ---------------------------------------------------------------------
const B = (name, help) => ({ name, type: 'boolean', help });
const S = (name, help, extra) => Object.assign({ name, type: 'string', help }, extra || {});
const I = (name, help, min, max) => ({ name, type: 'integer', help, min, max });
const E = (name, help, values) => ({ name, type: 'enum', help, values });
const P = (name, help) => ({ name, type: 'password', help });
const C = (name, help, children) => ({ name, type: 'container', help, children });
const L = (name, help, children, keyed) => ({ name, type: 'list', help, children, keyed: !!keyed });
const CREDS = C('Credentials', 'Account used to reach the path or run the command. The password is stored in plain text.', [S('Domain', 'Domain of the account.'), S('Username', 'User name.'), S('Password', 'Password, stored in plain text in the answer file.', { sensitive: true })]);
const RUNSYNC = (item) => L(item, 'One command. Commands run in Order.', [I('Order', 'Run order, starting at 1.', 1, 1000), S('Path', 'Command line to run.'), S('Description', 'Text shown while it runs.'), E('WillReboot', 'Whether the command restarts the computer.', ['Always', 'Never', 'OnRequest']), CREDS]);
const DRIVER_PATHS = C('DriverPaths', 'Folders that Windows Setup searches for drivers.', [L('PathAndCredentials', 'One driver folder. Use a unique key per entry.', [S('Path', 'Local or UNC path, for example D:\\Drivers.'), CREDS], true)]);
export const CORE_CATALOG = {
  version: 'core-1',
  components: [
    { name: 'Microsoft-Windows-International-Core-WinPE', passes: ['windowsPE'], help: 'Language and locale for Windows Setup and the installed system.', settings: [
      C('SetupUILanguage', 'Language of the Windows Setup screens.', [S('UILanguage', 'For example en-US.'), B('WillShowUI', 'Show the language page.')]),
      S('InputLocale', 'Keyboard layout, for example en-US or 0409:00000409.'), S('SystemLocale', 'Language for non-Unicode programs.'), S('UILanguage', 'Display language.'),
      S('UILanguageFallback', 'Fallback language for partly localized resources.'), S('UserLocale', 'Formats for dates, numbers and currency.'), I('LayeredDriver', 'Japanese or Korean keyboard type (1 to 6).', 1, 6)] },
    { name: 'Microsoft-Windows-Setup', passes: ['windowsPE'], help: 'Disk layout, image to install, product key and Setup behaviour.', settings: [
      C('UserData', 'License and user information.', [B('AcceptEula', 'Accept the license terms without asking.'), S('FullName', 'Name of the end user.'), S('Organization', 'Organization name.'),
        C('ProductKey', 'Product key used during Setup.', [S('Key', 'Format XXXXX-XXXXX-XXXXX-XXXXX-XXXXX.'), E('WillShowUI', 'When to show the product key page.', ['Always', 'OnError', 'Never'])])]),
      C('ImageInstall', 'Which image to install and where.', [C('OSImage', 'Windows image.', [
        C('InstallFrom', 'Image source.', [S('Path', 'Path to install.wim or install.esd. Leave empty to use the media.'), L('MetaData', 'Image selector, for example /IMAGE/INDEX = 1.', [S('Key', '/IMAGE/INDEX, /IMAGE/NAME or /IMAGE/DESCRIPTION.'), S('Value', 'Value to match.')])]),
        C('InstallTo', 'Target disk and partition.', [I('DiskID', 'Disk number, starting at 0.', 0, 99), I('PartitionID', 'Partition number, starting at 1.', 1, 128)]),
        B('InstallToAvailablePartition', 'Install to the first available partition.'), E('WillShowUI', 'When to show the image page.', ['Always', 'OnError', 'Never'])])]),
      C('DiskConfiguration', 'Partitioning. The disk layout canvas edits this.', [E('WillShowUI', 'When to show the disk page.', ['Always', 'OnError', 'Never']), L('Disk', 'One disk.', [I('DiskID', 'Disk number.', 0, 99), B('WillWipeDisk', 'Erase the disk first.'),
        C('CreatePartitions', 'Partitions to create.', [L('CreatePartition', 'One partition.', [I('Order', 'Creation order.', 1, 128), E('Type', 'Partition type.', ['Primary', 'EFI', 'MSR', 'Extended', 'Logical']), I('Size', 'Size in MB.', 1, 99999999), B('Extend', 'Use the rest of the disk.')])]),
        C('ModifyPartitions', 'Format, label and letter for each partition.', [L('ModifyPartition', 'One partition.', [I('Order', 'Order.', 1, 128), I('PartitionID', 'Partition number.', 1, 128), E('Format', 'File system.', ['NTFS', 'FAT32']), S('Label', 'Volume label.'), S('Letter', 'Drive letter.'), B('Active', 'Mark active (BIOS boot).'), S('TypeID', 'Partition type GUID or MBR id.'), B('Extend', 'Extend to the rest of the disk.')])])])]),
      B('EnableFirewall', 'Turn on Windows Firewall during Setup.'), B('EnableNetwork', 'Turn on networking in Windows PE.'), E('Restart', 'Restart or shut down after Windows PE.', ['Restart', 'Shutdown']), B('UseConfigurationSet', 'Use a configuration set.'),
      C('DynamicUpdate', 'Download Setup updates.', [B('Enable', 'Turn on Dynamic Update.'), E('WillShowUI', 'When to show the page.', ['Always', 'OnError', 'Never'])]),
      C('ComplianceCheck', 'Upgrade compatibility report.', [E('DisplayReport', 'When to show the report.', ['OnError', 'Always', 'Never'])]),
      S('LogPath', 'Folder for Setup logs.'),
      C('RunSynchronous', 'Commands that run in Windows PE before installing.', [RUNSYNC('RunSynchronousCommand')]),
      C('RunAsynchronous', 'Commands that run in Windows PE without waiting.', [L('RunAsynchronousCommand', 'One command.', [I('Order', 'Order.', 1, 1000), S('Path', 'Command line.'), S('Description', 'Description.'), CREDS])])] },
    { name: 'Microsoft-Windows-PnpCustomizationsWinPE', passes: ['windowsPE'], help: 'Extra drivers for Windows PE and Setup (storage, network).', settings: [DRIVER_PATHS] },
    { name: 'Microsoft-Windows-PnpCustomizationsNonWinPE', passes: ['offlineServicing', 'auditSystem'], help: 'Drivers added to the installed image.', settings: [DRIVER_PATHS] },
    { name: 'Microsoft-Windows-International-Core', passes: ['specialize', 'oobeSystem'], help: 'Language and locale of the installed system.', settings: [
      S('InputLocale', 'Keyboard layout.'), S('SystemLocale', 'Language for non-Unicode programs.'), S('UILanguage', 'Display language.'), S('UILanguageFallback', 'Fallback language.'), S('UserLocale', 'Formats.')] },
    { name: 'Microsoft-Windows-Shell-Setup', passes: ['specialize', 'oobeSystem', 'auditSystem', 'auditUser'], help: 'Computer name, time zone, accounts, first sign-in and branding.', settings: [
      Object.assign(S('ComputerName', 'Up to 15 characters, or * for a random name.'), { passes: ['specialize'] }), S('RegisteredOrganization', 'Organization.'), S('RegisteredOwner', 'Owner.'),
      S('TimeZone', 'Windows time zone id, for example Pacific Standard Time.'), B('DisableAutoDaylightTimeSet', 'Do not adjust for daylight saving time.'),
      Object.assign(S('ProductKey', 'Product key applied in specialize.'), { passes: ['specialize'] }), Object.assign(B('CopyProfile', 'Copy the built-in Administrator profile to the default profile.'), { passes: ['specialize'] }),
      C('OEMInformation', 'Support details shown in Settings, System, About.', [B('HelpCustomized', 'Customized help.'), S('Logo', 'Path to a 120x120 BMP.'), S('Manufacturer', 'Manufacturer.'), S('Model', 'Model.'), S('SupportHours', 'Support hours.'), S('SupportPhone', 'Support phone.'), S('SupportURL', 'Support web address.')]),
      Object.assign(C('AutoLogon', 'Sign in automatically after Setup.', [B('Enabled', 'Turn on automatic sign-in.'), I('LogonCount', 'How many times.', 0, 999), S('Username', 'Account.'), S('Domain', 'Domain or computer name.'), P('Password', 'Password (Windows unattend encoding).')]), { passes: ['oobeSystem', 'auditSystem'] }),
      Object.assign(C('OOBE', 'Out-of-box experience pages.', [B('HideEULAPage', 'Hide the license page.'), B('HideLocalAccountScreen', 'Hide the local account page.'), B('HideOEMRegistrationScreen', 'Hide the OEM registration page.'), B('HideOnlineAccountScreens', 'Hide the Microsoft account pages.'), B('HideWirelessSetupInOOBE', 'Hide the Wi-Fi page.'), E('ProtectYourPC', 'Express settings: 1 recommended, 2 updates only, 3 off.', ['1', '2', '3']), E('NetworkLocation', 'Network type.', ['Home', 'Work', 'Other']), B('SkipMachineOOBE', 'Deprecated. Skip machine OOBE.'), B('SkipUserOOBE', 'Deprecated. Skip user OOBE.'), B('UnattendEnableRetailDemo', 'Retail demo mode.')]), { passes: ['oobeSystem'] }),
      Object.assign(C('UserAccounts', 'Administrator password and local accounts.', [P('AdministratorPassword', 'Built-in Administrator password.'), C('LocalAccounts', 'Local accounts to create.', [L('LocalAccount', 'One account.', [S('Name', 'User name.'), S('DisplayName', 'Display name.'), S('Description', 'Description.'), S('Group', 'Group, for example Administrators or Users.'), P('Password', 'Password.')])]),
        C('DomainAccounts', 'Domain accounts to add to local groups.', [L('DomainAccountList', 'Accounts from one domain.', [S('Domain', 'Domain.'), L('DomainAccount', 'One account.', [S('Name', 'Account.'), S('Group', 'Local group.')])], true)])]), { passes: ['oobeSystem', 'auditSystem'] }),
      Object.assign(C('FirstLogonCommands', 'Commands that run at the first sign-in.', [L('SynchronousCommand', 'One command.', [I('Order', 'Order.', 1, 1000), S('CommandLine', 'Command line.'), S('Description', 'Description.'), B('RequiresUserInput', 'Waits for the user.')])]), { passes: ['oobeSystem'] }),
      Object.assign(C('LogonCommands', 'Commands that run at each of the first sign-ins.', [L('AsynchronousCommand', 'One command.', [I('Order', 'Order.', 1, 1000), S('CommandLine', 'Command line.'), S('Description', 'Description.'), B('RequiresUserInput', 'Waits for the user.')])]), { passes: ['oobeSystem'] }),
      C('Themes', 'Default theme.', [S('ThemeName', 'Theme name.'), S('DesktopBackground', 'Wallpaper path.'), S('BrandIcon', 'Brand icon path.'), S('WindowColor', 'Accent color.'), B('DefaultThemesOff', 'Hide default themes.')])] },
    { name: 'Microsoft-Windows-UnattendedJoin', passes: ['specialize'], help: 'Joins the computer to a domain during specialize.', settings: [
      C('Identification', 'Domain or workgroup to join.', [S('JoinDomain', 'DNS name of the domain.'), S('JoinWorkgroup', 'Workgroup name instead of a domain.'), S('MachineObjectOU', 'OU for the computer account.'), S('MachinePassword', 'Password for an unsecure join.', { sensitive: true }), B('UnsecureJoin', 'Join with a pre-created account and machine password.'), B('DebugJoin', 'Stop Setup when the join fails.'), I('TimeoutPeriodInMinutes', 'Join timeout.', 1, 60),
        C('Credentials', 'Account allowed to join computers. Stored in plain text.', [S('Domain', 'Domain of the account.'), S('Username', 'User name.'), S('Password', 'Password, stored in plain text.', { sensitive: true })])])] },
    { name: 'Microsoft-Windows-Deployment', passes: ['specialize', 'auditSystem', 'auditUser', 'oobeSystem', 'generalize'], help: 'Commands during specialize and audit mode, and reseal behaviour.', settings: [
      Object.assign(C('RunSynchronous', 'Commands that run one after another as SYSTEM.', [RUNSYNC('RunSynchronousCommand')]), { passes: ['specialize', 'auditSystem', 'auditUser'] }),
      Object.assign(C('RunAsynchronous', 'Commands that start without waiting.', [L('RunAsynchronousCommand', 'One command.', [I('Order', 'Order.', 1, 1000), S('Path', 'Command line.'), S('Description', 'Description.'), CREDS])]), { passes: ['specialize', 'auditSystem', 'auditUser'] }),
      Object.assign(C('Reseal', 'What happens after this pass.', [E('Mode', 'Next mode.', ['Audit', 'OOBE']), B('ForceShutdownNow', 'Shut down instead of restarting.')]), { passes: ['oobeSystem', 'auditSystem', 'auditUser'] }),
      Object.assign(C('Generalize', 'Generalize behaviour.', [E('Mode', 'Mode.', ['Audit', 'OOBE']), B('ForceShutdownNow', 'Shut down.')]), { passes: ['generalize'] })] },
    { name: 'Microsoft-Windows-TCPIP', passes: ['specialize'], help: 'Static IP addresses and routes.', settings: [
      C('Interfaces', 'Network adapters.', [L('Interface', 'One adapter, identified by name or MAC address.', [S('Identifier', 'Adapter name (Ethernet) or MAC (00-15-5D-01-02-03).'),
        C('Ipv4Settings', 'IPv4.', [B('DhcpEnabled', 'Use DHCP.'), I('Metric', 'Interface metric.', 0, 9999), B('RouterDiscoveryEnabled', 'Router discovery.')]),
        C('UnicastIpAddresses', 'Addresses, for example 192.168.10.20/24.', [L('IpAddress', 'One address. Key is 1, 2, ...', [], true)]),
        C('Routes', 'Routes.', [L('Route', 'One route.', [S('Identifier', 'Route id.'), S('Prefix', 'Destination, 0.0.0.0/0 for the default route.'), S('NextHopAddress', 'Gateway.'), I('Metric', 'Metric.', 0, 9999)])])])])] },
    { name: 'Microsoft-Windows-DNS-Client', passes: ['specialize'], help: 'DNS servers and suffixes.', settings: [
      S('DNSDomain', 'Primary DNS suffix.'), B('UseDomainNameDevolution', 'Use parent suffixes.'), C('DNSSuffixSearchOrder', 'Suffix search list.', [L('DomainName', 'One suffix.', [], true)]),
      C('Interfaces', 'Per-adapter DNS.', [L('Interface', 'One adapter.', [S('Identifier', 'Adapter name or MAC.'), S('DNSDomain', 'Suffix for this adapter.'), B('EnableAdapterDomainNameRegistration', 'Register this suffix.'), C('DNSServerSearchOrder', 'DNS servers.', [L('IpAddress', 'One server. Key is 1, 2, ...', [], true)])])])] },
    { name: 'Microsoft-Windows-TerminalServices-LocalSessionManager', passes: ['offlineServicing', 'specialize'], help: 'Remote Desktop connections.', settings: [B('fDenyTSConnections', 'false allows Remote Desktop connections.')] },
    { name: 'Microsoft-Windows-TerminalServices-RDP-WinStationExtensions', passes: ['specialize'], help: 'Remote Desktop security.', settings: [E('UserAuthentication', '1 requires Network Level Authentication.', ['0', '1']), E('SecurityLayer', '0 RDP, 1 negotiate, 2 TLS.', ['0', '1', '2'])] },
    { name: 'Networking-MPSSVC-Svc', passes: ['specialize'], help: 'Windows Firewall profiles and rule groups.', settings: [
      B('DomainProfile_EnableFirewall', 'Firewall on for the domain profile.'), B('PrivateProfile_EnableFirewall', 'Firewall on for the private profile.'), B('PublicProfile_EnableFirewall', 'Firewall on for the public profile.'),
      C('FirewallGroups', 'Rule groups to turn on or off.', [L('FirewallGroup', 'One group. Key is any unique name.', [B('Active', 'Turn the group on.'), S('Group', 'Group name, for example Remote Desktop.'), E('Profile', 'Profile.', ['all', 'Domain', 'Private', 'Public'])], true)])] },
    { name: 'Microsoft-Windows-LUA-Settings', passes: ['offlineServicing', 'specialize'], help: 'User Account Control.', settings: [B('EnableLUA', 'false turns UAC off (not recommended).')] },
    { name: 'Microsoft-Windows-IE-ESC', passes: ['specialize'], platforms: ['server'], help: 'Internet Explorer Enhanced Security Configuration.', settings: [B('IEHardenAdmin', 'For administrators.'), B('IEHardenUser', 'For users.')] },
    { name: 'Microsoft-Windows-ServerManager-SvrMgrNc', passes: ['specialize'], platforms: ['server'], help: 'Server Manager at sign-in.', settings: [B('DoNotOpenServerManagerAtLogon', 'Do not open Server Manager at sign-in.')] },
    { name: 'Microsoft-Windows-SQMApi', passes: ['specialize', 'oobeSystem'], help: 'Customer Experience Improvement Program.', settings: [E('CEIPEnabled', '0 off, 1 on.', ['0', '1'])] },
    { name: 'Microsoft-Windows-ErrorReportingCore', passes: ['specialize', 'oobeSystem'], help: 'Windows Error Reporting.', settings: [E('DisableWER', '1 turns error reporting off.', ['0', '1'])] },
    { name: 'Microsoft-Windows-Security-SPP-UX', passes: ['specialize'], help: 'Activation.', settings: [B('SkipAutoActivation', 'Do not activate automatically.')] },
    { name: 'Microsoft-Windows-Security-SPP', passes: ['generalize', 'specialize'], help: 'Software protection.', settings: [E('SkipRearm', '1 keeps the activation timer when generalizing.', ['0', '1'])] },
    { name: 'Microsoft-Windows-powercpl', passes: ['specialize', 'oobeSystem'], platforms: ['client'], help: 'Power plan.', settings: [S('PreferredPlan', 'Power plan GUID.')] }
  ].map((c) => Object.assign({ platforms: ['client', 'server'] }, c))
};

let current = null;
// Loads payload/answerfile/unattend-catalog.json when the build copied it; else the core subset.
export async function loadCatalog(root) {
  if (current) return current;
  try {
    const r = await fetch((root || './') + 'answerfile/unattend-catalog.json', { cache: 'no-cache' });
    if (r.ok) {
      const j = await r.json();
      const n = normalizeCatalog(j, 'full');
      if (n.components.length) { n.raw = j; current = n; return current; }
    }
  } catch (e) { /* fall through to core */ }
  current = normalizeCatalog(CORE_CATALOG, 'core');
  return current;
}
export function useCatalog(cat) { current = cat; }

// ---- helpers on values ------------------------------------------------------------------------
export function isEmpty(v) {
  if (v === undefined || v === null || v === '') return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return v['@password'] === undefined && v['#text'] === undefined && Object.keys(v).filter((k) => k[0] !== '@').every((k) => isEmpty(v[k]));
  return false;
}
export function countSet(v) {
  if (isEmpty(v)) return 0;
  if (Array.isArray(v)) return v.reduce((n, x) => n + Math.max(1, countSet(x)), 0);
  if (typeof v === 'object') {
    if (v['@password'] !== undefined || v['#text'] !== undefined) return 1;
    return Object.keys(v).filter((k) => k[0] !== '@').reduce((n, k) => n + countSet(v[k]), 0);
  }
  return 1;
}
export function prune(v) {
  if (Array.isArray(v)) return v.map(prune).filter((x) => !isEmpty(x));
  if (v && typeof v === 'object') {
    if (v['@password'] !== undefined) return v;
    const out = {};
    for (const k of Object.keys(v)) { const p = k[0] === '@' || k === '#text' ? v[k] : prune(v[k]); if (k[0] === '@' || k === '#text' || !isEmpty(p)) out[k] = p; }
    return out;
  }
  return v;
}
// Reorders a value object to catalog (documentation) order, the order Windows SIM writes.
export function orderLike(settings, v) {
  if (!v || typeof v !== 'object' || Array.isArray(v) || v['@password'] !== undefined) return v;
  const out = {};
  const names = settings.map((s) => s.name);
  Object.keys(v).filter((k) => k[0] === '@' || k === '#text').forEach((k) => { out[k] = v[k]; });
  names.concat(Object.keys(v).filter((k) => !names.includes(k))).forEach((k) => {
    if (!(k in v) || k[0] === '@' || k === '#text') return;
    const s = settings.find((x) => x.name === k);
    const kids = s ? s.children : [];
    out[k] = Array.isArray(v[k]) ? v[k].map((it) => orderLike(kids, it)) : orderLike(kids, v[k]);
  });
  return out;
}
export function settingAllowedPasses(comp, setting) { return setting && setting.passes && setting.passes.length ? setting.passes.filter((p) => comp.passes.includes(p)) : comp.passes; }

// Flatten names for search: "Component Setting/Child ..."
export function searchText(comp) {
  const names = [];
  (function walk(list) { list.forEach((s) => { names.push(s.name, s.help); walk(s.children); }); })(comp.settings);
  return comp.name + ' ' + comp.help + ' ' + names.join(' ');
}

// ---- form renderer ----------------------------------------------------------------------------
// renderSettings(comp, value, onChange, ctx) -> element. value is the component value object.
// onChange(newValue, message) receives a pruned copy and a {key, args} history message.
// ctx: { t, pass, idPrefix, revealPasswords }
export function renderSettings(comp, value, onChange, ctx) {
  const t = ctx.t;
  const state = { v: clone(value || {}) };
  const root = h('div', { class: 'cat-settings' });
  function commit(msgKey, args, coalesce) { onChange(orderLike(comp.settings, prune(state.v)), { key: msgKey, args }, coalesce); }
  function getAt(obj, key) { return obj ? obj[key] : undefined; }
  function setAt(obj, key, v) { if (v === undefined) delete obj[key]; else obj[key] = v; }
  let uid = 0;
  function node(setting, holder, label) {
    const id = (ctx.idPrefix || 'cat') + '-' + (uid++);
    const passes = settingAllowedPasses(comp, setting);
    if (ctx.pass && !passes.includes(ctx.pass)) return null;
    const cur = getAt(holder(), setting.name);
    const wrap = h('div', { class: 'cat-set', 'data-setting-path': comp.name + '/' + setting.path, 'data-palette-field': comp.name + ' / ' + setting.path, 'data-palette-group': t('tab.all', null, 'All settings') });
    const head = h('div', { class: 'cat-name' }, [h('label', { for: id, text: setting.name })]);
    const mark = h('span', { class: 'setmark', hidden: isEmpty(cur), text: t('cat.set', null, 'set') });
    head.appendChild(mark);
    if (setting.sensitive) head.appendChild(h('span', { class: 'sensitive', text: t('cat.sensitive', null, 'sensitive') }));
    if (setting.deprecated) head.appendChild(h('span', { class: 'pass-chip', text: t('cat.deprecated', null, 'deprecated') }));
    wrap.appendChild(head);
    const refresh = () => { mark.hidden = isEmpty(getAt(holder(), setting.name)); };
    const msgPath = comp.name + ' ' + setting.path;
    let control;
    if (setting.type === 'container') {
      const wantOpen = ctx.expandPath && (ctx.expandPath === setting.path || ctx.expandPath.startsWith(setting.path + '/'));
      const det = h('details', { class: 'cat-group', open: !isEmpty(cur) || wantOpen || undefined });
      det.appendChild(h('summary', { text: setting.name + (setting.children.length ? ' (' + setting.children.length + ')' : '') }));
      const box = h('div');
      const sub = () => { const hld = holder(); if (!hld[setting.name] || typeof hld[setting.name] !== 'object' || Array.isArray(hld[setting.name])) hld[setting.name] = {}; return hld[setting.name]; };
      let built = false;
      const build = () => { if (built) return; built = true; setting.children.forEach((c) => { const n = node(c, sub); if (n) box.appendChild(n); }); };
      det.addEventListener('toggle', () => { if (det.open) build(); });
      if (det.open) build();
      det.appendChild(box);
      wrap.replaceChildren(det);
      if (setting.help) det.insertBefore(h('div', { class: 'help', text: setting.help }), box);
      return wrap;
    }
    if (setting.type === 'list' || setting.type === 'stringList') {
      control = listEditor(setting, holder, refresh, msgPath);
    } else if (setting.type === 'boolean') {
      const sw = h('input', { type: 'checkbox', id, role: 'switch', checked: String(cur).toLowerCase() === 'true' });
      const clear = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: t('cat.clear', null, 'Not set'), onclick: () => { setAt(holder(), setting.name, undefined); sw.checked = false; refresh(); commit('hist.unset', [msgPath]); } });
      sw.addEventListener('change', () => { setAt(holder(), setting.name, sw.checked ? 'true' : 'false'); refresh(); commit('hist.set', [msgPath, sw.checked ? 'true' : 'false']); });
      control = h('div', { class: 'inline', style: { alignItems: 'center' } }, [h('label', { class: 'switch' }, [sw, h('span', { text: 'true / false' })]), clear]);
    } else if (setting.type === 'enum') {
      const sel = h('select', { id }, [h('option', { value: '', text: t('cat.notSet', null, '(not set)') })].concat(setting.values.map((v) => h('option', { value: v.value, text: v.label + (v.help ? ': ' + v.help : '') }))));
      sel.value = cur === undefined ? '' : String(cur);
      sel.addEventListener('change', () => { setAt(holder(), setting.name, sel.value === '' ? undefined : sel.value); refresh(); commit(sel.value === '' ? 'hist.unset' : 'hist.set', [msgPath, sel.value]); });
      control = sel;
    } else if (setting.type === 'password') {
      const pw = cur && typeof cur === 'object' ? cur['@password'] || '' : cur || '';
      const inp = h('input', { type: ctx.revealPasswords ? 'text' : 'password', id, value: pw, autocomplete: 'new-password', spellcheck: 'false' });
      inp.addEventListener('input', () => { setAt(holder(), setting.name, inp.value ? { '@password': inp.value } : undefined); refresh(); commit('hist.setSecret', [msgPath], id); });
      control = h('div', { class: 'inline' }, [inp, iconButton('eye', t('pw.show', null, 'Show or hide'), () => { inp.type = inp.type === 'password' ? 'text' : 'password'; })]);
    } else {
      const isInt = setting.type === 'integer';
      const inp = h('input', { type: isInt ? 'number' : setting.sensitive ? 'password' : 'text', id, value: cur === undefined ? '' : String(typeof cur === 'object' ? cur['#text'] || '' : cur), min: setting.min, max: setting.max, maxlength: setting.maxLength, inputmode: isInt ? 'numeric' : undefined, spellcheck: 'false', autocomplete: 'off' });
      const err = h('div', { class: 'err', role: 'alert' });
      inp.addEventListener('input', () => {
        const v = inp.value;
        let bad = '';
        if (isInt && v !== '') {
          if (!/^-?\d+$/.test(v)) bad = t('cat.errInt', null, 'Enter a whole number.');
          else if (setting.min !== undefined && Number(v) < setting.min) bad = t('cat.errMin', [setting.min], 'Minimum {0}.');
          else if (setting.max !== undefined && Number(v) > setting.max) bad = t('cat.errMax', [setting.max], 'Maximum {0}.');
        }
        err.textContent = bad;
        inp.setAttribute('aria-invalid', String(!!bad));
        setAt(holder(), setting.name, v === '' ? undefined : v);
        refresh();
        commit(v === '' ? 'hist.unset' : setting.sensitive ? 'hist.setSecret' : 'hist.set', [msgPath, v.length > 40 ? v.slice(0, 40) + '...' : v], id);
      });
      control = setting.sensitive ? h('div', { class: 'inline' }, [inp, iconButton('eye', t('pw.show', null, 'Show or hide'), () => { inp.type = inp.type === 'password' ? 'text' : 'password'; })]) : inp;
      wrap.appendChild(control);
      wrap.appendChild(err);
      control = null;
    }
    if (control) wrap.appendChild(control);
    if (setting.help) wrap.appendChild(h('div', { class: 'help', text: setting.help }));
    if (setting.passes.length && setting.passes.length < comp.passes.length) wrap.appendChild(h('div', { class: 'pass-chips' }, setting.passes.map((p) => h('span', { class: 'pass-chip', text: p }))));
    return wrap;
  }
  function listEditor(setting, holder, refresh, msgPath) {
    const box = h('div', { class: 'list-ed' });
    const items = () => { const hld = holder(); if (!Array.isArray(hld[setting.name])) hld[setting.name] = []; return hld[setting.name]; };
    function draw() {
      box.replaceChildren();
      items().forEach((item, i) => {
        const row = h('div', { class: 'list-row' });
        const isScalar = setting.type === 'stringList' || !setting.children.length;
        if (setting.keyed) {
          const key = h('input', { type: 'text', value: item && item['@keyValue'] !== undefined ? item['@keyValue'] : String(i + 1), 'aria-label': t('cat.key', null, 'Key (wcm:keyValue)'), placeholder: t('cat.key', null, 'Key (wcm:keyValue)') });
          key.addEventListener('input', () => { const it = items()[i]; if (typeof it !== 'object') items()[i] = { '#text': it }; items()[i]['@keyValue'] = key.value; commit('hist.set', [msgPath + ' #' + (i + 1), key.value], 'k' + setting.path + i); });
          row.appendChild(h('div', { class: 'field' }, [h('label', { text: t('cat.key', null, 'Key (wcm:keyValue)') }), key]));
        }
        if (isScalar) {
          const v = item && typeof item === 'object' ? item['#text'] || '' : item || '';
          const inp = h('input', { type: 'text', value: v, 'aria-label': setting.name + ' ' + (i + 1) });
          inp.addEventListener('input', () => {
            const it = items()[i];
            if (it && typeof it === 'object') it['#text'] = inp.value; else items()[i] = setting.keyed ? { '#text': inp.value, '@keyValue': String(i + 1) } : inp.value;
            refresh(); commit('hist.set', [msgPath + ' #' + (i + 1), inp.value], 's' + setting.path + i);
          });
          row.appendChild(h('div', { class: 'field' }, [h('label', { text: setting.name + ' ' + (i + 1) }), inp]));
        } else {
          const sub = () => { const arr2 = items(); if (!arr2[i] || typeof arr2[i] !== 'object') arr2[i] = {}; return arr2[i]; };
          setting.children.forEach((c) => { const n = node(c, sub); if (n) row.appendChild(n); });
        }
        const move = (d) => { const a = items(); const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; draw(); commit('hist.reorder', [msgPath]); };
        row.appendChild(h('div', { class: 'row-tools' }, [
          iconButton('up', t('list.up', null, 'Move up'), () => move(-1), { disabled: i === 0 || undefined }),
          iconButton('down', t('list.down', null, 'Move down'), () => move(1), { disabled: i === items().length - 1 || undefined }),
          iconButton('del', t('list.remove', null, 'Remove'), () => { items().splice(i, 1); draw(); refresh(); commit('hist.removeItem', [msgPath]); })
        ]));
        box.appendChild(row);
      });
      box.appendChild(h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: t('list.add', null, 'Add item'), onclick: () => {
        const a = items();
        a.push(setting.type === 'stringList' || !setting.children.length ? (setting.keyed ? { '#text': '', '@keyValue': String(a.length + 1) } : '') : (setting.keyed ? { '@keyValue': String(a.length + 1) } : {}));
        draw(); commit('hist.addItem', [msgPath]);
      } }));
    }
    draw();
    return box;
  }
  comp.settings.forEach((s) => { const n = node(s, () => state.v); if (n) root.appendChild(n); });
  if (!root.children.length) root.appendChild(h('p', { class: 'empty', text: t('cat.noneInPass', null, 'This component has no settings in this pass.') }));
  return root;
}
