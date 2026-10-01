import { describe, expect, it } from 'vitest';

import {
  formatMarketSessionTimestamp,
  getMarketStatusTradeBlockMessage,
  isLikelyAlwaysOpenCryptoSymbol,
  normalizeMarketStatus,
  shouldBlockSymbolTrading,
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

  it('blocks crypto trading until the configured session status is available', () => {
    const normalized = normalizeMarketStatus(null, { symbol: 'BTCUSD' });

    expect(isLikelyAlwaysOpenCryptoSymbol('BTCUSD')).toBe(true);
    expect(isLikelyAlwaysOpenCryptoSymbol('ETHUSD.r')).toBe(true);
    expect(isLikelyAlwaysOpenCryptoSymbol('USDCNH')).toBe(false);
    expect(normalized.status).toBe('unknown');
    expect(normalized.label).toBe('Status unavailable');
    expect(normalized.isOpen).toBe(false);
    expect(normalized.isTradeBlocked).toBe(true);
  });

  it('keeps explicit backend closed status authoritative for crypto symbols', () => {
    const normalized = normalizeMarketStatus({ symbol: 'BTCUSD', status: 'closed' });

    expect(normalized.status).toBe('closed');
    expect(normalized.isTradeBlocked).toBe(true);
    expect(shouldBlockSymbolTrading(normalized, 'BTCUSD')).toBe(true);
  });

  it('blocks trading when the backend reports an unknown status for crypto symbols', () => {
    const normalized = normalizeMarketStatus({
      symbol: 'BTCUSD',
      status: 'halted' as never,
    });

    expect(normalized.status).toBe('unknown');
    expect(normalized.isTradeBlocked).toBe(true);
  });

  it('derives status from backend trade flags when status field is absent', () => {
    const open = normalizeMarketStatus({ symbol: 'EURUSD', message: 'open', trade_open: true });
    const closed = normalizeMarketStatus({
      symbol: 'EURUSD',
      message: 'closed (weekend)',
      trade_open: false,
    });

    expect(open.status).toBe('open');
    expect(open.isOpen).toBe(true);
    expect(open.isTradeBlocked).toBe(false);
    expect(closed.status).toBe('closed');
    expect(closed.label).toBe('Market Closed');
    expect(closed.isTradeBlocked).toBe(true);
    expect(getMarketStatusTradeBlockMessage(closed)).toBe('Market is closed for EURUSD.');
  });

  it('falls back to quote_open when trade_open is missing', () => {
    const normalized = normalizeMarketStatus({ symbol: 'XAUUSD', quote_open: false });

    expect(normalized.status).toBe('closed');
    expect(normalized.isTradeBlocked).toBe(true);
  });

  it('accepts numeric 0/1 trade flags from the backend payload', () => {
    const open = normalizeMarketStatus({ symbol: 'GBPJPY', message: 'open', trade_open: 1 });
    const closed = normalizeMarketStatus({ symbol: 'GBPJPY', message: 'closed (weekend)', trade_open: 0 });

    expect(open.status).toBe('open');
    expect(open.isTradeBlocked).toBe(false);
    expect(closed.status).toBe('closed');
    expect(closed.isTradeBlocked).toBe(true);
  });

  it.each([
    [{ symbol: 'EURUSD', trade_open: '0' as never }, 'unknown', true],
    [{ symbol: 'EURUSD', trade_open: '1' as never }, 'unknown', true],
    [{ symbol: 'EURUSD', trade_open: 2 }, 'unknown', true],
    [{ symbol: 'EURUSD', trade_open: -1 }, 'unknown', true],
    [{ symbol: 'EURUSD', trade_open: Number.NaN }, 'unknown', true],
    [{ status: 'open', trade_open: false }, 'open', false],
    [{ status: 'pre_market', trade_open: true }, 'pre_market', true],
    [{ symbol: 'BTCUSD', trade_open: false }, 'closed', true],
  ] as const)('resolves %j to %s', (payload, expectedStatus, expectedBlocked) => {
    const normalized = normalizeMarketStatus(payload);

    expect(normalized.status).toBe(expectedStatus);
    expect(normalized.isTradeBlocked).toBe(expectedBlocked);
  });

  it('keeps an explicit backend status field authoritative over trade flags', () => {
    const normalized = normalizeMarketStatus({ status: 'closed', trade_open: true });

    expect(normalized.status).toBe('closed');
    expect(normalized.isTradeBlocked).toBe(true);
  });

  it('reports unknown when the payload has neither status nor trade flags', () => {
    const normalized = normalizeMarketStatus({}, { symbol: 'USDCNH' });

    expect(normalized.status).toBe('unknown');
    expect(normalized.label).toBe('Status unavailable');
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

  it('preserves the server clock as a normalized millisecond timestamp', () => {
    expect(normalizeMarketStatus({ server_time: 1_788_176_700 }).serverTimeMs)
      .toBe(1_788_176_700_000);
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
