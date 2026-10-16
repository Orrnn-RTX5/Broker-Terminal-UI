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
  // MT5 bottom time scale renders "DD Mon HH:MM" on intraday ticks and promotes
  // the leftmost visible tick to "DD Mon YYYY".
  const showsTimeOnlyInFooter = false;

  const tickMarkMaxCharacterLength = parsed.unit === 'month'
    ? 8   // Covers "Apr 2024" (MN)
    : isIntraday
      ? 12  // Covers "12 Oct 16:00" for intraday setups
      : 11; // Covers "12 Oct 2026" (D1/W1)

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

const monthFormatters = new Map<string, Intl.DateTimeFormat>();
const formatMonth = (date: Date, locale = 'en'): string => {
  if (locale.startsWith('en')) return MONTH_NAMES[date.getUTCMonth()];
  let formatter = monthFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' });
    monthFormatters.set(locale, formatter);
  }
  return formatter.format(date);
};
const formatDayMonth = (date: Date, locale = 'en'): string => `${date.getUTCDate()} ${formatMonth(date, locale)}`;
const formatMonthYear = (date: Date, locale = 'en'): string => `${formatMonth(date, locale)} ${date.getUTCFullYear()}`;
const formatDayMonthYear = (date: Date, locale = 'en'): string => `${formatDayMonth(date, locale)} ${date.getUTCFullYear()}`;
const formatTime = (date: Date): string => `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`;
const formatTimeWithSeconds = (date: Date): string => `${formatTime(date)}:${pad2(date.getUTCSeconds())}`;

const formatMinuteTickLabel = (
  date: Date,
  timeframeMetrics: ReturnType<typeof getTimeframeMetrics>,
  tickMarkType: TickMarkType,
  locale = 'en',
): string => {
  if (tickMarkType === TickMarkType.Year) {
    return String(date.getUTCFullYear());
  }

  if (tickMarkType === TickMarkType.Month) {
    return formatMonthYear(date, locale);
  }

  if (tickMarkType === TickMarkType.DayOfMonth) {
    return formatDayMonthYear(date, locale);
  }

  if (tickMarkType === TickMarkType.TimeWithSeconds) {
    return timeframeMetrics.showsTimeOnlyInFooter
      ? formatTimeWithSeconds(date)
      : `${formatDayMonth(date, locale)} ${formatTimeWithSeconds(date)}`;
  }

  return timeframeMetrics.showsTimeOnlyInFooter
    ? formatTime(date)
    : `${formatDayMonth(date, locale)} ${formatTime(date)}`;
};

const formatIntradayTickLabel = (
  date: Date,
  timeframeMetrics: ReturnType<typeof getTimeframeMetrics>,
  tickMarkType: TickMarkType,
  locale = 'en',
): string => {
  return formatMinuteTickLabel(date, timeframeMetrics, tickMarkType, locale);
};

const formatHigherTimeframeTickLabel = (
  date: Date,
  timeframeMetrics: ReturnType<typeof getTimeframeMetrics>,
  tickMarkType: TickMarkType,
  locale = 'en',
): string => {
  if (tickMarkType === TickMarkType.Year) {
    return String(date.getUTCFullYear());
  }

  if (tickMarkType === TickMarkType.Month || timeframeMetrics.unit === 'month') {
    return formatMonthYear(date, locale);
  }

  return formatDayMonthYear(date, locale);
};

const formatUtcOffsetLabel = (offsetSeconds: number): string => {
  if (!Number.isFinite(offsetSeconds) || offsetSeconds === 0) return 'UTC';
  const sign = offsetSeconds < 0 ? '-' : '+';
  const totalMinutes = Math.round(Math.abs(offsetSeconds) / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `UTC${sign}${hours}` : `UTC${sign}${hours}:${pad2(minutes)}`;
};

/** Date and clock under the area-chart point card. Intraday includes the broker zone. */
export const formatAreaPointHoverTime = (
  time: Time,
  timeframe: string,
  brokerOffsetSeconds = 0,
  locale = 'en',
): { date: string; time: string } | null => {
  const date = toDisplayDate(time, brokerOffsetSeconds);
  if (!date) return null;

  const metrics = getTimeframeMetrics(timeframe);
  const year = String(date.getUTCFullYear()).slice(-2);
  const month = formatMonth(date, locale);
  const dateLabel = metrics.unit === 'month'
    ? `${month} '${year}`
    : `${date.getUTCDate()} ${month} '${year}`;

  return {
    date: dateLabel,
    time: metrics.isIntraday ? `${formatTime(date)} ${formatUtcOffsetLabel(brokerOffsetSeconds)}` : '',
  };
};

export const formatTradingChartCrosshairLabel = (
  time: Time,
  timeframe: string,
  brokerOffsetSeconds: number = 0,
  locale = 'en',
): string => {
  const date = toDisplayDate(time, brokerOffsetSeconds);
  if (!date) return '';

  const timeframeMetrics = getTimeframeMetrics(timeframe);

  if (timeframeMetrics.unit === 'month') {
    return formatMonthYear(date, locale);
  }

  if (timeframeMetrics.isIntraday) {
    return `${formatDayMonthYear(date, locale)} ${formatTime(date)}`;
  }

  return formatDayMonthYear(date, locale);
};

export const formatTradingChartTickLabel = (
  time: Time,
  timeframe: string,
  tickMarkType: TickMarkType,
  brokerOffsetSeconds: number = 0,
  options?: {
    forceDateLabel?: boolean;
    locale?: string;
  },
): string | null => {
  const date = toDisplayDate(time, brokerOffsetSeconds);
  if (!date) return null;

  const timeframeMetrics = getTimeframeMetrics(timeframe);

  if (timeframeMetrics.unit === 'month') {
    return formatMonthYear(date, options?.locale);
  }

  if (options?.forceDateLabel && timeframeMetrics.isIntraday) {
    return formatDayMonthYear(date, options?.locale);
  }

  if (timeframeMetrics.isIntraday) {
    return formatIntradayTickLabel(date, timeframeMetrics, tickMarkType, options?.locale);
  }

  return formatHigherTimeframeTickLabel(date, timeframeMetrics, tickMarkType, options?.locale);
};

export const getTradingChartTickMarkCharacterLength = (timeframe: string): number =>
  getTimeframeMetrics(timeframe).tickMarkMaxCharacterLength;

export const shouldTradingChartFooterPromoteLeftEdgeDateLabel = (timeframe: string): boolean =>
  getTimeframeMetrics(timeframe).isIntraday;

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
