import { expect, it } from 'vitest';
import { createDeferredQuoteOverlay } from './deferredQuoteOverlay';

it('keeps latest snapshot overlay through interaction release without changing the financial candle or needing another tick', () => {
  const candle = { time: 100, open: 100, high: 105, low: 95, close: 101, volume: 12 };
  const overlay = createDeferredQuoteOverlay<typeof candle>();
  overlay.defer({ ...candle, close: 110 });
  overlay.defer({ ...candle, close: 115 });
  const painted = overlay.take(candle);
  expect(painted.close).toBe(115);
  expect(candle).toEqual({ time: 100, open: 100, high: 105, low: 95, close: 101, volume: 12 });
  expect(overlay.take(candle)).toBe(candle);
});

it('a newer immediate paint supersedes deferred snapshot evidence', () => {
  const overlay = createDeferredQuoteOverlay<number>();
  overlay.defer(110); overlay.clear();
  expect(overlay.take(120)).toBe(120);
});
