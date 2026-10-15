import type { QuoteTradingStatusFields } from '../utils/quoteTradingStatus';

export interface Tick extends QuoteTradingStatusFields {
  dailyChangeInput?: import('../utils/dailyChange').DailyChangeInput;
  symbol: string;
  bid: number;
  ask: number;
  last?: number;
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
