import type { RefObject } from 'react';
import type { IChartApi, ISeriesApi, SeriesType } from 'lightweight-charts';
import { useActiveChartRuntimeEffect } from '../../../hooks/useActiveChartRuntimeEffect';
import type { TradingChartVisibleRuntime } from '../../../hooks/useTradingChartVisibleRuntime';
import { getPositionCloseScope, isPositionMarkedClosed, useAppStore } from '../../../store/useAppStore';
import { layoutRebuiltTradeOverlay } from './layoutRebuiltTradeOverlay';
import { createActiveTradeOverlayGroups, createActiveTradeOverlayRenderPlans, type ActiveTradeOverlayGroupPlan } from './createActiveTradeOverlayGroups';
import { createHistoryTradeOverlayContextKey, createHistoryTradeOverlayGroups, createHistoryTradeOverlayRenderPlans } from './createHistoryTradeOverlayGroups';
import { isInvestorSession } from '../../../services/investorSession';
import {
  clampChartOpacityPercent,
  defaultChartProperties,
  useChartSettingsStore,
} from '../../../store/useChartSettingsStore';
import { getChartObjectState, useChartObjectStateStore } from '../../../store/useChartObjectStateStore';
import { getSharedChartTrade } from '../../../utils/tradeShareLink';
import {
  createClosedTradeHistorySnapshotCache,
  createTradeOverlayCandleLookup,
  filterActiveTradeKeysForHistory,
  forgetTradeOverlayOptimisticClosedSnapshot,
  getTradeOverlayOptimisticClosedSnapshots,
  getTradeOverlayRedrawDecision,
  resolveStableTradeEntryPrice,
  resolveStableTradeEntryTime,
  shouldKeepMissingActiveTradeOverlay,
  shouldUseClosedTradeHistorySnapshot,
  TRADE_OVERLAY_CLOSE_SUPPRESSION_TTL_MS,
  type TradeOverlayHistoryRow,
} from '../../../services/tradeOverlayHistory';
import type { Candle, Timeframe, TradingViewChartTheme } from '../../../types/chart';
import type { ChartPostInteractionCoordinator } from '../../../utils/chartPostInteractionCoordinator';
import {
  TRADE_LEVEL_CROSS_CLOSE_MIN_MISSING_MS,
  TRADE_MISSING_POSITION_GRACE_MS,
  type TradeSide,
} from '../presentation/tradeOverlayPresentation';
import { createTradeOverlayModelRuntime } from './createTradeOverlayModelRuntime';
import { createTradeOverlayDomRuntime } from './createTradeOverlayDomRuntime';
import { bindTradeOverlayRuntimeSubscriptions } from './bindTradeOverlayRuntimeSubscriptions';
import {
  getEntryLineColor,
  getFrozenEntryTimeKey,
  TRADE_BUY_COLOR,
  TRADE_SELL_COLOR,
} from './tradeOverlayRuntimeConstants';
import type {
  ActiveTradeSnapshot,
  ClosedTradeSnapshot,
  OverlayNodeData,
  TradeLevelModifyRequestId,
  TradeLevelOverride,
  TradeOverlayLayer,
  TradePositionRecord,
} from './tradeRuntimeContracts';

const TRADE_HISTORY_PRESENTATION_VERSION = 'visibility-v13-entry-close-connectors';

interface UseTradingChartTradeOverlayRendererOptions {
  activeOverlayNodeDataRef: RefObject<OverlayNodeData[]>;
  activeOverlayNodesRef: RefObject<HTMLElement[]>;
  activeTradeSnapshotsRef: RefObject<Map<string, ActiveTradeSnapshot>>;
  brokerAccountSessionScope: string;
  brokerTimeOffsetSec: number;
  candlesRef: RefObject<Candle[]>;
  chartRef: RefObject<IChartApi | null>;
  chartThemeRef: RefObject<TradingViewChartTheme>;
  clearFrozenEntryTime: (tradeKey: number | string) => void;
  clearStableActiveMarkerTime: (tradeKey: number | string) => void;
  clearTradeOverlayLayer: (layer: TradeOverlayLayer) => void;
  clearTradeOverlayVisualRuntime: () => void;
  closeSuppressedTradeKeysRef: RefObject<Map<string, number>>;
  crossCloseGuessedTradeKeysRef: RefObject<Set<string>>;
  currentCandleRef: RefObject<Candle | null>;
  drawingRuntimeContextRef: RefObject<{ contextId: string; accountScope?: string; symbol: string; timeframe: Timeframe }>;
  frozenEntryPricesRef: RefObject<Map<number | string, number>>;
  frozenEntryTimesRef: RefObject<Map<number | string, number>>;
  getNearestCandleByTime: (time: number, maxDistanceSeconds?: number) => Candle | null;
  historyOverlayNodeDataRef: RefObject<OverlayNodeData[]>;
  historyOverlayNodesRef: RefObject<HTMLElement[]>;
  hydrateTradeLevelOverrides: () => void;
  isActiveRef: RefObject<boolean>;
  isChartInteractionActiveRef: RefObject<boolean>;
  isChartSurfaceLight: () => boolean;
  isDisposedRef: RefObject<boolean>;
  isLivePriceSafeForCandles: (price: number) => boolean;
  lastActiveTradeOverlaySignatureRef: RefObject<string>;
  lastHistoryTradeOverlaySignatureRef: RefObject<string>;
  optimisticClosedTradeSnapshotsRef: RefObject<Map<string, ClosedTradeSnapshot>>;
  overlayRef: RefObject<HTMLDivElement | null>;
  pendingClosedTradeSnapshotsRef: RefObject<Map<string, ActiveTradeSnapshot>>;
  pendingMissingActiveTradesRef: RefObject<Map<string, { trade: ActiveTradeSnapshot; missingSince: number }>>;
  pendingTradeLevelModifyRequestsRef: RefObject<Map<string, TradeLevelModifyRequestId>>;
  persistTradeLevelOverrides: () => void;
  postInteractionCoordinatorRef: RefObject<ChartPostInteractionCoordinator | null>;
  postInteractionTradeOverlayLayoutRef: RefObject<(() => void) | null>;
  committedTradeOverlayLayoutRef: RefObject<(() => void) | null>;
  prevTimeframeRef: RefObject<Timeframe>;
  resolvedPriceDigits: number;
  seriesRef: RefObject<ISeriesApi<SeriesType> | null>;
  stableActiveMarkerTimesRef: RefObject<Map<number | string, number>>;
  symbol: string;
  timeframe: Timeframe;
  tr: <T>(source: T, values?: Record<string, unknown>) => T;
  tradeControlLiveUpdatersRef: RefObject<Array<() => void>>;
  tradeHistoryRefreshTimerRef: RefObject<number | null>;
  tradeLevelCrossCloseCandidatesRef: RefObject<Map<string, number>>;
  tradeLevelCrossRefreshPendingRef: RefObject<Set<string>>;
  tradeLevelLastKnownLevelsRef: RefObject<Map<string, TradeLevelOverride>>;
  tradeLevelModifyRequestSeqRef: RefObject<TradeLevelModifyRequestId>;
  tradeLevelOptimisticGraceUntilRef: RefObject<Map<string, number>>;
  tradeLevelOverridesRef: RefObject<Map<string, TradeLevelOverride>>;
  tradeMissingGraceTimerRef: RefObject<number | null>;
  tradeOverlayRafRef: RefObject<number | null>;
  updateLabelPositions: (refreshMetrics?: boolean) => boolean;
  visibleRuntime: TradingChartVisibleRuntime;
}

export const useTradingChartTradeOverlayRenderer = ({
  activeOverlayNodeDataRef,
  activeOverlayNodesRef,
  activeTradeSnapshotsRef,
  brokerAccountSessionScope,
  brokerTimeOffsetSec,
  candlesRef,
  chartRef,
  chartThemeRef,
  clearFrozenEntryTime,
  clearStableActiveMarkerTime,
  clearTradeOverlayLayer,
  clearTradeOverlayVisualRuntime,
  closeSuppressedTradeKeysRef,
  crossCloseGuessedTradeKeysRef,
  currentCandleRef,
  drawingRuntimeContextRef,
  frozenEntryPricesRef,
  frozenEntryTimesRef,
  getNearestCandleByTime,
  historyOverlayNodeDataRef,
  historyOverlayNodesRef,
  hydrateTradeLevelOverrides,
  isActiveRef,
  isChartInteractionActiveRef,
  isChartSurfaceLight,
  isDisposedRef,
  isLivePriceSafeForCandles,
  lastActiveTradeOverlaySignatureRef,
  lastHistoryTradeOverlaySignatureRef,
  optimisticClosedTradeSnapshotsRef,
  overlayRef,
  pendingClosedTradeSnapshotsRef,
  pendingMissingActiveTradesRef,
  pendingTradeLevelModifyRequestsRef,
  persistTradeLevelOverrides,
  postInteractionCoordinatorRef,
  postInteractionTradeOverlayLayoutRef,
  committedTradeOverlayLayoutRef,
  prevTimeframeRef,
  resolvedPriceDigits,
  seriesRef,
  stableActiveMarkerTimesRef,
  symbol,
  timeframe,
  tr,
  tradeControlLiveUpdatersRef,
  tradeHistoryRefreshTimerRef,
  tradeLevelCrossCloseCandidatesRef,
  tradeLevelCrossRefreshPendingRef,
  tradeLevelLastKnownLevelsRef,
  tradeLevelModifyRequestSeqRef,
  tradeLevelOptimisticGraceUntilRef,
  tradeLevelOverridesRef,
  tradeMissingGraceTimerRef,
  tradeOverlayRafRef,
  updateLabelPositions,
  visibleRuntime,
}: UseTradingChartTradeOverlayRendererOptions): void => {
  // Raw credential replacement/logout may advance ownership without changing
  // the committed account key. Explicit token refresh preserves this generation.
  const positionCloseScope = useAppStore(() => getPositionCloseScope());
  useActiveChartRuntimeEffect(visibleRuntime.overlay, () => {
    if (isDisposedRef.current || !seriesRef.current || !chartRef.current || !symbol) return;

    hydrateTradeLevelOverrides();

    let runtimeDisposed = false;
    const ownerChart = chartRef.current, ownerSeries = seriesRef.current, ownerOverlay = overlayRef.current;
    const ownerScope = getPositionCloseScope(), ownerAccount = useAppStore.getState().accountId;
    const ownerContext = drawingRuntimeContextRef.current.contextId;
    const isRuntimeCurrent = () => !runtimeDisposed && !isDisposedRef.current
      && chartRef.current === ownerChart && seriesRef.current === ownerSeries && overlayRef.current === ownerOverlay
      && getPositionCloseScope() === ownerScope && useAppStore.getState().accountId === ownerAccount
      && drawingRuntimeContextRef.current.contextId === ownerContext;

    // FIX: Trade overlays use the same opaque identity as orders and quotes.
    const normalizedChartSymbol = symbol.trim().toUpperCase();
    const digits = resolvedPriceDigits;

    const {
      queueTradeOverlayRelayout,
      projectCommittedTradeOverlayGeometry,
      disposeTradeOverlayRelayout,
      flushPostInteractionTradeOverlay,
      normalizeUnixSeconds,
      pickPositiveNumber,
      getTradeTicketLabel,
      formatTradeLevelBadgePrice,
      resolveSymbolTick,
      mapTradeTimestampToChartTime,
      getEntryColor,
      getClosedTradeLineColor,
      getLiveTrailTime,
      getActiveMarkerTimeKey,
      canResolveOverlayTime,
      getLiveTrailPrice,
      buildImmediateClosedTrade,
      buildClosedTradeFromEventSnapshot,
      mapStoredClosedTradeToChart,
      scheduleHistoryRefresh,
      getTradeLevelStateKeys,
      setTradeLevelState,
      deleteTradeLevelState,
      clearTradeLevelRuntimeState,
      clearTradeLevelRuntimeStateByKey,
      resolveTradeLevels,
      priceTolerance,
    } = createTradeOverlayModelRuntime({
      brokerTimeOffsetSec,
      candlesRef,
      chartRef,
      chartThemeRef,
      currentCandleRef,
      digits,
      getNearestCandleByTime,
      isChartInteractionActiveRef,
      isLivePriceSafeForCandles,
      pendingTradeLevelModifyRequestsRef,
      persistTradeLevelOverrides,
      postInteractionCoordinatorRef,
      prevTimeframeRef,
      stableActiveMarkerTimesRef,
      symbol,
      timeframe,
      tradeHistoryRefreshTimerRef,
      tradeLevelLastKnownLevelsRef,
      tradeLevelOptimisticGraceUntilRef,
      tradeLevelOverridesRef,
      tradeOverlayRafRef,
      updateLabelPositions,
      isRuntimeCurrent,
    });
    postInteractionTradeOverlayLayoutRef.current = flushPostInteractionTradeOverlay;
    committedTradeOverlayLayoutRef.current = projectCommittedTradeOverlayGeometry;

    const {
      createCollisionOffsetFactory,
      createTradeMarker,
      createTradeHistoryLine,
      createPriceLevel,
      getLocalizedTradeTitle,
      getTradeTicket,
      addTradeAxisPriceLine,
      createEntryControlsForTrade,
      createLevelControlsForTrade,
    } = createTradeOverlayDomRuntime({
      activeOverlayNodeDataRef,
      activeOverlayNodesRef,
      activeTradeSnapshotsRef,
      brokerAccountSessionScope,
      chartThemeRef,
      deleteTradeLevelState,
      digits,
      formatTradeLevelBadgePrice,
      getTradeLevelStateKeys,
      getTradeTicketLabel,
      historyOverlayNodeDataRef,
      historyOverlayNodesRef,
      isChartSurfaceLight,
      overlayRef,
      pendingTradeLevelModifyRequestsRef,
      persistTradeLevelOverrides,
      prevTimeframeRef,
      resolveSymbolTick,
      seriesRef,
      setTradeLevelState,
      timeframe,
      tr,
      tradeControlLiveUpdatersRef,
      tradeLevelLastKnownLevelsRef,
      tradeLevelModifyRequestSeqRef,
      tradeLevelOptimisticGraceUntilRef,
      tradeLevelOverridesRef,
    });

    const activeGroups = createActiveTradeOverlayGroups({ nodes: activeOverlayNodesRef, data: activeOverlayNodeDataRef, updaters: tradeControlLiveUpdatersRef });
    const historyGroups = createHistoryTradeOverlayGroups({ nodes: historyOverlayNodesRef, data: historyOverlayNodeDataRef });
    const getHistoryContextKey = createHistoryTradeOverlayContextKey();

    const pruneCloseSuppressedTradeKeys = (now = Date.now()) => {
      closeSuppressedTradeKeysRef.current.forEach((expiresAt, key) => {
        if (expiresAt <= now) {
          closeSuppressedTradeKeysRef.current.delete(key);
          crossCloseGuessedTradeKeysRef.current.delete(key);
        }
      });
    };

    const pruneTradeLevelCrossCloseCandidates = (now = Date.now()) => {
      tradeLevelCrossCloseCandidatesRef.current.forEach((expiresAt, key) => {
        if (expiresAt <= now) {
          tradeLevelCrossCloseCandidatesRef.current.delete(key);
        }
      });
    };

    const readClosedHistorySnapshots = createClosedTradeHistorySnapshotCache();
    const emptyHistoryMappingRevision = {};

    const renderTradeOverlay = (options: boolean | { forceActive?: boolean; forceHistory?: boolean } = false) => {
      if (isDisposedRef.current || !seriesRef.current || !overlayRef.current) return;
      const candleLookup = createTradeOverlayCandleLookup(candlesRef.current, currentCandleRef.current);
      const mapTradeTime = (value: unknown) => mapTradeTimestampToChartTime(value, candleLookup);
      const forceActive = typeof options === 'boolean' ? options : Boolean(options.forceActive);
      const forceHistory = typeof options === 'boolean' ? options : Boolean(options.forceHistory);
      const now = Date.now();
      pruneCloseSuppressedTradeKeys(now);
      pruneTradeLevelCrossCloseCandidates(now);
      const closeSuppressedTradeKeys = new Set(closeSuppressedTradeKeysRef.current.keys());

      const chartProperties = useChartSettingsStore.getState().symbolProperties[symbol]
        || useChartSettingsStore.getState().globalProperties;
      const showTradeLevels = chartProperties.showTradeLevels !== false
        && !getChartObjectState(
          useChartObjectStateStore.getState().byContext,
          drawingRuntimeContextRef.current.contextId,
        ).tradesHidden;
      const showTradeHistoryLine = chartProperties.showTradeHistory !== false;
      const showTradeHistoryArrows = chartProperties.showTradeHistoryArrows !== false;
      const showAnyTradeHistoryOverlay = showTradeHistoryLine || showTradeHistoryArrows;
      const tradeHistoryLineOpacityPercent = clampChartOpacityPercent(
        chartProperties.tradeHistoryLineOpacity,
        defaultChartProperties.tradeHistoryLineOpacity,
      );
      const tradeHistoryLineOpacity = tradeHistoryLineOpacityPercent / 100;
      const appState = useAppStore.getState();
      const appPositions: TradePositionRecord[] = Array.isArray(appState.positions) ? appState.positions : [];
      const appTrades = Array.isArray(appState.trades) ? appState.trades : [];
      const liveTrailTime = getLiveTrailTime();
      const isMatchingTradeSymbol = (rawSymbol: unknown) => {
        const positionSymbol = String(rawSymbol || '').trim().toUpperCase();
        if (!positionSymbol) return false;
        return positionSymbol === normalizedChartSymbol;
      };
      const getPositionId = (position: TradePositionRecord): number | string | null => {
        const rawId = position?.id ?? position?.ticket ?? position?.positionId ?? position?.position_id;
        const id = String(rawId ?? '').trim();
        return id ? id : null;
      };
      const getPositionSymbol = (position: TradePositionRecord): string =>
        String(position?.symbol ?? position?.instrument ?? position?.name ?? '');
      const getPositionVolume = (position: TradePositionRecord): number => Number(
        position?.volume
        ?? position?.quantity
        ?? position?.volume_lots
        ?? position?.lots
        ?? 0,
      ) || 0;
      const getPositionSide = (position: TradePositionRecord): TradeSide => {
        const side = String(position?.side ?? position?.action ?? position?.type ?? '').trim().toUpperCase();
        return side.includes('SELL') || side === '1' ? 'SELL' : 'BUY';
      };
      const getPositionOpenPrice = (position: TradePositionRecord): number => pickPositiveNumber(
        position?.chartEntryPrice,
        position?.openPrice,
        position?.open_price,
        position?.price_open,
        position?.priceOpen,
      );
      const getPositionCurrentPrice = (position: TradePositionRecord): number => pickPositiveNumber(
        position?.currentPrice,
        position?.current_price,
        position?.price_current,
        position?.priceCurrent,
        position?.price,
      );
      const getPositionOpenTime = (position: TradePositionRecord): number | null => normalizeUnixSeconds(
        position?.chartEntryTime
        ?? position?.openTime
        ?? position?.time_create
        ?? position?.time_open
        ?? position?.time_ms
        ?? position?.time,
      );
      const rawActiveTradeKeys = new Set(
        appPositions
          .filter((position) => {
            const positionId = getPositionId(position);
            return positionId != null
              && !isPositionMarkedClosed(positionId, now)
              && getPositionVolume(position) > 0
              && isMatchingTradeSymbol(getPositionSymbol(position));
          })
          .map((position) => `trade:${String(getPositionId(position))}`),
      );
      const activeTradeKeys = filterActiveTradeKeysForHistory(rawActiveTradeKeys, closeSuppressedTradeKeys);
      const mapHistoryTimestamp = (value: unknown): number =>
        mapTradeTime(value) ?? normalizeUnixSeconds(value) ?? 0;
      const closedHistorySnapshots = readClosedHistorySnapshots({
        rows: appTrades as unknown as TradeOverlayHistoryRow[],
        symbol: normalizedChartSymbol,
        mapTimestamp: mapHistoryTimestamp,
        activeTradeKeys,
      }, appTrades.length ? candleLookup.mappingRevision() : emptyHistoryMappingRevision, prevTimeframeRef.current || timeframe);
      const realClosedTradeKeys = new Set(closedHistorySnapshots.map((trade) => trade.key));
      let didClearClosedHistoryTradeLevels = false;
      realClosedTradeKeys.forEach((key) => {
        const capturedTrade = activeTradeSnapshotsRef.current.get(key)
          ?? pendingMissingActiveTradesRef.current.get(key)?.trade
          ?? pendingClosedTradeSnapshotsRef.current.get(key);
        didClearClosedHistoryTradeLevels = capturedTrade
          ? clearTradeLevelRuntimeState(capturedTrade) || didClearClosedHistoryTradeLevels
          : clearTradeLevelRuntimeStateByKey(key) || didClearClosedHistoryTradeLevels;
        pendingClosedTradeSnapshotsRef.current.delete(key);
        tradeLevelCrossCloseCandidatesRef.current.delete(key);
      });
      if (didClearClosedHistoryTradeLevels) persistTradeLevelOverrides();

      const normalizedAppPositions = appPositions.map((position) => ({
        id: getPositionId(position),
        symbol: getPositionSymbol(position),
        side: getPositionSide(position),
        volume: getPositionVolume(position),
        openPrice: getPositionOpenPrice(position),
        currentPrice: getPositionCurrentPrice(position),
        rawOpenTime: getPositionOpenTime(position),
        sl: pickPositiveNumber(position.sl, position.price_sl, position.stopLoss, position.stop_loss),
        tp: pickPositiveNumber(position.tp, position.price_tp, position.takeProfit, position.take_profit),
      }));

      const matchingPositions = normalizedAppPositions.filter((position) => {
        const positionSymbol = String(position.symbol || '').trim().toUpperCase();
        if (!position.id || !positionSymbol) return false;
        // FIX: Never render or manage a different suffix contract's position.
        return Number(position.volume) > 0
          && positionSymbol === normalizedChartSymbol
          && !isPositionMarkedClosed(position.id, now);
      });

      const nextActiveSnapshots = new Map<string, ActiveTradeSnapshot>();

      for (const position of matchingPositions) {
        const key = `trade:${String(position.id)}`;
        if (closeSuppressedTradeKeys.has(key)) {
          if (crossCloseGuessedTradeKeysRef.current.has(key)) {
            // The level-cross close was only a guess and the broker feed still
            // reports the position open — the guess was wrong. Lift the
            // suppression and drop the fake closed snapshot so the live
            // controls come back on this very render.
            crossCloseGuessedTradeKeysRef.current.delete(key);
            closeSuppressedTradeKeysRef.current.delete(key);
            closeSuppressedTradeKeys.delete(key);
            optimisticClosedTradeSnapshotsRef.current.delete(key);
            forgetTradeOverlayOptimisticClosedSnapshot(key);
            pendingClosedTradeSnapshotsRef.current.delete(key);
          } else {
            pendingMissingActiveTradesRef.current.delete(key);
            continue;
          }
        }

        const activeTf = prevTimeframeRef.current || timeframe;
        const scopedEntryTimeKey = getFrozenEntryTimeKey(key, activeTf);
        const storedEntryTime = frozenEntryTimesRef.current.get(scopedEntryTimeKey);
        const rawEntryTime = position.rawOpenTime ?? normalizeUnixSeconds(Date.now());
        const entryTime = resolveStableTradeEntryTime(
          storedEntryTime,
          rawEntryTime,
          mapTradeTime,
          liveTrailTime,
        );
        if (storedEntryTime == null && entryTime > 0) {
          frozenEntryTimesRef.current.set(scopedEntryTimeKey, entryTime);
        }

        const storedEntryPrice = frozenEntryPricesRef.current.get(key);
        const entryPrice = resolveStableTradeEntryPrice(
          storedEntryPrice,
          position.openPrice,
          position.currentPrice,
        );
        if (storedEntryPrice == null && entryPrice > 0) {
          frozenEntryPricesRef.current.set(key, entryPrice);
        }
        if (!(entryTime > 0) || !(entryPrice > 0)) continue;

        nextActiveSnapshots.set(key, {
          key,
          symbol: normalizedChartSymbol,
          side: position.side,
          volume: position.volume,
          entryPrice,
          entryTime,
          entryExecutionTime: rawEntryTime ?? entryTime,
          currentPrice: getLiveTrailPrice(position.side, position.currentPrice || entryPrice) ?? entryPrice,
          currentTime: liveTrailTime ?? entryTime,
          sl: position.sl,
          tp: position.tp,
        });
        pendingMissingActiveTradesRef.current.delete(key);
      }

      const renderActiveSnapshots = new Map(nextActiveSnapshots);
      const visuallyRetainedActiveTradeKeys = new Set<string>();
      let nextMissingGraceDelayMs: number | null = null;
      let didClearCrossClosedTradeLevels = false;

      activeTradeSnapshotsRef.current.forEach((previousTrade, key) => {
        if (previousTrade.symbol !== normalizedChartSymbol || nextActiveSnapshots.has(key)) return;
        if (!shouldKeepMissingActiveTradeOverlay({
          tradeKey: key,
          closeSuppressedTradeKeys,
          closedHistoryTradeKeys: realClosedTradeKeys,
          brokerMarkedClosed: isPositionMarkedClosed(getTradeTicket(key), now),
        })) {
          pendingMissingActiveTradesRef.current.delete(key);
          return;
        }

        if (!pendingMissingActiveTradesRef.current.has(key)) {
          pendingMissingActiveTradesRef.current.set(key, { trade: previousTrade, missingSince: now });
          scheduleHistoryRefresh();
        }
      });

      pendingMissingActiveTradesRef.current.forEach((pending, key) => {
        if (
          pending.trade.symbol !== normalizedChartSymbol
          || nextActiveSnapshots.has(key)
          || !shouldKeepMissingActiveTradeOverlay({
            tradeKey: key,
            closeSuppressedTradeKeys,
            closedHistoryTradeKeys: realClosedTradeKeys,
            brokerMarkedClosed: isPositionMarkedClosed(getTradeTicket(key), now),
          })
        ) {
          pendingMissingActiveTradesRef.current.delete(key);
          return;
        }

        const elapsedMs = now - pending.missingSince;
        const crossedLevelCandidateExpiresAt = tradeLevelCrossCloseCandidatesRef.current.get(key) ?? 0;
        const crossCandidateArmed = crossedLevelCandidateExpiresAt > now;
        // Guess a level-cross close only after a real dwell AND while the
        // positions feed itself is alive (it still reports some position). A
        // dead feed loses every trade at once — that is a backend outage, not
        // a fill, and open trades must not be painted as closed.
        if (
          crossCandidateArmed
          && elapsedMs >= TRADE_LEVEL_CROSS_CLOSE_MIN_MISSING_MS
          && appPositions.length > 0
        ) {
          const closedTrade = buildImmediateClosedTrade(pending.trade);
          if (closedTrade) {
            optimisticClosedTradeSnapshotsRef.current.set(key, closedTrade);
          }
          pendingClosedTradeSnapshotsRef.current.delete(key);
          pendingMissingActiveTradesRef.current.delete(key);
          closeSuppressedTradeKeysRef.current.set(key, now + TRADE_OVERLAY_CLOSE_SUPPRESSION_TTL_MS);
          crossCloseGuessedTradeKeysRef.current.add(key);
          tradeLevelCrossCloseCandidatesRef.current.delete(key);
          tradeLevelCrossRefreshPendingRef.current.delete(key);
          didClearCrossClosedTradeLevels = clearTradeLevelRuntimeState(pending.trade) || didClearCrossClosedTradeLevels;
          scheduleHistoryRefresh();
          return;
        }

        // Retain until the trade is PROVEN closed — a close event, a closed
        // history row, or an evidenced level-cross. Feed gaps and backend
        // outages of any length must never hide open trades; only the settings
        // toggle or a real close removes the on-chart controls.
        renderActiveSnapshots.set(key, pending.trade);
        visuallyRetainedActiveTradeKeys.add(key);
        if (crossCandidateArmed) {
          const remainingMs = Math.max(50, TRADE_LEVEL_CROSS_CLOSE_MIN_MISSING_MS - elapsedMs);
          nextMissingGraceDelayMs = nextMissingGraceDelayMs == null
            ? remainingMs
            : Math.min(nextMissingGraceDelayMs, remainingMs);
        }
        if (elapsedMs >= TRADE_MISSING_POSITION_GRACE_MS) {
          // Keep nudging history so a genuinely closed trade gets its closed
          // row and leaves retention through the proven path.
          scheduleHistoryRefresh();
        }
      });

      if (didClearCrossClosedTradeLevels) persistTradeLevelOverrides();

      // Keep retained fills in the live snapshot map so a lagged empty store
      // cannot drop on-chart open trades on the next overlay pass.
      activeTradeSnapshotsRef.current = renderActiveSnapshots;

      if (nextMissingGraceDelayMs != null) {
        if (tradeMissingGraceTimerRef.current !== null) {
          window.clearTimeout(tradeMissingGraceTimerRef.current);
        }
        tradeMissingGraceTimerRef.current = window.setTimeout(() => {
          tradeMissingGraceTimerRef.current = null;
          renderTradeOverlay({ forceActive: true });
        }, Math.max(0, nextMissingGraceDelayMs + 25));
      } else if (tradeMissingGraceTimerRef.current !== null) {
        window.clearTimeout(tradeMissingGraceTimerRef.current);
        tradeMissingGraceTimerRef.current = null;
      }

      const closedTrades = new Map<string, ClosedTradeSnapshot>();
      const registerClosedTrade = (trade: ClosedTradeSnapshot) => {
        if (trade.entryPrice > 0 && trade.exitPrice > 0 && trade.entryTime > 0 && trade.exitTime > 0) {
          closedTrades.set(trade.key, trade);
        }
      };
      const hasRenderableClosedTradePath = (trade: ClosedTradeSnapshot): boolean => {
        const hasVisibleSpan = Math.abs(trade.entryTime - trade.exitTime) > 0
          || Math.abs(trade.entryPrice - trade.exitPrice) > priceTolerance;
        return hasVisibleSpan && canResolveOverlayTime(trade.entryTime) && canResolveOverlayTime(trade.exitTime);
      };

      if (showAnyTradeHistoryOverlay) {
        getTradeOverlayOptimisticClosedSnapshots(normalizedChartSymbol).forEach((trade) => {
          if (activeTradeKeys.has(trade.key)) {
            forgetTradeOverlayOptimisticClosedSnapshot(trade.key);
            return;
          }
          const chartTrade = mapStoredClosedTradeToChart(trade);
          if (chartTrade) {
            registerClosedTrade(chartTrade);
          }
        });
        optimisticClosedTradeSnapshotsRef.current.forEach((trade, key) => {
          if (activeTradeKeys.has(key)) {
            optimisticClosedTradeSnapshotsRef.current.delete(key);
            return;
          }
          if (trade.symbol === normalizedChartSymbol) {
            registerClosedTrade(trade);
          }
        });
        closedHistorySnapshots.forEach((trade) => {
          const existingTrade = closedTrades.get(trade.key);
          const backendHasRenderablePath = hasRenderableClosedTradePath(trade);
          if (shouldUseClosedTradeHistorySnapshot({
            existingTrade,
            candidateTrade: trade,
            canRenderTradePath: hasRenderableClosedTradePath,
          })) {
            registerClosedTrade(trade);
            if (backendHasRenderablePath) {
              optimisticClosedTradeSnapshotsRef.current.delete(trade.key);
              forgetTradeOverlayOptimisticClosedSnapshot(trade.key);
            }
          } else if (existingTrade) {
            registerClosedTrade({
              ...existingTrade,
              entryExecutionTime: trade.entryExecutionTime,
              exitExecutionTime: trade.exitExecutionTime,
            });
          }
        });
      }

      const sortedActiveSnapshots = Array.from(renderActiveSnapshots.values())
        .sort((a, b) => a.key.localeCompare(b.key));
      const sharedTradeForSignature = getSharedChartTrade();
      const sharedTrade = showTradeLevels && sharedTradeForSignature?.symbol === normalizedChartSymbol
        && !activeTradeKeys.has(`trade:${sharedTradeForSignature.ticket}`) ? sharedTradeForSignature : null;
      const presentationSignature = JSON.stringify([
        normalizedChartSymbol, timeframe, digits, chartThemeRef.current, isChartSurfaceLight(),
        useAppStore.getState().account?.currency || 'USD', isInvestorSession(),
      ]);
      const needsCollisionOffsets = Boolean(sharedTrade) || sortedActiveSnapshots.some(trade =>
        !nextActiveSnapshots.has(trade.key) && !visuallyRetainedActiveTradeKeys.has(trade.key));
      // Real control bars intentionally overlap at zero offset. Avoid chart
      // coordinate reads during valuation when no annotation consumes buckets.
      const nextLevelOffset = needsCollisionOffsets ? createCollisionOffsetFactory() : () => 0;
      // Allocate collisions for all sorted trades, even retained DOM groups:
      // annotation labels share buckets across ENTRY/SL/TP and across tickets.
      const activeRenderPlans = showTradeLevels ? createActiveTradeOverlayRenderPlans({
        sortedTrades: sortedActiveSnapshots,
        liveKeys: nextActiveSnapshots,
        retainedKeys: visuallyRetainedActiveTradeKeys,
        presentationSignature,
        resolveLevels: resolveTradeLevels,
        nextOffset: nextLevelOffset,
      }) : [];
      const activeSignature = JSON.stringify(activeRenderPlans.map(plan => plan.signature));
      const historyRenderPlans = createHistoryTradeOverlayRenderPlans({
        trades: Array.from(closedTrades.values()),
        presentationSignature: getHistoryContextKey(JSON.stringify([
          presentationSignature, TRADE_HISTORY_PRESENTATION_VERSION,
          brokerAccountSessionScope, positionCloseScope, brokerTimeOffsetSec,
        ])),
        showLines: showTradeHistoryLine,
        showArrows: showTradeHistoryArrows,
        lineOpacity: tradeHistoryLineOpacity,
        resolveLineColor: getClosedTradeLineColor,
      });
      const closedSignature = JSON.stringify(historyRenderPlans.map(plan => plan.signature));
      const sharedOffsets = sharedTrade ? {
        entry: nextLevelOffset('ENTRY', sharedTrade.entryPrice),
        sl: sharedTrade.sl > 0 ? nextLevelOffset('SL', sharedTrade.sl) : 0,
        tp: sharedTrade.tp > 0 ? nextLevelOffset('TP', sharedTrade.tp) : 0,
      } : null;
      const sharedTradeSignature = JSON.stringify([presentationSignature, sharedTrade, sharedOffsets]);
      const nextActiveSignature = [
        normalizedChartSymbol,
        timeframe,
        TRADE_HISTORY_PRESENTATION_VERSION,
        showTradeLevels ? 'levels:on' : 'levels:off',
        sharedTradeSignature,
        activeSignature,
      ].join('\n');
      const nextHistorySignature = [
        normalizedChartSymbol,
        timeframe,
        TRADE_HISTORY_PRESENTATION_VERSION,
        showTradeHistoryLine ? 'history-lines:on' : 'history-lines:off',
        showTradeHistoryArrows ? 'arrows:on' : 'arrows:off',
        `line-opacity:${tradeHistoryLineOpacityPercent}`,
        closedSignature,
      ].join('\n');

      const { activeChanged, historyChanged } = getTradeOverlayRedrawDecision({
        lastActiveSignature: lastActiveTradeOverlaySignatureRef.current,
        nextActiveSignature,
        lastHistorySignature: lastHistoryTradeOverlaySignatureRef.current,
        nextHistorySignature,
        forceActive,
        forceHistory,
      });
      if (!activeChanged && !historyChanged) {
        queueTradeOverlayRelayout();
        return;
      }

      if (activeChanged) {
        const groupPlans: ActiveTradeOverlayGroupPlan[] = [];

        if (showTradeLevels) {
          activeRenderPlans.forEach(({
            trade, levels, isLiveActiveTrade, isVisuallyRetainedTrade, showTradeControls,
            entryStackIndex, slStackIndex, tpStackIndex, signature,
          }) => {
            groupPlans.push({ key: trade.key, signature, create: () => {
              const entryColor = getEntryColor(trade.side);
              const ticketLabel = getTradeTicketLabel(trade.key);
              const entryPriceLabel = formatTradeLevelBadgePrice(trade.entryPrice);
              const markerTitle = `${trade.side} ${trade.volume} ${ticketLabel} @ ${entryPriceLabel}`.trim();
              const activeMarkerTimeKey = getActiveMarkerTimeKey(trade.key);
              let stableActiveMarkerTime = stableActiveMarkerTimesRef.current.get(activeMarkerTimeKey) ?? null;
              if (!(stableActiveMarkerTime != null && stableActiveMarkerTime > 0) && trade.currentTime > 0) {
                stableActiveMarkerTime = trade.currentTime;
                stableActiveMarkerTimesRef.current.set(activeMarkerTimeKey, stableActiveMarkerTime);
              }
              createTradeMarker(
                trade.side,
                trade.entryPrice,
                trade.entryTime,
                markerTitle,
                'active',
                1,
                () => stableActiveMarkerTimesRef.current.get(activeMarkerTimeKey) ?? stableActiveMarkerTime,
              );

              // Keep the control bars rendered while a position momentarily
              // drops out of the store (REST refresh / WS reconnect gaps). A
              // live<->retained flap must not blink the on-chart controls; only
              // the settings toggle or a real close removes them.
              createPriceLevel(
                `${trade.side} ${ticketLabel} ${trade.volume} at ${entryPriceLabel}`.trim(),
                trade.entryPrice,
                entryColor,
                {
                  tradeKey: isLiveActiveTrade ? trade.key : undefined,
                  role: isLiveActiveTrade ? 'ENTRY' : undefined,
                  badgeOffsetIndex: showTradeControls ? 0 : entryStackIndex,
                  title: isLiveActiveTrade ? `${markerTitle}. Drag above/below to create TP or SL.` : markerTitle,
                  getTitle: () => getLocalizedTradeTitle(trade),
                  getLabel: () => `${tr(trade.side)} ${ticketLabel} ${tr('{{value0}} lots', { value0: trade.volume })} @ ${entryPriceLabel}`,
                  // The control bar replaces the plain text label.
                  labelVariant: showTradeControls ? 'none' : 'lineText',
                  lineColor: getEntryLineColor(trade.side),
                },
              );

              if (showTradeControls) {
                createEntryControlsForTrade(trade, levels);
              }

              if (levels.sl && levels.sl > 0) {
                const stopLossPriceLabel = formatTradeLevelBadgePrice(levels.sl);
                createPriceLevel(`SL ${ticketLabel} ${stopLossPriceLabel}`.trim(), levels.sl, TRADE_SELL_COLOR, {
                  tradeKey: isLiveActiveTrade ? trade.key : undefined,
                  role: isLiveActiveTrade ? 'SL' : undefined,
                  badgeOffsetIndex: showTradeControls ? 0 : slStackIndex,
                  title: isVisuallyRetainedTrade
                    ? `Stop Loss for ${ticketLabel || trade.key} @ ${stopLossPriceLabel}. Waiting for position refresh.`
                    : `Stop Loss for ${ticketLabel || trade.key} @ ${stopLossPriceLabel}`,
                  getTitle: () => `${getLocalizedTradeTitle(trade, 'SL', levels.sl)}${isVisuallyRetainedTrade ? ` · ${tr('Loading open positions...')}` : ''}`,
                  getLabel: () => `${tr('SL')} ${ticketLabel} ${stopLossPriceLabel}`,
                  labelVariant: showTradeControls ? 'none' : 'lineText',
                });
                if (showTradeControls) {
                  createLevelControlsForTrade(trade, 'SL', levels);
                }
              }
              if (levels.tp && levels.tp > 0) {
                const takeProfitPriceLabel = formatTradeLevelBadgePrice(levels.tp);
                createPriceLevel(`TP ${ticketLabel} ${takeProfitPriceLabel}`.trim(), levels.tp, TRADE_BUY_COLOR, {
                  tradeKey: isLiveActiveTrade ? trade.key : undefined,
                  role: isLiveActiveTrade ? 'TP' : undefined,
                  badgeOffsetIndex: showTradeControls ? 0 : tpStackIndex,
                  title: isVisuallyRetainedTrade
                    ? `Take Profit for ${ticketLabel || trade.key} @ ${takeProfitPriceLabel}. Waiting for position refresh.`
                    : `Take Profit for ${ticketLabel || trade.key} @ ${takeProfitPriceLabel}`,
                  getTitle: () => `${getLocalizedTradeTitle(trade, 'TP', levels.tp)}${isVisuallyRetainedTrade ? ` · ${tr('Loading open positions...')}` : ''}`,
                  getLabel: () => `${tr('TP')} ${ticketLabel} ${takeProfitPriceLabel}`,
                  labelVariant: showTradeControls ? 'none' : 'lineText',
                });
                if (showTradeControls) {
                  createLevelControlsForTrade(trade, 'TP', levels);
                }
              }
            } });
          });

          // A trade opened from a share link renders as an annotation drawn
          // purely from the URL payload, so the shared view keeps showing the
          // trade even after the position closes. Suppressed while the same
          // ticket is still live (the live control bar already shows it).
          if (sharedTrade && sharedOffsets) {
            groupPlans.push({ key: `shared:${sharedTrade.ticket}`, signature: sharedTradeSignature, create: () => {
              const sharedColor = getEntryLineColor(sharedTrade.side);
              const sharedTicketLabel = sharedTrade.ticket > 0 ? `#${sharedTrade.ticket} ` : '';
              const sharedLabel = `Shared ${sharedTrade.side} ${sharedTicketLabel}${sharedTrade.volume} at ${formatTradeLevelBadgePrice(sharedTrade.entryPrice)}`.trim();
              createPriceLevel(sharedLabel, sharedTrade.entryPrice, sharedColor, {
                badgeOffsetIndex: sharedOffsets.entry,
                title: `${sharedLabel} (from share link)`,
                labelVariant: 'lineText',
                lineColor: sharedColor,
              });
              addTradeAxisPriceLine(`shared:${sharedTrade.ticket}:entry`, sharedTrade.entryPrice, sharedColor);
              if (sharedTrade.entryTime > 0) {
                createTradeMarker(sharedTrade.side, sharedTrade.entryPrice, sharedTrade.entryTime, sharedLabel, 'active', 0.9);
              }
              if (sharedTrade.sl > 0) {
                createPriceLevel(`SL ${formatTradeLevelBadgePrice(sharedTrade.sl)}`, sharedTrade.sl, TRADE_SELL_COLOR, {
                  badgeOffsetIndex: sharedOffsets.sl,
                  title: `Shared Stop Loss @ ${formatTradeLevelBadgePrice(sharedTrade.sl)}`,
                  labelVariant: 'lineText',
                });
              }
              if (sharedTrade.tp > 0) {
                createPriceLevel(`TP ${formatTradeLevelBadgePrice(sharedTrade.tp)}`, sharedTrade.tp, TRADE_BUY_COLOR, {
                  badgeOffsetIndex: sharedOffsets.tp,
                  title: `Shared Take Profit @ ${formatTradeLevelBadgePrice(sharedTrade.tp)}`,
                  labelVariant: 'lineText',
                });
              }
            } });
          }
        }
        activeGroups.reconcile(groupPlans, forceActive);
        lastActiveTradeOverlaySignatureRef.current = nextActiveSignature;
      }

      if (historyChanged) {
        historyGroups.reconcile(historyRenderPlans.map(({ trade, exitSide, lineColor, signature }) => ({
          key: trade.key,
          signature,
          create: () => {
            if (showTradeHistoryLine) {
              createTradeHistoryLine(
                trade.entryPrice,
                trade.entryTime,
                trade.exitPrice,
                trade.exitTime,
                lineColor,
                tradeHistoryLineOpacity,
                // Join the arrow tips when arrows are drawn; otherwise the raw fill prices.
                showTradeHistoryArrows ? { start: trade.side, end: exitSide } : undefined,
              );
            }
            if (showTradeHistoryArrows) {
              const entryPriceLabel = formatTradeLevelBadgePrice(trade.entryPrice);
              createTradeMarker(trade.side, trade.entryPrice, trade.entryTime, entryPriceLabel, 'history', 1, undefined, 'open', trade.side, trade.entryExecutionTime);
              const closePriceLabel = formatTradeLevelBadgePrice(trade.exitPrice);
              createTradeMarker(exitSide, trade.exitPrice, trade.exitTime, closePriceLabel, 'history', 1, undefined, 'close', trade.side, trade.exitExecutionTime);
            }
          },
        })), forceHistory);
        lastHistoryTradeOverlaySignatureRef.current = nextHistorySignature;
      }

      // Clearing and model snapshots remain synchronous; geometry reads/writes
      // coalesce at the next paint with one bounded unresolved-coordinate retry.
      layoutRebuiltTradeOverlay(queueTradeOverlayRelayout);
    };

    const unbindSubscriptions = bindTradeOverlayRuntimeSubscriptions({
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
    });
    return () => {
      runtimeDisposed = true;
      disposeTradeOverlayRelayout();
      activeGroups.dispose();
      historyGroups.dispose();
      if (postInteractionTradeOverlayLayoutRef.current === flushPostInteractionTradeOverlay) postInteractionTradeOverlayLayoutRef.current = null;
      if (committedTradeOverlayLayoutRef.current === projectCommittedTradeOverlayGeometry) committedTradeOverlayLayoutRef.current = null;
      unbindSubscriptions();
    };
  }, [brokerAccountSessionScope, positionCloseScope, brokerTimeOffsetSec, clearTradeOverlayLayer, clearTradeOverlayVisualRuntime, getNearestCandleByTime, hydrateTradeLevelOverrides, isLivePriceSafeForCandles, persistTradeLevelOverrides, resolvedPriceDigits, symbol, timeframe, TRADE_HISTORY_PRESENTATION_VERSION, updateLabelPositions]);
};
