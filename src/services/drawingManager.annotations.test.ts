// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import { ANNOTATION_TOOLS, annotationLines, isAnnotationImage, isAnnotationLink } from '../drawing-tools/annotationToolCatalog';
vi.mock('./drawingApi', () => ({ drawingApi: { loadDrawings: vi.fn().mockResolvedValue([]), saveDrawing: vi.fn().mockResolvedValue('saved'), deleteDrawing: vi.fn().mockResolvedValue(undefined) } }));
import { DrawingManager, type Drawing } from './drawingManager';

async function harness() {
  const container = document.createElement('div');
  Object.defineProperties(container, { clientWidth: { value: 500 }, clientHeight: { value: 300 } });
  document.body.appendChild(container);
  const chart = { timeScale: () => ({ timeToCoordinate: (t: number) => t - 100, coordinateToTime: (x: number) => x + 100,
    logicalToCoordinate: (n: number) => n, coordinateToLogical: (n: number) => n, height: () => 20 }), priceScale: () => ({ width: () => 40 }) } as unknown as IChartApi;
  const series = { priceToCoordinate: (p: number) => 220 - p, coordinateToPrice: (y: number) => 220 - y,
    options: () => ({ priceFormat: { precision: 3, minMove: .001 } }), priceFormatter: () => ({ format: (p: number) => p.toFixed(3) }) } as unknown as ISeriesApi<'Candlestick'>;
  const manager = new DrawingManager();
  manager.setChart(chart, series, 'TEST', 1, container, 'M1', 'annotation-test', 'account-test');
  await Promise.resolve();
  return { manager, container };
}
function create(manager: DrawingManager, subtype: string, properties: Partial<Drawing> = {}) {
  const id = manager.startDrawing('text', '#2962ff', { subtype });
  manager.updateActiveDrawing(properties);
  manager.addPoint(160, 110.125);
  if (['note', 'price_note', 'callout'].includes(subtype)) manager.addPoint(260, 150);
  return id;
}
beforeEach(() => { document.body.replaceChildren(); localStorage.clear(); vi.clearAllMocks(); });

describe('chart annotations', () => {
  it.each(ANNOTATION_TOOLS)('$label completes with its required anchor count', async tool => {
    const { manager } = await harness();
    manager.startDrawing('text', '#2962ff', { subtype: tool.id });
    for (let n = 0; n < tool.requiredPoints; n++) expect(manager.addPoint(160 + n * 100, 110 + n * 20)).toBe(n === tool.requiredPoints - 1);
    expect(manager.getDrawings()).toHaveLength(1);
    expect(manager.getDrawings()[0].subtype).toBe(tool.id);
  });
  it('reads price from the target anchor rather than the label position', async () => {
    const { manager, container } = await harness();
    const id = create(manager, 'price_note');
    expect(container.textContent).toContain('110.125');
    expect(container.textContent).not.toContain('150.000');
    manager.updateDrawingProperties(id, { points: [{ time: 160, price: 112.375 }, { time: 260, price: 150 }] });
    expect(container.textContent).toContain('112.375');
  });
  it('keeps preview labels transparent to the second anchor click', async () => {
    const { manager, container } = await harness();
    manager.startDrawing('text', '#2962ff', { subtype: 'callout' });
    manager.addPoint(160, 110);
    manager.updatePreviewPoint(260, 150);
    const background = container.querySelector('[data-geometry-role="annotation-background"]');
    expect(background?.getAttribute('pointer-events')).toBe('none');
    expect(manager.addPoint(260, 150)).toBe(true);
  });
  it('renders multiline styled text and retains styles through undo and redo', async () => {
    const { manager, container } = await harness();
    const id = create(manager, 'text', { text: 'First\nSecond' });
    manager.updateDrawingProperties(id, { annotation: { fontSize: 24, bold: true, italic: true, textColor: '#ff0000' } });
    const labels = container.querySelectorAll('text');
    expect(Array.from(labels).map(x => x.textContent)).toEqual(['First', 'Second']);
    expect(labels[0].getAttribute('font-size')).toBe('24');
    expect(labels[0].getAttribute('font-weight')).toBe('700');
    expect(labels[0].getAttribute('fill')).toBe('#ff0000');
    manager.undo(); expect(manager.getDrawings()[0].annotation).toBeUndefined();
    manager.redo(); expect(manager.getDrawings()[0].annotation?.fontSize).toBe(24);
  });
  it('shows the pin text on hover after deselection', async () => {
    const { manager, container } = await harness();
    const id = create(manager, 'pin', { text: 'Only on hover' });
    manager.updateDrawingProperties(id, { selected: false });
    const group = container.querySelector(`g[data-id="${id}"]`)!;
    const text = group.querySelector('text')!;
    expect(text.style.visibility).toBe('hidden');
    group.dispatchEvent(new Event('pointerenter')); expect(text.style.visibility).toBe('visible');
    group.dispatchEvent(new Event('pointerleave')); expect(text.style.visibility).toBe('hidden');
  });
  it('renders table cells, protects adjacent cells from overflowing text and exposes resizing', async () => {
    const { manager, container } = await harness();
    create(manager, 'table', { annotation: { tableData: [['Symbol', 'Bias'], ['A very long value that must fit', 'Watch']], cellWidth: 90, cellHeight: 30 } });
    expect(container.querySelectorAll('[data-geometry-role="annotation-background"]')).toHaveLength(4);
    expect(container.textContent).toContain('Symbol');
    expect(container.textContent).not.toContain('must fit');
    expect(container.querySelector('[data-annotation-resize]')).not.toBeNull();
  });
  it('does not open an editor for a locked drawing or a different chart context', async () => {
    const { manager } = await harness();
    const id = create(manager, 'text', { text: 'Locked' });
    manager.updateDrawingProperties(id, { locked: true });
    const listener = vi.fn(); window.addEventListener('drawing:edit-annotation', listener);
    manager.editAnnotation(id); manager.editAnnotation(id, 'other-chart');
    expect(listener).not.toHaveBeenCalled(); window.removeEventListener('drawing:edit-annotation', listener);
  });
  it('resizes an image at its corner without moving its anchor and can undo the resize', async () => {
    const { manager, container } = await harness();
    create(manager, 'image', { annotation: { imageUrl: 'https://example.com/chart.png', width: 200, height: 100 } });
    const anchor = { ...manager.getDrawings()[0].points[0] };
    const handle = container.querySelector('[data-annotation-resize]')!;
    handle.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 260, clientY: 210 }));
    window.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 360, clientY: 260 }));
    window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 360, clientY: 260 }));
    expect(manager.getDrawings()[0].annotation).toMatchObject({ width: 300, height: 150 });
    expect(manager.getDrawings()[0].points[0]).toEqual(anchor);
    manager.undo(); expect(manager.getDrawings()[0].annotation).toMatchObject({ width: 200, height: 100 });
  });
  it('restores annotation content and geometry from local persistence', async () => {
    const { manager } = await harness();
    create(manager, 'table', { annotation: { tableData: [['Saved', 'Grid']], cellWidth: 87 } });
    const restored = await harness();
    expect(restored.manager.getDrawings()[0].annotation).toEqual({ tableData: [['Saved', 'Grid']], cellWidth: 87 });
    expect(restored.container.textContent).toContain('Saved');
  });
  it('rejects executable and lookalike content URLs', () => {
    expect(isAnnotationImage('javascript:alert(1)')).toBe(false);
    expect(isAnnotationImage('data:image/svg+xml,<svg/>')).toBe(false);
    expect(isAnnotationLink('https://x.com.evil.test/user/status/123', 'post')).toBe(false);
    expect(isAnnotationLink('https://x.com/user/status/123', 'post')).toBe(true);
    expect(isAnnotationLink('https://www.tradingview.com/chart/GOLD/bFBCR7XN-Example/', 'idea')).toBe(true);
    expect(isAnnotationLink('https://www.tradingview.com/chart/P8prO2VP/', 'idea')).toBe(false);
  });
  it('wraps text including long unbroken words while preserving explicit newlines', () => {
    expect(annotationLines('one two three\nabcdefghijkl', 10, 40)).toEqual(['one', 'two', 'three', 'abcdef', 'ghijkl']);
  });
});
