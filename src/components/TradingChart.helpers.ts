import type { Time } from 'lightweight-charts';
import { CHART_CANDLE_DOWN_COLOR, CHART_CANDLE_UP_COLOR, type ChartProperties } from '../store/useChartSettingsStore';
import type {
  Candle,
  ChartType,
  LivePriceOverlayColors,
  Timeframe,
  TradingViewChartTheme,
} from '../types/chart';
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
import { sanitizePriceCandles } from '../services/chartPriceGuards';

export type {
  Candle,
  ChartType,
  LivePriceOverlayColors,
  Timeframe,
  TradingViewChartTheme,
} from '../types/chart';

// FIX: Preserve explicit backend finality and infer it only when a legacy
// candle frame omits the flag and an authoritative period boundary is known.
export const resolveCandleFinalityFromActivePeriod = <T extends Candle>(
  candle: T,
  activePeriodStart: number | null | undefined,
): T => {
  if (typeof candle.closed === 'boolean' || !Number.isFinite(activePeriodStart)) return candle;
  return { ...candle, closed: candle.time < Number(activePeriodStart) };
};

// FIX: Record finalized buckets per timeframe so M1 finality cannot freeze M5/H1.
export const markFinalizedCandleTime = (
  finalizedByTimeframe: Map<string, number>,
  timeframe: string,
  candleTime: number,
): void => {
  if (!Number.isFinite(candleTime)) return;
  const key = String(timeframe || '').trim().toUpperCase();
  if (!key) return;
  finalizedByTimeframe.set(
    key,
    Math.max(finalizedByTimeframe.get(key) ?? Number.NEGATIVE_INFINITY, candleTime),
  );
};

export const isCandleAtOrBeforeFinalizedTime = (
  finalizedByTimeframe: ReadonlyMap<string, number>,
  timeframe: string,
  candleTime: number,
): boolean => {
  const key = String(timeframe || '').trim().toUpperCase();
  const finalizedTime = finalizedByTimeframe.get(key);
  return Number.isFinite(finalizedTime) && candleTime <= Number(finalizedTime);
};

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

export const LIVE_PRICE_SCALE_WIDTH_FALLBACK_PX = 52;

// The chart can briefly report a zero-width scale while a hidden pane is
// mounting. Keep the last real width only for that transient state; every
// positive measurement must win so the badge continues to cover the full
// price scale after symbol, timeframe, font, or layout changes.
export const resolveLivePriceScaleWidth = (
  measuredScaleWidth: number,
  lastValidScaleWidth: number | null,
): number => {
  if (Number.isFinite(measuredScaleWidth) && measuredScaleWidth > 0) return measuredScaleWidth;
  if (lastValidScaleWidth !== null && Number.isFinite(lastValidScaleWidth) && lastValidScaleWidth > 0) {
    return lastValidScaleWidth;
  }
  return LIVE_PRICE_SCALE_WIDTH_FALLBACK_PX;
};

export const getLivePriceSeriesColor = (
  colors: ChartProperties['colors'],
  chartType: ChartType,
  direction: 'up' | 'down',
): string => {
  if (chartType === 'line') return colors.lineChart;
  if (chartType === 'bar') return direction === 'up' ? colors.barUp : colors.barDown;
  return direction === 'up' ? colors.bullCandle : colors.bearCandle;
};

export type AreaTrendDirection = 'up' | 'down';

const DAY_SECONDS = 24 * 60 * 60;

// TradingView's symbol-page range buttons pair a change period with a data
// granularity (1 day→minute bars, 5 days→5-minute, 1 month→30-minute,
// 6 months→hourly, 1 year→daily, 5 years→weekly, 10 years→monthly). The
// terminal's timeframe implies the change period the same way.
const AREA_TREND_PERIOD_DAYS: Record<string, number> = {
  M1: 1,
  M5: 5,
  M15: 30,
  M30: 30,
  H1: 182,
  H4: 182,
  D1: 365,
  W1: 5 * 365,
  MN: 10 * 365,
};

export const getAreaTrendPeriodDays = (timeframe: string | undefined): number =>
  AREA_TREND_PERIOD_DAYS[timeframe ?? ''] ?? 1;

// TradingView-style Area coloring: the line and gradient take the bull color
// while the current price is at or above the close from the start of the
// timeframe's change period (broker time) — the previous day's close on M1,
// five days back on M5, a year back on D1, and so on — and the bear color
// while it is below. When the loaded history does not reach that far back,
// the oldest loaded candle's open stands in as the reference.
export const getAreaTrendDirection = (
  candles: readonly { time: number; open: number; close: number }[],
  brokerOffsetSeconds = 0,
  latestClose?: number,
  timeframe?: string,
): AreaTrendDirection | null => {
  const last = candles[candles.length - 1];
  if (!last) return null;

  const offset = Number.isFinite(brokerOffsetSeconds) ? brokerOffsetSeconds : 0;
  const dayStart = Math.floor((last.time + offset) / DAY_SECONDS) * DAY_SECONDS - offset;
  const periodStart = dayStart - (getAreaTrendPeriodDays(timeframe) - 1) * DAY_SECONDS;

  // Newest candle that closed before the period began → the period's
  // reference close (the previous daily close for a 1-day period).
  let reference: number | null = null;
  for (let i = candles.length - 1; i >= 0; i--) {
    if (candles[i].time < periodStart) {
      reference = candles[i].close;
      break;
    }
  }
  if (reference === null) reference = candles[0].open;

  // The forming candle streams through series.update() and may not be in the
  // rendered snapshot yet, so callers pass the live close.
  const latest = Number.isFinite(latestClose) ? (latestClose as number) : last.close;
  if (!Number.isFinite(reference) || !Number.isFinite(latest)) return null;
  return latest >= reference ? 'up' : 'down';
};

export const getAreaTrendSeriesOptions = (
  theme: TradingViewChartTheme,
  direction: AreaTrendDirection,
): { lineColor: string; topColor: string; bottomColor: string } => (
  direction === 'down'
    ? { lineColor: theme.areaDownLine, topColor: theme.areaDownTop, bottomColor: theme.areaDownBottom }
    : { lineColor: theme.areaUpLine, topColor: theme.areaUpTop, bottomColor: theme.areaUpBottom }
);

const SESSION_GAP_SEPARATOR_TIMEFRAMES = new Set(['M1', 'M5', 'M15', 'M30', 'H1', 'H4']);
const DENSE_MINUTE_SEPARATOR_TIMEFRAMES = new Set(['M1', 'M5']);
const MIN_SESSION_GAP_SEPARATOR_SECONDS = 12 * 60 * 60;
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
  const toLinearChannel = (value: number): number => {
    const channel = value / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  };
  const getRelativeLuminance = (r: number, g: number, b: number): number => (
    (toLinearChannel(r) * 0.2126)
    + (toLinearChannel(g) * 0.7152)
    + (toLinearChannel(b) * 0.0722)
  );
  const trimmed = color.trim();
  const shortHex = /^#([a-f\d])([a-f\d])([a-f\d])$/i.exec(trimmed);
  if (shortHex) {
    const [, r, g, b] = shortHex;
    return getRelativeLuminance(
      parseInt(r + r, 16),
      parseInt(g + g, 16),
      parseInt(b + b, 16),
    );
  }

  const longHex = /^#([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(trimmed);
  if (longHex) {
    const [, r, g, b] = longHex;
    return getRelativeLuminance(parseInt(r, 16), parseInt(g, 16), parseInt(b, 16));
  }

  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:,\s*[\d.]+\s*)?\)$/i.exec(trimmed);
  if (rgb) {
    const [, r, g, b] = rgb;
    return getRelativeLuminance(Number(r), Number(g), Number(b));
  }

  return null;
};

const getColorContrastRatio = (first: string, second: string): number | null => {
  const firstLuminance = getColorLuminance(first);
  const secondLuminance = getColorLuminance(second);
  if (firstLuminance === null || secondLuminance === null) return null;
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
};

const hasReadableColorSeparation = (color: string, background: string): boolean => {
  const contrast = getColorContrastRatio(color, background);
  if (contrast === null) return true;
  return contrast >= 3;
};

const getFallbackLineColor = (background: string): '#000000' | '#ffffff' => {
  const backgroundLuminance = getColorLuminance(background);
  if (backgroundLuminance === null) return LIVE_PRICE_FALLBACK_LIGHT;
  const blackContrast = (backgroundLuminance + 0.05) / 0.05;
  const whiteContrast = 1.05 / (backgroundLuminance + 0.05);
  return whiteContrast >= blackContrast ? LIVE_PRICE_FALLBACK_LIGHT : LIVE_PRICE_FALLBACK_DARK;
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
  useEnterpriseLightPalette = false,
): LivePriceOverlayColors => {
  const background = normalizeColorCandidate(colors.background) ?? LIVE_PRICE_FALLBACK_DARK;
  const preferred = normalizeColorCandidate(preferredLineColor);
  // Price labels carry small text: keep their fills distinct from candle marks.
  // Only render-time light defaults opt in; saved custom and dark palettes keep
  // the existing contrast-aware treatment below.
  if (useEnterpriseLightPalette && preferred) {
    const badgeColors: Record<string, string> = {
      [CHART_CANDLE_UP_COLOR.toUpperCase()]: '#07816d',
      [CHART_CANDLE_DOWN_COLOR.toUpperCase()]: '#d22f3c',
      '#059669': '#047857',
      '#DC2626': '#b91c1c',
    };
    const badgeBackground = badgeColors[preferred.toUpperCase()];
    if (badgeBackground) {
      return { lineColor: preferred, badgeBackground, badgeTextColor: '#ffffff' };
    }
  }
  // Keep the live series hue on light charts instead of falling back to a gray
  // badge. Darken saturated colors just enough for small white price text.
  const hex = preferred?.match(/^#([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if ((getColorLuminance(background) ?? 0) > 0.45 && hex) {
    const channels = hex.slice(1).map(channel => parseInt(channel, 16));
    if (Math.max(...channels) - Math.min(...channels) >= 40) {
      for (let step = 0; step <= 40; step += 1) {
        const factor = 1 - step / 40;
        const tone = `#${channels.map(channel => Math.round(channel * factor).toString(16).padStart(2, '0')).join('')}`;
        if ((getColorContrastRatio(tone, '#ffffff') ?? 0) >= 4.5
          && hasReadableColorSeparation(tone, background)) {
          return { lineColor: tone, badgeBackground: tone, badgeTextColor: '#ffffff' };
        }
      }
    }
  }
  const lineColor = [
    preferred,
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
  const finiteCandles = options.assumeSortedUnique
    ? candles.filter(isValidFormattedCandle)
    : (() => {
      const uniqueCandles = new Map<number, Candle>();
      candles.forEach(candle => uniqueCandles.set(candle.time, candle));
      return Array.from(uniqueCandles.values())
        .filter(isValidFormattedCandle)
        .sort((a, b) => a.time - b.time);
    })();
  const sortedCandles = sanitizePriceCandles(finiteCandles);

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
  // Do not mix a lone lower-weight tick (for example 10:18) into the regular
  // five-minute marks (for example 10:15, 10:20) when every mark cannot fit.
  uniformDistribution: true,
  // Match chart-wheel zoom: keep the visible right edge, even in history.
  rightBarStaysOnScroll: true,
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
