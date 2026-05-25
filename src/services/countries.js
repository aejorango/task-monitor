// src/services/countries.js
// ISO 3166-1 alpha-2 country list + continent mapping.
// Used by the Settings profile editor and the Member analytics dashboard.

export const COUNTRIES = [
  // North America
  { code: 'US', name: 'United States',          continent: 'North America' },
  { code: 'CA', name: 'Canada',                 continent: 'North America' },
  { code: 'MX', name: 'Mexico',                 continent: 'North America' },
  { code: 'GT', name: 'Guatemala',              continent: 'North America' },
  { code: 'CU', name: 'Cuba',                   continent: 'North America' },
  { code: 'DO', name: 'Dominican Republic',     continent: 'North America' },
  { code: 'HT', name: 'Haiti',                  continent: 'North America' },
  { code: 'HN', name: 'Honduras',               continent: 'North America' },
  { code: 'JM', name: 'Jamaica',                continent: 'North America' },
  { code: 'NI', name: 'Nicaragua',              continent: 'North America' },
  { code: 'PA', name: 'Panama',                 continent: 'North America' },
  { code: 'CR', name: 'Costa Rica',             continent: 'North America' },
  { code: 'SV', name: 'El Salvador',            continent: 'North America' },
  { code: 'PR', name: 'Puerto Rico',            continent: 'North America' },
  { code: 'TT', name: 'Trinidad and Tobago',    continent: 'North America' },
  { code: 'BS', name: 'Bahamas',                continent: 'North America' },
  { code: 'BB', name: 'Barbados',               continent: 'North America' },
  // South America
  { code: 'BR', name: 'Brazil',                 continent: 'South America' },
  { code: 'AR', name: 'Argentina',              continent: 'South America' },
  { code: 'CL', name: 'Chile',                  continent: 'South America' },
  { code: 'CO', name: 'Colombia',               continent: 'South America' },
  { code: 'PE', name: 'Peru',                   continent: 'South America' },
  { code: 'VE', name: 'Venezuela',              continent: 'South America' },
  { code: 'EC', name: 'Ecuador',                continent: 'South America' },
  { code: 'BO', name: 'Bolivia',                continent: 'South America' },
  { code: 'PY', name: 'Paraguay',               continent: 'South America' },
  { code: 'UY', name: 'Uruguay',                continent: 'South America' },
  { code: 'GY', name: 'Guyana',                 continent: 'South America' },
  { code: 'SR', name: 'Suriname',               continent: 'South America' },
  // Europe
  { code: 'GB', name: 'United Kingdom',         continent: 'Europe' },
  { code: 'IE', name: 'Ireland',                continent: 'Europe' },
  { code: 'FR', name: 'France',                 continent: 'Europe' },
  { code: 'DE', name: 'Germany',                continent: 'Europe' },
  { code: 'ES', name: 'Spain',                  continent: 'Europe' },
  { code: 'IT', name: 'Italy',                  continent: 'Europe' },
  { code: 'PT', name: 'Portugal',               continent: 'Europe' },
  { code: 'NL', name: 'Netherlands',            continent: 'Europe' },
  { code: 'BE', name: 'Belgium',                continent: 'Europe' },
  { code: 'CH', name: 'Switzerland',            continent: 'Europe' },
  { code: 'AT', name: 'Austria',                continent: 'Europe' },
  { code: 'SE', name: 'Sweden',                 continent: 'Europe' },
  { code: 'NO', name: 'Norway',                 continent: 'Europe' },
  { code: 'DK', name: 'Denmark',                continent: 'Europe' },
  { code: 'FI', name: 'Finland',                continent: 'Europe' },
  { code: 'IS', name: 'Iceland',                continent: 'Europe' },
  { code: 'PL', name: 'Poland',                 continent: 'Europe' },
  { code: 'CZ', name: 'Czechia',                continent: 'Europe' },
  { code: 'SK', name: 'Slovakia',               continent: 'Europe' },
  { code: 'HU', name: 'Hungary',                continent: 'Europe' },
  { code: 'RO', name: 'Romania',                continent: 'Europe' },
  { code: 'BG', name: 'Bulgaria',               continent: 'Europe' },
  { code: 'GR', name: 'Greece',                 continent: 'Europe' },
  { code: 'HR', name: 'Croatia',                continent: 'Europe' },
  { code: 'SI', name: 'Slovenia',               continent: 'Europe' },
  { code: 'RS', name: 'Serbia',                 continent: 'Europe' },
  { code: 'BA', name: 'Bosnia and Herzegovina', continent: 'Europe' },
  { code: 'AL', name: 'Albania',                continent: 'Europe' },
  { code: 'MK', name: 'North Macedonia',        continent: 'Europe' },
  { code: 'ME', name: 'Montenegro',             continent: 'Europe' },
  { code: 'EE', name: 'Estonia',                continent: 'Europe' },
  { code: 'LV', name: 'Latvia',                 continent: 'Europe' },
  { code: 'LT', name: 'Lithuania',              continent: 'Europe' },
  { code: 'BY', name: 'Belarus',                continent: 'Europe' },
  { code: 'UA', name: 'Ukraine',                continent: 'Europe' },
  { code: 'MD', name: 'Moldova',                continent: 'Europe' },
  { code: 'RU', name: 'Russia',                 continent: 'Europe' },
  { code: 'LU', name: 'Luxembourg',             continent: 'Europe' },
  { code: 'MT', name: 'Malta',                  continent: 'Europe' },
  { code: 'CY', name: 'Cyprus',                 continent: 'Europe' },
  // Asia
  { code: 'PH', name: 'Philippines',            continent: 'Asia' },
  { code: 'JP', name: 'Japan',                  continent: 'Asia' },
  { code: 'KR', name: 'South Korea',            continent: 'Asia' },
  { code: 'KP', name: 'North Korea',            continent: 'Asia' },
  { code: 'CN', name: 'China',                  continent: 'Asia' },
  { code: 'HK', name: 'Hong Kong',              continent: 'Asia' },
  { code: 'TW', name: 'Taiwan',                 continent: 'Asia' },
  { code: 'MO', name: 'Macau',                  continent: 'Asia' },
  { code: 'IN', name: 'India',                  continent: 'Asia' },
  { code: 'PK', name: 'Pakistan',               continent: 'Asia' },
  { code: 'BD', name: 'Bangladesh',             continent: 'Asia' },
  { code: 'LK', name: 'Sri Lanka',              continent: 'Asia' },
  { code: 'NP', name: 'Nepal',                  continent: 'Asia' },
  { code: 'BT', name: 'Bhutan',                 continent: 'Asia' },
  { code: 'MV', name: 'Maldives',               continent: 'Asia' },
  { code: 'AF', name: 'Afghanistan',            continent: 'Asia' },
  { code: 'IR', name: 'Iran',                   continent: 'Asia' },
  { code: 'IQ', name: 'Iraq',                   continent: 'Asia' },
  { code: 'SA', name: 'Saudi Arabia',           continent: 'Asia' },
  { code: 'AE', name: 'United Arab Emirates',   continent: 'Asia' },
  { code: 'QA', name: 'Qatar',                  continent: 'Asia' },
  { code: 'KW', name: 'Kuwait',                 continent: 'Asia' },
  { code: 'BH', name: 'Bahrain',                continent: 'Asia' },
  { code: 'OM', name: 'Oman',                   continent: 'Asia' },
  { code: 'YE', name: 'Yemen',                  continent: 'Asia' },
  { code: 'IL', name: 'Israel',                 continent: 'Asia' },
  { code: 'PS', name: 'Palestine',              continent: 'Asia' },
  { code: 'JO', name: 'Jordan',                 continent: 'Asia' },
  { code: 'LB', name: 'Lebanon',                continent: 'Asia' },
  { code: 'SY', name: 'Syria',                  continent: 'Asia' },
  { code: 'TR', name: 'Turkey',                 continent: 'Asia' },
  { code: 'AM', name: 'Armenia',                continent: 'Asia' },
  { code: 'AZ', name: 'Azerbaijan',             continent: 'Asia' },
  { code: 'GE', name: 'Georgia',                continent: 'Asia' },
  { code: 'KZ', name: 'Kazakhstan',             continent: 'Asia' },
  { code: 'KG', name: 'Kyrgyzstan',             continent: 'Asia' },
  { code: 'TJ', name: 'Tajikistan',             continent: 'Asia' },
  { code: 'TM', name: 'Turkmenistan',           continent: 'Asia' },
  { code: 'UZ', name: 'Uzbekistan',             continent: 'Asia' },
  { code: 'MN', name: 'Mongolia',               continent: 'Asia' },
  { code: 'TH', name: 'Thailand',               continent: 'Asia' },
  { code: 'VN', name: 'Vietnam',                continent: 'Asia' },
  { code: 'LA', name: 'Laos',                   continent: 'Asia' },
  { code: 'KH', name: 'Cambodia',               continent: 'Asia' },
  { code: 'MM', name: 'Myanmar',                continent: 'Asia' },
  { code: 'MY', name: 'Malaysia',               continent: 'Asia' },
  { code: 'SG', name: 'Singapore',              continent: 'Asia' },
  { code: 'BN', name: 'Brunei',                 continent: 'Asia' },
  { code: 'ID', name: 'Indonesia',              continent: 'Asia' },
  { code: 'TL', name: 'Timor-Leste',            continent: 'Asia' },
  // Africa
  { code: 'EG', name: 'Egypt',                  continent: 'Africa' },
  { code: 'LY', name: 'Libya',                  continent: 'Africa' },
  { code: 'TN', name: 'Tunisia',                continent: 'Africa' },
  { code: 'DZ', name: 'Algeria',                continent: 'Africa' },
  { code: 'MA', name: 'Morocco',                continent: 'Africa' },
  { code: 'SD', name: 'Sudan',                  continent: 'Africa' },
  { code: 'SS', name: 'South Sudan',            continent: 'Africa' },
  { code: 'ET', name: 'Ethiopia',               continent: 'Africa' },
  { code: 'ER', name: 'Eritrea',                continent: 'Africa' },
  { code: 'DJ', name: 'Djibouti',               continent: 'Africa' },
  { code: 'SO', name: 'Somalia',                continent: 'Africa' },
  { code: 'KE', name: 'Kenya',                  continent: 'Africa' },
  { code: 'UG', name: 'Uganda',                 continent: 'Africa' },
  { code: 'TZ', name: 'Tanzania',               continent: 'Africa' },
  { code: 'RW', name: 'Rwanda',                 continent: 'Africa' },
  { code: 'BI', name: 'Burundi',                continent: 'Africa' },
  { code: 'NG', name: 'Nigeria',                continent: 'Africa' },
  { code: 'GH', name: 'Ghana',                  continent: 'Africa' },
  { code: 'CI', name: "Côte d'Ivoire",          continent: 'Africa' },
  { code: 'SN', name: 'Senegal',                continent: 'Africa' },
  { code: 'ML', name: 'Mali',                   continent: 'Africa' },
  { code: 'BF', name: 'Burkina Faso',           continent: 'Africa' },
  { code: 'NE', name: 'Niger',                  continent: 'Africa' },
  { code: 'TD', name: 'Chad',                   continent: 'Africa' },
  { code: 'CM', name: 'Cameroon',               continent: 'Africa' },
  { code: 'CF', name: 'Central African Republic', continent: 'Africa' },
  { code: 'GA', name: 'Gabon',                  continent: 'Africa' },
  { code: 'CG', name: 'Republic of the Congo',  continent: 'Africa' },
  { code: 'CD', name: 'DR Congo',               continent: 'Africa' },
  { code: 'AO', name: 'Angola',                 continent: 'Africa' },
  { code: 'ZM', name: 'Zambia',                 continent: 'Africa' },
  { code: 'ZW', name: 'Zimbabwe',               continent: 'Africa' },
  { code: 'MZ', name: 'Mozambique',             continent: 'Africa' },
  { code: 'MW', name: 'Malawi',                 continent: 'Africa' },
  { code: 'NA', name: 'Namibia',                continent: 'Africa' },
  { code: 'BW', name: 'Botswana',               continent: 'Africa' },
  { code: 'ZA', name: 'South Africa',           continent: 'Africa' },
  { code: 'LS', name: 'Lesotho',                continent: 'Africa' },
  { code: 'SZ', name: 'Eswatini',               continent: 'Africa' },
  { code: 'MG', name: 'Madagascar',             continent: 'Africa' },
  { code: 'MU', name: 'Mauritius',              continent: 'Africa' },
  { code: 'SC', name: 'Seychelles',             continent: 'Africa' },
  // Oceania
  { code: 'AU', name: 'Australia',              continent: 'Oceania' },
  { code: 'NZ', name: 'New Zealand',            continent: 'Oceania' },
  { code: 'PG', name: 'Papua New Guinea',       continent: 'Oceania' },
  { code: 'FJ', name: 'Fiji',                   continent: 'Oceania' },
  { code: 'SB', name: 'Solomon Islands',        continent: 'Oceania' },
  { code: 'VU', name: 'Vanuatu',                continent: 'Oceania' },
  { code: 'WS', name: 'Samoa',                  continent: 'Oceania' },
  { code: 'TO', name: 'Tonga',                  continent: 'Oceania' },
  { code: 'KI', name: 'Kiribati',               continent: 'Oceania' },
  { code: 'MH', name: 'Marshall Islands',       continent: 'Oceania' },
  { code: 'FM', name: 'Micronesia',             continent: 'Oceania' },
  { code: 'NR', name: 'Nauru',                  continent: 'Oceania' },
  { code: 'PW', name: 'Palau',                  continent: 'Oceania' },
  { code: 'TV', name: 'Tuvalu',                 continent: 'Oceania' },
].sort((a, b) => a.name.localeCompare(b.name));

export const COUNTRY_BY_CODE = COUNTRIES.reduce((m, c) => { m[c.code] = c; return m; }, {});

export const CONTINENTS = [
  'Africa', 'Asia', 'Europe', 'North America', 'Oceania', 'South America',
];

// Stable colors per continent — keep the analytics palette readable.
export const CONTINENT_COLORS = {
  Africa:          '#f59e0b',
  Asia:            '#3b82f6',
  Europe:          '#a78bfa',
  'North America': '#10b981',
  Oceania:         '#06b6d4',
  'South America': '#ef4444',
  Unknown:         '#94a3b8',
};

export function continentOf(countryCode) {
  if (!countryCode) return 'Unknown';
  const c = COUNTRY_BY_CODE[countryCode.toUpperCase()];
  return c ? c.continent : 'Unknown';
}

export function countryName(countryCode) {
  if (!countryCode) return 'Unknown';
  const c = COUNTRY_BY_CODE[countryCode.toUpperCase()];
  return c ? c.name : countryCode;
}

// ─── Primary UTC offset per country ────────────────────────────────────────
// For multi-timezone countries (US, RU, AU, BR, CA, MX) we pick the offset
// for the most populous region. The value is offset-in-minutes (e.g. -300
// for UTC-5, +330 for UTC+5:30). This is used by the Timezone-clustering
// chart on the Member analytics dashboard.
const TZ_OFFSET_MIN = {
  // North America
  US: -300, CA: -300, MX: -360, GT: -360, CU: -300, DO: -240, HT: -300,
  HN: -360, JM: -300, NI: -360, PA: -300, CR: -360, SV: -360, PR: -240,
  TT: -240, BS: -300, BB: -240,
  // South America
  BR: -180, AR: -180, CL: -240, CO: -300, PE: -300, VE: -240, EC: -300,
  BO: -240, PY: -240, UY: -180, GY: -240, SR: -180,
  // Europe
  GB:    0, IE:    0, FR:   60, DE:   60, ES:   60, IT:   60, PT:    0,
  NL:   60, BE:   60, CH:   60, AT:   60, SE:   60, NO:   60, DK:   60,
  FI:  120, IS:    0, PL:   60, CZ:   60, SK:   60, HU:   60, RO:  120,
  BG:  120, GR:  120, HR:   60, SI:   60, RS:   60, BA:   60, AL:   60,
  MK:   60, ME:   60, EE:  120, LV:  120, LT:  120, BY:  180, UA:  120,
  MD:  120, RU:  180, LU:   60, MT:   60, CY:  120,
  // Asia
  PH:  480, JP:  540, KR:  540, KP:  540, CN:  480, HK:  480, TW:  480,
  MO:  480, IN:  330, PK:  300, BD:  360, LK:  330, NP:  345, BT:  360,
  MV:  300, AF:  270, IR:  210, IQ:  180, SA:  180, AE:  240, QA:  180,
  KW:  180, BH:  180, OM:  240, YE:  180, IL:  120, PS:  120, JO:  120,
  LB:  120, SY:  120, TR:  180, AM:  240, AZ:  240, GE:  240, KZ:  360,
  KG:  360, TJ:  300, TM:  300, UZ:  300, MN:  480, TH:  420, VN:  420,
  LA:  420, KH:  420, MM:  390, MY:  480, SG:  480, BN:  480, ID:  420,
  TL:  540,
  // Africa
  EG:  120, LY:  120, TN:   60, DZ:   60, MA:   60, SD:  120, SS:  120,
  ET:  180, ER:  180, DJ:  180, SO:  180, KE:  180, UG:  180, TZ:  180,
  RW:  120, BI:  120, NG:   60, GH:    0, CI:    0, SN:    0, ML:    0,
  BF:    0, NE:   60, TD:   60, CM:   60, CF:   60, GA:   60, CG:   60,
  CD:   60, AO:   60, ZM:  120, ZW:  120, MZ:  120, MW:  120, NA:  120,
  BW:  120, ZA:  120, LS:  120, SZ:  120, MG:  180, MU:  240, SC:  240,
  // Oceania
  AU:  600, NZ:  720, PG:  600, FJ:  720, SB:  660, VU:  660, WS:  780,
  TO:  780, KI:  720, MH:  720, FM:  660, NR:  720, PW:  540, TV:  720,
};

export function tzOffsetMinutes(countryCode) {
  if (!countryCode) return null;
  const v = TZ_OFFSET_MIN[countryCode.toUpperCase()];
  return v == null ? null : v;
}

export function formatTzBucket(offsetMinutes) {
  if (offsetMinutes == null) return 'Unknown';
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const hh = Math.floor(abs / 60);
  const mm = abs % 60;
  return mm === 0 ? `UTC${sign}${hh}` : `UTC${sign}${hh}:${String(mm).padStart(2, '0')}`;
}
