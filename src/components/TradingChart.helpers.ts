import type { Time } from 'lightweight-charts';
import type { ChartProperties } from '../store/useChartSettingsStore';
import {
  buildMarketClosedGapSeries,
  getMarketGapTimeframeSeconds,
  isPotentialMarketClosedPlaceholderCandle as isPotentialMarketClosedPlaceholderCandleForMarketSession,
  type MarketClosedGapCandle,
} from '../utils/marketClosedGaps';
import {
  getPeriodSeparators,
  type PeriodSeparator,
} from '../utils/periodSeparators';
import {
  normalizeCandlePageAscending,
  type LogicalRangeLike,
} from '../utils/candleHistory';

export type ChartType = 'candlestick' | 'bar' | 'line' | 'area';
export type Timeframe = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1' | 'W1' | 'MN';

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tickVolume?: number;
  realVolume?: number;
}

export type VolumeDisplaySettings = Pick<ChartProperties, 'showTickVolumes' | 'showRealVolumes'>;

export type FormattedSeriesDatum =
  | { time: Time }
  | { time: Time; value: number }
  | { time: Time; open: number; high: number; low: number; close: number };

export interface FormattedVolumeDatum {
  time: Time;
  value: number;
  color: string;
}

export interface TradingViewChartTheme {
  background: string;
  text: string;
  axisText: string;
  gridVertical: string;
  gridHorizontal: string;
  scaleBorder: string;
  crosshair: string;
  candleUp: string;
  candleDown: string;
  barUp: string;
  barDown: string;
  wickUp: string;
  wickDown: string;
  line: string;
  areaTop: string;
  areaBottom: string;
  volumeUp: string;
  volumeDown: string;
}

export interface LivePriceOverlayColors {
  lineColor: string;
  badgeBackground: string;
  badgeTextColor: '#000000' | '#ffffff';
}

const SESSION_GAP_SEPARATOR_TIMEFRAMES = new Set(['M1', 'M5', 'M15', 'M30', 'H1', 'H4']);
const DENSE_MINUTE_SEPARATOR_TIMEFRAMES = new Set(['M1', 'M5']);
const MIN_SESSION_GAP_SEPARATOR_SECONDS = 12 * 60 * 60;
const LIVE_PRICE_MIN_LUMINANCE_DELTA = 0.2;
const LIVE_PRICE_FALLBACK_DARK = '#000000';
const LIVE_PRICE_FALLBACK_LIGHT = '#ffffff';

const finiteVolumeOrNull = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const normalizeColorCandidate = (color: string | undefined): string | null => {
  const trimmed = color?.trim();
  return trimmed ? trimmed : null;
};

const getColorLuminance = (color: string | undefined): number | null => {
  if (!color) return null;
  const trimmed = color.trim();
  const shortHex = /^#([a-f\d])([a-f\d])([a-f\d])$/i.exec(trimmed);
  if (shortHex) {
    const [, r, g, b] = shortHex;
    return ((parseInt(r + r, 16) * 0.2126) + (parseInt(g + g, 16) * 0.7152) + (parseInt(b + b, 16) * 0.0722)) / 255;
  }

  const longHex = /^#([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(trimmed);
  if (longHex) {
    const [, r, g, b] = longHex;
    return ((parseInt(r, 16) * 0.2126) + (parseInt(g, 16) * 0.7152) + (parseInt(b, 16) * 0.0722)) / 255;
  }

  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:,\s*[\d.]+\s*)?\)$/i.exec(trimmed);
  if (rgb) {
    const [, r, g, b] = rgb;
    return ((Number(r) * 0.2126) + (Number(g) * 0.7152) + (Number(b) * 0.0722)) / 255;
  }

  return null;
};

const hasReadableColorSeparation = (color: string, background: string): boolean => {
  const colorLuminance = getColorLuminance(color);
  const backgroundLuminance = getColorLuminance(background);
  if (colorLuminance === null || backgroundLuminance === null) return true;
  return Math.abs(colorLuminance - backgroundLuminance) >= LIVE_PRICE_MIN_LUMINANCE_DELTA;
};

const getFallbackLineColor = (background: string): '#000000' | '#ffffff' => {
  const backgroundLuminance = getColorLuminance(background);
  if (backgroundLuminance === null) return LIVE_PRICE_FALLBACK_LIGHT;
  return Math.abs(1 - backgroundLuminance) >= backgroundLuminance
    ? LIVE_PRICE_FALLBACK_LIGHT
    : LIVE_PRICE_FALLBACK_DARK;
};

const getReadableBadgeTextColor = (background: string): '#000000' | '#ffffff' => {
  const backgroundLuminance = getColorLuminance(background);
  if (backgroundLuminance === null) return LIVE_PRICE_FALLBACK_LIGHT;
  const blackContrast = (backgroundLuminance + 0.05) / 0.05;
  const whiteContrast = 1.05 / (backgroundLuminance + 0.05);
  return blackContrast >= whiteContrast ? LIVE_PRICE_FALLBACK_DARK : LIVE_PRICE_FALLBACK_LIGHT;
};

export const getLivePriceOverlayColors = (
  colors: Pick<ChartProperties['colors'], 'background' | 'foreground'>,
  preferredLineColor?: string,
): LivePriceOverlayColors => {
  const background = normalizeColorCandidate(colors.background) ?? LIVE_PRICE_FALLBACK_DARK;
  const lineColor = [
    normalizeColorCandidate(preferredLineColor),
    normalizeColorCandidate(colors.foreground),
  ].find((candidate): candidate is string => (
    Boolean(candidate) && hasReadableColorSeparation(candidate, background)
  )) ?? getFallbackLineColor(background);

  return {
    lineColor,
    badgeBackground: lineColor,
    badgeTextColor: getReadableBadgeTextColor(lineColor),
  };
};

export const getDisplayVolume = (candle: Candle, settings: VolumeDisplaySettings): number => {
  if (settings.showRealVolumes && !settings.showTickVolumes) {
    return finiteVolumeOrNull(candle.realVolume) ?? 0;
  }

  return finiteVolumeOrNull(candle.tickVolume)
    ?? finiteVolumeOrNull(candle.volume)
    ?? finiteVolumeOrNull(candle.realVolume)
    ?? 0;
};

export const getValidSortedCandles = (candles: Candle[]): Candle[] => (
  normalizeCandlePageAscending(candles)
);

const shouldAddMarketGapSessionSeparator = (
  previousCandle: Candle,
  firstCandleAfterGap: Candle,
  timeframe: Timeframe | string,
): boolean => {
  const normalizedTimeframe = String(timeframe).toUpperCase();
  const expectedGapSeconds = getMarketGapTimeframeSeconds(normalizedTimeframe);
  if (!expectedGapSeconds || !SESSION_GAP_SEPARATOR_TIMEFRAMES.has(normalizedTimeframe)) {
    return false;
  }

  const actualGapSeconds = firstCandleAfterGap.time - previousCandle.time;
  return Number.isFinite(actualGapSeconds) &&
    actualGapSeconds > expectedGapSeconds * 3 &&
    actualGapSeconds >= MIN_SESSION_GAP_SEPARATOR_SECONDS;
};

export const isDenseMinuteSeparatorTimeframe = (timeframe: Timeframe | string): boolean => (
  DENSE_MINUTE_SEPARATOR_TIMEFRAMES.has(String(timeframe).toUpperCase())
);

export const getSeparatorPriority = (separator: PeriodSeparator): number => {
  switch (separator.type) {
    case 'session_gap':
      return 4;
    case 'year':
      return 3;
    case 'month':
      return 2;
    case 'day':
      return 1;
    default:
      return 0;
  }
};

export const shouldRecomputeMarketGapSeparatorsForCandle = (
  candles: Candle[],
  candle: Candle,
  marketGapOptions?: {
    symbol: string;
    timeframe: Timeframe | string;
    brokerOffsetSeconds?: number;
  },
): boolean => {
  if (!marketGapOptions || !Number.isFinite(candle.time)) return false;

  const sortedCandles = getValidSortedCandles(candles);
  const candleIndex = sortedCandles.findIndex(item => item.time === candle.time);
  if (candleIndex <= 0) return false;

  const { gaps } = buildMarketClosedGapSeries(sortedCandles, marketGapOptions);
  return gaps.some(gap => gap.endTime === candle.time);
};

export const isPotentialMarketClosedPlaceholderCandle = (
  candle: MarketClosedGapCandle,
  options: {
    symbol: string;
    timeframe: Timeframe | string;
    brokerOffsetSeconds?: number;
  },
): boolean => {
  return isPotentialMarketClosedPlaceholderCandleForMarketSession(candle, {
    ...options,
    timeframe: String(options.timeframe),
  });
};

export const formatChartSeriesData = (
  candles: Candle[],
  chartType: ChartType,
  theme: TradingViewChartTheme,
  volumeSettings: VolumeDisplaySettings,
  marketGapOptions?: {
    symbol: string;
    timeframe: Timeframe | string;
    brokerOffsetSeconds?: number;
  },
  options: {
    includeVolumeData?: boolean;
    assumeSortedUnique?: boolean;
  } = {},
): {
  sortedCandles: Candle[];
  seriesData: FormattedSeriesDatum[];
  volumeData: FormattedVolumeDatum[];
  periodSeparators: PeriodSeparator[];
} => {
  const isValidFormattedCandle = (candle: Candle): boolean => (
    candle.open != null &&
    candle.high != null &&
    candle.low != null &&
    candle.close != null &&
    Number.isFinite(candle.open) &&
    Number.isFinite(candle.high) &&
    Number.isFinite(candle.low) &&
    Number.isFinite(candle.close)
  );
  const sortedCandles = options.assumeSortedUnique
    ? candles.filter(isValidFormattedCandle)
    : (() => {
      const uniqueCandles = new Map<number, Candle>();
      candles.forEach(candle => uniqueCandles.set(candle.time, candle));
      return Array.from(uniqueCandles.values())
        .filter(isValidFormattedCandle)
        .sort((a, b) => a.time - b.time);
    })();

  const { candles: renderedCandles, gaps: marketGaps } = marketGapOptions
    ? buildMarketClosedGapSeries(sortedCandles, marketGapOptions)
    : { candles: sortedCandles, gaps: [] };
  const basePeriodSeparators = marketGapOptions
    ? getPeriodSeparators(
      renderedCandles,
      marketGapOptions.timeframe,
      marketGapOptions.brokerOffsetSeconds ?? 0,
    )
    : [];
  const periodSeparatorByTime = new Map<number, PeriodSeparator>();
  basePeriodSeparators.forEach(separator => {
    periodSeparatorByTime.set(separator.time, separator);
  });
  marketGaps.forEach(gap => {
    const separatorTime = gap.endTime;
    if (!Number.isFinite(separatorTime)) return;
    const insertionIndex = renderedCandles.findIndex(candle => candle.time === separatorTime);
    const firstCandleAfterGap = renderedCandles[insertionIndex];
    const previousCandle = renderedCandles[insertionIndex - 1];
    if (!firstCandleAfterGap || !previousCandle) return;
    if (!shouldAddMarketGapSessionSeparator(previousCandle, firstCandleAfterGap, marketGapOptions?.timeframe ?? '')) {
      return;
    }

    periodSeparatorByTime.set(firstCandleAfterGap.time, {
      time: firstCandleAfterGap.time,
      index: insertionIndex,
      type: 'session_gap',
    });
  });
  if (marketGapOptions && isDenseMinuteSeparatorTimeframe(marketGapOptions.timeframe)) {
    marketGaps.forEach(gap => {
      periodSeparatorByTime.forEach((separator, time) => {
        if (
          separator.type !== 'session_gap' &&
          time > gap.startTime &&
          time < gap.endTime
        ) {
          periodSeparatorByTime.delete(time);
        }
      });
    });
  }
  const periodSeparators = Array.from(periodSeparatorByTime.values())
    .sort((a, b) => a.time - b.time);

  const seriesData: FormattedSeriesDatum[] = chartType === 'line' || chartType === 'area'
    ? renderedCandles.map(candle => ({
      time: candle.time as Time,
      value: candle.close,
    }))
    : renderedCandles.map(candle => ({
      time: candle.time as Time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    }));

  const includeVolumeData = options.includeVolumeData ?? true;
  const volumeData: FormattedVolumeDatum[] = includeVolumeData
    ? renderedCandles.map(candle => ({
      time: candle.time as Time,
      value: getDisplayVolume(candle, volumeSettings),
      color: candle.close >= candle.open ? theme.volumeUp : theme.volumeDown,
    }))
    : [];

  return {
    sortedCandles: renderedCandles,
    seriesData,
    volumeData,
    periodSeparators,
  };
};

export const getRenderedPrependedBarCount = (
  renderedCandles: readonly Pick<Candle, 'time'>[],
  previousFirstRenderedTime: number | null,
  rawPrependedBars: number,
): number => {
  if (rawPrependedBars <= 0) return 0;
  if (previousFirstRenderedTime === null) return rawPrependedBars;

  let renderedPrependedBars = 0;
  for (const candle of renderedCandles) {
    if (candle.time >= previousFirstRenderedTime) break;
    renderedPrependedBars += 1;
  }

  return renderedPrependedBars;
};

export const getVisibleLogicalRangeAnchoredToTime = (
  renderedCandles: readonly Pick<Candle, 'time'>[],
  leftVisibleTime: number | null,
  previousRange: LogicalRangeLike | null,
): LogicalRangeLike | null => {
  if (leftVisibleTime == null || !previousRange) return null;
  const span = previousRange.to - previousRange.from;
  if (!Number.isFinite(span) || span <= 0) return null;

  let low = 0;
  let high = renderedCandles.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (renderedCandles[mid].time < leftVisibleTime) low = mid + 1;
    else high = mid;
  }

  if (low >= renderedCandles.length) return null;
  return {
    from: low,
    to: low + span,
  };
};

export const getLeftVisibleTimeFromLogicalRange = (
  renderedCandles: readonly Pick<Candle, 'time'>[],
  visibleRange: LogicalRangeLike | null | undefined,
): number | null => {
  if (!visibleRange || renderedCandles.length === 0) return null;
  const fromIndex = Math.floor(visibleRange.from);
  if (!Number.isFinite(fromIndex)) return null;
  if (fromIndex < 0) return null;

  const boundedIndex = Math.max(0, Math.min(renderedCandles.length - 1, fromIndex));
  return renderedCandles[boundedIndex]?.time ?? null;
};

export const shouldApplyVisibleRangeResetForRender = ({
  resetVisibleRange,
  resetVisibleRangeOnNextData,
  suppressGlobalVisibleRangeReset,
}: {
  resetVisibleRange: boolean;
  resetVisibleRangeOnNextData: boolean;
  suppressGlobalVisibleRangeReset: boolean;
}): boolean => (
  resetVisibleRange || (!suppressGlobalVisibleRangeReset && resetVisibleRangeOnNextData)
);

export const shouldResetInitialHistoryVisibleRange = ({
  resetVisibleRangeOnNextData,
  hydratedFromCache,
}: {
  resetVisibleRangeOnNextData: boolean;
  hydratedFromCache: boolean;
}): boolean => (
  resetVisibleRangeOnNextData || !hydratedFromCache
);

export const TRADING_CHART_TIME_SCALE_LIVE_SHIFT_OPTIONS = {
  shiftVisibleRangeOnNewBar: false,
  allowShiftVisibleRangeOnWhitespaceReplacement: false,
} as const;

export const shouldRestoreProtectedHistoryForFullRender = ({
  incomingCount,
  protectedCount,
  resetVisibleRange,
  defaultVisibleBars,
}: {
  activeTimeframe: Timeframe;
  incomingCount: number;
  protectedCount: number;
  resetVisibleRange: boolean;
  defaultVisibleBars: number;
}): boolean => (
  !resetVisibleRange &&
  protectedCount > defaultVisibleBars &&
  incomingCount > 0 &&
  incomingCount <= defaultVisibleBars &&
  incomingCount < protectedCount
);
