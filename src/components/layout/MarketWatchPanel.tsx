import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { resolveTickFromLookup, selectTickCount, useAppStore, useTick } from '../../store/useAppStore';
import { useWatchlistStore } from '../../store/useWatchlistStore';
import { ContextMenu, type ContextMenuItemConfig } from '../ui/ContextMenu';
import { Icon } from '../ui/Icon';
import { PriceDisplay } from '../ui/PriceDisplay';
import {
  useActiveMarketSymbols,
  useLiveQuotes,
  useMarketInstruments,
  useRemoteWatchlistSync,
  type MarketInstrumentsSnapshot,
} from '../../hooks/useLiveMarketData';
import { useVisibleSymbolRows } from '../../hooks/useVisibleSymbolRows';
import { formatSpreadDisplay } from '../../utils/spread';
import { getUniqueSymbolNames } from '../../utils/symbolEligibility';
import { buildMarketWatchSymbolGroups, selectDefaultMarketWatchSymbols } from '../../utils/marketWatchGroups';
import {
  getMarketWatchDisplayErrors,
  getMarketWatchSymbolLabel,
  resolveMarketWatchSymbolInput,
  searchMarketWatchSymbols,
  shouldUseWatchlistAsMarketWatchSource,
} from '../../utils/marketWatchSource';

export interface ActiveMarketSymbolsSnapshot {
  symbols: string[];
  loading: boolean;
  settled: boolean;
  current: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

interface MarketWatchPanelBaseProps {
  allSymbols: unknown[];
  chartSymbols?: unknown[];
  selectedSymbol: string;
  onSymbolSelect: (symbol: string) => void;
  className?: string;
}

interface MarketWatchPanelProps extends MarketWatchPanelBaseProps {
  activeMarketSnapshot?: ActiveMarketSymbolsSnapshot;
  marketInstrumentsSnapshot?: MarketInstrumentsSnapshot;
}

interface ScopedManualSymbols {
  watchlistId: string;
  symbols: string[];
}

const normalizeSymbol = (value: unknown): string => String(value ?? '').trim().toUpperCase();

const TWO_DECIMAL_MARKET_WATCH_SYMBOLS = new Set([
  'JPN225-F',
  'WHEAT',
  'GOLD-PERP',
  'NICKEL',
]);

const getMarketWatchPriceDigits = (symbol: string): number | undefined => (
  TWO_DECIMAL_MARKET_WATCH_SYMBOLS.has(normalizeSymbol(symbol)) ? 2 : undefined
);

const uniqueSymbols = (symbols: unknown[]): string[] =>
  Array.from(new Set(symbols.map(normalizeSymbol).filter(Boolean)));

const SYMBOL_EXPLORER_ROW_HEIGHT = 36;
const SYMBOL_EXPLORER_OVERSCAN = 6;
const SYMBOL_EXPLORER_FALLBACK_HEIGHT = 288;

// Price flash hook — returns 'up' | 'down' | null briefly when price changes
function usePriceFlash(value: number): 'up' | 'down' | null {
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);
  const prev = useRef(value);

  useEffect(() => {
    if (prev.current === 0 && value === 0) return;
    if (value !== prev.current) {
      setFlash(value > prev.current ? 'up' : 'down');
      const t = setTimeout(() => setFlash(null), 600);
      prev.current = value;
      return () => clearTimeout(t);
    }
  }, [value]);

  return flash;
}

const getTickSnapshot = (symbol: string) => {
  const state = useAppStore.getState();
  return resolveTickFromLookup(state.ticks, state.tickLookup, symbol);
};

const formatQuoteAge = (timestamp: number | undefined, now: number): string | null => {
  if (!timestamp || !Number.isFinite(timestamp)) return null;
  const ageSeconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (ageSeconds < 5) return 'now';
  if (ageSeconds < 60) return `${ageSeconds}s`;
  const ageMinutes = Math.floor(ageSeconds / 60);
  if (ageMinutes < 60) return `${ageMinutes}m`;
  return `${Math.floor(ageMinutes / 60)}h`;
};

// ─── Market Watch Row ─────────────────────────────────────────────────────────
const MarketWatchRow: React.FC<{
  symbol: string;
  isSelected: boolean;
  isLive: boolean;
  isAvailable: boolean;
  isStatusLoading: boolean;
  isStatusSettled: boolean;
  isStatusCurrent: boolean;
  isCatalogLoading: boolean;
  isChartOpenable: boolean;
  now: number;
  onClick: () => void;
  contextMenuItems: ContextMenuItemConfig[];
  showAsk: boolean;
  showSpread: boolean;
  showDailyChange: boolean;
  symbolUniverse: readonly string[];
  rowRef?: (node: HTMLTableRowElement | null) => void;
}> = ({ symbol, isSelected, isLive, isAvailable, isStatusLoading, isStatusSettled, isStatusCurrent, isCatalogLoading, isChartOpenable, now, onClick, contextMenuItems, showAsk, showSpread, showDailyChange, symbolUniverse, rowRef }) => {
  const displaySymbol = getMarketWatchSymbolLabel(symbol, symbolUniverse);
  const cachedTick = useTick(symbol);
  const tick = cachedTick;
  const priceDigits = getMarketWatchPriceDigits(symbol);
  const bidDirection = tick?.bidDirection ?? 'none';
  const askDirection = tick?.askDirection ?? 'none';
  const bid = tick?.bid ?? 0;
  const ask = tick?.ask ?? 0;
  const spread = tick?.spread ?? (ask - bid);
  const spreadDisplay = formatSpreadDisplay(symbol, spread, bid, ask);
  const rawDaily = tick?.dailyChange;
  const normalizedDaily = Number(rawDaily);
  const dailyPct: number | null =
    rawDaily !== undefined && rawDaily !== null && Number.isFinite(normalizedDaily)
      ? normalizedDaily
      : null;

  const hasData = tick && (tick.bid > 0 || tick.ask > 0);
  const hasDailyData = dailyPct !== null;
  const quoteAge = hasData ? formatQuoteAge(tick.timestamp, now) : null;
  const statusLabel = isLive
    ? null
    : isCatalogLoading || isStatusLoading || !isStatusSettled
        ? 'LOADING'
        : !isStatusCurrent
          ? 'UNKNOWN'
          : !isAvailable
            ? 'UNAVAILABLE'
        : hasData
          ? 'STALE'
          : 'UNAVAILABLE';

  const bidFlash = usePriceFlash(bid);
  const askFlash = usePriceFlash(ask);
  const bidPriceDirection = bidFlash ?? (bidDirection !== 'none' ? bidDirection : null);
  const askPriceDirection = askFlash ?? (askDirection !== 'none' ? askDirection : null);

  const dailyPositive = hasDailyData && dailyPct! > 0;
  const dailyNegative = hasDailyData && dailyPct! < 0;

  return (
    <ContextMenu items={contextMenuItems}>
      <tr
        ref={rowRef}
        draggable={isChartOpenable}
        onDragStart={(e) => {
          if (!isChartOpenable) {
            e.preventDefault();
            return;
          }
          e.dataTransfer.setData('text/plain', symbol);
          e.dataTransfer.effectAllowed = 'copyMove';
        }}
        onClick={onClick}
        style={{
          height: 36,
          cursor: 'pointer',
          borderBottom: '1px solid rgba(255,255,255,0.04)',
          background: isSelected
            ? 'linear-gradient(90deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.02) 100%)'
            : 'transparent',
          transition: 'background 0.15s ease',
          opacity: isLive ? 1 : hasData ? 0.72 : 0.45,
          boxShadow: isSelected ? 'inset 2px 0 0 rgba(200,200,210,0.5)' : 'none',
        }}
        className={`${!isSelected ? 'mw-row ' : ''}rtx-market-watch__row${isSelected ? ' rtx-market-watch__row--selected' : ''}${!isLive ? ' rtx-market-watch__row--stale' : ''}`}
        aria-selected={isSelected}
        aria-disabled={!isChartOpenable}
        title={!isChartOpenable ? `${displaySymbol} chart is currently unavailable` : undefined}
      >
        {/* Symbol */}
        <td style={{ padding: '4px 8px', whiteSpace: 'nowrap', maxWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
            {/* Direction arrow */}
            {hasData && bidDirection === 'up' && (
              <svg width="7" height="7" viewBox="0 0 7 7" fill="none" style={{ flexShrink: 0 }}>
                <path d="M3.5 1L6.5 6H0.5L3.5 1Z" fill="#4ade80" />
              </svg>
            )}
            {hasData && bidDirection === 'down' && (
              <svg width="7" height="7" viewBox="0 0 7 7" fill="none" style={{ flexShrink: 0 }}>
                <path d="M3.5 6L0.5 1H6.5L3.5 6Z" fill="#f87171" />
              </svg>
            )}
            {(!hasData || bidDirection === 'none') && (
              <span style={{ width: 7, flexShrink: 0, display: 'inline-block' }} />
            )}
            <span aria-label={displaySymbol} className="rtx-market-watch__symbol" style={{
              fontSize: 14,
              fontWeight: 400,
              color: isSelected ? '#e2e2e8' : '#b8b8c0',
              letterSpacing: 'normal',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {displaySymbol}
            </span>
            {statusLabel && statusLabel !== 'STALE' && (
              <span
                className="rtx-market-watch__status"
                aria-label={`${displaySymbol} ${statusLabel.toLowerCase()}${quoteAge ? `, last quote ${quoteAge} ago` : ''}`}
                style={{
                  flexShrink: 0,
                  fontSize: 10,
                  fontWeight: 400,
                  color: '#6b6b73',
                  letterSpacing: '0.04em',
                }}
              >
                {statusLabel}{quoteAge ? ` · ${quoteAge}` : ''}
              </span>
            )}
          </div>
        </td>

        {/* Bid — most important: bright, large, tabular */}
        <td style={{ padding: '3px 5px', textAlign: 'right' }}>
          <span className={`rtx-market-watch__price rtx-market-watch__price--bid${bidPriceDirection ? ` rtx-market-watch__price--${bidPriceDirection}` : ''}${!hasData ? ' rtx-market-watch__price--empty' : ''}`} style={{
            display: 'inline-block',
            fontSize: 14,
            fontWeight: 400,
            color: hasData
              ? bidFlash === 'up' ? '#4ade80'
              : bidFlash === 'down' ? '#f87171'
              : '#d0d0d8'
              : '#36363e',
            padding: '1px 4px',
            borderRadius: 3,
            background: 'transparent',
            transition: 'color 0.25s',
            letterSpacing: 'normal',
            fontVariantNumeric: 'tabular-nums',
            tabularNums: true,
          } as React.CSSProperties}>
            {hasData ? <PriceDisplay price={bid} symbol={symbol} digits={priceDigits} /> : '—'}
          </span>
        </td>

        {/* Ask — secondary, slightly softer */}
        {showAsk && (
          <td style={{ padding: '3px 5px', textAlign: 'right' }}>
            <span className={`rtx-market-watch__price rtx-market-watch__price--ask${askPriceDirection ? ` rtx-market-watch__price--${askPriceDirection}` : ''}${!hasData ? ' rtx-market-watch__price--empty' : ''}`} style={{
              display: 'inline-block',
              fontSize: 14,
              fontWeight: 400,
              color: hasData
                ? askFlash === 'up' ? '#4ade80'
                : askFlash === 'down' ? '#f87171'
                : '#a0a0a8'
                : '#36363e',
              padding: '1px 4px',
              borderRadius: 3,
              background: 'transparent',
              transition: 'color 0.25s',
              letterSpacing: 'normal',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {hasData ? <PriceDisplay price={ask} symbol={symbol} digits={priceDigits} /> : '—'}
            </span>
          </td>
        )}

        {/* Spread remains independently useful and sits immediately before Daily Change. */}
        {showSpread && (
          <td style={{ padding: '3px 5px', textAlign: 'right' }}>
            <span className={`rtx-market-watch__spread${!hasData ? ' rtx-market-watch__spread--empty' : ''}`} style={{
              fontSize: 14,
              fontWeight: 400,
              color: hasData ? '#888890' : '#36363e',
              letterSpacing: 'normal',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {hasData ? spreadDisplay : '—'}
            </span>
          </td>
        )}

        {/* MetaTrader-style Daily Change follows Spread without changing its session-close semantics. */}
        {showDailyChange && (
          <td style={{ padding: '3px 8px', textAlign: 'right' }}>
            <span className={`rtx-market-watch__daily${!hasData ? ' rtx-market-watch__daily--empty' : ''}${dailyPositive ? ' rtx-market-watch__daily--up' : ''}${dailyNegative ? ' rtx-market-watch__daily--down' : ''}`} style={{
              fontSize: 14,
              fontWeight: 400,
              color: !hasData ? '#36363e'
                : !hasDailyData ? '#50505a'
                : dailyPositive ? '#4597ff'
                : dailyNegative ? '#ff5858'
                : '#606068',
              letterSpacing: 'normal',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {!hasData ? '—'
                : hasDailyData
                  ? `${dailyPct!.toFixed(2)}%`
                  : <span style={{ color: '#50505a' }}>—</span>
              }
            </span>
          </td>
        )}
      </tr>
    </ContextMenu>
  );
};

// ─── Main Panel ───────────────────────────────────────────────────────────────
const MarketWatchPanelContent: React.FC<MarketWatchPanelBaseProps & {
  activeMarketSnapshot: ActiveMarketSymbolsSnapshot;
  marketInstrumentsSnapshot: MarketInstrumentsSnapshot;
}> = ({
  allSymbols,
  chartSymbols,
  selectedSymbol,
  onSymbolSelect,
  className,
  activeMarketSnapshot,
  marketInstrumentsSnapshot,
}) => {
  // This panel only needs to know whether any quote exists. Subscribing to the
  // complete tick map redrew the entire panel for every freshness timestamp.
  const liveTickCount = useAppStore(selectTickCount);
  const isAuthenticated = useAppStore((state) => state.isAuthenticated);
  const {
    symbols: marketInstruments,
    authorizedSymbols: authenticatedMarketSymbols = [],
    disabledSymbols,
    loading: isLoadingSymbols,
    error: symbolsError,
  } = marketInstrumentsSnapshot;
  const {
    symbols: activeMarketSymbols,
    loading: activeSymbolsLoading,
    settled: activeSymbolsSettled,
    current: activeSymbolsCurrent,
    error: activeSymbolsError,
    reload: reloadActiveMarketSymbols,
  } = activeMarketSnapshot;

  const activeWatchlist = useWatchlistStore((s) => {
    return s.watchlists.find((w) => w.id === s.activeWatchlistId);
  });
  const {
    loading: watchlistLoading,
    error: watchlistError,
  } = useRemoteWatchlistSync(activeWatchlist?.id);
  const [search, setSearch] = useState('');
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [showGrid, setShowGrid] = useState(true);
  const [showSymbolsPanel, setShowSymbolsPanel] = useState(false);
  const [selectedSymbolGroupKey, setSelectedSymbolGroupKey] = useState<string | null>(null);
  const [symbolExplorerViewport, setSymbolExplorerViewport] = useState({
    scrollTop: 0,
    height: SYMBOL_EXPLORER_FALLBACK_HEIGHT,
  });
  const [manualSymbols, setManualSymbols] = useState<ScopedManualSymbols>({
    watchlistId: activeWatchlist?.id ?? '',
    symbols: [],
  });
  const [pendingStatusRefreshSymbol, setPendingStatusRefreshSymbol] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const symbolExplorerScrollRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());
  const [panelWidth, setPanelWidth] = useState(999);
  const searchListboxId = useId();

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setPanelWidth(entry.contentRect.width);
    });
    ro.observe(el);
    setPanelWidth(el.offsetWidth);
    return () => ro.disconnect();
  }, []);

  const showAsk = panelWidth >= 220;
  // Keep Daily Change at the breakpoint requested for the previous replacement.
  const showDailyChange = panelWidth >= 300;
  // At 360 px both numeric columns fit without hiding Daily Change in the normal 379 px dock.
  const showSpread = panelWidth >= 360;

  const disabledSymbolSet = useMemo(() => new Set(uniqueSymbols(disabledSymbols)), [disabledSymbols]);

  const catalogSymbols = useMemo(
    () => getUniqueSymbolNames(marketInstruments),
    [marketInstruments],
  );

  const authorizedSymbols = useMemo(() => isAuthenticated
    ? uniqueSymbols([
      ...getUniqueSymbolNames(allSymbols),
      ...authenticatedMarketSymbols,
    ])
      .filter((symbol) => !disabledSymbolSet.has(symbol))
      .sort((a, b) => a.localeCompare(b))
    : [], [allSymbols, authenticatedMarketSymbols, disabledSymbolSet, isAuthenticated]);

  const quoteEligibleSymbols = catalogSymbols;
  const quoteEligibleSymbolSet = useMemo(
    () => new Set(quoteEligibleSymbols),
    [quoteEligibleSymbols],
  );
  const defaultSymbols = useMemo(
    () => selectDefaultMarketWatchSymbols(
      marketInstruments,
      [...allSymbols, ...marketInstruments],
    ),
    [allSymbols, marketInstruments],
  );
  const shouldMergePersistedSymbols = shouldUseWatchlistAsMarketWatchSource({
    activeWatchlistId: activeWatchlist?.id,
    activeWatchlistIsDefault: activeWatchlist?.isDefault,
  });
  const persistedSymbols = useMemo(() => shouldMergePersistedSymbols
    ? uniqueSymbols(activeWatchlist?.symbols ?? [])
      .map((symbol) => resolveMarketWatchSymbolInput(quoteEligibleSymbols, symbol) ?? symbol)
    : [], [
      activeWatchlist?.symbols,
      quoteEligibleSymbols,
      shouldMergePersistedSymbols,
    ]);
  const activeManualSymbols = useMemo(
    () => manualSymbols.watchlistId === (activeWatchlist?.id ?? '')
      ? manualSymbols.symbols
      : [],
    [activeWatchlist?.id, manualSymbols.symbols, manualSymbols.watchlistId],
  );
  const rows = useMemo(() => uniqueSymbols([
    ...(shouldMergePersistedSymbols ? persistedSymbols : defaultSymbols),
    ...activeManualSymbols,
  ]), [
    activeManualSymbols,
    defaultSymbols,
    persistedSymbols,
    shouldMergePersistedSymbols,
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
  const marketWatchSymbolSet = useMemo(
    () => new Set(rows),
    [rows],
  );
  const marketWatchRowRefCallbacks = useMemo(
    () => new Map(
      (marketWatchRowsKey ? marketWatchRowsKey.split('\u0000') : []).map((symbol) => [
        symbol,
        (node: HTMLTableRowElement | null) => {
          setVisibleMarketWatchRowRef(symbol, node);
          if (node) {
            rowRefs.current.set(symbol, node);
          } else {
            rowRefs.current.delete(symbol);
          }
        },
      ] as const),
    ),
    [marketWatchRowsKey, setVisibleMarketWatchRowRef],
  );
  const activeSymbolSet = useMemo(() => new Set(uniqueSymbols(activeMarketSymbols)), [activeMarketSymbols]);
  const actionableSymbolSet = useMemo(() => new Set(
    activeSymbolsCurrent
      ? authorizedSymbols.filter((symbol) => activeSymbolSet.has(symbol))
      : [],
  ), [activeSymbolSet, activeSymbolsCurrent, authorizedSymbols]);
  const chartOpenableSymbolSet = useMemo(() => (
    chartSymbols === undefined
      ? actionableSymbolSet
      : new Set(getUniqueSymbolNames(chartSymbols))
  ), [actionableSymbolSet, chartSymbols]);
  const liveQuoteSymbolSet = useMemo(() => new Set(
    activeSymbolsCurrent
      ? quoteEligibleSymbols.filter((symbol) => activeSymbolSet.has(symbol))
      : [],
  ), [activeSymbolSet, activeSymbolsCurrent, quoteEligibleSymbols]);
  const searchUniverse = quoteEligibleSymbols;
  const symbolGroups = useMemo(() => buildMarketWatchSymbolGroups(
    searchUniverse,
    [...allSymbols, ...marketInstruments],
    rows,
  ), [allSymbols, marketInstruments, rows, searchUniverse]);
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
  const subscriptionSymbols = useMemo(() => visibleRowSymbols.filter(
    (symbol) => quoteEligibleSymbolSet.has(symbol),
  ), [quoteEligibleSymbolSet, visibleRowSymbols]);

  const filteredSymbols = useMemo(() => {
    if (search.trim()) {
      return searchMarketWatchSymbols(searchUniverse, search, Math.max(1, searchUniverse.length));
    }
    return selectedGroupSymbols;
  }, [search, searchUniverse, selectedGroupSymbols]);
  const showingSymbolGroups = showSymbolsPanel && !search.trim() && !selectedSymbolGroup;
  const explorerOptionCount = showingSymbolGroups ? symbolGroups.length : filteredSymbols.length;
  const symbolExplorerWindow = useMemo(() => {
    const maxScrollTop = Math.max(
      0,
      filteredSymbols.length * SYMBOL_EXPLORER_ROW_HEIGHT - symbolExplorerViewport.height,
    );
    const effectiveScrollTop = Math.min(symbolExplorerViewport.scrollTop, maxScrollTop);
    const startIndex = Math.max(
      0,
      Math.floor(effectiveScrollTop / SYMBOL_EXPLORER_ROW_HEIGHT) - SYMBOL_EXPLORER_OVERSCAN,
    );
    const endIndex = Math.min(
      filteredSymbols.length,
      Math.ceil((effectiveScrollTop + symbolExplorerViewport.height) / SYMBOL_EXPLORER_ROW_HEIGHT)
        + SYMBOL_EXPLORER_OVERSCAN,
    );

    return {
      startIndex,
      endIndex,
      topSpacerHeight: startIndex * SYMBOL_EXPLORER_ROW_HEIGHT,
      bottomSpacerHeight: (filteredSymbols.length - endIndex) * SYMBOL_EXPLORER_ROW_HEIGHT,
    };
  }, [filteredSymbols.length, symbolExplorerViewport]);
  const renderedExplorerSymbols = filteredSymbols.slice(
    symbolExplorerWindow.startIndex,
    symbolExplorerWindow.endIndex,
  );

  useLayoutEffect(() => {
    const element = symbolExplorerScrollRef.current;
    if (!element || showingSymbolGroups) return;

    const measure = () => {
      const height = element.clientHeight || SYMBOL_EXPLORER_FALLBACK_HEIGHT;
      setSymbolExplorerViewport((current) => (
        current.height === height ? current : { ...current, height }
      ));
    };

    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [showSymbolsPanel, showingSymbolGroups]);

  useEffect(() => {
    const element = symbolExplorerScrollRef.current;
    if (element) element.scrollTop = 0;
    setSymbolExplorerViewport((current) => (
      current.scrollTop === 0 ? current : { ...current, scrollTop: 0 }
    ));
  }, [search, selectedSymbolGroupKey]);

  const handleSymbolExplorerScroll = useCallback(() => {
    const element = symbolExplorerScrollRef.current;
    if (!element) return;
    const scrollTop = element.scrollTop;
    const height = element.clientHeight || SYMBOL_EXPLORER_FALLBACK_HEIGHT;
    setSymbolExplorerViewport((current) => (
      current.scrollTop === scrollTop && current.height === height
        ? current
        : { scrollTop, height }
    ));
  }, []);

  const scrollSymbolIntoView = useCallback((symbol: string) => {
    window.requestAnimationFrame(() => {
      rowRefs.current.get(symbol)?.scrollIntoView({ block: 'center' });
    });
  }, []);

  const handleSelectSymbol = useCallback((symbol: string) => {
    const next = resolveMarketWatchSymbolInput(searchUniverse, symbol);
    if (!next || !quoteEligibleSymbolSet.has(next)) return;
    const isNewRow = !rows.includes(next);
    if (isNewRow) {
      setManualSymbols((current) => {
        const watchlistId = activeWatchlist?.id ?? '';
        const currentSymbols = current.watchlistId === watchlistId ? current.symbols : [];
        return {
          watchlistId,
          symbols: currentSymbols.includes(next) ? currentSymbols : [...currentSymbols, next],
        };
      });
      setPendingStatusRefreshSymbol(next);
    }
    if (
      shouldMergePersistedSymbols
      && activeWatchlist
      && !persistedSymbols.includes(next)
    ) {
      useWatchlistStore.getState().addSymbolToWatchlist(activeWatchlist.id, next);
    }
    setSearch('');
    setShowSymbolsPanel(false);
    setSelectedSymbolGroupKey(null);
    setHighlightIndex(-1);
    inputRef.current?.blur();
    onSymbolSelect(next);
    scrollSymbolIntoView(next);
    
    // Automatically open chart for the newly searched/selected pair as a NEW TAB
    window.dispatchEvent(new CustomEvent('openChart', { detail: { symbol: next, newTab: true } }));
  }, [
    activeWatchlist,
    quoteEligibleSymbolSet,
    onSymbolSelect,
    persistedSymbols,
    rows,
    scrollSymbolIntoView,
    searchUniverse,
    shouldMergePersistedSymbols,
  ]);

  const handleHideSymbol = useCallback((symbol: string) => {
    const next = normalizeSymbol(symbol);
    if (!next) return;

    // The built-in Market Watch keeps its curated core/group representatives.
    // Only custom watchlists can hide individual rows persistently.
    if (!shouldMergePersistedSymbols && defaultSymbols.includes(next)) return;

    const watchlistId = activeWatchlist?.id ?? '';
    setManualSymbols((current) => ({
      watchlistId,
      symbols: current.watchlistId === watchlistId
        ? current.symbols.filter((item) => normalizeSymbol(item) !== next)
        : [],
    }));

    if (shouldMergePersistedSymbols && activeWatchlist) {
      const persistedSymbol = activeWatchlist.symbols.find((item) => (
        (resolveMarketWatchSymbolInput(authorizedSymbols, item) ?? normalizeSymbol(item)) === next
      )) ?? next;
      useWatchlistStore.getState().removeSymbolFromWatchlist(activeWatchlist.id, persistedSymbol);
    }
  }, [
    activeWatchlist,
    authorizedSymbols,
    defaultSymbols,
    shouldMergePersistedSymbols,
  ]);

  const handleHideAll = useCallback(() => {
    const watchlistId = activeWatchlist?.id ?? '';
    setManualSymbols({ watchlistId, symbols: [] });
    if (shouldMergePersistedSymbols && activeWatchlist) {
      useWatchlistStore.getState().reorderSymbols(activeWatchlist.id, []);
    }
  }, [activeWatchlist, shouldMergePersistedSymbols]);

  const handleShowAll = useCallback(() => {
    const watchlistId = activeWatchlist?.id ?? '';
    setManualSymbols({ watchlistId, symbols: [...quoteEligibleSymbols] });
    if (shouldMergePersistedSymbols && activeWatchlist) {
      useWatchlistStore.getState().reorderSymbols(activeWatchlist.id, quoteEligibleSymbols);
    }
  }, [activeWatchlist, quoteEligibleSymbols, shouldMergePersistedSymbols]);

  const handleExport = useCallback(() => {
    const data = rows.map(sym => {
      const tick = getTickSnapshot(sym);
      const spreadDisplay = tick ? formatSpreadDisplay(sym, tick.spread, tick.bid, tick.ask) : '-';
      const dailyChange = Number(tick?.dailyChange);
      const dailyChangeDisplay = tick?.dailyChange !== undefined && Number.isFinite(dailyChange)
        ? `${dailyChange.toFixed(2)}%`
        : '-';
      return `${sym}\t${tick?.bid ?? '-'}\t${tick?.ask ?? '-'}\t${spreadDisplay}\t${dailyChangeDisplay}`;
    }).join('\n');
    navigator.clipboard.writeText(`Symbol\tBid\tAsk\tSpread\tDaily Change\n${data}`);
  }, [rows]);

  const getContextMenuItems = useCallback((symbol: string): ContextMenuItemConfig[] => {
    const tradeDisabled = !actionableSymbolSet.has(symbol);
    const chartDisabled = !chartOpenableSymbolSet.has(symbol);
    return [
      {
        label: 'New Order',
        icon: <Icon name="plus" size="xs" />,
        shortcut: 'F9',
        disabled: tradeDisabled,
        action: () => {
          window.dispatchEvent(new CustomEvent('openOrderDialog', { detail: { symbol } }));
        },
      },
      {
        label: 'Chart Window',
        icon: <Icon name="bar-chart" size="xs" />,
        disabled: chartDisabled,
        action: () => {
          window.dispatchEvent(new CustomEvent('openChart', { detail: { symbol } }));
        },
      },
      {
        label: 'Depth Of Market',
        icon: <Icon name="layers" size="xs" />,
        shortcut: 'Alt+B',
        disabled: tradeDisabled,
        action: () => {
          window.dispatchEvent(new CustomEvent('openDepthOfMarket', { detail: { symbol } }));
        },
      },
      {
        label: 'Specification',
        icon: <Icon name="file-text" size="xs" />,
        action: () => {
          const tick = getTickSnapshot(symbol);
          const info = [
            `Symbol: ${symbol}`,
            `Bid: ${tick?.bid ?? 'N/A'}`,
            `Ask: ${tick?.ask ?? 'N/A'}`,
            `Spread: ${tick?.spread ?? 'N/A'}`,
            `Daily Change: ${tick?.dailyChange !== undefined ? tick.dailyChange.toFixed(2) + '%' : 'N/A'}`,
          ].join('\n');
          alert(info);
        },
      },
      { divider: true },
      {
        label: 'Hide',
        shortcut: 'Delete',
        disabled: !shouldMergePersistedSymbols && defaultSymbols.includes(symbol),
        action: () => handleHideSymbol(symbol),
      },
      {
        label: 'Hide All',
        action: handleHideAll,
      },
      {
        label: 'Show All',
        action: handleShowAll,
      },
      { divider: true },
      {
        label: 'Symbols',
        icon: <Icon name="search" size="xs" />,
        shortcut: 'Ctrl+U',
        action: () => {
          setSearch('');
          setSelectedSymbolGroupKey(null);
          setHighlightIndex(-1);
          setShowSymbolsPanel(true);
          inputRef.current?.focus();
        },
      },
      {
        label: 'Export',
        icon: <Icon name="download" size="xs" />,
        action: handleExport,
      },
      { divider: true },
      {
        label: 'Grid',
        checked: showGrid,
        action: () => setShowGrid(!showGrid),
        autoClose: false,
      },
    ];
  }, [
    actionableSymbolSet,
    chartOpenableSymbolSet,
    defaultSymbols,
    handleExport,
    handleHideAll,
    handleHideSymbol,
    handleShowAll,
    shouldMergePersistedSymbols,
    showGrid,
  ]);

  const isSymbolListLoading = isLoadingSymbols || watchlistLoading || (searchUniverse.length === 0 && activeSymbolsLoading);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      const isEditingTarget = Boolean(target?.closest(
        'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
      ));
      if (e.key === 'Delete' && selectedSymbol && !isEditingTarget) {
        handleHideSymbol(selectedSymbol);
      }
      if (e.ctrlKey && e.key === 'u') {
        e.preventDefault();
        setSearch('');
        setSelectedSymbolGroupKey(null);
        setHighlightIndex(-1);
        inputRef.current?.focus();
        setShowSymbolsPanel(true);
      }
      if (e.key === 'F9') {
        e.preventDefault();
        if (actionableSymbolSet.has(normalizeSymbol(selectedSymbol))) {
          window.dispatchEvent(new CustomEvent('openNewOrder'));
        }
      }
      if (e.altKey && e.key === 'b') {
        e.preventDefault();
        if (actionableSymbolSet.has(normalizeSymbol(selectedSymbol))) {
          window.dispatchEvent(new CustomEvent('openDepthOfMarket', { detail: { symbol: selectedSymbol } }));
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [actionableSymbolSet, handleHideSymbol, selectedSymbol]);

  const closeSymbolExplorer = useCallback(() => {
    setSearch('');
    setSelectedSymbolGroupKey(null);
    setShowSymbolsPanel(false);
    setHighlightIndex(-1);
  }, []);

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setShowSymbolsPanel(true);
      setHighlightIndex((prev) => Math.min(prev + 1, explorerOptionCount - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex((prev) => explorerOptionCount > 0 ? Math.max(prev - 1, 0) : -1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (showingSymbolGroups && highlightIndex >= 0 && highlightIndex < symbolGroups.length) {
        setSelectedSymbolGroupKey(symbolGroups[highlightIndex].key);
        setHighlightIndex(0);
      } else if (highlightIndex >= 0 && highlightIndex < filteredSymbols.length) {
        handleSelectSymbol(filteredSymbols[highlightIndex]);
      } else if (search.trim()) {
        handleSelectSymbol(search);
      }
    } else if (e.key === 'Escape') {
      if (search.trim()) {
        setSearch('');
        setHighlightIndex(-1);
      } else if (selectedSymbolGroup) {
        setSelectedSymbolGroupKey(null);
        setHighlightIndex(-1);
      } else {
        closeSymbolExplorer();
        inputRef.current?.blur();
      }
    }
  }, [
    closeSymbolExplorer,
    explorerOptionCount,
    filteredSymbols,
    handleSelectSymbol,
    highlightIndex,
    search,
    selectedSymbolGroup,
    showingSymbolGroups,
    symbolGroups,
  ]);

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    setShowSymbolsPanel(true);
    setHighlightIndex(-1);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        showSymbolsPanel
        && containerRef.current
        && !containerRef.current.contains(e.target as Node)
      ) {
        closeSymbolExplorer();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [closeSymbolExplorer, showSymbolsPanel]);

  useEffect(() => {
    if (highlightIndex < 0 || showingSymbolGroups) return;
    const option = document.getElementById(`${searchListboxId}-option-${highlightIndex}`);
    if (option && typeof option.scrollIntoView === 'function') {
      option.scrollIntoView({ block: 'nearest' });
      return;
    }
    const element = symbolExplorerScrollRef.current;
    if (!element) return;
    element.scrollTop = highlightIndex * SYMBOL_EXPLORER_ROW_HEIGHT;
    handleSymbolExplorerScroll();
  }, [
    searchListboxId,
    handleSymbolExplorerScroll,
    highlightIndex,
    showingSymbolGroups,
  ]);

  const { loading: quotesLoading, error: quotesError } = useLiveQuotes(subscriptionSymbols);
  useEffect(() => {
    if (!pendingStatusRefreshSymbol || !subscriptionSymbols.includes(pendingStatusRefreshSymbol)) return;
    setPendingStatusRefreshSymbol(null);
    void reloadActiveMarketSymbols();
  }, [pendingStatusRefreshSymbol, reloadActiveMarketSymbols, subscriptionSymbols]);
  const marketWatchErrors = getMarketWatchDisplayErrors(
    symbolsError,
    watchlistError,
    quotesError,
    searchUniverse.length === 0 ? activeSymbolsError : null,
  );
  const activeSearchOptionId = highlightIndex >= 0 && highlightIndex < explorerOptionCount
    ? `${searchListboxId}-option-${highlightIndex}`
    : undefined;

  return (
    <>
      {/* Shared Market Watch interaction styles for browser and Electron. */}
      <style>{`
        .rtx-market-watch .mw-row { transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); }
        .rtx-market-watch .mw-input::placeholder { color: var(--text-secondary); }
        .rtx-market-watch .mw-input:focus { border-color: transparent !important; box-shadow: none !important; background: transparent !important; }
        .rtx-market-watch .rtx-market-watch__search-bar:focus-within { box-shadow: inset 0 -1px 0 var(--border-secondary); }
        .rtx-market-watch .rtx-market-watch__explorer-option:hover { background: var(--bg-quaternary) !important; }
        .rtx-market-watch .mw-scrollbar::-webkit-scrollbar { width: 4px; height: 4px; }
        .rtx-market-watch .mw-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .rtx-market-watch .mw-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
        .rtx-market-watch .mw-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }
        .rtx-market-watch .rtx-market-watch__symbol-explorer .mw-scrollbar::-webkit-scrollbar-thumb { background: var(--border-tertiary); }
        .rtx-market-watch .rtx-market-watch__symbol-explorer .mw-scrollbar::-webkit-scrollbar-thumb:hover { background: var(--text-tertiary); }
      `}</style>

      <div
        ref={containerRef}
        className={`rtx-market-watch ${className ?? ''}`}
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          background: 'transparent',
          color: '#e2e2e8',
          fontFamily: 'var(--font-sans)',
          fontSize: 14,
          userSelect: 'none',
          overflow: 'hidden',
        }}
      >
        {/* ── Search / Add Symbol ──────────────────────────────── */}
        <div
          className="rtx-market-watch__search"
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: showSymbolsPanel ? '1 1 auto' : '0 0 auto',
            minHeight: 0,
            borderBottom: '1px solid var(--border-primary)',
            background: showSymbolsPanel ? 'var(--bg-secondary)' : 'transparent',
          }}
        >
          <div
            className="rtx-market-watch__search-bar"
            style={{ position: 'relative', height: 48, flexShrink: 0 }}
          >
            <Icon
              name="search"
              size={20}
              style={{
                position: 'absolute',
                left: 13,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-secondary)',
                pointerEvents: 'none',
              }}
            />
            <input
              id="rtxMarketWatchSymbolSearch"
              name="marketWatchSymbolSearch"
              ref={inputRef}
              className="mw-input"
              style={{
                width: '100%',
                height: '100%',
                boxSizing: 'border-box',
                background: 'transparent',
                border: '1px solid transparent',
                borderRadius: 0,
                padding: showSymbolsPanel ? '0 42px' : '0 12px 0 42px',
                fontSize: 14,
                fontWeight: 400,
                color: 'var(--text-primary)',
                outline: 'none',
                fontFamily: 'inherit',
              }}
              aria-label="Add symbol"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={showSymbolsPanel}
              aria-controls={showSymbolsPanel ? searchListboxId : undefined}
              aria-activedescendant={activeSearchOptionId}
              autoComplete="off"
              placeholder="Search symbol"
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              onFocus={() => setShowSymbolsPanel(true)}
            />
            {showSymbolsPanel && (
              <button
                type="button"
                aria-label="Close symbol search"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  closeSymbolExplorer();
                  inputRef.current?.blur();
                }}
                style={{
                  position: 'absolute',
                  right: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: 30,
                  height: 30,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: 0,
                  background: 'transparent',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                }}
              >
                <Icon name="x-close" size={18} />
              </button>
            )}
          </div>

          {showSymbolsPanel && (
            <div
              className="rtx-market-watch__symbol-explorer"
              style={{
                display: 'flex',
                flex: '1 1 auto',
                flexDirection: 'column',
                minHeight: 0,
                background: 'var(--bg-secondary)',
              }}
            >
              {isSymbolListLoading && symbolGroups.length === 0 ? (
                <div style={{ padding: '12px 13px', fontSize: 12, color: 'var(--text-tertiary)' }}>
                  Loading symbols…
                </div>
              ) : showingSymbolGroups ? (
                <div
                  id={searchListboxId}
                  role="listbox"
                  aria-label="Symbol groups"
                  className="rtx-market-watch__group-list mw-scrollbar"
                  style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}
                >
                  {symbolGroups.length === 0 ? (
                    <div style={{ padding: '12px 13px', fontSize: 12, color: 'var(--text-tertiary)' }}>
                      No symbols available
                    </div>
                  ) : symbolGroups.map((group, index) => (
                    <button
                      key={group.key}
                      id={`${searchListboxId}-option-${index}`}
                      type="button"
                      role="option"
                      aria-selected={index === highlightIndex}
                      aria-label={`${group.label} ${group.visibleCount} of ${group.symbols.length}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setHighlightIndex(index)}
                      onClick={() => {
                        setSelectedSymbolGroupKey(group.key);
                        setHighlightIndex(0);
                      }}
                      className="rtx-market-watch__explorer-option rtx-market-watch__group-option"
                      style={{
                        width: '100%',
                        height: SYMBOL_EXPLORER_ROW_HEIGHT,
                        padding: '0 13px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        border: 0,
                        background: index === highlightIndex ? 'var(--bg-quaternary)' : 'transparent',
                        color: 'var(--text-primary)',
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        fontSize: 14,
                        fontWeight: 600,
                        textAlign: 'left',
                      }}
                    >
                      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {group.label}
                      </span>
                      <span style={{ flexShrink: 0, color: 'var(--text-secondary)', fontWeight: 400, fontVariantNumeric: 'tabular-nums' }}>
                        {group.visibleCount}/{group.symbols.length}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <>
                  {selectedSymbolGroup && !search.trim() && (
                    <button
                      type="button"
                      aria-label="Back to symbol groups"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setSelectedSymbolGroupKey(null);
                        setHighlightIndex(-1);
                      }}
                      style={{
                        height: SYMBOL_EXPLORER_ROW_HEIGHT,
                        padding: '0 12px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 7,
                        flexShrink: 0,
                        border: 0,
                        borderBottom: '1px solid var(--border-primary)',
                        background: 'var(--bg-tertiary)',
                        color: 'var(--text-primary)',
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        fontSize: 13,
                        fontWeight: 600,
                        textAlign: 'left',
                      }}
                    >
                      <Icon name="chevron-left" size="sm" />
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {selectedSymbolGroup.label}
                      </span>
                      <span style={{ flexShrink: 0, color: 'var(--text-secondary)', fontWeight: 400 }}>
                        {selectedSymbolGroup.symbols.length}
                      </span>
                    </button>
                  )}
                  <div
                    ref={symbolExplorerScrollRef}
                    id={searchListboxId}
                    role="listbox"
                    aria-label={search.trim() ? 'Symbol search results' : `${selectedSymbolGroup?.label ?? ''} symbols`}
                    data-testid="market-watch-symbol-scroll"
                    onScroll={handleSymbolExplorerScroll}
                    className="rtx-market-watch__symbol-list mw-scrollbar"
                    style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain' }}
                  >
                    {filteredSymbols.length === 0 ? (
                      <div style={{ padding: '12px 13px', fontSize: 12, color: 'var(--text-tertiary)' }}>
                        {search.trim() ? 'No matches found' : 'No symbols in this group'}
                      </div>
                    ) : (
                      <>
                        {symbolExplorerWindow.topSpacerHeight > 0 && (
                          <div aria-hidden="true" style={{ height: symbolExplorerWindow.topSpacerHeight }} />
                        )}
                        {renderedExplorerSymbols.map((symbol, visibleIndex) => {
                          const absoluteIndex = symbolExplorerWindow.startIndex + visibleIndex;
                          const displaySymbol = getMarketWatchSymbolLabel(symbol, searchUniverse);
                          const isSubscribed = marketWatchSymbolSet.has(symbol);
                          return (
                            <button
                              key={symbol}
                              id={`${searchListboxId}-option-${absoluteIndex}`}
                              type="button"
                              role="option"
                              aria-selected={absoluteIndex === highlightIndex}
                              aria-disabled={false}
                              aria-label={displaySymbol}
                              aria-posinset={absoluteIndex + 1}
                              aria-setsize={filteredSymbols.length}
                              data-subscribed={isSubscribed ? 'true' : 'false'}
                              tabIndex={-1}
                              onMouseDown={(event) => event.preventDefault()}
                              onMouseEnter={() => setHighlightIndex(absoluteIndex)}
                              onClick={() => handleSelectSymbol(symbol)}
                              className="rtx-market-watch__explorer-option rtx-market-watch__symbol-option"
                              style={{
                                width: '100%',
                                height: SYMBOL_EXPLORER_ROW_HEIGHT,
                                padding: isSubscribed ? '0 11px 0 10px' : '0 13px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 8,
                                borderTop: 0,
                                borderRight: 0,
                                borderBottom: '1px solid var(--bg-tertiary)',
                                borderLeft: isSubscribed ? '3px solid var(--status-connected)' : 0,
                                background: absoluteIndex === highlightIndex
                                  ? 'var(--bg-quaternary)'
                                  : isSubscribed
                                    ? 'var(--color-profit-dimmer)'
                                    : 'transparent',
                                color: 'var(--text-primary)',
                                cursor: 'pointer',
                                fontFamily: 'inherit',
                                fontSize: 14,
                                fontWeight: 500,
                                textAlign: 'left',
                              }}
                            >
                              <span
                                className="rtx-market-watch__symbol"
                                style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                              >
                                {displaySymbol}
                              </span>
                              {isSubscribed && (
                                <span
                                  aria-hidden="true"
                                  className="rtx-market-watch__subscribed-badge"
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 5,
                                    flexShrink: 0,
                                    color: 'var(--status-connected)',
                                    fontSize: 10,
                                    fontWeight: 600,
                                    letterSpacing: '0.02em',
                                  }}
                                >
                                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor' }} />
                                  Subscribed
                                </span>
                              )}
                            </button>
                          );
                        })}
                        {symbolExplorerWindow.bottomSpacerHeight > 0 && (
                          <div aria-hidden="true" style={{ height: symbolExplorerWindow.bottomSpacerHeight }} />
                        )}
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* ── Table & Column Headers ───────────────────────────── */}
        {!showSymbolsPanel && (
          <div
            ref={setMarketWatchViewportRef}
            style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', minWidth: 0 }}
            className="rtx-market-watch__table mw-scrollbar"
          >
          {rows.length === 0 ? (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              height: '100%', gap: 8, color: '#222226',
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
                <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
              </svg>
              <span className="rtx-market-watch__empty-text" style={{ fontSize: 11, color: '#50505a' }}>
                {isSymbolListLoading ? 'Loading symbols...' : 'No live symbols'}
              </span>
              {!isSymbolListLoading && quoteEligibleSymbols.length > 0 && (
                <button
                  type="button"
                  onClick={handleShowAll}
                  style={{
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: 3,
                    background: 'rgba(255,255,255,0.04)',
                    color: '#808088',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontSize: 10,
                    padding: '4px 8px',
                  }}
                >
                  Show all symbols
                </button>
              )}
            </div>
          ) : (
            <table className="rtx-market-watch__grid" style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
              <colgroup>
                <col />
                <col style={{ width: panelWidth < 300 ? '45%' : showSpread ? '20%' : '22%' }} />
                {showAsk && <col style={{ width: showSpread ? '20%' : '22%' }} />}
                {showSpread && <col style={{ width: '14%' }} />}
                {showDailyChange && <col style={{ width: 90 }} />}
              </colgroup>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  <th className="rtx-market-watch__column-heading" style={{ textAlign: 'left',  padding: '4px 8px', fontSize: 12, fontWeight: 400, color: '#606068', letterSpacing: 'normal', background: '#131316', position: 'sticky', top: 0, zIndex: 10, textTransform: 'uppercase' as const }}>Symbol</th>
                  <th className="rtx-market-watch__column-heading" style={{ textAlign: 'right', padding: '4px 5px', fontSize: 12, fontWeight: 400, color: '#606068', letterSpacing: 'normal', background: '#131316', position: 'sticky', top: 0, zIndex: 10, textTransform: 'uppercase' as const }}>Bid</th>
                  {showAsk && <th className="rtx-market-watch__column-heading" style={{ textAlign: 'right', padding: '4px 5px', fontSize: 12, fontWeight: 400, color: '#606068', letterSpacing: 'normal', background: '#131316', position: 'sticky', top: 0, zIndex: 10, textTransform: 'uppercase' as const }}>Ask</th>}
                  {showSpread && <th className="rtx-market-watch__column-heading" style={{ textAlign: 'right', padding: '4px 5px', fontSize: 12, fontWeight: 400, color: '#606068', letterSpacing: 'normal', background: '#131316', position: 'sticky', top: 0, zIndex: 10 }}>Spread</th>}
                  {showDailyChange && <th className="rtx-market-watch__column-heading" style={{ textAlign: 'right', padding: '4px 8px', fontSize: 12, fontWeight: 400, color: '#606068', letterSpacing: 'normal', background: '#131316', position: 'sticky', top: 0, zIndex: 10 }}>Daily Change</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((symbol) => {
                  return (
                    <MarketWatchRow
                      key={symbol}
                      symbol={symbol}
                      isSelected={symbol === normalizeSymbol(selectedSymbol)}
                      isLive={liveQuoteSymbolSet.has(symbol)}
                      isAvailable={quoteEligibleSymbolSet.has(symbol)}
                      isStatusLoading={activeSymbolsLoading}
                      isStatusSettled={activeSymbolsSettled}
                      isStatusCurrent={activeSymbolsCurrent}
                      isCatalogLoading={isLoadingSymbols}
                      isChartOpenable={chartOpenableSymbolSet.has(symbol)}
                      now={Date.now()}
                      onClick={() => onSymbolSelect(symbol)}
                      contextMenuItems={getContextMenuItems(symbol)}
                      showAsk={showAsk}
                      showSpread={showSpread}
                      showDailyChange={showDailyChange}
                      symbolUniverse={quoteEligibleSymbols}
                      rowRef={marketWatchRowRefCallbacks.get(symbol)}
                    />
                  );
                })}
              </tbody>
            </table>
          )}
          </div>
        )}

        {/* ── Footer: add symbol hint ──────────────────────────── */}
        {!showSymbolsPanel && (
          <>
          <div className="rtx-market-watch__footer" style={{
          padding: '5px 10px',
          borderTop: '1px solid rgba(255,255,255,0.04)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <button
            type="button"
            aria-label="Focus symbol search"
            onClick={() => inputRef.current?.focus()}
            className="rtx-market-watch__footer-action"
            style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', color: '#50505a', fontSize: 10, background: 'none', border: 0, padding: 0, fontFamily: 'inherit' }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add symbol
          </button>
          <span className="rtx-market-watch__footer-count" style={{ fontSize: 10, color: '#36363e' }}>{rows.length} symbols</span>
        </div>

        {marketWatchErrors.length > 0 && (
          <div role="alert" aria-label="Market Watch errors" style={{
            padding: '5px 10px',
            borderTop: '1px solid rgba(248,113,113,0.16)',
            color: '#f87171',
            background: 'rgba(248,113,113,0.06)',
            fontSize: 10,
            lineHeight: 1.3,
          }}>
            <ul style={{ margin: 0, paddingLeft: 14 }}>
              {marketWatchErrors.map((message) => <li key={message}>{message}</li>)}
            </ul>
          </div>
        )}
          {(quotesLoading || watchlistLoading) && rows.length > 0 && liveTickCount === 0 && (
            <div style={{ padding: '4px 10px', color: '#606068', fontSize: 10 }}>
              Loading quotes...
            </div>
          )}
          </>
        )}
      </div>
    </>
  );
};

const MarketWatchPanelWithLocalDataOwners: React.FC<MarketWatchPanelBaseProps> = (props) => {
  const activeMarketSnapshot = useActiveMarketSymbols();
  const marketInstrumentsSnapshot = useMarketInstruments();
  return (
    <MarketWatchPanelContent
      {...props}
      activeMarketSnapshot={activeMarketSnapshot}
      marketInstrumentsSnapshot={marketInstrumentsSnapshot}
    />
  );
};

const MarketWatchPanelWithLocalFreshnessOwner: React.FC<MarketWatchPanelBaseProps & {
  marketInstrumentsSnapshot: MarketInstrumentsSnapshot;
}> = ({ marketInstrumentsSnapshot, ...props }) => {
  const activeMarketSnapshot = useActiveMarketSymbols();
  return (
    <MarketWatchPanelContent
      {...props}
      activeMarketSnapshot={activeMarketSnapshot}
      marketInstrumentsSnapshot={marketInstrumentsSnapshot}
    />
  );
};

const MarketWatchPanelWithLocalMarketInstrumentsOwner: React.FC<MarketWatchPanelBaseProps & {
  activeMarketSnapshot: ActiveMarketSymbolsSnapshot;
}> = ({ activeMarketSnapshot, ...props }) => {
  const marketInstrumentsSnapshot = useMarketInstruments();
  return (
    <MarketWatchPanelContent
      {...props}
      activeMarketSnapshot={activeMarketSnapshot}
      marketInstrumentsSnapshot={marketInstrumentsSnapshot}
    />
  );
};

export const MarketWatchPanel: React.FC<MarketWatchPanelProps> = ({
  activeMarketSnapshot,
  marketInstrumentsSnapshot,
  ...props
}) => {
  if (activeMarketSnapshot && marketInstrumentsSnapshot) {
    return (
    <MarketWatchPanelContent
      {...props}
      activeMarketSnapshot={activeMarketSnapshot}
      marketInstrumentsSnapshot={marketInstrumentsSnapshot}
    />
    );
  }
  if (activeMarketSnapshot) {
    return <MarketWatchPanelWithLocalMarketInstrumentsOwner {...props} activeMarketSnapshot={activeMarketSnapshot} />;
  }
  if (marketInstrumentsSnapshot) {
    return <MarketWatchPanelWithLocalFreshnessOwner {...props} marketInstrumentsSnapshot={marketInstrumentsSnapshot} />;
  }
  return <MarketWatchPanelWithLocalDataOwners {...props} />;
};

export default MarketWatchPanel;
