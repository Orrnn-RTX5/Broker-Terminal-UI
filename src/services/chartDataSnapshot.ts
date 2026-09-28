import type { Candle } from '../types/chart';

export interface ChartDataSnapshot {
  symbol: string;
  timeframe: string;
  digits: number;
  date: string;
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tickVolume?: number;
  spread?: number;
}

export function createChartDataSnapshot(candle: Candle | null, symbol: string, timeframe: string, digits: number, offsetSeconds = 0): ChartDataSnapshot | null {
  if (!candle || ![candle.time, candle.open, candle.high, candle.low, candle.close].every(Number.isFinite)) return null;
  const date = new Date((candle.time + offsetSeconds) * 1000);
  if (!Number.isFinite(date.getTime())) return null;
  const stamp = date.toISOString();
  return {
    symbol, timeframe, digits, date: stamp.slice(0, 10), time: stamp.slice(11, 19),
    open: candle.open, high: candle.high, low: candle.low, close: candle.close,
    volume: candle.realVolume ?? candle.volume, tickVolume: candle.tickVolume,
    // Historical spread is not supplied by the candle API; do not invent zero.
  };
}
