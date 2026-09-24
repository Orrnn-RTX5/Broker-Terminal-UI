import { defaultHorzScaleBehavior, TickMarkType } from 'lightweight-charts';
import type {
  LocalizationOptions,
  TickMark,
  TickMarkWeightValue,
  Time,
  TimeMark,
  TimeScaleOptions,
  TimeScalePoint,
} from 'lightweight-charts';

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Lightweight-charts calendar weights. Intraday weights below stay under Day.
const WEIGHT_DAY = 50;
const WEIGHT_MONTH = 60;
const WEIGHT_YEAR = 70;
const WEIGHT_TIME = 30;
const WEIGHT_BASE = 20;

// Every step divides the next one, so a coarser label always lands on a finer
// label position (09:00 is also a 1h, 30m, 15m, 5m and 1m label). The steps
// follow TradingView: zooming out an M1 chart goes 1m, 5m, 15m, 30m, 1h, 3h,
// 6h, 12h; the step is picked by zoom, the timeframe only sets the finest one.
const INTRADAY_LABEL_STEPS_SEC = [
  MINUTE,
  5 * MINUTE,
  15 * MINUTE,
  30 * MINUTE,
  HOUR,
  3 * HOUR,
  6 * HOUR,
  12 * HOUR,
] as const;

export interface TimeScaleLabelLevel {
  seconds: number;
  weight: number;
  /** Bars between two consecutive labels of this level on gap-free data. */
  bars: number;
}

const parseIntradayTimeframeSeconds = (timeframe: string): number | null => {
  const match = /^([MH])(\d+)$/.exec(timeframe.toUpperCase());
  if (!match) return null;
  const value = Number(match[2]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const seconds = match[1] === 'M' ? value * MINUTE : value * HOUR;
  return seconds < DAY ? seconds : null;
};

/**
 * Label levels for an intraday timeframe, finest first. The finest level is
 * always one label per bar (M1 → 1 minute, M5 → 5 minutes, H1 → 1 hour); the
 * coarser levels are clean multiples used when the finer labels do not fit.
 */
export const getTradingChartTimeScaleLabelLevels = (timeframe: string): TimeScaleLabelLevel[] | null => {
  const timeframeSeconds = parseIntradayTimeframeSeconds(timeframe);
  if (timeframeSeconds === null) return null;

  const levels: TimeScaleLabelLevel[] = [];
  const baseIndex = INTRADAY_LABEL_STEPS_SEC.indexOf(timeframeSeconds as typeof INTRADAY_LABEL_STEPS_SEC[number]);
  if (baseIndex < 0) {
    levels.push({ seconds: timeframeSeconds, weight: WEIGHT_BASE, bars: 1 });
  }
  INTRADAY_LABEL_STEPS_SEC.forEach((seconds, index) => {
    if (seconds < timeframeSeconds || seconds % timeframeSeconds !== 0) return;
    levels.push({ seconds, weight: WEIGHT_BASE + 1 + index, bars: seconds / timeframeSeconds });
  });
  return levels;
};

const calendarWeight = (current: Date, previous: Date): number => {
  if (current.getUTCFullYear() !== previous.getUTCFullYear()) return WEIGHT_YEAR;
  if (current.getUTCMonth() !== previous.getUTCMonth()) return WEIGHT_MONTH;
  if (current.getUTCDate() !== previous.getUTCDate()) return WEIGHT_DAY;
  return 0;
};

/**
 * Assigns tick weights so that every label level is evenly spaced in bars.
 *
 * A point only gets a level when its time is aligned to that level's step and
 * no mark of the same or higher level sits closer than the level's bar spacing.
 * Together with `uniformDistribution`, this keeps the footer on regular 1m/5m/
 * 15m/... steps instead of falling back to 30m labels as soon as one data gap
 * anywhere in the loaded history produces a crowded pair of marks.
 */
export const computeTradingChartTimeScaleWeights = (
  timesSec: readonly number[],
  levels: readonly TimeScaleLabelLevel[],
  displayOffsetSec: number,
  startIndex: number,
  existingWeights: readonly number[],
): number[] => {
  const count = timesSec.length;
  const weights = existingWeights.slice(0, count);
  if (count === 0 || levels.length === 0) return weights;
  const from = Math.max(0, Math.min(startIndex, count));

  const display = (index: number) => timesSec[index] + displayOffsetSec;
  const calendar = new Array<number>(count).fill(0);
  for (let index = Math.max(1, from); index < count; index++) {
    calendar[index] = calendarWeight(new Date(display(index) * 1000), new Date(display(index - 1) * 1000));
  }

  const nextCalendarIndex = new Array<number>(count + 1).fill(Infinity);
  for (let index = count - 1; index >= from; index--) {
    nextCalendarIndex[index] = calendar[index] > 0 ? index : nextCalendarIndex[index + 1];
  }

  // Last index holding a mark at or above each level, seeded from points that
  // are kept as-is on an incremental update.
  const lastAtOrAbove = levels.map(() => -Infinity);
  const maxBars = levels[levels.length - 1].bars;
  for (let index = from - 1; index >= 0 && from - index <= maxBars; index--) {
    levels.forEach((level, levelIndex) => {
      if (lastAtOrAbove[levelIndex] === -Infinity && (weights[index] ?? 0) >= level.weight) {
        lastAtOrAbove[levelIndex] = index;
      }
    });
  }

  const fitsUpTo = (index: number, levelIndex: number): boolean => {
    for (let lower = 0; lower <= levelIndex; lower++) {
      const bars = levels[lower].bars;
      if (index - lastAtOrAbove[lower] < bars) return false;
      if (nextCalendarIndex[index + 1] - index < bars) return false;
    }
    return true;
  };

  for (let index = from; index < count; index++) {
    let weight: number;
    if (calendar[index] > 0) {
      weight = calendar[index];
    } else {
      const time = display(index);
      let levelIndex = 0;
      for (let candidate = levels.length - 1; candidate > 0; candidate--) {
        if (time % levels[candidate].seconds === 0) {
          levelIndex = candidate;
          break;
        }
      }
      while (levelIndex > 0 && !fitsUpTo(index, levelIndex)) levelIndex--;
      weight = levels[levelIndex].weight;
    }

    weights[index] = weight;
    levels.forEach((level, levelIndex) => {
      if (weight >= level.weight) lastAtOrAbove[levelIndex] = index;
    });
  }

  return weights;
};

const tickMarkTypeForWeight = (weight: number): TickMarkType => {
  if (weight >= WEIGHT_YEAR) return TickMarkType.Year;
  if (weight >= WEIGHT_MONTH) return TickMarkType.Month;
  if (weight >= WEIGHT_DAY) return TickMarkType.DayOfMonth;
  return TickMarkType.Time;
};

const libraryWeightFor = (weight: number): number => (weight >= WEIGHT_DAY ? weight : WEIGHT_TIME);

type TimeScaleWeightPoint = TimeScalePoint & { timeWeight: TickMarkWeightValue };

const DefaultTimeBehavior = defaultHorzScaleBehavior();

export interface TradingChartTimeScaleBehaviorSource {
  getTimeframe: () => string;
  getDisplayOffsetSeconds: () => number;
}

/**
 * Time scale behavior whose tick steps follow the chart timeframe: M1 labels
 * every minute when they fit, then 5m, 15m, 30m, 1h, 3h...; M5 starts at 5m,
 * M15 at 15m and so on. Daily and higher timeframes keep the library behavior.
 */
export class TradingChartTimeScaleBehavior extends DefaultTimeBehavior {
  private readonly source: TradingChartTimeScaleBehaviorSource;
  private hourWeight: number | null = null;

  constructor(source: TradingChartTimeScaleBehaviorSource) {
    super();
    this.source = source;
  }

  override fillWeightsForPoints(sortedTimePoints: readonly TimeScalePoint[], startIndex: number): void {
    const levels = getTradingChartTimeScaleLabelLevels(this.source.getTimeframe());
    if (!levels) {
      this.hourWeight = null;
      super.fillWeightsForPoints(sortedTimePoints, startIndex);
      return;
    }
    this.hourWeight = levels.find(level => level.seconds >= HOUR)?.weight ?? null;

    const points = sortedTimePoints as TimeScaleWeightPoint[];
    const weights = computeTradingChartTimeScaleWeights(
      points.map(point => Number(this.key(point.time))),
      levels,
      this.source.getDisplayOffsetSeconds() || 0,
      startIndex,
      points.map(point => point.timeWeight as number),
    );
    for (let index = Math.max(0, startIndex); index < points.length; index++) {
      points[index].timeWeight = weights[index] as TickMarkWeightValue;
    }
  }

  override maxTickMarkWeight(marks: TimeMark[]): TickMarkWeightValue {
    if (this.hourWeight === null || marks.length === 0) return super.maxTickMarkWeight(marks);
    const maxWeight = marks.reduce((max, mark) => Math.max(max, mark.weight), -Infinity);
    // Keep every full-hour label bold, not only the 4h/12h ones.
    return (maxWeight > this.hourWeight && maxWeight < WEIGHT_DAY ? this.hourWeight : maxWeight) as TickMarkWeightValue;
  }

  override formatTickmark(tickMark: TickMark, localizationOptions: LocalizationOptions<Time>): string {
    if (this.hourWeight === null) return super.formatTickmark(tickMark, localizationOptions);
    const formatter = (this.options().timeScale as TimeScaleOptions).tickMarkFormatter;
    const label = formatter?.(tickMark.originalTime as Time, tickMarkTypeForWeight(tickMark.weight), localizationOptions.locale);
    if (label != null) return label;
    return super.formatTickmark(
      { ...tickMark, weight: libraryWeightFor(tickMark.weight) as TickMarkWeightValue },
      localizationOptions,
    );
  }
}
