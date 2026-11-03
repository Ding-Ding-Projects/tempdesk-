// Reference data for the setting widgets: time zones, locales, keyboard layouts, editions, generic
// product keys, well-known accounts and firewall rule groups. Pure data plus small helpers.

// Windows time zone id -> [standard offset, IANA zone for the live offset, a few places for search]
export const TIME_ZONES = [
  ['Dateline Standard Time', '-12:00', 'Etc/GMT+12', 'International Date Line West'], ['UTC-11', '-11:00', 'Etc/GMT+11', 'Coordinated Universal Time-11'],
  ['Aleutian Standard Time', '-10:00', 'America/Adak', 'Aleutian Islands'], ['Hawaiian Standard Time', '-10:00', 'Pacific/Honolulu', 'Hawaii'],
  ['Marquesas Standard Time', '-09:30', 'Pacific/Marquesas', 'Marquesas Islands'], ['Alaskan Standard Time', '-09:00', 'America/Anchorage', 'Alaska'],
  ['UTC-09', '-09:00', 'Etc/GMT+9', 'Coordinated Universal Time-09'], ['Pacific Standard Time (Mexico)', '-08:00', 'America/Tijuana', 'Baja California'],
  ['UTC-08', '-08:00', 'Etc/GMT+8', 'Coordinated Universal Time-08'], ['Pacific Standard Time', '-08:00', 'America/Los_Angeles', 'Pacific Time (US and Canada), Seattle, Vancouver'],
  ['US Mountain Standard Time', '-07:00', 'America/Phoenix', 'Arizona'], ['Mountain Standard Time (Mexico)', '-07:00', 'America/Mazatlan', 'La Paz, Mazatlan'],
  ['Mountain Standard Time', '-07:00', 'America/Denver', 'Mountain Time (US and Canada), Denver'], ['Yukon Standard Time', '-07:00', 'America/Whitehorse', 'Yukon'],
  ['Central America Standard Time', '-06:00', 'America/Guatemala', 'Central America'], ['Central Standard Time', '-06:00', 'America/Chicago', 'Central Time (US and Canada), Chicago'],
  ['Easter Island Standard Time', '-06:00', 'Pacific/Easter', 'Easter Island'], ['Central Standard Time (Mexico)', '-06:00', 'America/Mexico_City', 'Guadalajara, Mexico City, Monterrey'],
  ['Canada Central Standard Time', '-06:00', 'America/Regina', 'Saskatchewan'], ['SA Pacific Standard Time', '-05:00', 'America/Bogota', 'Bogota, Lima, Quito'],
  ['Eastern Standard Time (Mexico)', '-05:00', 'America/Cancun', 'Chetumal'], ['Eastern Standard Time', '-05:00', 'America/New_York', 'Eastern Time (US and Canada), New York, Toronto'],
  ['Haiti Standard Time', '-05:00', 'America/Port-au-Prince', 'Haiti'], ['Cuba Standard Time', '-05:00', 'America/Havana', 'Havana'],
  ['US Eastern Standard Time', '-05:00', 'America/Indiana/Indianapolis', 'Indiana (East)'], ['Turks And Caicos Standard Time', '-05:00', 'America/Grand_Turk', 'Turks and Caicos'],
  ['Paraguay Standard Time', '-04:00', 'America/Asuncion', 'Asuncion'], ['Atlantic Standard Time', '-04:00', 'America/Halifax', 'Atlantic Time (Canada)'],
  ['Venezuela Standard Time', '-04:00', 'America/Caracas', 'Caracas'], ['Central Brazilian Standard Time', '-04:00', 'America/Cuiaba', 'Cuiaba'],
  ['SA Western Standard Time', '-04:00', 'America/La_Paz', 'Georgetown, La Paz, Manaus, San Juan'], ['Pacific SA Standard Time', '-04:00', 'America/Santiago', 'Santiago'],
  ['Newfoundland Standard Time', '-03:30', 'America/St_Johns', 'Newfoundland'], ['Tocantins Standard Time', '-03:00', 'America/Araguaina', 'Araguaina'],
  ['E. South America Standard Time', '-03:00', 'America/Sao_Paulo', 'Brasilia, Sao Paulo'], ['SA Eastern Standard Time', '-03:00', 'America/Cayenne', 'Cayenne, Fortaleza'],
  ['Argentina Standard Time', '-03:00', 'America/Argentina/Buenos_Aires', 'Buenos Aires'], ['Greenland Standard Time', '-03:00', 'America/Nuuk', 'Greenland'],
  ['Montevideo Standard Time', '-03:00', 'America/Montevideo', 'Montevideo'], ['Magallanes Standard Time', '-03:00', 'America/Punta_Arenas', 'Punta Arenas'],
  ['Saint Pierre Standard Time', '-03:00', 'America/Miquelon', 'Saint Pierre and Miquelon'], ['Bahia Standard Time', '-03:00', 'America/Bahia', 'Salvador'],
  ['UTC-02', '-02:00', 'Etc/GMT+2', 'Coordinated Universal Time-02'], ['Mid-Atlantic Standard Time', '-02:00', 'Etc/GMT+2', 'Mid-Atlantic (old)'],
  ['Azores Standard Time', '-01:00', 'Atlantic/Azores', 'Azores'], ['Cape Verde Standard Time', '-01:00', 'Atlantic/Cape_Verde', 'Cabo Verde'],
  ['UTC', '+00:00', 'Etc/UTC', 'Coordinated Universal Time'], ['GMT Standard Time', '+00:00', 'Europe/London', 'Dublin, Edinburgh, Lisbon, London'],
  ['Greenwich Standard Time', '+00:00', 'Atlantic/Reykjavik', 'Monrovia, Reykjavik'], ['Sao Tome Standard Time', '+00:00', 'Africa/Sao_Tome', 'Sao Tome'],
  ['Morocco Standard Time', '+01:00', 'Africa/Casablanca', 'Casablanca'], ['W. Europe Standard Time', '+01:00', 'Europe/Berlin', 'Amsterdam, Berlin, Bern, Rome, Stockholm, Vienna'],
  ['Central Europe Standard Time', '+01:00', 'Europe/Budapest', 'Belgrade, Bratislava, Budapest, Ljubljana, Prague'], ['Romance Standard Time', '+01:00', 'Europe/Paris', 'Brussels, Copenhagen, Madrid, Paris'],
  ['Central European Standard Time', '+01:00', 'Europe/Warsaw', 'Sarajevo, Skopje, Warsaw, Zagreb'], ['W. Central Africa Standard Time', '+01:00', 'Africa/Lagos', 'West Central Africa'],
  ['Jordan Standard Time', '+03:00', 'Asia/Amman', 'Amman'], ['GTB Standard Time', '+02:00', 'Europe/Bucharest', 'Athens, Bucharest'],
  ['Middle East Standard Time', '+02:00', 'Asia/Beirut', 'Beirut'], ['Egypt Standard Time', '+02:00', 'Africa/Cairo', 'Cairo'],
  ['E. Europe Standard Time', '+02:00', 'Europe/Chisinau', 'Chisinau'], ['Syria Standard Time', '+03:00', 'Asia/Damascus', 'Damascus'],
  ['West Bank Standard Time', '+02:00', 'Asia/Hebron', 'Gaza, Hebron'], ['South Africa Standard Time', '+02:00', 'Africa/Johannesburg', 'Harare, Pretoria'],
  ['FLE Standard Time', '+02:00', 'Europe/Kyiv', 'Helsinki, Kyiv, Riga, Sofia, Tallinn, Vilnius'], ['Israel Standard Time', '+02:00', 'Asia/Jerusalem', 'Jerusalem'],
  ['South Sudan Standard Time', '+02:00', 'Africa/Juba', 'Juba'], ['Kaliningrad Standard Time', '+02:00', 'Europe/Kaliningrad', 'Kaliningrad'],
  ['Sudan Standard Time', '+02:00', 'Africa/Khartoum', 'Khartoum'], ['Libya Standard Time', '+02:00', 'Africa/Tripoli', 'Tripoli'],
  ['Namibia Standard Time', '+02:00', 'Africa/Windhoek', 'Windhoek'], ['Arabic Standard Time', '+03:00', 'Asia/Baghdad', 'Baghdad'],
  ['Turkey Standard Time', '+03:00', 'Europe/Istanbul', 'Istanbul'], ['Arab Standard Time', '+03:00', 'Asia/Riyadh', 'Kuwait, Riyadh'],
  ['Belarus Standard Time', '+03:00', 'Europe/Minsk', 'Minsk'], ['Russian Standard Time', '+03:00', 'Europe/Moscow', 'Moscow, St. Petersburg'],
  ['E. Africa Standard Time', '+03:00', 'Africa/Nairobi', 'Nairobi'], ['Volgograd Standard Time', '+03:00', 'Europe/Volgograd', 'Volgograd'],
  ['Iran Standard Time', '+03:30', 'Asia/Tehran', 'Tehran'], ['Arabian Standard Time', '+04:00', 'Asia/Dubai', 'Abu Dhabi, Muscat'],
  ['Astrakhan Standard Time', '+04:00', 'Europe/Astrakhan', 'Astrakhan, Ulyanovsk'], ['Azerbaijan Standard Time', '+04:00', 'Asia/Baku', 'Baku'],
  ['Russia Time Zone 3', '+04:00', 'Europe/Samara', 'Izhevsk, Samara'], ['Mauritius Standard Time', '+04:00', 'Indian/Mauritius', 'Port Louis'],
  ['Saratov Standard Time', '+04:00', 'Europe/Saratov', 'Saratov'], ['Georgian Standard Time', '+04:00', 'Asia/Tbilisi', 'Tbilisi'],
  ['Caucasus Standard Time', '+04:00', 'Asia/Yerevan', 'Yerevan'], ['Afghanistan Standard Time', '+04:30', 'Asia/Kabul', 'Kabul'],
  ['West Asia Standard Time', '+05:00', 'Asia/Tashkent', 'Ashgabat, Tashkent'], ['Qyzylorda Standard Time', '+05:00', 'Asia/Qyzylorda', 'Qyzylorda'],
  ['Ekaterinburg Standard Time', '+05:00', 'Asia/Yekaterinburg', 'Ekaterinburg'], ['Pakistan Standard Time', '+05:00', 'Asia/Karachi', 'Islamabad, Karachi'],
  ['India Standard Time', '+05:30', 'Asia/Kolkata', 'Chennai, Kolkata, Mumbai, New Delhi'], ['Sri Lanka Standard Time', '+05:30', 'Asia/Colombo', 'Sri Jayawardenepura'],
  ['Nepal Standard Time', '+05:45', 'Asia/Kathmandu', 'Kathmandu'], ['Central Asia Standard Time', '+05:00', 'Asia/Bishkek', 'Astana, Bishkek'],
  ['Bangladesh Standard Time', '+06:00', 'Asia/Dhaka', 'Dhaka'], ['Omsk Standard Time', '+06:00', 'Asia/Omsk', 'Omsk'],
  ['Myanmar Standard Time', '+06:30', 'Asia/Yangon', 'Yangon (Rangoon)'], ['SE Asia Standard Time', '+07:00', 'Asia/Bangkok', 'Bangkok, Hanoi, Jakarta'],
  ['Altai Standard Time', '+07:00', 'Asia/Barnaul', 'Barnaul, Gorno-Altaysk'], ['W. Mongolia Standard Time', '+07:00', 'Asia/Hovd', 'Hovd'],
  ['North Asia Standard Time', '+07:00', 'Asia/Krasnoyarsk', 'Krasnoyarsk'], ['N. Central Asia Standard Time', '+07:00', 'Asia/Novosibirsk', 'Novosibirsk'],
  ['Tomsk Standard Time', '+07:00', 'Asia/Tomsk', 'Tomsk'], ['China Standard Time', '+08:00', 'Asia/Shanghai', 'Beijing, Chongqing, Hong Kong SAR, Urumqi'],
  ['North Asia East Standard Time', '+08:00', 'Asia/Irkutsk', 'Irkutsk'], ['Singapore Standard Time', '+08:00', 'Asia/Singapore', 'Kuala Lumpur, Singapore'],
  ['W. Australia Standard Time', '+08:00', 'Australia/Perth', 'Perth'], ['Taipei Standard Time', '+08:00', 'Asia/Taipei', 'Taipei'],
  ['Ulaanbaatar Standard Time', '+08:00', 'Asia/Ulaanbaatar', 'Ulaanbaatar'], ['Aus Central W. Standard Time', '+08:45', 'Australia/Eucla', 'Eucla'],
  ['Transbaikal Standard Time', '+09:00', 'Asia/Chita', 'Chita'], ['Tokyo Standard Time', '+09:00', 'Asia/Tokyo', 'Osaka, Sapporo, Tokyo'],
  ['North Korea Standard Time', '+09:00', 'Asia/Pyongyang', 'Pyongyang'], ['Korea Standard Time', '+09:00', 'Asia/Seoul', 'Seoul'],
  ['Yakutsk Standard Time', '+09:00', 'Asia/Yakutsk', 'Yakutsk'], ['Cen. Australia Standard Time', '+09:30', 'Australia/Adelaide', 'Adelaide'],
  ['AUS Central Standard Time', '+09:30', 'Australia/Darwin', 'Darwin'], ['E. Australia Standard Time', '+10:00', 'Australia/Brisbane', 'Brisbane'],
  ['AUS Eastern Standard Time', '+10:00', 'Australia/Sydney', 'Canberra, Melbourne, Sydney'], ['West Pacific Standard Time', '+10:00', 'Pacific/Port_Moresby', 'Guam, Port Moresby'],
  ['Tasmania Standard Time', '+10:00', 'Australia/Hobart', 'Hobart'], ['Vladivostok Standard Time', '+10:00', 'Asia/Vladivostok', 'Vladivostok'],
  ['Lord Howe Standard Time', '+10:30', 'Australia/Lord_Howe', 'Lord Howe Island'], ['Bougainville Standard Time', '+11:00', 'Pacific/Bougainville', 'Bougainville Island'],
  ['Russia Time Zone 10', '+11:00', 'Asia/Srednekolymsk', 'Chokurdakh'], ['Magadan Standard Time', '+11:00', 'Asia/Magadan', 'Magadan'],
  ['Norfolk Standard Time', '+11:00', 'Pacific/Norfolk', 'Norfolk Island'], ['Sakhalin Standard Time', '+11:00', 'Asia/Sakhalin', 'Sakhalin'],
  ['Central Pacific Standard Time', '+11:00', 'Pacific/Guadalcanal', 'Solomon Islands, New Caledonia'], ['Russia Time Zone 11', '+12:00', 'Asia/Kamchatka', 'Anadyr, Petropavlovsk-Kamchatsky'],
  ['New Zealand Standard Time', '+12:00', 'Pacific/Auckland', 'Auckland, Wellington'], ['UTC+12', '+12:00', 'Etc/GMT-12', 'Coordinated Universal Time+12'],
  ['Fiji Standard Time', '+12:00', 'Pacific/Fiji', 'Fiji'], ['Kamchatka Standard Time', '+12:00', 'Asia/Kamchatka', 'Petropavlovsk-Kamchatsky (old)'],
  ['Chatham Islands Standard Time', '+12:45', 'Pacific/Chatham', 'Chatham Islands'], ['UTC+13', '+13:00', 'Etc/GMT-13', 'Coordinated Universal Time+13'],
  ['Tonga Standard Time', '+13:00', 'Pacific/Tongatapu', "Nuku'alofa"], ['Samoa Standard Time', '+13:00', 'Pacific/Apia', 'Samoa'],
  ['Line Islands Standard Time', '+14:00', 'Pacific/Kiritimati', 'Kiritimati Island']
];
/** Live offset ('+08:00') and local time ('14:05') of a Windows zone right now. */
export function zoneNow(id, now) {
  const z = TIME_ZONES.find((x) => x[0] === id);
  if (!z) return null;
  const at = now || new Date();
  let offset = z[1], time = '';
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: z[2], hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'longOffset' }).formatToParts(at);
    const tzn = (parts.find((p) => p.type === 'timeZoneName') || {}).value || '';
    const m = /GMT([+-]\d{2}:\d{2})?/.exec(tzn);
    if (m) offset = m[1] || '+00:00';
    time = parts.find((p) => p.type === 'hour').value + ':' + parts.find((p) => p.type === 'minute').value;
  } catch (e) {
    const [sign, hh, mm] = /([+-])(\d\d):(\d\d)/.exec(z[1]).slice(1);
    const d = new Date(at.getTime() + (sign === '-' ? -1 : 1) * (+hh * 60 + +mm) * 60000);
    time = String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
  }
  return { id, offset, standard: z[1], time, places: z[3], dst: offset !== z[1] };
}

// Locales: tag, LCID (hex), default keyboard layout id
export const LOCALES = [
  ['en-US', '0409', '00000409'], ['en-GB', '0809', '00000809'], ['en-AU', '0c09', '00000409'], ['en-CA', '1009', '00000409'], ['en-IN', '4009', '00004009'],
  ['en-IE', '1809', '00001809'], ['en-NZ', '1409', '00000409'], ['en-SG', '4809', '00000409'], ['en-ZA', '1c09', '00000409'], ['zh-HK', '0c04', '00000409'],
  ['zh-TW', '0404', '00000404'], ['zh-CN', '0804', '00000804'], ['zh-SG', '1004', '00000804'], ['ja-JP', '0411', '00000411'], ['ko-KR', '0412', '00000412'],
  ['de-DE', '0407', '00000407'], ['de-AT', '0c07', '00000407'], ['de-CH', '0807', '00000807'], ['fr-FR', '040c', '0000040c'], ['fr-CA', '0c0c', '00001009'],
  ['fr-BE', '080c', '0000080c'], ['fr-CH', '100c', '0000100c'], ['es-ES', '0c0a', '0000040a'], ['es-MX', '080a', '0000080a'], ['it-IT', '0410', '00000410'],
  ['pt-BR', '0416', '00000416'], ['pt-PT', '0816', '00000816'], ['nl-NL', '0413', '00020409'], ['nl-BE', '0813', '00000813'], ['sv-SE', '041d', '0000041d'],
  ['nb-NO', '0414', '00000414'], ['da-DK', '0406', '00000406'], ['fi-FI', '040b', '0000040b'], ['pl-PL', '0415', '00000415'], ['cs-CZ', '0405', '00000405'],
  ['sk-SK', '041b', '0000041b'], ['hu-HU', '040e', '0000040e'], ['ro-RO', '0418', '00010418'], ['bg-BG', '0402', '00030402'], ['hr-HR', '041a', '0000041a'],
  ['sl-SI', '0424', '00000424'], ['sr-Latn-RS', '241a', '0000081a'], ['et-EE', '0425', '00000425'], ['lv-LV', '0426', '00020426'], ['lt-LT', '0427', '00010427'],
  ['tr-TR', '041f', '0000041f'], ['ru-RU', '0419', '00000419'], ['uk-UA', '0422', '00020422'], ['el-GR', '0408', '00000408'], ['he-IL', '040d', '0002040d'],
  ['ar-SA', '0401', '00000401'], ['th-TH', '041e', '0000041e'], ['vi-VN', '042a', '0000042a'], ['id-ID', '0421', '00000409'], ['ms-MY', '043e', '00000409']
];
let namesCache = {};
function displayNames(lang) {
  if (namesCache[lang]) return namesCache[lang];
  let ln = null, rn = null;
  try { ln = new Intl.DisplayNames([lang || 'en'], { type: 'language' }); rn = new Intl.DisplayNames([lang || 'en'], { type: 'region' }); } catch (e) { /* old browser */ }
  namesCache[lang] = { ln, rn };
  return namesCache[lang];
}
/** { tag, name, language, region } in the UI language. */
export function localeName(tag, lang) {
  const { ln, rn } = displayNames(lang || 'en');
  const [l, ...rest] = String(tag).split('-');
  const region = rest.find((x) => /^[A-Z]{2}$/.test(x));
  let name = tag, language = l, regionName = region || '';
  try { if (ln) { name = ln.of(tag) || tag; language = ln.of(l) || l; } if (rn && region) regionName = rn.of(region) || region; } catch (e) { /* unknown tag */ }
  return { tag, name, language, region: regionName };
}
export const KEYBOARDS = [
  ['00000409', 'US'], ['00020409', 'United States-International'], ['00010409', 'United States-Dvorak'], ['00000809', 'United Kingdom'], ['00001809', 'Irish'], ['00004009', 'India'],
  ['00000407', 'German'], ['00000807', 'Swiss German'], ['0000040c', 'French'], ['0000080c', 'Belgian French'], ['0000100c', 'Swiss French'], ['00001009', 'Canadian French'],
  ['0000040a', 'Spanish'], ['0000080a', 'Latin American'], ['00000410', 'Italian'], ['00000416', 'Portuguese (Brazil ABNT)'], ['00000816', 'Portuguese'], ['00000413', 'Dutch'],
  ['00000813', 'Belgian (Period)'], ['0000041d', 'Swedish'], ['00000414', 'Norwegian'], ['00000406', 'Danish'], ['0000040b', 'Finnish'], ['00000415', 'Polish (214)'],
  ['00000405', 'Czech'], ['0000041b', 'Slovak'], ['0000040e', 'Hungarian'], ['00010418', 'Romanian (Standard)'], ['00030402', 'Bulgarian'], ['0000041a', 'Croatian'],
  ['00000424', 'Slovenian'], ['0000081a', 'Serbian (Latin)'], ['00000425', 'Estonian'], ['00020426', 'Latvian (Standard)'], ['00010427', 'Lithuanian'], ['0000041f', 'Turkish Q'],
  ['00000419', 'Russian'], ['00020422', 'Ukrainian (Enhanced)'], ['00000408', 'Greek'], ['0002040d', 'Hebrew (Standard)'], ['00000401', 'Arabic (101)'], ['0000041e', 'Thai Kedmanee'],
  ['0000042a', 'Vietnamese'], ['00000404', 'Chinese (Traditional) - US'], ['00000804', 'Chinese (Simplified) - US'], ['00000411', 'Japanese'], ['00000412', 'Korean']
];
/** Input locale pairs (LCID:layout) for every locale, plus the layout name. */
export function inputLocaleOptions(lang) {
  return LOCALES.map(([tag, lcid, kb]) => {
    const n = localeName(tag, lang);
    const k = KEYBOARDS.find((x) => x[0] === kb);
    return { value: lcid + ':' + kb, label: n.name, detail: (k ? k[1] : kb) + ' keyboard · ' + lcid + ':' + kb, keywords: tag + ' ' + n.language + ' ' + n.region };
  }).concat(LOCALES.map(([tag]) => { const n = localeName(tag, lang); return { value: tag, label: n.name, detail: tag + ' (default keyboard)', keywords: n.language + ' ' + n.region }; }));
}
export function localeOptions(lang) {
  return LOCALES.map(([tag, lcid]) => { const n = localeName(tag, lang); return { value: tag, label: n.name, detail: tag + ' · ' + n.language + (n.region ? ', ' + n.region : '') + ' · LCID ' + lcid, keywords: n.language + ' ' + n.region }; });
}
export function timeZoneOptions(now) {
  return TIME_ZONES.map(([id]) => { const z = zoneNow(id, now); return { value: id, label: id, detail: '(UTC' + z.offset + ') ' + z.places + ' · ' + z.time, keywords: z.places + ' UTC' + z.offset + ' ' + z.standard }; });
}

// Editions on current media: [index on multi-edition media, name]
export const EDITIONS = [
  ['1', 'Windows 11 Home'], ['2', 'Windows 11 Home N'], ['3', 'Windows 11 Home Single Language'], ['4', 'Windows 11 Education'], ['5', 'Windows 11 Education N'],
  ['6', 'Windows 11 Pro'], ['7', 'Windows 11 Pro N'], ['8', 'Windows 11 Pro Education'], ['9', 'Windows 11 Pro Education N'], ['10', 'Windows 11 Pro for Workstations'],
  ['11', 'Windows 11 Pro N for Workstations'], ['1', 'Windows Server 2025 Standard'], ['2', 'Windows Server 2025 Standard (Desktop Experience)'],
  ['3', 'Windows Server 2025 Datacenter'], ['4', 'Windows Server 2025 Datacenter (Desktop Experience)'], ['1', 'Windows Server 2022 Standard'],
  ['2', 'Windows Server 2022 Standard (Desktop Experience)'], ['3', 'Windows Server 2022 Datacenter'], ['4', 'Windows Server 2022 Datacenter (Desktop Experience)']
];
export function editionOptions() {
  const byIndex = EDITIONS.map(([i, n]) => ({ value: i, label: n, detail: '/IMAGE/INDEX ' + i + ' on the usual ' + (/Server/.test(n) ? 'Windows Server' : 'Windows 11') + ' media', keywords: n }));
  const byName = EDITIONS.map(([, n]) => ({ value: n, label: n, detail: '/IMAGE/NAME', keywords: n }));
  return byIndex.concat(byName);
}

// Generic keys published by Microsoft. They select an edition; KMS keys activate only against your own
// KMS host and AVMA keys only on a licensed Hyper-V Datacenter host.
export const PRODUCT_KEYS = [
  { edition: 'Windows 11 / 10 Pro', kind: 'KMS', key: 'W269N-WFGWX-YVC9B-4J6C9-T83GX' },
  { edition: 'Windows 11 / 10 Pro N', kind: 'KMS', key: 'MH37W-N47XK-V7XM9-C7227-GCQG9' },
  { edition: 'Windows 11 / 10 Pro for Workstations', kind: 'KMS', key: 'NRG8B-VKK3Q-CXVCJ-9G2XF-6Q84J' },
  { edition: 'Windows 11 / 10 Pro Education', kind: 'KMS', key: '6TP4R-GNPTD-KYYHQ-7B7DP-J447Y' },
  { edition: 'Windows 11 / 10 Education', kind: 'KMS', key: 'NW6C2-QMPVW-D7KKK-3GKT6-VCFB2' },
  { edition: 'Windows 11 / 10 Enterprise', kind: 'KMS', key: 'NPPR9-FWDCX-D2C8J-H872K-2YT43' },
  { edition: 'Windows 11 / 10 Enterprise N', kind: 'KMS', key: 'DPH2V-TTNVB-4X9Q3-TJR4H-KHJW4' },
  { edition: 'Windows Enterprise LTSC 2021 / 2019', kind: 'KMS', key: 'M7XTQ-FN8P6-TTKYV-9D4CC-J462D' },
  { edition: 'Windows Server 2025 Standard', kind: 'KMS', key: 'TVRH6-WHNXV-R9WG3-9XRFY-MY832' },
  { edition: 'Windows Server 2025 Datacenter', kind: 'KMS', key: 'D764K-2NDRG-47T6Q-P8T8W-YP6DF' },
  { edition: 'Windows Server 2022 Standard', kind: 'KMS', key: 'VDYBN-27WPP-V4HQT-9VMD4-VMK7H' },
  { edition: 'Windows Server 2022 Datacenter', kind: 'KMS', key: 'WX4NM-KYWYW-QJJR4-XV3QB-6VM33' },
  { edition: 'Windows Server 2019 Standard', kind: 'KMS', key: 'N69G4-B89J2-4G8F4-WWYCC-J464C' },
  { edition: 'Windows Server 2019 Datacenter', kind: 'KMS', key: 'WMDGN-G9PQG-XVVXX-R3X43-63DFG' },
  { edition: 'Windows Server 2025 / 2022 / 2019 Datacenter (virtual machine)', kind: 'AVMA', key: 'YQB4H-NKHHJ-Q6K4R-4VMY6-VCH67' },
  { edition: 'Windows Server 2025 / 2022 / 2019 Standard (virtual machine)', kind: 'AVMA', key: 'WWVGQ-PNHV9-B89P4-8GGM9-9HPQ4' }
];
export function productKeyPreset(key) { const k = String(key || '').toUpperCase(); return PRODUCT_KEYS.find((p) => p.key === k) || null; }

// Well-known local groups and principals. `sid` uses <domain> for domain-relative ones.
export const ACCOUNTS = [
  { name: 'Administrators', sid: 'S-1-5-32-544', kind: 'group', note: 'Full control of the computer.' },
  { name: 'Users', sid: 'S-1-5-32-545', kind: 'group', note: 'Standard users; cannot change system settings.' },
  { name: 'Guests', sid: 'S-1-5-32-546', kind: 'group', note: 'Very limited temporary access.' },
  { name: 'Remote Desktop Users', sid: 'S-1-5-32-555', kind: 'group', note: 'May sign in through Remote Desktop.' },
  { name: 'Remote Management Users', sid: 'S-1-5-32-580', kind: 'group', note: 'May use WinRM and PowerShell remoting.' },
  { name: 'Backup Operators', sid: 'S-1-5-32-551', kind: 'group', note: 'May back up and restore files.' },
  { name: 'Network Configuration Operators', sid: 'S-1-5-32-556', kind: 'group', note: 'May change network settings.' },
  { name: 'Performance Monitor Users', sid: 'S-1-5-32-558', kind: 'group', note: 'May read performance counters.' },
  { name: 'Performance Log Users', sid: 'S-1-5-32-559', kind: 'group', note: 'May schedule performance logging.' },
  { name: 'Distributed COM Users', sid: 'S-1-5-32-562', kind: 'group', note: 'May start DCOM objects.' },
  { name: 'Event Log Readers', sid: 'S-1-5-32-573', kind: 'group', note: 'May read event logs.' },
  { name: 'Hyper-V Administrators', sid: 'S-1-5-32-578', kind: 'group', note: 'Full control of Hyper-V.' },
  { name: 'IIS_IUSRS', sid: 'S-1-5-32-568', kind: 'group', note: 'Used by IIS application pools.' },
  { name: 'Power Users', sid: 'S-1-5-32-547', kind: 'group', note: 'Legacy group with no extra rights today.' },
  { name: 'Everyone', sid: 'S-1-1-0', kind: 'principal', note: 'Every user, including anonymous ones on old systems.' },
  { name: 'Authenticated Users', sid: 'S-1-5-11', kind: 'principal', note: 'Every signed-in user.' },
  { name: 'INTERACTIVE', sid: 'S-1-5-4', kind: 'principal', note: 'Users signed in at the console or through Remote Desktop.' },
  { name: 'SYSTEM', sid: 'S-1-5-18', kind: 'principal', note: 'The operating system itself.' },
  { name: 'LOCAL SERVICE', sid: 'S-1-5-19', kind: 'principal', note: 'Built-in low privilege service account.' },
  { name: 'NETWORK SERVICE', sid: 'S-1-5-20', kind: 'principal', note: 'Built-in service account that uses the computer identity on the network.' },
  { name: 'Domain Admins', sid: 'S-1-5-21-<domain>-512', kind: 'domain', note: 'Administrators of the domain.' },
  { name: 'Domain Users', sid: 'S-1-5-21-<domain>-513', kind: 'domain', note: 'Every user in the domain.' }
];
export const FIREWALL_GROUPS = [
  ['Remote Desktop', '@FirewallAPI.dll,-28752'], ['File and Printer Sharing', '@FirewallAPI.dll,-28502'], ['Network Discovery', '@FirewallAPI.dll,-32752'],
  ['Windows Remote Management', ''], ['Windows Management Instrumentation (WMI)', ''], ['Remote Event Log Management', ''], ['Remote Service Management', ''],
  ['Remote Scheduled Tasks Management', ''], ['Remote Volume Management', ''], ['Windows Defender Firewall Remote Management', ''], ['Core Networking', ''],
  ['Performance Logs and Alerts', ''], ['Hyper-V', ''], ['DNS Service', ''], ['Active Directory Domain Services', '']
];
export const POWER_PLANS = { '381b4222-f694-41f0-9685-ff5bb260df2e': 'Balanced', '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c': 'High performance', 'a1841308-3541-4fab-bc81-f71556f20b4a': 'Power saver' };
export const COMMAND_SNIPPETS = [
  ['cmd /c ', 'cmd /c'], ['powershell.exe -NoProfile -ExecutionPolicy Bypass -File ', 'PowerShell script'], ['powershell.exe -NoProfile -Command ', 'PowerShell command'],
  ['reg.exe add ', 'reg add'], ['msiexec.exe /i  /qn /norestart', 'MSI install'], ['shutdown.exe /r /t 0', 'Restart now']
];

/** Options for a combobox-search source. */
export function sourceOptions(source, lang) {
  if (source === 'timezones') return timeZoneOptions();
  if (source === 'locales') return localeOptions(lang);
  if (source === 'inputLocales') return inputLocaleOptions(lang);
  if (source === 'editions') return editionOptions();
  if (source === 'accounts') return ACCOUNTS.map((a) => ({ value: a.name, label: a.name, detail: a.note + ' · ' + a.sid, keywords: a.sid + ' ' + a.kind }));
  if (source === 'firewallGroups') return FIREWALL_GROUPS.flatMap(([n, id]) => [{ value: n, label: n, detail: 'Rule group name', keywords: id }].concat(id ? [{ value: id, label: n, detail: 'Resource id ' + id + ' (works in every language)', keywords: n }] : []));
  return [];
}
