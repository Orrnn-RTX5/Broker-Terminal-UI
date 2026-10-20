import { formatAccountAmount, resolveAccountCurrencyDigits } from '../utils/accountCurrency';
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
  hasBackendCurrentPrice?: boolean;
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
  swap?: unknown;
  storage?: unknown;
  commission?: unknown;
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
 * Availability applies to every metric: a value is only usable when the backend actually
 * supplied it (`hasBackend*` provenance) AND the snapshot carrying it is not marked
 * stale/unavailable/invalid (`metricsStatus`). Age alone does not hide a value: the backend
 * only republishes account metrics when something changes, so a quiet account (for example
 * one with no open positions) keeps its last published figures, as MT5 does. Open-position
 * figures stay live through applyLivePositionProfit. Session changes clear the account.
 */
export const resolveTradeAccountMetrics = (
  account: TradeAccountMetricInput | null | undefined,
  now = Date.now(),
): TradeAccountMetricResolution => {
  // Resolve aliases first, then apply the provenance + staleness gate to the
  // normalized value so raw (not yet normalized) payloads behave too.
  const read = (key: AccountMetric, value: unknown, supplied?: boolean): number | null => (
    supplied === false
      || !accountMetricAvailable({ ...account, [key]: value } as Partial<Account>, key, now, Number.POSITIVE_INFINITY)
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
 * Keeps equity, free margin, margin level and floating P/L moving with the live
 * position stream between backend account snapshots.
 *
 * The backend streams per-position profit far more often than it publishes account
 * metrics. Its position `profit` excludes swap and commission, so the live floating
 * P/L is the sum of each open position's profit + swap + commission (the same rule
 * as the mobile app), and equity = balance + credit + floating P/L. Balance,
 * credit and margin stay exactly as the backend reports them. Metrics the backend
 * did not supply stay unavailable, and nothing is derived while any open position
 * is missing its backend profit.
 */
export const applyLivePositionProfit = (
  metrics: TradeAccountMetricResolution,
  positions: readonly TradeProfitInput[],
): TradeAccountMetricResolution => {
  // The visible position snapshot can reach zero before the backend republishes
  // account metrics after Close All. Do not retain that stale pre-close +/- P/L.
  // Preserve an unavailable metric as unavailable instead of inventing a zero.
  if (positions.length === 0) {
    return metrics.floatingPnL === null
      ? metrics
      : { ...metrics, floatingPnL: 0, unrealizedPL: 0 };
  }
  if (metrics.balance === null) return metrics;
  let floatingPnL = 0;
  for (const position of positions) {
    const profit = resolveTradeProfit(position).value;
    if (profit === null) return metrics;
    floatingPnL += profit + toFiniteNumber(position.swap ?? position.storage) + toFiniteNumber(position.commission);
  }
  if (!Number.isFinite(floatingPnL)) return metrics;

  const liveEquity = metrics.balance + (metrics.credit ?? 0) + floatingPnL;
  const equity = metrics.equity === null ? null : liveEquity;
  const margin = metrics.margin;
  const freeMargin = metrics.freeMargin === null || margin === null ? metrics.freeMargin : liveEquity - margin;
  const marginLevel = metrics.marginLevel === null || margin === null || margin <= 0
    ? metrics.marginLevel
    : (liveEquity / margin) * 100;
  const livePnL = metrics.floatingPnL === null ? null : floatingPnL;
  return {
    ...metrics,
    equity,
    freeMargin,
    marginLevel,
    floatingPnL: livePnL,
    unrealizedPL: livePnL,
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

// Backend profit arrives rounded to cents, which hides most price ticks on small
// lots. Half a cent plus float noise is the widest rounding gap we accept.
const BACKEND_PROFIT_ROUNDING_TOLERANCE = 0.005 + 1e-9;

/**
 * The trading server owns contract, currency-conversion, commission and profit rules.
 * The unrounded price x volume x contract-size profit is shown only when it rounds to
 * the backend value, i.e. when it provably follows the backend's own rules; any other
 * case (currency conversion, unknown contract size) shows the backend value verbatim.
 */
export const resolveTradeProfit = (position: TradeProfitInput): TradeProfitResolution => {
  const backend = readBackendPositionProfit(position);
  const precise = backend === null || position.hasBackendCurrentPrice === false
    ? null
    : calculateLivePositionProfit(position);
  const value = precise !== null && Math.abs(precise - backend!) <= BACKEND_PROFIT_ROUNDING_TOLERANCE
    ? precise
    : backend;
  return {
    value,
    source: value === null ? 'missing' : 'backend',
    warnings: value === null ? ['missing_backend_profit'] : [],
  };
};

/**
 * Open-position P/L rendered at the account currency's canonical precision.
 * Delegates to the same formatter as the balance bar so P&L and balances can
 * never disagree about decimals for the same account.
 */
export const formatPositionProfit = (value: number, currencyDigits: number): string =>
  formatAccountAmount(value, currencyDigits);

export const resolvePositionProfitDigits = (account: unknown): number => (
  resolveAccountCurrencyDigits(account)
);
