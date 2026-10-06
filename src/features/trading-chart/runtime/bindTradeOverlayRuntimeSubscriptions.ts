import type { RefObject } from 'react';
import type { IChartApi } from 'lightweight-charts';
import { getPositionCloseScope, isPositionMarkedClosed, useAppStore } from '../../../store/useAppStore';
import { useChartSettingsStore } from '../../../store/useChartSettingsStore';
import { getChartObjectState, useChartObjectStateStore } from '../../../store/useChartObjectStateStore';
import {
  forgetTradeOverlayOptimisticClosedSnapshot,
  getTradeOverlayCloseSnapshots,
  getTradeOverlayCloseState,
  getTradeOverlayCloseTicketKeys,
  TRADE_OVERLAY_CLOSE_STATE_EVENT,
  TRADE_OVERLAY_CLOSE_SUPPRESSION_TTL_MS,
} from '../../../services/tradeOverlayHistory';
import type { Timeframe } from '../../../types/chart';
import type { createTradeOverlayModelRuntime } from './createTradeOverlayModelRuntime';
import type {
  ActiveTradeSnapshot,
  ClosedTradeSnapshot,
  TradeOverlayLayer,
  TradePositionRecord,
} from './tradeRuntimeContracts';
import { isTradeOverlayValuationUpdate } from './tradeOverlayValuationUpdate';

type TradeOverlayModelRuntime = ReturnType<typeof createTradeOverlayModelRuntime>;
type RenderTradeOverlay = (options?: boolean | { forceActive?: boolean; forceHistory?: boolean }) => void;

type BindTradeOverlayRuntimeSubscriptionsOptions = {
  activeTradeSnapshotsRef: RefObject<Map<string, ActiveTradeSnapshot>>;
  chartRef: RefObject<IChartApi | null>;
  clearFrozenEntryTime: (tradeKey: number | string) => void;
  clearStableActiveMarkerTime: (tradeKey: number | string) => void;
  clearTradeOverlayLayer: (layer: TradeOverlayLayer) => void;
  clearTradeOverlayVisualRuntime: () => void;
  closeSuppressedTradeKeysRef: RefObject<Map<string, number>>;
  crossCloseGuessedTradeKeysRef: RefObject<Set<string>>;
  drawingRuntimeContextRef: RefObject<{ contextId: string; accountScope?: string; symbol: string; timeframe: Timeframe }>;
  frozenEntryPricesRef: RefObject<Map<number | string, number>>;
  isActiveRef: RefObject<boolean>;
  optimisticClosedTradeSnapshotsRef: RefObject<Map<string, ClosedTradeSnapshot>>;
  pendingClosedTradeSnapshotsRef: RefObject<Map<string, ActiveTradeSnapshot>>;
  pendingMissingActiveTradesRef: RefObject<Map<string, { trade: ActiveTradeSnapshot; missingSince: number }>>;
  persistTradeLevelOverrides: () => void;
  renderTradeOverlay: RenderTradeOverlay;
  symbol: string;
  tradeLevelCrossCloseCandidatesRef: RefObject<Map<string, number>>;
  tradeLevelCrossRefreshPendingRef: RefObject<Set<string>>;
} & Pick<TradeOverlayModelRuntime,
  | 'buildClosedTradeFromEventSnapshot'
  | 'buildImmediateClosedTrade'
  | 'clearTradeLevelRuntimeState'
  | 'clearTradeLevelRuntimeStateByKey'
  | 'queueTradeOverlayRelayout'
  | 'resolveSymbolTick'
  | 'scheduleHistoryRefresh'
  | 'getLiveTrailPrice'
  | 'getLiveTrailTime'
  | 'pickPositiveNumber'
>;

export const bindTradeOverlayRuntimeSubscriptions = ({
  activeTradeSnapshotsRef,
  buildClosedTradeFromEventSnapshot,
  buildImmediateClosedTrade,
  chartRef,
  clearFrozenEntryTime,
  clearStableActiveMarkerTime,
  clearTradeLevelRuntimeState,
  clearTradeLevelRuntimeStateByKey,
  clearTradeOverlayLayer,
  clearTradeOverlayVisualRuntime,
  closeSuppressedTradeKeysRef,
  crossCloseGuessedTradeKeysRef,
  drawingRuntimeContextRef,
  frozenEntryPricesRef,
  isActiveRef,
  optimisticClosedTradeSnapshotsRef,
  pendingClosedTradeSnapshotsRef,
  pendingMissingActiveTradesRef,
  persistTradeLevelOverrides,
  queueTradeOverlayRelayout,
  renderTradeOverlay,
  resolveSymbolTick,
  scheduleHistoryRefresh,
  getLiveTrailPrice,
  getLiveTrailTime,
  pickPositiveNumber,
  symbol,
  tradeLevelCrossCloseCandidatesRef,
  tradeLevelCrossRefreshPendingRef,
}: BindTradeOverlayRuntimeSubscriptionsOptions): (() => void) => {
    let disposed = false;
    let valuationFrame: number | null = null;
    let refreshTimer: number | null = null;
    const ownerScope = getPositionCloseScope();
    const ownerAccount = useAppStore.getState().accountId;
    const ownerChart = chartRef.current;
    const ownerContext = drawingRuntimeContextRef.current.contextId;
    const ownsRuntime = () => !disposed && getPositionCloseScope() === ownerScope
      && useAppStore.getState().accountId === ownerAccount && chartRef.current === ownerChart
      && drawingRuntimeContextRef.current.contextId === ownerContext;
    const cancelValuationFrame = () => {
      if (valuationFrame !== null) { cancelAnimationFrame(valuationFrame); valuationFrame = null; }
    };
    const renderImmediately: RenderTradeOverlay = options => {
      cancelValuationFrame();
      if (ownsRuntime()) renderTradeOverlay(options);
    };
    const flushValuationFrame = () => {
      if (valuationFrame !== null) renderImmediately();
    };
    const queueValuationRender = () => {
      if (valuationFrame !== null) return;
      valuationFrame = requestAnimationFrame(() => {
        valuationFrame = null;
        if (ownsRuntime()) renderTradeOverlay();
      });
    };
    const refreshValuationSnapshots = (positions: readonly TradePositionRecord[]) => {
      const liveTime = getLiveTrailTime();
      const chartSymbol = symbol.trim().toUpperCase();
      for (const position of positions) {
        const id = position.id ?? position.ticket ?? position.positionId ?? position.position_id;
        const key = `trade:${String(id ?? '').trim()}`;
        const trade = activeTradeSnapshotsRef.current.get(key);
        const positionSymbol = String(position.symbol ?? position.instrument ?? position.name ?? '').trim().toUpperCase();
        const volume = Number(position.volume ?? position.quantity ?? position.volume_lots ?? position.lots ?? 0);
        // A retained overlay may outlive a corrected/suppressed position row.
        // Match the full model's exact contract and executable membership first.
        if (!trade || trade.symbol !== chartSymbol || positionSymbol !== chartSymbol
          || !(volume > 0) || isPositionMarkedClosed(id)) continue;
        const price = pickPositiveNumber(position.currentPrice, position.current_price,
          position.price_current, position.priceCurrent, position.price);
        activeTradeSnapshotsRef.current.set(key, { ...trade,
          currentPrice: getLiveTrailPrice(trade.side, price || trade.entryPrice) ?? trade.entryPrice,
          currentTime: liveTime ?? trade.entryTime });
      }
    };
    renderTradeOverlay();

    const timeScaleHandler = () => queueTradeOverlayRelayout();
    chartRef.current.timeScale().subscribeVisibleLogicalRangeChange(timeScaleHandler);

    const unsubscribeAppStore = useAppStore.subscribe((state, previousState) => {
      if (!ownsRuntime()) { cancelValuationFrame(); return; }
      const currentTick = resolveSymbolTick(state.ticks);
      const previousTick = resolveSymbolTick(previousState.ticks);

      if (state.positions !== previousState.positions || state.trades !== previousState.trades) {
        if (state.trades === previousState.trades && isTradeOverlayValuationUpdate(state.positions, previousState.positions)) {
          // Capture each accepted valuation before yielding. A removal/close
          // arriving before rAF must retain the latest price/time snapshot.
          refreshValuationSnapshots(state.positions);
          queueValuationRender();
        } else renderImmediately();
        return;
      }

      if (
        isActiveRef.current
        &&
        currentTick !== previousTick
        && (activeTradeSnapshotsRef.current.size > 0 || pendingMissingActiveTradesRef.current.size > 0)
      ) {
        queueTradeOverlayRelayout();
      }
    });

    const unsubscribeChartSettings = useChartSettingsStore.subscribe((state, previousState) => {
      const currentProperties = state.symbolProperties[symbol] || state.globalProperties;
      const previousProperties = previousState.symbolProperties[symbol] || previousState.globalProperties;
      if (
        currentProperties.showTradeLevels !== previousProperties.showTradeLevels
        || currentProperties.showTradeHistory !== previousProperties.showTradeHistory
        || currentProperties.showTradeHistoryArrows !== previousProperties.showTradeHistoryArrows
        || currentProperties.tradeHistoryLineOpacity !== previousProperties.tradeHistoryLineOpacity
      ) {
        renderImmediately(true);
      }
    });

    const unsubscribeChartObjectState = useChartObjectStateStore.subscribe((state, previousState) => {
      const contextId = drawingRuntimeContextRef.current.contextId;
      if (
        getChartObjectState(state.byContext, contextId).tradesHidden
        !== getChartObjectState(previousState.byContext, contextId).tradesHidden
      ) {
        renderImmediately(true);
      }
    });

    const handleForceRefresh = () => {
      if (!ownsRuntime()) return;
      flushValuationFrame();
      if (refreshTimer !== null) return;
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        renderImmediately();
      }, 500);
    };
    const handleRefreshTradeOverlay = () => renderImmediately();
    const handleFlushTradeOverlay = () => renderImmediately(true);
    const handleTradeOverlayCloseState = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      const status = getTradeOverlayCloseState(detail);
      const tradeKeys = getTradeOverlayCloseTicketKeys(detail);
      if (!status || tradeKeys.length === 0 || !ownsRuntime()) return;
      // A broker may already have removed/marked the ticket before its event.
      // Preserve the synchronous valuation capture while flushing presentation.
      const preFlushSnapshots = new Map(activeTradeSnapshotsRef.current);
      flushValuationFrame();
      const closeSnapshotsByKey = new Map(
        getTradeOverlayCloseSnapshots(detail).map((snapshot) => [snapshot.key, snapshot]),
      );

      if (status === 'failed') {
        tradeKeys.forEach((key) => {
          closeSuppressedTradeKeysRef.current.delete(key);
          crossCloseGuessedTradeKeysRef.current.delete(key);
          pendingClosedTradeSnapshotsRef.current.delete(key);
          optimisticClosedTradeSnapshotsRef.current.delete(key);
          forgetTradeOverlayOptimisticClosedSnapshot(key);
          tradeLevelCrossRefreshPendingRef.current.delete(key);
          tradeLevelCrossCloseCandidatesRef.current.delete(key);
        });
      } else {
        const expiresAt = Date.now() + TRADE_OVERLAY_CLOSE_SUPPRESSION_TTL_MS;
        let didClearTradeLevels = false;
        tradeKeys.forEach((key) => {
          const capturedTrade = activeTradeSnapshotsRef.current.get(key)
            ?? preFlushSnapshots.get(key)
            ?? pendingMissingActiveTradesRef.current.get(key)?.trade
            ?? pendingClosedTradeSnapshotsRef.current.get(key);
          if (capturedTrade) {
            pendingClosedTradeSnapshotsRef.current.set(key, capturedTrade);
            didClearTradeLevels = clearTradeLevelRuntimeState(capturedTrade) || didClearTradeLevels;
          } else {
            didClearTradeLevels = clearTradeLevelRuntimeStateByKey(key) || didClearTradeLevels;
          }
          const eventCloseSnapshot = closeSnapshotsByKey.get(key);
          const existingClosedTrade = optimisticClosedTradeSnapshotsRef.current.get(key);
          const closedTrade = eventCloseSnapshot
            ? buildClosedTradeFromEventSnapshot(eventCloseSnapshot, capturedTrade, existingClosedTrade)
            : capturedTrade
              ? buildImmediateClosedTrade(capturedTrade, existingClosedTrade)
              : existingClosedTrade ?? null;
          if (closedTrade) {
            optimisticClosedTradeSnapshotsRef.current.set(key, closedTrade);
          }
          if (capturedTrade) {
            if (status === 'confirmed') {
              pendingClosedTradeSnapshotsRef.current.delete(key);
            }
          } else if (status === 'confirmed') {
            pendingClosedTradeSnapshotsRef.current.delete(key);
          }
          closeSuppressedTradeKeysRef.current.set(key, expiresAt);
          // A real close request owns this suppression from here on; the
          // level-cross guess marker must not lift it on stale snapshots.
          crossCloseGuessedTradeKeysRef.current.delete(key);
          activeTradeSnapshotsRef.current.delete(key);
          pendingMissingActiveTradesRef.current.delete(key);
          if (status === 'confirmed') {
            clearFrozenEntryTime(key);
            clearStableActiveMarkerTime(key);
            frozenEntryPricesRef.current.delete(key);
          }
          tradeLevelCrossRefreshPendingRef.current.delete(key);
          tradeLevelCrossCloseCandidatesRef.current.delete(key);
        });
        if (didClearTradeLevels) persistTradeLevelOverrides();
        scheduleHistoryRefresh();
      }

      clearTradeOverlayLayer('active');
      renderImmediately({ forceActive: true, forceHistory: status !== 'failed' });
    };
    const handleNewTradePlaced = () => renderImmediately({ forceActive: true });
    window.addEventListener('rtx:force-refresh-positions', handleForceRefresh);
    window.addEventListener('rtx:refresh-trade-overlay', handleRefreshTradeOverlay);
    window.addEventListener('rtx:flush-trade-overlay', handleFlushTradeOverlay);
    window.addEventListener('rtx:new-trade-placed', handleNewTradePlaced);
    window.addEventListener(TRADE_OVERLAY_CLOSE_STATE_EVENT, handleTradeOverlayCloseState);

    return () => {
      disposed = true;
      cancelValuationFrame();
      if (refreshTimer !== null) { window.clearTimeout(refreshTimer); refreshTimer = null; }
      unsubscribeAppStore();
      unsubscribeChartSettings();
      unsubscribeChartObjectState();
      window.removeEventListener('rtx:force-refresh-positions', handleForceRefresh);
      window.removeEventListener('rtx:refresh-trade-overlay', handleRefreshTradeOverlay);
      window.removeEventListener('rtx:flush-trade-overlay', handleFlushTradeOverlay);
      window.removeEventListener('rtx:new-trade-placed', handleNewTradePlaced);
      window.removeEventListener(TRADE_OVERLAY_CLOSE_STATE_EVENT, handleTradeOverlayCloseState);
      try { chartRef.current?.timeScale().unsubscribeVisibleLogicalRangeChange(timeScaleHandler); } catch { /* chart may be disposed */ }
      clearTradeOverlayVisualRuntime();
    };
};
