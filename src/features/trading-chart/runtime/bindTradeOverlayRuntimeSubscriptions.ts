import type { RefObject } from 'react';
import type { IChartApi } from 'lightweight-charts';
import { useAppStore } from '../../../store/useAppStore';
import { useChartSettingsStore } from '../../../store/useChartSettingsStore';
import { getChartObjectState, useChartObjectStateStore } from '../../../store/useChartObjectStateStore';
import { TRADE_OVERLAY_REFRESH_EVENT, type TradeOverlayRefreshDetail } from '../../../services/tradeOverlayRefreshEvents';
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
} from './tradeRuntimeContracts';

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
  drawingRuntimeContextRef: RefObject<{ contextId: string; accountScope?: string; symbol: string; timeframe: Timeframe }>;
  frozenEntryPricesRef: RefObject<Map<number | string, number>>;
  isActiveRef: RefObject<boolean>;
  optimisticClosedTradeSnapshotsRef: RefObject<Map<string, ClosedTradeSnapshot>>;
  pendingClosedTradeSnapshotsRef: RefObject<Map<string, ActiveTradeSnapshot>>;
  pendingMissingActiveTradesRef: RefObject<Map<string, { trade: ActiveTradeSnapshot; missingSince: number }>>;
  persistTradeLevelOverrides: () => void;
  renderTradeOverlay: RenderTradeOverlay;
  symbol: string;
  tradeLevelCrossRefreshPendingRef: RefObject<Set<string>>;
} & Pick<TradeOverlayModelRuntime,
  | 'buildClosedTradeFromEventSnapshot'
  | 'buildImmediateClosedTrade'
  | 'clearTradeLevelRuntimeState'
  | 'clearTradeLevelRuntimeStateByKey'
  | 'queueTradeOverlayRelayout'
  | 'resolveSymbolTick'
  | 'scheduleHistoryRefresh'
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
  symbol,
  tradeLevelCrossRefreshPendingRef,
}: BindTradeOverlayRuntimeSubscriptionsOptions): (() => void) => {
    // A fill publishes store, Toolbox and new-trade notifications together.
    // Reconcile their latest state once before paint, alongside viewport work,
    // instead of rebuilding every active control several times in that task.
    let renderFrame: number | null = null;
    let forceRefreshTimer: number | null = null;
    let tradeReconcilePending = false;
    let initialRenderPending = true;
    let disposed = false;
    const renderTradeOverlayNow: RenderTradeOverlay = (...args) => {
      if (disposed) return;
      if (renderFrame !== null) window.cancelAnimationFrame(renderFrame);
      renderFrame = null;
      tradeReconcilePending = false;
      initialRenderPending = false;
      renderTradeOverlay(...args);
    };
    const queueTradeOverlayRender = (tradeChanged = false) => {
      if (disposed) return;
      tradeReconcilePending ||= tradeChanged;
      if (renderFrame !== null) return;
      renderFrame = window.requestAnimationFrame(() => {
        renderFrame = null;
        // Retained inactive panes still receive trade state. Only viewport-only
        // work is skipped while a pane is inactive, as before.
        if (initialRenderPending || tradeReconcilePending || isActiveRef.current) renderTradeOverlayNow();
      });
    };
    const timeScaleHandler = () => queueTradeOverlayRender();
    chartRef.current.timeScale().subscribeVisibleLogicalRangeChange(timeScaleHandler);
    if (isActiveRef.current) {
      renderTradeOverlayNow();
    } else {
      timeScaleHandler();
    }

    const unsubscribeAppStore = useAppStore.subscribe((state, previousState) => {
      const currentTick = resolveSymbolTick(state.ticks);
      const previousTick = resolveSymbolTick(previousState.ticks);

      if (
        state.positions !== previousState.positions
        || state.orders !== previousState.orders
        || state.trades !== previousState.trades
      ) {
        queueTradeOverlayRender(true);
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
        renderTradeOverlayNow(true);
      }
    });

    const unsubscribeChartObjectState = useChartObjectStateStore.subscribe((state, previousState) => {
      const contextId = drawingRuntimeContextRef.current.contextId;
      if (
        getChartObjectState(state.byContext, contextId).tradesHidden
        !== getChartObjectState(previousState.byContext, contextId).tradesHidden
      ) {
        renderTradeOverlayNow(true);
      }
    });

    const handleForceRefresh = () => {
      if (forceRefreshTimer !== null) window.clearTimeout(forceRefreshTimer);
      forceRefreshTimer = window.setTimeout(() => {
        forceRefreshTimer = null;
        queueTradeOverlayRender(true);
      }, 500);
    };
    const handleRefreshTradeOverlay = () => queueTradeOverlayRender(true);
    const handleFlushTradeOverlay = (event: Event) => {
      const detail = (event as CustomEvent<TradeOverlayRefreshDetail | undefined>).detail;
      if (detail?.contextId && detail.contextId !== drawingRuntimeContextRef.current.contextId) return;
      if (detail?.mode === 'geometry') {
        // Keep the existing nodes and coalesce projection with the chart frame.
        // Position/SLTP mutations still use the legacy unscoped rebuild below.
        queueTradeOverlayRelayout();
        return;
      }
      if (detail?.mode === 'reconcile') {
        // New candles can change which history markers have coordinates. Let
        // signatures decide membership without discarding unchanged controls.
        if (initialRenderPending) timeScaleHandler();
        else renderTradeOverlayNow();
        return;
      }
      if (detail?.contextId && detail.mode === 'rebuild' && initialRenderPending) {
        // Mount-time presentation effects can share the first render: there
        // are no controls yet to invalidate. Unscoped mutations stay immediate.
        timeScaleHandler();
        return;
      }
      renderTradeOverlayNow(true);
    };
    const handleTradeOverlayCloseState = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      const status = getTradeOverlayCloseState(detail);
      const tradeKeys = getTradeOverlayCloseTicketKeys(detail);
      if (!status || tradeKeys.length === 0) return;
      const closeSnapshotsByKey = new Map(
        getTradeOverlayCloseSnapshots(detail).map((snapshot) => [snapshot.key, snapshot]),
      );

      if (status === 'failed') {
        tradeKeys.forEach((key) => {
          closeSuppressedTradeKeysRef.current.delete(key);
          pendingClosedTradeSnapshotsRef.current.delete(key);
          optimisticClosedTradeSnapshotsRef.current.delete(key);
          forgetTradeOverlayOptimisticClosedSnapshot(key);
          tradeLevelCrossRefreshPendingRef.current.delete(key);
        });
      } else {
        const expiresAt = Date.now() + TRADE_OVERLAY_CLOSE_SUPPRESSION_TTL_MS;
        let didClearTradeLevels = false;
        tradeKeys.forEach((key) => {
          const capturedTrade = activeTradeSnapshotsRef.current.get(key)
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
          activeTradeSnapshotsRef.current.delete(key);
          pendingMissingActiveTradesRef.current.delete(key);
          if (status === 'confirmed') {
            clearFrozenEntryTime(key);
            clearStableActiveMarkerTime(key);
            frozenEntryPricesRef.current.delete(key);
          }
          tradeLevelCrossRefreshPendingRef.current.delete(key);
        });
        if (didClearTradeLevels) persistTradeLevelOverrides();
        scheduleHistoryRefresh();
      }

      clearTradeOverlayLayer('active');
      renderTradeOverlayNow({ forceActive: true, forceHistory: status !== 'failed' });
    };
    // Filled positions change the active signature themselves. Forcing a
    // rebuild here would discard controls the store notification just created.
    const handleNewTradePlaced = () => queueTradeOverlayRender(true);
    window.addEventListener('rtx:force-refresh-positions', handleForceRefresh);
    window.addEventListener('rtx:refresh-trade-overlay', handleRefreshTradeOverlay);
    window.addEventListener(TRADE_OVERLAY_REFRESH_EVENT, handleFlushTradeOverlay);
    window.addEventListener('rtx:new-trade-placed', handleNewTradePlaced);
    window.addEventListener(TRADE_OVERLAY_CLOSE_STATE_EVENT, handleTradeOverlayCloseState);

    return () => {
      disposed = true;
      if (renderFrame !== null) window.cancelAnimationFrame(renderFrame);
      if (forceRefreshTimer !== null) window.clearTimeout(forceRefreshTimer);
      unsubscribeAppStore();
      unsubscribeChartSettings();
      unsubscribeChartObjectState();
      window.removeEventListener('rtx:force-refresh-positions', handleForceRefresh);
      window.removeEventListener('rtx:refresh-trade-overlay', handleRefreshTradeOverlay);
      window.removeEventListener(TRADE_OVERLAY_REFRESH_EVENT, handleFlushTradeOverlay);
      window.removeEventListener('rtx:new-trade-placed', handleNewTradePlaced);
      window.removeEventListener(TRADE_OVERLAY_CLOSE_STATE_EVENT, handleTradeOverlayCloseState);
      try { chartRef.current?.timeScale().unsubscribeVisibleLogicalRangeChange(timeScaleHandler); } catch { /* chart may be disposed */ }
      clearTradeOverlayVisualRuntime();
    };
};
