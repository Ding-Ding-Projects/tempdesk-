// TempDesk answer file validation rules.
//
// Pure, dependency-free ES module (browser and Node). Every check is one entry in RULES with a stable id,
// a default severity and a short title, so builders can show, filter or suppress issues by id.
//
//   import { validateModel, RULES } from './rules.mjs';
//   const issues = validateModel(model, catalog, { diskSizesMB: { 0: 61440 } });
//   // -> [{ id: 'disk.efiSize', level: 'error', where: 'windowsPE/Microsoft-Windows-Setup/...', message: '...' }]
//
// options:
//   diskSizesMB  { [DiskID]: sizeInMB }  sizes of the target disks, for the disk.fit rule
//   disable      [ruleId...]             rules to skip
//   severity     { [ruleId]: 'error'|'warning'|'info' }  severity overrides

export const PASS_ORDER = ['windowsPE', 'offlineServicing', 'generalize', 'specialize', 'auditSystem', 'auditUser', 'oobeSystem'];
export const PACKAGE_ACTIONS = ['install', 'configure', 'remove', 'stage'];
export const PACKAGE_PERMANENCE = ['removable', 'permanent', 'temporary'];
// Characters used by Windows product keys (Windows 8 and later add N).
const PRODUCT_KEY_ALPHABET = /^[BCDFGHJKMNPQRTVWXY2346789-]+$/i;
const COMPUTER_NAME_BAD = /[{|}~[\\\]^':;<=>?@!"#$%`()+/.,*&\s]/;

const SETUP = 'Microsoft-Windows-Setup';
const SHELL = 'Microsoft-Windows-Shell-Setup';
const JOIN = 'Microsoft-Windows-UnattendedJoin';
const DEPLOY = 'Microsoft-Windows-Deployment';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const has = (v) => v !== undefined && v !== null && v !== '';
const isSet = (v) => v !== undefined && v !== null;
const isTrue = (v) => v === true || (typeof v === 'string' && /^true$/i.test(v.trim()));
const text = (v) => (typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v));
const num = (v) => (isSet(v) && /^-?\d+$/.test(text(v).trim()) ? Number(text(v).trim()) : NaN);
const utf8Bytes = (s) => new TextEncoder().encode(s).length;
const relPath = (s) => (s.itemPath !== undefined ? s.itemPath : s.path);

const indexCache = new WeakMap();
function indexCatalog(catalog) {
  let idx = indexCache.get(catalog);
  if (idx) return idx;
  const byName = new Map();
  for (const comp of catalog.components) {
    const top = new Map();
    const walk = (list) => {
      for (const s of list) {
        if (s.itemPath === undefined) top.set(s.path, s);
        if (s.children) walk(s.children);
        if (s.listItem) walk(s.listItem.settings);
      }
    };
    walk(comp.settings);
    byName.set(comp.name.toLowerCase(), { comp, top });
  }
  idx = { byName };
  indexCache.set(catalog, idx);
  return idx;
}

function listScope(listSetting) {
  const m = new Map();
  const walk = (list) => {
    for (const c of list) {
      m.set(relPath(c), c);
      if (c.children) walk(c.children);
    }
  };
  walk(listSetting.listItem.settings);
  return m;
}

/** Collect every value in the model once, with its catalog description. */
function collect(model, catalog) {
  const out = { passes: [], comps: [], entries: [], lists: [] };
  const idx = indexCatalog(catalog);
  for (const [pass, comps] of Object.entries((model && model.passes) || {})) {
    out.passes.push({ pass, known: PASS_ORDER.includes(pass) });
    if (!PASS_ORDER.includes(pass)) continue;
    for (const [compName, values] of Object.entries(comps || {})) {
      const e = idx.byName.get(compName.toLowerCase());
      out.comps.push({ pass, name: compName, comp: e ? e.comp : null, values: values || {} });
      if (!e) continue;
      const scan = (scope, vals, where, parentItem) => {
        for (const [key, value] of Object.entries(vals || {})) {
          if (key === '_action') continue;
          const s = scope.get(key) || null;
          const entry = { pass, comp: e.comp.name, key, where: `${where}/${key}`, s, value, item: parentItem };
          out.entries.push(entry);
          if (s && s.type === 'list' && Array.isArray(value)) {
            out.lists.push({ ...entry, items: value });
            const child = listScope(s);
            value.forEach((it, i) => scan(child, it, `${where}/${key}[${i}]`, it));
          }
        }
      };
      scan(e.top, values, `${pass}/${e.comp.name}`, null);
    }
  }
  return out;
}

/** Values of one component in every pass where the model sets it: [{pass, values, where}]. */
function comps(model, name) {
  const out = [];
  for (const [pass, cs] of Object.entries((model && model.passes) || {})) {
    for (const [cn, values] of Object.entries(cs || {})) {
      if (cn.toLowerCase() === name.toLowerCase()) out.push({ pass, values: values || {}, where: `${pass}/${name}` });
    }
  }
  return out;
}

/** Disk layouts in Microsoft-Windows-Setup: [{pass, where, disk, id, creates, modifies, gpt, numbered}]. */
function disks(model) {
  const out = [];
  for (const { pass, values, where } of comps(model, SETUP)) {
    const list = values['DiskConfiguration/Disk'];
    if (!Array.isArray(list)) continue;
    list.forEach((disk, i) => {
      const dwhere = `${where}/DiskConfiguration/Disk[${i}]`;
      const creates = (Array.isArray(disk['CreatePartitions/CreatePartition']) ? disk['CreatePartitions/CreatePartition'] : [])
        .map((p, j) => ({ p, j, order: num(p.Order), type: String(p.Type || '').trim() }))
        .sort((a, b) => (Number.isNaN(a.order) ? 1e9 : a.order) - (Number.isNaN(b.order) ? 1e9 : b.order));
      const modifies = Array.isArray(disk['ModifyPartitions/ModifyPartition']) ? disk['ModifyPartitions/ModifyPartition'] : [];
      const gpt = creates.some((c) => /^(EFI|MSR)$/i.test(c.type));
      // Partition numbers follow creation order; an Extended container takes no number of its own.
      const numbered = creates.filter((c) => !/^Extended$/i.test(c.type));
      out.push({ pass, where: dwhere, disk, id: num(disk.DiskID), creates, modifies, gpt, numbered });
    });
  }
  return out;
}

const partitionByNumber = (d, n) => (Number.isInteger(n) && n >= 1 ? d.numbered[n - 1] : undefined);

// ---------------------------------------------------------------------------
// rules
// ---------------------------------------------------------------------------

export const RULES = [
  // --- catalog and structure -------------------------------------------------
  {
    id: 'pass.unknown', severity: 'error', title: 'Unknown configuration pass',
    check: (c, r) => c.passes.filter((p) => !p.known).forEach((p) => r(p.pass, `"${p.pass}" is not a Windows Setup configuration pass`)),
  },
  {
    id: 'component.unknown', severity: 'error', title: 'Component not in the catalog',
    check: (c, r) => c.comps.filter((x) => !x.comp).forEach((x) => r(`${x.pass}/${x.name}`, 'component is not documented in the unattend reference')),
  },
  {
    id: 'component.passNotAllowed', severity: 'warning', title: 'Component has no settings for this pass',
    check: (c, r) => c.comps.filter((x) => x.comp && !x.comp.passes.includes(x.pass))
      .forEach((x) => r(`${x.pass}/${x.comp.name}`, `no setting of this component is valid in ${x.pass} (valid: ${x.comp.passes.join(', ')})`)),
  },
  {
    id: 'setting.unknown', severity: 'error', title: 'Setting not in the catalog',
    check: (c, r) => c.entries.filter((e) => !e.s).forEach((e) => r(e.where, 'unknown setting')),
  },
  {
    id: 'setting.passNotAllowed', severity: 'error', title: 'Setting placed in a pass the reference does not allow',
    check: (c, r) => c.entries.filter((e) => e.s && e.s.passes && !e.s.passes.includes(e.pass))
      .forEach((e) => r(e.where, `not valid in the ${e.pass} pass (valid: ${e.s.passes.join(', ')})`)),
  },
  {
    id: 'setting.deprecated', severity: 'warning', title: 'Deprecated setting',
    check: (c, r) => c.entries.filter((e) => e.s && e.s.deprecated).forEach((e) => r(e.where, 'deprecated setting; Windows may ignore it')),
  },
  {
    id: 'value.list', severity: 'error', title: 'List setting needs an array of items',
    check: (c, r) => c.entries.filter((e) => e.s && e.s.type === 'list' && isSet(e.value) && !Array.isArray(e.value))
      .forEach((e) => r(e.where, 'list setting needs an array of items')),
  },
  {
    id: 'value.boolean', severity: 'error', title: 'Boolean value must be true or false',
    check: (c, r) => c.entries.filter((e) => e.s && e.s.type === 'boolean' && isSet(e.value) && !/^(true|false)$/i.test(text(e.value).trim()))
      .forEach((e) => r(e.where, `value ${text(e.value)} is not true or false`)),
  },
  {
    id: 'value.enum', severity: 'warning', title: 'Value is not one of the documented choices',
    check: (c, r) => c.entries.filter((e) => e.s && e.s.type === 'enum' && isSet(e.value) && e.s.values
      && !e.s.values.some((v) => v.value.toLowerCase() === text(e.value).trim().toLowerCase()))
      .forEach((e) => r(e.where, `value ${text(e.value)} is not one of ${e.s.values.map((v) => v.value).join(', ')}`)),
  },
  {
    id: 'value.integer', severity: 'error', title: 'Value must be an integer',
    check: (c, r) => c.entries.filter((e) => e.s && e.s.type === 'integer' && has(e.value) && Number.isNaN(num(e.value)))
      .forEach((e) => r(e.where, 'expected an integer')),
  },
  {
    id: 'value.range', severity: 'error', title: 'Integer outside the documented range',
    check: (c, r) => c.entries.filter((e) => e.s && e.s.type === 'integer' && !Number.isNaN(num(e.value))).forEach((e) => {
      const n = num(e.value);
      if (e.s.min !== undefined && n < e.s.min) r(e.where, `below minimum ${e.s.min}`);
      if (e.s.max !== undefined && n > e.s.max) r(e.where, `above maximum ${e.s.max}`);
    }),
  },
  {
    id: 'value.maxLength', severity: 'error', title: 'Text longer than the documented maximum',
    check: (c, r) => c.entries.filter((e) => e.s && e.s.maxLength !== undefined && isSet(e.value) && !Array.isArray(e.value)
      && text(e.value).length > e.s.maxLength && e.s.name !== 'ComputerName')
      .forEach((e) => r(e.where, `longer than ${e.s.maxLength} characters`)),
  },
  {
    id: 'list.keyMissing', severity: 'error', title: 'List item has no key',
    check: (c, r) => c.lists.forEach((l) => {
      const li = l.s.listItem;
      if (!li.keyed || !li.key) return;
      l.items.forEach((it, i) => {
        if (it && !has(it[li.key])) {
          const hard = li.keyStyle === 'keyValue' || li.key === 'Order';
          r(`${l.where}[${i}]`, `missing ${li.key}${hard ? '' : ' (recommended so the item can be identified)'}`, hard ? 'error' : 'warning');
        }
      });
    }),
  },
  {
    id: 'list.keyDuplicate', severity: 'error', title: 'Two list items share a key',
    check: (c, r) => c.lists.forEach((l) => {
      const li = l.s.listItem;
      if (!li.keyed || !li.key || li.key === 'Order') return;
      const seen = new Map();
      l.items.forEach((it, i) => {
        if (!it || !has(it[li.key])) return;
        const k = text(it[li.key]).toLowerCase();
        if (seen.has(k)) r(`${l.where}[${i}]`, `duplicate ${li.key} ${text(it[li.key])} (also item ${seen.get(k)})`);
        else seen.set(k, i);
      });
    }),
  },
  {
    id: 'list.orderUnique', severity: 'error', title: 'Ordered list items need unique Order values',
    check: (c, r) => c.lists.forEach((l) => {
      if (l.s.listItem.key !== 'Order') return;
      const seen = new Map();
      l.items.forEach((it, i) => {
        if (!it || !has(it.Order)) return;
        const k = text(it.Order).trim();
        if (seen.has(k)) r(`${l.where}[${i}]`, `Order ${k} is already used by item ${seen.get(k)}`);
        else seen.set(k, i);
      });
    }),
  },

  // --- domain join -----------------------------------------------------------
  {
    id: 'join.exclusive', severity: 'error', title: 'JoinDomain and JoinWorkgroup are mutually exclusive',
    check: (c, r, m) => comps(m, JOIN).forEach(({ values: v, where }) => {
      if (has(v['Identification/JoinDomain']) && has(v['Identification/JoinWorkgroup'])) {
        r(`${where}/Identification`, 'set either JoinDomain or JoinWorkgroup, not both (Windows uses JoinDomain and ignores JoinWorkgroup)');
      }
    }),
  },
  {
    id: 'join.credentials', severity: 'error', title: 'Domain join needs credentials or a provisioned account',
    check: (c, r, m) => comps(m, JOIN).forEach(({ values: v, where }) => {
      if (!has(v['Identification/JoinDomain'])) return;
      const creds = has(v['Identification/Credentials/Username']) && isSet(v['Identification/Credentials/Password']);
      const blob = has(v['Identification/Provisioning/AccountData']);
      const unsecure = isTrue(v['Identification/UnsecureJoin']) || has(v['Identification/MachinePassword']);
      if (!creds && !blob && !unsecure) {
        r(`${where}/Identification/JoinDomain`, 'add Credentials (Username and Password), Provisioning/AccountData, or a pre-staged account with UnsecureJoin or MachinePassword');
      }
    }),
  },
  {
    id: 'join.credentialsIncomplete', severity: 'warning', title: 'Join credentials are incomplete',
    check: (c, r, m) => comps(m, JOIN).forEach(({ values: v, where }) => {
      const keys = ['Domain', 'Username', 'Password'].map((k) => `Identification/Credentials/${k}`);
      const set = keys.filter((k) => isSet(v[k]));
      if (set.length && set.length < 3) r(`${where}/Identification/Credentials`, `Credentials should have Domain, Username and Password (missing ${keys.filter((k) => !isSet(v[k])).map((k) => k.split('/').pop()).join(', ')})`);
    }),
  },
  {
    id: 'join.ouWithoutDomain', severity: 'warning', title: 'MachineObjectOU without JoinDomain',
    check: (c, r, m) => comps(m, JOIN).forEach(({ values: v, where }) => {
      if (has(v['Identification/MachineObjectOU']) && !has(v['Identification/JoinDomain'])) r(`${where}/Identification/MachineObjectOU`, 'MachineObjectOU is only used when JoinDomain is set');
    }),
  },

  // --- computer name ---------------------------------------------------------
  {
    id: 'computerName.length', severity: 'error', title: 'ComputerName longer than 15 bytes',
    check: (c, r) => computerNames(c).forEach((e) => {
      const s = text(e.value);
      if (s !== '*' && utf8Bytes(s) > 15) r(e.where, `ComputerName is ${utf8Bytes(s)} bytes; the limit is 15 bytes`);
    }),
  },
  {
    id: 'computerName.digits', severity: 'error', title: 'ComputerName cannot be only digits',
    check: (c, r) => computerNames(c).forEach((e) => {
      if (/^\d+$/.test(text(e.value))) r(e.where, 'ComputerName cannot consist only of digits (it fails DNS name validation)');
    }),
  },
  {
    id: 'computerName.chars', severity: 'error', title: 'ComputerName contains a character Windows rejects',
    check: (c, r) => computerNames(c).forEach((e) => {
      const s = text(e.value);
      if (s !== '*' && COMPUTER_NAME_BAD.test(s)) r(e.where, 'ComputerName cannot contain spaces or any of { | } ~ [ \\ ] ^ \' : ; < = > ? @ ! " # $ % ` ( ) + / . , * &');
    }),
  },

  // --- AutoLogon ---------------------------------------------------------------
  {
    id: 'autologon.password', severity: 'error', title: 'AutoLogon enabled without a password',
    check: (c, r, m) => comps(m, SHELL).forEach(({ values: v, where }) => {
      if (isTrue(v['AutoLogon/Enabled']) && !isSet(v['AutoLogon/Password/Value'])) r(`${where}/AutoLogon`, 'AutoLogon is enabled but AutoLogon/Password/Value is not set (write an empty string for a blank password)');
    }),
  },
  {
    id: 'autologon.logonCount', severity: 'error', title: 'AutoLogon enabled without LogonCount',
    check: (c, r, m) => comps(m, SHELL).forEach(({ values: v, where }) => {
      if (isTrue(v['AutoLogon/Enabled']) && !has(v['AutoLogon/LogonCount'])) r(`${where}/AutoLogon`, 'AutoLogon is enabled but LogonCount is not set');
    }),
  },
  {
    id: 'autologon.username', severity: 'error', title: 'AutoLogon enabled without Username',
    check: (c, r, m) => comps(m, SHELL).forEach(({ values: v, where }) => {
      if (isTrue(v['AutoLogon/Enabled']) && !has(v['AutoLogon/Username'])) r(`${where}/AutoLogon`, 'AutoLogon is enabled but Username is not set');
    }),
  },
  {
    id: 'password.blankAdministrator', severity: 'warning', title: 'Blank built-in Administrator password',
    check: (c, r, m) => comps(m, SHELL).forEach(({ values: v, where }) => {
      for (const k of ['UserAccounts/AdministratorPassword/Value', 'OfflineUserAccounts/OfflineAdministratorPassword/Value']) {
        if (v[k] === '') r(`${where}/${k}`, 'an empty value enables the built-in Administrator with a blank password');
      }
    }),
  },

  // --- commands ----------------------------------------------------------------
  {
    id: 'command.willReboot', severity: 'error', title: 'RunSynchronous WillReboot must be Always, OnRequest or Never',
    check: (c, r) => c.lists.filter((l) => l.s.name === 'RunSynchronousCommand').forEach((l) => l.items.forEach((it, i) => {
      if (it && isSet(it.WillReboot) && !['Always', 'OnRequest', 'Never'].includes(text(it.WillReboot))) {
        r(`${l.where}[${i}]/WillReboot`, `WillReboot ${text(it.WillReboot)} is not Always, OnRequest or Never`);
      }
    })),
  },
  {
    id: 'command.missing', severity: 'error', title: 'Command item without a command line',
    check: (c, r) => c.lists.forEach((l) => {
      const field = { RunSynchronousCommand: 'Path', RunAsynchronousCommand: 'Path', SynchronousCommand: 'CommandLine', AsynchronousCommand: 'CommandLine' }[l.s.name];
      if (!field) return;
      l.items.forEach((it, i) => {
        if (it && !has(it[field])) r(`${l.where}[${i}]`, `missing ${field}`);
      });
    }),
  },

  // --- product key -------------------------------------------------------------
  {
    id: 'productKey.format', severity: 'error', title: 'Product key must be five groups of five characters',
    check: (c, r) => productKeys(c).forEach((e) => {
      if (!/^[A-Z0-9]{5}(-[A-Z0-9]{5}){4}$/i.test(text(e.value).trim())) r(e.where, 'expected XXXXX-XXXXX-XXXXX-XXXXX-XXXXX');
    }),
  },
  {
    id: 'productKey.alphabet', severity: 'warning', title: 'Product key uses characters Windows keys never contain',
    check: (c, r) => productKeys(c).forEach((e) => {
      const s = text(e.value).trim();
      if (/^[A-Z0-9]{5}(-[A-Z0-9]{5}){4}$/i.test(s) && !PRODUCT_KEY_ALPHABET.test(s)) r(e.where, 'Windows product keys use only BCDFGHJKMNPQRTVWXY2346789; check for typos such as 0 for O or 1 for I');
    }),
  },

  // --- disk layout -------------------------------------------------------------
  {
    id: 'disk.extendCount', severity: 'error', title: 'Only one partition per disk can extend',
    check: (c, r, m) => disks(m).forEach((d) => {
      const ext = d.creates.filter((x) => isTrue(x.p.Extend));
      if (ext.length > 1) r(d.where, `${ext.length} CreatePartition items set Extend; only one may`);
    }),
  },
  {
    id: 'disk.extendLast', severity: 'error', title: 'The extending partition must be created last',
    check: (c, r, m) => disks(m).forEach((d) => {
      const i = d.creates.findIndex((x) => isTrue(x.p.Extend));
      if (i >= 0 && i !== d.creates.length - 1) r(`${d.where}/CreatePartitions/CreatePartition[${d.creates[i].j}]`, 'the partition with Extend must have the highest Order');
    }),
  },
  {
    id: 'disk.extendWithSize', severity: 'error', title: 'Extend and Size cannot both be set',
    check: (c, r, m) => disks(m).forEach((d) => d.creates.forEach((x) => {
      if (isTrue(x.p.Extend) && has(x.p.Size)) r(`${d.where}/CreatePartitions/CreatePartition[${x.j}]`, 'set either Size or Extend, not both');
    })),
  },
  {
    id: 'disk.sizeRequired', severity: 'error', title: 'Partition needs Size or Extend',
    check: (c, r, m) => disks(m).forEach((d) => d.creates.forEach((x) => {
      if (!isTrue(x.p.Extend) && !has(x.p.Size)) r(`${d.where}/CreatePartitions/CreatePartition[${x.j}]`, 'set Size (MB) or Extend');
    })),
  },
  {
    id: 'disk.efiSize', severity: 'error', title: 'EFI system partition must be at least 100 MB',
    check: (c, r, m) => disks(m).forEach((d) => d.creates.forEach((x) => {
      if (/^EFI$/i.test(x.type) && !Number.isNaN(num(x.p.Size)) && num(x.p.Size) < 100) {
        r(`${d.where}/CreatePartitions/CreatePartition[${x.j}]`, `EFI partition is ${num(x.p.Size)} MB; use at least 100 MB (260 MB on 4K-sector drives)`);
      }
    })),
  },
  {
    id: 'disk.efiFormat', severity: 'error', title: 'EFI system partition must be FAT32',
    check: (c, r, m) => disks(m).forEach((d) => d.modifies.forEach((mp, i) => {
      const target = partitionByNumber(d, num(mp.PartitionID));
      if (target && /^EFI$/i.test(target.type) && has(mp.Format) && !/^FAT32$/i.test(text(mp.Format))) {
        r(`${d.where}/ModifyPartitions/ModifyPartition[${i}]/Format`, `the EFI system partition must be formatted FAT32, not ${text(mp.Format)}`);
      }
    })),
  },
  {
    id: 'disk.msrCount', severity: 'error', title: 'GPT disks need exactly one MSR partition',
    check: (c, r, m) => disks(m).forEach((d) => {
      if (!d.gpt) return;
      const n = d.creates.filter((x) => /^MSR$/i.test(x.type)).length;
      if (n !== 1) r(d.where, `a GPT (UEFI) layout needs exactly one MSR partition; found ${n}`);
    }),
  },
  {
    id: 'disk.gptNoExtended', severity: 'error', title: 'Extended and Logical partitions are MBR only',
    check: (c, r, m) => disks(m).forEach((d) => {
      if (d.gpt && d.creates.some((x) => /^(Extended|Logical)$/i.test(x.type))) r(d.where, 'Extended and Logical partitions cannot be used with EFI or MSR (GPT) partitions');
    }),
  },
  {
    id: 'disk.mbrActive', severity: 'error', title: 'MBR layouts need an Active partition',
    check: (c, r, m) => disks(m).forEach((d) => {
      if (d.gpt || !d.creates.length) return;
      if (!d.modifies.some((mp) => isTrue(mp.Active))) r(d.where, 'a BIOS (MBR) layout needs one ModifyPartition with Active set to true for the system partition');
    }),
  },
  {
    id: 'disk.activeOnGpt', severity: 'warning', title: 'Active has no effect on GPT disks',
    check: (c, r, m) => disks(m).forEach((d) => d.modifies.forEach((mp, i) => {
      if (d.gpt && isTrue(mp.Active)) r(`${d.where}/ModifyPartitions/ModifyPartition[${i}]/Active`, 'Active is ignored on GPT (UEFI) disks');
    })),
  },
  {
    id: 'disk.mbrPrimaryLimit', severity: 'error', title: 'MBR disks hold at most four primary or extended partitions',
    check: (c, r, m) => disks(m).forEach((d) => {
      if (d.gpt) return;
      const n = d.creates.filter((x) => /^(Primary|Extended)$/i.test(x.type)).length;
      if (n > 4) r(d.where, `${n} primary and extended partitions; MBR allows four`);
    }),
  },
  {
    id: 'disk.modifyTarget', severity: 'error', title: 'ModifyPartition refers to a partition that is not created',
    check: (c, r, m) => disks(m).forEach((d) => {
      if (!d.creates.length) return;
      d.modifies.forEach((mp, i) => {
        const n = num(mp.PartitionID);
        if (!partitionByNumber(d, n)) r(`${d.where}/ModifyPartitions/ModifyPartition[${i}]/PartitionID`, `PartitionID ${isSet(mp.PartitionID) ? text(mp.PartitionID) : '(missing)'} does not match one of the ${d.numbered.length} created partitions`);
      });
    }),
  },
  {
    id: 'disk.letterDuplicate', severity: 'error', title: 'Drive letter used twice',
    check: (c, r, m) => {
      const seen = new Map();
      disks(m).forEach((d) => d.modifies.forEach((mp, i) => {
        if (!has(mp.Letter)) return;
        const L = text(mp.Letter).toUpperCase();
        const w = `${d.where}/ModifyPartitions/ModifyPartition[${i}]/Letter`;
        if (seen.has(L)) r(w, `drive letter ${L} is already assigned at ${seen.get(L)}`);
        else seen.set(L, w);
      }));
    },
  },
  {
    id: 'disk.fit', severity: 'error', title: 'Partitions do not fit the declared disk size',
    check: (c, r, m, o) => disks(m).forEach((d) => {
      const size = o.diskSizesMB && o.diskSizesMB[d.id];
      if (!size) return;
      const fixed = d.creates.filter((x) => !/^Logical$/i.test(x.type)).reduce((n, x) => n + (Number.isNaN(num(x.p.Size)) ? 0 : num(x.p.Size)), 0);
      const need = fixed + (d.creates.some((x) => isTrue(x.p.Extend)) ? 1 : 0);
      if (need > size) r(d.where, `fixed partition sizes total ${fixed} MB${need > fixed ? ' plus the extending partition' : ''}; disk ${d.id} has ${size} MB`);
    }),
  },
  {
    id: 'install.target', severity: 'error', title: 'InstallTo must reference an existing disk and partition',
    check: (c, r, m) => {
      const ds = disks(m);
      if (!ds.length) return;
      for (const { values: v, where } of comps(m, SETUP)) {
        const targets = [];
        if (isSet(v['ImageInstall/OSImage/InstallTo/DiskID']) || isSet(v['ImageInstall/OSImage/InstallTo/PartitionID'])) {
          targets.push({ disk: v['ImageInstall/OSImage/InstallTo/DiskID'], part: v['ImageInstall/OSImage/InstallTo/PartitionID'], w: `${where}/ImageInstall/OSImage/InstallTo` });
        }
        (Array.isArray(v['ImageInstall/DataImage']) ? v['ImageInstall/DataImage'] : []).forEach((it, i) => {
          if (it && (isSet(it['InstallTo/DiskID']) || isSet(it['InstallTo/PartitionID']))) targets.push({ disk: it['InstallTo/DiskID'], part: it['InstallTo/PartitionID'], w: `${where}/ImageInstall/DataImage[${i}]/InstallTo` });
        });
        for (const t of targets) {
          const d = ds.find((x) => x.id === num(t.disk));
          if (!d) {
            r(t.w, `DiskID ${isSet(t.disk) ? text(t.disk) : '(missing)'} is not configured in DiskConfiguration`);
            continue;
          }
          if (!d.creates.length) continue; // existing layout kept: cannot check partitions
          const p = partitionByNumber(d, num(t.part));
          if (!p) r(t.w, `PartitionID ${isSet(t.part) ? text(t.part) : '(missing)'} does not exist on disk ${d.id}`);
          else if (/^(EFI|MSR|Extended)$/i.test(p.type)) r(t.w, `PartitionID ${text(t.part)} is the ${p.type} partition; Windows cannot be installed there`);
        }
      }
    },
  },
  {
    id: 'install.toAndAvailable', severity: 'error', title: 'InstallTo and InstallToAvailablePartition are exclusive',
    check: (c, r, m) => comps(m, SETUP).forEach(({ values: v, where }) => {
      if (isTrue(v['ImageInstall/OSImage/InstallToAvailablePartition']) && (isSet(v['ImageInstall/OSImage/InstallTo/DiskID']) || isSet(v['ImageInstall/OSImage/InstallTo/PartitionID']))) {
        r(`${where}/ImageInstall/OSImage`, 'use InstallTo or InstallToAvailablePartition, not both');
      }
    }),
  },

  // --- servicing / packages --------------------------------------------------------
  {
    id: 'servicing.action', severity: 'error', title: 'Package action must be install, configure, remove or stage',
    check: (c, r, m) => packages(m).forEach(({ p, w }) => {
      if (!PACKAGE_ACTIONS.includes(p.action)) r(w, `action ${p.action === undefined ? '(missing)' : p.action} is not one of ${PACKAGE_ACTIONS.join(', ')}`);
    }),
  },
  {
    id: 'servicing.identity', severity: 'error', title: 'Package identity is incomplete',
    check: (c, r, m) => packages(m).forEach(({ p, w }) => {
      const id = p.identity || {};
      // language may be the empty string (neutral packages), but must be present
      const miss = ['name', 'version', 'processorArchitecture', 'publicKeyToken'].filter((k) => !has(id[k])).concat(isSet(id.language) ? [] : ['language']);
      if (miss.length) r(`${w}/assemblyIdentity`, `missing ${miss.join(', ')}`);
    }),
  },
  {
    id: 'servicing.version', severity: 'error', title: 'Package version must have four numeric parts',
    check: (c, r, m) => packages(m).forEach(({ p, w }) => {
      const v = p.identity && p.identity.version;
      if (has(v) && !/^\d+\.\d+\.\d+\.\d+$/.test(v)) r(`${w}/assemblyIdentity/@version`, `version ${v} is not in the form 10.0.26100.1`);
    }),
  },
  {
    id: 'servicing.publicKeyToken', severity: 'error', title: 'Package publicKeyToken must be 16 hex digits',
    check: (c, r, m) => packages(m).forEach(({ p, w }) => {
      const t = p.identity && p.identity.publicKeyToken;
      if (has(t) && !/^[0-9a-f]{16}$/i.test(t)) r(`${w}/assemblyIdentity/@publicKeyToken`, `publicKeyToken ${t} is not 16 hexadecimal digits`);
    }),
  },
  {
    id: 'servicing.permanence', severity: 'error', title: 'Permanence must be removable, permanent or temporary',
    check: (c, r, m) => packages(m).forEach(({ p, w }) => {
      if (isSet(p.permanence) && !PACKAGE_PERMANENCE.includes(p.permanence)) r(`${w}/@permanence`, `permanence ${p.permanence} is not one of ${PACKAGE_PERMANENCE.join(', ')}`);
      (p.sources || []).forEach((s, i) => {
        if (isSet(s.permanence) && !PACKAGE_PERMANENCE.includes(s.permanence)) r(`${w}/source[${i}]/@permanence`, `permanence ${s.permanence} is not one of ${PACKAGE_PERMANENCE.join(', ')}`);
      });
    }),
  },
  {
    id: 'servicing.sourceLocation', severity: 'error', title: 'Package source needs a location',
    check: (c, r, m) => packages(m).forEach(({ p, w }) => (p.sources || []).forEach((s, i) => {
      if (!has(s && s.location)) r(`${w}/source[${i}]`, 'source needs a location (path to the package)');
    })),
  },
  {
    id: 'servicing.installNeedsSource', severity: 'warning', title: 'Installing a package usually needs a source',
    check: (c, r, m) => packages(m).forEach(({ p, w }) => {
      if (p.action === 'install' && !(p.sources || []).length) r(w, 'action install without a source works only if the package is already staged in the image');
    }),
  },
  {
    id: 'servicing.selection', severity: 'error', title: 'Feature selection needs a name and a true or false state',
    check: (c, r, m) => packages(m).forEach(({ p, w }) => (p.selections || []).forEach((s, i) => {
      if (!has(s && s.name)) r(`${w}/selection[${i}]`, 'selection needs the feature name');
      if (!s || !(s.state === true || s.state === false || /^(true|false)$/i.test(String(s.state)))) r(`${w}/selection[${i}]`, 'selection state must be true or false');
    })),
  },
  {
    id: 'servicing.selectionDuplicate', severity: 'error', title: 'Feature selected twice in one package',
    check: (c, r, m) => packages(m).forEach(({ p, w }) => {
      const seen = new Set();
      (p.selections || []).forEach((s, i) => {
        const n = s && has(s.name) ? String(s.name).toLowerCase() : null;
        if (!n) return;
        if (seen.has(n)) r(`${w}/selection[${i}]`, `feature ${s.name} is selected more than once`);
        seen.add(n);
      });
    }),
  },
  {
    id: 'servicing.selectionWithoutConfigure', severity: 'warning', title: 'Feature selections apply to install or configure actions',
    check: (c, r, m) => packages(m).forEach(({ p, w }) => {
      if ((p.selections || []).length && (p.action === 'remove' || p.action === 'stage')) r(w, `selections are ignored when the package action is ${p.action}`);
    }),
  },
];

function computerNames(c) {
  return c.entries.filter((e) => e.s && isSet(e.value) && text(e.value) !== ''
    && ((e.comp === SHELL && e.key === 'ComputerName') || (e.comp === DEPLOY && e.key === 'AuditComputerName/Name')));
}

function productKeys(c) {
  return c.entries.filter((e) => e.s && has(e.value) && ((e.comp === SETUP && e.key === 'UserData/ProductKey/Key') || (e.comp === SHELL && e.key === 'ProductKey')));
}

function packages(m) {
  return (Array.isArray(m && m.servicing) ? m.servicing : []).map((p, i) => ({ p: p || {}, w: `servicing/package[${i}]` }));
}

/** Rule metadata without the check functions (for builders that list or document rules). */
export function describeRules() {
  return RULES.map(({ id, severity, title }) => ({ id, severity, title }));
}

/**
 * Check a model against the catalog and every rule in RULES.
 * Returns [{id, level, where, message}], errors first, in rule order within a level.
 */
export function validateModel(model, catalog, options = {}) {
  const disabled = new Set(options.disable || []);
  const sev = options.severity || {};
  const ctx = collect(model, catalog);
  const issues = [];
  for (const rule of RULES) {
    if (disabled.has(rule.id)) continue;
    const report = (where, message, level) => issues.push({ id: rule.id, level: sev[rule.id] || level || rule.severity, where, message });
    rule.check(ctx, report, model || {}, options);
  }
  const rank = { error: 0, warning: 1, info: 2 };
  return issues.map((x, i) => [x, i]).sort((a, b) => rank[a[0].level] - rank[b[0].level] || a[1] - b[1]).map((x) => x[0]);
}
