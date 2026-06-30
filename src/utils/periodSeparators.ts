export type PeriodSeparatorType = 'day' | 'month' | 'year' | 'session_gap';

export interface PeriodSeparatorCandle {
  time: number;
}

export interface PeriodSeparator {
  time: number;
  index: number;
  type: PeriodSeparatorType;
}

const SECONDS_PER_DAY = 24 * 60 * 60;

const TIMEFRAME_SECONDS: Record<string, number> = {
  M1: 60,
  M5: 5 * 60,
  M15: 15 * 60,
  M30: 30 * 60,
  H1: 60 * 60,
  H4: 4 * 60 * 60,
  D1: SECONDS_PER_DAY,
  W1: 7 * SECONDS_PER_DAY,
  MN: 30 * SECONDS_PER_DAY,
};

const DAY_SEPARATOR_TIMEFRAMES = new Set(['M1', 'M5', 'M15', 'M30', 'H1', 'H4']);
const YEAR_SEPARATOR_TIMEFRAMES = new Set(['W1', 'MN']);
const SESSION_GAP_TIMEFRAMES = new Set(['M1', 'M5', 'M15', 'M30', 'H1', 'H4']);
const MIN_SESSION_GAP_SECONDS = 12 * 60 * 60;

interface BrokerDateParts {
  year: number;
  month: number;
  date: number;
}

export const getPeriodSeparatorTimeframeSeconds = (timeframe: string): number | null => {
  const seconds = TIMEFRAME_SECONDS[timeframe.toUpperCase()];
  return Number.isFinite(seconds) ? seconds : null;
};

const getBrokerDateParts = (time: number, brokerOffsetSeconds: number): BrokerDateParts => {
  const date = new Date((time + brokerOffsetSeconds) * 1000);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth(),
    date: date.getUTCDate(),
  };
};

const isDifferentDate = (prev: BrokerDateParts, curr: BrokerDateParts): boolean => (
  prev.year !== curr.year || prev.month !== curr.month || prev.date !== curr.date
);

const isDifferentMonth = (prev: BrokerDateParts, curr: BrokerDateParts): boolean => (
  prev.year !== curr.year || prev.month !== curr.month
);

const isDifferentYear = (prev: BrokerDateParts, curr: BrokerDateParts): boolean => (
  prev.year !== curr.year
);

export const getPeriodSeparators = (
  candles: readonly PeriodSeparatorCandle[],
  timeframe: string,
  brokerOffsetSeconds = 0,
): PeriodSeparator[] => {
  const normalizedTimeframe = timeframe.toUpperCase();
  const expectedGapSeconds = getPeriodSeparatorTimeframeSeconds(normalizedTimeframe);
  const separators: PeriodSeparator[] = [];

  for (let index = 1; index < candles.length; index += 1) {
    const previous = candles[index - 1];
    const current = candles[index];
    if (!Number.isFinite(previous.time) || !Number.isFinite(current.time)) continue;

    const actualGapSeconds = current.time - previous.time;
    if (
      expectedGapSeconds &&
      SESSION_GAP_TIMEFRAMES.has(normalizedTimeframe) &&
      actualGapSeconds > expectedGapSeconds * 3 &&
      actualGapSeconds >= MIN_SESSION_GAP_SECONDS
    ) {
      separators.push({ time: current.time, index, type: 'session_gap' });
      continue;
    }

    const previousDate = getBrokerDateParts(previous.time, brokerOffsetSeconds);
    const currentDate = getBrokerDateParts(current.time, brokerOffsetSeconds);

    if (DAY_SEPARATOR_TIMEFRAMES.has(normalizedTimeframe)) {
      if (isDifferentDate(previousDate, currentDate)) {
        separators.push({ time: current.time, index, type: 'day' });
      }
      continue;
    }

    if (normalizedTimeframe === 'D1') {
      if (isDifferentMonth(previousDate, currentDate)) {
        separators.push({ time: current.time, index, type: 'month' });
      }
      continue;
    }

    if (YEAR_SEPARATOR_TIMEFRAMES.has(normalizedTimeframe) && isDifferentYear(previousDate, currentDate)) {
      separators.push({ time: current.time, index, type: 'year' });
    }
  }

  return separators;
};
