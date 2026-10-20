import { screen } from '@testing-library/react';
import { vi } from 'vitest';

import type { MarketWatchLastPrice } from '../../../hooks/useLastMarketWatchQuotes';

export const CORE_DEFAULT_SYMBOLS = ['XAUUSD', 'BTCUSD', 'EURUSD'];
export const DEFAULT_SYMBOLS = [...CORE_DEFAULT_SYMBOLS, 'GBPUSD', 'USDJPY'];
export const DEFAULT_DISPLAY_SYMBOLS = [...CORE_DEFAULT_SYMBOLS];

export interface MockMarketInstrument {
  symbol: string;
  brokerSpecification?: Readonly<Record<string, unknown>>;
  name?: string;
  description?: string;
  category?: string;
  digits?: number;
  bid?: number;
  ask?: number;
  spread?: number;
  time?: string;
  has_quote?: boolean;
  contract_size?: number;
  contractSize?: number;
  tick_size?: number;
  tick_value?: number;
  trading_enabled?: boolean;
}

/**
 * Quote precision the test broker publishes on its instrument catalog rows.
 * Market Watch reads digits only from broker data, so fixtures that expect
 * fixed decimals must carry them on the catalog row like a real broker does.
 */
export const TEST_BROKER_PRICE_DIGITS: Readonly<Record<string, number>> = {
  XAUUSD: 2,
  BTCUSD: 2,
  EURUSD: 5,
  GBPUSD: 5,
  USDJPY: 3,
  SOLUSD: 2,
  ETHUSD: 2,
  '0001.HK': 3,
};

/** Catalog rows for the given symbols carrying the test broker's published digits. */
export const brokerCatalogRows = (symbols: readonly string[]): MockMarketInstrument[] => (
  symbols.map((symbol) => (
    TEST_BROKER_PRICE_DIGITS[symbol] === undefined
      ? { symbol }
      : { symbol, digits: TEST_BROKER_PRICE_DIGITS[symbol] }
  ))
);

const closedDailyChangeHookState = vi.hoisted(() => ({
  values: new Map<string, number>(),
  useHook: vi.fn(),
  hydrate: vi.fn(),
}));

const lastMarketWatchQuotesHookState = vi.hoisted(() => ({
  values: new Map<string, MarketWatchLastPrice>(),
  useHook: vi.fn(),
  hydrate: vi.fn(),
}));

const brokerAccountScopeHookState = vi.hoisted(() => ({
  value: 'authenticated|test-account|test-broker|https://broker.test',
}));

vi.mock('../../../hooks/useLastMarketWatchQuotes', () => ({
  useLastMarketWatchQuotes: (options: unknown) => {
    lastMarketWatchQuotesHookState.useHook(options);
    return lastMarketWatchQuotesHookState.values;
  },
  hydrateLastMarketWatchQuotes: (options: unknown) => lastMarketWatchQuotesHookState.hydrate(options),
}));

vi.mock('../../../hooks/useClosedMarketDailyChanges', () => ({
  useClosedMarketDailyChanges: (options: unknown) => {
    closedDailyChangeHookState.useHook(options);
    return closedDailyChangeHookState.values;
  },
  hydrateClosedMarketDailyChanges: (options: unknown) => closedDailyChangeHookState.hydrate(options),
}));

vi.mock('../../../hooks/useBrokerAccountSessionScope', () => ({
  useBrokerAccountSessionScope: () => brokerAccountScopeHookState.value,
}));

const marketHooksState = vi.hoisted(() => ({
  activeSymbols: ['BTCUSD', 'XAUUSD', 'GBPUSD', 'SOLUSD', 'EURUSD', 'ETHUSD', '0001.HK'],
  instrumentSymbols: ['BTCUSD', 'XAUUSD', 'GBPUSD', 'SOLUSD', 'EURUSD', 'ETHUSD', '0001.HK'] as Array<
    string | MockMarketInstrument
  >,
  authorizedInstruments: [] as MockMarketInstrument[],
  authorizedSymbols: ['BTCUSD', 'XAUUSD', 'GBPUSD', 'SOLUSD', 'EURUSD', 'ETHUSD', '0001.HK'] as string[],
  disabledSymbols: [] as string[],
  activeSymbolsLoading: false,
  activeSymbolsSettled: true,
  activeSymbolsCurrent: true,
  instrumentsLoading: false,
  accountCatalogStatus: undefined as 'none' | 'loading' | 'loaded' | 'failed' | undefined,
  symbolsError: null as string | null,
  watchlistError: null as string | null,
  reloadActiveSymbols: vi.fn().mockResolvedValue(undefined),
  loadSymbolSpecification: vi.fn().mockResolvedValue(null),
  useActiveMarketSymbols: vi.fn(),
  useLiveQuotes: vi.fn((symbols: string[]) => {
    void symbols;
    return {
      loading: false,
      error: null as string | null,
    };
  }),
}));

vi.mock('../../../hooks/useLiveMarketData', () => ({
  useActiveMarketSymbols: marketHooksState.useActiveMarketSymbols,
  useLiveQuotes: marketHooksState.useLiveQuotes,
  useMarketInstruments: () => ({
    symbols: marketHooksState.instrumentSymbols.map((instrument) => (
      typeof instrument === 'string' ? { symbol: instrument } : { ...instrument }
    )),
    authorizedInstruments: marketHooksState.authorizedInstruments.map((instrument) => ({ ...instrument })),
    authorizedSymbols: marketHooksState.authorizedSymbols,
    disabledSymbols: marketHooksState.disabledSymbols,
    loading: marketHooksState.instrumentsLoading,
    accountCatalogStatus: marketHooksState.accountCatalogStatus,
    error: marketHooksState.symbolsError,
    reload: vi.fn(),
    loadSymbolSpecification: marketHooksState.loadSymbolSpecification,
  }),
  useRemoteWatchlistSync: () => ({
    loading: false,
    error: marketHooksState.watchlistError,
    reload: vi.fn(),
  }),
}));

export const closedDailyChangeHook = closedDailyChangeHookState;
export const lastMarketWatchQuotesHook = lastMarketWatchQuotesHookState;
export const brokerAccountScopeHook = brokerAccountScopeHookState;
export const marketHooks = marketHooksState;

export const getActiveMarketSnapshot = () => ({
  symbols: marketHooks.activeSymbols,
  loading: marketHooks.activeSymbolsLoading,
  settled: marketHooks.activeSymbolsSettled,
  current: marketHooks.activeSymbolsCurrent,
  error: null,
  reload: marketHooks.reloadActiveSymbols,
});

const watchlistStateValue = vi.hoisted(() => ({
  watchlists: [] as Array<{ id: string; symbols: string[]; isDefault: boolean }>,
  activeWatchlistId: '',
  addSymbolToWatchlist: vi.fn(),
  removeSymbolFromWatchlist: vi.fn(),
  reorderSymbols: vi.fn(),
}));

vi.mock('../../../store/useWatchlistStore', () => ({
  useWatchlistStore: Object.assign(
    (selector: (state: typeof watchlistStateValue) => unknown) => selector(watchlistStateValue),
    { getState: () => watchlistStateValue },
  ),
}));

export const watchlistState = watchlistStateValue;

export class ResizeObserverStub {
  observe(): void {}
  disconnect(): void {}
}

export const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

export const getRenderedRowSymbols = (container: HTMLElement): string[] =>
  Array.from(container.querySelectorAll('tbody .rtx-market-watch__row'))
    .map((row) => row.querySelector('.rtx-market-watch__symbol')?.textContent ?? '');

export const getDetailValue = (label: string): string | null | undefined =>
  screen.getByText(label, { selector: 'dt' }).nextElementSibling?.textContent;

export const setMarketCatalog = (
  instruments: Array<string | MockMarketInstrument>,
  authorizedSymbols = instruments.map((instrument) => (
    typeof instrument === 'string' ? instrument : instrument.symbol
  )),
): void => {
  marketHooks.instrumentSymbols = instruments;
  marketHooks.authorizedSymbols = authorizedSymbols;
};
