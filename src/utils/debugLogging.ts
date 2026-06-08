import { ENABLE_DEBUG } from '../config/api';

export const debugLog = (...args: unknown[]): void => {
  if (ENABLE_DEBUG) console.log(...args);
};

export const debugDebug = (...args: unknown[]): void => {
  if (ENABLE_DEBUG) console.debug(...args);
};

export const redactUrlForDebugLog = (value: string): string => {
  const raw = String(value || '');
  if (!raw.includes('?')) return raw;

  try {
    const base = typeof window !== 'undefined' && window.location?.href
      ? window.location.href
      : 'https://debug.local/';
    const parsed = new URL(raw, base);
    parsed.search = '?redacted=1';
    return parsed.toString();
  } catch {
    return `${raw.split('?')[0]}?redacted=1`;
  }
};
