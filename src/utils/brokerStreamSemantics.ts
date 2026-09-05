/**
 * Canonical normalization for broker websocket metadata.
 *
 * Broker adapters legitimately differ in field naming and epoch precision. The
 * transport boundary converts those variants once so downstream chart/account
 * state never has to guess whether a value is seconds, milliseconds, or text.
 */

export const BROKER_SOURCE_TIMESTAMP_KEYS = [
  'sourceTimestamp',
  'source_timestamp',
  'timestamp',
  'timestamp_ms',
  'timestampMs',
  'timestamp_us',
  'timestampUs',
  'timestamp_ns',
  'timestampNs',
  'time',
  'time_ms',
  'timeMs',
  'time_msc',
  'timeMsc',
  'time_us',
  'timeUs',
  'time_ns',
  'timeNs',
  'tick_timestamp',
  'tickTimestamp',
  'event_timestamp',
  'eventTimestamp',
  'event_time',
  'eventTime',
  'server_timestamp',
  'serverTimestamp',
  'server_time',
  'serverTime',
  'quote_time',
  'quoteTime',
] as const;

export const CANDLE_FINALITY_KEYS = [
  'closed',
  'is_closed',
  'isClosed',
  'complete',
  'completed',
  'is_complete',
  'isComplete',
  'final',
] as const;

export type UnknownRecord = Record<string, unknown>;

export const asUnknownRecord = (value: unknown): UnknownRecord | undefined => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined
);

/** Normalize Unix seconds/ms/us/ns or an ISO timestamp to integer milliseconds. */
export const normalizeBrokerTimestampMs = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === '') return undefined;

  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    // FIX: Epoch magnitude identifies the precision used by current broker
    // gateways; division (not a seconds-only threshold) prevents us/ns values
    // from becoming dates thousands of years in the future.
    if (numeric >= 100_000_000_000_000_000) return Math.floor(numeric / 1_000_000);
    if (numeric >= 100_000_000_000_000) return Math.floor(numeric / 1_000);
    if (numeric >= 100_000_000_000) return Math.floor(numeric);
    return Math.floor(numeric * 1_000);
  }

  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
};

export const normalizeBrokerTimestampSeconds = (value: unknown): number | undefined => {
  const milliseconds = normalizeBrokerTimestampMs(value);
  return milliseconds === undefined ? undefined : Math.floor(milliseconds / 1_000);
};

export const readBrokerTimestampMs = (
  records: readonly (UnknownRecord | undefined | null)[],
  keys: readonly string[] = BROKER_SOURCE_TIMESTAMP_KEYS,
): number | undefined => {
  for (const record of records) {
    if (!record) continue;
    for (const key of keys) {
      const normalized = normalizeBrokerTimestampMs(record[key]);
      if (normalized !== undefined) return normalized;
    }
  }
  return undefined;
};

export const normalizeBooleanLike = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1') return true;
  if (value === 0 || value === '0') return false;
  if (typeof value !== 'string') return undefined;

  const normalized = value.trim().toLowerCase();
  if (['true', 'yes', 'closed', 'complete', 'completed', 'final'].includes(normalized)) return true;
  if (['false', 'no', 'open', 'forming', 'partial', 'incomplete'].includes(normalized)) return false;
  return undefined;
};

export const readCandleFinality = (
  records: readonly (UnknownRecord | undefined | null)[],
): boolean | undefined => {
  for (const record of records) {
    if (!record) continue;
    for (const key of CANDLE_FINALITY_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
      const normalized = normalizeBooleanLike(record[key]);
      if (normalized !== undefined) return normalized;
    }
  }
  return undefined;
};
