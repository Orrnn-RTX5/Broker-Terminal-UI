import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { resolveTickFromLookup, useAppStore, useTick } from '../../store/useAppStore';
import { useMarketDataStore } from '../../store/useMarketDataStore';
import { useWatchlistStore } from '../../store/useWatchlistStore';
import { ContextMenu, type ContextMenuItemConfig } from '../ui/ContextMenu';
import { Icon } from '../ui/Icon';
import { PriceDisplay } from '../ui/PriceDisplay';
import { useActiveMarketSymbols, useLiveQuotes, useMarketInstruments, useRemoteWatchlistSync } from '../../hooks/useLiveMarketData';
import { formatSpreadDisplay } from '../../utils/spread';
import { getUniqueSymbolNames } from '../../utils/symbolEligibility';
import {
  getDefaultMarketWatchSymbols,
  getMarketWatchDisplayErrors,
  getMarketWatchSymbolLabel,
  resolveMarketWatchSymbolInput,
  searchMarketWatchSymbols,
  shouldUseWatchlistAsMarketWatchSource,
} from '../../utils/marketWatchSource';

interface MarketWatchPanelProps {
  allSymbols: unknown[];
  selectedSymbol: string;
  onSymbolSelect: (symbol: string) => void;
  className?: string;
}

interface ScopedManualSymbols {
  watchlistId: string;
  symbols: string[];
}

const normalizeSymbol = (value: unknown): string => String(value ?? '').trim().toUpperCase();

const uniqueSymbols = (symbols: unknown[]): string[] =>
  Array.from(new Set(symbols.map(normalizeSymbol).filter(Boolean)));

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

// Category helper
const getCategory = (sym: string): { label: string; color: string } => {
  if (['BTCUSD','ETHUSD','LTCUSD','XRPUSD','BCHUSD','ADAUSD','SOLUSD','DOTUSD','LINKUSD','MATICUSD','UNIUSD','AAVEUSD','SUSHIUSD'].includes(sym))
    return { label: 'Crypto', color: '#f59e0b' };
  if (['XAUUSD','XAGUSD','XPTUSD','XPDUSD'].includes(sym))
    return { label: 'Metal', color: '#eab308' };
  if (['US30','US500','USTEC','GER40','UK100','FRA40','ESP35','ITA40','AUS200','JPN225','HK50','CHN50','EUSTX50'].includes(sym))
    return { label: 'Index', color: '#9fa0b0' };
  if (['USOIL','UKOIL','NATGAS','COPPER','CORN','WHEAT','SOYBEAN','COCOA','COFFEE','SUGAR'].includes(sym))
    return { label: 'Comm', color: '#34d399' };
  return { label: 'Forex', color: '#7aacca' };
};

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
  isActionable: boolean;
  now: number;
  onClick: () => void;
  contextMenuItems: ContextMenuItemConfig[];
  showAsk: boolean;
  showSpread: boolean;
  showDaily: boolean;
  symbolUniverse: readonly string[];
  rowRef?: (node: HTMLTableRowElement | null) => void;
}> = ({ symbol, isSelected, isLive, isAvailable, isStatusLoading, isStatusSettled, isStatusCurrent, isCatalogLoading, isActionable, now, onClick, contextMenuItems, showAsk, showSpread, showDaily, symbolUniverse, rowRef }) => {
  const displaySymbol = getMarketWatchSymbolLabel(symbol, symbolUniverse);
  const cachedTick = useTick(symbol);
  const tick = cachedTick;
  const bidDirection = tick?.bidDirection ?? 'none';
  const askDirection = tick?.askDirection ?? 'none';
  const bid = tick?.bid ?? 0;
  const ask = tick?.ask ?? 0;
  const spread = tick?.spread ?? (ask - bid);

  const cachedStats = useMarketDataStore(state => state.symbolData[symbol]?.stats);
  const stats = cachedStats;
  const rawDaily = tick?.dailyChange;
  const dailyPct: number | null =
    rawDaily !== undefined && rawDaily !== null
      ? Number(rawDaily)
      : stats?.changePercent24h ?? null;

  const spreadDisplay = formatSpreadDisplay(symbol, spread, bid, ask);

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
        draggable={isActionable}
        onDragStart={(e) => {
          if (!isActionable) {
            e.preventDefault();
            return;
          }
          e.dataTransfer.setData('text/plain', symbol);
          e.dataTransfer.effectAllowed = 'copyMove';
        }}
        onClick={onClick}
        style={{
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
        aria-disabled={!isActionable}
        title={!isActionable ? `${displaySymbol} trading is currently unavailable` : undefined}
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
              fontSize: 11,
              fontWeight: isSelected ? 600 : 500,
              color: isSelected ? '#e2e2e8' : '#b8b8c0',
              letterSpacing: '0.015em',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {displaySymbol}
            </span>
            {statusLabel && (
              <span
                className="rtx-market-watch__status"
                aria-label={`${displaySymbol} ${statusLabel.toLowerCase()}${quoteAge ? `, last quote ${quoteAge} ago` : ''}`}
                style={{
                  flexShrink: 0,
                  fontSize: 7,
                  color: statusLabel === 'STALE' ? '#d6a84b' : '#6b6b73',
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
            fontSize: 12,
            fontWeight: 600,
            color: hasData
              ? bidFlash === 'up' ? '#4ade80'
              : bidFlash === 'down' ? '#f87171'
              : '#d0d0d8'
              : '#36363e',
            padding: '1px 4px',
            borderRadius: 3,
            background: 'transparent',
            transition: 'color 0.25s',
            letterSpacing: '0.01em',
            fontVariantNumeric: 'tabular-nums',
            tabularNums: true,
          } as React.CSSProperties}>
            {hasData ? <PriceDisplay price={bid} symbol={symbol} /> : '—'}
          </span>
        </td>

        {/* Ask — secondary, slightly softer */}
        {showAsk && (
          <td style={{ padding: '3px 5px', textAlign: 'right' }}>
            <span className={`rtx-market-watch__price rtx-market-watch__price--ask${askPriceDirection ? ` rtx-market-watch__price--${askPriceDirection}` : ''}${!hasData ? ' rtx-market-watch__price--empty' : ''}`} style={{
              display: 'inline-block',
              fontSize: 12,
              fontWeight: 500,
              color: hasData
                ? askFlash === 'up' ? '#4ade80'
                : askFlash === 'down' ? '#f87171'
                : '#a0a0a8'
                : '#36363e',
              padding: '1px 4px',
              borderRadius: 3,
              background: 'transparent',
              transition: 'color 0.25s',
              letterSpacing: '0.01em',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {hasData ? <PriceDisplay price={ask} symbol={symbol} /> : '—'}
            </span>
          </td>
        )}

        {/* Spread — pill badge style, easy to scan */}
        {showSpread && (
          <td style={{ padding: '3px 5px', textAlign: 'right' }}>
            <span className={`rtx-market-watch__spread${!hasData ? ' rtx-market-watch__spread--empty' : ''}`} style={{
              fontSize: 10,
              fontWeight: 500,
              color: hasData ? '#888890' : '#36363e',
              letterSpacing: '0.01em',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {hasData ? spreadDisplay : '—'}
            </span>
          </td>
        )}

        {/* Daily Change — bold, clear positive/negative */}
        {showDaily && (
          <td style={{ padding: '3px 8px', textAlign: 'right' }}>
            <span className={`rtx-market-watch__daily${!hasData ? ' rtx-market-watch__daily--empty' : ''}${dailyPositive ? ' rtx-market-watch__daily--up' : ''}${dailyNegative ? ' rtx-market-watch__daily--down' : ''}`} style={{
              fontSize: 11,
              fontWeight: 600,
              color: !hasData ? '#36363e'
                : !hasDailyData ? '#50505a'
                : dailyPositive ? '#4ade80'
                : dailyNegative ? '#f87171'
                : '#606068',
              letterSpacing: '0.01em',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {!hasData ? '—'
                : hasDailyData
                  ? `${dailyPct! > 0 ? '+' : ''}${dailyPct!.toFixed(2)}%`
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
export const MarketWatchPanel: React.FC<MarketWatchPanelProps> = ({
  allSymbols,
  selectedSymbol,
  onSymbolSelect,
  className,
}) => {
  const liveTicks = useAppStore((state) => state.ticks);
  const liveTickCount = Object.keys(liveTicks).length;
  const {
    symbols: marketInstruments,
    disabledSymbols,
    loading: isLoadingSymbols,
    error: symbolsError,
  } = useMarketInstruments();
  const {
    symbols: activeMarketSymbols,
    loading: activeSymbolsLoading,
    settled: activeSymbolsSettled,
    current: activeSymbolsCurrent,
    error: activeSymbolsError,
    reload: reloadActiveMarketSymbols,
  } = useActiveMarketSymbols();

  const activeWatchlist = useWatchlistStore((s) => {
    return s.watchlists.find((w) => w.id === s.activeWatchlistId);
  });
  const {
    loading: watchlistLoading,
    error: watchlistError,
  } = useRemoteWatchlistSync(activeWatchlist?.id);
  const [search, setSearch] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [showGrid, setShowGrid] = useState(true);
  const [showSymbolsPanel, setShowSymbolsPanel] = useState(false);
  const [manualSymbols, setManualSymbols] = useState<ScopedManualSymbols>({
    watchlistId: activeWatchlist?.id ?? '',
    symbols: [],
  });
  const [pendingStatusRefreshSymbol, setPendingStatusRefreshSymbol] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());
  const [panelWidth, setPanelWidth] = useState(999);
  const [currentTime, setCurrentTime] = useState(new Date());
  const searchListboxId = useId();
  const dockedSearchListboxId = useId();

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

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

  const showAsk    = panelWidth >= 220;
  const showSpread = panelWidth >= 300;
  const showDaily  = panelWidth >= 380;

  const disabledSymbolSet = useMemo(() => new Set(uniqueSymbols(disabledSymbols)), [disabledSymbols]);

  const authorizedSymbols = useMemo(() => {
    return uniqueSymbols([
      ...getUniqueSymbolNames(allSymbols),
      ...getUniqueSymbolNames(marketInstruments),
    ])
      .filter((symbol) => !disabledSymbolSet.has(symbol))
      .sort((a, b) => a.localeCompare(b));
  }, [allSymbols, disabledSymbolSet, marketInstruments]);

  const authorizedSymbolSet = useMemo(() => new Set(authorizedSymbols), [authorizedSymbols]);
  const defaultSymbols = useMemo(
    () => getDefaultMarketWatchSymbols(authorizedSymbols),
    [authorizedSymbols],
  );
  const shouldMergePersistedSymbols = shouldUseWatchlistAsMarketWatchSource({
    activeWatchlistId: activeWatchlist?.id,
    activeWatchlistIsDefault: activeWatchlist?.isDefault,
  });
  const persistedSymbols = useMemo(() => shouldMergePersistedSymbols
    ? uniqueSymbols(activeWatchlist?.symbols ?? [])
      .map((symbol) => resolveMarketWatchSymbolInput(authorizedSymbols, symbol) ?? symbol)
    : [], [
      activeWatchlist?.symbols,
      authorizedSymbols,
      shouldMergePersistedSymbols,
    ]);
  const activeManualSymbols = manualSymbols.watchlistId === (activeWatchlist?.id ?? '')
    ? manualSymbols.symbols
    : [];
  const rows = useMemo(() => uniqueSymbols([
    ...(shouldMergePersistedSymbols ? persistedSymbols : defaultSymbols),
    ...activeManualSymbols,
  ]), [
    activeManualSymbols,
    defaultSymbols,
    persistedSymbols,
    shouldMergePersistedSymbols,
  ]);
  const activeSymbolSet = useMemo(() => new Set(uniqueSymbols(activeMarketSymbols)), [activeMarketSymbols]);
  const actionableSymbolSet = useMemo(() => new Set(
    activeSymbolsCurrent
      ? authorizedSymbols.filter((symbol) => activeSymbolSet.has(symbol))
      : [],
  ), [activeSymbolSet, activeSymbolsCurrent, authorizedSymbols]);
  const searchUniverse = authorizedSymbols;
  const subscriptionSymbols = useMemo(() => rows.filter(
    (symbol) => authorizedSymbolSet.has(symbol),
  ), [authorizedSymbolSet, rows]);

  const filteredSymbols = useMemo(() => {
    return searchMarketWatchSymbols(searchUniverse, search);
  }, [search, searchUniverse]);

  const scrollSymbolIntoView = useCallback((symbol: string) => {
    window.requestAnimationFrame(() => {
      rowRefs.current.get(symbol)?.scrollIntoView({ block: 'center' });
    });
  }, []);

  const handleSelectSymbol = useCallback((symbol: string) => {
    const next = resolveMarketWatchSymbolInput(searchUniverse, symbol);
    if (!next || !authorizedSymbolSet.has(next)) return;
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
    setShowDropdown(false);
    setHighlightIndex(-1);
    onSymbolSelect(next);
    scrollSymbolIntoView(next);
    
    // Automatically open chart for the newly searched/selected pair as a NEW TAB
    window.dispatchEvent(new CustomEvent('openChart', { detail: { symbol: next, newTab: true } }));
  }, [
    activeWatchlist,
    authorizedSymbolSet,
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

    // Product defaults are fixed only in the built-in/default Market Watch.
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
    setManualSymbols({ watchlistId, symbols: [...authorizedSymbols] });
    if (shouldMergePersistedSymbols && activeWatchlist) {
      useWatchlistStore.getState().reorderSymbols(activeWatchlist.id, authorizedSymbols);
    }
  }, [activeWatchlist, authorizedSymbols, shouldMergePersistedSymbols]);

  const handleExport = useCallback(() => {
    const data = rows.map(sym => {
      const tick = getTickSnapshot(sym);
      const spreadDisplay = tick ? formatSpreadDisplay(sym, tick.spread, tick.bid, tick.ask) : '-';
      return `${sym}\t${tick?.bid ?? '-'}\t${tick?.ask ?? '-'}\t${spreadDisplay}`;
    }).join('\n');
    navigator.clipboard.writeText(`Symbol\tBid\tAsk\tSpread\n${data}`);
  }, [rows]);

  const getContextMenuItems = useCallback((symbol: string): ContextMenuItemConfig[] => {
    const disabled = !actionableSymbolSet.has(symbol);
    return [
      {
        label: 'New Order',
        icon: <Icon name="plus" size="xs" />,
        shortcut: 'F9',
        disabled,
        action: () => {
          window.dispatchEvent(new CustomEvent('openOrderDialog', { detail: { symbol } }));
        },
      },
      {
        label: 'Chart Window',
        icon: <Icon name="bar-chart" size="xs" />,
        action: () => {
          window.dispatchEvent(new CustomEvent('openChart', { detail: { symbol } }));
        },
      },
      {
        label: 'Depth Of Market',
        icon: <Icon name="layers" size="xs" />,
        shortcut: 'Alt+B',
        disabled,
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

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex((prev) => Math.min(prev + 1, filteredSymbols.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightIndex >= 0 && highlightIndex < filteredSymbols.length) {
        handleSelectSymbol(filteredSymbols[highlightIndex]);
      } else if (search.trim()) {
        handleSelectSymbol(search);
      }
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
      setSearch('');
      setHighlightIndex(-1);
    }
  }, [filteredSymbols, highlightIndex, search, handleSelectSymbol]);

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    setShowDropdown(Boolean(value.trim()));
    setHighlightIndex(-1);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
  const activeSearchListboxId = showSymbolsPanel ? dockedSearchListboxId : searchListboxId;
  const activeSearchOptionId = highlightIndex >= 0 && highlightIndex < filteredSymbols.length
    ? `${activeSearchListboxId}-option-${highlightIndex}`
    : undefined;

  const timeStr = currentTime.toLocaleTimeString('en-US', { hour12: false });

  return (
    <>
      {/* Inline style for hover row and flash animation */}
      {/* Inline style for hover row and flash animation */}
      <style>{`
        .rtx-market-watch .mw-row { transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); }
        .rtx-market-watch .mw-input { transition: all 0.3s ease; }
        .rtx-market-watch .mw-input::placeholder { color: #64748b; }
        .rtx-market-watch .mw-input:focus { border-color: rgba(59,130,246,0.5) !important; box-shadow: 0 0 15px rgba(59,130,246,0.25), inset 0 0 0 1px rgba(59,130,246,0.5) !important; background: rgba(15,23,42,0.6) !important; }
        .rtx-market-watch .mw-scrollbar::-webkit-scrollbar { width: 4px; height: 4px; }
        .rtx-market-watch .mw-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .rtx-market-watch .mw-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
        .rtx-market-watch .mw-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }
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
          fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          fontSize: 12,
          userSelect: 'none',
          overflow: 'hidden',
        }}
      >
        {/* ── Header ──────────────────────────────────────────── */}
        <div className="rtx-market-watch__header" style={{
          padding: '8px 12px 7px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'linear-gradient(180deg, rgba(25,26,30,0.95) 0%, rgba(19,19,22,0) 100%)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            {/* Subtle accent dot */}
            <span className="rtx-market-watch__title" style={{ fontSize: 11, fontWeight: 500, color: '#808088', letterSpacing: '0.04em' }}>
              MARKET WATCH
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="rtx-market-watch__time" style={{
              fontSize: 10,
              color: '#8a8a8f',
              letterSpacing: '0.04em',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {timeStr}
            </span>
            <span className="rtx-market-watch__count" style={{
              fontSize: 9,
              color: '#50505a',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 10,
              padding: '1px 6px',
              letterSpacing: '0.03em',
            }}>
              {rows.length}
            </span>
          </div>
        </div>

        {/* ── Search / Add Symbol ──────────────────────────────── */}
        <div className="rtx-market-watch__search" style={{ padding: '7px 10px', borderBottom: '1px solid rgba(255,255,255,0.05)', position: 'relative', flexShrink: 0 }} ref={dropdownRef}>
          <div style={{ position: 'relative' }}>
            {/* Search icon */}
            <svg
              width="12" height="12" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#50505a', pointerEvents: 'none' }}
            >
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              id="rtxMarketWatchSymbolSearch"
              name="marketWatchSymbolSearch"
              ref={inputRef}
              className="mw-input"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 6,
                padding: '5px 8px 5px 26px',
                fontSize: 11,
                color: '#e2e2e8',
                outline: 'none',
                fontFamily: 'inherit',
                transition: 'border-color 0.15s, box-shadow 0.15s',
              }}
              aria-label="Add symbol"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={showSymbolsPanel || showDropdown}
              aria-controls={activeSearchListboxId}
              aria-activedescendant={activeSearchOptionId}
              autoComplete="off"
              placeholder="Add symbol..."
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              onFocus={() => search.trim() && setShowDropdown(true)}
            />
          </div>

          {/* Dropdown */}
          {showDropdown && !showSymbolsPanel && (
            <div
              id={searchListboxId}
              role="listbox"
              aria-label="Symbol search results"
              className="rtx-market-watch__dropdown mw-scrollbar"
              style={{
              position: 'absolute',
              left: 10, right: 10,
              top: '100%',
              marginTop: 2,
              background: '#191a1e',
              border: '1px solid rgba(255,255,255,0.09)',
              borderRadius: 7,
              boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
              zIndex: 50,
              maxHeight: 220,
              overflowY: 'auto',
              }}
            >
              {isSymbolListLoading ? (
                <div style={{ padding: '10px 12px', fontSize: 11, color: '#50505a' }}>Loading…</div>
              ) : filteredSymbols.length === 0 ? (
                <div style={{ padding: '10px 12px', fontSize: 11, color: '#50505a' }}>
                  {search.trim() ? 'No matches found' : 'Type to search…'}
                </div>
              ) : filteredSymbols.map((sym, idx) => {
                const cat = getCategory(sym);
                const displaySymbol = getMarketWatchSymbolLabel(sym, searchUniverse);
                return (
                  <div
                    key={sym}
                    id={`${searchListboxId}-option-${idx}`}
                    role="option"
                    aria-selected={idx === highlightIndex}
                    aria-disabled={false}
                    aria-label={displaySymbol}
                    onClick={() => handleSelectSymbol(sym)}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setHighlightIndex(idx)}
                    style={{
                      padding: '6px 12px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    cursor: 'pointer',
                    fontSize: 11,
                    background: idx === highlightIndex ? 'rgba(255,255,255,0.06)' : 'transparent',
                    opacity: 1,
                      transition: 'background 0.1s',
                    }}
                  >
                    <span className="rtx-market-watch__dropdown-symbol" style={{ color: idx === highlightIndex ? '#e2e2e8' : '#808088', fontWeight: 500 }}>{displaySymbol}</span>
                    <span className="rtx-market-watch__category" style={{
                      fontSize: 9,
                      color: cat.color,
                      background: `${cat.color}18`,
                      border: `1px solid ${cat.color}30`,
                      borderRadius: 4,
                      padding: '1px 5px',
                      letterSpacing: '0.03em',
                    }}>
                      {cat.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Symbols Panel (Ctrl+U) ───────────────────────────── */}
        {showSymbolsPanel && (
          <div className="rtx-market-watch__symbols-panel mw-scrollbar" style={{
            borderBottom: '1px solid rgba(255,255,255,0.05)',
            background: '#0d0f18',
            maxHeight: 140,
            overflowY: 'auto',
            flexShrink: 0,
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '4px 10px', background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.05)',
            }}>
              <span id={`${dockedSearchListboxId}-label`} className="rtx-market-watch__symbols-title" style={{ fontSize: 9, color: '#50505a', letterSpacing: '0.05em' }}>SEARCH RESULTS ({filteredSymbols.length})</span>
              <button
                type="button"
                aria-label="Close symbol search results"
                onClick={() => {
                  setShowSymbolsPanel(false);
                  setShowDropdown(false);
                }}
                style={{ background: 'none', border: 'none', color: '#50505a', cursor: 'pointer', fontSize: 11, padding: '0 2px', lineHeight: 1 }}
              >✕</button>
            </div>
            <div
              id={dockedSearchListboxId}
              role="listbox"
              aria-labelledby={`${dockedSearchListboxId}-label`}
            >
            {!search.trim() ? (
              <div style={{ padding: '10px 12px', fontSize: 11, color: '#50505a' }}>Type to search…</div>
            ) : filteredSymbols.length === 0 ? (
              <div style={{ padding: '10px 12px', fontSize: 11, color: '#50505a' }}>No matches found</div>
            ) : filteredSymbols.map((sym, idx) => {
              const cat = getCategory(sym);
              const displaySymbol = getMarketWatchSymbolLabel(sym, searchUniverse);
              return (
                <div
                  key={sym}
                  id={`${dockedSearchListboxId}-option-${idx}`}
                  role="option"
                  aria-selected={idx === highlightIndex}
                  aria-disabled={false}
                  aria-label={displaySymbol}
                  onClick={() => handleSelectSymbol(sym)}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setHighlightIndex(idx)}
                  style={{
                  padding: '5px 10px', display: 'flex', alignItems: 'center',
                  justifyContent: 'space-between', cursor: 'pointer', fontSize: 11, color: '#606068',
                  background: idx === highlightIndex ? 'rgba(255,255,255,0.06)' : 'transparent',
                  opacity: 1,
                  }}
                  className="mw-row"
                >
                  <span className="rtx-market-watch__symbol">{displaySymbol}</span>
                  <span className="rtx-market-watch__category" style={{ fontSize: 9, color: cat.color }}>{cat.label}</span>
                </div>
              );
            })}
            </div>
          </div>
        )}

        {/* ── Table & Column Headers ───────────────────────────── */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', minWidth: 0 }} className="rtx-market-watch__table mw-scrollbar">
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
              {!isSymbolListLoading && authorizedSymbols.length > 0 && (
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
              {/* Column sizing */}
              <colgroup>
                <col />
                <col style={{ width: panelWidth < 300 ? '45%' : '22%' }} />
                {showAsk    && <col style={{ width: '22%' }} />}
                {showSpread && <col style={{ width: '14%' }} />}
                {showDaily  && <col style={{ width: '20%' }} />}
              </colgroup>

              {/* Sticky header */}
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  <th className="rtx-market-watch__column-heading" style={{ textAlign: 'left',  padding: '4px 8px', fontSize: 9, fontWeight: 600, color: '#606068', letterSpacing: '0.09em', background: '#131316', position: 'sticky', top: 0, zIndex: 10, textTransform: 'uppercase' as const }}>Symbol</th>
                  <th className="rtx-market-watch__column-heading" style={{ textAlign: 'right', padding: '4px 5px', fontSize: 9, fontWeight: 600, color: '#606068', letterSpacing: '0.09em', background: '#131316', position: 'sticky', top: 0, zIndex: 10, textTransform: 'uppercase' as const }}>Bid</th>
                  {showAsk    && <th className="rtx-market-watch__column-heading" style={{ textAlign: 'right', padding: '4px 5px', fontSize: 9, fontWeight: 600, color: '#606068', letterSpacing: '0.09em', background: '#131316', position: 'sticky', top: 0, zIndex: 10, textTransform: 'uppercase' as const }}>Ask</th>}
                  {showSpread && <th className="rtx-market-watch__column-heading" style={{ textAlign: 'right', padding: '4px 5px', fontSize: 9, fontWeight: 600, color: '#606068', letterSpacing: '0.09em', background: '#131316', position: 'sticky', top: 0, zIndex: 10, textTransform: 'uppercase' as const }}>SPREAD</th>}
                  {showDaily  && <th className="rtx-market-watch__column-heading" style={{ textAlign: 'right', padding: '4px 8px', fontSize: 9, fontWeight: 600, color: '#606068', letterSpacing: '0.09em', background: '#131316', position: 'sticky', top: 0, zIndex: 10, textTransform: 'uppercase' as const }}>Daily</th>}
                </tr>
              </thead>

              <tbody>
                {rows.map((symbol) => {
                  return (
                    <MarketWatchRow
                      key={symbol}
                      symbol={symbol}
                      isSelected={symbol === normalizeSymbol(selectedSymbol)}
                      isLive={actionableSymbolSet.has(symbol)}
                      isAvailable={authorizedSymbolSet.has(symbol)}
                      isStatusLoading={activeSymbolsLoading}
                      isStatusSettled={activeSymbolsSettled}
                      isStatusCurrent={activeSymbolsCurrent}
                      isCatalogLoading={isLoadingSymbols}
                      isActionable={actionableSymbolSet.has(symbol)}
                      now={currentTime.getTime()}
                      onClick={() => onSymbolSelect(symbol)}
                      contextMenuItems={getContextMenuItems(symbol)}
                      showAsk={showAsk}
                      showSpread={showSpread}
                      showDaily={showDaily}
                      symbolUniverse={authorizedSymbols}
                      rowRef={(node) => {
                        if (node) {
                          rowRefs.current.set(symbol, node);
                        } else {
                          rowRefs.current.delete(symbol);
                        }
                      }}
                    />
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Footer: add symbol hint ──────────────────────────── */}
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
          <span className="rtx-market-watch__footer-count" style={{ fontSize: 9, color: '#36363e' }}>{rows.length} symbols</span>
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
      </div>
    </>
  );
};

export default MarketWatchPanel;
