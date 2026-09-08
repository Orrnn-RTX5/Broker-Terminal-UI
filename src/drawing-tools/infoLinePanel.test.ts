// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appendInfoLinePanel } from './infoLinePanel';
import type { InfoLineMetricDisplay } from './geometry/tradingViewTrendGeometry';

const display: InfoLineMetricDisplay = {
  priceChange: '-6.546', percentChange: '-0.15', priceSteps: '-654.6',
  bars: '50 bars', elapsed: '50m', pixelDistance: '323 px', angle: '-21.8\u00b0',
};
const colors = { background: '#f2f2f2', text: '#131722' };
const measureText = vi.fn((value: string) => ({ width: value.length * 5.5 }));

const makeGroup = () => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  document.body.appendChild(svg);
  svg.appendChild(group);
  return group;
};

beforeEach(() => {
  document.body.replaceChildren();
  measureText.mockImplementation(value => ({ width: value.length * 5.5 }));
  vi.stubGlobal('CanvasRenderingContext2D', class {});
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText } as unknown as CanvasRenderingContext2D);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Info line measurement panel', () => {
  it('matches reference placement and shows three normal-weight measurement rows with distinct glyphs', () => {
    const group = makeGroup();
    const background = appendInfoLinePanel(group, { x: 803, y: 200 }, { x: 1103, y: 320 }, display, 1600, 760, colors);
    expect(['x', 'y', 'width', 'height'].map(name => Number(background.getAttribute(name))))
      .toEqual([965, 153, 225, 94]);
    const rows = group.querySelectorAll('[data-geometry-role^="measurement-row-"]');
    expect(Array.from(rows, row => row.textContent)).toEqual([
      '-6.546 (-0.15%), -654.6', '50 bars (50m), distance: 323 px', '-21.8\u00b0',
    ]);
    rows.forEach(row => {
      expect(row.getAttribute('font-size')).toBe('11');
      expect(row.getAttribute('font-weight')).toBe('400');
      expect(row.getAttribute('pointer-events')).toBe('none');
      expect(row.getAttribute('fill')).toBe(colors.text);
    });
    const glyphs = group.querySelectorAll('[data-geometry-role^="measurement-glyph-"]');
    expect(glyphs).toHaveLength(3);
    expect(new Set(Array.from(glyphs, glyph => glyph.getAttribute('d'))).size).toBe(3);
    glyphs.forEach(glyph => expect(glyph.getAttribute('pointer-events')).toBe('none'));
    expect(group.querySelector('[data-geometry-role="measurement-separator"]')).toBeNull();
    expect(background.getAttribute('fill')).toBe(colors.background);
    expect(background.getAttribute('pointer-events')).toBe('none');
  });

  it('measures detached SVG text with the cached canvas instead of fixing the reference width', () => {
    measureText.mockImplementation(value => ({ width: value.length * 7 }));
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    expect(group.isConnected).toBe(false);
    const background = appendInfoLinePanel(group, { x: 100, y: 200 }, { x: 200, y: 300 }, display, 1000, 600, colors);
    expect(Number(background.getAttribute('width'))).toBe(31 * 7 + 42 + 12);
    expect(group.querySelector('title')).toBeNull();
    expect(measureText).toHaveBeenCalledWith('50 bars (50m), distance: 323 px');
    expect(vi.mocked(HTMLCanvasElement.prototype.getContext).mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('flips below a line near the upper edge and stays inside the right chart boundary', () => {
    const group = makeGroup();
    const background = appendInfoLinePanel(group, { x: 420, y: 10 }, { x: 440, y: 30 }, display, 460, 280, colors);
    expect(Number(background.getAttribute('y'))).toBe(33);
    expect(Number(background.getAttribute('x')) + Number(background.getAttribute('width'))).toBe(456);
  });

  it('keeps narrow-chart labels inside the panel without shrinking the font', () => {
    const group = makeGroup();
    const background = appendInfoLinePanel(group, { x: 30, y: 100 }, { x: 90, y: 200 }, display, 150, 280, colors);
    expect(Number(background.getAttribute('width'))).toBe(142);
    const row = group.querySelector('[data-geometry-role="measurement-row-2"]')!;
    expect(row.firstChild?.textContent).toMatch(/\u2026$/);
    expect(row.querySelector('title')?.textContent).toBe('50 bars (50m), distance: 323 px');
    expect(row.getAttribute('font-size')).toBe('11');
  });
});
