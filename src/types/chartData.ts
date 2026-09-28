export interface OHLCData {
  time: number;
  /** Broker timestamp before D1 boundary alignment, in Unix seconds. */
  sourceTime?: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tickVolume?: number;
  realVolume?: number;
  closed?: boolean;
}

export interface FetchCandlesOptions {
  symbol: string;
  timeframe: string;
  count?: number;
  from?: number;
  to?: number;
  signal?: AbortSignal;
  /** The snapshot started before this chart mounted; retain all observed live mutations. */
  onStartupPrefetchConsumed?: () => void;
}
