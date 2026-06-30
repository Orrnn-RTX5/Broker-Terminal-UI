export interface MarketClosedGapCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  tickVolume?: number;
  realVolume?: number;
  isSynthetic?: boolean;
}

export interface MarketClosedGap {
  startTime: number;
  endTime: number;
  markerTime: number;
  price: number;
  hiddenCandles: number;
}

interface BuildMarketClosedGapSeriesOptions {
  symbol: string;
  timeframe: string;
  brokerOffsetSeconds?: number;
  minGapSeconds?: number;
}

interface ClosedMarketRun {
  startIndex: number;
  endIndex: number;
  price: number;
}

const SECONDS_PER_DAY = 24 * 60 * 60;
const DEFAULT_MIN_GAP_SECONDS = 2 * 60 * 60;
const D1_SECONDS = SECONDS_PER_DAY;

const TIMEFRAME_SECONDS: Record<string, number> = {
  M1: 60,
  M5: 5 * 60,
  M15: 15 * 60,
  M30: 30 * 60,
  H1: 60 * 60,
  H4: 4 * 60 * 60,
  D1: D1_SECONDS,
  W1: 7 * D1_SECONDS,
  MN: 30 * D1_SECONDS,
};

const FRIDAY_CLOSE_HOUR = 22;
const SUNDAY_OPEN_HOUR = 23;

const CRYPTO_BASE_ASSETS = [
  'BTC',
  'XBT',
  'ETH',
  'LTC',
  'XRP',
  'DOGE',
  'SOL',
  'ADA',
  'BNB',
  'DOT',
  'AVAX',
  'TRX',
  'LINK',
  'XLM',
  'BCH',
] as const;

export const getMarketGapTimeframeSeconds = (timeframe: string): number | null => {
  const seconds = TIMEFRAME_SECONDS[timeframe.toUpperCase()];
  return Number.isFinite(seconds) ? seconds : null;
};

export const isCryptoMarketSymbol = (symbol: string): boolean => {
  const normalized = symbol.replace(/[^A-Z0-9]/gi, '').toUpperCase();
  return CRYPTO_BASE_ASSETS.some(asset => normalized.startsWith(asset));
};

const isIntradayNonCryptoMarket = (symbol: string, timeframe: string): boolean => {
  const timeframeSeconds = getMarketGapTimeframeSeconds(timeframe);
  return !!timeframeSeconds && timeframeSeconds < D1_SECONDS && !isCryptoMarketSymbol(symbol);
};

const getBrokerDate = (time: number, brokerOffsetSeconds: number): Date => (
  new Date((time + brokerOffsetSeconds) * 1000)
);

const isStandardWeekendClosedTime = (time: number, brokerOffsetSeconds: number): boolean => {
  if (!Number.isFinite(time)) return false;

  const brokerDate = getBrokerDate(time, brokerOffsetSeconds);
  const weekday = brokerDate.getUTCDay();
  const hour = brokerDate.getUTCHours();
  const minute = brokerDate.getUTCMinutes();
  const second = brokerDate.getUTCSeconds();

  if (weekday === 6) return true;
  if (weekday === 5) {
    return hour > FRIDAY_CLOSE_HOUR || (
      hour === FRIDAY_CLOSE_HOUR &&
      (minute > 0 || second > 0)
    );
  }
  if (weekday === 0) return hour < SUNDAY_OPEN_HOUR;

  return false;
};

const getPriceTolerance = (price: number): number => (
  Math.max(1e-8, Math.abs(price) * 1e-9)
);

const arePricesEqual = (left: number, right: number): boolean => (
  Math.abs(left - right) <= getPriceTolerance(Math.max(Math.abs(left), Math.abs(right)))
);

const getCandleRange = (candle: MarketClosedGapCandle): number => {
  const prices = [candle.open, candle.high, candle.low, candle.close].filter(Number.isFinite);
  if (prices.length !== 4) return Number.POSITIVE_INFINITY;
  return Math.max(...prices) - Math.min(...prices);
};

const getNearFlatTolerance = (price: number): number => (
  Math.max(1e-8, Math.abs(price) * 0.000002)
);

const isFlatDoji = (candle: MarketClosedGapCandle): boolean => (
  Number.isFinite(candle.open) &&
  Number.isFinite(candle.high) &&
  Number.isFinite(candle.low) &&
  Number.isFinite(candle.close) &&
  arePricesEqual(candle.open, candle.high) &&
  arePricesEqual(candle.high, candle.low) &&
  arePricesEqual(candle.low, candle.close)
);

const hasNoTradeVolume = (candle: MarketClosedGapCandle): boolean => (
  [candle.volume, candle.tickVolume, candle.realVolume].every(value => {
    const numericValue = Number(value ?? 0);
    return !Number.isFinite(numericValue) || numericValue <= 0;
  })
);

const isNearFlatCandle = (candle: MarketClosedGapCandle): boolean => {
  const referencePrice = Math.max(Math.abs(candle.open), Math.abs(candle.close), 1);
  return getCandleRange(candle) <= getNearFlatTolerance(referencePrice);
};

const isMarketClosedRunCandidateCandle = (candle: MarketClosedGapCandle): boolean => {
  if (candle.isSynthetic === true) return true;
  return isFlatDoji(candle) || isNearFlatCandle(candle);
};

const areClosedRunPricesCompatible = (
  runPrice: number,
  candle: MarketClosedGapCandle,
): boolean => {
  if (!Number.isFinite(runPrice) || !Number.isFinite(candle.close)) return false;
  const tolerance = Math.max(getNearFlatTolerance(Math.max(Math.abs(runPrice), Math.abs(candle.close), 1)), getPriceTolerance(runPrice) * 10);
  return Math.abs(candle.close - runPrice) <= tolerance;
};

export const isMarketClosedPlaceholderCandle = (candle: MarketClosedGapCandle): boolean => {
  if (candle.isSynthetic === true) return true;
  return hasNoTradeVolume(candle) && isMarketClosedRunCandidateCandle(candle);
};

export const isPotentialMarketClosedPlaceholderCandle = (
  candle: MarketClosedGapCandle,
  options: {
    symbol: string;
    timeframe: string;
    brokerOffsetSeconds?: number;
  },
): boolean => {
  if (!isIntradayNonCryptoMarket(options.symbol, options.timeframe)) {
    return false;
  }

  const brokerOffsetSeconds = Number.isFinite(options.brokerOffsetSeconds)
    ? options.brokerOffsetSeconds ?? 0
    : 0;
  if (isStandardWeekendClosedTime(candle.time, brokerOffsetSeconds)) return true;

  const brokerTime = candle.time + brokerOffsetSeconds;
  const weekday = new Date(brokerTime * 1000).getUTCDay();
  if (weekday !== 0 && weekday !== 6) return false;
  return isMarketClosedPlaceholderCandle(candle) || isMarketClosedRunCandidateCandle(candle);
};

const spanTouchesWeekend = (startTime: number, endTime: number, brokerOffsetSeconds: number): boolean => {
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return false;

  const start = Math.floor((Math.min(startTime, endTime) + brokerOffsetSeconds) / SECONDS_PER_DAY);
  const end = Math.floor((Math.max(startTime, endTime) + brokerOffsetSeconds) / SECONDS_PER_DAY);
  const boundedEnd = Math.min(end, start + 14);

  for (let day = start; day <= boundedEnd; day += 1) {
    const weekday = new Date(day * SECONDS_PER_DAY * 1000).getUTCDay();
    if (weekday === 0 || weekday === 6) return true;
  }

  return false;
};

const collectClosedMarketRun = (
  candles: readonly MarketClosedGapCandle[],
  startIndex: number,
  brokerOffsetSeconds: number,
): ClosedMarketRun => {
  const first = candles[startIndex];
  const isScheduleClosedRun = isStandardWeekendClosedTime(first.time, brokerOffsetSeconds);
  let endIndex = startIndex;

  while (
    endIndex + 1 < candles.length &&
    (
      isScheduleClosedRun
        ? isStandardWeekendClosedTime(candles[endIndex + 1].time, brokerOffsetSeconds)
        : (
          isMarketClosedRunCandidateCandle(candles[endIndex + 1]) &&
          areClosedRunPricesCompatible(first.close, candles[endIndex + 1])
        )
    )
  ) {
    endIndex += 1;
  }

  return {
    startIndex,
    endIndex,
    price: first.close,
  };
};

export const buildMarketClosedGapSeries = <TCandle extends MarketClosedGapCandle>(
  candles: readonly TCandle[],
  options: BuildMarketClosedGapSeriesOptions,
): { candles: TCandle[]; gaps: MarketClosedGap[] } => {
  const timeframeSeconds = getMarketGapTimeframeSeconds(options.timeframe);
  if (
    !timeframeSeconds ||
    timeframeSeconds >= D1_SECONDS ||
    isCryptoMarketSymbol(options.symbol)
  ) {
    return { candles: [...candles], gaps: [] };
  }

  const sortedCandles = [...candles].sort((a, b) => a.time - b.time);
  const brokerOffsetSeconds = Number.isFinite(options.brokerOffsetSeconds)
    ? options.brokerOffsetSeconds ?? 0
    : 0;
  const minGapSeconds = Math.max(
    timeframeSeconds,
    options.minGapSeconds ?? DEFAULT_MIN_GAP_SECONDS,
  );
  const renderedCandles: TCandle[] = [];
  const gaps: MarketClosedGap[] = [];

  let index = 0;
  while (index < sortedCandles.length) {
    const candle = sortedCandles[index];
    const isScheduleClosedCandle = isStandardWeekendClosedTime(candle.time, brokerOffsetSeconds);
    if (!isScheduleClosedCandle && !isMarketClosedRunCandidateCandle(candle)) {
      renderedCandles.push(candle);
      index += 1;
      continue;
    }

    const run = collectClosedMarketRun(sortedCandles, index, brokerOffsetSeconds);
    const runStart = sortedCandles[run.startIndex];
    const runEnd = sortedCandles[run.endIndex];
    const previous = renderedCandles[renderedCandles.length - 1];
    const next = sortedCandles[run.endIndex + 1];
    const hiddenCandles = run.endIndex - run.startIndex + 1;
    const runSeconds = (runEnd.time - runStart.time) + timeframeSeconds;
    const minimumHiddenCandles = Math.max(2, Math.ceil(minGapSeconds / timeframeSeconds));
    const touchesWeekend = isScheduleClosedCandle || spanTouchesWeekend(runStart.time, runEnd.time, brokerOffsetSeconds);
    const isBoundaryRun = !previous || !next;
    const shouldHideLongWeekendRun = runSeconds >= minGapSeconds &&
      hiddenCandles >= minimumHiddenCandles;
    const shouldHideRun = touchesWeekend &&
      (shouldHideLongWeekendRun || isBoundaryRun);

    if (shouldHideRun) {
      if (previous && next) {
        gaps.push({
          startTime: previous.time,
          endTime: next.time,
          markerTime: Math.max(runStart.time, next.time - timeframeSeconds),
          price: run.price,
          hiddenCandles,
        });
      }
    } else {
      for (let runIndex = run.startIndex; runIndex <= run.endIndex; runIndex += 1) {
        renderedCandles.push(sortedCandles[runIndex]);
      }
    }

    index = run.endIndex + 1;
  }

  return { candles: renderedCandles, gaps };
};
