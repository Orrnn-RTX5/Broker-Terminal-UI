/**
 * Unit Tests for buildOHLCFromTicks Function
 * Tests historical tick data to OHLC candle conversion
 *
 * Run with: npm test
 */

import { describe, it, expect } from 'vitest';

type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
type Time = number;

interface OHLC {
  time: Time;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/**
 * Get timeframe duration in seconds
 */
function getTimeframeSeconds(tf: Timeframe): number {
  switch (tf) {
    case '1m': return 60;
    case '5m': return 300;
    case '15m': return 900;
    case '1h': return 3600;
    case '4h': return 14400;
    case '1d': return 86400;
    default: return 60;
  }
}

/**
 * Build OHLC candles from tick data
 * Converts tick data from backend API to OHLC candles for chart display
 *
 * @param ticks - Array of tick data with timestamp (ms), bid, ask
 * @param timeframe - Candle timeframe (1m, 5m, 15m, etc.)
 * @returns Array of OHLC candles sorted by time
 */
function buildOHLCFromTicks(ticks: any[], timeframe: Timeframe): OHLC[] {
  if (!ticks || ticks.length === 0) return [];

  const tfSeconds = getTimeframeSeconds(timeframe);
  const candleMap = new Map<number, OHLC>();

  for (const tick of ticks) {
    const price = (tick.bid + tick.ask) / 2; // Mid price
    const timestamp = Math.floor(tick.timestamp / 1000); // Convert ms to seconds
    const candleTime = (Math.floor(timestamp / tfSeconds) * tfSeconds) as Time;

    if (!candleMap.has(candleTime as number)) {
      // Create new candle
      candleMap.set(candleTime as number, {
        time: candleTime,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: 1,
      });
    } else {
      // Update existing candle
      const candle = candleMap.get(candleTime as number)!;
      candle.high = Math.max(candle.high, price);
      candle.low = Math.min(candle.low, price);
      candle.close = price;
      candle.volume = (candle.volume || 0) + 1;
    }
  }

  return Array.from(candleMap.values()).sort((a, b) => (a.time as number) - (b.time as number));
}

describe('buildOHLCFromTicks - Edge Cases', () => {
  it('should return empty array for empty input', () => {
    const result = buildOHLCFromTicks([], '1m');
    expect(result).toEqual([]);
  });

  it('should return empty array for null input', () => {
    const result = buildOHLCFromTicks(null as any, '1m');
    expect(result).toEqual([]);
  });

  it('should handle single tick', () => {
    const ticks = [
      { timestamp: 1737375600000, bid: 1.04532, ask: 1.04535 }
    ];
    const result = buildOHLCFromTicks(ticks, '1m');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      time: 1737375600,
      open: 1.045335,
      high: 1.045335,
      low: 1.045335,
      close: 1.045335,
      volume: 1
    });
  });
});

describe('buildOHLCFromTicks - M1 Timeframe', () => {
  it('should aggregate ticks within same minute', () => {
    const ticks = [
      { timestamp: 1737375600000, bid: 1.04532, ask: 1.04535 }, // 09:00:00
      { timestamp: 1737375610000, bid: 1.04534, ask: 1.04537 }, // 09:00:10
      { timestamp: 1737375620000, bid: 1.04530, ask: 1.04533 }, // 09:00:20
      { timestamp: 1737375630000, bid: 1.04536, ask: 1.04539 }, // 09:00:30
      { timestamp: 1737375640000, bid: 1.04531, ask: 1.04534 }, // 09:00:40
    ];
    const result = buildOHLCFromTicks(ticks, '1m');

    expect(result).toHaveLength(1);
    expect(result[0].time).toBe(1737375600);
    expect(result[0].volume).toBe(5);
    expect(result[0].open).toBe(1.045335);
    expect(result[0].close).toBe(1.045325);
    expect(result[0].high).toBe(1.045375);
    expect(result[0].low).toBe(1.045315);
  });

  it('should create separate candles for different minutes', () => {
    const ticks = [
      { timestamp: 1737375600000, bid: 1.04532, ask: 1.04535 }, // 09:00:00
      { timestamp: 1737375610000, bid: 1.04534, ask: 1.04537 }, // 09:00:10
      { timestamp: 1737375660000, bid: 1.04538, ask: 1.04541 }, // 09:01:00
      { timestamp: 1737375720000, bid: 1.04536, ask: 1.04539 }, // 09:02:00
    ];
    const result = buildOHLCFromTicks(ticks, '1m');

    expect(result).toHaveLength(3);
    expect(result[0].time).toBe(1737375600); // 09:00
    expect(result[0].volume).toBe(2);
    expect(result[1].time).toBe(1737375660); // 09:01
    expect(result[1].volume).toBe(1);
    expect(result[2].time).toBe(1737375720); // 09:02
    expect(result[2].volume).toBe(1);
  });
});

describe('buildOHLCFromTicks - M5 Timeframe', () => {
  it('should aggregate ticks within 5-minute window', () => {
    const ticks = [
      { timestamp: 1737375600000, bid: 1.04532, ask: 1.04535 }, // 09:00:00
      { timestamp: 1737375660000, bid: 1.04540, ask: 1.04543 }, // 09:01:00
      { timestamp: 1737375720000, bid: 1.04536, ask: 1.04539 }, // 09:02:00
      { timestamp: 1737375780000, bid: 1.04530, ask: 1.04533 }, // 09:03:00
      { timestamp: 1737375840000, bid: 1.04545, ask: 1.04548 }, // 09:04:00
    ];
    const result = buildOHLCFromTicks(ticks, '5m');

    expect(result).toHaveLength(1);
    expect(result[0].time).toBe(1737375600);
    expect(result[0].volume).toBe(5);
    expect(result[0].open).toBe(1.045335);
    expect(result[0].close).toBe(1.045465);
  });

  it('should create new candle at 5-minute boundary', () => {
    const ticks = [
      { timestamp: 1737375600000, bid: 1.04532, ask: 1.04535 }, // 09:00:00
      { timestamp: 1737375840000, bid: 1.04545, ask: 1.04548 }, // 09:04:00
      { timestamp: 1737375900000, bid: 1.04550, ask: 1.04553 }, // 09:05:00
      { timestamp: 1737376200000, bid: 1.04555, ask: 1.04558 }, // 09:10:00
    ];
    const result = buildOHLCFromTicks(ticks, '5m');

    expect(result).toHaveLength(3);
    expect(result[0].time).toBe(1737375600); // 09:00-09:05
    expect(result[0].volume).toBe(2);
    expect(result[1].time).toBe(1737375900); // 09:05-09:10
    expect(result[1].volume).toBe(1);
    expect(result[2].time).toBe(1737376200); // 09:10-09:15
    expect(result[2].volume).toBe(1);
  });
});

describe('buildOHLCFromTicks - M15 Timeframe', () => {
  it('should aggregate ticks within 15-minute window', () => {
    const ticks = [
      { timestamp: 1737375600000, bid: 1.04532, ask: 1.04535 }, // 09:00:00
      { timestamp: 1737376200000, bid: 1.04540, ask: 1.04543 }, // 09:10:00
      { timestamp: 1737376500000, bid: 1.04536, ask: 1.04539 }, // 09:15:00
    ];
    const result = buildOHLCFromTicks(ticks, '15m');

    expect(result).toHaveLength(2);
    expect(result[0].time).toBe(1737375600); // 09:00-09:15
    expect(result[0].volume).toBe(2);
    expect(result[1].time).toBe(1737376500); // 09:15-09:30
    expect(result[1].volume).toBe(1);
  });
});

describe('buildOHLCFromTicks - Time Boundaries', () => {
  it('should handle ticks at exact boundary', () => {
    const ticks = [
      { timestamp: 1737375599000, bid: 1.04532, ask: 1.04535 }, // 08:59:59
      { timestamp: 1737375600000, bid: 1.04534, ask: 1.04537 }, // 09:00:00
      { timestamp: 1737375601000, bid: 1.04536, ask: 1.04539 }, // 09:00:01
    ];
    const result = buildOHLCFromTicks(ticks, '1m');

    expect(result).toHaveLength(2);
    expect(result[0].time).toBe(1737375540); // 08:59:00
    expect(result[0].volume).toBe(1);
    expect(result[1].time).toBe(1737375600); // 09:00:00
    expect(result[1].volume).toBe(2);
  });

  it('should align candles to timeframe boundaries', () => {
    // Test that 09:02:30 is grouped into 09:00 candle for M5
    const ticks = [
      { timestamp: 1737375750000, bid: 1.04532, ask: 1.04535 }, // 09:02:30
    ];
    const result = buildOHLCFromTicks(ticks, '5m');

    expect(result).toHaveLength(1);
    expect(result[0].time).toBe(1737375600); // Should align to 09:00
  });
});

describe('buildOHLCFromTicks - OHLC Calculations', () => {
  it('should calculate high correctly', () => {
    const ticks = [
      { timestamp: 1737375600000, bid: 1.04532, ask: 1.04535 }, // mid: 1.045335
      { timestamp: 1737375610000, bid: 1.04540, ask: 1.04543 }, // mid: 1.045415
      { timestamp: 1737375620000, bid: 1.04530, ask: 1.04533 }, // mid: 1.045315
    ];
    const result = buildOHLCFromTicks(ticks, '1m');

    expect(result[0].high).toBe(1.045415);
  });

  it('should calculate low correctly', () => {
    const ticks = [
      { timestamp: 1737375600000, bid: 1.04532, ask: 1.04535 }, // mid: 1.045335
      { timestamp: 1737375610000, bid: 1.04540, ask: 1.04543 }, // mid: 1.045415
      { timestamp: 1737375620000, bid: 1.04530, ask: 1.04533 }, // mid: 1.045315
    ];
    const result = buildOHLCFromTicks(ticks, '1m');

    expect(result[0].low).toBe(1.045315);
  });

  it('should set open to first tick price', () => {
    const ticks = [
      { timestamp: 1737375600000, bid: 1.04532, ask: 1.04535 },
      { timestamp: 1737375610000, bid: 1.04540, ask: 1.04543 },
    ];
    const result = buildOHLCFromTicks(ticks, '1m');

    expect(result[0].open).toBe(1.045335);
  });

  it('should set close to last tick price', () => {
    const ticks = [
      { timestamp: 1737375600000, bid: 1.04532, ask: 1.04535 },
      { timestamp: 1737375610000, bid: 1.04540, ask: 1.04543 },
    ];
    const result = buildOHLCFromTicks(ticks, '1m');

    expect(result[0].close).toBe(1.045415);
  });

  it('should count volume as tick count', () => {
    const ticks = [
      { timestamp: 1737375600000, bid: 1.04532, ask: 1.04535 },
      { timestamp: 1737375610000, bid: 1.04534, ask: 1.04537 },
      { timestamp: 1737375620000, bid: 1.04536, ask: 1.04539 },
    ];
    const result = buildOHLCFromTicks(ticks, '1m');

    expect(result[0].volume).toBe(3);
  });
});

describe('buildOHLCFromTicks - Sorting', () => {
  it('should maintain chronological order with unsorted input', () => {
    const ticks = [
      { timestamp: 1737375720000, bid: 1.04536, ask: 1.04539 }, // 09:02:00
      { timestamp: 1737375600000, bid: 1.04532, ask: 1.04535 }, // 09:00:00
      { timestamp: 1737375660000, bid: 1.04540, ask: 1.04543 }, // 09:01:00
    ];
    const result = buildOHLCFromTicks(ticks, '1m');

    expect(result).toHaveLength(3);
    expect(result[0].time).toBe(1737375600);
    expect(result[1].time).toBe(1737375660);
    expect(result[2].time).toBe(1737375720);
  });

  it('should sort candles by time ascending', () => {
    const ticks = [
      { timestamp: 1737375900000, bid: 1.04550, ask: 1.04553 },
      { timestamp: 1737375600000, bid: 1.04532, ask: 1.04535 },
      { timestamp: 1737376200000, bid: 1.04555, ask: 1.04558 },
    ];
    const result = buildOHLCFromTicks(ticks, '5m');

    expect(result.length).toBeGreaterThan(1);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].time).toBeGreaterThan(result[i - 1].time);
    }
  });
});

describe('buildOHLCFromTicks - Performance', () => {
  it('should handle large datasets efficiently', () => {
    // Generate 5000 ticks (typical API response size)
    const ticks = [];
    const baseTime = 1737375600000;
    for (let i = 0; i < 5000; i++) {
      ticks.push({
        timestamp: baseTime + (i * 1000), // 1 tick per second
        bid: 1.04532 + (Math.random() * 0.0001),
        ask: 1.04535 + (Math.random() * 0.0001)
      });
    }

    const startTime = performance.now();
    const result = buildOHLCFromTicks(ticks, '1m');
    const duration = performance.now() - startTime;

    expect(result.length).toBeGreaterThan(0);
    expect(duration).toBeLessThan(100); // Should complete in < 100ms
  });
});

describe('buildOHLCFromTicks - Time Conversion', () => {
  it('should convert milliseconds to seconds correctly', () => {
    const ticks = [
      { timestamp: 1737375600000, bid: 1.04532, ask: 1.04535 }
    ];
    const result = buildOHLCFromTicks(ticks, '1m');

    // 1737375600000 ms / 1000 = 1737375600 seconds
    expect(result[0].time).toBe(1737375600);
  });

  it('should calculate time bucket correctly for M1', () => {
    const ticks = [
      { timestamp: 1737375612000, bid: 1.04532, ask: 1.04535 } // 09:00:12
    ];
    const result = buildOHLCFromTicks(ticks, '1m');

    // timestamp = 1737375612
    // Math.floor(1737375612 / 60) * 60 = 1737375600
    expect(result[0].time).toBe(1737375600);
  });

  it('should calculate time bucket correctly for M5', () => {
    const ticks = [
      { timestamp: 1737375812000, bid: 1.04532, ask: 1.04535 } // 09:03:32
    ];
    const result = buildOHLCFromTicks(ticks, '5m');

    // timestamp = 1737375812
    // Math.floor(1737375812 / 300) * 300 = 1737375600
    expect(result[0].time).toBe(1737375600);
  });
});
