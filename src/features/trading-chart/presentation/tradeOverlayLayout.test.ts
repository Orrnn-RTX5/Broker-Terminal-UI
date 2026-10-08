import { describe, expect, it } from 'vitest';
import { getTradeControlDragY, layoutTradeControls, type TradeControlRect } from './tradeOverlayPresentation';

const overlaps = (a: TradeControlRect, b: TradeControlRect) => (
  a.left < b.left + b.width && a.left + a.width > b.left
  && a.top < b.top + b.height && a.top + a.height > b.top
);

const control = (key: string, anchorY: number, width = 240) => ({
  key, anchorY, width, height: 26, preferredLeft: 16,
});

const entryControl = (key: string, anchorY: number) => ({
  ...control(key, anchorY, 310), placement: 'above' as const,
});

describe('price-anchored trade control layout', () => {
  it.each([1, 100, 500])('retains all %s same-price bars at the same anchor without hiding or paging', count => {
    const inputs = Array.from({ length: count }, (_, index) => entryControl(`trade:${index}`, 250));
    const placed = layoutTradeControls(inputs, 800);

    expect(placed).toHaveLength(count);
    expect(new Set(placed.map(rect => rect.key))).toEqual(new Set(inputs.map(input => input.key)));
    for (const rect of placed) {
      expect(rect).toMatchObject({ anchorY: 250, left: 16, top: 220, height: 26, width: 310, offsetY: -17 });
      expect(rect).not.toHaveProperty('hidden');
      expect(rect).not.toHaveProperty('overflow');
      expect(overlaps(rect, placed[0])).toBe(true);
    }
  });

  it('lets distinct compressed prices overlap and separates them only when their price coordinates expand', () => {
    const inputs = [entryControl('lower-price', 200), entryControl('higher-price', 210)];
    const compressed = layoutTradeControls(inputs, 800);
    expect(overlaps(compressed[0], compressed[1])).toBe(true);
    expect(compressed[1].top - compressed[0].top).toBe(10);

    const expanded = layoutTradeControls(inputs.map(input => (
      input.key === 'higher-price' ? { ...input, anchorY: 260 } : input
    )), 800);
    expect(overlaps(expanded[0], expanded[1])).toBe(false);
    expect(expanded[1].top - expanded[0].top).toBe(60);
    expect(expanded.map(rect => [rect.key, rect.left, rect.width])).toEqual(
      compressed.map(rect => [rect.key, rect.left, rect.width]),
    );
    expect(expanded[0]).toEqual(compressed[0]);
  });

  it('keeps a four-pixel entry gap with measured heights regardless of neighboring bars', () => {
    const entries = [
      entryControl('normal', 250),
      { ...entryControl('wrapped', 250), height: 54 },
      { ...entryControl('large', 258), height: 72 },
    ];
    const crowded = Array.from({ length: 100 }, (_, index) => entryControl(`neighbor:${index}`, 252));
    const placed = layoutTradeControls([...entries, ...crowded], 800);

    for (const input of entries) {
      const rect = placed.find(item => item.key === input.key)!;
      expect(rect.height).toBe(input.height);
      expect(input.anchorY - (rect.top + rect.height)).toBe(4);
      expect(rect).toEqual(layoutTradeControls([input], 800)[0]);
    }
  });

  it.each([-50, 0, 8, 900])('does not clamp or flip the entry bar at vertical price coordinate %s', anchorY => {
    const [rect] = layoutTradeControls([entryControl('entry', anchorY)], 800);
    expect(rect.anchorY).toBe(anchorY);
    expect(rect.top).toBe(anchorY - rect.height - 4);
    expect(rect.offsetY).toBe(-17);
  });

  it('keeps SL and TP centered on their own prices even when they overlap', () => {
    const levels = [
      { ...control('sl', 100, 130), preferredLeft: 654 },
      { ...control('tp', 108, 130), preferredLeft: 654 },
    ];
    const placed = layoutTradeControls([entryControl('entry', 100), ...levels], 800);
    const levelRects = placed.filter(rect => rect.key !== 'entry');
    for (const rect of levelRects) {
      expect(rect.top + rect.height / 2).toBe(rect.anchorY);
      expect(rect.offsetY).toBe(0);
    }
    expect(overlaps(levelRects[0], levelRects[1])).toBe(true);
    expect(levelRects).toEqual(layoutTradeControls(levels, 800));
  });

  it('bounds horizontal geometry without changing the price coordinate or measured height', () => {
    const inputs = [
      { ...entryControl('oversized', 100), width: 500 },
      { ...entryControl('negative-left', 120), preferredLeft: -30, width: 100 },
      { ...entryControl('past-right', 140), preferredLeft: 900, width: 100 },
      { ...entryControl('wrapped', 160), width: 500, height: 54 },
    ];
    const placed = layoutTradeControls(inputs, 260);
    for (const input of inputs) {
      const rect = placed.find(item => item.key === input.key)!;
      expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.width).toBeGreaterThanOrEqual(0);
      expect(rect.width).toBeLessThanOrEqual(input.width);
      expect(rect.left + rect.width).toBeLessThanOrEqual(260);
      expect(rect.height).toBe(input.height);
      expect(rect.anchorY).toBe(input.anchorY);
      expect(rect.top + rect.height).toBe(input.anchorY - 4);
    }
    expect(placed.find(rect => rect.key === 'oversized')?.left).toBe(16);
  });

  it('keeps each ticket placement unchanged when input order changes', () => {
    const inputs = [entryControl('first', 250), entryControl('second', 250), entryControl('third', 258)];
    const forward = layoutTradeControls(inputs, 800);
    const reversed = layoutTradeControls([...inputs].reverse(), 800);
    for (const rect of forward) expect(reversed.find(other => other.key === rect.key)).toEqual(rect);
  });

  it('preserves the anchor and drag distance for ordinary, wrapped, and centered bars', () => {
    const placed = layoutTradeControls([
      entryControl('entry', 250),
      { ...entryControl('wrapped-entry', 250), height: 54 },
      control('sl', 258),
    ], 800);
    for (const rect of placed) {
      const pointerDown = rect.top + rect.height / 2;
      expect(getTradeControlDragY(pointerDown, rect.offsetY)).toBe(rect.anchorY);
      expect(getTradeControlDragY(pointerDown + 7, rect.offsetY)).toBe(rect.anchorY + 7);
      expect(getTradeControlDragY(pointerDown - 11, rect.offsetY)).toBe(rect.anchorY - 11);
    }
  });
});
