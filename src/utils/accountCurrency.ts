// Account-currency display precision. The backend's canonical
// `currency_digits` (the account policy's currency scale) wins; Intl derives
// the ISO 4217 minor-unit count for currency codes from legacy gateways, so
// this is not USD-only. The final fallback is documented rather than silent:
// 2 is the conventional major-currency display when no metadata is available.
const MAX_CURRENCY_DIGITS = 8;
const DOCUMENTED_FALLBACK_DIGITS = 2;

export const normalizeCurrencyDigits = (value: unknown): number | undefined => {
  const digits = Number(value);
  return Number.isInteger(digits) && digits >= 0 && digits <= MAX_CURRENCY_DIGITS ? digits : undefined;
};

export const readBackendCurrencyDigits = (raw: unknown): number | undefined => {
  if (!raw || typeof raw !== 'object') return undefined;
  const record = raw as Record<string, unknown>;
  const candidate = record.currency_digits ?? record.currencyDigits
    ?? record.currency_scale ?? record.currencyScale ?? record.CurrencyScale;
  if (typeof candidate === 'string' && candidate.trim() === '') return undefined;
  if (typeof candidate !== 'number' && typeof candidate !== 'string') return undefined;
  return normalizeCurrencyDigits(candidate);
};

export const resolveAccountCurrencyDigits = (account: unknown): number => {
  const record = (account && typeof account === 'object' ? account : {}) as Record<string, unknown>;
  const explicit = readBackendCurrencyDigits(record);
  if (explicit !== undefined) return explicit;
  const currency = String(record.currency ?? '').trim().toUpperCase();
  if (currency) {
    try {
      const digits = new Intl.NumberFormat('en-US', {
        style: 'currency', currency,
      }).resolvedOptions().maximumFractionDigits;
      if (Number.isInteger(digits) && digits >= 0 && digits <= MAX_CURRENCY_DIGITS) return digits;
    } catch {
      // Unknown/non-ISO currency: use the documented fallback below.
    }
  }
  return DOCUMENTED_FALLBACK_DIGITS;
};

/**
 * The single money formatter for account-currency amounts (balance bar,
 * floating P/L, open-position profit, closed-trade profit). MT5-style grouping
 * uses spaces instead of commas; a negative zero is printed as zero.
 */
export const formatAccountAmount = (value: number, currencyDigits: number): string => {
  const digits = normalizeCurrencyDigits(currencyDigits) ?? DOCUMENTED_FALLBACK_DIGITS;
  const numeric = Number.isFinite(value) ? value : 0;
  const fixed = numeric.toFixed(digits);
  const [whole, fraction] = (Number(fixed) === 0 ? fixed.replace('-', '') : fixed).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
};
