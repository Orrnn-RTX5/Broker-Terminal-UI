import { getServerUrl } from './brokerSession';

/**
 * Broker server clock for display. Responses from the active broker carrying
 * `server_time` give the offset between that broker's clock and this device's
 * clock, so a PC clock that runs fast or slow never changes the time shown as
 * server time. A broker may declare its server timezone in /broker/config;
 * without one the broker clock is shown in UTC, like its `server_time`.
 */

type ClockSample = {
  /** Broker clock minus device clock. */
  offsetMs: number;
  /** Half the request round trip plus the timestamp's own resolution. */
  uncertaintyMs: number;
  observedAtMs: number;
  /** Broker server the timestamp came from; each broker has its own clock. */
  serverUrl: string;
};

export type BrokerServerTimeZone =
  | { kind: 'utc' }
  | { kind: 'offset'; minutes: number }
  | { kind: 'iana'; zone: string };

// A precise sample stays preferred for this long; afterwards any new sample
// replaces it so device-clock drift and clock changes are corrected.
const SAMPLE_MAX_AGE_MS = 10 * 60_000;
const UTC_ZONE: BrokerServerTimeZone = { kind: 'utc' };
const TIME_ZONE_CONFIG_KEYS = ['timezone', 'server_timezone', 'time_zone', 'timezone_offset', 'gmt_offset', 'utc_offset'] as const;

let sample: ClockSample | null = null;
let timeZone: BrokerServerTimeZone = UTC_ZONE;

const currentServerUrl = (): string => {
  try {
    return getServerUrl();
  } catch {
    return '';
  }
};

const parseServerTime = (value: unknown): { epochMs: number; resolutionMs: number } | null => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d+(\.\d+)?$/.test(trimmed)) return parseServerTime(Number(trimmed));
    const epochMs = Date.parse(trimmed);
    if (!Number.isFinite(epochMs) || epochMs <= 0) return null;
    // ISO strings with fractional seconds are precise to the millisecond.
    return { epochMs, resolutionMs: /\d\.\d/.test(trimmed) ? 0 : 1000 };
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  if (value < 1e12) return { epochMs: value * 1000, resolutionMs: Number.isInteger(value) ? 1000 : 0 };
  if (value < 1e15) return { epochMs: value, resolutionMs: 0 };
  if (value < 1e18) return { epochMs: value / 1e3, resolutionMs: 0 };
  return { epochMs: value / 1e6, resolutionMs: 0 };
};

/**
 * Record a broker `server_time` (epoch seconds/ms/µs/ns or ISO string) from a
 * response. The server stamped it somewhere inside the request's round trip,
 * so the midpoint is the best local estimate of that instant.
 */
export const recordBrokerServerTime = (
  serverTime: unknown,
  requestStartedAtMs: number,
  responseReceivedAtMs: number = Date.now(),
): void => {
  const parsed = parseServerTime(serverTime);
  if (!parsed || !(responseReceivedAtMs >= requestStartedAtMs)) return;
  const halfRoundTripMs = (responseReceivedAtMs - requestStartedAtMs) / 2;
  const next: ClockSample = {
    offsetMs: parsed.epochMs + parsed.resolutionMs / 2 - (requestStartedAtMs + halfRoundTripMs),
    uncertaintyMs: halfRoundTripMs + parsed.resolutionMs / 2,
    observedAtMs: responseReceivedAtMs,
    serverUrl: currentServerUrl(),
  };
  if (
    !sample
    || next.serverUrl !== sample.serverUrl
    || next.uncertaintyMs <= sample.uncertaintyMs
    || next.observedAtMs - sample.observedAtMs > SAMPLE_MAX_AGE_MS
  ) {
    sample = next;
  }
};

/**
 * Active broker's server time now, or null until that broker has reported a
 * timestamp (a previous broker's clock is never carried over).
 */
export const getBrokerServerNowMs = (localNowMs: number = Date.now()): number | null => (
  sample && sample.serverUrl === currentServerUrl() ? localNowMs + sample.offsetMs : null
);

const isIanaTimeZone = (zone: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

/** "Europe/Nicosia", "UTC", "GMT+3", "UTC+05:30", "+02:00", or offset hours/minutes. */
export const parseBrokerServerTimeZone = (value: unknown): BrokerServerTimeZone | null => {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    // Small values are hours (MT5 style); larger ones are minutes.
    const minutes = Math.abs(value) <= 14 ? Math.round(value * 60) : Math.round(value);
    if (Math.abs(minutes) > 14 * 60) return null;
    return minutes === 0 ? UTC_ZONE : { kind: 'offset', minutes };
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^(utc|gmt|z)$/i.test(trimmed)) return UTC_ZONE;
  const offset = trimmed.match(/^(?:utc|gmt)?\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?$/i);
  if (offset) {
    const minutes = (offset[1] === '-' ? -1 : 1) * (Number(offset[2]) * 60 + Number(offset[3] ?? 0));
    if (Math.abs(minutes) > 14 * 60) return null;
    return minutes === 0 ? UTC_ZONE : { kind: 'offset', minutes };
  }
  if (/^[+-]?\d+(\.\d+)?$/.test(trimmed)) return parseBrokerServerTimeZone(Number(trimmed));
  return isIanaTimeZone(trimmed) ? { kind: 'iana', zone: trimmed } : null;
};

/** Apply the timezone declared by the active broker's /broker/config (UTC if none). */
export const setBrokerServerTimeZoneFromConfig = (config: unknown): void => {
  const record = config && typeof config === 'object' ? config as Record<string, unknown> : {};
  const declared = TIME_ZONE_CONFIG_KEYS.map(key => record[key]).find(value => value !== undefined && value !== null && value !== '');
  timeZone = parseBrokerServerTimeZone(declared) ?? UTC_ZONE;
};

export const getBrokerServerTimeZone = (): BrokerServerTimeZone => timeZone;

const formatOffsetLabel = (minutes: number): string => {
  const sign = minutes < 0 ? '-' : '+';
  const hours = Math.floor(Math.abs(minutes) / 60);
  const rest = Math.abs(minutes) % 60;
  return `GMT${sign}${hours}${rest ? `:${String(rest).padStart(2, '0')}` : ''}`;
};

const ianaFormatters = new Map<string, { time: Intl.DateTimeFormat; zone: Intl.DateTimeFormat }>();

/** Wall-clock HH:mm:ss and zone label of an instant in the broker's timezone. */
export const formatBrokerServerTime = (
  epochMs: number,
  zone: BrokerServerTimeZone = timeZone,
): { time: string; zoneLabel: string } => {
  if (zone.kind === 'offset') {
    return {
      time: new Date(epochMs + zone.minutes * 60_000).toISOString().slice(11, 19),
      zoneLabel: formatOffsetLabel(zone.minutes),
    };
  }
  if (zone.kind === 'iana') {
    let formatters = ianaFormatters.get(zone.zone);
    if (!formatters) {
      formatters = {
        time: new Intl.DateTimeFormat('en-GB', { timeZone: zone.zone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }),
        zone: new Intl.DateTimeFormat('en-US', { timeZone: zone.zone, timeZoneName: 'shortOffset' }),
      };
      ianaFormatters.set(zone.zone, formatters);
    }
    const date = new Date(epochMs);
    const zoneLabel = formatters.zone.formatToParts(date).find(part => part.type === 'timeZoneName')?.value || zone.zone;
    return { time: formatters.time.format(date), zoneLabel };
  }
  return { time: new Date(epochMs).toISOString().slice(11, 19), zoneLabel: 'UTC' };
};

export const resetBrokerServerClock = (): void => {
  sample = null;
  timeZone = UTC_ZONE;
};
