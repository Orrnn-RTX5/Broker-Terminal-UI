/**
 * useLiveCandleStream — React hook for Section 3 (Chart Candle /ws/v2)
 *
 * Wraps CandleSocketManager with ref-counted subscriptions.
 * Merges live candle updates with REST history via candleAggregationService.
 *
 * Usage:
 *   const { candles, isConnected, lastUpdate } = useLiveCandleStream('EURUSD', 'M1');
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getCandleSocketManager, type CandlePayload } from '../services/candleSocketManager';
import {
  candleAggregationService,
  type CandleData,
  type Timeframe,
} from '../services/candleAggregationService';
import { useAppStore } from '../store/useAppStore';
import { normalizeBrokerTimestampSeconds } from '../utils/brokerStreamSemantics';

const VALID_TIMEFRAMES: Timeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1', 'MN'];

function toValidTimeframe(tf: string): Timeframe {
  const upper = tf.toUpperCase();
  return VALID_TIMEFRAMES.includes(upper as Timeframe) ? (upper as Timeframe) : 'M1';
}

export interface UseLiveCandleStreamReturn {
  candles: CandleData[];
  isConnected: boolean;
  lastUpdate: number | null;
}

export function useLiveCandleStream(
  symbol: string,
  timeframe: string,
  onCandleUpdate?: (candle: CandleData) => void,
): UseLiveCandleStreamReturn {
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const [candles, setCandles] = useState<CandleData[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);

  const onCandleUpdateRef = useRef(onCandleUpdate);
  onCandleUpdateRef.current = onCandleUpdate;

  const validTimeframe = toValidTimeframe(timeframe);

  // Step 8: Canonical candle engine — ingest live candle
  const handleCandle = useCallback((payload: CandlePayload) => {
    // FIX: Accept every broker epoch precision at this legacy hook boundary.
    // CandleSocketManager already normalizes this today, but keeping the hook
    // canonical prevents a future/direct adapter from shifting a bucket time.
    const time = normalizeBrokerTimestampSeconds(payload.time);
    if (time === undefined) return;

    // Normalize to CandleData format
    const candle: CandleData = {
      time,
      open: payload.open,
      high: payload.high,
      low: payload.low,
      close: payload.close,
      volume: payload.volume,
      // FIX: Preserve authoritative backend finality instead of reopening every
      // server-final candle as a mutable forming bucket.
      isComplete: payload.closed === true,
    };

    // FIX: A forming server update must remain mutable. Only an explicit
    // canonical finality=true is committed through the completed-candle path;
    // missing finality fails safe as partial instead of freezing live OHLC.
    candleAggregationService.reconcileServerCandle(
      symbol,
      validTimeframe,
      candle,
      payload.closed === true,
    );

    // Get merged candles (REST history + live)
    const merged = candleAggregationService
      .getCandles(symbol, validTimeframe, true, false)
      .filter(candle => !candle.isSynthetic);
    setCandles(merged);
    setLastUpdate(Date.now());

    // Notify callback
    onCandleUpdateRef.current?.(candle);
  }, [symbol, validTimeframe]);

  // Step 7: Quote tick extension — tick moves active candle
  const handleTick = useCallback((tick: { symbol: string; bid: number; ask: number; timestamp: number }) => {
    const tickData = {
      symbol: tick.symbol,
      bid: tick.bid,
      ask: tick.ask,
      timestamp: tick.timestamp,
      volume: 1,
    };

    // Process through aggregation service (updates the active candle)
    candleAggregationService.processTick(tickData);

    // Get updated candles
    const merged = candleAggregationService
      .getCandles(symbol, validTimeframe, true, false)
      .filter(candle => !candle.isSynthetic);
    if (merged.length > 0) {
      setCandles(merged);
      setLastUpdate(Date.now());
      onCandleUpdateRef.current?.(merged[merged.length - 1]);
    }
  }, [symbol, validTimeframe]);

  // Step 2: Subscribe hook — runs on mount/change
  useEffect(() => {
    if (!isAuthenticated || !symbol) return;

    const manager = getCandleSocketManager();
    setIsConnected(manager.isConnected());

    // Step 3: Candle service demand — deduplicated by SYMBOL.TIMEFRAME key
    const { unsubscribe } = manager.subscribe(
      symbol,
      validTimeframe,
      handleCandle,
      handleTick,
    );

    return () => {
      unsubscribe();
    };
  }, [symbol, validTimeframe, isAuthenticated, handleCandle, handleTick]);

  return { candles, isConnected, lastUpdate };
}
