export interface PriceCandle {
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface CandleReferenceResult<T extends PriceCandle> {
  candles: T[];
  status: 'compatible' | 'scaled' | 'incompatible' | 'no-reference';
  factor: number;
}

export interface LiveQuoteGuardState {
  lastAcceptedQuote: number | null;
  incompatibleQuoteCount: number;
}

export interface LiveQuoteGuardResult {
  state: LiveQuoteGuardState;
  shouldDropCandles: boolean;
}

export interface LiveQuoteGuardOptions {
  dropThreshold?: number;
  allowDrop?: boolean;
}

export interface RenderedPriceReference {
  price: number | null;
  candleCount: number;
}

export interface LiveQuoteDropEligibility {
  hasDisplayedHistory: boolean;
  protectedHistoryCount: number;
  currentHistoryCount: number;
}

interface ChartQuoteLike {
  bid?: unknown;
  ask?: unknown;
  last?: unknown;
}

const COMPATIBLE_RATIO_LIMIT = 4;
const POWER_OF_TEN_TOLERANCE = 0.02;
const MAX_SCALE_POWER = 8;
const DEFAULT_INCOMPATIBLE_QUOTE_DROP_THRESHOLD = 3;

const isFinitePositive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

export const getChartPriceFromQuote = (quote: ChartQuoteLike | null | undefined): number | null => {
  if (!quote) return null;

  const bid = Number(quote.bid);
  const ask = Number(quote.ask);
  const last = Number(quote.last);
  if (isFinitePositive(bid)) return bid;
  if (isFinitePositive(ask)) return ask;
  return isFinitePositive(last) ? last : null;
};

export const getTradeEntryPriceFromQuote = (
  quote: ChartQuoteLike | null | undefined,
  side: 'BUY' | 'SELL',
): number | null => {
  if (!quote) return null;

  const bid = Number(quote.bid);
  const ask = Number(quote.ask);
  const last = Number(quote.last);

  if (side === 'BUY') {
    if (isFinitePositive(ask)) return ask;
    if (isFinitePositive(bid)) return bid;
    return isFinitePositive(last) ? last : null;
  }

  if (isFinitePositive(bid)) return bid;
  if (isFinitePositive(ask)) return ask;
  return isFinitePositive(last) ? last : null;
};

export const getMedianCandlePrice = (candles: PriceCandle[]): number | null => {
  const prices = candles
    .flatMap(candle => [candle.open, candle.high, candle.low, candle.close])
    .filter(isFinitePositive)
    .sort((a, b) => a - b);

  if (prices.length === 0) return null;
  return prices[Math.floor(prices.length / 2)];
};

export const getLastCandleClose = (candles: PriceCandle[]): number | null => {
  for (let index = candles.length - 1; index >= 0; index -= 1) {
    const close = candles[index]?.close;
    if (isFinitePositive(close)) return close;
  }

  return null;
};

export const getRenderedCandleReferencePrice = (candles: PriceCandle[]): number | null =>
  getMedianCandlePrice(candles) ?? getLastCandleClose(candles);

export const createRenderedPriceReference = (candles: PriceCandle[]): RenderedPriceReference => ({
  price: getRenderedCandleReferencePrice(candles),
  candleCount: candles.length,
});

export const getReferenceScaleFactor = (
  candlePrice: number | null,
  referencePrice: number | null | undefined,
): number | null => {
  if (!isFinitePositive(candlePrice) || !isFinitePositive(referencePrice)) return null;

  const ratio = candlePrice / referencePrice;
  if (ratio >= 1 / COMPATIBLE_RATIO_LIMIT && ratio <= COMPATIBLE_RATIO_LIMIT) {
    return 1;
  }

  const exponent = Math.round(Math.log10(ratio));
  if (Math.abs(exponent) > MAX_SCALE_POWER) return null;

  const powerOfTen = 10 ** exponent;
  const relativeError = Math.abs(ratio - powerOfTen) / powerOfTen;
  return relativeError <= POWER_OF_TEN_TOLERANCE ? 1 / powerOfTen : null;
};

export const scaleCandlePrices = <T extends PriceCandle>(
  candle: T,
  factor: number,
): T => ({
  ...candle,
  open: candle.open * factor,
  high: candle.high * factor,
  low: candle.low * factor,
  close: candle.close * factor,
});

export const normalizeCandlesToReference = <T extends PriceCandle>(
  candles: T[],
  referencePrice: number | null | undefined,
): CandleReferenceResult<T> => {
  if (!isFinitePositive(referencePrice)) {
    return { candles, status: 'no-reference', factor: 1 };
  }

  const medianPrice = getMedianCandlePrice(candles);
  const factor = getReferenceScaleFactor(medianPrice, referencePrice);

  if (factor === null) {
    return { candles: [], status: 'incompatible', factor: 1 };
  }

  if (factor === 1) {
    return { candles, status: 'compatible', factor };
  }

  return {
    candles: candles.map(candle => scaleCandlePrices(candle, factor)),
    status: 'scaled',
    factor,
  };
};

export const normalizeCandlesToRenderedScale = <T extends PriceCandle>(
  candles: T[],
  renderedCandles: PriceCandle[],
): CandleReferenceResult<T> =>
  normalizeCandlesToReference(candles, getRenderedCandleReferencePrice(renderedCandles));

export const isPriceCompatibleWithCandles = (
  price: number | null | undefined,
  candles: PriceCandle[],
): boolean => getReferenceScaleFactor(getMedianCandlePrice(candles), price) !== null;

export const isPriceCompatibleWithReference = (
  price: number | null | undefined,
  reference: RenderedPriceReference | number | null | undefined,
): boolean => {
  const referencePrice = typeof reference === 'number' ? reference : reference?.price;
  return getReferenceScaleFactor(referencePrice ?? null, price) !== null;
};

export const resetLiveQuoteGuardState = (): LiveQuoteGuardState => ({
  lastAcceptedQuote: null,
  incompatibleQuoteCount: 0,
});

export const canDropPreloadedCandlesForLiveQuoteMismatch = ({
  hasDisplayedHistory,
  protectedHistoryCount,
  currentHistoryCount,
}: LiveQuoteDropEligibility): boolean => (
  !hasDisplayedHistory &&
  protectedHistoryCount <= 1 &&
  currentHistoryCount <= 1
);

export const updateLiveQuoteGuardState = (
  state: LiveQuoteGuardState,
  compatible: boolean,
  price: number | null | undefined,
  dropThresholdOrOptions: number | LiveQuoteGuardOptions = DEFAULT_INCOMPATIBLE_QUOTE_DROP_THRESHOLD,
): LiveQuoteGuardResult => {
  const dropThreshold = typeof dropThresholdOrOptions === 'number'
    ? dropThresholdOrOptions
    : dropThresholdOrOptions.dropThreshold ?? DEFAULT_INCOMPATIBLE_QUOTE_DROP_THRESHOLD;
  const allowDrop = typeof dropThresholdOrOptions === 'number'
    ? true
    : dropThresholdOrOptions.allowDrop ?? true;

  if (compatible) {
    return {
      state: {
        lastAcceptedQuote: isFinitePositive(price) ? price : state.lastAcceptedQuote,
        incompatibleQuoteCount: 0,
      },
      shouldDropCandles: false,
    };
  }

  const incompatibleQuoteCount = state.incompatibleQuoteCount + 1;
  return {
    state: {
      lastAcceptedQuote: state.lastAcceptedQuote,
      incompatibleQuoteCount,
    },
    shouldDropCandles: allowDrop && state.lastAcceptedQuote === null && incompatibleQuoteCount >= dropThreshold,
  };
};
