import type { AccountCatalogStatus } from '../../utils/accountSymbolUniverse';

export interface MarketInstrument {
  symbol: string;
  /**
   * Immutable top-level snapshot of the broker row used to build this
   * instrument. Keep it alongside normalized trading fields so feature
   * surfaces such as Specification can consume broker-specific metadata
   * without weakening the normalized execution contract.
   */
  brokerSpecification?: Readonly<Record<string, unknown>>;
  description?: string;
  category?: string;
  digits?: number;
  bid?: number;
  ask?: number;
  spread?: number;
  contractSize?: number;
  tickSize?: number;
  minVolume?: number;
  maxVolume?: number;
  volumeStep?: number;
  marginRate?: number;
  swapLong?: number;
  swapShort?: number;
  commission?: number;
  tradingEnabled?: boolean;
  timestamp?: number;
  /** Authenticated catalogue only: account group spread markup in points. */
  spreadMarkup?: number;
}

export interface MarketInstrumentsSnapshot {
  symbols: MarketInstrument[];
  authorizedInstruments: MarketInstrument[];
  authorizedSymbols: string[];
  disabledSymbols: string[];
  authorizationSettled: boolean;
  /** Complete successful catalog for this broker/account, suitable for replacing saved selections. */
  chartCatalogCurrent?: boolean;
  /**
   * Authenticated account catalogue lifecycle. While `loading`/`loaded` the
   * `symbols` list is the account's own catalogue (empty until known), never
   * the public broker list. `none` for guests; `failed` = public fallback.
   */
  accountCatalogStatus?: AccountCatalogStatus;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  /** Fetches a fresh, account-scoped broker snapshot when Specification opens. */
  loadSymbolSpecification?: (
    symbol: string,
    signal?: AbortSignal,
  ) => Promise<Readonly<Record<string, unknown>> | null>;
}

export interface OrderBookLevel {
  price: number;
  volume: number;
  total: number;
}

export interface LiveOrderBook {
  symbol: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  spread: number;
  /** Spread in pips from broker digits; null when the broker published no precision. */
  spreadPips: number | null;
  timestamp: number;
}

export interface ActiveMarketSymbolsCache {
  symbols: string[];
  updatedAt: number;
  availableCount?: number;
  silentCount?: number;
}

export interface StaleQuoteFailure {
  isStale: boolean;
  symbols: string[];
}
