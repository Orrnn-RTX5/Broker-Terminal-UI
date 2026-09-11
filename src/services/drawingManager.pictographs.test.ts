// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import { getPictographStamp } from '../drawing-tools/pictographCatalog';
import { usesDirectDrawingPointerInput } from '../drawing-tools/drawingInteractionPriority';

vi.mock('./drawingApi', () => ({
  drawingApi: {
    loadDrawings: vi.fn().mockResolvedValue([]),
    saveDrawing: vi.fn().mockResolvedValue('saved-pictograph'),
    deleteDrawing: vi.fn().mockResolvedValue(undefined),
  },
}));

import { DrawingManager } from './drawingManager';
import { drawingApi } from './drawingApi';

const CONTEXT = 'pictograph-chart';
const STAMPS = [
  { subtype: 'emoji:1f600', size: 32 },
  { subtype: 'sticker:1f602', size: 48 },
  { subtype: 'icon:arrow-up', size: 28 },
];
const cleanups: Array<() => void> = [];

async function harness(options: { manager?: DrawingManager; contextId?: string; symbol?: string; timeframe?: string; account?: string } = {}) {
  const container = document.createElement('div');
  Object.defineProperties(container, { clientWidth: { value: 500 }, clientHeight: { value: 300 } });
  document.body.appendChild(container);
  const viewport = { xOffset: 0, xScale: 1, yOffset: 0, yScale: 1, future: false };
  const timeScale = {
    timeToCoordinate: (time: number) => viewport.future ? null : (time - 100) * viewport.xScale + viewport.xOffset,
    coordinateToTime: (x: number) => viewport.future ? null : (x - viewport.xOffset) / viewport.xScale + 100,
    logicalToCoordinate: (logical: number) => logical * viewport.xScale + viewport.xOffset,
    coordinateToLogical: (x: number) => (x - viewport.xOffset) / viewport.xScale,
    height: () => 20,
  };
  const chart = { timeScale: () => timeScale, priceScale: () => ({ width: () => 40 }) } as unknown as IChartApi;
  const series = {
    priceToCoordinate: (price: number) => (220 - price) * viewport.yScale + viewport.yOffset,
    coordinateToPrice: (y: number) => 220 - (y - viewport.yOffset) / viewport.yScale,
    options: () => ({ priceFormat: { precision: 3, minMove: .001 } }),
    priceFormatter: () => ({ format: (price: number) => price.toFixed(3) }),
  } as unknown as ISeriesApi<'Candlestick'>;
  const manager = options.manager ?? new DrawingManager();
  const contextId = options.contextId ?? CONTEXT;
  manager.setChart(chart, series, options.symbol ?? 'TEST', 1, container, options.timeframe ?? 'M1', contextId, options.account ?? 'account-test');
  cleanups.push(() => manager.setChart(null, null, null, 1, container));
  await Promise.resolve();
  return { manager, container, viewport, contextId };
}

function place(manager: DrawingManager, subtype = STAMPS[0].subtype, contextId = CONTEXT) {
  const id = manager.startDrawing('stamp', '#2962ff', { subtype });
  expect(manager.addPoint(160, 110, undefined, contextId)).toBe(true);
  return id;
}

const stampGroup = (container: HTMLElement) => container.querySelector('[data-geometry-role="pictograph-stamp"]');
const hitTarget = (container: HTMLElement) => container.querySelector('[data-geometry-role="pictograph-hit-target"]')!;
const drag = (container: HTMLElement) => {
  hitTarget(container).dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 60, clientY: 110 }));
  window.dispatchEvent(new MouseEvent('pointermove', { clientX: 85, clientY: 125 }));
  window.dispatchEvent(new MouseEvent('pointerup'));
};

beforeEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
});
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); });

describe('pictograph chart stamps', () => {
  it.each(STAMPS)('previews and places $subtype once using its bundled artwork', async ({ subtype, size }) => {
    const { manager, container } = await harness();
    const saved = vi.fn();
    window.addEventListener('drawing:saved', saved);
    const id = manager.startDrawing('stamp', '#2962ff', { subtype });
    expect(usesDirectDrawingPointerInput(manager.getActiveDrawing())).toBe(true);
    manager.updatePreviewPoint(160, 110, CONTEXT);
    const preview = stampGroup(container)!;
    expect(preview.getAttribute('pointer-events')).toBe('none');
    expect(preview.querySelector('[data-geometry-role="pictograph-hit-target"]')).toBeNull();
    expect(preview.querySelector('image')?.getAttribute('href')).toBe(getPictographStamp(subtype)!.assetUrl);
    expect(manager.getDrawings()).toHaveLength(0);
    expect(manager.addPoint(160, 110, undefined, CONTEXT)).toBe(true);
    expect(manager.addPoint(160, 110, undefined, CONTEXT)).toBe(false);
    expect(manager.getDrawings()).toMatchObject([{ id, type: 'stamp', subtype, points: [{ time: 160, price: 110 }] }]);
    expect(manager.getActiveDrawing()).toBeNull();
    expect(container.querySelectorAll('image')).toHaveLength(1);
    expect(container.querySelector('image')?.getAttribute('width')).toBe(String(size));
    expect(hitTarget(container).getAttribute('width')).toBe(String(size + 8));
    expect(container.querySelector('[data-geometry-role="selection-anchor-1"]')).toBeNull();
    expect(saved).toHaveBeenCalledOnce();
    expect(drawingApi.saveDrawing).toHaveBeenCalledOnce();
    expect(drawingApi.saveDrawing).toHaveBeenCalledWith(expect.objectContaining({ id, type: 'stamp', subtype }), 'TEST');
    window.removeEventListener('drawing:saved', saved);
  });

  it.each(STAMPS)('keeps $subtype pinned to candle time/price while pan and zoom preserve its visual size', async ({ subtype, size }) => {
    const { manager, container, viewport } = await harness();
    place(manager, subtype);
    const points = structuredClone(manager.getDrawings()[0].points);
    expect(stampGroup(container)?.getAttribute('transform')).toBe(`translate(${60 - size / 2}, ${110 - size / 2})`);
    Object.assign(viewport, { xOffset: 45, xScale: 2, yOffset: 10, yScale: .5 });
    manager.renderContext(container);
    expect(stampGroup(container)?.getAttribute('transform')).toBe(`translate(${165 - size / 2}, ${65 - size / 2})`);
    expect(container.querySelector('image')?.getAttribute('width')).toBe(String(size));
    expect(manager.getDrawings()[0].points).toEqual(points);
  });

  it('projects a future fractional anchor and keeps candle time authoritative when data arrives', async () => {
    const { manager, container, viewport } = await harness();
    viewport.future = true;
    manager.startDrawing('stamp', '#2962ff', { subtype: STAMPS[0].subtype });
    manager.addPoint(160, 110, undefined, CONTEXT, 80.5);
    expect(stampGroup(container)?.getAttribute('transform')).toBe('translate(64.5, 94)');
    viewport.future = false;
    manager.renderContext(container);
    expect(stampGroup(container)?.getAttribute('transform')).toBe('translate(44, 94)');
  });

  it('drags the whole stamp, saves its new anchor, and supports undo/redo', async () => {
    const { manager, container } = await harness();
    place(manager);
    const original = structuredClone(manager.getDrawings()[0].points);
    drag(container);
    expect(manager.getDrawings()[0].points[0]).toMatchObject({ time: 185, price: 95 });
    expect(stampGroup(container)?.getAttribute('transform')).toBe('translate(69, 109)');
    manager.undo();
    expect(manager.getDrawings()[0].points).toEqual(original);
    manager.redo();
    expect(manager.getDrawings()[0].points[0]).toMatchObject({ time: 185, price: 95 });
    const restored = await harness();
    expect(restored.manager.getDrawings()[0].points[0]).toMatchObject({ time: 185, price: 95 });
    expect(restored.container.querySelector('image')?.getAttribute('href')).toBe(getPictographStamp(STAMPS[0].subtype)!.assetUrl);
  });

  it('locks movement while retaining selection, context menu, visibility and delete controls', async () => {
    const { manager, container } = await harness();
    const id = place(manager);
    manager.setAllDrawingsLocked(true, CONTEXT);
    manager.unselectAll(CONTEXT);
    const original = structuredClone(manager.getDrawings()[0].points);
    drag(container);
    expect(manager.getDrawings()[0].points).toEqual(original);
    expect((hitTarget(container) as SVGElement).style.cursor).toBe('default');
    hitTarget(container).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(manager.getDrawings()[0].selected).toBe(true);
    expect(container.querySelector('[data-geometry-role="pictograph-selection"]')).not.toBeNull();
    const contextMenu = vi.fn();
    window.addEventListener('drawing:contextmenu', contextMenu);
    hitTarget(container).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 110 }));
    expect(contextMenu).toHaveBeenCalledOnce();
    expect(contextMenu.mock.calls[0][0].detail).toMatchObject({ drawingId: id, contextId: CONTEXT });
    window.removeEventListener('drawing:contextmenu', contextMenu);
    manager.setDrawingsVisible(CONTEXT, false);
    expect(stampGroup(container)).toBeNull();
    expect(manager.getDrawings()).toHaveLength(1);
    manager.setDrawingsVisible(CONTEXT, true);
    expect(stampGroup(container)).not.toBeNull();
    manager.deleteDrawing(id, CONTEXT);
    expect(manager.getDrawings()).toHaveLength(0);
    expect(stampGroup(container)).toBeNull();
    manager.undo();
    expect(manager.getDrawings()[0]).toMatchObject({ id, locked: true, subtype: STAMPS[0].subtype });
  });

  it('cancels an unplaced preview without saving an object', async () => {
    const { manager, container } = await harness();
    manager.startDrawing('stamp', '#2962ff', { subtype: STAMPS[0].subtype });
    manager.updatePreviewPoint(160, 110, CONTEXT);
    expect(stampGroup(container)).not.toBeNull();
    manager.cancelDrawing();
    expect(stampGroup(container)).toBeNull();
    expect(manager.getDrawings()).toHaveLength(0);
    expect(drawingApi.saveDrawing).not.toHaveBeenCalled();
  });

  it('keeps persisted stamps isolated by account, symbol and timeframe', async () => {
    const { manager } = await harness();
    place(manager, STAMPS[1].subtype);
    for (const scope of [{ account: 'other-account' }, { symbol: 'OTHER' }, { timeframe: 'H1' }]) {
      const isolated = await harness(scope);
      expect(isolated.manager.getDrawings()).toHaveLength(0);
      expect(stampGroup(isolated.container)).toBeNull();
    }
    const restored = await harness();
    expect(restored.manager.getDrawings()[0]).toMatchObject({ type: 'stamp', subtype: STAMPS[1].subtype });
    expect(stampGroup(restored.container)).not.toBeNull();
  });

  it('rejects unknown or executable asset IDs and ignores arbitrary saved image content', async () => {
    const { manager, container } = await harness();
    for (const subtype of ['emoji:javascript:alert(1)', 'sticker:https://example.test/image.svg', 'icon:missing']) {
      manager.startDrawing('stamp', '#2962ff', { subtype });
      expect(usesDirectDrawingPointerInput(manager.getActiveDrawing())).toBe(false);
      manager.updateActiveDrawing({ text: '<svg onload="alert(1)">', annotation: { imageUrl: 'https://example.test/image.svg' } });
      manager.addPoint(160, 110, undefined, CONTEXT);
    }
    expect(container.querySelectorAll('image')).toHaveLength(0);
    expect(container.querySelector('script')).toBeNull();
    place(manager);
    expect(container.querySelectorAll('image')).toHaveLength(1);
    expect(container.querySelector('image')?.getAttribute('href')).toBe(getPictographStamp(STAMPS[0].subtype)!.assetUrl);
  });

  it('retains the existing legacy stamp renderer and arrow deletion semantics', async () => {
    const { manager, container } = await harness();
    const pictographId = place(manager);
    place(manager, 'arrowUp');
    expect(container.querySelector('path')).not.toBeNull();
    expect(manager.deleteArrows(CONTEXT)).toBe(1);
    expect(manager.getDrawings()).toMatchObject([{ id: pictographId, subtype: STAMPS[0].subtype }]);
    expect(stampGroup(container)).not.toBeNull();
  });
});
