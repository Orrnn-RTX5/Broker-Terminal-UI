import { describe, expect, it } from 'vitest';
import { getTradeControlDragY, layoutTradeControls, type TradeControlRect } from './tradeOverlayPresentation';

const overlaps = (a: TradeControlRect, b: TradeControlRect) => (
  a.left < b.left + b.width && a.left + a.width > b.left
  && a.top < b.top + b.height && a.top + a.height > b.top
);

const control = (key: string, anchorY: number, width = 240) => ({
  key, anchorY, width, height: 26, preferredLeft: 16,
});

describe('trade control collision layout', () => {
  it('keeps an unobstructed control centered on its actual price', () => {
    expect(layoutTradeControls([control('entry', 100)], 800, 400)).toEqual([
      { key: 'entry', anchorY: 100, left: 16, top: 87, width: 240, height: 26, offsetY: 0 },
    ]);
  });

  it('separates nearby levels horizontally before displacing them from price', () => {
    const placed = layoutTradeControls([control('first', 100), control('second', 108)], 800, 400);
    expect(placed.every(rect => rect.offsetY === 0)).toBe(true);
    expect(overlaps(placed[0], placed[1])).toBe(false);
    expect(placed[1].left).toBeGreaterThan(placed[0].left + placed[0].width);
  });

  it('reserves both the HUD and one-click panel without moving price anchors', () => {
    const chrome = [
      { left: 12, top: 6, width: 530, height: 20 },
      { left: 10, top: 28, width: 300, height: 90 },
    ];
    const [placed] = layoutTradeControls([control('entry', 55, 300)], 560, 400, chrome);
    expect(chrome.some(rect => overlaps(placed, rect))).toBe(false);
    expect(placed.anchorY).toBe(55);
    expect(placed.top).toBe(124);
    expect(getTradeControlDragY(placed.top + placed.height / 2, placed.offsetY)).toBe(55);
  });

  it('stacks same-price and close-price bars within a narrow pane', () => {
    const inputs = [control('first', 100, 300), control('second', 100, 300), control('third', 108, 300)];
    const placed = layoutTradeControls(inputs, 380, 250);
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) expect(overlaps(placed[i], placed[j])).toBe(false);
      expect(placed[i].top).toBeGreaterThanOrEqual(6);
      expect(placed[i].top + placed[i].height).toBeLessThanOrEqual(244);
      expect(placed[i].anchorY).toBe(inputs.find(input => input.key === placed[i].key)!.anchorY);
    }
    expect(layoutTradeControls([...inputs].reverse(), 380, 250)).toEqual(placed);
  });

  it('bounds enlarged controls and clears displacement once the obstruction disappears', () => {
    const entry = { ...control('entry', 40, 500), height: 54 };
    const [blocked] = layoutTradeControls([entry], 260, 250, [{ left: 0, top: 0, width: 260, height: 100 }]);
    expect(blocked.left + blocked.width).toBeLessThanOrEqual(254);
    expect(blocked.offsetY).toBeGreaterThan(0);
    const [cleared] = layoutTradeControls([entry], 260, 250);
    expect(cleared.offsetY).toBe(0);
  });

  it.each([-42, 0, 58])('preserves drag distance and price for a visual offset of %s', offset => {
    const pointerDown = 150 + offset;
    const pointerMove = pointerDown + 7;
    expect(getTradeControlDragY(pointerDown, offset)).toBe(150);
    expect(getTradeControlDragY(pointerMove, offset)).toBe(157);
    expect(getTradeControlDragY(pointerMove, offset) - getTradeControlDragY(pointerDown, offset)).toBe(7);
  });
});
