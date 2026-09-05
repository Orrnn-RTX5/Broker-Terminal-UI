export interface PriceCandle {
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface CandleReferenceResult<T extends PriceCandle> {
  candles: T[];
  status: 'compatible' | 'partial' | 'incompatible' | 'no-reference';
  discardedCount?: number;
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
const CANDLE_PRICE_OUTLIER_RATIO_LIMIT = 16;
const DEFAULT_INCOMPATIBLE_QUOTE_DROP_THRESHOLD = 3;

const isFinitePositive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

const getCandleReferencePrice = (candle: PriceCandle): number | null => {
  const prices = [candle.open, candle.high, candle.low, candle.close]
    .filter(isFinitePositive)
    .sort((a, b) => a - b);
  if (prices.length !== 4) return null;
  return (prices[1] + prices[2]) / 2;
};

export const isStructurallyValidPriceCandle = (candle: PriceCandle): boolean => {
  const { open, high, low, close } = candle;
  if (![open, high, low, close].every(isFinitePositive)) return false;
  if (high < Math.max(open, close) || low > Math.min(open, close) || high < low) return false;

  const bodyReference = (open + close) / 2;
  return high / bodyReference <= CANDLE_PRICE_OUTLIER_RATIO_LIMIT
    && bodyReference / low <= CANDLE_PRICE_OUTLIER_RATIO_LIMIT;
};

/**
 * Seal a locally built/forming candle when its aggregator has not established
 * a complete envelope yet. Authoritative backend OHLC is validated strictly
 * and must never pass through this repair helper.
 */
export const repairPriceCandle = <T extends PriceCandle>(candle: T): T | null => {
  const open = Number(candle.open);
  const close = Number(candle.close);
  if (!isFinitePositive(open) || !isFinitePositive(close)) return null;

  const bodyHigh = Math.max(open, close);
  const bodyLow = Math.min(open, close);

  let high = Number(candle.high);
  let low = Number(candle.low);
  if (!isFinitePositive(high)) high = bodyHigh;
  if (!isFinitePositive(low)) low = bodyLow;

  if (high < low) {
    const swapped = high;
    high = low;
    low = swapped;
  }

  high = Math.max(high, bodyHigh);
  low = Math.min(low, bodyLow);
  if (high < low) return null;

  if (high === candle.high && low === candle.low && open === candle.open && close === candle.close) {
    return candle;
  }

  return { ...candle, open, high, low, close };
};

/**
 * Removes isolated zero/corrupt price bands before Lightweight Charts can
 * include them in autoscale. Values are either retained exactly or rejected;
 * this validator never changes the broker's OHLC price scale.
 */
export const sanitizePriceCandles = <T extends PriceCandle>(
  candles: T[],
  referencePrice?: number | null,
): T[] => {
  // FIX: Rendering must preserve exact backend prices. Cross-row checks may
  // reject an isolated corrupt band, but they must never rescale it to look valid.
  const structurallyValid = candles.filter(isStructurallyValidPriceCandle);
  return structurallyValid.filter((candle, index) => {
    const previous = structurallyValid[index - 1];
    const next = structurallyValid[index + 1];
    if (!previous || !next) return true;

    const candleReference = getCandleReferencePrice(candle);
    const previousReference = getCandleReferencePrice(previous);
    const nextReference = getCandleReferencePrice(next);
    const neighborsAgree = arePriceReferencesCompatible(previousReference, nextReference);
    const candidateMatchesPrevious = arePriceReferencesCompatible(candleReference, previousReference);
    const candidateMatchesNext = arePriceReferencesCompatible(candleReference, nextReference);
    // FIX: When a live/rendered reference is available it decides which side of
    // an interleaved broker price-band conflict belongs to this chart. A valid
    // XAU row must not be discarded merely because two adjacent contaminated
    // 44.xx rows agree with each other.
    const candidateMatchesExternal = isFinitePositive(referencePrice)
      && arePriceReferencesCompatible(candleReference, referencePrice);
    return candidateMatchesExternal
      || !(neighborsAgree && !candidateMatchesPrevious && !candidateMatchesNext);
  });
};

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

// FIX: Price compatibility is validation only. MetaTrader-style broker prices
// are authoritative; a decimal-band mismatch must fail closed, never trigger a
// guessed power-of-ten multiplication of OHLC or live quotes.
export const arePriceReferencesCompatible = (
  candlePrice: number | null,
  referencePrice: number | null | undefined,
): boolean => {
  if (!isFinitePositive(candlePrice) || !isFinitePositive(referencePrice)) return false;

  const ratio = candlePrice / referencePrice;
  return ratio >= 1 / COMPATIBLE_RATIO_LIMIT && ratio <= COMPATIBLE_RATIO_LIMIT;
};

export const normalizeCandlesToReference = <T extends PriceCandle>(
  candles: T[],
  referencePrice: number | null | undefined,
): CandleReferenceResult<T> => {
  const structurallyValidCandles = sanitizePriceCandles(candles, referencePrice);
  const hasExternalReference = isFinitePositive(referencePrice);
  const newestCandle = structurallyValidCandles[structurallyValidCandles.length - 1];
  const newestCandleReference = newestCandle ? getCandleReferencePrice(newestCandle) : null;
  const initialReference = hasExternalReference ? referencePrice : newestCandleReference;
  if (!isFinitePositive(initialReference)) {
    return { candles: structurallyValidCandles, status: 'no-reference' };
  }

  const exactCandlesDescending: T[] = [];
  let rollingReference = initialReference;
  for (let index = structurallyValidCandles.length - 1; index >= 0; index -= 1) {
    const candle = structurallyValidCandles[index];
    const candleReference = getCandleReferencePrice(candle);
    if (!arePriceReferencesCompatible(candleReference, rollingReference)) {
      // FIX: A broker page can contain an internally contaminated price band
      // (for example, 44.xx rows inside XAUUSD 4,4xx history). With an external
      // live/rendered reference, reject only those exact rows and keep scanning;
      // never scale, rewrite, or synthesize OHLC. Without an external reference
      // there is no safe way to choose which band owns the symbol, so fail closed.
      if (hasExternalReference) continue;
      return { candles: [], status: 'incompatible' };
    }

    exactCandlesDescending.push(candle);
    rollingReference = candleReference ?? rollingReference;
  }

  if (exactCandlesDescending.length === 0) {
    return { candles: [], status: hasExternalReference ? 'incompatible' : 'no-reference' };
  }

  const discardedCount = candles.length - exactCandlesDescending.length;

  return {
    // Reverse a copied array only; every returned OHLC number is still the
    // exact value supplied by the backend.
    candles: exactCandlesDescending.reverse(),
    status: hasExternalReference
      ? discardedCount > 0 ? 'partial' : 'compatible'
      : 'no-reference',
    ...(discardedCount > 0 ? { discardedCount } : {}),
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
): boolean => arePriceReferencesCompatible(getMedianCandlePrice(candles), price);

export const isPriceCompatibleWithReference = (
  price: number | null | undefined,
  reference: RenderedPriceReference | number | null | undefined,
): boolean => {
  const referencePrice = typeof reference === 'number' ? reference : reference?.price;
  return arePriceReferencesCompatible(referencePrice ?? null, price);
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
