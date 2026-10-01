import type { Trade } from '../../../store/useAppStore';
import type { TradeHistoryDataSet } from '../../../api/tradeGateway';

export const HISTORY_PERIOD_PRESETS = [
  ['today', 'Today'],
  ['last-hour', 'Last Hour'],
  ['last-three-hours', 'Last 3 Hours'],
  ['last-six-hours', 'Last 6 Hours'],
  ['last-twelve-hours', 'Last 12 Hours'],
  ['last-24-hours', 'Last 24 Hours'],
  ['last-three-days', 'Last 3 Days'],
  ['last-seven-days', 'Last 7 Days'],
  ['last-fourteen-days', 'Last 14 Days'],
  ['last-thirty-days', 'Last 30 Days'],
  ['last-month', 'Last Month'],
  ['last-three-months', 'Last 3 Months'],
  ['last-six-months', 'Last 6 Months'],
  ['all', 'All History'],
] as const;
export type HistoryPeriodFilter = typeof HISTORY_PERIOD_PRESETS[number][0] | 'custom';
export type HistoryCustomPeriod = { from: string; to: string };

export const toLocalDateInputValue = (date: Date): string => {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

export const subtractCalendarMonths = (value: Date, months: number): Date => {
  const result = new Date(value);
  const day = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() - months);
  const finalDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(day, finalDay));
  return result;
};

export const createDefaultHistoryCustomPeriod = (): HistoryCustomPeriod => {
  const to = new Date();
  const from = subtractCalendarMonths(to, 1);
  return { from: toLocalDateInputValue(from), to: toLocalDateInputValue(to) };
};

export const parseLocalDateBoundary = (value: string, endOfDay: boolean): number | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(
    year,
    month,
    day,
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0,
  );
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null;
  return date.getTime();
};

export const getHistoryRowTime = (trade: Trade): number => {
  const value = Date.parse(trade.closeTime || trade.openTime || '');
  return Number.isFinite(value) ? value : 0;
};

export const getHistoryPeriodStart = (
  period: HistoryPeriodFilter,
  now: number,
): number | null => {
  if (period === 'all' || period === 'custom') return null;
  if (period === 'last-hour') return now - 3_600_000;
  if (period === 'last-three-hours') return now - 3 * 3_600_000;
  if (period === 'last-six-hours') return now - 6 * 3_600_000;
  if (period === 'last-twelve-hours') return now - 12 * 3_600_000;
  if (period === 'last-24-hours') return now - 86_400_000;
  if (period === 'last-three-days') return now - 3 * 86_400_000;
  if (period === 'last-seven-days') return now - 7 * 86_400_000;
  if (period === 'last-fourteen-days') return now - 14 * 86_400_000;
  if (period === 'last-thirty-days') return now - 30 * 86_400_000;
  if (period === 'today') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return start.getTime();
  }
  const months = period === 'last-six-months' ? 6 : period === 'last-three-months' ? 3 : 1;
  const start = subtractCalendarMonths(new Date(now), months);
  start.setHours(0, 0, 0, 0);
  return start.getTime();
};

export const EMPTY_HISTORY_DATA_SET: TradeHistoryDataSet = {
  positions: [],
  deals: [],
  orders: [],
  errors: { positions: null, deals: null, orders: null },
};

export const HISTORY_ROW_HEIGHT = 30;
export const HISTORY_OVERSCAN = 8;
export const HISTORY_VIEWPORT_FALLBACK = 360;

export const getHistoryVirtualWindow = (count: number, scrollTop: number, height: number) => {
  if (count === 0) return { startIndex: 0, endIndex: 0, topSpacerHeight: 0, bottomSpacerHeight: 0 };
  const viewportHeight = height > 0 ? height : HISTORY_VIEWPORT_FALLBACK;
  const offset = Math.max(0, Math.min(scrollTop, Math.max(0, count * HISTORY_ROW_HEIGHT - viewportHeight)));
  const startIndex = Math.max(0, Math.floor(offset / HISTORY_ROW_HEIGHT) - HISTORY_OVERSCAN);
  const endIndex = Math.min(count, Math.ceil((offset + viewportHeight) / HISTORY_ROW_HEIGHT) + HISTORY_OVERSCAN);
  return {
    startIndex,
    endIndex,
    topSpacerHeight: startIndex * HISTORY_ROW_HEIGHT,
    bottomSpacerHeight: (count - endIndex) * HISTORY_ROW_HEIGHT,
  };
};
