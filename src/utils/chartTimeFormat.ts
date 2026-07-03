import { TickMarkType } from 'lightweight-charts';
import type { Time } from 'lightweight-charts';

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'] as const;

type TradingChartTimeframe = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1' | 'W1' | 'MN';
type TimeframeUnit = 'minute' | 'hour' | 'day' | 'week' | 'month';

interface TradingChartInitialRangeProfile {
  dataBars: number;
  rightPadBars: number;
  sparseRightPadBars: number;
}

const TIMEFRAME_LAYOUT_CONFIG: Record<TradingChartTimeframe, {
  defaultVisibleBars: number;
  defaultRightPadBars: number;
  chartShiftRightOffset: number;
}> = {
  M1: { defaultVisibleBars: 30, defaultRightPadBars: 8, chartShiftRightOffset: 8 },
  M5: { defaultVisibleBars: 30, defaultRightPadBars: 8, chartShiftRightOffset: 8 },
  M15: { defaultVisibleBars: 30, defaultRightPadBars: 8, chartShiftRightOffset: 8 },
  M30: { defaultVisibleBars: 30, defaultRightPadBars: 8, chartShiftRightOffset: 8 },
  H1: { defaultVisibleBars: 30, defaultRightPadBars: 8, chartShiftRightOffset: 8 },
  H4: { defaultVisibleBars: 30, defaultRightPadBars: 8, chartShiftRightOffset: 8 },
  D1: { defaultVisibleBars: 30, defaultRightPadBars: 0, chartShiftRightOffset: 8 },
  W1: { defaultVisibleBars: 30, defaultRightPadBars: 0, chartShiftRightOffset: 8 },
  MN: { defaultVisibleBars: 30, defaultRightPadBars: 0, chartShiftRightOffset: 8 },
};

const HIGHER_TIMEFRAME_INITIAL_RANGE_CONFIG: Partial<Record<TradingChartTimeframe, TradingChartInitialRangeProfile>> = {
  D1: { dataBars: 24, rightPadBars: 4, sparseRightPadBars: 4 },
  W1: { dataBars: 6, rightPadBars: 4, sparseRightPadBars: 0.5 },
  MN: { dataBars: 5, rightPadBars: 3, sparseRightPadBars: 0.5 },
};

const pad2 = (value: number): string => String(value).padStart(2, '0');

const isTradingChartTimeframe = (timeframe: string): timeframe is TradingChartTimeframe =>
  timeframe in TIMEFRAME_LAYOUT_CONFIG;

const getTimeframeLayoutConfig = (timeframe: string) =>
  TIMEFRAME_LAYOUT_CONFIG[isTradingChartTimeframe(timeframe) ? timeframe : 'M5'];

const parseTradingChartTimeframe = (
  timeframe: string,
): { unit: TimeframeUnit; value: number; seconds: number } | null => {
  const normalized = timeframe.toUpperCase();

  if (normalized === 'MN') {
    return { unit: 'month', value: 1, seconds: 30 * 24 * 60 * 60 };
  }

  const monthMatch = /^MN(\d+)$/.exec(normalized);
  if (monthMatch) {
    const value = Number(monthMatch[1]);
    return Number.isFinite(value) && value > 0
      ? { unit: 'month', value, seconds: value * 30 * 24 * 60 * 60 }
      : null;
  }

  const match = /^([MHDW])(\d+)$/.exec(normalized);
  if (!match) return null;

  const [, unitCode, rawValue] = match;
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value <= 0) return null;

  switch (unitCode) {
    case 'M':
      return { unit: 'minute', value, seconds: value * 60 };
    case 'H':
      return { unit: 'hour', value, seconds: value * 60 * 60 };
    case 'D':
      return { unit: 'day', value, seconds: value * 24 * 60 * 60 };
    case 'W':
      return { unit: 'week', value, seconds: value * 7 * 24 * 60 * 60 };
    default:
      return null;
  }
};

const getTimeframeMetrics = (timeframe: string) => {
  const parsed = parseTradingChartTimeframe(timeframe) ?? parseTradingChartTimeframe('M5')!;
  const isIntraday = parsed.seconds < 24 * 60 * 60;
  // All intraday timeframes (M1 up to H4) show only HH:MM for
  // regular time ticks to save horizontal space. 
  // Date boundaries are handled natively by DayOfMonth/Month TickMarkTypes.
  const showsTimeOnlyInFooter = isIntraday;
  
  const tickMarkMaxCharacterLength = parsed.seconds >= 24 * 60 * 60
    ? 8   // Covers "Apr 2024" (MN) and "31 Dec" (D1/W1) 
    : 5;  // Covers "HH:MM" for all modern intraday setups

  return {
    ...parsed,
    isIntraday,
    showsTimeOnlyInFooter,
    tickMarkMaxCharacterLength,
  };
};

const toDisplayDate = (time: Time, brokerOffsetSeconds: number): Date | null => {
  const brokerOffsetMs = brokerOffsetSeconds * 1000;

  if (typeof time === 'number') {
    const parsed = new Date((time * 1000) + brokerOffsetMs);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (typeof time === 'string') {
    const businessDayMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(time);
    if (businessDayMatch) {
      const [, year, month, day] = businessDayMatch;
      return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0));
    }

    const parsed = new Date(new Date(time).getTime() + brokerOffsetMs);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (time && typeof time === 'object' && 'year' in time && 'month' in time && 'day' in time) {
    return new Date(Date.UTC(time.year, time.month - 1, time.day, 0, 0, 0, 0));
  }

  return null;
};

const formatDayMonth = (date: Date): string => `${date.getUTCDate()} ${MONTH_NAMES[date.getUTCMonth()]}`;
const formatMonthYear = (date: Date): string => `${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
const formatDayMonthYear = (date: Date): string => `${formatDayMonth(date)} ${date.getUTCFullYear()}`;
const formatTime = (date: Date): string => `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`;
const formatTimeWithSeconds = (date: Date): string => `${formatTime(date)}:${pad2(date.getUTCSeconds())}`;

const formatMinuteTickLabel = (
  date: Date,
  timeframeMetrics: ReturnType<typeof getTimeframeMetrics>,
  tickMarkType: TickMarkType,
): string => {
  if (tickMarkType === TickMarkType.Year) {
    return String(date.getUTCFullYear());
  }

  if (tickMarkType === TickMarkType.Month) {
    return formatMonthYear(date);
  }

  if (tickMarkType === TickMarkType.DayOfMonth) {
    return formatDayMonthYear(date);
  }

  if (tickMarkType === TickMarkType.TimeWithSeconds) {
    return timeframeMetrics.showsTimeOnlyInFooter
      ? formatTimeWithSeconds(date)
      : `${formatDayMonth(date)} ${formatTimeWithSeconds(date)}`;
  }

  return timeframeMetrics.showsTimeOnlyInFooter
    ? formatTime(date)
    : `${formatDayMonth(date)} ${formatTime(date)}`;
};

const formatIntradayTickLabel = (
  date: Date,
  timeframeMetrics: ReturnType<typeof getTimeframeMetrics>,
  tickMarkType: TickMarkType,
): string => {
  return formatMinuteTickLabel(date, timeframeMetrics, tickMarkType);
};

const formatHigherTimeframeTickLabel = (
  date: Date,
  timeframeMetrics: ReturnType<typeof getTimeframeMetrics>,
  tickMarkType: TickMarkType,
): string => {
  if (tickMarkType === TickMarkType.Year) {
    return String(date.getUTCFullYear());
  }

  if (tickMarkType === TickMarkType.Month || timeframeMetrics.unit === 'month') {
    return formatMonthYear(date);
  }

  // Fallback to DayMonth ("1 Apr") instead of DayMonthYear ("1 Apr 2024")
  return formatDayMonth(date);
};

export const formatTradingChartCrosshairLabel = (
  time: Time,
  timeframe: string,
  brokerOffsetSeconds: number = 0,
): string => {
  const date = toDisplayDate(time, brokerOffsetSeconds);
  if (!date) return '';

  const timeframeMetrics = getTimeframeMetrics(timeframe);

  if (timeframeMetrics.unit === 'month') {
    return formatMonthYear(date);
  }

  if (timeframeMetrics.isIntraday) {
    return `${formatDayMonthYear(date)} ${formatTime(date)}`;
  }

  return formatDayMonthYear(date);
};

export const formatTradingChartTickLabel = (
  time: Time,
  timeframe: string,
  tickMarkType: TickMarkType,
  brokerOffsetSeconds: number = 0,
  options?: {
    forceDateLabel?: boolean;
  },
): string | null => {
  const date = toDisplayDate(time, brokerOffsetSeconds);
  if (!date) return null;

  const timeframeMetrics = getTimeframeMetrics(timeframe);

  if (timeframeMetrics.unit === 'month') {
    return formatMonthYear(date);
  }

  if (options?.forceDateLabel && timeframeMetrics.showsTimeOnlyInFooter) {
    return formatDayMonthYear(date);
  }

  if (timeframeMetrics.isIntraday) {
    return formatIntradayTickLabel(date, timeframeMetrics, tickMarkType);
  }

  return formatHigherTimeframeTickLabel(date, timeframeMetrics, tickMarkType);
};

export const getTradingChartTickMarkCharacterLength = (timeframe: string): number =>
  getTimeframeMetrics(timeframe).tickMarkMaxCharacterLength;

export const shouldTradingChartFooterPromoteLeftEdgeDateLabel = (timeframe: string): boolean =>
  getTimeframeMetrics(timeframe).showsTimeOnlyInFooter;

export const getTradingChartDefaultVisibleBars = (timeframe: string): number =>
  getTimeframeLayoutConfig(timeframe).defaultVisibleBars;

export const getTradingChartDefaultRightPadBars = (timeframe: string): number =>
  getTimeframeLayoutConfig(timeframe).defaultRightPadBars;

export const getTradingChartInitialLogicalRange = ({
  timeframe,
  totalBars,
  adaptiveVisibleBars,
}: {
  timeframe: string;
  totalBars: number;
  adaptiveVisibleBars: number;
}): { from: number; to: number } | null => {
  if (!Number.isFinite(totalBars) || totalBars <= 0) return null;

  const normalizedTimeframe = isTradingChartTimeframe(timeframe) ? timeframe : 'M5';
  const higherTimeframeProfile = HIGHER_TIMEFRAME_INITIAL_RANGE_CONFIG[normalizedTimeframe];
  if (!higherTimeframeProfile) {
    const visibleBars = Math.max(1, adaptiveVisibleBars);
    return {
      from: totalBars - visibleBars,
      to: totalBars + getTradingChartDefaultRightPadBars(normalizedTimeframe),
    };
  }

  if (totalBars > higherTimeframeProfile.dataBars) {
    return {
      from: totalBars - higherTimeframeProfile.dataBars,
      to: totalBars + higherTimeframeProfile.rightPadBars,
    };
  }

  return {
    from: totalBars - higherTimeframeProfile.dataBars,
    to: totalBars + higherTimeframeProfile.sparseRightPadBars,
  };
};

export const getTradingChartShiftRightOffset = (
  timeframe: string,
  enabled: boolean,
): number => (enabled ? getTimeframeLayoutConfig(timeframe).chartShiftRightOffset : 0);
