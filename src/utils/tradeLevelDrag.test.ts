import { describe, expect, it } from 'vitest';

import {
  applyTradeLevelDragUpdate,
  clampTradeLevelToCurrentPrice,
  createTradeLevelOverrideFingerprint,
  normalizeTradeLevelDragPrice,
  pendingOrderPriceViolation,
  protectionLevelViolation,
  resolveDropPriceForRole,
  resolveTradeLevelDragRole,
  selectNearestTradeLevel,
} from './tradeLevelDrag';

describe('tradeLevelDrag', () => {
  it('keeps punctuated broker contracts in separate override fingerprints', () => {
    const common = {
      side: 'BUY' as const,
      volume: 0.01,
      entryPrice: 1.1,
      entryTime: 123,
      digits: 5,
    };

    const base = createTradeLevelOverrideFingerprint({ ...common, symbol: 'XAUUSD' });
    const raw = createTradeLevelOverrideFingerprint({ ...common, symbol: ' xauusd.raw ' });
    const pro = createTradeLevelOverrideFingerprint({ ...common, symbol: 'XAUUSD-PRO' });

    expect(raw).toContain(':XAUUSD.RAW:');
    expect(pro).toContain(':XAUUSD-PRO:');
    expect(new Set([base, raw, pro])).toHaveLength(3);
  });

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

  it('labels a BUY entry-line drop above the live Bid as a take profit (valid side, not clamped)', () => {
    // Losing BUY: entry (63960) above the close (63821.35). A drop at 63928 is
    // above the close, so it is a TP (above Bid is the valid side). The old
    // entry-relative rule labelled it SL and clamped it below the close.
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
      role: 'TP',
      price: 63928,
      sl: 0,
      tp: 63928,
    });
  });

  it('labels a BUY entry-line drop below the live Bid as a stop loss (valid side)', () => {
    // Same losing BUY: a drop at 63800 is below the close, so it is an SL.
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

  it('labels a SELL entry-line drop below the live Ask as a take profit (valid side, not clamped)', () => {
    // Losing SELL: entry (1.10000) below the Ask (1.10010). A drop at 1.10005 is
    // below the Ask, so it is a TP (below Ask is the valid side).
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
      role: 'TP',
      price: 1.10005,
      sl: 0,
      tp: 1.10005,
    });
  });

  it('labels a SELL entry-line drop above the live Ask as a stop loss (valid side)', () => {
    // Same losing SELL: a drop at 1.10015 is above the Ask, so it is an SL.
    const update = applyTradeLevelDragUpdate({
      side: 'SELL',
      grabbedType: 'ENTRY',
      entryPrice: 1.10000,
      finalPrice: 1.10015,
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

  it('pendingOrderPriceViolation validates pending trigger and SL/TP placement', () => {
    expect(pendingOrderPriceViolation({
      orderType: 'buy_limit',
      side: 'BUY',
      price: 1.09900,
      bid: 1.10000,
      ask: 1.10010,
      digits: 5,
    })).toBeNull();

    expect(pendingOrderPriceViolation({
      orderType: 'buy_limit',
      side: 'BUY',
      price: 1.10020,
      bid: 1.10000,
      ask: 1.10010,
      digits: 5,
    })).toMatch(/Buy Limit price must be below Ask/i);

    expect(pendingOrderPriceViolation({
      orderType: 'sell_limit',
      side: 'SELL',
      price: 1.09990,
      bid: 1.10000,
      ask: 1.10010,
      digits: 5,
    })).toMatch(/Sell Limit price must be above Bid/i);

    expect(pendingOrderPriceViolation({
      orderType: 'buy_stop',
      side: 'BUY',
      price: 1.10000,
      bid: 1.10000,
      ask: 1.10010,
      digits: 5,
    })).toMatch(/Buy Stop price must be above Ask/i);

    expect(pendingOrderPriceViolation({
      orderType: 'sell_stop',
      side: 'SELL',
      price: 1.10010,
      bid: 1.10000,
      ask: 1.10010,
      digits: 5,
    })).toMatch(/Sell Stop price must be below Bid/i);
  });

  it('rounds BUY SL dragged to 81736.68 down away from Bid 81736.70 onto the 0.25 tick grid (MED-3)', () => {
    const bid = 81736.70;
    const ask = 81736.95;
    const digits = 2;
    const tickSize = 0.25;
    const dropPrice = resolveDropPriceForRole({
      side: 'BUY',
      grabbedType: 'SL',
      price: 81736.68,
      quote: { bid, ask },
      digits,
      tickSize,
      isNewLevel: false,
    });
    const previewUpdate = applyTradeLevelDragUpdate({
      side: 'BUY',
      grabbedType: 'SL',
      entryPrice: 81750.00,
      finalPrice: dropPrice,
      currentSl: 81700.00,
      currentTp: 81800.00,
      digits,
      currentPrice: bid,
      minStopDistance: 0,
    });

    expect(dropPrice).toBe(81736.50);
    expect(previewUpdate?.price).toBe(81736.50);
    expect(previewUpdate?.price).toBe(dropPrice);
    expect(
      protectionLevelViolation({
        side: 'BUY',
        role: 'SL',
        price: dropPrice,
        bid,
        ask,
        digits,
        tickSize,
      }),
    ).toBeNull();
  });

  it('rounds BUY TP up away from Bid 81736.70 onto the 0.25 tick grid (MED-3)', () => {
    const bid = 81736.70;
    const ask = 81736.95;
    const digits = 2;
    const tickSize = 0.25;
    const dropPrice = resolveDropPriceForRole({
      side: 'BUY',
      grabbedType: 'TP',
      price: 81736.72,
      quote: { bid, ask },
      digits,
      tickSize,
      isNewLevel: false,
    });
    const previewUpdate = applyTradeLevelDragUpdate({
      side: 'BUY',
      grabbedType: 'TP',
      entryPrice: 81700.00,
      finalPrice: dropPrice,
      currentSl: 81650.00,
      currentTp: 81800.00,
      digits,
      currentPrice: bid,
      minStopDistance: 0,
    });

    expect(dropPrice).toBe(81736.75);
    expect(previewUpdate?.price).toBe(81736.75);
    expect(previewUpdate?.price).toBe(dropPrice);
    expect(
      protectionLevelViolation({
        side: 'BUY',
        role: 'TP',
        price: dropPrice,
        bid,
        ask,
        digits,
        tickSize,
      }),
    ).toBeNull();
  });

  it('rounds SELL SL and SELL TP away from Ask 81736.95 onto the 0.25 tick grid (MED-3)', () => {
    const bid = 81736.70;
    const ask = 81736.95;
    const digits = 2;
    const tickSize = 0.25;

    const slDropPrice = resolveDropPriceForRole({
      side: 'SELL',
      grabbedType: 'SL',
      price: 81736.97,
      quote: { bid, ask },
      digits,
      tickSize,
      isNewLevel: false,
    });
    const slPreview = applyTradeLevelDragUpdate({
      side: 'SELL',
      grabbedType: 'SL',
      entryPrice: 81700.00,
      finalPrice: slDropPrice,
      currentSl: 81750.00,
      currentTp: 81650.00,
      digits,
      currentPrice: ask,
      minStopDistance: 0,
    });

    expect(slDropPrice).toBe(81737.00);
    expect(slPreview?.price).toBe(81737.00);
    expect(slPreview?.price).toBe(slDropPrice);
    expect(
      protectionLevelViolation({
        side: 'SELL',
        role: 'SL',
        price: slDropPrice,
        bid,
        ask,
        digits,
        tickSize,
      }),
    ).toBeNull();

    const tpDropPrice = resolveDropPriceForRole({
      side: 'SELL',
      grabbedType: 'TP',
      price: 81736.93,
      quote: { bid, ask },
      digits,
      tickSize,
      isNewLevel: false,
    });
    const tpPreview = applyTradeLevelDragUpdate({
      side: 'SELL',
      grabbedType: 'TP',
      entryPrice: 81750.00,
      finalPrice: tpDropPrice,
      currentSl: 81800.00,
      currentTp: 81700.00,
      digits,
      currentPrice: ask,
      minStopDistance: 0,
    });

    expect(tpDropPrice).toBe(81736.75);
    expect(tpPreview?.price).toBe(81736.75);
    expect(tpPreview?.price).toBe(tpDropPrice);
    expect(
      protectionLevelViolation({
        side: 'SELL',
        role: 'TP',
        price: tpDropPrice,
        bid,
        ask,
        digits,
        tickSize,
      }),
    ).toBeNull();
  });

  it('accepts large-magnitude 5-digit price 123456.12345 on the 0.00001 tick grid (MED-4)', () => {
    expect(
      protectionLevelViolation({
        side: 'SELL',
        role: 'TP',
        price: 123456.12345,
        bid: 123460,
        ask: 123460.5,
        digits: 5,
        tickSize: 0.00001,
      }),
    ).toBeNull();
  });
});
