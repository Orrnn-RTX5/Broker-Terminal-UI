// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createChartRuler, renderChartRuler, rulerDuration, rulerMetrics, type RulerPoint } from './chartRuler';

const start: RulerPoint = { logical: 10, time: 1000, price: 2000 };
const end: RulerPoint = { logical: 13, time: 1180, price: 1997.5 };
describe('ruler values', () => {
  it('keeps signed ticks and time while summing the inclusive measured candles', () => {
    const bars = [940, 1000, 1060, 1120, 1180, 1240].map(time => ({ time, volume: 250 }));
    expect(rulerMetrics(start, end, bars, 2, .01)).toEqual({ price: '-2.50 (-0.13%) -250', range: '3 bars, 3m', volume: 'Vol 1K', color: '#f7525f' });
    expect(rulerMetrics(end, start, bars, 2, .01)).toMatchObject({ range: '-3 bars, -3m', volume: 'Vol 1K', color: '#2962ff' });
  });
  it('counts logical bars across session gaps but uses actual elapsed calendar time', () => {
    expect(rulerMetrics(start, { ...end, logical: 11, time: 1000 + 3 * 86400 }, [], 2, .01).range).toBe('1 bars, 3d');
  });
  it('does not invent missing volume or a percentage from a zero start price', () => {
    expect(rulerMetrics({ ...start, price: 0 }, end, [{ time: 1000 }], 2, .01).price).toContain('(—)');
    expect(rulerMetrics(start, end, [{ time: 1000 }], 2, .01).volume).toBe('Vol —');
    expect(rulerMetrics(start, end, [{ time: 1000, tickVolume: 0 }], 2, .01).volume).toBe('Vol 0');
  });
  it('formats long intervals, fractional ticks, flat prices and sub-minute intervals', () => {
    expect(rulerDuration(-90061)).toBe('-1d 1h 1m 1s');
    expect(rulerDuration(30)).toBe('30s');
    expect(rulerMetrics(start, { ...end, price: 2000.125 }, [], 3, .01).price).toBe('0.125 (0.01%) 12.5');
    expect(rulerMetrics(start, start, [], 2, .01).range).toBe('0 bars, 0m');
  });
});

const geometry = {
  width: 500, height: 300, totalWidth: 580, totalHeight: 330,
  x: (value: number) => value * 10, y: (value: number) => 2200 - value,
  formatPrice: (value: number) => value.toFixed(2), formatTime: (value: number) => String(value),
};
describe('ruler rendering', () => {
  it.each([end, { ...end, price: 2100 }])('draws direction colors, arrows and both axis intervals', point => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const metrics = rulerMetrics(start, point, [], 2, .01);
    renderChartRuler(svg, start, point, metrics, geometry);
    expect(svg.querySelector('[data-ruler-part="range"]')?.getAttribute('fill')).toBe(metrics.color);
    expect(svg.querySelectorAll('path')).toHaveLength(2);
    expect(svg.textContent).toContain(metrics.range);
    const rect = svg.querySelector('[data-ruler-part="label"]')!;
    expect(Number(rect.getAttribute('y'))).toBeGreaterThanOrEqual(4);
    expect(Number(rect.getAttribute('y')) + Number(rect.getAttribute('height'))).toBeLessThan(300);
    expect(svg.textContent).toContain(start.price.toFixed(2));
  });
  it('does not turn a measurement fully outside the plot into an edge measurement', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    renderChartRuler(svg, { ...start, logical: 80 }, { ...end, logical: 100 }, rulerMetrics(start, end, [], 2, .01), geometry);
    expect(svg.childElementCount).toBe(0);
  });
});

describe('ruler pointer lifecycle', () => {
  let container: HTMLDivElement;
  let ruler: ReturnType<typeof createChartRuler>;
  let finish: ReturnType<typeof vi.fn>;
  let select: ReturnType<typeof vi.fn>;
  let historyOffset = 0;
  const pointer = (type: string, x: number, y: number, extra: Record<string, unknown> = {}) => {
    const event = new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true, ...extra });
    Object.defineProperties(event, { pointerId: { value: extra.pointerId ?? 1 }, isPrimary: { value: true } });
    container.dispatchEvent(event);
    return event;
  };
  beforeEach(() => {
    historyOffset = 0;
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => window.setTimeout(cb, 0));
    vi.stubGlobal('cancelAnimationFrame', clearTimeout);
    container = document.createElement('div'); document.body.appendChild(container);
    container.setPointerCapture = vi.fn(); container.releasePointerCapture = vi.fn();
    finish = vi.fn(() => ruler.select(false));
    select = vi.fn(() => ruler.select(true));
    ruler = createChartRuler({ container, finish, select, canStartShortcut: () => true, geometry: () => geometry,
      point: (x, y) => ({ logical: Math.round(x / 10), time: 1000 + Math.round(x / 10) * 60, price: 2200 - y }),
      metrics: (a, b) => rulerMetrics(a, b, [], 2, .01),
      resolve: point => ({ ...point, logical: (point.time - 1000) / 60 + historyOffset }),
    });
  });
  afterEach(() => { ruler.destroy(); container.remove(); vi.unstubAllGlobals(); });
  it('lets a focused help or menu own Escape without cancelling the chart ruler', () => {
    ruler.select(true);
    const help = document.createElement('div');
    help.setAttribute('role', 'dialog'); help.dataset.shortcutScope = 'local';
    const button = document.createElement('button'); help.append(button); document.body.append(help);
    const closeHelp = vi.fn(); help.addEventListener('keydown', closeHelp);
    try {
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      button.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      expect(closeHelp).toHaveBeenCalledOnce();
      expect(container.dataset.chartRulerArmed).toBe('true');
      expect(finish).not.toHaveBeenCalled();
    } finally { help.remove(); }
    container.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(container.dataset.chartRulerArmed).toBeUndefined();
  });
  it('supports click, preview, click; preserves result until the next chart press', () => {
    ruler.select(true);
    pointer('pointerdown', 100, 100); pointer('pointerup', 100, 100);
    pointer('pointermove', 230, 200); pointer('pointerdown', 230, 200); pointer('pointerup', 230, 200);
    expect(finish).toHaveBeenCalledTimes(1);
    expect(container.querySelector('svg')?.textContent).toContain('13 bars, 13m');
    expect(container.dataset.chartRulerArmed).toBeUndefined();
    expect(pointer('pointerdown', 350, 250).defaultPrevented).toBe(false);
    expect(container.querySelector('svg')).toBeNull();
  });
  it('supports drag release, consumes pan events and ignores another pointer', () => {
    ruler.select(true);
    expect(pointer('pointerdown', 100, 100).defaultPrevented).toBe(true);
    pointer('pointerup', 400, 250, { pointerId: 2 });
    expect(finish).not.toHaveBeenCalled();
    expect(pointer('pointerup', 250, 200).defaultPrevented).toBe(true);
    expect(finish).toHaveBeenCalledTimes(1);
    expect(container.querySelector('svg')?.textContent).toContain('15 bars, 15m');
  });
  it('allows Shift-click from cursor mode and ignores the axes', () => {
    pointer('pointerdown', 540, 200, { shiftKey: true });
    expect(select).not.toHaveBeenCalled();
    pointer('pointerdown', 100, 100, { shiftKey: true }); pointer('pointerup', 100, 100);
    expect(select).toHaveBeenCalledTimes(1);
    expect(container.querySelector('svg')).not.toBeNull();
  });
  it('cancels on Escape, pointer cancellation, and switching tools', () => {
    for (const action of ['escape', 'pointercancel', 'tool']) {
      ruler.select(true); pointer('pointerdown', 100, 100);
      if (action === 'escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      else if (action === 'pointercancel') pointer('pointercancel', 100, 100);
      else ruler.select(false);
      expect(container.querySelector('svg')).toBeNull();
      expect(container.dataset.chartRulerArmed).toBeUndefined();
    }
  });
  it('does not reset an in-progress measurement when the rail re-arms its context', () => {
    ruler.select(true); pointer('pointerdown', 100, 100); pointer('pointerup', 100, 100);
    ruler.select(true); pointer('pointerdown', 200, 200);
    expect(container.querySelector('svg')?.textContent).toContain('10 bars, 10m');
  });
  it('re-resolves both anchors by time when older history shifts every candle index', () => {
    ruler.select(true); pointer('pointerdown', 100, 100); pointer('pointerup', 100, 100);
    historyOffset = 4000;
    pointer('pointerdown', 250, 200);
    expect(container.querySelector('svg')?.getAttribute('aria-label')).toContain('15 bars, 15m');
    expect(container.querySelector('svg')?.getAttribute('aria-label')).not.toContain('4015 bars');
  });
});
