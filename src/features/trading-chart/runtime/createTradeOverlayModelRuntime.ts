import type { RefObject } from 'react';
import type { IChartApi, Time } from 'lightweight-charts';
import { getTimeframeSeconds, type Timeframe as AggTimeframe } from '../../../services/candleAggregationService';
import { useAppStore, type Tick } from '../../../store/useAppStore';
import { alignTimeframeBoundarySeconds } from '../../../utils/timeframeBoundary';
import { createTradeLevelOverrideFingerprint } from '../../../utils/tradeLevelDrag';
import {
  buildOptimisticClosedTradeSnapshot,
  type TradeOverlayCloseSnapshotSeed,
} from '../../../services/tradeOverlayHistory';
import type { Candle, Timeframe, TradingViewChartTheme } from '../../../types/chart';
import type { ChartPostInteractionCoordinator } from '../../../utils/chartPostInteractionCoordinator';
import type { TradeSide } from '../presentation/tradeOverlayPresentation';
import {
  getFrozenEntryTimeKey,
  TRADE_BUY_COLOR,
  TRADE_SELL_COLOR,
} from './tradeOverlayRuntimeConstants';
import type {
  ActiveTradeSnapshot,
  ClosedTradeSnapshot,
  TradeLevelModifyRequestId,
  TradeLevelOverride,
} from './tradeRuntimeContracts';

interface CreateTradeOverlayModelRuntimeOptions {
  brokerTimeOffsetSec: number;
  candlesRef: RefObject<Candle[]>;
  chartRef: RefObject<IChartApi | null>;
  chartThemeRef: RefObject<TradingViewChartTheme>;
  currentCandleRef: RefObject<Candle | null>;
  digits: number;
  getNearestCandleByTime: (time: number, maxDistanceSeconds?: number) => Candle | null;
  isChartInteractionActiveRef: RefObject<boolean>;
  isLivePriceSafeForCandles: (price: number) => boolean;
  pendingTradeLevelModifyRequestsRef: RefObject<Map<string, TradeLevelModifyRequestId>>;
  persistTradeLevelOverrides: () => void;
  postInteractionCoordinatorRef: RefObject<ChartPostInteractionCoordinator | null>;
  prevTimeframeRef: RefObject<Timeframe>;
  stableActiveMarkerTimesRef: RefObject<Map<number | string, number>>;
  symbol: string;
  timeframe: Timeframe;
  tradeHistoryRefreshTimerRef: RefObject<number | null>;
  tradeLevelLastKnownLevelsRef: RefObject<Map<string, TradeLevelOverride>>;
  tradeLevelOptimisticGraceUntilRef: RefObject<Map<string, number>>;
  tradeLevelOverridesRef: RefObject<Map<string, TradeLevelOverride>>;
  tradeOverlayRafRef: RefObject<number | null>;
  updateLabelPositions: (refreshMetrics?: boolean) => boolean;
}

export const createTradeOverlayModelRuntime = ({
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
}: CreateTradeOverlayModelRuntimeOptions) => {
    const queueTradeOverlayRelayout = () => {
      if (isChartInteractionActiveRef.current) {
        postInteractionCoordinatorRef.current?.request({ overlay: true });
        return;
      }

      if (tradeOverlayRafRef.current !== null) return;
      tradeOverlayRafRef.current = requestAnimationFrame(() => {
        tradeOverlayRafRef.current = null;
        updateLabelPositions();
      });
    };

    const normalizeUnixSeconds = (value: unknown): number | null => {
      if (value == null || value === '') return null;
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value > 1_000_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
      }
      if (typeof value === 'string') {
        const numeric = Number(value);
        if (Number.isFinite(numeric) && value.trim() !== '') {
          return numeric > 1_000_000_000_000 ? Math.floor(numeric / 1000) : Math.floor(numeric);
        }
        const parsed = new Date(value).getTime();
        return Number.isNaN(parsed) ? null : Math.floor(parsed / 1000);
      }
      return null;
    };

    const pickPositiveNumber = (...values: unknown[]): number => {
      for (const value of values) {
        const numeric = Number(value);
        if (Number.isFinite(numeric) && numeric > 0) return numeric;
      }
      return 0;
    };

    const getTradeTicketLabel = (tradeKey: string): string => {
      const ticket = tradeKey.replace(/^trade:/, '');
      return ticket ? `#${ticket}` : '';
    };

    const formatTradeLevelBadgePrice = (price: number): string => price.toFixed(digits);

    const formatSignaturePrice = (value?: number): string => (Number(value) || 0).toFixed(digits);

    const priceTolerance = Math.max(Math.pow(10, -digits), Number.EPSILON);

    const resolveSymbolTick = (ticks: Record<string, Tick>) => {
      if (ticks[symbol]) return ticks[symbol];
      if (ticks[symbol.toUpperCase()]) return ticks[symbol.toUpperCase()];
      return null;
    };

    const mapTradeTimestampToChartTime = (
      rawTimestamp: unknown,
      lookup = getNearestCandleByTime,
    ): number | null => {
      const normalizedTimestamp = normalizeUnixSeconds(rawTimestamp);
      if (normalizedTimestamp == null) return null;

      const activeTf = prevTimeframeRef.current || timeframe;
      const timeframeSeconds = getTimeframeSeconds(activeTf as AggTimeframe);
      if (!Number.isFinite(timeframeSeconds) || timeframeSeconds <= 0) return normalizedTimestamp;

      if (candlesRef.current.length === 0) {
        return alignTimeframeBoundarySeconds(normalizedTimestamp, activeTf as AggTimeframe, timeframeSeconds);
      }

      const candidates = new Set<number>();
      const addCandidate = (value: number | null) => {
        if (value == null || !Number.isFinite(value)) return;
        candidates.add(alignTimeframeBoundarySeconds(value, activeTf as AggTimeframe, timeframeSeconds));
      };

      addCandidate(normalizedTimestamp);
      if (brokerTimeOffsetSec !== 0) {
        addCandidate(normalizedTimestamp - brokerTimeOffsetSec);
        addCandidate(normalizedTimestamp + brokerTimeOffsetSec);
      }

      let bestTime: number | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;

      for (const candidate of candidates) {
        const nearest = lookup(candidate, timeframeSeconds);
        if (!nearest) continue;
        const distance = Math.abs(nearest.time - candidate);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestTime = nearest.time;
        }
      }

      return bestTime ?? alignTimeframeBoundarySeconds(normalizedTimestamp, activeTf as AggTimeframe, timeframeSeconds);
    };

    const getEntryColor = (side: TradeSide) => side === 'BUY' ? TRADE_BUY_COLOR : TRADE_SELL_COLOR;
    const getClosedTradeLineColor = (trade: ClosedTradeSnapshot) => {
      const profit = trade.profit ?? (
        trade.side === 'BUY'
          ? trade.exitPrice - trade.entryPrice
          : trade.entryPrice - trade.exitPrice
      );
      return profit >= 0 ? chartThemeRef.current.candleUp : chartThemeRef.current.candleDown;
    };
    const getLiveTrailTime = () =>
      currentCandleRef.current?.time
      ?? candlesRef.current[candlesRef.current.length - 1]?.time
      ?? null;
    const getActiveMarkerTimeKey = (tradeKey: string) =>
      getFrozenEntryTimeKey(`${tradeKey}:marker`, prevTimeframeRef.current || timeframe);
    const getStoredActiveMarkerTime = (tradeKey: string): number | null => {
      const storedTime = stableActiveMarkerTimesRef.current.get(getActiveMarkerTimeKey(tradeKey));
      return storedTime != null && Number.isFinite(storedTime) && storedTime > 0 ? storedTime : null;
    };
    const canResolveOverlayTime = (time: unknown): boolean => {
      const numericTime = Number(time);
      if (!Number.isFinite(numericTime) || numericTime <= 0) return false;

      const directCoordinate = chartRef.current?.timeScale().timeToCoordinate(numericTime as Time);
      if (directCoordinate != null) return true;

      const activeTf = prevTimeframeRef.current || timeframe;
      const timeframeSeconds = getTimeframeSeconds(activeTf as AggTimeframe);
      return Boolean(getNearestCandleByTime(
        numericTime,
        Number.isFinite(timeframeSeconds) && timeframeSeconds > 0 ? timeframeSeconds : undefined,
      ));
    };
    const resolveClosedEntryTime = (trade: ActiveTradeSnapshot): number => {
      if (canResolveOverlayTime(trade.entryTime)) return trade.entryTime;

      const storedMarkerTime = getStoredActiveMarkerTime(trade.key);
      if (storedMarkerTime != null && canResolveOverlayTime(storedMarkerTime)) {
        return storedMarkerTime;
      }

      return trade.entryTime;
    };
    const getLiveTrailPrice = (side: TradeSide, fallbackPrice: number): number | null => {
      const tick = resolveSymbolTick(useAppStore.getState().ticks);
      const quote = side === 'BUY'
        ? Number(tick?.bid ?? tick?.last ?? 0)
        : Number(tick?.ask ?? tick?.bid ?? tick?.last ?? 0);
      if (quote > 0 && isLivePriceSafeForCandles(quote)) return quote;
      return fallbackPrice > 0 ? fallbackPrice : null;
    };
    const resolveCloseSnapshotOverlayTime = (rawTime: unknown, fallbackTime?: number | null): number => {
      const mappedTime = mapTradeTimestampToChartTime(rawTime);
      if (mappedTime != null && canResolveOverlayTime(mappedTime)) return mappedTime;

      const normalizedTime = normalizeUnixSeconds(rawTime);
      if (normalizedTime != null && canResolveOverlayTime(normalizedTime)) return normalizedTime;

      if (fallbackTime != null && Number.isFinite(fallbackTime) && fallbackTime > 0) {
        return fallbackTime;
      }

      return mappedTime ?? normalizedTime ?? 0;
    };
    const buildImmediateClosedTrade = (
      trade: ActiveTradeSnapshot,
      existingTrade?: ClosedTradeSnapshot | null,
    ): ClosedTradeSnapshot | null => {
      const exitPrice = existingTrade?.exitPrice
        ?? getLiveTrailPrice(trade.side, trade.currentPrice || trade.entryPrice)
        ?? trade.currentPrice
        ?? trade.entryPrice;
      const exitTime = existingTrade?.exitTime
        ?? getLiveTrailTime()
        ?? trade.currentTime
        ?? trade.entryTime;
      return buildOptimisticClosedTradeSnapshot({
        key: trade.key,
        symbol: trade.symbol,
        side: trade.side,
        volume: trade.volume,
        entryPrice: existingTrade?.entryPrice ?? trade.entryPrice,
        entryTime: existingTrade?.entryTime ?? resolveClosedEntryTime(trade),
        entryExecutionTime: existingTrade?.entryExecutionTime ?? trade.entryExecutionTime,
        exitPrice,
        exitTime,
        exitExecutionTime: existingTrade?.exitExecutionTime ?? normalizeUnixSeconds(Date.now()) ?? exitTime,
        profit: existingTrade?.profit,
      });
    };
    const buildClosedTradeFromEventSnapshot = (
      snapshot: TradeOverlayCloseSnapshotSeed,
      capturedTrade?: ActiveTradeSnapshot | null,
      existingTrade?: ClosedTradeSnapshot | null,
    ): ClosedTradeSnapshot | null => {
      const entryFallbackTime = existingTrade?.entryTime
        ?? (capturedTrade ? resolveClosedEntryTime(capturedTrade) : null);
      const entryTime = existingTrade?.entryTime
        ?? resolveCloseSnapshotOverlayTime(snapshot.entryTime, entryFallbackTime);
      const exitFallbackTime = existingTrade?.exitTime
        ?? getLiveTrailTime()
        ?? capturedTrade?.currentTime
        ?? entryTime;
      const exitTime = existingTrade?.exitTime
        ?? resolveCloseSnapshotOverlayTime(snapshot.exitTime, exitFallbackTime);

      return buildOptimisticClosedTradeSnapshot({
        ...snapshot,
        entryPrice: existingTrade?.entryPrice ?? snapshot.entryPrice,
        entryTime,
        entryExecutionTime: snapshot.entryExecutionTime ?? existingTrade?.entryExecutionTime ?? snapshot.entryTime,
        exitPrice: existingTrade?.exitPrice ?? snapshot.exitPrice,
        exitTime,
        exitExecutionTime: snapshot.exitExecutionTime ?? existingTrade?.exitExecutionTime ?? snapshot.exitTime,
        profit: snapshot.profit ?? existingTrade?.profit,
      });
    };
    const mapStoredClosedTradeToChart = (trade: ClosedTradeSnapshot): ClosedTradeSnapshot | null => (
      buildOptimisticClosedTradeSnapshot({
        key: trade.key,
        symbol: trade.symbol,
        side: trade.side,
        volume: trade.volume,
        entryPrice: trade.entryPrice,
        entryTime: resolveCloseSnapshotOverlayTime(trade.entryExecutionTime, trade.entryTime),
        entryExecutionTime: trade.entryExecutionTime,
        exitPrice: trade.exitPrice,
        exitTime: resolveCloseSnapshotOverlayTime(trade.exitExecutionTime, trade.exitTime),
        exitExecutionTime: trade.exitExecutionTime,
        profit: trade.profit,
      })
    );
    const requestTradeHistoryRefresh = () => {
      const login = Number.parseInt(String(useAppStore.getState().accountId ?? ''), 10);
      if (!Number.isFinite(login) || login <= 0) return;
      window.dispatchEvent(new CustomEvent('rtx:refresh-trade-history-requested', {
        detail: { login },
      }));
    };
    const scheduleHistoryRefresh = () => {
      if (tradeHistoryRefreshTimerRef.current !== null) {
        window.clearTimeout(tradeHistoryRefreshTimerRef.current);
      }
      tradeHistoryRefreshTimerRef.current = window.setTimeout(() => {
        tradeHistoryRefreshTimerRef.current = null;
        requestTradeHistoryRefresh();
      }, 350);
    };

    const getTradeLevelStateKeys = (trade: ActiveTradeSnapshot): string[] => {
      const fingerprint = createTradeLevelOverrideFingerprint({
        symbol: trade.symbol,
        side: trade.side,
        volume: trade.volume,
        entryPrice: trade.entryPrice,
        entryTime: trade.entryTime,
        digits,
      });
      return Array.from(new Set([trade.key, fingerprint]));
    };

    const getTradeLevelState = (
      state: Map<string, TradeLevelOverride>,
      trade: ActiveTradeSnapshot,
    ): TradeLevelOverride | undefined => {
      for (const key of getTradeLevelStateKeys(trade)) {
        const levels = state.get(key);
        if (!levels) continue;
        if (key !== trade.key) state.set(trade.key, levels);
        return levels;
      }
      return undefined;
    };

    const setTradeLevelState = (
      state: Map<string, TradeLevelOverride>,
      trade: ActiveTradeSnapshot,
      levels: TradeLevelOverride,
    ) => {
      getTradeLevelStateKeys(trade).forEach((key) => state.set(key, levels));
    };

    const deleteTradeLevelState = (
      state: Map<string, TradeLevelOverride>,
      trade: ActiveTradeSnapshot,
    ) => {
      getTradeLevelStateKeys(trade).forEach((key) => state.delete(key));
    };

    const deleteTradeLevelStateByKey = (
      state: Map<string, TradeLevelOverride>,
      key: string,
    ): boolean => state.delete(key);

    const clearTradeLevelRuntimeState = (trade: ActiveTradeSnapshot): boolean => {
      let changed = false;
      getTradeLevelStateKeys(trade).forEach((key) => {
        changed = deleteTradeLevelStateByKey(tradeLevelOverridesRef.current, key) || changed;
        changed = deleteTradeLevelStateByKey(tradeLevelLastKnownLevelsRef.current, key) || changed;
        pendingTradeLevelModifyRequestsRef.current.delete(key);
        tradeLevelOptimisticGraceUntilRef.current.delete(key);
      });
      return changed;
    };

    const clearTradeLevelRuntimeStateByKey = (key: string): boolean => {
      pendingTradeLevelModifyRequestsRef.current.delete(key);
      tradeLevelOptimisticGraceUntilRef.current.delete(key);
      const overrideDeleted = tradeLevelOverridesRef.current.delete(key);
      const lastKnownDeleted = tradeLevelLastKnownLevelsRef.current.delete(key);
      return overrideDeleted || lastKnownDeleted;
    };

    const hasPendingTradeLevelModifyRequest = (trade: ActiveTradeSnapshot): boolean =>
      getTradeLevelStateKeys(trade).some((key) => pendingTradeLevelModifyRequestsRef.current.has(key));

    const hasRecentTradeLevelModifyGrace = (trade: ActiveTradeSnapshot): boolean => {
      let hasGrace = false;
      const nowMs = Date.now();
      getTradeLevelStateKeys(trade).forEach((key) => {
        const expiresAt = tradeLevelOptimisticGraceUntilRef.current.get(key);
        if (!expiresAt) return;
        if (expiresAt > nowMs) {
          hasGrace = true;
        } else {
          tradeLevelOptimisticGraceUntilRef.current.delete(key);
        }
      });
      return hasGrace;
    };

    const rememberTradeLevels = (trade: ActiveTradeSnapshot, levels: TradeLevelOverride) => {
      const normalized = {
        sl: levels.sl > 0 ? levels.sl : 0,
        tp: levels.tp > 0 ? levels.tp : 0,
      };
      if (normalized.sl > 0 || normalized.tp > 0) {
        setTradeLevelState(tradeLevelLastKnownLevelsRef.current, trade, normalized);
      } else if (!hasPendingTradeLevelModifyRequest(trade)) {
        deleteTradeLevelState(tradeLevelLastKnownLevelsRef.current, trade);
      }
    };

    const resolveTradeLevels = (trade: ActiveTradeSnapshot): TradeLevelOverride => {
      const override = getTradeLevelState(tradeLevelOverridesRef.current, trade);
      if (!override) {
        const serverLevels = { sl: trade.sl || 0, tp: trade.tp || 0 };
        const lastKnownLevels = getTradeLevelState(tradeLevelLastKnownLevelsRef.current, trade);
        const hasRecentGrace = hasRecentTradeLevelModifyGrace(trade);
        const levels = hasRecentGrace && lastKnownLevels
          ? {
            sl: serverLevels.sl > 0 ? serverLevels.sl : lastKnownLevels.sl || 0,
            tp: serverLevels.tp > 0 ? serverLevels.tp : lastKnownLevels.tp || 0,
          }
          : serverLevels;
        rememberTradeLevels(trade, levels);
        return levels;
      }

      const serverSl = trade.sl || 0;
      const serverTp = trade.tp || 0;
      const overrideSl = override.sl || 0;
      const overrideTp = override.tp || 0;
      // A zero override normally means "role untouched" and defers to the
      // server. While a modify request is pending (or in its optimistic grace
      // window) it instead means "level removed", so the stale server value
      // must stay suppressed until the backend confirms the removal.
      const hasActiveModifyWindow = hasPendingTradeLevelModifyRequest(trade) || hasRecentTradeLevelModifyGrace(trade);
      const slRemovalPending = overrideSl <= 0 && serverSl > 0 && hasActiveModifyWindow;
      const tpRemovalPending = overrideTp <= 0 && serverTp > 0 && hasActiveModifyWindow;
      const slSynced = (overrideSl <= 0 && !slRemovalPending) || (serverSl > 0 && Math.abs(serverSl - overrideSl) <= priceTolerance);
      const tpSynced = (overrideTp <= 0 && !tpRemovalPending) || (serverTp > 0 && Math.abs(serverTp - overrideTp) <= priceTolerance);

      if (slSynced && tpSynced) {
        rememberTradeLevels(trade, { sl: serverSl, tp: serverTp });
        deleteTradeLevelState(tradeLevelOverridesRef.current, trade);
        persistTradeLevelOverrides();
        return { sl: serverSl, tp: serverTp };
      }

      const levels = {
        sl: overrideSl > 0 ? overrideSl : slRemovalPending ? 0 : serverSl,
        tp: overrideTp > 0 ? overrideTp : tpRemovalPending ? 0 : serverTp,
      };
      rememberTradeLevels(trade, levels);
      return levels;
    };


  return {
    queueTradeOverlayRelayout,
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
    formatSignaturePrice,
    priceTolerance,
  };
};
