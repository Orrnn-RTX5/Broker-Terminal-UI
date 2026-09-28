import { describe, expect, it } from 'vitest';
import {
  normalizeRealtimeTick,
  parseTickPayloadContexts,
  parseTickPayloads,
  toNumber,
} from './marketTickNormalization';

describe('market tick normalization', () => {
  it('reads calc money objects and formatted numeric strings', () => {
    expect(toNumber({ amount: '99,997.09', currency: 'USD' })).toBe(99_997.09);
    expect(toNumber('1,234.5')).toBe(1234.5);
  });

  it('keeps the exact broker symbol and repairs inverted quotes', () => {
    const tick = normalizeRealtimeTick({ symbol: 'eurusd.r', bid: 1.2, ask: 1.1, timestamp: 2_000_000_000 });
    expect(tick).toMatchObject({ symbol: 'EURUSD.R', bid: 1.1, ask: 1.2 });
    expect(tick?.timestamp).toBe(2_000_000_000_000);
    expect(tick?.last).toBeUndefined();
  });

  it('normalizes an explicit Last-mode tick without inventing a spread', () => {
    const tick = normalizeRealtimeTick({
      symbol: 'future.last-only',
      last_price: 120,
      chart_mode: 'SYMBOL_CHART_MODE_LAST',
      settlement_price: 80,
      previous_close: 100,
      timestamp: 2_000_000_000,
    });

    expect(tick).toMatchObject({
      symbol: 'FUTURE.LAST-ONLY',
      bid: 0,
      ask: 0,
      spread: 0,
      last: 120,
      dailyChange: 50,
    });
  });

  it('rejects Last-only data when chart mode is omitted instead of guessing metadata', () => {
    expect(normalizeRealtimeTick({
      symbol: 'ambiguous.last-only',
      last: 120,
      previous_close: 100,
      timestamp: 2_000_000_000,
    })).toBeNull();
  });

  it('uses envelope chart mode only when the nearest tick payload omits it', () => {
    expect(normalizeRealtimeTick({
      symbol: 'wrapped.last-only',
      last: 120,
      previous_close: 100,
      timestamp: 2_000_000_000,
    }, undefined, {
      chart_mode: 1,
    })).toMatchObject({
      symbol: 'WRAPPED.LAST-ONLY',
      bid: 0,
      ask: 0,
      dailyChange: 20,
    });

    expect(normalizeRealtimeTick({
      symbol: 'child.bid',
      last: 120,
      chart_mode: 0,
      previous_close: 100,
      timestamp: 2_000_000_000,
    }, undefined, {
      chart_mode: 1,
    })).toBeNull();
  });

  it('composes envelope Daily Change fields without overriding explicit child groups', () => {
    expect(normalizeRealtimeTick({
      symbol: 'outer.percent',
      bid: 110,
      ask: 111,
    }, undefined, {
      daily_change_pct: 0.75,
      previous_close: 100,
    })).toMatchObject({ dailyChange: 0.75 });

    expect(normalizeRealtimeTick({
      symbol: 'child.percent',
      bid: 110,
      ask: 111,
      dailyChangePct: 0.25,
    }, undefined, {
      daily_change_pct: 0.75,
      previous_close: 100,
    })).toMatchObject({ dailyChange: 0.25 });

    expect(normalizeRealtimeTick({
      symbol: 'outer.baseline',
      bid: 110,
      ask: 111,
    }, undefined, {
      chart_mode: 1,
      last: 120,
      settlement_price: 80,
      previous_close: 100,
    })).toMatchObject({ last: 120, dailyChange: 50 });

    expect(normalizeRealtimeTick({
      symbol: 'child.blocks.close',
      bid: 110,
      ask: 111,
      previousClose: 'unknown',
    }, undefined, {
      previous_close: 100,
    })?.dailyChange).toBeUndefined();
  });

  it('flattens supported nested tick envelopes without inventing rows', () => {
    expect(parseTickPayloads({ data: { ticks: [{ symbol: 'BTCUSD', bid: 1, ask: 2 }] } })).toHaveLength(1);
    expect(parseTickPayloads('{"message":{"symbol":"ETHUSD","bid":1,"ask":2}}')[0].symbol).toBe('ETHUSD');
    expect(parseTickPayloads('invalid')).toEqual([]);
  });

  it('inherits an exact channel symbol and nearest metadata across nested array leaves', () => {
    const frame = {
      channel: 'ticks.EURUSD.r',
      daily_change_pct: 0.9,
      timestamp: 1_725_000_000,
      data: {
        bid: 90,
        ask: 91,
        daily_change_pct: 0.75,
        timestamp: 1_725_000_001,
        quote: [
          { bid: 110, ask: 111, previous_close: 100 },
          { bid: 112, ask: 113, previous_close: 100, timestamp: 1_725_000_002 },
        ],
      },
    };
    const contexts = parseTickPayloadContexts(frame.data);
    const ticks = contexts.map(({ payload, envelopes }) => normalizeRealtimeTick(
      { ...payload, symbol: frame.channel.slice('ticks.'.length) },
      undefined,
      envelopes[0],
      [...envelopes.slice(1), frame],
    ));

    expect(ticks).toHaveLength(2);
    expect(ticks[0]).toMatchObject({
      symbol: 'EURUSD.R',
      bid: 110,
      dailyChange: 0.75,
      sourceTimestamp: 1_725_000_001_000,
    });
    expect(ticks[1]).toMatchObject({
      symbol: 'EURUSD.R',
      bid: 112,
      dailyChange: 0.75,
      sourceTimestamp: 1_725_000_002_000,
    });
  });

  it('uses envelope broker time while a nearer invalid percentage blocks the outer value', () => {
    const tick = normalizeRealtimeTick({
      symbol: 'nested.block',
      bid: 110,
      ask: 111,
      previous_close: 100,
    }, undefined, {
      dailyChangePct: 'unknown',
      event_time: '2026-09-04T08:11:40.123Z',
    }, [{
      daily_change_pct: 0.75,
      timestamp: 1_725_000_000,
    }]);

    expect(tick?.dailyChange).toBeCloseTo(10, 10);
    expect(tick?.sourceTimestamp).toBe(Date.parse('2026-09-04T08:11:40.123Z'));
  });

  it('does not carry Daily Change across sparse ticks inside the adapter', () => {
    const previous = normalizeRealtimeTick({
      symbol: 'EURUSD',
      bid: 1.1,
      ask: 1.1002,
      daily_change_pct: 0.75,
    });

    expect(normalizeRealtimeTick({
      symbol: 'EURUSD',
      bid: 1.101,
      ask: 1.1012,
    }, previous ?? undefined)?.dailyChange).toBeUndefined();
  });
});
