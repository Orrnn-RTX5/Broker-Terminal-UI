import { describe, expect, it } from 'vitest';

import {
  formatMarketSessionTimestamp,
  getMarketStatusTradeBlockMessage,
  isLikelyAlwaysOpenCryptoSymbol,
  normalizeMarketStatus,
} from './marketStatus';

describe('marketStatus helpers', () => {
  it.each([
    ['open', 'Market Open', true],
    ['closed', 'Market Closed', false],
    ['pre_market', 'Pre-market', false],
    ['after_hours', 'After hours', false],
  ] as const)('normalizes %s status', (status, label, isOpen) => {
    const normalized = normalizeMarketStatus({ symbol: 'eurusd', status }, { symbol: 'fallback' });

    expect(normalized.symbol).toBe('EURUSD');
    expect(normalized.status).toBe(status);
    expect(normalized.label).toBe(label);
    expect(normalized.isOpen).toBe(isOpen);
    expect(normalized.isTradeBlocked).toBe(!isOpen);
  });

  it('blocks trading when the backend status is missing for non-crypto symbols', () => {
    const normalized = normalizeMarketStatus(null, { symbol: 'XAUUSD' });

    expect(normalized.status).toBe('unknown');
    expect(normalized.label).toBe('Status unavailable');
    expect(normalized.isTradeBlocked).toBe(true);
    expect(getMarketStatusTradeBlockMessage(normalized)).toBe(
      'Market status unavailable for XAUUSD. Trading is blocked until status refreshes.',
    );
  });

  it('treats known crypto symbols as always open when backend status is unavailable', () => {
    const normalized = normalizeMarketStatus(null, { symbol: 'BTCUSD' });

    expect(isLikelyAlwaysOpenCryptoSymbol('BTCUSD')).toBe(true);
    expect(isLikelyAlwaysOpenCryptoSymbol('ETHUSD.r')).toBe(true);
    expect(isLikelyAlwaysOpenCryptoSymbol('USDCNH')).toBe(false);
    expect(normalized.status).toBe('open');
    expect(normalized.label).toBe('Market Open');
    expect(normalized.isOpen).toBe(true);
    expect(normalized.isTradeBlocked).toBe(false);
  });

  it('keeps explicit backend closed status authoritative for crypto symbols', () => {
    const normalized = normalizeMarketStatus({ symbol: 'BTCUSD', status: 'closed' });

    expect(normalized.status).toBe('closed');
    expect(normalized.isTradeBlocked).toBe(true);
  });

  it('blocks trading when the backend reports an unknown status for crypto symbols', () => {
    const normalized = normalizeMarketStatus({
      symbol: 'BTCUSD',
      status: 'halted' as never,
    });

    expect(normalized.status).toBe('unknown');
    expect(normalized.isTradeBlocked).toBe(true);
  });

  it('formats second and millisecond session timestamps consistently', () => {
    expect(formatMarketSessionTimestamp(1_788_176_700, {
      locale: 'en-US',
      timeZone: 'UTC',
    })).toBe('Aug 31, 11:45');
    expect(formatMarketSessionTimestamp(1_788_176_700_000, {
      locale: 'en-US',
      timeZone: 'UTC',
    })).toBe('Aug 31, 11:45');
  });

  it('builds open and closed schedule labels', () => {
    const open = normalizeMarketStatus({
      symbol: 'EURUSD',
      status: 'open',
      session_close: 1_788_176_700,
    }, { locale: 'en-US', timeZone: 'UTC' });
    const closed = normalizeMarketStatus({
      symbol: 'EURUSD',
      status: 'closed',
      session_open: 1_788_176_700,
    }, { locale: 'en-US', timeZone: 'UTC' });

    expect(open.scheduleText).toBe('Closes Aug 31, 11:45');
    expect(open.sessionCloseTimeMs).toBe(1_788_176_700_000);
    expect(closed.scheduleText).toBe('Opens Aug 31, 11:45');
    expect(closed.sessionOpenTimeMs).toBe(1_788_176_700_000);
  });
});
