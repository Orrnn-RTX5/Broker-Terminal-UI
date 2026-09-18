import { useUiTranslation } from '../../hooks/useUiTranslation';
import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { resolveTickFromLookup, selectTickCount, useAppStore, useTick } from '../../store/useAppStore';
import { useWatchlistStore } from '../../store/useWatchlistStore';
import { ContextMenu, type ContextMenuItemConfig } from '../ui/ContextMenu';
import { Icon } from '../ui/Icon';
import { PriceDisplay } from '../ui/PriceDisplay';
import { SymbolSpecificationDialog } from '../dialogs/SymbolSpecificationDialog';
import {
  useActiveMarketSymbols,
  useLiveQuotes,
  useMarketInstruments,
  useRemoteWatchlistSync,
  type MarketInstrumentsSnapshot,
} from '../../hooks/useLiveMarketData';
import { useBrokerAccountSessionScope } from '../../hooks/useBrokerAccountSessionScope';
import { useClosedMarketDailyChanges } from '../../hooks/useClosedMarketDailyChanges';
import { useVisibleSymbolRows } from '../../hooks/useVisibleSymbolRows';
import {
  getHiddenSymbols,
  hideSymbol as persistHiddenSymbol,
  hideSymbols as persistHiddenSymbols,
  showAllSymbols as clearHiddenSymbols,
  showSymbol as restoreHiddenSymbol,
} from '../../services/marketWatchActions';
import { MARKET_WATCH_PROFILE_RESTORED_EVENT } from '../../services/localWorkspaceProfiles';
import { getInstrumentSymbolName, getUniqueSymbolNames } from '../../utils/symbolEligibility';
import { getFallbackSymbolDescription } from '../../utils/symbolDescription';
import {
  buildMarketWatchSymbolGroups,
  resolveMarketWatchSymbolGroup,
  selectDefaultMarketWatchSymbols,
} from '../../utils/marketWatchGroups';
import { useDockLayoutStore } from '../../store/useDockLayoutStore';
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

const readFiniteDailyChange = (value: unknown): number | null => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const TWO_DECIMAL_MARKET_WATCH_SYMBOLS = new Set([
  'JPN225',
  'JPN225-F',
  'WHEAT',
  'GOLD-PERP',
  'NICKEL',
  'COCOA',
  'MAERSKB.DK',
  'COFFEE',
  'SPA35-F',
]);

const getMarketWatchPriceDigits = (symbol: string): number | undefined => (
  TWO_DECIMAL_MARKET_WATCH_SYMBOLS.has(normalizeSymbol(symbol)) ? 2 : undefined
);

const uniqueSymbols = (symbols: unknown[]): string[] =>
  Array.from(new Set(symbols.map(normalizeSymbol).filter(Boolean)));

const findMarketWatchPanelId = (node: unknown): string | null => {
  if (!node || typeof node !== 'object') return null;
  const record = node as { id?: string; component?: string; children?: unknown[] };
  if (record.component === 'MarketWatch' && record.id) return record.id;
  if (!Array.isArray(record.children)) return null;
  for (const child of record.children) {
    const nestedId = findMarketWatchPanelId(child);
    if (nestedId) return nestedId;
  }
  return null;
};

const closeMarketWatchDockPanel = (): void => {
  const { layout, removePanel } = useDockLayoutStore.getState();
  const panelId = findMarketWatchPanelId(layout.root)
    ?? layout.floatingPanels.map((panel) => findMarketWatchPanelId(panel)).find(Boolean)
    ?? null;
  if (panelId) removePanel(panelId);
};

const SYMBOL_GROUP_ROW_HEIGHT = 36;
const SYMBOL_EXPLORER_ROW_HEIGHT = 48;
const SYMBOL_EXPLORER_OVERSCAN = 6;
const SYMBOL_EXPLORER_FALLBACK_HEIGHT = 288;
const MARKET_WATCH_QUOTE_UP_COLOR = '#4597ff';
const MARKET_WATCH_QUOTE_DOWN_COLOR = '#ff5858';

const readInstrumentDescription = (value: unknown, symbol: string): string => {
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  const hasExplicitSymbol = Boolean(String(record.symbol ?? record.id ?? '').trim());
  const candidates = [
    record.description,
    record.display_name,
    record.displayName,
    record.full_name,
    record.fullName,
    hasExplicitSymbol ? record.name : undefined,
  ];
  for (const candidate of candidates) {
    const description = String(candidate ?? '').trim();
    if (description && normalizeSymbol(description) !== normalizeSymbol(symbol)) return description;
  }
  return '';
};

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
  showDailyChange: boolean;
  closedDailyChange?: number | null;
  symbolUniverse: readonly string[];
  rowRef?: (node: HTMLTableRowElement | null) => void;
}> = ({ symbol, isSelected, isLive, isAvailable, isStatusLoading, isStatusSettled, isStatusCurrent, isCatalogLoading, isChartOpenable, now, onClick, contextMenuItems, showAsk, showDailyChange, closedDailyChange, symbolUniverse, rowRef }) => {
    const tr = useUiTranslation();
  const displaySymbol = getMarketWatchSymbolLabel(symbol, symbolUniverse);
  const cachedTick = useTick(symbol);
  const tick = cachedTick;
  const priceDigits = getMarketWatchPriceDigits(symbol);
  const bidDirection = tick?.bidDirection ?? 'none';
  const askDirection = tick?.askDirection ?? 'none';
  const bid = tick?.bid ?? 0;
  const ask = tick?.ask ?? 0;
  // The current quote remains authoritative. Closed-market history is only a
  // display fallback when the broker no longer publishes Daily Change.
  const dailyPct = readFiniteDailyChange(tick?.dailyChange)
    ?? readFiniteDailyChange(closedDailyChange);

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
  const quoteDataOpacity = isLive ? 1 : hasData ? 0.72 : 0.45;
  const dailyDataOpacity = isLive ? 1 : hasDailyData ? 0.72 : 0.45;

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
        tabIndex={isSelected ? 0 : -1}
        onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); onClick(); }}
        style={{
          height: 36,
          cursor: 'pointer',
          borderBottom: 'none',
          background: isSelected ? 'var(--bg-quaternary)' : 'var(--bg-secondary)',
          transition: 'background 0.15s ease',
          boxShadow: isSelected ? 'inset 2px 0 0 #60a5fa' : 'none',
        }}
        className={`${!isSelected ? 'mw-row ' : ''}rtx-market-watch__row${isSelected ? ' rtx-market-watch__row--selected' : ''}${!isLive ? ' rtx-market-watch__row--stale' : ''}`}
        aria-selected={isSelected}
        aria-disabled={!isChartOpenable}
        title={!isChartOpenable ? tr("{{value0}} chart is currently unavailable", { value0: displaySymbol }) : undefined}
      >
        {/* Symbol */}
        <td style={{ padding: '3px 8px', whiteSpace: 'nowrap', maxWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 4, minWidth: 0 }}>
            {/* Direction arrow */}
            {hasData && bidDirection === 'up' && (
              <svg className="rtx-market-watch__direction rtx-market-watch__direction--up" width="7" height="7" viewBox="0 0 7 7" fill="none" style={{ flexShrink: 0, color: '#4ade80', opacity: quoteDataOpacity }}>
                <path d="M3.5 1L6.5 6H0.5L3.5 1Z" fill="currentColor" />
              </svg>
            )}
            {hasData && bidDirection === 'down' && (
              <svg className="rtx-market-watch__direction rtx-market-watch__direction--down" width="7" height="7" viewBox="0 0 7 7" fill="none" style={{ flexShrink: 0, color: '#f87171', opacity: quoteDataOpacity }}>
                <path d="M3.5 6L0.5 1H6.5L3.5 6Z" fill="currentColor" />
              </svg>
            )}
            {(!hasData || bidDirection === 'none') && (
              <span style={{ width: 7, flexShrink: 0, display: 'inline-block' }} />
            )}
            <span aria-label={displaySymbol} className="rtx-market-watch__symbol" style={{
              flexShrink: 0,
              maxWidth: 'calc(100% - 11px)',
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--text-primary)',
              letterSpacing: 'normal',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {displaySymbol}
            </span>
            {statusLabel && statusLabel !== 'STALE' && statusLabel !== 'LOADING' && (
              <span
                className="rtx-market-watch__status"
                aria-label={`${displaySymbol} ${statusLabel.toLowerCase()}${quoteAge ? `, last quote ${quoteAge} ago` : ''}`}
                title={`${displaySymbol} ${statusLabel.toLowerCase()}${quoteAge ? `, last quote ${quoteAge} ago` : ''}`}
                style={{
                  flexShrink: 0,
                  flexBasis: '100%',
                  marginLeft: 11,
                  fontSize: 10,
                  fontWeight: 400,
                  color: '#6b6b73',
                  letterSpacing: '0.04em',
                }}
              />
            )}
          </div>
        </td>

        {/* Bid — most important: bright, large, tabular */}
        <td style={{ padding: '3px 4px', textAlign: 'center', opacity: hasData ? 1 : quoteDataOpacity }}>
          <span className={`rtx-market-watch__price rtx-market-watch__price--bid${bidPriceDirection ? ` rtx-market-watch__price--${bidPriceDirection}` : ''}${!hasData ? ' rtx-market-watch__price--empty' : ''}`} style={{
            display: 'inline-block',
            fontSize: 13,
            fontWeight: 500,
            color: hasData
              ? bidPriceDirection === 'up' ? MARKET_WATCH_QUOTE_UP_COLOR
                : MARKET_WATCH_QUOTE_DOWN_COLOR
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
          <td style={{ padding: '3px 4px', textAlign: 'center', opacity: hasData ? 1 : quoteDataOpacity }}>
            <span className={`rtx-market-watch__price rtx-market-watch__price--ask${askPriceDirection ? ` rtx-market-watch__price--${askPriceDirection}` : ''}${!hasData ? ' rtx-market-watch__price--empty' : ''}`} style={{
              display: 'inline-block',
              fontSize: 13,
              fontWeight: 500,
              color: hasData
                ? askPriceDirection === 'down' ? MARKET_WATCH_QUOTE_DOWN_COLOR
                  : MARKET_WATCH_QUOTE_UP_COLOR
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

        {/* MetaTrader-style Daily Change follows Ask without changing its session-close semantics. */}
        {showDailyChange && (
          <td style={{ padding: '3px 4px', textAlign: 'center', opacity: hasDailyData ? 1 : dailyDataOpacity }}>
            <span className={`rtx-market-watch__daily${!hasDailyData ? ' rtx-market-watch__daily--empty' : ''}${dailyPositive ? ' rtx-market-watch__daily--up' : ''}${dailyNegative ? ' rtx-market-watch__daily--down' : ''}`} style={{
              fontSize: 13,
              fontWeight: 500,
              color: !hasDailyData
                ? '#50505a'
                : dailyPositive
                  ? MARKET_WATCH_QUOTE_UP_COLOR
                  : dailyNegative
                    ? MARKET_WATCH_QUOTE_DOWN_COLOR
                    : 'var(--text-primary)',
              letterSpacing: 'normal',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {hasDailyData ? `${dailyPct!.toFixed(2)}%` : <span style={{ color: '#50505a' }}>—</span>
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
    const tr = useUiTranslation();
    // This panel only needs to know whether any quote exists. Subscribing to the
    // complete tick map redrew the entire panel for every freshness timestamp.
    const liveTickCount = useAppStore(selectTickCount);
    const isAuthenticated = useAppStore((state) => state.isAuthenticated);
    const brokerAccountScopeKey = useBrokerAccountSessionScope();
    const brokerAccountScopeParts = brokerAccountScopeKey.split('|');
    const dailyChangeScopeKey = isAuthenticated
      && brokerAccountScopeParts[0] === 'authenticated'
      && Boolean(brokerAccountScopeParts[1])
      ? brokerAccountScopeKey
      : null;
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
    const [hiddenSymbols, setHiddenSymbols] = useState<string[]>(() => getHiddenSymbols());
    const [specificationSymbol, setSpecificationSymbol] = useState<string | null>(null);
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
      const handleWorkspaceMarketWatchRestore = (event: Event) => {
        setHiddenSymbols(getHiddenSymbols());
        const detail = (event as CustomEvent<{ options?: { showGrid?: boolean } }>).detail;
        if (typeof detail?.options?.showGrid === 'boolean') {
          setShowGrid(detail.options.showGrid);
        }
      };

      window.addEventListener(MARKET_WATCH_PROFILE_RESTORED_EVENT, handleWorkspaceMarketWatchRestore);
      return () => window.removeEventListener(MARKET_WATCH_PROFILE_RESTORED_EVENT, handleWorkspaceMarketWatchRestore);
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

    const showAsk = panelWidth >= 220;
    // Keep Daily Change at the breakpoint requested for the previous replacement.
    const showDailyChange = panelWidth >= 300;

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
    const hiddenSymbolSet = useMemo(() => new Set(uniqueSymbols(hiddenSymbols)), [hiddenSymbols]);
    const rows = useMemo(() => uniqueSymbols([
      ...(shouldMergePersistedSymbols ? persistedSymbols : defaultSymbols),
      ...activeManualSymbols,
    ]).filter((symbol) => shouldMergePersistedSymbols || !hiddenSymbolSet.has(symbol)), [
      activeManualSymbols,
      defaultSymbols,
      hiddenSymbolSet,
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
    const symbolDescriptionByName = useMemo(() => {
      const descriptions = new Map<string, string>();
      for (const instrument of [...marketInstruments, ...allSymbols]) {
        const instrumentSymbol = getInstrumentSymbolName(instrument);
        const description = readInstrumentDescription(instrument, instrumentSymbol);
        if (
          instrumentSymbol
          && description
          && !descriptions.has(instrumentSymbol)
        ) {
          descriptions.set(instrumentSymbol, description);
        }
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
      symbolGroups.forEach((group) => {
        group.symbols.forEach((symbol) => groupsBySymbol.set(symbol, group.key));
      });
      return groupsBySymbol;
    }, [symbolGroups]);
    const utcDay = new Date().getUTCDay();
    const isTraditionalMarketWeekend = utcDay === 0 || utcDay === 6;
    const canIdentifyClosedSymbols = activeSymbolsSettled && activeSymbolsCurrent;
    const closedDailyChangeSymbols = useMemo(() => {
      if (!dailyChangeScopeKey || (!canIdentifyClosedSymbols && !isTraditionalMarketWeekend)) return [];
      // Re-evaluate after the initial REST quote batch populates the tick store.
      void liveTickCount;

      return visibleRowSymbols.filter((symbol) => {
        if (canIdentifyClosedSymbols && activeSymbolSet.has(symbol)) return false;
        if (readFiniteDailyChange(getTickSnapshot(symbol)?.dailyChange) !== null) return false;
        const groupKey = symbolGroupKeyByName.get(symbol)
          ?? resolveMarketWatchSymbolGroup(symbol).key;
        return groupKey !== 'crypto';
      });
    }, [
      activeSymbolSet,
      canIdentifyClosedSymbols,
      dailyChangeScopeKey,
      isTraditionalMarketWeekend,
      liveTickCount,
      symbolGroupKeyByName,
      visibleRowSymbols,
    ]);
    const closedDailyChanges = useClosedMarketDailyChanges({
      enabled: Boolean(dailyChangeScopeKey)
        && (canIdentifyClosedSymbols || isTraditionalMarketWeekend),
      scopeKey: dailyChangeScopeKey,
      symbols: closedDailyChangeSymbols,
    });
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
    // Demand follows the rows actually rendered. Filtering by the locally loaded
    // catalog subset would leave rows unsubscribed until the catalog hydrates
    // (and would drop custom-watchlist rows the local catalog does not list);
    // the server confirms or rejects each symbol individually instead.
    const subscriptionSymbols = visibleRowSymbols;

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
      if (!shouldMergePersistedSymbols && hiddenSymbolSet.has(next)) {
        setHiddenSymbols(restoreHiddenSymbol(next));
      }
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

      // The shared selection callback owns chart navigation for rows and search.
      // Do not dispatch a second request that could open or select another pane.
    }, [
      activeWatchlist,
      hiddenSymbolSet,
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

      const watchlistId = activeWatchlist?.id ?? '';
      setManualSymbols((current) => ({
        watchlistId,
        symbols: current.watchlistId === watchlistId
          ? current.symbols.filter((item) => normalizeSymbol(item) !== next)
          : [],
      }));

      if (!shouldMergePersistedSymbols) {
        setHiddenSymbols(persistHiddenSymbol(next));
      } else if (activeWatchlist) {
        const persistedSymbol = activeWatchlist.symbols.find((item) => (
          (resolveMarketWatchSymbolInput(authorizedSymbols, item) ?? normalizeSymbol(item)) === next
        )) ?? next;
        useWatchlistStore.getState().removeSymbolFromWatchlist(activeWatchlist.id, persistedSymbol);
      }
    }, [
      activeWatchlist,
      authorizedSymbols,
      shouldMergePersistedSymbols,
    ]);

    const handleHideAll = useCallback(() => {
      const watchlistId = activeWatchlist?.id ?? '';
      setManualSymbols({ watchlistId, symbols: [] });
      if (!shouldMergePersistedSymbols) {
        setHiddenSymbols(persistHiddenSymbols(rows));
      } else if (activeWatchlist) {
        useWatchlistStore.getState().reorderSymbols(activeWatchlist.id, []);
      }
    }, [activeWatchlist, rows, shouldMergePersistedSymbols]);

    const handleShowAll = useCallback(() => {
      const watchlistId = activeWatchlist?.id ?? '';
      setManualSymbols({ watchlistId, symbols: [...quoteEligibleSymbols] });
      if (!shouldMergePersistedSymbols) {
        clearHiddenSymbols();
        setHiddenSymbols([]);
      } else if (activeWatchlist) {
        useWatchlistStore.getState().reorderSymbols(activeWatchlist.id, quoteEligibleSymbols);
      }
    }, [activeWatchlist, quoteEligibleSymbols, shouldMergePersistedSymbols]);

    const handleExport = useCallback(() => {
      const data = rows.map(sym => {
        const tick = getTickSnapshot(sym);
        const dailyChange = readFiniteDailyChange(tick?.dailyChange)
          ?? readFiniteDailyChange(closedDailyChanges.get(sym));
        const dailyChangeDisplay = dailyChange !== null
          ? `${dailyChange.toFixed(2)}%`
          : '-';
        return `${sym}\t${tick?.bid ?? '-'}\t${tick?.ask ?? '-'}\t${dailyChangeDisplay}`;
      }).join('\n');
      navigator.clipboard.writeText(`Symbol\tBid\tAsk\tDaily Change\n${data}`);
    }, [closedDailyChanges, rows]);

    const getContextMenuItems = useCallback((symbol: string): ContextMenuItemConfig[] => {
      const tradeDisabled = !actionableSymbolSet.has(symbol);
      const chartDisabled = !chartOpenableSymbolSet.has(symbol);
      return [
        {
          label: 'New Order',
          icon: <Icon name="new-order" size="xs" />,
          shortcut: 'F9',
          disabled: tradeDisabled,
          action: () => {
            window.dispatchEvent(new CustomEvent('openOrderDialog', { detail: { symbol } }));
          },
        },
        {
          label: 'Chart Window',
          icon: <Icon name="new-chart" size="xs" />,
          disabled: chartDisabled,
          action: () => {
            window.dispatchEvent(new CustomEvent('openChart', { detail: { symbol } }));
          },
        },
        {
          label: 'Depth Of Market',
          icon: <Icon name="grid-3x3" size="xs" />,
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
            setSpecificationSymbol(symbol);
          },
        },
        { divider: true },
        {
          label: 'Hide',
          icon: <Icon name="eye-off" size="xs" />,
          shortcut: 'Delete',
          action: () => handleHideSymbol(symbol),
        },
        {
          label: 'Hide All',
          icon: <Icon name="x-close" size="xs" />,
          action: handleHideAll,
        },
        {
          label: 'Show All',
          icon: <Icon name="eye" size="xs" />,
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
          icon: <Icon name="export" size="xs" />,
          action: handleExport,
        },
        { divider: true },
        {
          label: 'Grid',
          icon: <Icon name="grid-3x3" size="xs" />,
          checked: showGrid,
          action: () => setShowGrid(!showGrid),
          autoClose: false,
        },
      ];
    }, [
      actionableSymbolSet,
      chartOpenableSymbolSet,
      handleExport,
      handleHideAll,
      handleHideSymbol,
      handleShowAll,
      showGrid,
    ]);

    const specificationInstrument = useMemo(() => {
      if (!specificationSymbol) return undefined;
      const matchingInstruments = allSymbols.filter((instrument) => (
        getInstrumentSymbolName(instrument) === specificationSymbol
      ));
      return matchingInstruments.find((instrument) => (
        instrument !== null && typeof instrument === 'object'
      )) ?? matchingInstruments[0];
    }, [allSymbols, specificationSymbol]);
    const specificationFallbackInstrument = useMemo(() => {
      if (!specificationSymbol) return undefined;
      return marketInstruments.find((instrument) => (
        getInstrumentSymbolName(instrument) === specificationSymbol
      ));
    }, [marketInstruments, specificationSymbol]);

    const isSymbolListLoading = isLoadingSymbols || watchlistLoading || (searchUniverse.length === 0 && activeSymbolsLoading);

    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (shouldIgnoreShortcutEvent(e) || isShortcutInput(e) || isShortcutLocalScope(e) || isShortcutOverlay(e)) return;
        if (!containerRef.current?.contains(getShortcutEventTarget(e))) return;
        // The global manager owns these commands. This scoped fallback serves
        // a standalone Market Watch only when the event was not already used.
        if (e.key === 'F9' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
          e.preventDefault();
          if (actionableSymbolSet.has(normalizeSymbol(selectedSymbol))) {
            window.dispatchEvent(new CustomEvent('openNewOrder'));
          }
        }
        if (e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey && e.key.toLowerCase() === 'b') {
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

    const handleSearchBarClose = useCallback(() => {
      if (showSymbolsPanel) {
        closeSymbolExplorer();
        inputRef.current?.blur();
        return;
      }
      closeMarketWatchDockPanel();
    }, [closeSymbolExplorer, showSymbolsPanel]);

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
        .rtx-market-watch .rtx-market-watch__price .price-big { font-size: inherit !important; font-weight: inherit !important; }
        .rtx-market-watch .rtx-market-watch__column-heading--symbol { color: var(--text-primary) !important; }
        .rtx-market-watch .mw-input::placeholder { color: var(--text-primary); opacity: 1; }
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
          onKeyDown={(event) => {
            if (event.key !== 'Delete' || event.ctrlKey || event.altKey || event.shiftKey || event.metaKey || !selectedSymbol) return;
            if (shouldIgnoreShortcutEvent(event.nativeEvent) || isShortcutInput(event.nativeEvent) || isShortcutLocalScope(event.nativeEvent) || isShortcutOverlay(event.nativeEvent)) return;
            // Handle the focused row before document-level drawing deletion.
            event.preventDefault();
            event.stopPropagation();
            handleHideSymbol(selectedSymbol);
          }}
          className={`rtx-market-watch ${className ?? ''}`}
          style={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            background: 'var(--bg-secondary)',
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
              background: 'var(--bg-secondary)',
            }}
          >
            <div
              className="rtx-market-watch__search-bar"
              style={{ position: 'relative', height: 42, flexShrink: 0 }}
            >
              <Icon
                name="search"
                size={20}
                style={{
                  position: 'absolute',
                  left: 13,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--text-primary)',
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
                  padding: '0 42px 0 42px',
                  fontSize: 14,
                  fontWeight: 400,
                  color: 'var(--text-primary)',
                  outline: 'none',
                  fontFamily: 'inherit',
                }}
                aria-label={tr("Add symbol")}
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={showSymbolsPanel}
                aria-controls={showSymbolsPanel ? searchListboxId : undefined}
                aria-activedescendant={activeSearchOptionId}
                autoComplete="off"
                placeholder={tr("Search symbol")}
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                onFocus={() => setShowSymbolsPanel(true)}
              />
              <button
                type="button"
                aria-label={showSymbolsPanel ? tr("Close symbol search") : tr("Close Market Watch")}
                title={showSymbolsPanel ? tr("Close symbol search") : tr("Close")}
                onMouseDown={(event) => event.preventDefault()}
                onClick={handleSearchBarClose}
                className="rtx-market-watch__close"
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
                    {tr("Loading symbols…")}</div>
                ) : showingSymbolGroups ? (
                  <div
                    id={searchListboxId}
                    role="listbox"
                    aria-label={tr("Symbol groups")}
                    className="rtx-market-watch__group-list mw-scrollbar"
                    style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}
                  >
                    {symbolGroups.length === 0 ? (
                      <div style={{ padding: '12px 13px', fontSize: 12, color: 'var(--text-tertiary)' }}>
                        {tr("No symbols available")}</div>
                    ) : symbolGroups.map((group, index) => (
                      <button
                        key={group.key}
                        id={`${searchListboxId}-option-${index}`}
                        type="button"
                        role="option"
                        aria-selected={index === highlightIndex}
                        aria-label={tr("{{value0}} {{value1}} of {{value2}}", { value0: group.label, value1: group.visibleCount, value2: group.symbols.length })}
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseEnter={() => setHighlightIndex(index)}
                        onClick={() => {
                          setSelectedSymbolGroupKey(group.key);
                          setHighlightIndex(0);
                        }}
                        className="rtx-market-watch__explorer-option rtx-market-watch__group-option"
                        style={{
                          width: '100%',
                          height: SYMBOL_GROUP_ROW_HEIGHT,
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
                          {tr(group.label)}
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
                        aria-label={tr("Back to symbol groups")}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          setSelectedSymbolGroupKey(null);
                          setHighlightIndex(-1);
                        }}
                        style={{
                          height: SYMBOL_GROUP_ROW_HEIGHT,
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
                      aria-label={search.trim() ? tr("Symbol search results") : tr("{{value0}} symbols", { value0: selectedSymbolGroup?.label ?? '' })}
                      data-testid="market-watch-symbol-scroll"
                      onScroll={handleSymbolExplorerScroll}
                      className="rtx-market-watch__symbol-list mw-scrollbar"
                      style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain' }}
                    >
                      {filteredSymbols.length === 0 ? (
                        <div style={{ padding: '12px 13px', fontSize: 12, color: 'var(--text-tertiary)' }}>
                          {search.trim() ? tr("No matches found") : tr("No symbols in this group")}
                        </div>
                      ) : (
                        <>
                          {symbolExplorerWindow.topSpacerHeight > 0 && (
                            <div aria-hidden="true" style={{ height: symbolExplorerWindow.topSpacerHeight }} />
                          )}
                          {renderedExplorerSymbols.map((symbol, visibleIndex) => {
                            const absoluteIndex = symbolExplorerWindow.startIndex + visibleIndex;
                            const displaySymbol = getMarketWatchSymbolLabel(symbol, searchUniverse);
                            const symbolDescription = symbolDescriptionByName.get(normalizeSymbol(symbol))
                              ?? getFallbackSymbolDescription(symbol);
                            const isSubscribed = marketWatchSymbolSet.has(symbol);
                            return (
                              <button
                                key={symbol}
                                id={`${searchListboxId}-option-${absoluteIndex}`}
                                type="button"
                                role="option"
                                aria-selected={absoluteIndex === highlightIndex}
                                aria-disabled={false}
                                aria-label={symbolDescription ? `${displaySymbol}, ${symbolDescription}` : displaySymbol}
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
                                  className="rtx-market-watch__symbol-copy"
                                  style={{ minWidth: 0, display: 'flex', flex: 1, flexDirection: 'column', justifyContent: 'center', overflow: 'hidden' }}
                                >
                                  <span
                                    className="rtx-market-watch__symbol"
                                    style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: '17px' }}
                                  >
                                    {displaySymbol}
                                  </span>
                                  {symbolDescription && (
                                    <span
                                      className="rtx-market-watch__symbol-description"
                                      title={symbolDescription}
                                      style={{
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                        color: 'var(--text-secondary)',
                                        fontSize: 11,
                                        fontWeight: 400,
                                        lineHeight: '14px',
                                      }}
                                    >
                                      {symbolDescription}
                                    </span>
                                  )}
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
                                    {tr("Subscribed")}</span>
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
                    {isSymbolListLoading ? tr("Loading symbols...") : tr("No live symbols")}
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
                      {tr("Show all symbols")}</button>
                  )}
                </div>
              ) : (
                <table className="rtx-market-watch__grid" style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                  <colgroup>
                    <col />
                    <col style={{ width: panelWidth < 300 ? '45%' : '22%' }} />
                    {showAsk && <col style={{ width: '22%' }} />}
                    {showDailyChange && <col style={{ width: 108 }} />}
                  </colgroup>
                  <thead>
                    <tr style={{ borderBottom: 'none' }}>
                      <th className="rtx-market-watch__column-heading rtx-market-watch__column-heading--symbol" style={{ textAlign: 'left', padding: '3px 8px 3px 19px', fontSize: 12, fontWeight: 500, lineHeight: '16px', color: 'var(--text-primary)', letterSpacing: 'normal', background: 'transparent', position: 'sticky', top: 0, zIndex: 10, textTransform: 'uppercase' as const, whiteSpace: 'nowrap' }}>{tr("Symbol")}</th>
                      <th className="rtx-market-watch__column-heading" style={{ textAlign: 'center', padding: '3px 4px', fontSize: 12, fontWeight: 500, lineHeight: '16px', color: 'var(--text-primary)', letterSpacing: 'normal', background: 'transparent', position: 'sticky', top: 0, zIndex: 10, textTransform: 'uppercase' as const, whiteSpace: 'nowrap' }}>{tr("Bid")}</th>
                      {showAsk && <th className="rtx-market-watch__column-heading" style={{ textAlign: 'center', padding: '3px 4px', fontSize: 12, fontWeight: 500, lineHeight: '16px', color: 'var(--text-primary)', letterSpacing: 'normal', background: 'transparent', position: 'sticky', top: 0, zIndex: 10, textTransform: 'uppercase' as const, whiteSpace: 'nowrap' }}>{tr("Ask")}</th>}
                      {showDailyChange && <th className="rtx-market-watch__column-heading" style={{ textAlign: 'center', padding: '3px 4px', fontSize: 12, fontWeight: 500, lineHeight: '16px', color: 'var(--text-primary)', letterSpacing: 'normal', background: 'transparent', position: 'sticky', top: 0, zIndex: 10, whiteSpace: 'nowrap' }}>{tr("Daily Change")}</th>}
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
                          showDailyChange={showDailyChange}
                          closedDailyChange={closedDailyChanges.get(symbol)}
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

          {!showSymbolsPanel && (
            <>
              {marketWatchErrors.length > 0 && (
                <div role="alert" aria-label={tr("Market Watch errors")} style={{
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
                  {tr("Loading quotes...")}</div>
              )}
            </>
          )}
        </div>
        <SymbolSpecificationDialog
          isOpen={Boolean(specificationSymbol)}
          symbol={specificationSymbol ?? ''}
          instrument={specificationInstrument}
          fallbackInstrument={specificationFallbackInstrument}
          onClose={() => setSpecificationSymbol(null)}
        />
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
import { getShortcutEventTarget, isShortcutInput, isShortcutLocalScope, isShortcutOverlay, shouldIgnoreShortcutEvent } from '../../services/keyboardShortcutManager';
