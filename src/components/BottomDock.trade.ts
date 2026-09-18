import {
  getExposureContractSize,
  parseExposureSymbol,
} from './BottomDock.exposure';
import { accountMetricAvailable, accountMetricNumber, type AccountMetric } from '../services/accountMetrics';
import type { Account } from '../store/useAppStore';

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
  hasBackendBalance?: boolean;
  hasBackendMargin?: boolean;
  hasBackendCredit?: boolean;
  hasBackendFloatingPnL?: boolean;
  metricsStatus?: string;
  metricUpdatedAt?: Account['metricUpdatedAt'];
  unrealizedPL?: unknown;
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
  balance: number | null;
  credit: number | null;
  /** Backend equity, or null when the backend did not supply it. */
  equity: number | null;
  margin: number | null;
  floatingPnL: number | null;
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

export const readBackendPositionProfit = (position: TradeProfitInput): number | null => {
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
 * Availability and freshness apply to balance, credit and used margin as well.
 */
export const resolveTradeAccountMetrics = (
  account: TradeAccountMetricInput | null | undefined,
  now = Date.now(),
): TradeAccountMetricResolution => {
  const metric = (key: AccountMetric) => accountMetricAvailable(account as Partial<Account>, key, now)
    ? accountMetricNumber(account?.[key]) : null;
  const balance = metric('balance');
  const normalizedCredit = account?.credit ?? account?.bonus;
  const credit = accountMetricAvailable({ ...account, credit: normalizedCredit } as Partial<Account>, 'credit', now)
    ? accountMetricNumber(normalizedCredit) : null;
  const rawMargin = metric('margin');
  const margin = rawMargin !== null && rawMargin >= 0 ? rawMargin : null;
  const floatingPnL = metric('unrealizedPL');
  const warnings: string[] = [];

  const equity = metric('equity');
  if (equity === null) {
    warnings.push('missing_backend_equity');
  }

  const normalizedFreeMargin = account?.freeMargin ?? account?.free_margin ?? account?.margin_free ?? account?.margin_available;
  const freeMargin = accountMetricAvailable({ ...account, freeMargin: normalizedFreeMargin } as Partial<Account>, 'freeMargin', now)
    ? accountMetricNumber(normalizedFreeMargin) : null;
  if (freeMargin === null) {
    warnings.push('missing_backend_free_margin');
  }

  const normalizedMarginLevel = account?.marginLevel ?? account?.margin_level;
  const marginLevel = accountMetricAvailable({ ...account, marginLevel: normalizedMarginLevel } as Partial<Account>, 'marginLevel', now)
    ? accountMetricNumber(normalizedMarginLevel) : null;
  if (marginLevel === null) {
    warnings.push('missing_backend_margin_level');
  }

  return {
    balance,
    credit,
    equity,
    margin,
    floatingPnL,
    freeMargin,
    marginLevel,
    equitySource: equity === null ? 'unavailable' : 'backend',
    freeMarginSource: freeMargin === null ? 'unavailable' : 'backend',
    marginLevelSource: marginLevel === null ? 'unavailable' : 'backend',
    warnings,
  };
};

/**
 * Local contract-size reconstruction. Not a display or trading substitute.
 * Live profit in the terminal comes only from readBackendPositionProfit.
 */
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
  const backendProfit = readBackendPositionProfit(position);
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

  if (backendProfit !== null) {
    return {
      value: backendProfit,
      source: 'backend',
      estimate: null,
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
