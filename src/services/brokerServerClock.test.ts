import { afterEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ serverUrl: 'https://service.broker-a.com' }));
vi.mock('./brokerSession', () => ({ getServerUrl: () => session.serverUrl }));

import {
  formatBrokerServerTime,
  getBrokerServerNowMs,
  getBrokerServerTimeZone,
  parseBrokerServerTimeZone,
  recordBrokerServerTime,
  resetBrokerServerClock,
  setBrokerServerTimeZoneFromConfig,
} from './brokerServerClock';

describe('broker server clock', () => {
  afterEach(() => {
    resetBrokerServerClock();
    session.serverUrl = 'https://service.broker-a.com';
  });

  it('stays unsynced until the broker reports a server time', () => {
    expect(getBrokerServerNowMs(1_000)).toBeNull();
    recordBrokerServerTime(undefined, 0, 10);
    recordBrokerServerTime('not a time', 0, 10);
    expect(getBrokerServerNowMs(1_000)).toBeNull();
  });

  it('follows the broker clock, not the device clock, using the round-trip midpoint', () => {
    // Device clock is 5 minutes behind the broker; request took 200ms.
    const deviceStart = 1_790_000_000_000;
    const brokerAtMidpoint = deviceStart + 100 + 300_000;
    recordBrokerServerTime(new Date(brokerAtMidpoint).toISOString(), deviceStart, deviceStart + 200);
    expect(getBrokerServerNowMs(deviceStart + 1_200)).toBe(deviceStart + 1_200 + 300_000);
  });

  it('centres whole-second server_time values inside their second', () => {
    recordBrokerServerTime(1_790_317_495, 1_790_317_495_000, 1_790_317_495_000);
    expect(getBrokerServerNowMs(1_790_317_495_000)).toBe(1_790_317_495_500);
  });

  it('keeps the more precise sample and replaces it once it is stale', () => {
    const t0 = 1_790_000_000_000;
    recordBrokerServerTime(new Date(t0 + 50 + 1_000).toISOString(), t0, t0 + 100); // +1s, ±50ms
    recordBrokerServerTime(new Date(t0 + 5_000 + 2_000).toISOString(), t0 + 4_000, t0 + 6_000); // ±1s, ignored
    expect(getBrokerServerNowMs(t0 + 10_000)).toBe(t0 + 11_000);

    const later = t0 + 11 * 60_000;
    recordBrokerServerTime(new Date(later + 500 + 2_000).toISOString(), later, later + 1_000); // stale sample replaced
    expect(getBrokerServerNowMs(later + 2_000)).toBe(later + 4_000);
  });

  it('never shows one broker clock for another broker', () => {
    const t0 = 1_790_000_000_000;
    recordBrokerServerTime(new Date(t0 + 60_000).toISOString(), t0, t0); // broker A: +60s, exact
    session.serverUrl = 'https://service.broker-b.com';
    expect(getBrokerServerNowMs(t0)).toBeNull();

    recordBrokerServerTime(new Date(t0 + 1_000 - 30_000).toISOString(), t0, t0 + 2_000); // broker B: -30s, ±1s
    expect(getBrokerServerNowMs(t0 + 5_000)).toBe(t0 + 5_000 - 30_000);
  });
});

describe('broker server timezone', () => {
  afterEach(() => resetBrokerServerClock());

  it.each([
    ['UTC', { kind: 'utc' }],
    ['GMT+3', { kind: 'offset', minutes: 180 }],
    ['UTC+05:30', { kind: 'offset', minutes: 330 }],
    ['-04:00', { kind: 'offset', minutes: -240 }],
    [2, { kind: 'offset', minutes: 120 }],
    [180, { kind: 'offset', minutes: 180 }],
    ['Europe/Nicosia', { kind: 'iana', zone: 'Europe/Nicosia' }],
  ])('parses %j', (value, expected) => {
    expect(parseBrokerServerTimeZone(value)).toEqual(expected);
  });

  it.each(['Not/AZone', 'GMT+25', '', null])('rejects %j', (value) => {
    expect(parseBrokerServerTimeZone(value)).toBeNull();
  });

  it('uses the timezone declared in broker config and falls back to UTC', () => {
    setBrokerServerTimeZoneFromConfig({ broker_name: 'X', timezone: 'GMT+2' });
    expect(getBrokerServerTimeZone()).toEqual({ kind: 'offset', minutes: 120 });
    setBrokerServerTimeZoneFromConfig({ broker_name: 'Y' });
    expect(getBrokerServerTimeZone()).toEqual({ kind: 'utc' });
  });

  it('formats broker wall-clock time with its zone label', () => {
    const instant = Date.UTC(2026, 8, 25, 6, 31, 47);
    expect(formatBrokerServerTime(instant, { kind: 'utc' })).toEqual({ time: '06:31:47', zoneLabel: 'UTC' });
    expect(formatBrokerServerTime(instant, { kind: 'offset', minutes: 180 })).toEqual({ time: '09:31:47', zoneLabel: 'GMT+3' });
    expect(formatBrokerServerTime(instant, { kind: 'offset', minutes: 330 })).toEqual({ time: '12:01:47', zoneLabel: 'GMT+5:30' });
    // Cyprus is on EEST (UTC+3) in late September.
    expect(formatBrokerServerTime(instant, { kind: 'iana', zone: 'Asia/Nicosia' })).toEqual({ time: '09:31:47', zoneLabel: 'GMT+3' });
  });
});
