import { describe, expect, it } from 'vitest';

import {
  applyTradeLevelDragUpdate,
  clampTradeLevelToCurrentPrice,
  createTradeLevelOverrideFingerprint,
  normalizeTradeLevelDragPrice,
  resolveTradeLevelDragRole,
  selectNearestTradeLevel,
} from './tradeLevelDrag';

describe('tradeLevelDrag', () => {
  it('creates TP above a BUY entry and SL below a BUY entry', () => {
    expect(resolveTradeLevelDragRole('BUY', 'ENTRY', 1.10000, 1.10100)).toBe('TP');
    expect(resolveTradeLevelDragRole('BUY', 'ENTRY', 1.10000, 1.09900)).toBe('SL');
  });

  it('creates TP below a SELL entry and SL above a SELL entry', () => {
    expect(resolveTradeLevelDragRole('SELL', 'ENTRY', 1.10000, 1.09900)).toBe('TP');
    expect(resolveTradeLevelDragRole('SELL', 'ENTRY', 1.10000, 1.10100)).toBe('SL');
  });

  it('preserves existing TP when moving SL', () => {
    const update = applyTradeLevelDragUpdate({
      side: 'BUY',
      grabbedType: 'SL',
      entryPrice: 1.10000,
      finalPrice: 1.09876,
      currentSl: 1.09900,
      currentTp: 1.10500,
      digits: 5,
    });

    expect(update).toEqual({
      role: 'SL',
      price: 1.09876,
      sl: 1.09876,
      tp: 1.10500,
    });
  });

  it('preserves existing SL when moving TP', () => {
    const update = applyTradeLevelDragUpdate({
      side: 'SELL',
      grabbedType: 'TP',
      entryPrice: 1.10000,
      finalPrice: 1.09654,
      currentSl: 1.10200,
      currentTp: 1.09800,
      digits: 5,
    });

    expect(update).toEqual({
      role: 'TP',
      price: 1.09654,
      sl: 1.10200,
      tp: 1.09654,
    });
  });

  it('lets repeated entry drags update one side without clearing the other side', () => {
    const tpUpdate = applyTradeLevelDragUpdate({
      side: 'BUY',
      grabbedType: 'ENTRY',
      entryPrice: 1.10000,
      finalPrice: 1.10600,
      currentSl: 1.09800,
      currentTp: 0,
      digits: 5,
    });

    expect(tpUpdate).toEqual({
      role: 'TP',
      price: 1.10600,
      sl: 1.09800,
      tp: 1.10600,
    });

    const slUpdate = applyTradeLevelDragUpdate({
      side: 'BUY',
      grabbedType: 'ENTRY',
      entryPrice: 1.10000,
      finalPrice: 1.09750,
      currentSl: 1.09800,
      currentTp: 1.10600,
      digits: 5,
    });

    expect(slUpdate).toEqual({
      role: 'SL',
      price: 1.09750,
      sl: 1.09750,
      tp: 1.10600,
    });

    const sellTpUpdate = applyTradeLevelDragUpdate({
      side: 'SELL',
      grabbedType: 'ENTRY',
      entryPrice: 1.10000,
      finalPrice: 1.09750,
      currentSl: 1.10300,
      currentTp: 0,
      digits: 5,
    });

    expect(sellTpUpdate).toEqual({
      role: 'TP',
      price: 1.09750,
      sl: 1.10300,
      tp: 1.09750,
    });
  });

  it('lets repeated entry drags replace an existing SL or TP value', () => {
    expect(applyTradeLevelDragUpdate({
      side: 'BUY',
      grabbedType: 'ENTRY',
      entryPrice: 1.10000,
      finalPrice: 1.10750,
      currentSl: 1.09800,
      currentTp: 1.10600,
      digits: 5,
    })).toEqual({
      role: 'TP',
      price: 1.10750,
      sl: 1.09800,
      tp: 1.10750,
    });

    expect(applyTradeLevelDragUpdate({
      side: 'SELL',
      grabbedType: 'ENTRY',
      entryPrice: 1.10000,
      finalPrice: 1.10450,
      currentSl: 1.10300,
      currentTp: 1.09750,
      digits: 5,
    })).toEqual({
      role: 'SL',
      price: 1.10450,
      sl: 1.10450,
      tp: 1.09750,
    });
  });

  it('ignores tiny drags inside the entry dead zone', () => {
    expect(applyTradeLevelDragUpdate({
      side: 'BUY',
      grabbedType: 'ENTRY',
      entryPrice: 1.10000,
      finalPrice: 1.10002,
      currentSl: 1.09800,
      currentTp: 1.10600,
      digits: 5,
    })).toBeNull();
  });

  it('allows the chart to create an SL or TP from any real entry-line drag', () => {
    expect(applyTradeLevelDragUpdate({
      side: 'BUY',
      grabbedType: 'ENTRY',
      entryPrice: 1.10000,
      finalPrice: 1.10002,
      currentSl: 0,
      currentTp: 0,
      digits: 5,
      minEntryDistance: 0,
    })).toEqual({
      role: 'TP',
      price: 1.10002,
      sl: 0,
      tp: 1.10002,
    });

    expect(applyTradeLevelDragUpdate({
      side: 'SELL',
      grabbedType: 'ENTRY',
      entryPrice: 1.10000,
      finalPrice: 1.09998,
      currentSl: 0,
      currentTp: 0,
      digits: 5,
      minEntryDistance: 0,
    })).toEqual({
      role: 'TP',
      price: 1.09998,
      sl: 0,
      tp: 1.09998,
    });
  });

  it('snaps tiny chart entry drags to the symbol minimum distance', () => {
    expect(applyTradeLevelDragUpdate({
      side: 'BUY',
      grabbedType: 'ENTRY',
      entryPrice: 1.10000,
      finalPrice: 1.10002,
      currentSl: 0,
      currentTp: 0,
      digits: 5,
      snapEntryToMinDistance: true,
      entryDragDirection: 1,
    })).toEqual({
      role: 'TP',
      price: 1.10005,
      sl: 0,
      tp: 1.10005,
    });

    expect(applyTradeLevelDragUpdate({
      side: 'SELL',
      grabbedType: 'ENTRY',
      entryPrice: 1.10000,
      finalPrice: 1.09998,
      currentSl: 0,
      currentTp: 0,
      digits: 5,
      snapEntryToMinDistance: true,
      entryDragDirection: -1,
    })).toEqual({
      role: 'TP',
      price: 1.09995,
      sl: 0,
      tp: 1.09995,
    });
  });

  it('uses pointer direction when chart price rounding lands back on entry', () => {
    expect(applyTradeLevelDragUpdate({
      side: 'BUY',
      grabbedType: 'ENTRY',
      entryPrice: 1.10000,
      finalPrice: 1.10000,
      currentSl: 0,
      currentTp: 0,
      digits: 5,
      snapEntryToMinDistance: true,
      entryDragDirection: -1,
    })).toEqual({
      role: 'SL',
      price: 1.09995,
      sl: 1.09995,
      tp: 0,
    });
  });

  it('nudges entry-line drags by one tick when rounding lands back on entry', () => {
    expect(applyTradeLevelDragUpdate({
      side: 'BUY',
      grabbedType: 'ENTRY',
      entryPrice: 1.10000,
      finalPrice: 1.100004,
      digits: 5,
      minEntryDistance: 0,
    })).toEqual({
      role: 'TP',
      price: 1.10001,
      sl: 0,
      tp: 1.10001,
    });
  });

  it('allows existing SL and TP lines to be repositioned close to entry', () => {
    expect(applyTradeLevelDragUpdate({
      side: 'BUY',
      grabbedType: 'SL',
      entryPrice: 1.10000,
      finalPrice: 1.09998,
      currentSl: 1.09900,
      currentTp: 1.10600,
      digits: 5,
    })).toEqual({
      role: 'SL',
      price: 1.09998,
      sl: 1.09998,
      tp: 1.10600,
    });

    expect(applyTradeLevelDragUpdate({
      side: 'SELL',
      grabbedType: 'TP',
      entryPrice: 1.10000,
      finalPrice: 1.09997,
      currentSl: 1.10300,
      currentTp: 1.09800,
      digits: 5,
    })).toEqual({
      role: 'TP',
      price: 1.09997,
      sl: 1.10300,
      tp: 1.09997,
    });
  });

  it('ignores non-finite drag prices', () => {
    expect(applyTradeLevelDragUpdate({
      side: 'BUY',
      grabbedType: 'ENTRY',
      entryPrice: 1.10000,
      finalPrice: Number.NaN,
      currentSl: 1.09800,
      currentTp: 1.10600,
      digits: 5,
    })).toBeNull();

    expect(applyTradeLevelDragUpdate({
      side: 'SELL',
      grabbedType: 'TP',
      entryPrice: Number.POSITIVE_INFINITY,
      finalPrice: 1.09900,
      currentSl: 1.10300,
      currentTp: 1.09800,
      digits: 5,
    })).toBeNull();
  });

  it('ignores non-positive resulting prices and does not preserve invalid existing levels', () => {
    expect(applyTradeLevelDragUpdate({
      side: 'BUY',
      grabbedType: 'SL',
      entryPrice: 1.10000,
      finalPrice: -1,
      currentSl: 1.09800,
      currentTp: 1.10600,
      digits: 5,
    })).toBeNull();

    expect(applyTradeLevelDragUpdate({
      side: 'BUY',
      grabbedType: 'TP',
      entryPrice: 1.10000,
      finalPrice: 1.10600,
      currentSl: -1,
      currentTp: 1.10500,
      digits: 5,
    })).toEqual({
      role: 'TP',
      price: 1.10600,
      sl: 0,
      tp: 1.10600,
    });
  });

  it('normalizes price to symbol digits', () => {
    expect(normalizeTradeLevelDragPrice(1.23456789, 5)).toBe(1.23457);
    expect(normalizeTradeLevelDragPrice(1925.678, 2)).toBe(1925.68);
    expect(normalizeTradeLevelDragPrice(Number.NaN, 5)).toBeNaN();
  });

  it('creates a stable override fingerprint when backend position id aliases change', () => {
    const first = createTradeLevelOverrideFingerprint({
      symbol: 'gbpusd',
      side: 'BUY',
      volume: 0.01,
      entryPrice: 1.23456789,
      entryTime: 1_718_000_123.9,
      digits: 5,
    });
    const second = createTradeLevelOverrideFingerprint({
      symbol: 'GBPUSD',
      side: 'BUY',
      volume: 0.01,
      entryPrice: 1.23457,
      entryTime: 1_718_000_123,
      digits: 5,
    });

    expect(first).toBe(second);
  });

  it('keeps override fingerprints distinct for different trades on the same symbol', () => {
    const base = {
      symbol: 'GBPUSD',
      side: 'BUY' as const,
      volume: 0.01,
      entryPrice: 1.23457,
      entryTime: 1_718_000_123,
      digits: 5,
    };

    expect(createTradeLevelOverrideFingerprint(base)).not.toBe(createTradeLevelOverrideFingerprint({
      ...base,
      entryTime: 1_718_000_124,
    }));
  });

  it('selects the nearest visible trade line within the drag hit area', () => {
    expect(selectNearestTradeLevel([
      { grabbedType: 'ENTRY', y: 100 },
      { grabbedType: 'SL', y: 111 },
      { grabbedType: 'TP', y: 160 },
    ], 109, 12)).toEqual({ grabbedType: 'SL', distance: 2 });
  });

  it('does not select a trade line outside the drag hit area', () => {
    expect(selectNearestTradeLevel([
      { grabbedType: 'ENTRY', y: 100 },
      { grabbedType: 'SL', y: 140 },
    ], 120, 12)).toBeNull();
  });

  it('ignores missing trade levels when selecting the nearest line', () => {
    expect(selectNearestTradeLevel([
      { grabbedType: 'ENTRY', y: 100 },
      { grabbedType: 'SL', y: null },
      { grabbedType: 'TP', y: undefined },
    ], 104, 12)).toEqual({ grabbedType: 'ENTRY', distance: 4 });
  });

  it('clamps a BUY stop loss that lands above the current price to the valid side', () => {
    // Losing BUY: entry well above the current market price. Dragging the entry
    // line down stops below the entry but stays above the current price, which a
    // broker would reject. The level must clamp below the current price.
    const update = applyTradeLevelDragUpdate({
      side: 'BUY',
      grabbedType: 'ENTRY',
      entryPrice: 63960,
      finalPrice: 63928,
      currentSl: 0,
      currentTp: 64000,
      digits: 2,
      currentPrice: 63821.35,
      entryDragDirection: -1,
      snapEntryToMinDistance: true,
    });

    expect(update).toEqual({
      role: 'SL',
      price: 63821.3,
      sl: 63821.3,
      tp: 64000,
    });
  });

  it('leaves a BUY stop loss alone when it is already below the current price', () => {
    const update = applyTradeLevelDragUpdate({
      side: 'BUY',
      grabbedType: 'ENTRY',
      entryPrice: 63960,
      finalPrice: 63800,
      currentSl: 0,
      currentTp: 64000,
      digits: 2,
      currentPrice: 63821.35,
      entryDragDirection: -1,
      snapEntryToMinDistance: true,
    });

    expect(update).toEqual({
      role: 'SL',
      price: 63800,
      sl: 63800,
      tp: 64000,
    });
  });

  it('clamps a SELL stop loss that lands below the current price to the valid side', () => {
    const update = applyTradeLevelDragUpdate({
      side: 'SELL',
      grabbedType: 'ENTRY',
      entryPrice: 1.10000,
      finalPrice: 1.10005,
      currentSl: 0,
      currentTp: 1.09000,
      digits: 5,
      currentPrice: 1.10010,
      entryDragDirection: 1,
      snapEntryToMinDistance: true,
    });

    expect(update).toEqual({
      role: 'SL',
      price: 1.10015,
      sl: 1.10015,
      tp: 1.09000,
    });
  });

  it('clamps a BUY take profit that lands below the current price to the valid side', () => {
    const update = applyTradeLevelDragUpdate({
      side: 'BUY',
      grabbedType: 'TP',
      entryPrice: 1.10000,
      finalPrice: 1.10005,
      currentSl: 1.09000,
      currentTp: 1.10500,
      digits: 5,
      currentPrice: 1.10010,
    });

    expect(update).toEqual({
      role: 'TP',
      price: 1.10015,
      sl: 1.09000,
      tp: 1.10015,
    });
  });

  it('clamps an existing SL line dragged across the current price', () => {
    const update = applyTradeLevelDragUpdate({
      side: 'BUY',
      grabbedType: 'SL',
      entryPrice: 1.10000,
      finalPrice: 1.10005,
      currentSl: 1.09900,
      currentTp: 1.10500,
      digits: 5,
      currentPrice: 1.09990,
    });

    expect(update).toEqual({
      role: 'SL',
      price: 1.09985,
      sl: 1.09985,
      tp: 1.10500,
    });
  });

  it('does not clamp against the current price when it is unavailable', () => {
    expect(applyTradeLevelDragUpdate({
      side: 'BUY',
      grabbedType: 'SL',
      entryPrice: 1.10000,
      finalPrice: 1.09876,
      currentSl: 1.09900,
      currentTp: 1.10500,
      digits: 5,
    })).toEqual({
      role: 'SL',
      price: 1.09876,
      sl: 1.09876,
      tp: 1.10500,
    });
  });

  it('clampTradeLevelToCurrentPrice keeps levels on the broker-valid side', () => {
    // BUY: SL below current, TP above current.
    expect(clampTradeLevelToCurrentPrice('BUY', 'SL', 63928, 63821.35, 0.05, 2)).toBe(63821.3);
    expect(clampTradeLevelToCurrentPrice('BUY', 'SL', 63800, 63821.35, 0.05, 2)).toBe(63800);
    expect(clampTradeLevelToCurrentPrice('BUY', 'TP', 63810, 63821.35, 0.05, 2)).toBe(63821.4);
    // SELL: SL above current, TP below current.
    expect(clampTradeLevelToCurrentPrice('SELL', 'SL', 1.10005, 1.10010, 0.00005, 5)).toBe(1.10015);
    expect(clampTradeLevelToCurrentPrice('SELL', 'TP', 1.10020, 1.10010, 0.00005, 5)).toBe(1.10005);
  });
});
