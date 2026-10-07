import type { QuoteTradingStatusFields } from '../utils/quoteTradingStatus';

export interface Tick extends QuoteTradingStatusFields {
  /** A current quote snapshot is not a financial stream event. */
  quoteDeliveryKind?: 'snapshot' | 'event';
  dailyChangeInput?: import('../utils/dailyChange').DailyChangeInput;
  provider_timestamp?: number;
  sequence?: string | number;
  source?: string;
  source_revision?: number;
  source_mismatch?: boolean;
  stale?: boolean;
  tradable?: boolean;
  symbol: string;
  bid: number;
  ask: number;
  spread: number;
  timestamp: number;
  /** Upstream event time, distinct from a local receipt-time fallback. */
  sourceTimestamp?: number;
  lp?: string;
  volume?: number;
}

export type CandleUpdateSource = 'server' | 'local';

export interface OHLCV {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Provenance used to keep a delayed local aggregation from replacing backend OHLC. */
  source?: CandleUpdateSource;
  /** Upstream revision/event time in milliseconds when the backend supplies one. */
  sourceTimestamp?: number;
  /** Backend finality for the bucket; omitted when the adapter did not report it. */
  closed?: boolean;
}
