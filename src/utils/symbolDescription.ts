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
  const root = suffixMatch ? normalized.slice(0, -suffixMatch[0].length) : normalized;
  if (!/^[A-Z]{6}$/.test(root)) return '';

  const base = ASSET_NAMES[root.slice(0, 3)];
  const quote = ASSET_NAMES[root.slice(3, 6)];
  return base && quote ? `${base} vs ${quote}${suffix}` : '';
};

