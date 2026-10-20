import type { Timeframe } from '../types/chart';

/**
 * Terminal chart defaults.
 *
 * Tenant configuration — never compiled-in broker/market selections. The
 * default symbol comes from deployment config (`DEFAULT_CHART_SYMBOL`) or
 * build env (`VITE_DEFAULT_CHART_SYMBOL`); when unset it is EMPTY and callers
 * must fall back to the first authorized symbol (or fail visibly) instead of
 * opening another broker's market. The timeframe/count fall back to generic
 * technical defaults that carry no tenant data.
 */

const SYMBOL_PATTERN = /^[A-Z0-9._-]{1,20}$/;
const TIMEFRAMES: ReadonlySet<string> = new Set<Timeframe>([
  'M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1', 'MN',
]);
const isTimeframe = (value: string): value is Timeframe => TIMEFRAMES.has(value);

const readRuntimeValue = (...keys: string[]): string => {
  if (typeof window === 'undefined') return '';
  const sources: Array<unknown> = [
    (window as unknown as { __RTX_RUNTIME_CONFIG__?: unknown }).__RTX_RUNTIME_CONFIG__,
    (window as unknown as { RUNTIME_CONFIG?: unknown }).RUNTIME_CONFIG,
    (window as unknown as { __RUNTIME_CONFIG__?: unknown }).__RUNTIME_CONFIG__,
  ];
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    const record = source as Record<string, unknown>;
    for (const key of keys) {
      const value = record[key];
      if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
    }
  }
  return '';
};

const readEnvValue = (...keys: string[]): string => {
  try {
    // Plain `import.meta.env` so Vite (build) and Vitest (stubEnv) resolve it;
    // a cast on `import.meta` hides the access from Vite's env replacement.
    const env = (import.meta.env || {}) as Record<string, string | undefined>;
    for (const key of keys) {
      const value = env[key];
      if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
    }
  } catch {
    // No Vite build-time env (SSR/plain tests); deployment runtime config still applies.
  }
  return '';
};

const resolveDefaultChartSymbol = (): string => {
  const candidate = (
    readRuntimeValue('DEFAULT_CHART_SYMBOL', 'VITE_DEFAULT_CHART_SYMBOL') ||
    readEnvValue('VITE_DEFAULT_CHART_SYMBOL', 'DEFAULT_CHART_SYMBOL')
  ).toUpperCase();
  return SYMBOL_PATTERN.test(candidate) ? candidate : '';
};

const resolveDefaultChartTimeframe = (): Timeframe => {
  const candidate = (
    readRuntimeValue('DEFAULT_CHART_TIMEFRAME', 'VITE_DEFAULT_CHART_TIMEFRAME') ||
    readEnvValue('VITE_DEFAULT_CHART_TIMEFRAME', 'DEFAULT_CHART_TIMEFRAME')
  ).toUpperCase();
  return isTimeframe(candidate) ? candidate : 'M1';
};

const resolveFirstPaintHistoryCount = (): number => {
  const candidate = Number.parseInt(
    readRuntimeValue('FIRST_PAINT_HISTORY_COUNT', 'VITE_FIRST_PAINT_HISTORY_COUNT') ||
    readEnvValue('VITE_FIRST_PAINT_HISTORY_COUNT', 'FIRST_PAINT_HISTORY_COUNT'),
    10,
  );
  return Number.isInteger(candidate) && candidate > 0 ? candidate : 500;
};

/** Tenant-configured default symbol; '' when unset (use the first authorized symbol). */
export const DEFAULT_CHART_SYMBOL = resolveDefaultChartSymbol();
/** Tenant-overridable default timeframe; generic 'M1' fallback. */
export const DEFAULT_CHART_TIMEFRAME = resolveDefaultChartTimeframe();
/** Tenant-overridable first-paint history size; generic 500 fallback. */
export const FIRST_PAINT_HISTORY_COUNT = resolveFirstPaintHistoryCount();
