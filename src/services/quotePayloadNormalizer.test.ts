import { describe, expect, it, vi } from 'vitest';
import { processIncomingQuotePayload } from './quotePayloadNormalizer';

vi.mock('./dailyChangePriceModeRegistry', () => ({
  resolveDailyChangePriceMode: () => undefined,
}));

describe('processIncomingQuotePayload routing and timestamps', () => {
  it('retains explicit hub trading metadata without inventing it for legacy quotes', () => {
    const [quote] = processIncomingQuotePayload({ symbol: 'EURJPY', bid: 178, ask: 179,
      timestamp_ms: Date.now(), tradable: true, stale: false, authority: 'rtx5_hub', broker_id: 'Orrnn', source_mismatch: false });
    expect(quote.tradingStatus).toMatchObject({ tradable: true, stale: false, authority: 'rtx5_hub', brokerId: 'orrnn', sourceMismatch: false });
    expect(processIncomingQuotePayload({ symbol: 'EURJPY', bid: 178, ask: 179 })[0].tradingStatus).toBeUndefined();
  });
  it('treats the subscribed channel as authoritative over an unsuffixed payload symbol', () => {
    const ticks = processIncomingQuotePayload({
      channel: 'ticks.EURUSD.r',
      data: {
        symbol: 'EURUSD',
        bid: 1.125,
        ask: 1.1252,
        timestamp_ms: 1_788_176_700_123,
      },
    });

    expect(ticks).toHaveLength(1);
    expect(ticks[0]).toMatchObject({
      symbol: 'EURUSD.R',
      bid: 1.125,
      ask: 1.1252,
    });
  });

  it('normalizes timestamp_ms and time_msc source-time aliases', () => {
    const ticks = processIncomingQuotePayload([
      { symbol: 'eurusd', bid: 1.1, ask: 1.2, timestamp_ms: 1_788_176_700_123 },
      { symbol: 'gbpusd', bid: 1.3, ask: 1.4, time_msc: 1_788_176_701_456 },
    ]);

    expect(ticks).toMatchObject([
      {
        symbol: 'EURUSD',
        timestamp: 1_788_176_700_123,
        sourceTimestamp: 1_788_176_700_123,
      },
      {
        symbol: 'GBPUSD',
        timestamp: 1_788_176_701_456,
        sourceTimestamp: 1_788_176_701_456,
      },
    ]);
  });

  it('normalizes canonical event/server timestamps across supported units', () => {
    const ticks = processIncomingQuotePayload([
      { symbol: 'eurusd', bid: 1.1, ask: 1.2, event_timestamp: 1_788_176_702 },
      { symbol: 'gbpusd', bid: 1.3, ask: 1.4, timestamp_us: '1788176702123456' },
      { symbol: 'xauusd', bid: 4_400, ask: 4_400.2, timestamp_ns: '1788176703123456000' },
      { symbol: 'btcusd', bid: 65_000, ask: 65_001, server_time: '2026-09-04T08:11:44.123Z' },
    ]);

    expect(ticks.map((tick) => tick.sourceTimestamp)).toEqual([
      1_788_176_702_000,
      1_788_176_702_123,
      1_788_176_703_123,
      Date.parse('2026-09-04T08:11:44.123Z'),
    ]);
  });
});
