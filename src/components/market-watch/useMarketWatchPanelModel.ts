import { useMemo, type RefObject } from 'react';
import { readCurrentMarketWatchDailyChangePrice } from '../../services/marketWatchDailyChangeCache';
import { useClosedMarketDailyChanges } from '../../hooks/useClosedMarketDailyChanges';
import { useLastMarketWatchQuotes } from '../../hooks/useLastMarketWatchQuotes';
import { useVisibleSymbolRows } from '../../hooks/useVisibleSymbolRows';
import { getChartPanels } from '../../services/chartPanelNavigation';
import { resolveTickFromLookup, selectTickCount, useAppStore } from '../../store/useAppStore';
import { useDockLayoutStore } from '../../store/useDockLayoutStore';
import {
  getMarketWatchDisplayMetadata,
  resolveMarketWatchDisplayMetadata,
  mayUseClosedDailyChange,
  useMarketWatchDisplayMetadataRevision,
} from '../../store/useMarketWatchDisplayMetadataStore';
import { useWatchlistStore } from '../../store/useWatchlistStore';
import {
  type AccountCatalogStatus,
  isAccountSymbolUniverseActive,
  pruneSymbolsToUniverse,
  selectAccountDefaultMarketWatchSymbols,
} from '../../utils/accountSymbolUniverse';
import {
  buildMarketWatchSymbolGroups,
  resolveMarketWatchSymbolGroup,
  selectDefaultMarketWatchSymbols,
} from '../../utils/marketWatchGroups';
import {
  resolveMarketWatchSymbolInput,
  shouldUseWatchlistAsMarketWatchSource,
} from '../../utils/marketWatchSource';
import { getInstrumentSymbolName, getUniqueSymbolNames } from '../../utils/symbolEligibility';
import {
  sortMarketWatchSymbols,
  type MarketWatchSortMetadata,
  type MarketWatchSortMode,
} from '../../utils/marketWatchView';
import {
  EMPTY_SORT_TICKS,
  getTickSnapshot,
  hasMarketWatchQuote,
  normalizeSymbol,
  readFiniteDailyChange,
  readInstrumentDescription,
  uniqueSymbols,
  type ScopedManualSymbols,
} from './marketWatchPanelModel';

type Watchlist = ReturnType<typeof useWatchlistStore.getState>['watchlists'][number];
type TradeProtectionState = Pick<ReturnType<typeof useAppStore.getState>, 'positions' | 'orders'>;

const createProtectedTradeSymbolSelector = () => {
  let previousPositions: TradeProtectionState['positions'] | undefined;
  let previousOrders: TradeProtectionState['orders'] | undefined;
  let protectedSymbols = new Set<string>();
  return ({ positions, orders }: TradeProtectionState): ReadonlySet<string> => {
    if (positions === previousPositions && orders === previousOrders) return protectedSymbols;
    previousPositions = positions;
    previousOrders = orders;
    const next = new Set<string>();
    positions.forEach((position) => {
      if (Number(position.volume ?? position.quantity ?? 0) <= 0) return;
      const symbol = normalizeSymbol(position.symbol);
      if (symbol) next.add(symbol);
    });
    orders.forEach((order) => {
      if (order.status !== 'PENDING' && order.status !== 'TRIGGERED') return;
      const symbol = normalizeSymbol(order.symbol);
      if (symbol) next.add(symbol);
    });
    // Hiding protection depends on symbol membership, not tickets, live P&L,
    // prices or the number of positions sharing an already protected symbol.
    if (next.size !== protectedSymbols.size || [...next].some((symbol) => !protectedSymbols.has(symbol))) {
      protectedSymbols = next;
    }
    return protectedSymbols;
  };
};

interface UseMarketWatchPanelModelOptions {
  accountCatalogStatus: AccountCatalogStatus | undefined;
  activeMarketSymbols: readonly string[];
  activeSymbolsCurrent: boolean;
  activeSymbolsSettled: boolean;
  activeWatchlist?: Watchlist;
  allSymbols: readonly unknown[];
  authenticatedMarketSymbols: readonly string[];
  chartSymbols?: readonly unknown[];
  dailyChangeScopeKey: string | null;
  /** Symbol the Details view asks for; empty while that view is closed. */
  detailsSymbolRequest: string;
  disabledSymbols: readonly string[];
  hiddenSymbols: readonly string[];
  isAuthenticated: boolean;
  manualSymbols: ScopedManualSymbols;
  marketInstruments: readonly unknown[];
  popupPricesOpen: boolean;
  rowRefs: RefObject<Map<string, HTMLTableRowElement>>;
  selectedSymbolGroupKey: string | null;
  sortMode: MarketWatchSortMode;
}

/**
 * Produces the account-scoped Market Watch row model and its fallback data.
 * Persisted watchlists are filtered for display without mutating shared data.
 */
export const useMarketWatchPanelModel = ({
  accountCatalogStatus,
  activeMarketSymbols,
  activeSymbolsCurrent,
  activeSymbolsSettled,
  activeWatchlist,
  allSymbols,
  authenticatedMarketSymbols,
  chartSymbols,
  dailyChangeScopeKey,
  detailsSymbolRequest,
  disabledSymbols,
  hiddenSymbols,
  isAuthenticated,
  manualSymbols,
  marketInstruments,
  popupPricesOpen,
  rowRefs,
  selectedSymbolGroupKey,
  sortMode,
}: UseMarketWatchPanelModelOptions) => {
  const liveTickCount = useAppStore(selectTickCount);
  const sortsDailyValues = sortMode === 'gainers' || sortMode === 'losers' || sortMode === 'change-asc' || sortMode === 'change-desc';
  const liveDisplayMetadataRevision = useMarketWatchDisplayMetadataRevision(sortsDailyValues);
  const selectProtectedTradeSymbols = useMemo(createProtectedTradeSymbolSelector, []);
  const protectedTradeSymbols = useAppStore(selectProtectedTradeSymbols);
  const dockLayout = useDockLayoutStore((state) => state.layout);
  const accountUniverseActive = isAccountSymbolUniverseActive(isAuthenticated, accountCatalogStatus);
  const disabledSymbolSet = useMemo(() => new Set(uniqueSymbols([...disabledSymbols])), [disabledSymbols]);
  const catalogSymbols = useMemo(() => getUniqueSymbolNames([...marketInstruments]), [marketInstruments]);
  const authorizedSymbols = useMemo(() => isAuthenticated
    ? uniqueSymbols([
      ...getUniqueSymbolNames([...allSymbols]),
      ...authenticatedMarketSymbols,
    ])
      .filter((symbol) => !disabledSymbolSet.has(symbol))
      .sort((a, b) => a.localeCompare(b))
    : [], [allSymbols, authenticatedMarketSymbols, disabledSymbolSet, isAuthenticated]);
  const quoteEligibleSymbols = catalogSymbols;
  const quoteEligibleSymbolSet = useMemo(() => new Set(quoteEligibleSymbols), [quoteEligibleSymbols]);
  const defaultSymbols = useMemo(() => {
    // Authenticated defaults are the whole account catalog; guest defaults are
    // the curated core list intersected with the quote-eligible catalog so a
    // non-catalog default never renders. The core list is fallback order only.
    if (accountUniverseActive) {
      return selectAccountDefaultMarketWatchSymbols(
        [...marketInstruments],
        [...allSymbols, ...marketInstruments],
      );
    }
    return selectDefaultMarketWatchSymbols(
      [...marketInstruments],
      [...allSymbols, ...marketInstruments],
      quoteEligibleSymbols,
    );
  },
  [accountUniverseActive, allSymbols, marketInstruments, quoteEligibleSymbols],
  );
  const shouldMergePersistedSymbols = shouldUseWatchlistAsMarketWatchSource({
    activeWatchlistId: activeWatchlist?.id,
    activeWatchlistIsDefault: activeWatchlist?.isDefault,
  });
  const persistedSymbols = useMemo(() => {
    if (!shouldMergePersistedSymbols) return [];
    const saved = activeWatchlist?.symbols ?? [];
    if (accountUniverseActive) return pruneSymbolsToUniverse(saved, quoteEligibleSymbols);
    return uniqueSymbols(saved)
      .map((symbol) => resolveMarketWatchSymbolInput(quoteEligibleSymbols, symbol) ?? symbol);
  }, [accountUniverseActive, activeWatchlist?.symbols, quoteEligibleSymbols, shouldMergePersistedSymbols]);
  const activeManualSymbols = useMemo(
    () => manualSymbols.watchlistId === (activeWatchlist?.id ?? '') ? manualSymbols.symbols : [],
    [activeWatchlist?.id, manualSymbols.symbols, manualSymbols.watchlistId],
  );
  const hiddenSymbolSet = useMemo(() => new Set(uniqueSymbols([...hiddenSymbols])), [hiddenSymbols]);
  const baseRows = useMemo(() => {
    const nextRows = uniqueSymbols([
      ...(shouldMergePersistedSymbols ? persistedSymbols : defaultSymbols),
      ...activeManualSymbols,
    ]).filter((symbol) => shouldMergePersistedSymbols || !hiddenSymbolSet.has(symbol));
    return accountUniverseActive ? pruneSymbolsToUniverse(nextRows, quoteEligibleSymbols) : nextRows;
  }, [
    accountUniverseActive,
    activeManualSymbols,
    defaultSymbols,
    hiddenSymbolSet,
    persistedSymbols,
    quoteEligibleSymbols,
    shouldMergePersistedSymbols,
  ]);
  const activeSymbolSet = useMemo(() => new Set(uniqueSymbols([...activeMarketSymbols])), [activeMarketSymbols]);
  const utcDay = new Date().getUTCDay();
  const isTraditionalMarketWeekend = utcDay === 0 || utcDay === 6;
  const canIdentifyClosedSymbols = activeSymbolsSettled && activeSymbolsCurrent;
  const sortMetadata = useMemo(() => {
    const metadata = new Map<string, MarketWatchSortMetadata>();
    for (const instrument of [...marketInstruments, ...allSymbols]) {
      const symbol = getInstrumentSymbolName(instrument);
      if (!symbol || !instrument || typeof instrument !== 'object') continue;
      const record = instrument as Record<string, unknown>;
      const previous = metadata.get(symbol) ?? {};
      const industry = String(record.industry ?? '').trim();
      const sector = String(record.sector ?? record.category ?? record.asset_class ?? record.assetClass ?? '').trim();
      metadata.set(symbol, {
        industry: previous.industry || industry || undefined,
        sector: previous.sector || sector || undefined,
      });
    }
    return metadata;
  }, [allSymbols, marketInstruments]);
  const usesClosedDailySort = sortMode === 'gainers' || sortMode === 'losers' || sortMode === 'change-asc' || sortMode === 'change-desc';
  const closedDailySortSymbols = useMemo(() => {
    void liveDisplayMetadataRevision;
    if (!usesClosedDailySort || !dailyChangeScopeKey || (!canIdentifyClosedSymbols && !isTraditionalMarketWeekend)) return [];
    void liveTickCount;
    return baseRows.filter((symbol) => {
      if (canIdentifyClosedSymbols && activeSymbolSet.has(symbol)) return false;
      const display = resolveMarketWatchDisplayMetadata(
        getTickSnapshot(symbol),
        getMarketWatchDisplayMetadata(symbol),
      );
      if (readFiniteDailyChange(display.dailyChange) !== null) return false;
      return resolveMarketWatchSymbolGroup(symbol).key !== 'crypto';
    });
  }, [
    activeSymbolSet,
    baseRows,
    canIdentifyClosedSymbols,
    dailyChangeScopeKey,
    isTraditionalMarketWeekend,
    liveDisplayMetadataRevision,
    liveTickCount,
    usesClosedDailySort,
  ]);
  const closedDailySortChanges = useClosedMarketDailyChanges({
    enabled: usesClosedDailySort
      && Boolean(dailyChangeScopeKey)
      && (canIdentifyClosedSymbols || isTraditionalMarketWeekend),
    scopeKey: dailyChangeScopeKey,
    symbols: closedDailySortSymbols,
  });
  const usesAmountSort = sortMode === 'change-asc' || sortMode === 'change-desc';
  const usesDynamicSort = usesClosedDailySort || usesAmountSort || sortMode === 'volume';
  const sortTickSnapshot = useAppStore((state) => usesDynamicSort ? state.ticks : EMPTY_SORT_TICKS);
  const rows = useMemo(() => {
    void liveDisplayMetadataRevision;
    return sortMarketWatchSymbols(
      baseRows,
      sortMode,
      (symbol) => {
        const tick = resolveTickFromLookup(sortTickSnapshot, useAppStore.getState().tickLookup, symbol);
        if (!usesClosedDailySort && !usesAmountSort) return tick;
        const display = resolveMarketWatchDisplayMetadata(tick, getMarketWatchDisplayMetadata(symbol));
        const liveDailyChange = readFiniteDailyChange(display.dailyChange);
        if (usesAmountSort) return { dailyChange: liveDailyChange ?? undefined, dailyChangePrice: display.dailyChangePrice ?? (mayUseClosedDailyChange(display) && closedDailySortChanges.has(symbol) ? readCurrentMarketWatchDailyChangePrice(symbol) : undefined), volume: tick?.volume };
        if (liveDailyChange !== null) return { dailyChange: liveDailyChange, volume: tick?.volume };
        const fallback = mayUseClosedDailyChange(display) ? readFiniteDailyChange(closedDailySortChanges.get(symbol)) : null;
        return { dailyChange: fallback ?? undefined, volume: tick?.volume };
      },
      sortMetadata,
    );
  }, [
    baseRows,
    closedDailySortChanges,
    liveDisplayMetadataRevision,
    sortMetadata,
    sortMode,
    sortTickSnapshot,
    usesClosedDailySort,
    usesAmountSort,
  ]);
  const {
    visibleSymbols: visibleRowSymbols,
    setViewportRef: setMarketWatchViewportRef,
    setRowRef: setVisibleMarketWatchRowRef,
  } = useVisibleSymbolRows(rows);
  const marketWatchRowsKey = rows.join('\u0000');
  const marketWatchSymbolOrder = useMemo(
    () => new Map(rows.map((symbol, index) => [symbol, index] as const)),
    [rows],
  );
  const marketWatchSymbolSet = useMemo(() => new Set(rows), [rows]);
  const marketWatchRowRefCallbacks = useMemo(
    () => new Map(
      (marketWatchRowsKey ? marketWatchRowsKey.split('\u0000') : []).map((symbol) => [
        symbol,
        (node: HTMLTableRowElement | null) => {
          setVisibleMarketWatchRowRef(symbol, node);
          if (node) rowRefs.current.set(symbol, node);
          else rowRefs.current.delete(symbol);
        },
      ] as const),
    ),
    [marketWatchRowsKey, rowRefs, setVisibleMarketWatchRowRef],
  );
  const actionableSymbolSet = useMemo(() => new Set(
    activeSymbolsCurrent ? authorizedSymbols.filter((symbol) => activeSymbolSet.has(symbol)) : [],
  ), [activeSymbolSet, activeSymbolsCurrent, authorizedSymbols]);
  const chartOpenableSymbolSet = useMemo(() => (
    chartSymbols === undefined ? actionableSymbolSet : new Set(getUniqueSymbolNames([...chartSymbols]))
  ), [actionableSymbolSet, chartSymbols]);
  const liveQuoteSymbolSet = useMemo(() => new Set(
    activeSymbolsCurrent ? quoteEligibleSymbols.filter((symbol) => activeSymbolSet.has(symbol)) : [],
  ), [activeSymbolSet, activeSymbolsCurrent, quoteEligibleSymbols]);
  const protectedSymbolSet = useMemo(() => {
    const protectedSymbols = new Set(protectedTradeSymbols);
    getChartPanels(dockLayout).forEach((panel) => {
      const chartSymbol = normalizeSymbol(panel.props?.symbol ?? panel.title?.split(',')[0]);
      if (chartSymbol) protectedSymbols.add(chartSymbol);
      panel.chartSymbolTabs?.forEach((tab) => {
        const tabSymbol = normalizeSymbol(tab.symbol);
        if (tabSymbol) protectedSymbols.add(tabSymbol);
      });
    });
    return protectedSymbols;
  }, [dockLayout, protectedTradeSymbols]);
  const searchUniverse = quoteEligibleSymbols;
  const symbolDescriptionByName = useMemo(() => {
    const descriptions = new Map<string, string>();
    for (const instrument of [...marketInstruments, ...allSymbols]) {
      const symbol = getInstrumentSymbolName(instrument);
      const description = readInstrumentDescription(instrument, symbol);
      if (symbol && description && !descriptions.has(symbol)) descriptions.set(symbol, description);
    }
    return descriptions;
  }, [allSymbols, marketInstruments]);
  const symbolGroups = useMemo(() => buildMarketWatchSymbolGroups(
    searchUniverse,
    [...allSymbols, ...marketInstruments],
    rows,
  ), [allSymbols, marketInstruments, rows, searchUniverse]);
  const symbolGroupKeyByName = useMemo(() => {
    const groupsBySymbol = new Map<string, string>();
    symbolGroups.forEach((group) => group.symbols.forEach((symbol) => groupsBySymbol.set(symbol, group.key)));
    return groupsBySymbol;
  }, [symbolGroups]);
  // Details lists Market Watch symbols only, like the MT5 combo box.
  const detailsSymbol = !detailsSymbolRequest || rows.includes(detailsSymbolRequest)
    ? detailsSymbolRequest
    : rows[0] ?? detailsSymbolRequest;
  // The grid is unmounted while Details is open, so its visible rows no
  // longer request the closed-market fallbacks the Details symbol needs.
  const fallbackRowSymbols = useMemo(() => {
    const baseSymbols = popupPricesOpen ? rows : visibleRowSymbols;
    return !detailsSymbol || baseSymbols.includes(detailsSymbol)
      ? baseSymbols
      : [...baseSymbols, detailsSymbol];
  }, [detailsSymbol, popupPricesOpen, rows, visibleRowSymbols]);
  const missingQuoteSymbols = useMemo(() => {
    void liveTickCount;
    if (!dailyChangeScopeKey) return [];
    return fallbackRowSymbols.filter((symbol) => !hasMarketWatchQuote(getTickSnapshot(symbol)));
  }, [dailyChangeScopeKey, fallbackRowSymbols, liveTickCount]);
  const candleFallbackSymbols = useMemo(() => {
    if (!canIdentifyClosedSymbols && !isTraditionalMarketWeekend) return [];
    return missingQuoteSymbols.filter((symbol) => {
      if (canIdentifyClosedSymbols && activeSymbolSet.has(symbol)) return false;
      const groupKey = symbolGroupKeyByName.get(symbol) ?? resolveMarketWatchSymbolGroup(symbol).key;
      return groupKey !== 'crypto';
    });
  }, [activeSymbolSet, canIdentifyClosedSymbols, isTraditionalMarketWeekend, missingQuoteSymbols, symbolGroupKeyByName]);
  const lastPrices = useLastMarketWatchQuotes({
    enabled: Boolean(dailyChangeScopeKey),
    scopeKey: dailyChangeScopeKey,
    symbols: missingQuoteSymbols,
    candleSymbols: candleFallbackSymbols,
  });
  const closedDailyChangeSymbols = useMemo(() => {
    void liveDisplayMetadataRevision;
    if (!dailyChangeScopeKey || (!canIdentifyClosedSymbols && !isTraditionalMarketWeekend)) return [];
    void liveTickCount;
    return fallbackRowSymbols.filter((symbol) => {
      if (canIdentifyClosedSymbols && activeSymbolSet.has(symbol)) return false;
      const display = resolveMarketWatchDisplayMetadata(
        getTickSnapshot(symbol),
        getMarketWatchDisplayMetadata(symbol),
      );
      if (readFiniteDailyChange(display.dailyChange) !== null) return false;
      const groupKey = symbolGroupKeyByName.get(symbol) ?? resolveMarketWatchSymbolGroup(symbol).key;
      return groupKey !== 'crypto';
    });
  }, [
    activeSymbolSet,
    canIdentifyClosedSymbols,
    dailyChangeScopeKey,
    fallbackRowSymbols,
    isTraditionalMarketWeekend,
    liveDisplayMetadataRevision,
    liveTickCount,
    symbolGroupKeyByName,
  ]);
  const visibleClosedDailyChanges = useClosedMarketDailyChanges({
    enabled: !usesClosedDailySort
      && Boolean(dailyChangeScopeKey)
      && (canIdentifyClosedSymbols || isTraditionalMarketWeekend),
    scopeKey: dailyChangeScopeKey,
    symbols: usesClosedDailySort ? [] : closedDailyChangeSymbols,
  });
  const closedDailyChanges = usesClosedDailySort ? closedDailySortChanges : visibleClosedDailyChanges;
  const selectedSymbolGroup = useMemo(
    () => symbolGroups.find((group) => group.key === selectedSymbolGroupKey) ?? null,
    [selectedSymbolGroupKey, symbolGroups],
  );
  const selectedGroupSymbols = useMemo(() => {
    const groupSymbols = selectedSymbolGroup?.symbols ?? [];
    return [...groupSymbols].sort((left, right) => {
      const leftOrder = marketWatchSymbolOrder.get(left);
      const rightOrder = marketWatchSymbolOrder.get(right);
      if (leftOrder !== undefined && rightOrder !== undefined) return leftOrder - rightOrder;
      if (leftOrder !== undefined) return -1;
      if (rightOrder !== undefined) return 1;
      return 0;
    });
  }, [marketWatchSymbolOrder, selectedSymbolGroup]);

  return {
    accountUniverseActive,
    actionableSymbolSet,
    activeSymbolSet,
    authorizedSymbols,
    canIdentifyClosedSymbols,
    chartOpenableSymbolSet,
    closedDailyChanges,
    detailsSymbol,
    hiddenSymbolSet,
    isTraditionalMarketWeekend,
    lastPrices,
    liveDisplayMetadataRevision,
    liveQuoteSymbolSet,
    liveTickCount,
    marketWatchRowRefCallbacks,
    marketWatchSymbolSet,
    persistedSymbols,
    protectedSymbolSet,
    quoteEligibleSymbols,
    quoteEligibleSymbolSet,
    rows,
    searchUniverse,
    selectedGroupSymbols,
    selectedSymbolGroup,
    setMarketWatchViewportRef,
    shouldMergePersistedSymbols,
    sortMetadata,
    symbolDescriptionByName,
    symbolGroupKeyByName,
    symbolGroups,
  };
};
