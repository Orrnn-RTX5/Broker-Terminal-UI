import { readRegisteredSymbolContractSpec } from '../services/dailyChangePriceModeRegistry';

export interface ExposurePositionInput {
  symbol?: string | null;
  side?: string | null;
  volume?: number | string | null;
  quantity?: number | string | null;
  currentPrice?: number | string | null;
  current_price?: number | string | null;
  price_current?: number | string | null;
  openPrice?: number | string | null;
  open_price?: number | string | null;
  price_open?: number | string | null;
  contractSize?: number | string | null;
  contract_size?: number | string | null;
}

export interface ExposureAccountInput {
  balance?: number | string | null;
  equity?: number | string | null;
  margin?: number | string | null;
  freeMargin?: number | string | null;
  free_margin?: number | string | null;
  marginLevel?: number | string | null;
  margin_level?: number | string | null;
  leverage?: number | string | null;
  currency?: string | null;
}

export interface ExposureRow {
  asset: string;
  volume: number;
  rate: number;
  value: number;
  longValue: number;
  shortValue: number;
  graphPercent: number;
  color: string;
}

export interface ExposurePieSegment {
  asset: string;
  value: number;
  percent: number;
  color: string;
  startAngle: number;
  endAngle: number;
}

export interface ExposureSummary {
  rows: ExposureRow[];
  longSegments: ExposurePieSegment[];
  totalLongValue: number;
  totalShortValue: number;
  maxAbsValue: number;
  accountCurrency: string;
}

const KNOWN_ASSETS = [
  'USDT',
  'USDC',
  'BTC',
  'ETH',
  'XAU',
  'XAG',
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'CHF',
  'CAD',
  'AUD',
  'NZD',
] as const;

const FIAT_ASSETS = new Set(['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD']);

const ASSET_COLORS = [
  '#2f3cff',
  '#ff3344',
  '#f4c542',
  '#00a67d',
  '#8b5cf6',
  '#22b8cf',
  '#f97316',
  '#94a3b8',
];

const toFiniteNumber = (value: unknown, fallback = 0): number => {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
};

const normalizeAsset = (value: unknown, fallback = 'USD'): string => {
  const next = String(value ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  return next || fallback;
};

export const parseExposureSymbol = (symbol: unknown): { base: string; quote: string } | null => {
  const normalized = normalizeAsset(symbol, '');
  if (!normalized) return null;

  for (const base of KNOWN_ASSETS) {
    if (!normalized.startsWith(base)) continue;
    const remainder = normalized.slice(base.length);
    for (const quote of KNOWN_ASSETS) {
      if (remainder.startsWith(quote)) {
        return { base, quote };
      }
    }
  }

  if (normalized.length >= 6) {
    return { base: normalized.slice(0, 3), quote: normalized.slice(3, 6) };
  }

  return null;
};

/**
 * Broker contract size only: the position row's own field, then the scoped
 * instrument catalog. Null when neither publishes one (TERM-DIGITS-WL: never a
 * symbol-name table such as XAU=100 / FX=100000).
 */
export const getExposureContractSize = (position: ExposurePositionInput): number | null => {
  const explicit = toFiniteNumber(position.contractSize ?? position.contract_size, 0);
  if (explicit > 0) return explicit;
  return readRegisteredSymbolContractSpec(position.symbol).contractSize;
};

const getPositionRate = (position: ExposurePositionInput): number => {
  return toFiniteNumber(
    position.price_current
    ?? position.current_price
    ?? position.currentPrice
    ?? position.price_open
    ?? position.open_price
    ?? position.openPrice,
    0
  );
};

const getPositionVolume = (position: ExposurePositionInput): number => {
  return Math.abs(toFiniteNumber(position.volume ?? position.quantity, 0));
};

const getColorForAsset = (asset: string, index: number): string => {
  if (asset === 'USD') return '#2f3cff';
  if (asset === 'XAU' || asset === 'XAG') return '#ff3344';
  if (asset === 'GBP') return '#f4c542';
  if (asset === 'EUR') return '#22b8cf';
  return ASSET_COLORS[index % ASSET_COLORS.length];
};

const createEmptyExposureRow = (asset: string, color: string): ExposureRow => ({
  asset,
  volume: 0,
  rate: 1,
  value: 0,
  longValue: 0,
  shortValue: 0,
  graphPercent: 0,
  color,
});

const addExposureLeg = (
  rowsByAsset: Map<string, ExposureRow>,
  asset: string,
  volumeDelta: number,
  valueDelta: number,
  rate: number
): void => {
  const color = getColorForAsset(asset, rowsByAsset.size);
  const row = rowsByAsset.get(asset) ?? createEmptyExposureRow(asset, color);
  row.volume += volumeDelta;
  row.value += valueDelta;
  row.rate = rate > 0 ? rate : row.rate;
  rowsByAsset.set(asset, row);
};

export const buildExposureSummary = (
  positions: readonly ExposurePositionInput[],
  account?: ExposureAccountInput | null
): ExposureSummary => {
  const accountCurrency = normalizeAsset(account?.currency, 'USD');
  const rowsByAsset = new Map<string, ExposureRow>();
  const balance = toFiniteNumber(account?.balance, 0);
  const equity = toFiniteNumber(account?.equity, balance);
  const freeMargin = toFiniteNumber(account?.freeMargin ?? account?.free_margin, equity);
  const usedMargin = toFiniteNumber(account?.margin, 0);
  const leverage = toFiniteNumber(account?.leverage, 0);

  const positionExposures = positions.map((position) => {
    const parsedSymbol = parseExposureSymbol(position.symbol);
    if (!parsedSymbol) return null;

    const { base } = parsedSymbol;
    const lots = getPositionVolume(position);
    const rate = getPositionRate(position);
    if (lots <= 0 || rate <= 0) return null;

    const contractSize = getExposureContractSize(position);
    // Unknown contract size: the exposure cannot be sized honestly, so the
    // position is left out rather than sized from a guessed lot multiplier.
    if (contractSize === null) return null;
    const baseUnits = lots * contractSize;
    const notionalValue = baseUnits * rate;
    const direction = String(position.side ?? '').toUpperCase() === 'SELL' ? -1 : 1;

    return {
      base,
      baseUnits,
      direction,
      notionalValue,
      rate,
    };
  }).filter((exposure): exposure is NonNullable<typeof exposure> => exposure !== null);

  const totalNotionalValue = positionExposures.reduce((sum, exposure) => sum + exposure.notionalValue, 0);

  positionExposures.forEach((positionExposure) => {
    const marginValue = usedMargin > 0 && totalNotionalValue > 0
      ? (positionExposure.notionalValue / totalNotionalValue) * usedMargin
      : leverage > 0
        ? positionExposure.notionalValue / leverage
        : positionExposure.notionalValue;

    addExposureLeg(
      rowsByAsset,
      positionExposure.base,
      positionExposure.direction * positionExposure.baseUnits,
      positionExposure.direction * marginValue,
      positionExposure.rate
    );
  });

  const nonCashLongExposure = Array.from(rowsByAsset.values())
    .filter((row) => row.asset !== accountCurrency && row.value > 0)
    .reduce((sum, row) => sum + row.value, 0);
  const cashBasis = freeMargin > 0 ? freeMargin : equity > 0 ? equity : balance;
  const accountCurrencyValue = Math.max(0, cashBasis - nonCashLongExposure);

  if (accountCurrencyValue > 0) {
    addExposureLeg(rowsByAsset, accountCurrency, accountCurrencyValue, accountCurrencyValue, 1);
  }

  const rows = Array.from(rowsByAsset.values())
    .filter((row) => Math.abs(row.volume) > 0.00000001 || Math.abs(row.value) > 0.00000001)
    .map((row) => ({
      ...row,
      longValue: Math.max(row.value, 0),
      shortValue: Math.max(-row.value, 0),
    }))
    .sort((left, right) => {
      if (left.asset === accountCurrency) return -1;
      if (right.asset === accountCurrency) return 1;
      return Math.abs(right.value) - Math.abs(left.value) || left.asset.localeCompare(right.asset);
    });

  const maxAbsValue = Math.max(...rows.map((row) => Math.abs(row.value)), 1);
  const rowsWithGraphs = rows.map((row) => ({
    ...row,
    graphPercent: Math.min(100, Math.max(2, (Math.abs(row.value) / maxAbsValue) * 100)),
  }));

  const longRows = rowsWithGraphs.filter((row) => row.value > 0);
  const totalLongValue = longRows.reduce((sum, row) => sum + row.value, 0);
  let cursor = -90;
  const longSegments = longRows.map((row): ExposurePieSegment => {
    const percent = totalLongValue > 0 ? row.value / totalLongValue : 0;
    const startAngle = cursor;
    const endAngle = cursor + percent * 360;
    cursor = endAngle;
    return {
      asset: row.asset,
      value: row.value,
      percent,
      color: row.color,
      startAngle,
      endAngle,
    };
  });

  return {
    rows: rowsWithGraphs,
    longSegments,
    totalLongValue,
    totalShortValue: rowsWithGraphs.reduce((sum, row) => sum + row.shortValue, 0),
    maxAbsValue,
    accountCurrency,
  };
};

export const formatExposureVolume = (asset: string, value: number): string => {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (FIAT_ASSETS.has(asset)) {
    if (abs >= 1000000) return `${sign}${(abs / 1000000).toFixed(3)}M`;
    if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(3)}K`;
    return `${sign}${abs.toFixed(2)}`;
  }

  if (abs >= 1000) return `${sign}${abs.toFixed(0)}`;
  if (abs >= 1) return `${sign}${abs.toFixed(2)}`;
  return `${sign}${abs.toFixed(5)}`;
};
