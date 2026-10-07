import type { BackendCandleTimeframe } from './candleApi';
import { getRemainingTimeframeSeconds } from './timeframeBoundary';
import { getTerminalQuoteClockNowMs, terminalQuoteFreshnessEnabled } from '../services/terminalQuoteFreshness';

// Quotes and cached status timestamps describe past events, not current time.
// Hide the strict-mode countdown until this session's independent clock is
// calibrated. Legacy deployments without that clock retain their source clock.
export const getChartCandleCountdownNowMs = (sourceNowMs: () => number): number => (
  terminalQuoteFreshnessEnabled() ? getTerminalQuoteClockNowMs() ?? Number.NaN : sourceNowMs()
);

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
