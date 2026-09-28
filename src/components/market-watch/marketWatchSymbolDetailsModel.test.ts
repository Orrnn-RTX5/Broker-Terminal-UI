import { describe, expect, it } from 'vitest';
import type { Tick } from '../../store/useAppStore';
import {
  buildMarketWatchSymbolDetails,
  formatMarketWatchDetailsNumber,
  formatMarketWatchDetailsPercent,
  formatMarketWatchDetailsPrice,
  readMarketWatchSymbolSpecification,
} from './marketWatchSymbolDetailsModel';

const NO_SPECIFICATION = { tickSize: null, tickValue: null, digits: null };

const tick = (overrides: Partial<Tick> & Record<string, unknown> = {}): Tick => ({
  symbol: 'XAUUSD',
  bid: 4150.16,
  ask: 4150.46,
  spread: 0.3,
  timestamp: 1_000,
  ...overrides,
} as Tick);

describe('readMarketWatchSymbolSpecification', () => {
  it('prefers nested broker snapshots and earlier sources', () => {
    expect(readMarketWatchSymbolSpecification(
      { symbol: 'XAUUSD', tick_value: 0.5, brokerSpecification: { trade_tick_value: 0.1, digits: 2 } },
      { symbol: 'XAUUSD', tick_size: 0.01, tick_value: 9 },
    )).toEqual({ tickSize: 0.01, tickValue: 0.1, digits: 2 });
  });

  it('uses a true tick size from any source before a point size', () => {
    expect(readMarketWatchSymbolSpecification(
      { point: 0.01 },
      { tickSize: 0.25 },
    ).tickSize).toBe(0.25);
    expect(readMarketWatchSymbolSpecification({ point: '0.00001' }).tickSize).toBe(0.00001);
  });

  it('ignores zero, negative and malformed terms', () => {
    expect(readMarketWatchSymbolSpecification(
      { tick_size: 0, tick_value: -1, digits: 2.5 },
      null,
      'XAUUSD',
    )).toEqual(NO_SPECIFICATION);
  });
});

describe('buildMarketWatchSymbolDetails', () => {
  it('maps the live tick onto the MT5 Details fields', () => {
    const details = buildMarketWatchSymbolDetails({
      tick: tick({
        bidHigh: 4277.01,
        bidLow: 4140.53,
        askHigh: 4283.46,
        askLow: 4140.87,
        open: 4274.42,
        close: 4272.74,
        dailyChange: -2.87,
      }),
      displayDailyChange: -2.87,
      specification: { tickSize: 0.01, tickValue: 0.1, digits: 2 },
    });

    expect(details).toMatchObject({
      digits: 2,
      tickSize: 0.01,
      tickValue: 0.1,
      bid: 4150.16,
      bidHigh: 4277.01,
      bidLow: 4140.53,
      ask: 4150.46,
      askHigh: 4283.46,
      askLow: 4140.87,
      dailyChange: -2.87,
      open: 4274.42,
      close: 4272.74,
      fallbackQuoteAsOf: null,
    });
  });

  it('moves raw session ranges by the same account markup as Bid and Ask', () => {
    const details = buildMarketWatchSymbolDetails({
      tick: tick({
        bid: 4150.06,
        ask: 4150.56,
        rawBid: 4150.16,
        rawAsk: 4150.46,
        bidHigh: 4277.01,
        bidLow: 4140.53,
        askHigh: 4283.46,
        askLow: 4140.87,
      }),
      specification: NO_SPECIFICATION,
    });

    expect(details.bidHigh).toBeCloseTo(4276.91, 8);
    expect(details.bidLow).toBeCloseTo(4140.43, 8);
    expect(details.askHigh).toBeCloseTo(4283.56, 8);
    expect(details.askLow).toBeCloseTo(4140.97, 8);
  });

  it('extends a lagging session range to the live quote', () => {
    const details = buildMarketWatchSymbolDetails({
      tick: tick({ bid: 4300, ask: 4300.3, bidHigh: 4277.01, bidLow: 4140.53, askLow: 4400 }),
      specification: NO_SPECIFICATION,
    });

    expect(details.bidHigh).toBe(4300);
    expect(details.bidLow).toBe(4140.53);
    expect(details.askLow).toBe(4300.3);
    expect(details.askHigh).toBeNull();
  });

  it('takes price digits only from the symbol specification', () => {
    expect(buildMarketWatchSymbolDetails({
      tick: tick({ digits: 3 }),
      specification: NO_SPECIFICATION,
    }).digits).toBeNull();
    expect(buildMarketWatchSymbolDetails({
      tick: tick({ digits: 3 }),
      specification: { ...NO_SPECIFICATION, digits: 2 },
    }).digits).toBe(2);
  });

  it('uses the Bid-based feed High/Low only for the Bid range', () => {
    const details = buildMarketWatchSymbolDetails({
      tick: tick({ high: 4200, low: 4100, high24h: 4999, low24h: 1 }),
      specification: NO_SPECIFICATION,
    });

    expect(details).toMatchObject({ bidHigh: 4200, bidLow: 4100, askHigh: null, askLow: null });
  });

  it('shows a historical quote and closed-market change when no live quote exists', () => {
    const details = buildMarketWatchSymbolDetails({
      tick: undefined,
      lastPrice: { kind: 'quote', bid: 1.1, ask: 1.1002, asOf: 5_000 },
      closedDailyChange: 0.42,
      specification: { tickSize: 0.00001, tickValue: 1, digits: 5 },
    });

    expect(details).toMatchObject({
      digits: 5,
      bid: 1.1,
      ask: 1.1002,
      bidHigh: null,
      open: null,
      dailyChange: 0.42,
      fallbackQuoteAsOf: 5_000,
    });
  });

  it('never presents a broker zero previous close or a last-close fallback as a quote', () => {
    const details = buildMarketWatchSymbolDetails({
      tick: undefined,
      lastPrice: { kind: 'close', close: 1.09, asOf: 5_000 },
      specification: NO_SPECIFICATION,
    });

    expect(details).toMatchObject({ bid: null, ask: null, close: null, fallbackQuoteAsOf: null });
  });
});

describe('Market Watch Details formatting', () => {
  it('formats prices by broker digits and contract terms at broker precision', () => {
    expect(formatMarketWatchDetailsPrice(4150.1, 2)).toBe('4150.10');
    expect(formatMarketWatchDetailsPrice(1.1, 5)).toBe('1.10000');
    expect(formatMarketWatchDetailsPrice(null, 2)).toBeNull();
    // Without broker digits the backend value is shown as sent, never guessed.
    expect(formatMarketWatchDetailsPrice(1.1, null)).toBe('1.1');
    expect(formatMarketWatchDetailsPrice(4276.910000000001, null)).toBe('4276.91');
    expect(formatMarketWatchDetailsNumber(0.00001)).toBe('0.00001');
    expect(formatMarketWatchDetailsNumber(0.1)).toBe('0.1');
    expect(formatMarketWatchDetailsNumber(1234.5)).toBe('1234.5');
    expect(formatMarketWatchDetailsPercent(-2.871)).toBe('-2.87%');
  });
});
