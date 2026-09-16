// Assigned ISO 3166-1 alpha-2 codes, verified 2026-09-15 against pycountry's
// ISO database: https://github.com/pycountry/pycountry/blob/main/src/pycountry/databases/iso3166-1.json
// Keep this allowlist explicit: Intl also recognizes reserved and non-ISO regions.
export const ISO_COUNTRY_CODES: readonly string[] = `
AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ
BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ
CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ
DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR
GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY
HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP
KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY
MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ
NA NC NE NF NG NI NL NO NP NR NU NZ OM
PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW
SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ
TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ
UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW
`.trim().split(/\s+/);

export interface CountryOption { code: string; name: string }

const displayNames = typeof Intl.DisplayNames === 'function'
  ? new Intl.DisplayNames(['en'], { type: 'region' })
  : null;

export const COUNTRIES: readonly CountryOption[] = ISO_COUNTRY_CODES
  .map(code => ({ code, name: displayNames?.of(code) || code }))
  .sort((first, second) => first.name.localeCompare(second.name, 'en'));

const normalizeQuery = (query: string): string => query.normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[’']/g, '').trim().toLowerCase();

export const resolveCountryCode = (query: string): string => {
  const normalized = normalizeQuery(query);
  return COUNTRIES.find(country => country.code.toLowerCase() === normalized
    || normalizeQuery(country.name) === normalized)?.code || '';
};

export const getCountryName = (code: string): string => (
  COUNTRIES.find(country => country.code === code.toUpperCase())?.name || ''
);

export const filterCountries = (query: string): readonly CountryOption[] => {
  const normalized = normalizeQuery(query);
  if (!normalized) return COUNTRIES;
  return COUNTRIES.filter(country => country.code.toLowerCase().startsWith(normalized)
    || normalizeQuery(country.name).includes(normalized))
    .sort((first, second) => Number(second.code.toLowerCase() === normalized)
      - Number(first.code.toLowerCase() === normalized));
};
