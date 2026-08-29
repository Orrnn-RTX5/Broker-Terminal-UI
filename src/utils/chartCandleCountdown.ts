import type { BackendCandleTimeframe } from './candleApi';
import { getRemainingTimeframeSeconds } from './timeframeBoundary';

export const formatChartCandleCountdown = (remainingSeconds: number): string => {
  const totalSeconds = Math.max(0, Math.floor(remainingSeconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const hh = hours.toString().padStart(2, '0');
  const mm = minutes.toString().padStart(2, '0');
  const ss = seconds.toString().padStart(2, '0');

  if (hours > 0) return `${hh}:${mm}:${ss}`;
  return `${mm}:${ss}`;
};

export const getChartCandleCountdownText = (
  nowMs: number,
  timeframe: BackendCandleTimeframe,
  boundaryOffsetSeconds = 0,
): string => {
  if (!Number.isFinite(nowMs)) return '';
  const remainingSeconds = getRemainingTimeframeSeconds(
    nowMs / 1000,
    timeframe,
    boundaryOffsetSeconds,
  );
  return remainingSeconds === null ? '' : formatChartCandleCountdown(remainingSeconds);
};
