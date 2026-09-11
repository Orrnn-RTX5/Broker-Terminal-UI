// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TREND_LINE_TOOLS } from './toolCatalog';
import { GANN_FIBONACCI_TOOLS } from './gannFibonacciToolCatalog';
import { CHART_PATTERN_TOOLS } from './chartPatternToolCatalog';
import { FORECASTING_MEASUREMENT_TOOLS } from './forecastingMeasurementToolCatalog';
import { getPictographStamp } from './pictographCatalog';
import { isTrendDrawingInputActive, setTrendDrawingInputActive, usesDirectDrawingPointerInput } from './drawingInteractionPriority';

const source = readFileSync(resolve(process.cwd(), 'src/components/TradingChart.tsx'), 'utf8');
const parsed = ts.createSourceFile('TradingChart.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const callbacks: string[] = [];
const visit = (node: ts.Node) => {
  if (ts.isCallExpression(node) && node.expression.getText(parsed) === 'useEffect' && node.arguments[0]) {
    callbacks.push(node.arguments[0].getText(parsed));
  }
  ts.forEachChild(node, visit);
};
visit(parsed);
const commandEffect = callbacks.find(callback => callback.includes('SELECT_TOOL subscriber REGISTERED'))!;
const tradeEffect = callbacks.find(callback => callback.includes('const interactionRoot = container.parentElement ?? container;'))!;
const tradeParsed = ts.createSourceFile('trade.ts', `const install = ${tradeEffect};`, ts.ScriptTarget.Latest, true);
let tradePointerHandler = '';
const visitTrade = (node: ts.Node) => {
  if (ts.isVariableDeclaration(node) && node.name.getText(tradeParsed) === 'handlePointerDown') {
    tradePointerHandler = node.initializer!.getText(tradeParsed);
  }
  ts.forEachChild(node, visitTrade);
};
visitTrade(tradeParsed);

const execute = (code: string, dependencies: Record<string, unknown>) => {
  const javascript = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function(...Object.keys(dependencies), javascript)(...Object.values(dependencies));
};

const cleanups: Array<() => void> = [];
const makePanel = () => {
  const wrapper = document.createElement('div');
  wrapper.className = 'rtx-chart-wrapper';
  wrapper.innerHTML = `<div class="plot"><canvas></canvas></div><div class="overlay">
    <div class="rtx-trade-level-hit-area" style="pointer-events:auto"></div>
    <div class="rtx-trade-level-badge" style="pointer-events:auto"><button class="rtx-trade-control-btn" style="pointer-events:auto">Close</button></div>
    <div class="rtx-trade-marker-hover-target" style="pointer-events:auto"></div>
  </div>`;
  document.body.appendChild(wrapper);
  return { wrapper, container: wrapper.querySelector<HTMLElement>('.plot')! };
};

// Run the actual SELECT_TOOL effect, including its save/cancel listeners, so
// tests verify the production state transitions rather than duplicate them.
const installCommandLifecycle = (contextId: string) => {
  const { wrapper, container } = makePanel();
  let dispatch: (payload: { tool: string; subtype?: string; targetContextId?: string }) => void = () => undefined;
  let activeDrawing: { type: string; subtype?: string } | null = null;
  const activeToolRef = { current: null as string | null };
  const drawingCommandTargetRef = { current: null as string | null };
  const manager = {
    cancelDrawing: () => {
      if (!activeDrawing) return;
      activeDrawing = null;
      window.dispatchEvent(new CustomEvent('drawing:cancelled', { detail: { contextId } }));
    },
    unselectAll: vi.fn(),
    startDrawing: (type: string, _color: string, meta?: { subtype?: string }) => {
      activeDrawing = { type, subtype: meta?.subtype };
    },
    getActiveDrawing: () => activeDrawing,
    updateActiveDrawing: vi.fn(),
  };
  const cleanup = execute(`return (${commandEffect})();`, {
    drawingManager: manager, containerRef: { current: container },
    drawingRuntimeContextRef: { current: { contextId } }, activeToolRef, drawingCommandTargetRef,
    chartRef: { current: { applyOptions: vi.fn() } }, seriesRef: { current: {} }, crosshairEnabledRef: { current: false },
    getActiveChartSource: () => ({ id: contextId }), bindDrawingManagerToChart: () => true,
    setTextInputOverlay: vi.fn(), resolveTrendToolColor: () => '#2962ff',
    usesDirectDrawingPointerInput, setTrendDrawingInputActive,
    TRADING_VIEW_HANDLE_SCROLL: {}, TRADING_VIEW_HANDLE_SCALE: {},
    DRAWING_LOCK_HANDLE_SCROLL: {}, DRAWING_LOCK_HANDLE_SCALE: {},
    commandBus: {
      subscribe: (_type: string, listener: typeof dispatch) => { dispatch = listener; return () => undefined; },
      dispatch: (command: { payload: Parameters<typeof dispatch>[0] }) => dispatch(command.payload),
    },
  });
  cleanups.push(cleanup);
  return { wrapper, container, manager, activeToolRef, drawingCommandTargetRef, dispatch, cleanup };
};

beforeEach(() => {
  document.body.replaceChildren();
});
afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup());
});

describe('trend drawing input priority', () => {
  it.each(['freehand', 'trendline', 'stamp'])('restores desktop cursor interaction after %s completes without deselecting it', type => {
    const previous = window.electron;
    Object.defineProperty(window, 'electron', { configurable: true, value: { window: {} } });
    try {
      const panel = installCommandLifecycle('desktop-chart');
      panel.dispatch({ tool: type, targetContextId: 'desktop-chart' });
      window.dispatchEvent(new CustomEvent('drawing:saved', { detail: { contextId: 'desktop-chart', type } }));
      expect(panel.activeToolRef.current).toBeNull();
      expect(panel.drawingCommandTargetRef.current).toBeNull();
      expect(panel.container.style.touchAction).toBe('');
      expect(panel.container.style.cursor).toBe('default');
      expect(isTrendDrawingInputActive(panel.container)).toBe(false);
      expect(panel.manager.unselectAll).not.toHaveBeenCalled();
      expect(panel.manager.updateActiveDrawing).not.toHaveBeenCalled();
      panel.dispatch({ tool: type, targetContextId: 'desktop-chart' });
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(panel.activeToolRef.current).toBeNull();
      expect(panel.manager.getActiveDrawing()).toBeNull();
    } finally {
      Object.defineProperty(window, 'electron', { configurable: true, value: previous });
    }
  });

  it.each([undefined, 'highlighter'])('keeps freehand %s armed after release with its styles, and Escape restores cursor input', subtype => {
    const panel = installCommandLifecycle('chart-brush');
    panel.dispatch({ tool: 'freehand', subtype, targetContextId: 'chart-brush' });
    expect(isTrendDrawingInputActive(panel.container)).toBe(true);
    expect(panel.container.style.touchAction).toBe('none');
    window.dispatchEvent(new CustomEvent('drawing:saved', { detail: {
      contextId: 'chart-brush', type: 'freehand', subtype, color: '#00aabb', lineWidth: 4, lineStyle: 'dotted', fillColor: '#ffcc00', fillOpacity: .4,
    } }));
    expect(panel.activeToolRef.current).toBe('freehand');
    expect(panel.manager.getActiveDrawing()?.type).toBe('freehand');
    expect(panel.manager.getActiveDrawing()?.subtype).toBe(subtype);
    expect(panel.manager.updateActiveDrawing).toHaveBeenCalledWith({ lineWidth: 4, lineStyle: 'dotted', fillColor: '#ffcc00', fillOpacity: .4 });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(panel.activeToolRef.current).toBeNull();
    expect(isTrendDrawingInputActive(panel.container)).toBe(false);
    expect(panel.container.style.touchAction).toBe('');
  });
  it.each([...TREND_LINE_TOOLS, ...GANN_FIBONACCI_TOOLS,
    ...CHART_PATTERN_TOOLS.map(tool => ({ ...tool, drawingType: 'pattern' })),
    ...['emoji:1f600', 'sticker:1f602', 'icon:arrow-up'].map(subtype => ({
      id: subtype, label: getPictographStamp(subtype)!.label, drawingType: 'stamp',
    })),
    ...FORECASTING_MEASUREMENT_TOOLS])('$label arms only its chart and restores input after completion', tool => {
    const owner = installCommandLifecycle('chart-owner');
    const sibling = installCommandLifecycle('chart-sibling');
    owner.dispatch({ tool: tool.drawingType, subtype: tool.id, targetContextId: 'chart-owner' });
    expect(isTrendDrawingInputActive(owner.container)).toBe(true);
    expect(isTrendDrawingInputActive(sibling.container)).toBe(false);
    window.dispatchEvent(new CustomEvent('drawing:saved', { detail: { contextId: 'chart-sibling' } }));
    expect(isTrendDrawingInputActive(owner.container)).toBe(true);
    window.dispatchEvent(new CustomEvent('drawing:saved', { detail: { contextId: 'chart-owner' } }));
    expect(isTrendDrawingInputActive(owner.container)).toBe(false);
    expect(owner.activeToolRef.current).toBeNull();
  });

  it('restores the owner on direct cancellation, explicit cursor, tool replacement, and teardown', () => {
    const panel = installCommandLifecycle('chart-owner');
    const arm = () => panel.dispatch({ tool: 'channel', subtype: 'parallel_channel', targetContextId: 'chart-owner' });
    arm();
    window.dispatchEvent(new CustomEvent('drawing:cancelled', { detail: { contextId: 'chart-sibling' } }));
    expect(isTrendDrawingInputActive(panel.container)).toBe(true);
    panel.manager.cancelDrawing();
    expect(isTrendDrawingInputActive(panel.container)).toBe(false);
    expect(panel.drawingCommandTargetRef.current).toBeNull();
    arm();
    panel.dispatch({ tool: 'cursor', targetContextId: 'chart-owner' });
    expect(isTrendDrawingInputActive(panel.container)).toBe(false);
    arm();
    panel.dispatch({ tool: 'rectangle', targetContextId: 'chart-owner' });
    expect(isTrendDrawingInputActive(panel.container)).toBe(false);
    arm();
    panel.cleanup();
    expect(isTrendDrawingInputActive(panel.container)).toBe(false);
  });

  it.each(FORECASTING_MEASUREMENT_TOOLS)('Cursor cancels $label and restores chart input', tool => {
    const panel = installCommandLifecycle('chart-owner');
    panel.dispatch({ tool: 'measure', subtype: tool.id, targetContextId: 'chart-owner' });
    expect(isTrendDrawingInputActive(panel.container)).toBe(true);
    panel.dispatch({ tool: 'cursor', targetContextId: 'chart-owner' });
    expect(panel.manager.getActiveDrawing()).toBeNull();
    expect(panel.manager.unselectAll).toHaveBeenCalledOnce();
    expect(panel.activeToolRef.current).toBeNull();
    expect(panel.drawingCommandTargetRef.current).toBeNull();
    expect(isTrendDrawingInputActive(panel.container)).toBe(false);
    expect(panel.container.style.cursor).toBe('default');
  });

  it('makes all actual trade hit-target types pass through only in the armed panel', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
    const start = css.indexOf('[data-trend-drawing-active="true"]');
    expect(start).toBeGreaterThan(-1);
    const rule = css.slice(start, css.indexOf('}', start) + 1);
    const style = document.createElement('style');
    style.textContent = rule;
    document.body.appendChild(style);
    const installedRule = style.sheet!.cssRules[0] as CSSStyleRule;
    expect(installedRule.style.getPropertyValue('pointer-events')).toBe('none');
    expect(rule).toMatch(/pointer-events:\s*none\s*!important\s*;/);
    const owner = makePanel();
    const sibling = makePanel();
    setTrendDrawingInputActive(owner.container, true);
    for (const panel of [owner, sibling]) {
      panel.wrapper.querySelectorAll<HTMLElement>('.overlay [style]').forEach(target => {
        // This jsdom CSS parser drops declaration priority. Verify the real
        // selector and source priority; browser QA checks
        // the resulting hit test. Original inline interaction stays intact.
        expect(target.matches(installedRule.selectorText)).toBe(panel === owner);
        expect(target.style.pointerEvents).toBe('auto');
      });
    }
    setTrendDrawingInputActive(owner.container, false);
    owner.wrapper.querySelectorAll<HTMLElement>('.overlay [style]').forEach(target => {
      expect(target.matches(installedRule.selectorText)).toBe(false);
      expect(getComputedStyle(target).pointerEvents).toBe('auto');
    });
  });

  it('lets armed drawing presses reach the canvas without trade scanning, then restores ordinary trade capture', () => {
    const { container } = makePanel();
    const overlay = document.createElement('div');
    const findClosestTradeLevel = vi.fn(() => ({ tradeObj: { key: 'trade:1', entryPrice: 100 }, grabbedType: 'ENTRY' }));
    const beginPointerCapture = vi.fn();
    const handler = execute(`let dragState = null, dragLineOverlay = null, dragBadgeOverlay = null;
      return ${tradePointerHandler};`, {
      container, isTrendDrawingInputActive, cancelQueuedTradeHover: vi.fn(), setTradeHoverCursor: vi.fn(),
      seriesRef: { current: {} }, tradeAllowed: true, chartSettingsRef: { current: { showTradeLevels: true } },
      getChartY: () => 120, activeTradeSnapshotsRef: { current: new Map() }, findClosestTradeLevel,
      TRADE_LEVEL_HIT_AREA_PX: 12, activeToolRef: { current: null }, beginPointerCapture,
      beginDragCursor: vi.fn(), chartRef: { current: { applyOptions: vi.fn() } },
      DRAWING_LOCK_HANDLE_SCROLL: {}, DRAWING_LOCK_HANDLE_SCALE: {}, getFinitePriceCoordinate: () => 120,
      hideDraggedLevelControls: vi.fn(), getPriceScaleOffset: () => 40,
      getTradeOverlayCardPalette: () => ({ background: '#000', border: '#555', text: '#fff', shadow: '' }),
      isChartSurfaceLight: () => false, TRADE_LEVEL_BADGE_LEFT_INSET_PX: 12, overlayRef: { current: overlay },
    });
    setTrendDrawingInputActive(container, true);
    const drawingPress = new MouseEvent('pointerdown', { button: 0, cancelable: true });
    handler(drawingPress);
    expect(drawingPress.defaultPrevented).toBe(false);
    expect(findClosestTradeLevel).not.toHaveBeenCalled();
    expect(beginPointerCapture).not.toHaveBeenCalled();
    expect(overlay.children).toHaveLength(0);

    setTrendDrawingInputActive(container, false);
    const tradePress = new MouseEvent('pointerdown', { button: 0, cancelable: true });
    handler(tradePress);
    expect(tradePress.defaultPrevented).toBe(true);
    expect(findClosestTradeLevel).toHaveBeenCalledOnce();
    expect(beginPointerCapture).toHaveBeenCalledOnce();
    expect(overlay.children).toHaveLength(2);
  });
});
