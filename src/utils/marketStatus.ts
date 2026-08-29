import type { MarketStatus } from '../types/api';

export type KnownMarketStatus = MarketStatus['status'];
export type NormalizedMarketStatusValue = KnownMarketStatus | 'unknown';

export interface MarketStatusFormatOptions {
  locale?: string;
  timeZone?: string;
}

export interface NormalizeMarketStatusOptions extends MarketStatusFormatOptions {
  symbol?: string;
}

export interface NormalizedMarketStatus {
  symbol?: string;
  status: NormalizedMarketStatusValue;
  isOpen: boolean;
  isTradeBlocked: boolean;
  label: string;
  sessionOpenTimeMs?: number;
  sessionCloseTimeMs?: number;
  serverTimeMs?: number;
  sessionOpenText?: string;
  sessionCloseText?: string;
  scheduleText?: string;
}

const MARKET_STATUS_LABELS: Record<KnownMarketStatus, string> = {
  open: 'Market Open',
  closed: 'Market Closed',
  pre_market: 'Pre-market',
  after_hours: 'After hours',
};

const KNOWN_MARKET_STATUSES = new Set<KnownMarketStatus>([
  'open',
  'closed',
  'pre_market',
  'after_hours',
]);

const ALWAYS_OPEN_CRYPTO_ASSETS = new Set([
  'AAVE',
  'ADA',
  'ATOM',
  'AVAX',
  'BCH',
  'BNB',
  'BTC',
  'DOGE',
  'DOT',
  'EOS',
  'ETC',
  'ETH',
  'FIL',
  'LINK',
  'LTC',
  'MATIC',
  'NEAR',
  'SOL',
  'TRX',
  'UNI',
  'XLM',
  'XRP',
]);

const normalizeSymbol = (symbol: unknown): string | undefined => {
  const normalized = String(symbol ?? '').trim().toUpperCase();
  return normalized || undefined;
};

const normalizeCompactSymbol = (symbol: unknown): string => (
  String(symbol ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
);

export const isLikelyAlwaysOpenCryptoSymbol = (symbol: unknown): boolean => {
  const compact = normalizeCompactSymbol(symbol);
  if (!compact) return false;

  return Array.from(ALWAYS_OPEN_CRYPTO_ASSETS).some(asset => (
    compact.startsWith(asset)
    || compact.endsWith(asset)
  ));
};

export const isKnownMarketStatus = (status: unknown): status is KnownMarketStatus => (
  typeof status === 'string' && KNOWN_MARKET_STATUSES.has(status as KnownMarketStatus)
);

export const parseMarketSessionTimestampMs = (value: unknown): number | null => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
};

export const formatMarketSessionTimestamp = (
  value: unknown,
  options: MarketStatusFormatOptions = {},
): string | undefined => {
  const timestampMs = parseMarketSessionTimestampMs(value);
  if (timestampMs === null) return undefined;

  const date = new Date(timestampMs);
  if (Number.isNaN(date.getTime())) return undefined;

  const formatter = new Intl.DateTimeFormat(options.locale || undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    ...(options.timeZone ? { timeZone: options.timeZone } : {}),
  });
  const parts = formatter.formatToParts(date);
  const getPart = (type: Intl.DateTimeFormatPartTypes): string | undefined =>
    parts.find(part => part.type === type)?.value;

  const month = getPart('month');
  const day = getPart('day');
  const hour = getPart('hour');
  const minute = getPart('minute');
  if (!month || !day || !hour || !minute) return formatter.format(date);
  return `${month} ${day}, ${hour}:${minute}`;
};

const parseMarketTradeFlag = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value;
  if (value === 0 || value === 1) return value === 1;
  return undefined;
};

export const normalizeMarketStatus = (
  status: MarketStatus | null | undefined,
  options: NormalizeMarketStatusOptions = {},
): NormalizedMarketStatus => {
  const symbol = normalizeSymbol(status?.symbol) ?? normalizeSymbol(options.symbol);
  const reportedStatus = status?.status;
  const hasReportedStatus = typeof reportedStatus === 'string' && reportedStatus.trim().length > 0;
  const tradeOpen = parseMarketTradeFlag(status?.trade_open);
  const quoteOpen = parseMarketTradeFlag(status?.quote_open);
  const tradeFlagOpen = tradeOpen ?? quoteOpen;
  const normalizedStatus: NormalizedMarketStatusValue = isKnownMarketStatus(reportedStatus)
    ? reportedStatus
    : !hasReportedStatus && tradeFlagOpen !== undefined
      ? (tradeFlagOpen ? 'open' : 'closed')
    : !hasReportedStatus && isLikelyAlwaysOpenCryptoSymbol(symbol)
      ? 'open'
    : 'unknown';
  const isOpen = normalizedStatus === 'open';
  const sessionOpenTimeMs = parseMarketSessionTimestampMs(status?.session_open) ?? undefined;
  const sessionCloseTimeMs = parseMarketSessionTimestampMs(status?.session_close) ?? undefined;
  const serverTimeMs = parseMarketSessionTimestampMs(status?.server_time) ?? undefined;
  const sessionOpenText = formatMarketSessionTimestamp(sessionOpenTimeMs, options);
  const sessionCloseText = formatMarketSessionTimestamp(sessionCloseTimeMs, options);
  const scheduleText = isOpen
    ? sessionCloseText ? `Closes ${sessionCloseText}` : undefined
    : sessionOpenText ? `Opens ${sessionOpenText}` : undefined;

  return {
    symbol,
    status: normalizedStatus,
    isOpen,
    isTradeBlocked: !isOpen,
    label: normalizedStatus === 'unknown'
      ? 'Status unavailable'
      : MARKET_STATUS_LABELS[normalizedStatus],
    sessionOpenTimeMs,
    sessionCloseTimeMs,
    serverTimeMs,
    sessionOpenText,
    sessionCloseText,
    scheduleText,
  };
};

export const createUnavailableMarketStatus = (symbol?: string): NormalizedMarketStatus => (
  normalizeMarketStatus(null, { symbol })
);

export const shouldBlockSymbolTrading = (
  marketStatus: Pick<NormalizedMarketStatus, 'isTradeBlocked' | 'symbol'>,
  fallbackSymbol?: string,
): boolean => {
  const resolvedSymbol = normalizeSymbol(marketStatus.symbol) ?? normalizeSymbol(fallbackSymbol);
  if (isLikelyAlwaysOpenCryptoSymbol(resolvedSymbol)) return false;
  return marketStatus.isTradeBlocked;
};

export const getMarketStatusTradeBlockMessage = (
  marketStatus: Pick<NormalizedMarketStatus, 'status' | 'label' | 'symbol' | 'isTradeBlocked'>,
  fallbackSymbol?: string,
): string => {
  if (!shouldBlockSymbolTrading(marketStatus, fallbackSymbol)) return '';

  const symbol = normalizeSymbol(marketStatus.symbol) ?? normalizeSymbol(fallbackSymbol);
  const suffix = symbol ? ` for ${symbol}` : '';

  if (marketStatus.status === 'closed') {
    return `Market is closed${suffix}.`;
  }
  if (marketStatus.status === 'pre_market') {
    return `${symbol ? `${symbol} is` : 'Market is'} in pre-market. Trading is currently disabled.`;
  }
  if (marketStatus.status === 'after_hours') {
    return `${symbol ? `${symbol} is` : 'Market is'} after hours. Trading is currently disabled.`;
  }
  return `Market status unavailable${suffix}. Trading is blocked until status refreshes.`;
};
