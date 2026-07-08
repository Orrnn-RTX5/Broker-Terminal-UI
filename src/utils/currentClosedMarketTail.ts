export interface CurrentClosedMarketRenderCandle {
  time: number;
}

export interface CurrentClosedMarketRenderFilterOptions {
  isMarketClosed: boolean;
  sessionCloseTimeMs?: number | null;
}

export function getCurrentClosedMarketSessionCloseSeconds(
  sessionCloseTimeMs?: number | null,
): number | null {
  if (typeof sessionCloseTimeMs !== 'number' || !Number.isFinite(sessionCloseTimeMs) || sessionCloseTimeMs <= 0) {
    return null;
  }

  const timestampMs = sessionCloseTimeMs < 1_000_000_000_000
    ? sessionCloseTimeMs * 1000
    : sessionCloseTimeMs;

  return Math.floor(timestampMs / 1000);
}

export function getCurrentClosedMarketRenderCandles<TCandle extends CurrentClosedMarketRenderCandle>(
  candles: readonly TCandle[],
  options: CurrentClosedMarketRenderFilterOptions,
): TCandle[] {
  const candleList = [...candles];

  if (!options.isMarketClosed) {
    return candleList;
  }

  const sessionCloseSeconds = getCurrentClosedMarketSessionCloseSeconds(options.sessionCloseTimeMs);
  if (sessionCloseSeconds === null) {
    return candleList;
  }

  return candleList.filter((candle) => !Number.isFinite(candle.time) || candle.time < sessionCloseSeconds);
}
