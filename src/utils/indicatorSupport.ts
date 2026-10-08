const SUPPORTED_INDICATOR_IDS = new Set(['ma', 'ema', 'bb', 'rsi', 'macd', 'volume']);

export const isIndicatorSupported = (indicatorId: string): boolean => (
  SUPPORTED_INDICATOR_IDS.has(indicatorId.trim().toLowerCase().split('-')[0])
);
