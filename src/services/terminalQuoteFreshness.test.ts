import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertTerminalQuoteFresh, calibrateTerminalQuoteClock, getTerminalQuoteFreshness, getTerminalQuoteFreshnessRevision, getTerminalQuoteSession, ingestTerminalQuote, readQuoteFreshnessMetadata, resetTerminalQuoteFreshness, subscribeTerminalQuoteFreshness, terminalQuoteFreshnessEnabled } from './terminalQuoteFreshness';

const epoch = 1_800_000_000_000;
let mono: number;
let wall: number;
const quote = (sequence = 1, age = 0) => ({ bid: 100, ask: 101, provider_timestamp: epoch + mono - age, sequence, source: 'lp' });
const calibrate = () => calibrateTerminalQuoteClock(epoch + mono, mono, wall, mono, wall);
describe('terminal quote freshness', () => {
  beforeEach(() => {
    mono = 1000; wall = epoch + mono;
    vi.spyOn(performance, 'now').mockImplementation(() => mono);
    vi.spyOn(Date, 'now').mockImplementation(() => wall);
    resetTerminalQuoteFreshness();
    (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__ = { TERMINAL_QUOTE_FRESHNESS: true };
  });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); delete (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__; });
  it('expires after 3000ms without messages and immediately recovers on a new tick', () => {
    calibrate(); ingestTerminalQuote('XAUUSD', quote());
    expect(getTerminalQuoteFreshness('xauusd').live).toBe(true);
    mono += 2996; wall += 2996;
    expect(getTerminalQuoteFreshness('XAUUSD').live).toBe(true);
    mono += 3; wall += 3;
    expect(getTerminalQuoteFreshness('XAUUSD').reason).toBe('time-unverified');
    mono += 6; wall += 6;
    expect(getTerminalQuoteFreshness('XAUUSD')).toMatchObject({ live: false, reason: 'stale' });
    ingestTerminalQuote('XAUUSD', quote(2));
    expect(getTerminalQuoteFreshness('XAUUSD').live).toBe(true);
  });
  it('does not renew duplicates, old sequences or old status snapshots', () => {
    calibrate(); ingestTerminalQuote('XAUUSD', quote(10));
    mono += 3100; wall += 3100;
    expect(ingestTerminalQuote('XAUUSD', quote(10))).toBe(false);
    expect(ingestTerminalQuote('XAUUSD', quote(9))).toBe(false);
    expect(ingestTerminalQuote('XAUUSD', { ...quote(11), provider_timestamp: epoch })).toBe(false);
    expect(getTerminalQuoteFreshness('XAUUSD').live).toBe(false);
  });
  it('compares large integer sequences without losing precision', () => {
    ingestTerminalQuote('XAUUSD', { ...quote(), sequence: '9007199254740993' });
    expect(ingestTerminalQuote('XAUUSD', { ...quote(), sequence: '9007199254740992' })).toBe(false);
    expect(ingestTerminalQuote('XAUUSD', { ...quote(), sequence: '9007199254740994' })).toBe(true);
  });
  it('retains the session sequence watermark across unsequenced status snapshots', () => {
    calibrate(); ingestTerminalQuote('XAUUSD', quote(10));
    mono++; wall++;
    expect(ingestTerminalQuote('XAUUSD', { ...quote(), sequence: undefined })).toBe(true);
    mono++; wall++;
    expect(ingestTerminalQuote('XAUUSD', quote(9))).toBe(false);
    expect(ingestTerminalQuote('XAUUSD', quote(11))).toBe(true);
  });
  it('accepts same-sequence veto but never duplicate recovery', () => {
    calibrate(); ingestTerminalQuote('XAUUSD', quote(1));
    ingestTerminalQuote('XAUUSD', { ...quote(1), stale: true });
    expect(getTerminalQuoteFreshness('XAUUSD').live).toBe(false);
    ingestTerminalQuote('XAUUSD', { ...quote(1), stale: false });
    expect(getTerminalQuoteFreshness('XAUUSD').live).toBe(false);
    mono++; wall++; ingestTerminalQuote('XAUUSD', quote(2));
    expect(getTerminalQuoteFreshness('XAUUSD').live).toBe(true);
  });
  it('does not let future timestamps, corrupt sequence or invalid prices poison recovery', () => {
    calibrate(); ingestTerminalQuote('XAUUSD', quote(1));
    expect(ingestTerminalQuote('XAUUSD', { ...quote(999), provider_timestamp: epoch + 999999 })).toBe(false);
    expect(ingestTerminalQuote('XAUUSD', { ...quote(), sequence: '999999999999999999999999999999999' })).toBe(false);
    expect(ingestTerminalQuote('XAUUSD', { ...quote(999), bid: NaN })).toBe(false);
    mono++; wall++; expect(ingestTerminalQuote('XAUUSD', quote(2))).toBe(true);
    expect(getTerminalQuoteFreshness('XAUUSD').live).toBe(true);
  });
  it('never fabricates provider timestamps from receipt or generic time', () => {
    expect(readQuoteFreshnessMetadata({ receivedAt: epoch, timestamp: epoch, time: epoch }).provider_timestamp).toBeUndefined();
    expect(readQuoteFreshnessMetadata({ time_ms: epoch }, { source: 'lp', stale: false, tradable: true, sequence: 3 })).toMatchObject({ provider_timestamp: epoch, source: 'lp', stale: false, tradable: true, sequence: 3 });
    expect(readQuoteFreshnessMetadata({ provider_timestamp: 'bad' }, { provider_timestamp: epoch }).provider_timestamp).toBeUndefined();
    calibrate(); ingestTerminalQuote('XAUUSD', { bid: 100, ask: 101 });
    expect(getTerminalQuoteFreshness('XAUUSD').reason).toBe('unavailable');
  });
  it('preserves explicit missing-provider provenance through repeat normalization', () => {
    const normalized = { ...readQuoteFreshnessMetadata({ timestamp: epoch }), sourceTimestamp: epoch };
    expect(readQuoteFreshnessMetadata(normalized).provider_timestamp).toBeUndefined();
    expect(readQuoteFreshnessMetadata({ provider_timestamp: undefined, time_ms: epoch }).provider_timestamp).toBeUndefined();
    expect(readQuoteFreshnessMetadata({ provider_timestamp: 'invalid', time_ms: epoch }).provider_timestamp).toBeUndefined();
    expect(readQuoteFreshnessMetadata({ sourceTimestamp: epoch }).provider_timestamp).toBe(epoch);
  });
  it('rejects seconds timestamp, missing source and preserves envelope vetoes', () => {
    expect(readQuoteFreshnessMetadata({ provider_timestamp: 1800000000 }).provider_timestamp).toBeUndefined();
    expect(readQuoteFreshnessMetadata({ stale: false, tradable: true, source_mismatch: false }, { stale: true, tradable: false, source_mismatch: true })).toMatchObject({ stale: true, tradable: false, source_mismatch: true });
    calibrate(); ingestTerminalQuote('XAUUSD', { ...quote(), source: undefined });
    expect(getTerminalQuoteFreshness('XAUUSD').reason).toBe('unavailable');
  });
  it('purges uncalibrated future evidence when the first clock sample arrives', () => {
    const before = getTerminalQuoteSession();
    ingestTerminalQuote('XAUUSD', { ...quote(999), provider_timestamp: epoch + 999999 });
    calibrate();
    expect(getTerminalQuoteSession()).toBe(before + 1);
    expect(ingestTerminalQuote('XAUUSD', quote(1))).toBe(true);
    expect(getTerminalQuoteFreshness('XAUUSD').live).toBe(true);
  });
  it.each([{ bid: NaN }, { ask: 0 }, { bid: 200 }, { provider_timestamp: Infinity }, { provider_timestamp: epoch + 10000 }])('blocks invalid data %j', override => {
    calibrate(); ingestTerminalQuote('XAUUSD', { ...quote(), ...override });
    expect(getTerminalQuoteFreshness('XAUUSD').live).toBe(false);
  });
  it.each([{ stale: true }, { tradable: false }, { source_mismatch: true }])('respects source restrictions %j', flags => {
    calibrate(); ingestTerminalQuote('XAUUSD', { ...quote(), ...flags });
    expect(getTerminalQuoteFreshness('XAUUSD').live).toBe(false);
  });
  it('invalidates old session evidence and HTTP completion ownership', () => {
    const oldSession = getTerminalQuoteSession();
    calibrate(); ingestTerminalQuote('XAUUSD', quote(100));
    resetTerminalQuoteFreshness();
    expect(getTerminalQuoteFreshness('XAUUSD').live).toBe(false);
    expect(ingestTerminalQuote('XAUUSD', quote(101), oldSession)).toBe(false);
    expect(calibrateTerminalQuoteClock(epoch, mono, wall, mono, wall, oldSession)).toBe(false);
    calibrate(); expect(ingestTerminalQuote('XAUUSD', quote(1))).toBe(true);
  });
  it('bounds calibration by RTT, rejects old replies and expires the clock', () => {
    expect(calibrateTerminalQuoteClock(epoch, 0, epoch, 2001, epoch + 2001)).toBe(false);
    expect(calibrateTerminalQuoteClock(epoch, 0, epoch, 500, epoch + 500)).toBe(true);
    expect(calibrateTerminalQuoteClock(epoch, -1, epoch, 500, epoch + 501)).toBe(false);
    calibrate(); ingestTerminalQuote('XAUUSD', quote());
    mono += 60000; wall += 60000;
    expect(getTerminalQuoteFreshness('XAUUSD').reason).toBe('time-unverified');
  });
  it('uses conservative server time and supports ISO server timestamps', () => {
    calibrateTerminalQuoteClock(new Date(epoch).toISOString(), 900, epoch + 900, 1000, epoch + 1000);
    ingestTerminalQuote('XAUUSD', { ...quote(), provider_timestamp: epoch });
    expect(getTerminalQuoteFreshness('XAUUSD').ageMs).toBe(101);
  });
  it('rejects wall jumps during requests and after calibration', () => {
    expect(calibrateTerminalQuoteClock(epoch, 0, epoch, 100, epoch + 600)).toBe(false);
    calibrate(); ingestTerminalQuote('XAUUSD', quote()); wall += 5000;
    expect(getTerminalQuoteFreshness('XAUUSD').reason).toBe('time-unverified');
  });
  it('owns a single 100ms timer and stops it after the last subscriber', () => {
    vi.useFakeTimers();
    const a = vi.fn(); const b = vi.fn();
    const unA = subscribeTerminalQuoteFreshness(a); const unB = subscribeTerminalQuoteFreshness(b);
    const before = getTerminalQuoteFreshnessRevision();
    vi.advanceTimersByTime(200);
    expect(getTerminalQuoteFreshnessRevision() - before).toBe(2);
    expect(a).toHaveBeenCalledTimes(2); expect(b).toHaveBeenCalledTimes(2);
    unA(); unB(); vi.advanceTimersByTime(200); expect(a).toHaveBeenCalledTimes(2);
  });
  it('fails synchronously at order click only when enabled', () => {
    expect(() => assertTerminalQuoteFresh('XAUUSD')).toThrow('Quote unavailable');
    calibrate(); ingestTerminalQuote('XAUUSD', quote());
    expect(() => assertTerminalQuoteFresh('XAUUSD')).not.toThrow();
    delete (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__;
    expect(terminalQuoteFreshnessEnabled()).toBe(false);
    expect(() => assertTerminalQuoteFresh('UNKNOWN')).not.toThrow();
  });
});

describe('clock interval decisions', () => {
  beforeEach(() => { mono = 1000; wall = epoch + mono; vi.spyOn(performance, 'now').mockImplementation(() => mono); vi.spyOn(Date, 'now').mockImplementation(() => wall); resetTerminalQuoteFreshness(); });
  afterEach(() => vi.restoreAllMocks());
  it('accepts a slow clock sample and differentiates ambiguous age from definite expiry', () => {
    expect(calibrateTerminalQuoteClock(epoch, 0, epoch, 1500, epoch + 1500)).toBe(true);
    mono = 1500; wall = epoch + mono;
    ingestTerminalQuote('XAUUSD', { ...quote(), provider_timestamp: epoch });
    expect(getTerminalQuoteFreshness('XAUUSD')).toMatchObject({live:true, ageMinMs:-1, ageMaxMs:1501, clockStatus:'verified'});
    mono += 1600; wall += 1600;
    expect(getTerminalQuoteFreshness('XAUUSD').reason).toBe('time-unverified');
    mono += 1500; wall += 1500;
    expect(getTerminalQuoteFreshness('XAUUSD').reason).toBe('stale');
  });
  it('holds over rejected samples with fresh incoming ticks until the 60 second boundary', () => {
    calibrate();
    mono += 59000; wall += 59000;
    expect(calibrateTerminalQuoteClock(epoch, mono - 2001, wall - 2001, mono, wall)).toBe(false);
    ingestTerminalQuote('XAUUSD', quote());
    expect(getTerminalQuoteFreshness('XAUUSD')).toMatchObject({live:true, ageMaxMs:60});
    mono += 1000; wall += 1000;
    ingestTerminalQuote('XAUUSD', quote(2));
    expect(getTerminalQuoteFreshness('XAUUSD')).toMatchObject({live:false, reason:'time-unverified', ageMaxMs:null});
    calibrate();
    expect(getTerminalQuoteFreshness('XAUUSD').live).toBe(true);
  });
  it('reports upstream stale evidence even while clock verification is absent', () => {
    ingestTerminalQuote('XAUUSD', {...quote(),stale:true});
    expect(getTerminalQuoteFreshness('XAUUSD').reason).toBe('stale');
  });
});
