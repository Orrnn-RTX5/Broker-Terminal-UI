import {
  TIMEFRAME_SECONDS,
  type BoundaryTimeframe,
} from './timeframeBoundary';

export type BackendCandleTimeframe = BoundaryTimeframe;

export interface CandleApiQueryInput {
  timeframe?: unknown;
  from?: unknown;
  to?: unknown;
  limit?: unknown;
  count?: unknown;
}

export interface CandleApiQueryParams {
  timeframe?: BackendCandleTimeframe;
  from?: number;
  to?: number;
  limit?: number;
}

export const MAX_CANDLE_API_LIMIT = 5000;

export const CANDLE_TIMEFRAME_SECONDS: Readonly<Record<BackendCandleTimeframe, number>> = TIMEFRAME_SECONDS;

const TIMEFRAME_ALIASES: Record<string, BackendCandleTimeframe> = {
  M1: 'M1',
  '1': 'M1',
  '1M': 'M1',
  '1MIN': 'M1',
  '1MINUTE': 'M1',
  M5: 'M5',
  '5': 'M5',
  '5M': 'M5',
  '5MIN': 'M5',
  '5MINUTE': 'M5',
  M15: 'M15',
  '15': 'M15',
  '15M': 'M15',
  '15MIN': 'M15',
  '15MINUTE': 'M15',
  M30: 'M30',
  '30': 'M30',
  '30M': 'M30',
  '30MIN': 'M30',
  '30MINUTE': 'M30',
  H1: 'H1',
  '1H': 'H1',
  '60': 'H1',
  H4: 'H4',
  '4H': 'H4',
  D1: 'D1',
  '1D': 'D1',
  W1: 'W1',
  '1W': 'W1',
  MN: 'MN',
  '1MO': 'MN',
  '1MON': 'MN',
  '1MONTH': 'MN',
};

const MILLISECOND_EPOCH_THRESHOLD = 1_000_000_000_000;

export const normalizeBackendCandleTimeframeOrNull = (timeframe: unknown): BackendCandleTimeframe | null => {
  if (timeframe === undefined || timeframe === null || timeframe === '') return null;
  const normalized = String(timeframe).trim().toUpperCase();
  return TIMEFRAME_ALIASES[normalized] ?? null;
};

export const normalizeBackendCandleTimeframe = (
  timeframe: unknown,
  fallback: BackendCandleTimeframe = 'M1',
): BackendCandleTimeframe => normalizeBackendCandleTimeframeOrNull(timeframe) ?? fallback;

export const normalizeCandleUnixSeconds = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined;

  const raw = value instanceof Date
    ? value.getTime()
    : typeof value === 'string' && Number.isNaN(Number(value))
      ? Date.parse(value)
      : Number(value);

  if (!Number.isFinite(raw)) return undefined;
  return Math.floor(Math.abs(raw) >= MILLISECOND_EPOCH_THRESHOLD ? raw / 1000 : raw);
};

export const normalizeCandleLimit = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(MAX_CANDLE_API_LIMIT, Math.max(0, Math.floor(parsed)));
};

export const normalizeCandleApiQueryParams = (input: CandleApiQueryInput = {}): CandleApiQueryParams => {
  const params: CandleApiQueryParams = {};
  const timeframe = normalizeBackendCandleTimeframeOrNull(input.timeframe);
  const limit = normalizeCandleLimit(input.limit ?? input.count);
  const from = normalizeCandleUnixSeconds(input.from);
  const to = normalizeCandleUnixSeconds(input.to);

  if (timeframe) params.timeframe = timeframe;
  if (from !== undefined) params.from = from;
  if (to !== undefined) params.to = to;
  if (limit !== undefined) params.limit = limit;

  return params;
};
