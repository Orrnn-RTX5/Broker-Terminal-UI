import {
  getExposureContractSize,
  parseExposureSymbol,
} from './BottomDock.exposure';
import { readBackendNumber } from '../services/backendAccountMetrics';
import {
  accountMetricAvailable,
  accountMetricNumber,
  type AccountMetric,
} from '../services/accountMetrics';
import type { Account } from '../store/useAppStore';

export interface TradeProfitInput {
  symbol?: string;
  side?: string;
  volume?: number | string;
  quantity?: number | string;
  profit?: unknown;
  unrealizedPnL?: unknown;
  unrealized_pl?: unknown;
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

export type TradeProfitSource = 'backend' | 'missing';

export interface TradeProfitResolution {
  value: number | null;
  source: TradeProfitSource;
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
  unrealizedPL?: unknown;
  floating_pnl?: unknown;
  floating?: unknown;
  profit?: unknown;
  unrealized_pl?: unknown;
  credit?: unknown;
  bonus?: unknown;
  hasBackendBalance?: boolean;
  hasBackendEquity?: boolean;
  hasBackendMargin?: boolean;
  hasBackendFreeMargin?: boolean;
  hasBackendMarginLevel?: boolean;
  hasBackendCredit?: boolean;
  // The two merged branches spell the floating-P/L provenance flag differently.
  // `hasBackendFloatingPnL` (written by services/accountMetrics.normalizeAccountMetrics)
  // is authoritative for live accounts; `hasBackendUnrealizedPL` (written by
  // services/backendAccountMetrics.normalizeBackendAccount) is retained as a legacy
  // spelling. Both stay declared - see resolveTradeAccountMetrics for the precedence.
  hasBackendFloatingPnL?: boolean;
  hasBackendUnrealizedPL?: boolean;
  // Broker-scoped metrics envelope metadata; drives the staleness gate below.
  metricsStatus?: string;
  metricUpdatedAt?: Account['metricUpdatedAt'];
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
  /** Backend free margin, or null when the backend did not supply it. */
  freeMargin: number | null;
  /** Backend margin level, or null when the backend did not supply it. */
  marginLevel: number | null;
  /**
   * Backend floating P/L. `floatingPnL` and `unrealizedPL` always carry the same
   * value; both names are exposed so callers from either merged branch resolve.
   */
  floatingPnL: number | null;
  unrealizedPL: number | null;
  equitySource: TradeAccountMetricSource;
  freeMarginSource: TradeAccountMetricSource;
  marginLevelSource: TradeAccountMetricSource;
  warnings: string[];
}

/** Decode a backend number/Money.amount without deriving or rounding its value. */
export const toBackendFinancialNumber = (value: unknown): number | null => readBackendNumber(value) ?? null;

const toFiniteNumber = (value: unknown, fallback = 0): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const getExplicitContractSize = (position: TradeProfitInput): number | null => (
  toBackendFinancialNumber(position.contractSize ?? position.contract_size)
);

/** The only source of live position profit. Never a local reconstruction. */
export const readBackendPositionProfit = (position: TradeProfitInput): number | null => {
  if (position.hasBackendProfit === false) return null;
  return toBackendFinancialNumber(position.profit ?? position.unrealizedPnL ?? position.unrealized_pl);
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
 * Availability and freshness apply to every metric: a value is only usable when the backend
 * actually supplied it (`hasBackend*` provenance) AND the broker-scoped snapshot carrying it
 * is still current (`metricsStatus` / `metricUpdatedAt`). Metrics from a previous broker or
 * account session therefore resolve to `null` instead of bleeding into the new session.
 */
export const resolveTradeAccountMetrics = (
  account: TradeAccountMetricInput | null | undefined,
  now = Date.now(),
): TradeAccountMetricResolution => {
  // Resolve aliases first, then apply the provenance + staleness gate to the
  // normalized value so raw (not yet normalized) payloads behave too.
  const read = (key: AccountMetric, value: unknown, supplied?: boolean): number | null => (
    supplied === false
      || !accountMetricAvailable({ ...account, [key]: value } as Partial<Account>, key, now)
      ? null
      : accountMetricNumber(value)
  );

  // Floating-P/L provenance precedence. `hasBackendFloatingPnL` is authoritative: the
  // surviving normalizer (accountMetrics.normalizeAccountMetrics, used by the account
  // socket, the gateway and the toolbox paths) is the only producer of live accounts and
  // it writes that flag, and it is also the flag `accountMetricAvailable` gates on. An
  // explicit `false` from the legacy `hasBackendUnrealizedPL` spelling still suppresses
  // the metric, so payloads and fixtures normalized by backendAccountMetrics stay
  // unavailable - but a legacy flag can never override an authoritative `true`.
  const floatingPnLSupplied = account?.hasBackendFloatingPnL
    ?? (account?.hasBackendUnrealizedPL === false ? false : undefined);

  const balance = read('balance', account?.balance, account?.hasBackendBalance);
  const credit = read('credit', account?.credit ?? account?.bonus, account?.hasBackendCredit);
  const equity = read('equity', account?.equity, account?.hasBackendEquity);
  // A negative used margin is not a reportable requirement: report it unavailable
  // rather than manufacturing a zero or showing a nonsensical negative.
  const rawMargin = read('margin', account?.margin, account?.hasBackendMargin);
  const margin = rawMargin !== null && rawMargin >= 0 ? rawMargin : null;
  const freeMargin = read(
    'freeMargin',
    account?.freeMargin ?? account?.free_margin ?? account?.margin_free ?? account?.margin_available,
    account?.hasBackendFreeMargin,
  );
  const marginLevel = read(
    'marginLevel',
    account?.marginLevel ?? account?.margin_level,
    account?.hasBackendMarginLevel,
  );
  const unrealizedPL = read(
    'unrealizedPL',
    account?.unrealizedPL ?? account?.floating_pnl ?? account?.floating ?? account?.profit ?? account?.unrealized_pl,
    floatingPnLSupplied,
  );

  const warnings: string[] = [];
  if (equity === null) {
    warnings.push('missing_backend_equity');
  }
  if (freeMargin === null) {
    warnings.push('missing_backend_free_margin');
  }
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
    floatingPnL: unrealizedPL,
    unrealizedPL,
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

/** The trading server owns contract, currency-conversion, commission and profit rules. */
export const resolveTradeProfit = (position: TradeProfitInput): TradeProfitResolution => {
  const value = readBackendPositionProfit(position);
  return {
    value,
    source: value === null ? 'missing' : 'backend',
    warnings: value === null ? ['missing_backend_profit'] : [],
  };
};
