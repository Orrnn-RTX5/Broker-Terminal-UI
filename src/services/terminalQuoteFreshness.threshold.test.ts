import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertTerminalMarketOrderQuote, assertTerminalQuoteFresh, calibrateTerminalQuoteClock, getTerminalQuoteFreshness, ingestTerminalQuote, resetTerminalQuoteFreshness } from './terminalQuoteFreshness';

// The terminal gate must agree with the 3s gateway order guard: a quote the
// gateway would still execute must not be blocked in the browser as QUOTE_STALE.
const epoch = 1_800_000_000_000;
let mono: number;
let wall: number;

describe('terminal quote age gate matches the 3s gateway guard', () => {
  beforeEach(() => {
    mono = 1000; wall = epoch + mono;
    vi.spyOn(performance, 'now').mockImplementation(() => mono);
    vi.spyOn(Date, 'now').mockImplementation(() => wall);
    resetTerminalQuoteFreshness();
    (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__ = { TERMINAL_QUOTE_FRESHNESS: true };
    calibrateTerminalQuoteClock(epoch + mono, mono, wall, mono, wall);
  });
  afterEach(() => { vi.restoreAllMocks(); delete (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__; });

  const tickAged = (ageMs: number) => {
    ingestTerminalQuote('XAUUSD', { bid: 4314.66, ask: 4314.75, provider_timestamp: epoch + mono, sequence: 1, source: 'cserver' });
    mono += ageMs; wall += ageMs;
  };

  it.each([500, 1500, 2000, 2100, 2500, 2800])('quote aged %ims is live and a market order is allowed', (age) => {
    tickAged(age);
    expect(getTerminalQuoteFreshness('XAUUSD')).toMatchObject({ live: true, reason: 'live' });
    expect(() => assertTerminalMarketOrderQuote('XAUUSD')).not.toThrow();
    expect(() => assertTerminalQuoteFresh('XAUUSD')).not.toThrow();
  });

  it('a quote at the 3s edge defers to the gateway instead of blocking a market order', () => {
    tickAged(2999);
    expect(getTerminalQuoteFreshness('XAUUSD').reason).toBe('time-unverified');
    expect(() => assertTerminalMarketOrderQuote('XAUUSD')).not.toThrow();
  });

  it.each([3100, 3500, 6000])('quote aged %ims is stale and blocked with QUOTE_STALE', (age) => {
    tickAged(age);
    expect(getTerminalQuoteFreshness('XAUUSD')).toMatchObject({ live: false, reason: 'stale' });
    expect(() => assertTerminalMarketOrderQuote('XAUUSD')).toThrow(expect.objectContaining({ code: 'QUOTE_STALE' }));
  });

  it('an explicit upstream stale flag still blocks regardless of age', () => {
    ingestTerminalQuote('XAUUSD', { bid: 4314.66, ask: 4314.75, provider_timestamp: epoch + mono, sequence: 1, source: 'cserver', stale: true });
    expect(getTerminalQuoteFreshness('XAUUSD').reason).toBe('stale');
    expect(() => assertTerminalMarketOrderQuote('XAUUSD')).toThrow(expect.objectContaining({ code: 'QUOTE_STALE' }));
  });
});
