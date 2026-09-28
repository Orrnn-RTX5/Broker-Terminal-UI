import type { Trade } from '../../../store/useAppStore';
import type { TradeHistoryDataSet } from '../../../api/tradeGateway';

export type HistoryPeriodFilter = 'all' | 'last-three-months' | 'last-month' | 'custom';
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
  const start = subtractCalendarMonths(new Date(now), period === 'last-three-months' ? 3 : 1);
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
