// Account-currency display precision. The backend value wins; Intl derives the
// ISO 4217 minor-unit count for every other currency, so this is not USD-only.
export const readBackendCurrencyDigits = (raw: unknown): number | undefined => {
  if (!raw || typeof raw !== 'object') return undefined;
  const record = raw as Record<string, unknown>;
  const value = Number(
    record.currency_digits ?? record.currencyDigits
    ?? record.currency_scale ?? record.currencyScale ?? record.CurrencyScale,
  );
  return Number.isInteger(value) && value >= 0 && value <= 8 ? value : undefined;
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
      if (Number.isInteger(digits) && digits >= 0 && digits <= 8) return digits;
    } catch {
      // Unknown/non-ISO currency: do not invent a precision.
    }
  }
  return 0;
};
