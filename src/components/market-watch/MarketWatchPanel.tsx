import { useUiTranslation } from '../../hooks/useUiTranslation';
import { useTerminalStartupReady } from '../../startup/TerminalStartupBoundary';
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useMarketDataStore } from '../../store/useMarketDataStore';
import { useWatchlistStore } from '../../store/useWatchlistStore';
import { createPreloadableFeature } from '../../startup/createPreloadableFeature';
import { RetainedLazyFeature } from '../../startup/RetainedLazyFeature';
import { MarketWatchTickChart, PopupPricesDialog } from './index';
import { MarketWatchSaveSetDialog } from './MarketWatchSaveSetDialog';
import { useMarketWatchExport } from './useMarketWatchExport';
import { useMarketWatchContextMenu, useMarketWatchDetailsContextMenu } from './useMarketWatchContextMenu';
import { useMarketWatchPanelModel } from './useMarketWatchPanelModel';
import { MarketWatchSymbolExplorer } from './MarketWatchSymbolExplorer';
import { MarketWatchGrid } from './MarketWatchGrid';
import { MarketWatchSymbolDetails } from './MarketWatchSymbolDetails';
import { MarketWatchTradingView } from './MarketWatchTradingView';
import { MarketWatchViewTabs } from './MarketWatchViewTabs';
import { MarketWatchServerClock } from '../layout/MarketWatchServerClock';
import './market-watch-desktop.css';
import type { ActiveMarketSymbolsSnapshot } from './marketWatchPanelTypes';
import {
  closeMarketWatchDockPanel,
  findInstrumentBySymbol,
  getBrokerSpecificationSource,
  getPublicSpecificationSource,
  normalizeSymbol,
  uniqueSymbols,
  type MarketWatchViewId,
  type ScopedManualSymbols,
} from './marketWatchPanelModel';
import {
  useActiveMarketSymbols,
  useLiveQuotes,
  useMarketInstruments,
  useRemoteWatchlistSync,
  type MarketInstrumentsSnapshot,
} from '../../hooks/useLiveMarketData';
import { useBrokerAccountSessionScope } from '../../hooks/useBrokerAccountSessionScope';
import {
  getHiddenSymbols,
  hideSymbol as persistHiddenSymbol,
  hideSymbols as persistHiddenSymbols,
  showAllSymbols as clearHiddenSymbols,
  showSymbol as restoreHiddenSymbol,
} from '../../services/marketWatchActions';
import { MARKET_WATCH_PROFILE_RESTORED_EVENT } from '../../services/localWorkspaceProfiles';
import {
  loadMarketWatchColumns,
  MARKET_WATCH_COLUMN_IDS,
  loadMarketWatchOptions,
  loadMarketWatchSavedSets,
  normalizeMarketWatchColumns,
  normalizeMarketWatchOptions,
  saveMarketWatchColumns,
  saveMarketWatchOptions,
  saveMarketWatchSavedSet,
  type MarketWatchColumnId,
  type MarketWatchOptions,
  type MarketWatchSavedSet,
  type MarketWatchSortMode,
} from '../../utils/marketWatchView';
import type { ActionFeedbackNotice } from '../notifications/ActionFeedbackToast';
import {
  getShortcutEventTarget,
  isShortcutInput,
  isShortcutLocalScope,
  isShortcutOverlay,
  shouldIgnoreShortcutEvent,
} from '../../services/keyboardShortcutManager';
import {
  getMarketWatchDisplayErrors,
  resolveMarketWatchSymbolInput,
  searchMarketWatchSymbols,
} from '../../utils/marketWatchSource';

const symbolSpecificationDialogFeature = createPreloadableFeature(() => import('../dialogs/SymbolSpecificationDialog')
  .then(module => ({ default: module.SymbolSpecificationDialog })));
const SymbolSpecificationDialog = symbolSpecificationDialogFeature.Component;

export { MARKET_WATCH_EXPORT_HYDRATION_TIMEOUT_MS } from './marketWatchExportHydration';
export type { ActiveMarketSymbolsSnapshot } from './marketWatchPanelTypes';

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
    const isAuthenticated = useAppStore((state) => state.isAuthenticated);
    const brokerAccountScopeKey = useBrokerAccountSessionScope();
    const brokerAccountScopeParts = brokerAccountScopeKey.split('|');
    const hasAuthenticatedFallbackScope = isAuthenticated
      && brokerAccountScopeParts[0] === 'authenticated'
      && Boolean(brokerAccountScopeParts[1]);
    const hasAnonymousFallbackScope = !isAuthenticated
      && brokerAccountScopeParts[0] === 'anonymous'
      && !brokerAccountScopeParts[1]
      && Boolean(brokerAccountScopeParts[2] || brokerAccountScopeParts[3]);
    const dailyChangeScopeKey = hasAuthenticatedFallbackScope || hasAnonymousFallbackScope
      ? brokerAccountScopeKey
      : null;
    const {
      symbols: marketInstruments,
      authorizedInstruments: authenticatedMarketInstruments = [],
      authorizedSymbols: authenticatedMarketSymbols = [],
      disabledSymbols,
      loading: isLoadingSymbols,
      error: symbolsError,
      accountCatalogStatus,
      loadSymbolSpecification,
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
    const [marketWatchOptions, setMarketWatchOptions] = useState<MarketWatchOptions>(() => loadMarketWatchOptions());
    const [columns, setColumns] = useState<MarketWatchColumnId[]>(() => loadMarketWatchColumns());
    const [sortMode, setSortMode] = useState<MarketWatchSortMode>(null);
    const [savedSets, setSavedSets] = useState<Record<string, MarketWatchSavedSet>>(() => loadMarketWatchSavedSets());
    const [isSaveSetOpen, setIsSaveSetOpen] = useState(false);
    const [saveSetName, setSaveSetName] = useState('');
    const [marketWatchView, setMarketWatchView] = useState<MarketWatchViewId>('symbols');
    const normalizedSelectedSymbol = normalizeSymbol(selectedSymbol);
    const [tickChartSelection, setTickChartSelection] = useState(() => ({
      ownerSymbol: normalizedSelectedSymbol,
      symbol: normalizedSelectedSymbol,
    }));
    const tickChartSymbol = tickChartSelection.ownerSymbol === normalizedSelectedSymbol
      ? tickChartSelection.symbol
      : normalizedSelectedSymbol;
    const setTickChartSymbol = useCallback((symbol: string) => {
      setTickChartSelection({ ownerSymbol: normalizedSelectedSymbol, symbol });
    }, [normalizedSelectedSymbol]);
    const [popupPricesOpen, setPopupPricesOpen] = useState(false);
    const [showSymbolsPanel, setShowSymbolsPanel] = useState(false);
    const [hiddenSymbols, setHiddenSymbols] = useState<string[]>(() => getHiddenSymbols());
    const [specificationSymbol, setSpecificationSymbol] = useState<string | null>(null);
    const [refreshedSpecification, setRefreshedSpecification] = useState<{
      scopeKey: string;
      symbol: string;
      instrument: Readonly<Record<string, unknown>>;
    } | null>(null);
    const [specificationRequestStatus, setSpecificationRequestStatus] = useState<
      'idle' | 'loading' | 'ready' | 'unavailable' | 'error'
    >('idle');
    const [specificationRequestKey, setSpecificationRequestKey] = useState<string | null>(null);
    const [contextSelection, setContextSelection] = useState<{
      activeSymbol: string;
      symbol: string;
    } | null>(null);
    const marketWatchSelectionSymbol = contextSelection?.activeSymbol === normalizedSelectedSymbol
      ? contextSelection.symbol
      : normalizedSelectedSymbol;
    // Details follows the highlighted row until its own symbol box is used.
    const [detailsSelection, setDetailsSelection] = useState<{
      ownerSymbol: string;
      symbol: string;
    } | null>(null);
    const detailsSymbolRequest = marketWatchView !== 'details'
      ? ''
      : detailsSelection?.ownerSymbol === marketWatchSelectionSymbol
        ? detailsSelection.symbol
        : marketWatchSelectionSymbol;
    const [selectedSymbolGroupKey, setSelectedSymbolGroupKey] = useState<string | null>(null);
    const [manualSymbols, setManualSymbols] = useState<ScopedManualSymbols>({
      watchlistId: activeWatchlist?.id ?? '',
      symbols: [],
    });
    const pendingStatusRefreshSymbolRef = useRef<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());
    const searchListboxId = useId();

    useEffect(() => {
      const requestedSymbol = specificationSymbol;
      if (!requestedSymbol) return undefined;
      if (!isAuthenticated || !loadSymbolSpecification) return undefined;

      const controller = new AbortController();
      const requestKey = `${brokerAccountScopeKey}\u0000${requestedSymbol}`;
      void loadSymbolSpecification(requestedSymbol, controller.signal)
        .then((instrument) => {
          if (controller.signal.aborted) return;
          setSpecificationRequestKey(requestKey);
          if (!instrument) {
            setSpecificationRequestStatus('unavailable');
            return;
          }
          setRefreshedSpecification({
            scopeKey: brokerAccountScopeKey,
            symbol: requestedSymbol,
            instrument,
          });
          setSpecificationRequestStatus('ready');
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return;
          setSpecificationRequestKey(requestKey);
          setSpecificationRequestStatus('error');
        });

      return () => controller.abort();
    }, [
      brokerAccountScopeKey,
      isAuthenticated,
      loadSymbolSpecification,
      specificationSymbol,
    ]);

    useEffect(() => {
      const handleWorkspaceMarketWatchRestore = (event: Event) => {
        setHiddenSymbols(getHiddenSymbols());
        const detail = (event as CustomEvent<{ options?: unknown; columns?: unknown }>).detail;
        if (detail?.options) setMarketWatchOptions(normalizeMarketWatchOptions(detail.options));
        if (detail?.columns) setColumns(normalizeMarketWatchColumns(detail.columns));
        setSavedSets(loadMarketWatchSavedSets());
      };

      window.addEventListener(MARKET_WATCH_PROFILE_RESTORED_EVENT, handleWorkspaceMarketWatchRestore);
      return () => window.removeEventListener(MARKET_WATCH_PROFILE_RESTORED_EVENT, handleWorkspaceMarketWatchRestore);
    }, []);

    useEffect(() => saveMarketWatchOptions(marketWatchOptions), [marketWatchOptions]);
    useEffect(() => saveMarketWatchColumns(columns), [columns]);

    const displayedColumns = useMemo(() => MARKET_WATCH_COLUMN_IDS.filter(column => columns.includes(column)), [columns]);

    const {
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
    } = useMarketWatchPanelModel({
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
    });
    // Keep every symbol in the active watchlist subscribed, including rows that
    // are currently outside the scroll viewport. Visibility still scopes the
    // historical fallback requests below, but it must not suppress live ticks
    // for a symbol the user has explicitly added.
    const subscriptionSymbols = rows;

    const filteredSymbols = useMemo(() => {
      if (search.trim()) {
        return searchMarketWatchSymbols(searchUniverse, search, Math.max(1, searchUniverse.length));
      }
      return selectedGroupSymbols;
    }, [search, searchUniverse, selectedGroupSymbols]);
    const showingSymbolGroups = showSymbolsPanel && !search.trim() && !selectedSymbolGroup;
    const explorerOptionCount = showingSymbolGroups ? symbolGroups.length : filteredSymbols.length;
    const scrollSymbolIntoView = useCallback((symbol: string) => {
      window.requestAnimationFrame(() => {
        rowRefs.current.get(symbol)?.scrollIntoView({ block: 'center' });
      });
    }, [rowRefs]);

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
        pendingStatusRefreshSymbolRef.current = next;
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
      setTickChartSymbol(next);
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
      setTickChartSymbol,
      shouldMergePersistedSymbols,
    ]);

    const publishMarketWatchFeedback = useCallback((
      message: string,
      type: 'success' | 'error' = 'success',
      notice?: ActionFeedbackNotice,
    ) => {
      window.dispatchEvent(new CustomEvent('rtx:order-feedback', { detail: { message, notice, type } }));
    }, []);

    const handleHideSymbol = useCallback((symbol: string) => {
      const next = normalizeSymbol(symbol);
      if (!next) return;
      if (protectedSymbolSet.has(next)) {
        publishMarketWatchFeedback(
          tr('{{value0}} cannot be hidden while it has an open chart, position, or order', { value0: next }),
          'error',
        );
        return;
      }

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
      useMarketDataStore.getState().clearTickBuffer(next);
    }, [
      activeWatchlist,
      authorizedSymbols,
      protectedSymbolSet,
      publishMarketWatchFeedback,
      shouldMergePersistedSymbols,
      tr,
    ]);

    const handleHideAll = useCallback(() => {
      const watchlistId = activeWatchlist?.id ?? '';
      const retained = rows.filter((symbol) => protectedSymbolSet.has(symbol));
      const hideable = rows.filter((symbol) => !protectedSymbolSet.has(symbol));
      setManualSymbols({ watchlistId, symbols: retained });
      if (!shouldMergePersistedSymbols) {
        setHiddenSymbols(persistHiddenSymbols(hideable));
      } else if (activeWatchlist) {
        useWatchlistStore.getState().reorderSymbols(activeWatchlist.id, retained);
      }
      if (retained.length > 0) {
        publishMarketWatchFeedback(
          tr('{{value0}} in-use symbols were kept visible', { value0: retained.length }),
          'success',
        );
      }
      hideable.forEach((symbol) => useMarketDataStore.getState().clearTickBuffer(symbol));
    }, [activeWatchlist, protectedSymbolSet, publishMarketWatchFeedback, rows, shouldMergePersistedSymbols, tr]);

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

    const applySymbolSet = useCallback((set: MarketWatchSavedSet) => {
      const requestedSymbols = uniqueSymbols(set.symbols)
        .map((symbol) => resolveMarketWatchSymbolInput(quoteEligibleSymbols, symbol) ?? '')
        .filter(Boolean);
      const retainedProtected = rows.filter((symbol) => protectedSymbolSet.has(symbol));
      const nextSymbols = uniqueSymbols([...requestedSymbols, ...retainedProtected]);
      const nextSymbolSet = new Set(nextSymbols);
      rows
        .filter((symbol) => !nextSymbolSet.has(symbol))
        .forEach((symbol) => useMarketDataStore.getState().clearTickBuffer(symbol));
      const watchlistId = activeWatchlist?.id ?? '';
      setManualSymbols({ watchlistId, symbols: nextSymbols });
      setColumns(normalizeMarketWatchColumns(set.columns));
      setMarketWatchView('symbols');
      if (shouldMergePersistedSymbols && activeWatchlist) {
        useWatchlistStore.getState().reorderSymbols(activeWatchlist.id, nextSymbols);
      } else {
        clearHiddenSymbols();
        const nextSet = new Set(nextSymbols);
        setHiddenSymbols(persistHiddenSymbols(quoteEligibleSymbols.filter((symbol) => !nextSet.has(symbol))));
      }
    }, [activeWatchlist, protectedSymbolSet, quoteEligibleSymbols, rows, shouldMergePersistedSymbols]);

    const handleSaveSet = useCallback(() => {
      const normalizedName = saveSetName.trim();
      if (!normalizedName) return;
      setSavedSets(saveMarketWatchSavedSet(normalizedName, rows, columns));
      setIsSaveSetOpen(false);
      setSaveSetName('');
      publishMarketWatchFeedback(tr('Market Watch set saved: {{value0}}', { value0: normalizedName }));
    }, [columns, publishMarketWatchFeedback, rows, saveSetName, tr]);

    const toggleColumn = useCallback((column: MarketWatchColumnId | 'highLow') => {
      setColumns((current) => {
        const currentSet = new Set(current);
        const targets: MarketWatchColumnId[] = column === 'highLow' ? ['high', 'low'] : [column];
        const shouldRemove = targets.some((target) => currentSet.has(target));
        targets.forEach((target) => {
          if (target === 'symbol' || target === 'bid') return;
          if (shouldRemove) currentSet.delete(target);
          else currentSet.add(target);
        });
        return normalizeMarketWatchColumns(Array.from(currentSet));
      });
    }, []);

    const getInstrumentSourcesForSymbol = useCallback((symbol: string): readonly unknown[] => (
      [authenticatedMarketInstruments, marketInstruments, allSymbols]
        .map((catalog) => findInstrumentBySymbol(catalog, symbol))
        .filter((entry) => entry !== undefined)
    ), [allSymbols, authenticatedMarketInstruments, marketInstruments]);

    const handleExport = useMarketWatchExport({
      activeSymbolSet,
      brokerAccountScopeKey,
      canIdentifyClosedSymbols,
      closedDailyChanges,
      dailyChangeScopeKey,
      displayedColumns,
      getInstrumentSources: getInstrumentSourcesForSymbol,
      isTraditionalMarketWeekend,
      lastPrices,
      publishFeedback: publishMarketWatchFeedback,
      rows,
      showMilliseconds: marketWatchOptions.showMilliseconds,
      symbolGroupKeyByName,
      translate: tr,
    });

    const getContextMenuItems = useMarketWatchContextMenu({
      actionableSymbolSet,
      applySymbolSet,
      brokerAccountScopeKey,
      canLoadBrokerSpecification: isAuthenticated && Boolean(loadSymbolSpecification),
      chartOpenableSymbolSet,
      columns,
      handleExport,
      handleHideAll,
      handleHideSymbol,
      handleShowAll,
      marketWatchOptions,
      protectedSymbolSet,
      quoteEligibleSymbolSet,
      rows,
      savedSets,
      setIsSaveSetOpen,
      setMarketWatchOptions,
      setMarketWatchView,
      setPopupPricesOpen,
      setRefreshedSpecification,
      setSavedSets,
      setSaveSetName,
      setShowSymbolsPanel,
      setSortMode,
      setSpecificationRequestKey,
      setSpecificationRequestStatus,
      setSpecificationSymbol,
      setTickChartSymbol,
      sortMetadata,
      sortMode,
      symbolGroupKeyByName,
      symbolGroups,
      toggleColumn,
    });

    const getDetailsContextMenuItems = useMarketWatchDetailsContextMenu({
      actionableSymbolSet,
      brokerAccountScopeKey,
      canLoadBrokerSpecification: isAuthenticated && Boolean(loadSymbolSpecification),
      chartOpenableSymbolSet,
      marketWatchOptions,
      quoteEligibleSymbolSet,
      setMarketWatchOptions,
      setMarketWatchView,
      setRefreshedSpecification,
      setShowSymbolsPanel,
      setSpecificationRequestKey,
      setSpecificationRequestStatus,
      setSpecificationSymbol,
      setTickChartSymbol,
    });

    const specificationAuthorizedInstrument = useMemo(() => (
      specificationSymbol
        ? findInstrumentBySymbol(authenticatedMarketInstruments, specificationSymbol)
        : undefined
    ), [authenticatedMarketInstruments, specificationSymbol]);
    const specificationPublicInstrument = useMemo(() => (
      specificationSymbol ? findInstrumentBySymbol(allSymbols, specificationSymbol) : undefined
    ), [allSymbols, specificationSymbol]);
    const specificationCatalogInstrument = useMemo(() => (
      specificationSymbol ? findInstrumentBySymbol(marketInstruments, specificationSymbol) : undefined
    ), [marketInstruments, specificationSymbol]);
    const refreshedSpecificationInstrument = specificationSymbol
      && refreshedSpecification?.scopeKey === brokerAccountScopeKey
      && refreshedSpecification.symbol === specificationSymbol
      ? refreshedSpecification.instrument
      : undefined;
    const specificationInstrument = useMemo(() => (
      refreshedSpecificationInstrument
        ?? (isAuthenticated && loadSymbolSpecification
          ? undefined
          : specificationAuthorizedInstrument
            ? getBrokerSpecificationSource(specificationAuthorizedInstrument)
            : getPublicSpecificationSource(specificationPublicInstrument ?? specificationCatalogInstrument))
    ), [
      isAuthenticated,
      loadSymbolSpecification,
      refreshedSpecificationInstrument,
      specificationAuthorizedInstrument,
      specificationCatalogInstrument,
      specificationPublicInstrument,
    ]);
    const specificationFallbackInstrument = useMemo(() => {
      const fallback = specificationAuthorizedInstrument
        ? (specificationPublicInstrument ?? specificationCatalogInstrument)
        : (specificationCatalogInstrument ?? specificationPublicInstrument);
      return getPublicSpecificationSource(fallback);
    }, [
      specificationAuthorizedInstrument,
      specificationCatalogInstrument,
      specificationPublicInstrument,
    ]);
    // Backend catalogue rows for a symbol, most authoritative first.
    const detailsInstrumentSources = useMemo(() => [authenticatedMarketInstruments, marketInstruments, allSymbols]
      .map((catalog) => findInstrumentBySymbol(catalog, detailsSymbol)), [allSymbols, authenticatedMarketInstruments, detailsSymbol, marketInstruments]);
    const tickChartSymbolForView = tickChartSymbol || normalizeSymbol(selectedSymbol);
    const tickChartInstrumentSources = useMemo(() => [authenticatedMarketInstruments, marketInstruments, allSymbols]
      .map((catalog) => findInstrumentBySymbol(catalog, tickChartSymbolForView)), [allSymbols, authenticatedMarketInstruments, marketInstruments, tickChartSymbolForView]);
    const specificationRequestKeyForDialog = specificationSymbol
      ? `${brokerAccountScopeKey}\u0000${specificationSymbol}`
      : null;
    const effectiveSpecificationRequestStatus = !isAuthenticated || !loadSymbolSpecification
      ? 'ready'
      : specificationRequestKey === specificationRequestKeyForDialog
        ? specificationRequestStatus
        : 'loading';

    const isSymbolListLoading = isLoadingSymbols || watchlistLoading || (searchUniverse.length === 0 && activeSymbolsLoading);
    useTerminalStartupReady('marketWatch', !isSymbolListLoading);

    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (shouldIgnoreShortcutEvent(e) || isShortcutInput(e) || isShortcutLocalScope(e) || isShortcutOverlay(e)) return;
        if (!containerRef.current?.contains(getShortcutEventTarget(e))) return;
        const shortcutSymbol = marketWatchView === 'details'
          ? detailsSymbol
          : marketWatchView === 'ticks'
            ? tickChartSymbolForView
            : normalizeSymbol(selectedSymbol);
        // The global manager owns these commands. This scoped fallback serves
        // a standalone Market Watch only when the event was not already used.
        if (e.key === 'F9' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
          e.preventDefault();
          if (actionableSymbolSet.has(shortcutSymbol)) {
            window.dispatchEvent(new CustomEvent('openOrderDialog', { detail: { symbol: shortcutSymbol } }));
          }
        }
        if (e.key === 'F10' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
          e.preventDefault();
          setPopupPricesOpen(true);
        }
        if (e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey && e.key.toLowerCase() === 'b') {
          e.preventDefault();
          if (actionableSymbolSet.has(shortcutSymbol)) {
            window.dispatchEvent(new CustomEvent('openDepthOfMarket', { detail: { symbol: shortcutSymbol } }));
          }
        }
        if (marketWatchView !== 'ticks' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey && e.key.toLowerCase() === 'a') {
          e.preventDefault();
          setMarketWatchOptions((current) => ({ ...current, autoArrange: !current.autoArrange }));
        }
        if (marketWatchView !== 'ticks' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey && e.key.toLowerCase() === 'g') {
          e.preventDefault();
          setMarketWatchOptions((current) => ({ ...current, showGrid: !current.showGrid }));
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }, [actionableSymbolSet, detailsSymbol, marketWatchView, selectedSymbol, tickChartSymbolForView]);

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


    const { loading: quotesLoading, error: quotesError } = useLiveQuotes(subscriptionSymbols);
    useEffect(() => {
      const pendingStatusRefreshSymbol = pendingStatusRefreshSymbolRef.current;
      if (!pendingStatusRefreshSymbol || !subscriptionSymbols.includes(pendingStatusRefreshSymbol)) return;
      pendingStatusRefreshSymbolRef.current = null;
      void reloadActiveMarketSymbols();
    }, [pendingStatusRefreshSymbolRef, reloadActiveMarketSymbols, subscriptionSymbols]);
    const marketWatchErrors = getMarketWatchDisplayErrors(
      symbolsError,
      watchlistError,
      quotesError,
      searchUniverse.length === 0 ? activeSymbolsError : null,
    );
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
          className={`rtx-market-watch rtx-market-watch--desktop ${className ?? ''}`}
          style={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            background: 'var(--bg-secondary)',
            color: '#e2e2e8',
            fontFamily: 'Segoe UI, Tahoma, Arial, sans-serif',
            fontSize: 12,
            userSelect: 'none',
            overflow: 'hidden',
          }}
        >
          {/* ── Search / Add Symbol ──────────────────────────────── */}
          <div className="rtx-market-watch__header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, height: 20, padding: '0 5px', borderBottom: '1px solid var(--border-primary)' }}>
            <MarketWatchServerClock variant="header" />
            <button
              type="button"
              title={tr('Close')}
              aria-label={tr('Close Market Watch')}
              onClick={closeMarketWatchDockPanel}
              className="dock-panel__action dock-panel__action--close flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-zinc-400 transition-colors hover:bg-red-500/80 hover:text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-current"
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </div>

          {(showSymbolsPanel || marketWatchView === 'symbols') && (
            <MarketWatchGrid
              showRows={!showSymbolsPanel}
              footer={
                <MarketWatchSymbolExplorer
                  filteredSymbols={filteredSymbols}
                  highlightIndex={highlightIndex}
                  inputRef={inputRef}
                  isSymbolListLoading={isSymbolListLoading}
                  marketWatchSymbolSet={marketWatchSymbolSet}
                  symbolCount={rows.length}
                  onClose={handleSearchBarClose}
                  onSearchChange={handleSearchChange}
                  onSearchKeyDown={handleSearchKeyDown}
                  onSelectSymbol={handleSelectSymbol}
                  search={search}
                  searchListboxId={searchListboxId}
                  searchUniverse={searchUniverse}
                  selectedSymbolGroup={selectedSymbolGroup}
                  setHighlightIndex={setHighlightIndex}
                  setSelectedSymbolGroupKey={setSelectedSymbolGroupKey}
                  setShowSymbolsPanel={setShowSymbolsPanel}
                  showSymbolsPanel={showSymbolsPanel}
                  showingSymbolGroups={showingSymbolGroups}
                  symbolDescriptionByName={symbolDescriptionByName}
                  symbolGroups={symbolGroups}
                  translate={tr}
                />
              }
              actionableSymbolSet={actionableSymbolSet}
              chartOpenableSymbolSet={chartOpenableSymbolSet}
              closedDailyChanges={closedDailyChanges}
              columns={displayedColumns}
              getContextMenuItems={getContextMenuItems}
              getInstrumentSources={getInstrumentSourcesForSymbol}
              isSymbolListLoading={isSymbolListLoading}
              lastPrices={lastPrices}
              liveQuoteSymbolSet={liveQuoteSymbolSet}
              marketWatchOptions={marketWatchOptions}
              marketWatchRowRefCallbacks={marketWatchRowRefCallbacks}
              marketWatchSelectionSymbol={marketWatchSelectionSymbol}
              onContextSelect={(symbol) => setContextSelection({
                activeSymbol: normalizedSelectedSymbol,
                symbol,
              })}
              onShowAll={handleShowAll}
              onSymbolSelect={(symbol) => {
                setContextSelection(null);
                onSymbolSelect(symbol);
              }}
              quoteEligibleSymbols={quoteEligibleSymbols}
              rows={rows}
              setMarketWatchViewportRef={setMarketWatchViewportRef}
              setSortMode={setSortMode}
              sortMode={sortMode}
              translate={tr}
            />
          )}

          {!showSymbolsPanel && marketWatchView === 'details' && (
            <MarketWatchSymbolDetails
              symbol={detailsSymbol}
              symbols={rows}
              symbolUniverse={quoteEligibleSymbols}
              descriptions={symbolDescriptionByName}
              isLive={liveQuoteSymbolSet.has(detailsSymbol)}
              lastPrice={lastPrices.get(detailsSymbol)}
              closedDailyChange={closedDailyChanges.get(detailsSymbol)}
              instrumentSources={detailsInstrumentSources}
              specificationScopeKey={brokerAccountScopeKey}
              loadSpecification={isAuthenticated ? loadSymbolSpecification : undefined}
              showGrid={marketWatchOptions.showGrid}
              contextMenuItems={getDetailsContextMenuItems(detailsSymbol)}
              isSpecificationOpen={specificationSymbol === detailsSymbol}
              onOpenSpecification={(symbolToOpen) => {
                setRefreshedSpecification(null);
                setSpecificationRequestKey(`${brokerAccountScopeKey}\u0000${symbolToOpen}`);
                setSpecificationRequestStatus(isAuthenticated && Boolean(loadSymbolSpecification) ? 'loading' : 'ready');
                setSpecificationSymbol(symbolToOpen);
              }}
              onRowDoubleClick={() => {
                if (actionableSymbolSet.has(detailsSymbol)) {
                  window.dispatchEvent(new CustomEvent('openOrderDialog', { detail: { symbol: detailsSymbol } }));
                }
              }}
              onSymbolChange={(symbol) => setDetailsSelection({
                ownerSymbol: marketWatchSelectionSymbol,
                symbol,
              })}
            />
          )}

          {!showSymbolsPanel && marketWatchView === 'ticks' && (
            <MarketWatchTickChart
              symbol={tickChartSymbolForView}
              instrumentSources={tickChartInstrumentSources}
              historyScopeKey={dailyChangeScopeKey}
              canTrade={actionableSymbolSet.has(tickChartSymbolForView)}
              canOpenChart={chartOpenableSymbolSet.has(tickChartSymbolForView)}
            />
          )}

          {!showSymbolsPanel && marketWatchView === 'trading' && (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
              <RetainedLazyFeature active>
                <MarketWatchTradingView
                  symbols={rows}
                  tradeSymbols={Array.from(actionableSymbolSet)}
                  instrumentCatalog={[...allSymbols, ...marketInstruments, ...authenticatedMarketInstruments]}
                />
              </RetainedLazyFeature>
            </div>
          )}

          {!showSymbolsPanel && (
            <>
              {marketWatchErrors.length > 0 && (
                <div role="alert" aria-label={tr("Market Watch errors")} style={{
                  padding: '5px 10px',
                  borderTop: '1px solid rgba(248,113,113,0.16)',
                  color: 'var(--rtx-light-quote-down, #f87171)',
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
            <MarketWatchViewTabs
              activeView={marketWatchView}
              onSelectView={(view) => {
                closeSymbolExplorer();
                if (view === 'ticks') setTickChartSymbol(normalizeSymbol(selectedSymbol));
                if (view === 'details') setDetailsSelection(null);
                setMarketWatchView(view);
              }}
              translate={tr}
            />
        </div>
        <MarketWatchSaveSetDialog
          isOpen={isSaveSetOpen}
          value={saveSetName}
          onChange={setSaveSetName}
          onCancel={() => { setIsSaveSetOpen(false); setSaveSetName(''); }}
          onSave={handleSaveSet}
        />
        <PopupPricesDialog
          isOpen={popupPricesOpen}
          symbols={rows}
          columns={columns}
          showMilliseconds={marketWatchOptions.showMilliseconds}
          descriptions={symbolDescriptionByName}
          fallbackPrices={lastPrices}
          dailyChanges={closedDailyChanges}
          onClose={() => setPopupPricesOpen(false)}
        />
        <RetainedLazyFeature active={Boolean(specificationSymbol)}>
          <SymbolSpecificationDialog
            isOpen={Boolean(specificationSymbol)}
            symbol={specificationSymbol ?? ''}
            instrument={specificationInstrument}
            fallbackInstrument={specificationFallbackInstrument}
            requestStatus={effectiveSpecificationRequestStatus}
            onClose={() => {
              setSpecificationSymbol(null);
              setRefreshedSpecification(null);
              setSpecificationRequestKey(null);
              setSpecificationRequestStatus('idle');
            }}
          />
        </RetainedLazyFeature>
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
