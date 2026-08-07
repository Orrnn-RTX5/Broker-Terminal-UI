import {
  getExposureContractSize,
  parseExposureSymbol,
} from './BottomDock.exposure';

export interface TradeProfitInput {
  symbol?: string;
  side?: string;
  volume?: number | string;
  quantity?: number | string;
  profit?: number | string;
  unrealizedPnL?: number | string;
  unrealized_pl?: number | string;
  hasBackendProfit?: boolean;
  openPrice?: number | string;
  open_price?: number | string;
  price_open?: number | string;
  currentPrice?: number | string;
  current_price?: number | string;
  price_current?: number | string;
  contractSize?: number | string;
  contract_size?: number | string;
  currency_profit?: string;
  profitCurrency?: string;
}

export type TradeProfitSource = 'backend' | 'calculated' | 'estimated' | 'missing';

export interface TradeProfitResolution {
  value: number;
  source: TradeProfitSource;
  estimate: number | null;
  warnings: string[];
}

export interface TradeAccountMetricInput {
  balance?: unknown;
  equity?: unknown;
  margin?: unknown;
  freeMargin?: unknown;
  free_margin?: unknown;
  margin_free?: unknown;
  margin_available?: unknown;
  marginLevel?: unknown;
  margin_level?: unknown;
  hasBackendEquity?: boolean;
  hasBackendFreeMargin?: boolean;
  hasBackendMarginLevel?: boolean;
  credit?: unknown;
  bonus?: unknown;
}

/**
 * `backend` — the value came straight from the trading backend and is displayed verbatim.
 * `unavailable` — the backend did not send the value. The terminal does NOT substitute a
 * locally computed number; callers must render an explicit "no value" placeholder.
 */
export type TradeAccountMetricSource = 'backend' | 'unavailable';

export interface TradeAccountMetricResolution {
  balance: number;
  credit: number;
  /** Backend equity, or null when the backend did not supply it. */
  equity: number | null;
  margin: number;
  /** Backend free margin, or null when the backend did not supply it. */
  freeMargin: number | null;
  /** Backend margin level, or null when the backend did not supply it. */
  marginLevel: number | null;
  equitySource: TradeAccountMetricSource;
  freeMarginSource: TradeAccountMetricSource;
  marginLevelSource: TradeAccountMetricSource;
  warnings: string[];
}

const toFiniteNumber = (value: unknown, fallback = 0): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const toOptionalFiniteNumber = (value: unknown): number | null => {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const getExplicitContractSize = (position: TradeProfitInput): number | null => (
  toOptionalFiniteNumber(position.contractSize ?? position.contract_size)
);

const getBackendProfit = (position: TradeProfitInput): number | null => {
  if (position.hasBackendProfit === false) return null;
  return toOptionalFiniteNumber(position.profit ?? position.unrealizedPnL ?? position.unrealized_pl);
};

const getProfitCurrency = (position: TradeProfitInput, symbolQuote?: string): string | null => {
  const raw = position.currency_profit ?? position.profitCurrency ?? symbolQuote;
  const value = String(raw ?? '').trim().toUpperCase();
  return value || null;
};

/**
 * Account metrics are BACKEND-AUTHORITATIVE.
 *
 * Equity, free margin and margin level are displayed exactly as the trading backend reports
 * them. The terminal never recomputes them, never compares them against a locally derived
 * figure, and never substitutes its own number when the two disagree — the backend owns the
 * swap/commission/conversion rules that a browser cannot reproduce faithfully.
 *
 * When the backend omits a metric it is reported as `null` / `'unavailable'` so the UI can
 * render an explicit placeholder instead of a misleading zero.
 *
 * `balance`, `credit` and `margin` keep their plain passthrough behaviour.
 */
export const resolveTradeAccountMetrics = (
  account: TradeAccountMetricInput | null | undefined,
): TradeAccountMetricResolution => {
  const balance = toFiniteNumber(account?.balance, 0);
  const credit = toFiniteNumber(account?.credit ?? account?.bonus, 0);
  const margin = Math.max(0, toFiniteNumber(account?.margin, 0));
  const warnings: string[] = [];

  const equity = account?.hasBackendEquity === false
    ? null
    : toOptionalFiniteNumber(account?.equity);
  if (equity === null) {
    warnings.push('missing_backend_equity');
  }

  const freeMargin = account?.hasBackendFreeMargin === false
    ? null
    : toOptionalFiniteNumber(
      account?.freeMargin ?? account?.free_margin ?? account?.margin_free ?? account?.margin_available,
    );
  if (freeMargin === null) {
    warnings.push('missing_backend_free_margin');
  }

  const marginLevel = account?.hasBackendMarginLevel === false
    ? null
    : toOptionalFiniteNumber(account?.marginLevel ?? account?.margin_level);
  if (marginLevel === null) {
    warnings.push('missing_backend_margin_level');
  }

  return {
    balance,
    credit,
    equity,
    margin,
    freeMargin,
    marginLevel,
    equitySource: equity === null ? 'unavailable' : 'backend',
    freeMarginSource: freeMargin === null ? 'unavailable' : 'backend',
    marginLevelSource: marginLevel === null ? 'unavailable' : 'backend',
    warnings,
  };
};

export const calculateLivePositionProfit = (
  position: TradeProfitInput,
  options: { requireExplicitContractSize?: boolean } = {}
): number | null => {
  const symbol = String(position.symbol ?? '').toUpperCase();
  const parsed = parseExposureSymbol(symbol);
  if (!parsed) return null;

  const openPrice = toFiniteNumber(
    position.price_open ?? position.open_price ?? position.openPrice,
    0
  );
  const currentPrice = toFiniteNumber(
    position.price_current ?? position.current_price ?? position.currentPrice,
    0
  );
  const volume = Math.abs(toFiniteNumber(position.volume ?? position.quantity, 0));

  if (openPrice <= 0 || currentPrice <= 0 || volume <= 0) return null;

  const explicitContractSize = getExplicitContractSize(position);
  if (options.requireExplicitContractSize && (!explicitContractSize || explicitContractSize <= 0)) {
    return null;
  }

  const direction = String(position.side ?? '').toUpperCase() === 'SELL' ? -1 : 1;
  const contractSize = explicitContractSize ?? getExposureContractSize(position, parsed.base, parsed.quote);
  const profit = (currentPrice - openPrice) * direction * volume * contractSize;

  return Number.isFinite(profit) ? profit : null;
};

export const resolveTradeProfit = (
  position: TradeProfitInput,
  options: { accountCurrency?: string } = {}
): TradeProfitResolution => {
  const symbol = String(position.symbol ?? '').toUpperCase();
  const parsed = parseExposureSymbol(symbol);
  const explicitContractSize = getExplicitContractSize(position);
  const backendProfit = getBackendProfit(position);
  const strictEstimate = calculateLivePositionProfit(position, { requireExplicitContractSize: true });
  const fallbackEstimate = strictEstimate ?? calculateLivePositionProfit(position);
  const accountCurrency = String(options.accountCurrency ?? '').trim().toUpperCase();
  const profitCurrency = getProfitCurrency(position, parsed?.quote);
  const requiresConversion = Boolean(accountCurrency && profitCurrency && profitCurrency !== accountCurrency);
  const warnings: string[] = [];

  if (!explicitContractSize || explicitContractSize <= 0) {
    warnings.push('missing_contract_size');
  }
  if (!position.currency_profit && !position.profitCurrency) {
    warnings.push('missing_profit_currency');
  }
  if (requiresConversion) {
    warnings.push('requires_profit_currency_conversion');
  }
  if (backendProfit !== null && strictEstimate !== null) {
    const tolerance = Math.max(0.01, Math.abs(strictEstimate) * 0.05);
    if (Math.abs(backendProfit - strictEstimate) > tolerance) {
      warnings.push('backend_profit_differs_from_contract_calculation');
    }
  }

  if (backendProfit !== null) {
    return {
      value: backendProfit,
      source: 'backend',
      estimate: fallbackEstimate,
      warnings,
    };
  }

  if (strictEstimate !== null && !requiresConversion) {
    return {
      value: strictEstimate,
      source: 'calculated',
      estimate: strictEstimate,
      warnings,
    };
  }

  if (fallbackEstimate !== null && !requiresConversion) {
    return {
      value: fallbackEstimate,
      source: 'estimated',
      estimate: fallbackEstimate,
      warnings,
    };
  }

  return {
    value: 0,
    source: 'missing',
    estimate: null,
    warnings,
  };
};
