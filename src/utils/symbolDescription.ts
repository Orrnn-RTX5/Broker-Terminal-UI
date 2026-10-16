const ASSET_NAMES: Record<string, string> = {
  ADA: 'Cardano',
  AUD: 'Australian Dollar',
  AVAX: 'Avalanche',
  BCH: 'Bitcoin Cash',
  BNB: 'BNB',
  BTC: 'Bitcoin',
  CAD: 'Canadian Dollar',
  CHF: 'Swiss Franc',
  CNH: 'Offshore Chinese Yuan',
  CNY: 'Chinese Yuan',
  DKK: 'Danish Krone',
  DOGE: 'Dogecoin',
  DOT: 'Polkadot',
  ETH: 'Ethereum',
  EUR: 'Euro',
  GBP: 'British Pound',
  HKD: 'Hong Kong Dollar',
  HUF: 'Hungarian Forint',
  JPY: 'Japanese Yen',
  LINK: 'Chainlink',
  LTC: 'Litecoin',
  MXN: 'Mexican Peso',
  NOK: 'Norwegian Krone',
  NZD: 'New Zealand Dollar',
  PLN: 'Polish Zloty',
  SEK: 'Swedish Krona',
  SGD: 'Singapore Dollar',
  SOL: 'Solana',
  THB: 'Thai Baht',
  TRY: 'Turkish Lira',
  USD: 'US Dollar',
  XAG: 'Silver',
  XAU: 'Gold',
  XRP: 'XRP',
  ZAR: 'South African Rand',
};

const EXACT_SYMBOL_NAMES: Record<string, string> = {
  COCOA: 'Cocoa',
  COFFEE: 'Coffee',
  CORN: 'Corn',
  GER40: 'Germany 40 Index',
  'GER40-F': 'Germany 40 Index Futures',
  JPN225: 'Japan 225 Index',
  'JPN225-F': 'Japan 225 Index Futures',
  NAS100: 'Nasdaq 100 Index',
  'NAS100-F': 'Nasdaq 100 Index Futures',
  NATGAS: 'Natural Gas',
  SPX500: 'S&P 500 Index',
  'SPX500-F': 'S&P 500 Index Futures',
  UK100: 'UK 100 Index',
  'UK100-F': 'UK 100 Index Futures',
  US30: 'US 30 Index',
  'US30-F': 'US 30 Index Futures',
  WHEAT: 'Wheat',
};

export const getFallbackSymbolDescription = (symbol: string): string => {
  const normalized = String(symbol ?? '').trim().toUpperCase();
  if (!normalized) return '';

  const exact = EXACT_SYMBOL_NAMES[normalized];
  if (exact) return exact;

  const suffixMatch = normalized.match(/-(F|PERP)$/);
  const suffix = suffixMatch?.[1] === 'F'
    ? ' Futures'
    : suffixMatch?.[1] === 'PERP'
      ? ' Perpetual'
      : '';
  const withoutDerivativeSuffix = suffixMatch
    ? normalized.slice(0, -suffixMatch[0].length)
    : normalized;
  const brokerRoot = withoutDerivativeSuffix.split(/[._]/)[0] ?? withoutDerivativeSuffix;
  const root = brokerRoot === 'EUROUSD'
    ? 'EURUSD'
    : brokerRoot.replace(/^([A-Z]{3,4})[/\-:]([A-Z]{3,4})$/, '$1$2');

  const exactRoot = EXACT_SYMBOL_NAMES[root];
  if (exactRoot) return `${exactRoot}${suffix}`;

  for (const baseLength of [3, 4]) {
    const baseCode = root.slice(0, baseLength);
    const quoteCode = root.slice(baseLength);
    if (!/^[A-Z]{3,4}$/.test(baseCode) || !/^[A-Z]{3,4}$/.test(quoteCode)) continue;
    const base = ASSET_NAMES[baseCode];
    const quote = ASSET_NAMES[quoteCode];
    if (base && quote) return `${base} vs ${quote}${suffix}`;
  }

  return '';
};

const compactAlphanumeric = (value: string): string => (
  value.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
);

export const isTickerOnlyDescription = (symbol: string, candidate: string): boolean => {
  const trimmedCandidate = String(candidate ?? '').trim();
  if (!trimmedCandidate) return true;

  const normalizedSymbol = String(symbol ?? '').trim().toUpperCase();
  if (normalizedSymbol && trimmedCandidate.toUpperCase() === normalizedSymbol) return true;

  const compactCandidate = compactAlphanumeric(trimmedCandidate);
  const compactSymbol = compactAlphanumeric(normalizedSymbol);
  if (compactSymbol && compactCandidate === compactSymbol) return true;

  const compactBrokerRoot = compactAlphanumeric(normalizedSymbol.split(/[._]/)[0] ?? '');
  if (compactBrokerRoot && compactCandidate === compactBrokerRoot) return true;

  if (/^[A-Z0-9]{2,5}\s*[/\-:]\s*[A-Z0-9]{2,5}$/i.test(trimmedCandidate)) {
    return Boolean(getFallbackSymbolDescription(trimmedCandidate) || getFallbackSymbolDescription(normalizedSymbol));
  }

  return false;
};

export const normalizeSymbolDescriptionText = (symbol: string, candidate: string): string => {
  const trimmed = String(candidate ?? '').trim();
  if (!trimmed || isTickerOnlyDescription(symbol, trimmed)) return '';

  if (/^[A-Za-z][A-Za-z0-9 &.'()-]*\s+\/\s+[A-Za-z][A-Za-z0-9 &.'()-]*$/.test(trimmed)) {
    return trimmed.replace(/\s+\/\s+/g, ' vs ');
  }

  return trimmed;
};

export const resolveSymbolDescription = (
  symbol: string,
  rawDescription?: string | null,
): string => {
  const normalizedExplicit = normalizeSymbolDescriptionText(symbol, String(rawDescription ?? ''));
  if (normalizedExplicit) return normalizedExplicit;
  return getFallbackSymbolDescription(symbol);
};

