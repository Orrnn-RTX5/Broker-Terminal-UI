// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { projectDrawingTimeAtLogical } from '../drawing-tools/geometry/drawingTimeProjection';
import { CANDLE_TIMEFRAMES, getTimeframeSeconds } from '../utils/timeframeBoundary';
import { CHART_PATTERN_TOOLS } from '../drawing-tools/chartPatternToolCatalog';
import { TREND_LINE_TOOLS } from '../drawing-tools/toolCatalog';
import { GANN_FIBONACCI_TOOLS } from '../drawing-tools/gannFibonacciToolCatalog';
import { FORECASTING_MEASUREMENT_TOOLS } from '../drawing-tools/forecastingMeasurementToolCatalog';
import { usesDirectDrawingPointerInput } from '../drawing-tools/drawingInteractionPriority';

vi.mock('../services/drawingApi', () => ({
  drawingApi: {
    loadDrawings: vi.fn().mockResolvedValue([]),
    saveDrawing: vi.fn().mockResolvedValue('drawing-lifecycle'),
    deleteDrawing: vi.fn().mockResolvedValue(undefined),
  },
}));

import { DrawingManager } from '../services/drawingManager';

const chartFacadeSource = readFileSync(
  resolve(process.cwd(), 'src/components/TradingChart.tsx'),
  'utf8',
);
const source = readFileSync(
  resolve(process.cwd(), 'src/features/trading-chart/runtime/useTradingChartReconfiguration.ts'),
  'utf8',
);

// Execute the production listener declarations without mounting the chart's
// unrelated broker/feed effects. These same function instances stay registered
// when TradingChart's symbol/timeframe fast path retains its existing series.
const getRetainedListenerSource = () => {
  const parsed = ts.createSourceFile('TradingChart.tsx', chartFacadeSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let binder = '';
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === 'bindDrawingManagerToChart') {
      binder = `const ${node.getText(parsed)};`;
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  if (!binder) throw new Error('Drawing binder was not found');

  const start = source.indexOf('let isDrawingContinuous = false;');
  const end = source.indexOf('const drawingOverlayContainer = overlayRef.current;', start);
  if (start < 0 || end < start) throw new Error('Retained drawing listener block was not found');
  const block = ts.createSourceFile('listeners.ts', source.slice(start, end), ts.ScriptTarget.Latest, true);
  const declarations = block.statements
    .filter(ts.isVariableStatement)
    .map(statement => statement.getText(block))
    .join('\n');
  return ts.transpileModule(`${binder}\n${declarations}\nreturn {
    bindDrawingManagerToChart, clickHandler, crosshairHandler,
    handlePointerDown, handlePointerUp, handlePointerCancel,
    handleDrawingShiftChange, handleGhostFeedClickCapture, handleDrawingPointerMove, handleDrawingPointerLeave,
  };`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
};

const retainedListenerSource = getRetainedListenerSource();

const createFixture = async () => {
  const baseTime = 1_788_761_400;
  const bars = Array.from({ length: 20 }, (_, index) => ({
    time: baseTime + index * 60, open: 100, high: 110, low: 90, close: 105,
  }));
  const timeScale = {
    // Match installed lightweight-charts: fractional logicalToCoordinate input
    // returns zero; public coordinateToLogical returns an integer bar index.
    logicalToCoordinate: (logical: number) => Number.isInteger(logical) ? logical * 20 : 0,
    coordinateToLogical: (x: number) => Math.ceil(x / 20 - .5),
    coordinateToTime: (x: number) => bars[Math.ceil(x / 20 - .5)]?.time ?? null,
    timeToIndex: (time: number) => {
      const index = bars.findIndex(bar => bar.time === time);
      return index < 0 ? null : index;
    },
    timeToCoordinate: (time: number) => {
      const index = bars.findIndex(bar => bar.time === time);
      return index < 0 ? null : index * 20;
    },
    height: () => 20,
  };
  const series = {
    dataByIndex: () => bars.at(-1),
    priceToCoordinate: (price: number) => 300 - price,
    coordinateToPrice: (y: number) => 300 - y,
    options: () => ({ priceFormat: { precision: 2, minMove: .01 } }),
    priceFormatter: () => ({ format: (price: number) => price.toFixed(2) }),
  };
  const chart = { timeScale: () => timeScale, priceScale: () => ({ width: () => 40 }) };
  const container = document.createElement('div');
  Object.defineProperty(container, 'clientWidth', { value: 600 });
  Object.defineProperty(container, 'clientHeight', { value: 400 });
  document.body.appendChild(container);
  const manager = new DrawingManager();
  const drawingRuntimeContextRef = { current: {
    contextId: 'chart-main', symbol: 'XAUUSD', timeframe: 'M5', accountScope: 'account-main',
  } };
  const drawingCommandTargetRef = { current: 'chart-main' as string | null };
  const activeToolRef = { current: 'trendline' as string | null };
  const dependencies = {
    chart, chartRef: { current: chart }, seriesRef: { current: series },
    overlayRef: { current: container }, containerRef: { current: container },
    drawingManager: manager, drawingRuntimeContextRef, drawingCommandTargetRef, activeToolRef,
    // Keep the original lexical values stale, exactly as the retained M5
    // handlers experience after switching the chart's current metadata to M1.
    symbol: 'XAUUSD', timeframe: 'M5', activeChartSourceId: 'chart-main',
    chartExportMetadataRef: { current: { symbol: 'XAUUSD', timeframe: 'M5' } },
    getDrawingSeriesData: () => bars,
    useCallback: (callback: unknown) => callback,
    projectDrawingTimeAtLogical, getTimeframeSeconds, usesDirectDrawingPointerInput,
    setTextInputOverlay: vi.fn(), setTextInputValue: vi.fn(),
  };
  const listeners = new Function(...Object.keys(dependencies), retainedListenerSource)(...Object.values(dependencies));
  listeners.bindDrawingManagerToChart();
  await Promise.resolve();
  const switchContext = async (changes: Partial<typeof drawingRuntimeContextRef.current>) => {
    drawingRuntimeContextRef.current = { ...drawingRuntimeContextRef.current, ...changes };
    if (changes.timeframe) {
      const seconds = getTimeframeSeconds(changes.timeframe as Parameters<typeof getTimeframeSeconds>[0]);
      bars.forEach((bar, index) => { bar.time = baseTime + index * seconds; });
    }
    drawingCommandTargetRef.current = drawingRuntimeContextRef.current.contextId;
    listeners.bindDrawingManagerToChart();
    await Promise.resolve();
  };
  const click = (x: number, y: number) => listeners.clickHandler({
    point: { x, y }, time: timeScale.coordinateToTime(x), sourceEvent: { shiftKey: false },
  });
  const preview = (x: number, y: number) => {
    const active = manager.getActiveDrawing(drawingRuntimeContextRef.current.contextId);
    if (usesDirectDrawingPointerInput(active)) {
      listeners.handleDrawingPointerMove({ pointerType: 'mouse', clientX: x, clientY: y, shiftKey: false });
    } else {
      listeners.crosshairHandler({ point: { x, y }, time: timeScale.coordinateToTime(x), sourceEvent: { shiftKey: false } });
    }
  };
  return { bars, chart, manager, container, listeners, switchContext, click, preview, drawingRuntimeContextRef, drawingCommandTargetRef, activeToolRef };
};

describe('retained drawing listeners after chart context changes', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    localStorage.clear();
    sessionStorage.clear();
  });

  const patternSymbols = ['XAUUSD', 'EURUSD', 'BTCUSD', '0168.HK', 'CUSTOM.US-PERP'];
  const patternContexts = CANDLE_TIMEFRAMES.flatMap((timeframe, index) =>
    CHART_PATTERN_TOOLS.map(tool => ({ timeframe, symbol: patternSymbols[index % patternSymbols.length], tool })));

  it.each(patternContexts)('$tool.label places and restores on $symbol $timeframe after switching the active chart', async ({ timeframe, symbol, tool }) => {
    const { manager, bars, listeners, switchContext, preview, container } = await createFixture();
    await switchContext({ timeframe, symbol });
    manager.startDrawing('pattern', '#2962ff', { subtype: tool.id });
    const anchors = Array.from({ length: tool.requiredPoints }, (_, i) => [80 + i * 40, i % 2 ? 120 : 240]);
    // The final anchor is in future chart space, where interval projection matters.
    anchors[anchors.length - 1][0] = 455;
    for (const [index, [x, y]] of anchors.entries()) {
      listeners.handlePointerDown({ isPrimary: true, button: 0, pointerType: 'mouse', pointerId: 1,
        clientX: x, clientY: y, preventDefault: vi.fn() });
      listeners.handlePointerUp({ pointerId: 1 });
      if (index < anchors.length - 1) {
        expect(manager.getActiveDrawing('chart-main')?.points).toHaveLength(index + 1);
        preview(...anchors[index + 1] as [number, number]);
        expect(container.querySelector('g[data-id$="-preview"]')).not.toBeNull();
      }
    }
    const drawing = manager.getDrawings('chart-main')[0];
    expect(drawing).toMatchObject({ type: 'pattern', subtype: tool.id });
    expect(drawing.points.at(-1)).toMatchObject({
      time: bars.at(-1)!.time + 3.75 * getTimeframeSeconds(timeframe), logicalIndex: 22.75,
    });
    expect(container.querySelector(`g[data-id="${drawing.id}"] path`)).not.toBeNull();
    expect(container.querySelector('svg')!.innerHTML).not.toMatch(/NaN|Infinity/);
    expect(localStorage.getItem(`drawings-account-main-${symbol}-${timeframe}`)).toContain(tool.id);
    await switchContext({ symbol: `${symbol}-OTHER` });
    expect(manager.getDrawings('chart-main')).toHaveLength(0);
    expect(container.querySelector(`g[data-id="${drawing.id}"]`)).toBeNull();
    await switchContext({ symbol, timeframe: timeframe === 'H4' ? 'M1' : 'H4' });
    expect(manager.getDrawings('chart-main')).toHaveLength(0);
    await switchContext({ timeframe });
    expect(manager.getDrawings('chart-main')[0]).toMatchObject({ id: drawing.id, points: drawing.points });
    expect(container.querySelector(`g[data-id="${drawing.id}"] path`)).not.toBeNull();
    manager.setChart(null, null, null, 1, container);
  });

  it('hides the pitchfork cursor value at chart boundaries and restores it on reentry', async () => {
    const { manager, container, listeners, preview, click } = await createFixture();
    manager.startDrawing('channel', '#2962ff', { subtype: 'pitchfork' });
    click(160, 200);
    preview(220, 180);
    const cursor = () => container.querySelector('[data-geometry-role="cursor-price-scale-label"]');
    expect(cursor()).not.toBeNull();
    preview(580, 180); // Right price scale, outside the 560px plot.
    expect(cursor()).toBeNull();
    preview(240, 160);
    expect(cursor()).not.toBeNull();
    listeners.handleDrawingPointerLeave();
    expect(cursor()).toBeNull();
    expect(manager.getActiveDrawing()?.points).toHaveLength(1);
    preview(260, 140);
    expect(cursor()).not.toBeNull();
    expect(container.querySelector('[data-geometry-role="construction-anchor-1"]')).not.toBeNull();
  });

  it('keeps the mouse preview price visible when the chart resets its hidden native crosshair', async () => {
    const { manager, container, listeners, preview } = await createFixture();
    manager.startDrawing('channel', '#2962ff', { subtype: 'pitchfork' });
    preview(160, 200);
    const cursor = () => container.querySelector('[data-geometry-role="cursor-price-scale-label"]');
    expect(cursor()).not.toBeNull();
    // Lightweight Charts can clear its own hidden crosshair after the raw
    // pointer already placed a preview. This is not a DOM pointerleave.
    listeners.crosshairHandler({});
    expect(cursor()).not.toBeNull();
    listeners.handleDrawingPointerLeave();
    expect(cursor()).toBeNull();

    // Touch retains native chart event ownership, including its leave event.
    listeners.handlePointerDown({ pointerType: 'touch', button: 0, isPrimary: true });
    listeners.crosshairHandler({ point: { x: 160, y: 200 }, time: 1_788_761_400 });
    expect(cursor()).not.toBeNull();
    listeners.crosshairHandler({});
    expect(cursor()).toBeNull();
  });

  it.each([...TREND_LINE_TOOLS, ...GANN_FIBONACCI_TOOLS,
    ...FORECASTING_MEASUREMENT_TOOLS.filter(tool => tool.requiredPoints > 0)])('$label records mouse presses even when movement prevents a native click', async tool => {
    const { manager, listeners, preview, click, container, activeToolRef } = await createFixture();
    manager.startDrawing(tool.drawingType, '#2962ff', { subtype: tool.id });
    const anchors = [[80, 180], [260, 200], [200, 260]];
    for (let index = 0; index < tool.requiredPoints; index += 1) {
      const [x, y] = anchors[index];
      const event = {
        isPrimary: true, button: 0, pointerType: 'mouse', pointerId: 1,
        clientX: x, clientY: y, preventDefault: vi.fn(),
      };
      listeners.handlePointerDown(event);
      expect(event.preventDefault).toHaveBeenCalledOnce();
      if (index + 1 < tool.requiredPoints) {
        expect(manager.getActiveDrawing('chart-main')!.points).toHaveLength(index + 1);
        preview(x + 40, y + 10);
        expect(container.querySelector('[data-id$="-preview"]')).not.toBeNull();
        // Moving while held suppresses the library click: no click callback.
        listeners.handlePointerUp({ pointerId: 1 });
      }
    }
    expect(manager.getDrawings('chart-main')).toHaveLength(1);
    expect(manager.getDrawings('chart-main')[0].points).toHaveLength(tool.requiredPoints);
    expect(manager.getDrawings('chart-main')[0].selected).toBe(true);
    activeToolRef.current = null;
    click(...anchors[tool.requiredPoints - 1] as [number, number]);
    expect(manager.getDrawings('chart-main')[0].selected).toBe(true);
  });

  it('does not double-place anchors when a normal mouse click follows the press', async () => {
    const { manager, listeners, click } = await createFixture();
    manager.startDrawing('trendline');
    listeners.handlePointerDown({ isPrimary: true, button: 0, pointerType: 'mouse', clientX: 80, clientY: 180, preventDefault: vi.fn() });
    click(80, 180);
    expect(manager.getActiveDrawing('chart-main')!.points).toHaveLength(1);
    expect(manager.getDrawings('chart-main')).toHaveLength(0);
  });

  it.each([
    { pointerType: 'touch', button: 0, clientX: 80, clientY: 180 },
    { pointerType: 'mouse', button: 2, clientX: 80, clientY: 180 },
    { pointerType: 'mouse', button: 0, clientX: 580, clientY: 180 },
    { pointerType: 'mouse', button: 0, clientX: 80, clientY: 390 },
  ])('leaves touch gestures, secondary buttons and chart axes to their existing handlers: %j', async event => {
    const { manager, listeners } = await createFixture();
    manager.startDrawing('trendline');
    const preventDefault = vi.fn();
    listeners.handlePointerDown({ isPrimary: true, ...event, preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();
    expect(manager.getActiveDrawing('chart-main')!.points).toHaveLength(0);
  });

  it.each(['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1', 'MN'] as const)(
    'keeps %s drawings visible and uses its interval after retaining the chart listeners', async timeframe => {
    const { bars, manager, container, switchContext, click, preview } = await createFixture();
    await switchContext({ timeframe });
    manager.startDrawing('trendline');
    click(80, 180);
    click(160, 200);
    const existingId = manager.getDrawings('chart-main')[0].id;

    manager.startDrawing('trendline', '#2962ff', { subtype: 'ray' });
    click(260, 200);
    preview(455, 250);
    expect(container.querySelector(`g[data-id="${existingId}"]`)).not.toBeNull();
    expect(container.querySelector('g[data-id$="-preview"]')).not.toBeNull();
    click(455, 250);

    const drawings = manager.getDrawings('chart-main');
    expect(drawings).toHaveLength(2);
    expect(drawings[1].points[1]).toMatchObject({
      time: bars.at(-1)!.time + 3.75 * getTimeframeSeconds(timeframe), logicalIndex: 22.75,
    });
    expect(container.querySelector(`g[data-id="${existingId}"]`)).not.toBeNull();
    expect(container.querySelectorAll('[data-geometry-role^="selection-anchor-"]')).toHaveLength(2);
    expect(Number(container.querySelector('[data-geometry-role="selection-anchor-2"]')!.getAttribute('cx'))).toBe(455);
    expect(localStorage.getItem(`drawings-account-main-XAUUSD-${timeframe}`)).toContain(drawings[1].id);
  });

  it('clears a completed selection on a blank-future canvas click without deleting the drawing', async () => {
    const { manager, container, switchContext, click, activeToolRef } = await createFixture();
    await switchContext({ timeframe: 'H4' });
    manager.startDrawing('trendline', '#2962ff', { subtype: 'info_line' });
    click(80, 180);
    click(160, 200);
    expect(container.querySelectorAll('[data-geometry-role^="selection-anchor-"]')).toHaveLength(2);
    activeToolRef.current = null;
    click(550, 250);
    expect(container.querySelectorAll('[data-geometry-role^="selection-anchor-"]')).toHaveLength(0);
    expect(container.querySelector('[data-geometry-role="info-line-panel"]')).not.toBeNull();
    expect(manager.getDrawings('chart-main')).toHaveLength(1);
  });

  it('uses current timeframe for freehand press, move, and completion', async () => {
    const { bars, manager, listeners, switchContext } = await createFixture();
    await switchContext({ timeframe: 'M1' });
    manager.startDrawing('freehand');
    listeners.handlePointerDown({ isPrimary: true, button: 0, pointerId: 7, clientX: 430, clientY: 210, preventDefault: vi.fn() });
    listeners.handleDrawingPointerMove({ pointerType: 'mouse', pointerId: 7, clientX: 450, clientY: 220 });
    listeners.handlePointerUp({ pointerId: 7 });
    const drawing = manager.getDrawings('chart-main')[0];
    expect(drawing.type).toBe('freehand');
    expect(drawing.points.map(point => point.time)).toEqual([bars.at(-1)!.time, bars.at(-1)!.time]);
    expect(drawing.points.map(point => point.barOffset)).toEqual([2.5, 3.5]);
  });

  it.each(FORECASTING_MEASUREMENT_TOOLS)('$label shows live cursor coordinates and keeps them until the pointer leaves', async tool => {
    const { manager, listeners, container, preview } = await createFixture();
    manager.startDrawing('measure', '#2962ff', { subtype: tool.id });
    preview(81, 180);
    const cursorPrice = () => container.querySelector('[data-geometry-role="cursor-price-scale-label-text"]');
    const cursorTime = () => container.querySelector('[data-geometry-role="cursor-time-scale-label"]');
    expect(cursorPrice()).not.toBeNull();
    expect(cursorTime()).not.toBeNull();
    const originalPrice = cursorPrice()!.textContent;
    preview(121, 160);
    expect(cursorPrice()!.textContent).not.toBe(originalPrice);
    listeners.crosshairHandler({});
    expect(cursorPrice()).not.toBeNull();
    listeners.handleDrawingPointerLeave();
    expect(cursorPrice()).toBeNull();
    expect(cursorTime()).toBeNull();
    preview(121, 160);
    expect(cursorPrice()).not.toBeNull();
    listeners.handlePointerDown({ isPrimary: true, button: 0, pointerType: 'mouse',
      clientX: 121, clientY: 160, preventDefault: vi.fn() });
    if (tool.requiredPoints !== 1) {
      expect(container.querySelector('[data-geometry-role="construction-anchor-1"]')).not.toBeNull();
    }
  });

  it('finishes Ghost Feed on double-click without recording a duplicate final mouse press', async () => {
    const { manager, listeners, click, container } = await createFixture();
    manager.startDrawing('measure', '#2962ff', { subtype: 'ghost_feed' });
    const press = (x: number, y: number) => {
      listeners.handlePointerDown({ isPrimary: true, button: 0, pointerType: 'mouse',
        clientX: x, clientY: y, preventDefault: vi.fn() });
      listeners.handlePointerUp({ pointerId: 1 });
      click(x, y);
    };
    press(81, 180);
    expect(manager.getActiveDrawing('chart-main')?.points).toHaveLength(1);
    expect(container.querySelector('[data-geometry-role="forecast-finish-hint"]')?.textContent).toContain('Enter');
    press(161, 160);
    press(241, 190);
    press(241, 190); // Second press arrives before native click.detail === 2.
    expect(manager.getActiveDrawing('chart-main')?.points).toHaveLength(3);
    listeners.handleGhostFeedClickCapture({ detail: 2 });
    expect(manager.getActiveDrawing('chart-main')).toBeNull();
    expect(manager.getDrawings('chart-main')[0].points).toHaveLength(3);
    expect(container.querySelector('[data-geometry-role="ghost-feed-path"]')).not.toBeNull();
  });

  it('finishes Ghost Feed with Enter and cancels unfinished measurements with Escape outside text inputs', async () => {
    const { manager, listeners, click } = await createFixture();
    manager.startDrawing('measure', '#2962ff', { subtype: 'ghost_feed' });
    click(81, 180);
    const enter = { type: 'keydown', key: 'Enter', target: document.body, preventDefault: vi.fn() };
    listeners.handleDrawingShiftChange(enter);
    expect(manager.getActiveDrawing('chart-main')).not.toBeNull(); // Requires two anchors.
    click(161, 160);
    listeners.handleDrawingShiftChange(enter);
    expect(manager.getActiveDrawing('chart-main')).toBeNull();
    expect(manager.getDrawings('chart-main')).toHaveLength(1);
    manager.startDrawing('measure', '#2962ff', { subtype: 'price_range' });
    click(81, 180);
    const escape = { type: 'keydown', key: 'Escape', target: document.createElement('input'), preventDefault: vi.fn() };
    listeners.handleDrawingShiftChange(escape);
    expect(manager.getActiveDrawing('chart-main')).not.toBeNull();
    listeners.handleDrawingShiftChange({ ...escape, target: document.body });
    expect(manager.getActiveDrawing('chart-main')).toBeNull();
    expect(manager.getDrawings('chart-main')).toHaveLength(1);
  });

  it('labels a future shape anchor with its projected chart time instead of the stored candle anchor', async () => {
    const { chart, bars, manager, listeners, container, switchContext } = await createFixture();
    await switchContext({ timeframe: 'M1' });
    Object.assign(chart, { options: () => ({ localization: { timeFormatter: (time: number) => `time:${time}` } }) });
    manager.startDrawing('shapes', '#2962ff', { subtype: 'arrow' });
    const press = { isPrimary: true, pointerType: 'mouse', button: 0, pointerId: 5, clientX: 81, clientY: 210, preventDefault: vi.fn() };
    listeners.handlePointerDown(press);
    listeners.handlePointerDown({ ...press, clientX: 450, clientY: 110 });
    const expected = bars.at(-1)!.time + 3.5 * 60;
    expect(container.querySelector('[data-geometry-role="shape-anchor-2-time-text"]')?.textContent).toBe(`time:${expected}`);
    expect(manager.getDrawings('chart-main')[0].points[1].time).toBe(bars.at(-1)!.time);
  });

  it('finishes only committed Path vertices with Enter and cancels a shape with Escape', async () => {
    const { manager, listeners, preview } = await createFixture();
    manager.startDrawing('shapes', '#2962ff', { subtype: 'path' });
    const press = { isPrimary: true, pointerType: 'mouse', button: 0, pointerId: 5, clientX: 81, clientY: 210, preventDefault: vi.fn() };
    listeners.handlePointerDown(press);
    listeners.handlePointerDown({ ...press, clientX: 200 });
    preview(300, 100);
    listeners.handleDrawingShiftChange(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(manager.getDrawings('chart-main')[0].points).toHaveLength(2);
    manager.startDrawing('shapes', '#2962ff', { subtype: 'triangle' });
    listeners.handlePointerDown(press);
    listeners.handleDrawingShiftChange(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(manager.getActiveDrawing()).toBeNull();
    expect(manager.getDrawings('chart-main')).toHaveLength(1);
  });

  it('captures Brush samples between candles, coalesced pen motion, and the release point', async () => {
    const { manager, listeners, container } = await createFixture();
    manager.startDrawing('freehand');
    const press = { isPrimary: true, pointerType: 'pen', button: 0, pointerId: 5, clientX: 81, clientY: 210, preventDefault: vi.fn() };
    listeners.handlePointerDown(press);
    listeners.handleDrawingPointerMove({ ...press, clientX: 86, clientY: 206,
      getCoalescedEvents: () => [{ clientX: 83, clientY: 208 }, { clientX: 85, clientY: 205 }] });
    listeners.crosshairHandler({ point: { x: 80, y: 200 }, time: 1 });
    listeners.handleDrawingPointerMove({ ...press, pointerId: 99, clientX: 180 });
    listeners.handlePointerUp({ ...press, type: 'pointerup', clientX: 87, clientY: 204 });
    const drawing = manager.getDrawings('chart-main')[0];
    expect(drawing.points).toHaveLength(5);
    expect(drawing.points.map(p => p.barOffset)).toEqual(expect.arrayContaining([.05, .15].map(n => expect.closeTo(n, 8))));
    expect(drawing.points.at(-1)?.price).toBe(96);
    expect(container.querySelector('[data-geometry-role="brush-stroke"]')?.getAttribute('d')).toContain('M81.00,210.00');
    expect(container.querySelectorAll('[data-geometry-role^="brush-endpoint-"]')).toHaveLength(2);
  });

  it('renders Highlighter with editable transparency and saves its subtype', async () => {
    const { manager, container } = await createFixture();
    manager.startDrawing('freehand', '#ffcc00', { subtype: 'highlighter' });
    manager.addFreehandPoint(81, 210, 'chart-main');
    manager.addFreehandPoint(122, 203, 'chart-main');
    const drawing = manager.finishDrawing('chart-main')!;
    const stroke = () => container.querySelector('[data-geometry-role="brush-stroke"]')!;
    expect(stroke().getAttribute('stroke-width')).toBe('20');
    expect(stroke().getAttribute('stroke-opacity')).toBe('0.3');
    manager.updateDrawingProperties(drawing.id, { fillOpacity: .65, lineWidth: 30 }, 'chart-main');
    expect(stroke().getAttribute('stroke-opacity')).toBe('0.65');
    expect(stroke().getAttribute('stroke-width')).toBe('30');
    const stored = JSON.parse(localStorage.getItem('drawings-account-main-XAUUSD-M5')!)[0];
    expect(stored.subtype).toBe('highlighter');
    expect(stored.fillOpacity).toBe(.65);
  });

  it.each(['arrow_marker', 'arrow', 'circle'])('places %s with two native presses and edits only the grabbed anchor', async subtype => {
    const { manager, listeners, container, preview } = await createFixture();
    manager.startDrawing('shapes', '#2962ff', { subtype });
    const press = { isPrimary: true, pointerType: 'mouse', button: 0, pointerId: 5, clientX: 81, clientY: 210, preventDefault: vi.fn() };
    listeners.handlePointerDown(press);
    preview(202, 110);
    expect(container.querySelector(`[data-geometry-role="${subtype}"]`)).not.toBeNull();
    expect(manager.getDrawings('chart-main')).toHaveLength(0);
    listeners.handlePointerDown({ ...press, clientX: 202, clientY: 110 });
    const drawing = manager.getDrawings('chart-main')[0];
    expect(drawing.points).toHaveLength(2);
    expect(drawing.points[0].barOffset).toBeCloseTo(.05);
    const tail = { ...drawing.points[0] };
    container.querySelector('[data-geometry-role="shape-anchor-2"]')!.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true, clientX: 202, clientY: 110, button: 0,
    }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 223, clientY: 90 }));
    window.dispatchEvent(new MouseEvent('pointerup'));
    expect(drawing.points[0]).toEqual(tail);
    expect(drawing.points[1].price).toBe(210);
    expect(container.querySelector(`[data-geometry-role="${subtype}"]`)?.getAttribute('d')).toContain('223,90');
    manager.undo('chart-main');
    expect(manager.getDrawings('chart-main')[0].points[1].price).toBe(190);
  });

  it('creates Double curve with two independently editable bends after two presses', async () => {
    const { manager, listeners, container } = await createFixture();
    manager.startDrawing('shapes', '#2962ff', { subtype: 'double_curve' });
    const press = { isPrimary: true, pointerType: 'mouse', button: 0, pointerId: 5, clientX: 80, clientY: 210, preventDefault: vi.fn() };
    listeners.handlePointerDown(press);
    listeners.handlePointerDown({ ...press, clientX: 240 });
    const drawing = manager.getDrawings('chart-main')[0];
    expect(drawing.points).toHaveLength(4);
    const untouched = [drawing.points[0], drawing.points[1], drawing.points[3]].map(p => ({ ...p }));
    container.querySelector('[data-geometry-role="shape-anchor-3"]')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 96, clientY: 120 }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 130, clientY: 90 }));
    window.dispatchEvent(new MouseEvent('pointerup'));
    expect([drawing.points[0], drawing.points[1], drawing.points[3]]).toEqual(untouched);
    expect(drawing.points[2].price).toBe(210);
    expect(container.querySelector('[data-geometry-role="double_curve"]')?.getAttribute('d')).not.toMatch(/NaN|Infinity/);
  });

  it('creates Curve after two presses with a freely movable bend', async () => {
    const { manager, listeners, container } = await createFixture();
    manager.startDrawing('shapes', '#2962ff', { subtype: 'curve' });
    const press = { isPrimary: true, pointerType: 'mouse', button: 0, pointerId: 5, clientX: 80, clientY: 210, preventDefault: vi.fn() };
    listeners.handlePointerDown(press);
    listeners.handlePointerDown({ ...press, clientX: 240 });
    const drawing = manager.getDrawings('chart-main')[0];
    expect(drawing.points).toHaveLength(3);
    const endpoints = drawing.points.slice(0, 2).map(p => ({ ...p }));
    container.querySelector('[data-geometry-role="shape-anchor-3"]')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 160, clientY: 234 }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 190, clientY: 110 }));
    window.dispatchEvent(new MouseEvent('pointerup'));
    expect(drawing.points.slice(0, 2)).toEqual(endpoints);
    expect(drawing.points[2].logicalIndex).toBe(9.5);
    expect(container.querySelector('[data-geometry-role="curve"]')?.getAttribute('d')).toBe('M80,210 Q220,10 240,210');
  });

  it('constrains Arc bend to the perpendicular midpoint and preserves its endpoints', async () => {
    const { manager, listeners, container } = await createFixture();
    manager.startDrawing('shapes', '#2962ff', { subtype: 'arc' });
    const press = { isPrimary: true, pointerType: 'mouse', button: 0, pointerId: 5, clientX: 80, clientY: 210, preventDefault: vi.fn() };
    listeners.handlePointerDown(press);
    listeners.handlePointerDown({ ...press, clientX: 240 });
    listeners.handlePointerDown({ ...press, clientX: 190, clientY: 110 });
    const drawing = manager.getDrawings('chart-main')[0];
    expect(drawing.points[2].logicalIndex).toBe(8);
    const endpoints = drawing.points.slice(0, 2).map(p => ({ ...p }));
    container.querySelector('[data-geometry-role="shape-anchor-3"]')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 160, clientY: 110 }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 190, clientY: 90 }));
    window.dispatchEvent(new MouseEvent('pointerup'));
    expect(drawing.points.slice(0, 2)).toEqual(endpoints);
    expect(drawing.points[2].logicalIndex).toBe(8);
    expect(container.querySelector('[data-geometry-role="arc"]')?.getAttribute('d')).toBe('M80,210 Q160,-30 240,210');
  });

  it('places Triangle with three independently editable vertices', async () => {
    const { manager, listeners, container } = await createFixture();
    manager.startDrawing('shapes', '#2962ff', { subtype: 'triangle' });
    const press = { isPrimary: true, pointerType: 'mouse', button: 0, pointerId: 5, clientX: 80, clientY: 210, preventDefault: vi.fn() };
    listeners.handlePointerDown(press);
    listeners.handlePointerDown({ ...press, clientX: 240 });
    listeners.handlePointerDown({ ...press, clientX: 160, clientY: 110 });
    const drawing = manager.getDrawings('chart-main')[0];
    const base = drawing.points.slice(0, 2).map(p => ({ ...p }));
    container.querySelector('[data-geometry-role="shape-anchor-3"]')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 160, clientY: 110 }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 180, clientY: 80 }));
    window.dispatchEvent(new MouseEvent('pointerup'));
    expect(drawing.points.slice(0, 2)).toEqual(base);
    expect(container.querySelector('[data-geometry-role="triangle"]')?.getAttribute('d')).toBe('M80,210 L240,210 L180,80 Z');
  });

  it.each(['rotated_rectangle', 'ellipse'])('places %s using three native presses and edits its width', async subtype => {
    const { manager, listeners, container } = await createFixture();
    manager.startDrawing('shapes', '#2962ff', { subtype });
    const press = { isPrimary: true, pointerType: 'mouse', button: 0, pointerId: 5, clientX: 80, clientY: 150, preventDefault: vi.fn() };
    listeners.handlePointerDown(press);
    listeners.handlePointerDown({ ...press, clientX: 240 });
    expect(manager.getDrawings('chart-main')).toHaveLength(0);
    listeners.handlePointerDown({ ...press, clientX: 240, clientY: 210 });
    const drawing = manager.getDrawings('chart-main')[0];
    const axis = drawing.points.slice(0, 2).map(p => ({ ...p }));
    const role = subtype === 'ellipse' ? 'ellipse-width-0' : 'rotated-rectangle-width-1';
    container.querySelector(`[data-geometry-role="${role}"]`)!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 240, clientY: 210 }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 250, clientY: 230 }));
    window.dispatchEvent(new MouseEvent('pointerup'));
    expect(drawing.points.slice(0, 2)).toEqual(axis);
    expect(drawing.points[2].price).toBe(70);
    expect(container.querySelector(`[data-geometry-role="${subtype}"]`)?.getAttribute('d')).not.toMatch(/NaN|Infinity/);
  });

  it.each(['path', 'polyline'])('finishes %s on native double-click without adding a duplicate vertex', async subtype => {
    const { manager, listeners, container } = await createFixture();
    manager.startDrawing('shapes', '#2962ff', { subtype });
    const press = { isPrimary: true, pointerType: 'mouse', button: 0, pointerId: 5, clientX: 81, clientY: 210, preventDefault: vi.fn() };
    listeners.handlePointerDown(press);
    expect(manager.finishDrawing('chart-main')).toBeNull();
    listeners.handlePointerDown({ ...press, clientX: 140, clientY: 110 });
    listeners.handlePointerDown({ ...press, clientX: 240, clientY: 150 });
    listeners.handlePointerDown({ ...press, clientX: 240, clientY: 150 });
    expect(manager.getActiveDrawing()?.points).toHaveLength(3);
    listeners.handleGhostFeedClickCapture({ detail: 2 });
    expect(manager.getActiveDrawing()).toBeNull();
    expect(manager.getDrawings('chart-main')[0].points).toHaveLength(3);
    expect(container.querySelector(`[data-geometry-role="${subtype}"]`)?.getAttribute('d')).toContain('M81,210 L140,110 L240,150');
  });

  it('places Rectangle with eight handles and resizes only the chosen edge', async () => {
    const { manager, listeners, container } = await createFixture();
    manager.startDrawing('shapes', '#2962ff', { subtype: 'rectangle' });
    const press = { isPrimary: true, pointerType: 'mouse', button: 0, pointerId: 5, clientX: 81, clientY: 110, preventDefault: vi.fn() };
    listeners.handlePointerDown(press);
    listeners.handlePointerDown({ ...press, clientX: 202, clientY: 210 });
    const drawing = manager.getDrawings('chart-main')[0];
    expect(container.querySelectorAll('[data-geometry-role^="rectangle-handle-"]')).toHaveLength(8);
    expect(container.querySelector('[data-geometry-role="rectangle"]')?.getAttribute('fill-opacity')).toBe('0.2');
    const opposite = { ...drawing.points[1] };
    container.querySelector('[data-geometry-role="rectangle-handle-1"]')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 141, clientY: 110 }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 170, clientY: 80 }));
    window.dispatchEvent(new MouseEvent('pointerup'));
    expect(drawing.points[0].price).toBe(220);
    expect(drawing.points[0].logicalIndex).toBeCloseTo(4.05);
    expect(drawing.points[1]).toEqual(opposite);
    manager.undo('chart-main');
    expect(manager.getDrawings('chart-main')[0].points[0].price).toBe(190);
  });

  it.each(['arrow_mark_up', 'arrow_mark_down'])('places %s at its tip with one native press', async subtype => {
    const { manager, listeners, container } = await createFixture();
    manager.startDrawing('shapes', '#2962ff', { subtype });
    listeners.handlePointerDown({ isPrimary: true, pointerType: 'mouse', button: 0, pointerId: 5,
      clientX: 81, clientY: 210, preventDefault: vi.fn() });
    const drawing = manager.getDrawings('chart-main')[0];
    expect(drawing.points).toHaveLength(1);
    expect(drawing.color).toBe(subtype === 'arrow_mark_up' ? '#089981' : '#f23645');
    const marker = container.querySelector(`[data-geometry-role="${subtype}"]`)!;
    expect(marker.getAttribute('d')).toMatch(/^M81,210 /);
    expect(marker.getAttribute('d')).toContain(subtype === 'arrow_mark_up' ? 'V230' : 'V190');
    expect(manager.getActiveDrawing()).toBeNull();
  });

  it.each(CANDLE_TIMEFRAMES.flatMap(timeframe =>
    ['emoji:1f600', 'sticker:1f602', 'icon:arrow-up'].map(subtype => ({ timeframe, subtype }))))(
    'previews and places $subtype once on $timeframe using retained native listeners', async ({ timeframe, subtype }) => {
      const { manager, listeners, container, switchContext, preview, click, activeToolRef, bars } = await createFixture();
      await switchContext({ timeframe, symbol: 'TEST' });
      activeToolRef.current = 'stamp';
      manager.startDrawing('stamp', '#2962ff', { subtype });
      preview(80, 210);
      expect(container.querySelector('[data-geometry-role="pictograph-stamp"]')?.getAttribute('pointer-events')).toBe('none');
      listeners.handleDrawingPointerLeave();
      expect(container.querySelector('[data-geometry-role="pictograph-stamp"]')).toBeNull();
      expect(manager.getActiveDrawing()?.subtype).toBe(subtype);
      preview(80, 210);
      expect(container.querySelector('[data-geometry-role="pictograph-stamp"]')).not.toBeNull();
      const event = { isPrimary: true, pointerType: 'mouse', button: 0, pointerId: 5,
        clientX: 80, clientY: 210, preventDefault: vi.fn() };
      listeners.handlePointerDown(event);
      listeners.handlePointerUp(event);
      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(manager.getDrawings('chart-main')).toHaveLength(1);
      expect(manager.getDrawings('chart-main')[0]).toMatchObject({
        type: 'stamp', subtype, points: [{ time: bars[4].time, price: 90 }], selected: true,
      });
      expect(manager.getActiveDrawing()).toBeNull();
      activeToolRef.current = null;
      click(80, 210);
      expect(manager.getDrawings('chart-main')).toHaveLength(1);
      expect(manager.getDrawings('chart-main')[0].selected).toBe(true);
      expect(container.querySelectorAll('[data-geometry-role="pictograph-image"]')).toHaveLength(1);
    },
  );

  it('a cancelled Brush gesture cannot finish a replacement tool', async () => {
    const { manager, listeners } = await createFixture();
    manager.startDrawing('freehand');
    const press = { isPrimary: true, pointerType: 'mouse', button: 0, pointerId: 5, clientX: 81, clientY: 210, preventDefault: vi.fn() };
    listeners.handlePointerDown(press);
    manager.cancelDrawing('chart-main');
    manager.startDrawing('trendline');
    listeners.handlePointerUp(press);
    expect(manager.getActiveDrawing()?.type).toBe('trendline');
    expect(manager.getActiveDrawing()?.points).toHaveLength(0);
    expect(manager.getDrawings('chart-main')).toHaveLength(0);
  });

  it('moves a Brush as one object from its endpoint and persists fractional points and style', async () => {
    const { manager, container } = await createFixture();
    manager.startDrawing('freehand');
    for (const [x, y] of [[81, 210], [97, 230], [122, 203]]) manager.addFreehandPoint(x, y, 'chart-main');
    const drawing = manager.finishDrawing('chart-main')!;
    manager.updateDrawingProperties(drawing.id, { fillColor: '#aabbcc', fillOpacity: .35, lineStyle: 'dashed' }, 'chart-main');
    const points = JSON.parse(JSON.stringify(drawing.points));
    container.querySelector('[data-geometry-role="brush-endpoint-2"]')!.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true, clientX: 122, clientY: 203, button: 0,
    }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 135, clientY: 193 }));
    window.dispatchEvent(new MouseEvent('pointerup'));
    expect(drawing.points.map(point => point.price)).toEqual(points.map((point: { price: number }) => point.price + 10));
    expect(container.querySelector('[data-geometry-role="brush-stroke"]')?.getAttribute('d')).toContain('M94.00,200.00');
    expect(container.querySelector('[data-geometry-role="brush-stroke"]')?.getAttribute('fill')).toBe('#aabbcc');
    expect(container.querySelectorAll('[data-geometry-role^="brush-endpoint-"]')).toHaveLength(2);
    const stored = JSON.parse(localStorage.getItem('drawings-account-main-XAUUSD-M5')!)[0];
    expect(stored.points).toEqual(drawing.points);
    expect(stored.fillOpacity).toBe(.35);
    manager.undo('chart-main');
    expect(manager.getDrawings('chart-main')[0].points).toEqual(points);
  });

  it('Brush ignores scale presses and non-primary pointers, and cancels an interrupted stroke', async () => {
    const { manager, listeners } = await createFixture();
    manager.startDrawing('freehand');
    const press = { isPrimary: true, pointerType: 'mouse', button: 0, pointerId: 5, clientX: 580, clientY: 210, preventDefault: vi.fn() };
    listeners.handlePointerDown(press);
    listeners.handlePointerDown({ ...press, isPrimary: false, clientX: 100 });
    expect(manager.getActiveDrawing()?.points).toHaveLength(0);
    listeners.handlePointerDown({ ...press, clientX: 100 });
    listeners.handlePointerCancel({ pointerId: 9 });
    expect(manager.getActiveDrawing()?.points).toHaveLength(1);
    listeners.handlePointerCancel({ pointerId: 5 });
    expect(manager.getActiveDrawing()).toBeNull();
    expect(manager.getDrawings('chart-main')).toHaveLength(0);
  });

  it('targets the current symbol and owner while refusing a sibling command', async () => {
    const { manager, switchContext, click, preview, drawingCommandTargetRef } = await createFixture();
    await switchContext({ symbol: 'EURUSD', timeframe: 'M1', contextId: 'chart-current', accountScope: 'account-current' });
    manager.startDrawing('trendline');
    drawingCommandTargetRef.current = 'chart-sibling';
    click(80, 180);
    preview(160, 200);
    expect(manager.getActiveDrawing('chart-current')!.points).toHaveLength(0);

    drawingCommandTargetRef.current = 'chart-current';
    click(80, 180);
    click(160, 200);
    expect(manager.getDrawings('chart-current')).toHaveLength(1);
    expect(localStorage.getItem('drawings-account-current-EURUSD-M1')).toContain('trendline');
  });
});
