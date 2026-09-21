import { readBackendNumber } from '../services/backendAccountMetrics';

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
  hasBackendBalance?: boolean;
  hasBackendEquity?: boolean;
  hasBackendMargin?: boolean;
  hasBackendFreeMargin?: boolean;
  hasBackendMarginLevel?: boolean;
  hasBackendUnrealizedPL?: boolean;
  hasBackendCredit?: boolean;
  credit?: unknown;
  bonus?: unknown;
}

export type TradeAccountMetricSource = 'backend' | 'unavailable';

export interface TradeAccountMetricResolution {
  balance: number | null;
  credit: number | null;
  equity: number | null;
  margin: number | null;
  freeMargin: number | null;
  marginLevel: number | null;
  unrealizedPL: number | null;
  equitySource: TradeAccountMetricSource;
  freeMarginSource: TradeAccountMetricSource;
  marginLevelSource: TradeAccountMetricSource;
  warnings: string[];
}

export const toBackendFinancialNumber = (value: unknown): number | null => readBackendNumber(value) ?? null;

/** Missing backend fields stay unavailable; no account metric is reconstructed locally. */
export const resolveTradeAccountMetrics = (
  account: TradeAccountMetricInput | null | undefined,
): TradeAccountMetricResolution => {
  const read = (value: unknown, supplied?: boolean) => supplied === false ? null : toBackendFinancialNumber(value);
  const balance = read(account?.balance, account?.hasBackendBalance);
  const credit = read(account?.credit ?? account?.bonus, account?.hasBackendCredit);
  const equity = read(account?.equity, account?.hasBackendEquity);
  const margin = read(account?.margin, account?.hasBackendMargin);
  const freeMargin = read(
    account?.freeMargin ?? account?.free_margin ?? account?.margin_free ?? account?.margin_available,
    account?.hasBackendFreeMargin,
  );
  const marginLevel = read(account?.marginLevel ?? account?.margin_level, account?.hasBackendMarginLevel);
  const unrealizedPL = read(
    account?.unrealizedPL ?? account?.floating_pnl ?? account?.floating ?? account?.profit ?? account?.unrealized_pl,
    account?.hasBackendUnrealizedPL,
  );
  const warnings = [
    [balance, 'missing_backend_balance'],
    [credit, 'missing_backend_credit'],
    [equity, 'missing_backend_equity'],
    [margin, 'missing_backend_margin'],
    [freeMargin, 'missing_backend_free_margin'],
    [marginLevel, 'missing_backend_margin_level'],
    [unrealizedPL, 'missing_backend_floating_pnl'],
  ].filter(([value]) => value === null).map(([, warning]) => String(warning));

  return {
    balance, credit, equity, margin, freeMargin, marginLevel, unrealizedPL,
    equitySource: equity === null ? 'unavailable' : 'backend',
    freeMarginSource: freeMargin === null ? 'unavailable' : 'backend',
    marginLevelSource: marginLevel === null ? 'unavailable' : 'backend',
    warnings,
  };
};

/** The trading server owns contract, currency-conversion, commission and profit rules. */
export const resolveTradeProfit = (position: TradeProfitInput): TradeProfitResolution => {
  const value = position.hasBackendProfit === false
    ? null
    : toBackendFinancialNumber(position.profit ?? position.unrealizedPnL ?? position.unrealized_pl);
  return {
    value,
    source: value === null ? 'missing' : 'backend',
    warnings: value === null ? ['missing_backend_profit'] : [],
  };
};
