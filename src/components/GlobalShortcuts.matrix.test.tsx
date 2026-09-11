import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalShortcuts } from './GlobalShortcuts';
import { TopToolbar } from './layout/TopToolbar';
import { WebDrawingToolsRail } from '../drawing-tools/WebDrawingToolsRail';
import { keyboardShortcutManager, type ShortcutDefinition } from '../services/keyboardShortcutManager';
import { commandBus } from '../services/commandBus';
import { getShortcutHelpEntries } from '../services/shortcutCatalog';
import { activateActiveChartSource, clearActiveChartSources, registerActiveChartSource } from '../services/activeChartSource';
import { applyChartTimeframeCommand, CHART_TIMEFRAMES } from '../services/chartTimeframeCommand';
import { useAppStore } from '../store/useAppStore';
import { defaultChartProperties, useChartSettingsStore } from '../store/useChartSettingsStore';
import { useDrawingSidebarStore } from '../store/useDrawingSidebarStore';
import { useDockLayoutStore } from '../store/useDockLayoutStore';
import { getRequestedBottomDockTab } from '../services/bottomDockNavigation';
import { drawingManager } from '../services/drawingManager';
import { bindChartKeyboardScroll } from '../utils/chartKeyboardScroll';
import { useToolbarState } from '../hooks/useToolbarState';
import type { IChartApi } from 'lightweight-charts';
import type { DockLayout, DockPanelConfig } from '../services/dockManager';

vi.mock('./ShortcutFeedback', () => ({ ShortcutFeedback: () => null }));
vi.mock('./ShortcutHelpDialog', () => ({ ShortcutHelpDialog: ({ isOpen }: { isOpen: boolean }) => isOpen ? <div data-testid="shortcut-help" /> : null }));
// MenuBar has no global registrations; it is verified separately by MenuBar.test.tsx.
vi.mock('./layout/MenuBar', () => ({ MenuBar: () => null }));

const BROKERS = [
  { id: 'TEST', server: 'https://fxtrustbrokerbackend.orrnn.com', symbol: 'XAUUSD', other: 'BTCUSD' },
  { id: 'achiever-financials', server: 'https://service.achieverfinancials.com', symbol: 'XAUUSD.raw', other: 'EURUSD.raw' },
  { id: 'myprop-trade', server: 'https://services.myprop.trade', symbol: 'XAUUSD-pro', other: 'BTCUSD-pro' },
  { id: 'grow-trading-academy', server: 'https://services.growtradingacademy.com', symbol: 'EURUSD.r', other: 'XAUUSD.r' },
] as const;

const commandCases: Record<string, { type: string; values?: Record<string, unknown>; state?: Record<string, unknown> }> = {
  'charts.bar-chart': { type: 'SET_CHART_TYPE', values: { chartType: 'bar' }, state: { chartType: 'bar' } },
  'charts.candlestick': { type: 'SET_CHART_TYPE', values: { chartType: 'candlestick' }, state: { chartType: 'candlestick' } },
  'charts.line-chart': { type: 'SET_CHART_TYPE', values: { chartType: 'line' }, state: { chartType: 'line' } },
  'charts.area-chart': { type: 'SET_CHART_TYPE', values: { chartType: 'area' }, state: { chartType: 'area' } },
  'charts.indicator-list': { type: 'OPEN_INDICATOR_LIST' },
  'charts.toggle-crosshair': { type: 'TOGGLE_CROSSHAIR' },
  'charts.zoom-in': { type: 'ZOOM_IN' }, 'charts.zoom-out': { type: 'ZOOM_OUT' },
  'drawing.trendline': { type: 'SELECT_TOOL', values: { tool: 'trendline' }, state: { activeTool: 'trendline' } },
  'drawing.hline': { type: 'SELECT_TOOL', values: { tool: 'hline' }, state: { activeTool: 'hline' } },
  'drawing.vline': { type: 'SELECT_TOOL', values: { tool: 'vline' }, state: { activeTool: 'vline' } },
  'drawing.text': { type: 'SELECT_TOOL', values: { tool: 'text' }, state: { activeTool: 'text' } },
  'drawing.rail.trendline': { type: 'SELECT_TOOL', values: { tool: 'trendline', subtype: 'trendline' }, state: { activeTool: 'trendline' } },
  'drawing.rail.horizontal_line': { type: 'SELECT_TOOL', values: { tool: 'hline', subtype: 'horizontal_line' }, state: { activeTool: 'hline' } },
  'drawing.rail.horizontal_ray': { type: 'SELECT_TOOL', values: { tool: 'hline', subtype: 'horizontal_ray' }, state: { activeTool: 'hline' } },
  'drawing.rail.vertical_line': { type: 'SELECT_TOOL', values: { tool: 'vline', subtype: 'vertical_line' }, state: { activeTool: 'vline' } },
  'drawing.rail.crossline': { type: 'SELECT_TOOL', values: { tool: 'vline', subtype: 'crossline' }, state: { activeTool: 'vline' } },
  'drawing.rail.fibonacci': { type: 'SELECT_TOOL', values: { tool: 'fibonacci', subtype: 'fib_retracement' }, state: { activeTool: 'fibonacci' } },
  'drawing.rail.text': { type: 'SELECT_TOOL', values: { tool: 'text' }, state: { activeTool: 'text' } },
};
const eventCases: Record<string, string> = {
  'window.add-chart': 'add-chart-panel',
  'file.close-chart': 'close-active-chart', 'file.print-preview': 'open-print-preview', 'file.save-picture': 'open-save-picture',
  'view.data-window': 'openDataWindow', 'view.symbols': 'openSymbolsDialog', 'tools.options': 'open-terminal-options',
  'trading.toggle-one-click': 'toggle-one-click-trading', 'charts.object-list': 'open-object-list', 'charts.properties': 'openChartProperties',
  'charts.undo-drawing': 'chart-undo-drawing', 'charts.redo-drawing': 'chart-redo-drawing',
  'charts.delete-drawing': 'chart-delete-drawing', 'charts.delete-last-drawing': 'chart-delete-last-drawing',
  'charts.scroll-left': 'chart-scroll', 'charts.scroll-right': 'chart-scroll',
};
const propertyCases: Record<string, keyof typeof defaultChartProperties> = {
  'charts.toggle-grid': 'showGrid', 'charts.toggle-grid-alt': 'showGrid', 'charts.toggle-volumes': 'showTickVolumes',
  'charts.period-separators': 'showPeriodSeparators', 'charts.trade-history': 'showTradeHistory', 'charts.ohlc': 'showOHLC',
  'charts.auto-scroll': 'chartAutoScroll', 'charts.chart-shift': 'chartShift',
};
const callbackCases: Record<string, string> = {
  'file.save': 'onSaveWorkspace', 'file.print': 'onPrintChart', 'view.fullscreen': 'onToggleFullScreen',
  'tools.new-order': 'onOpenOrderPanel', 'view.depth-of-market': 'onOpenDOM', 'trading.quick-sell': 'onQuickSell',
};
const layoutCases: Record<string, [string, string?]> = {
  'window.tile': ['arrangeCharts', 'grid'], 'window.cascade': ['arrangeCharts', 'cascade'],
  'window.tile-horizontal': ['arrangeCharts', 'horizontal'], 'window.tile-vertical': ['arrangeCharts', 'vertical'],
  'window.arrange-icons': ['arrangeIcons'], 'window.undo': ['undo'], 'window.redo': ['redo'], 'window.reset': ['resetWindows'],
};
const specialCases = new Set(['view.market-watch', 'view.navigator', 'view.terminal', 'trading.order-history', 'view.toolbox',
  'tools.history-center', 'view.drawing-tools', 'drawing.emojis', 'drawing.stamps', 'drawing.select-all',
  'charts.scroll-left', 'charts.scroll-right', 'navigation.close-modal', 'help.shortcuts']);
const isCovered = (id: string) => Boolean(commandCases[id] || eventCases[id] || propertyCases[id] || callbackCases[id]
  || layoutCases[id] || specialCases.has(id) || id.startsWith('timeframe.'));

let dispose: () => void;
let probe: ReturnType<typeof useToolbarState>;
const releases: Array<() => void> = [];
const ToolbarProbe = () => { probe = useToolbarState(); return null; };
const press = (binding: ShortcutDefinition, target: Element = document.body) => fireEvent.keyDown(target, {
  key: binding.key, code: /^[a-z]$/i.test(binding.key) ? `Key${binding.key.toUpperCase()}` : /^\d$/.test(binding.key) ? `Digit${binding.key}` : binding.key,
  altKey: Boolean(binding.alt), ctrlKey: Boolean(binding.ctrl), shiftKey: Boolean(binding.shift), metaKey: Boolean(binding.meta),
});
const listen = (name: string) => {
  const fn = vi.fn(); window.addEventListener(name, fn); releases.push(() => window.removeEventListener(name, fn)); return fn;
};
const props = (symbol = 'STALE') => ({ selectedSymbol: symbol, isChartPropertiesOpen: false, isOrderPanelOpen: false,
  onOpenOrderPanel: vi.fn(), onQuickBuy: vi.fn(), onQuickSell: vi.fn(), onSaveWorkspace: vi.fn(),
  onOpenDataFolder: vi.fn(), onPrintChart: vi.fn(), onToggleFullScreen: vi.fn(), onOpenDOM: vi.fn() });
const mount = (callbacks = props()) => render(<>
  <GlobalShortcuts {...callbacks} />
  <TopToolbar chartType="candlestick" timeframe="M1" symbol="STALE" onChartTypeChange={vi.fn()} onTimeframeChange={vi.fn()}
    feedStatus={{ symbols: [], loading: false, settled: true, current: false, error: null }} onRefreshConnection={vi.fn()} />
  <WebDrawingToolsRail selectedSymbol="STALE" /><ToolbarProbe />
</>);
const createChart = (panelId: string, symbol: () => string, timeframe: () => string) => {
  const container = document.createElement('div'); document.body.appendChild(container);
  releases.push(registerActiveChartSource({ id: `trading-chart:${panelId}`, getContainer: () => container, getSymbol: symbol, getTimeframe: timeframe }));
};
const makeLayout = (symbol: string, other: string): DockLayout => ({ version: 'test', floatingPanels: [], root: {
  id: 'root', type: 'split', direction: 'horizontal', ratio: 1, children: [
    { id: 'active', component: 'Chart', title: `${symbol},M1`, props: { symbol, timeframe: 'M1' } },
    { id: 'other', component: 'Chart', title: `${other},H4`, props: { symbol: other, timeframe: 'H4' } },
  ],
} });
const panel = (id: string): DockPanelConfig => {
  const find = (node: DockLayout['root']): DockPanelConfig | undefined => {
    for (const child of node.children) {
      if ('children' in child) { const result = find(child); if (result) return result; }
      else if (child.id === id) return child;
    }
    return undefined;
  };
  const layout = useDockLayoutStore.getState().layout;
  return (find(layout.root) || layout.floatingPanels.map(find).find(Boolean))!;
};

beforeEach(() => {
  keyboardShortcutManager.clear(); clearActiveChartSources(); commandBus.clearHistory(); localStorage.clear();
  useChartSettingsStore.setState({ globalProperties: { ...defaultChartProperties }, symbolProperties: {} });
  useDrawingSidebarStore.setState({ visible: true, requestedMenu: null });
  useAppStore.setState({ ticks: {}, tickLookup: {} });
  useDockLayoutStore.getState().setLayout(makeLayout('OLD', 'OLD-OTHER'));
  dispose = keyboardShortcutManager.initialize(); document.body.tabIndex = -1;
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup(); dispose(); releases.splice(0).forEach(fn => fn()); vi.restoreAllMocks();
  keyboardShortcutManager.clear(); clearActiveChartSources(); document.body.replaceChildren();
});

describe('mounted shortcut action matrix', () => {
  it.each(BROKERS)('executes every registered browser binding for $id without a live transport', broker => {
    localStorage.setItem('broker_id', broker.id); localStorage.setItem('server_url', broker.server);
    localStorage.setItem('login', '900001'); // Deliberately fake; no transport is mounted in this suite.
    useDockLayoutStore.getState().setLayout(makeLayout(broker.symbol, broker.other));
    createChart('active', () => broker.symbol, () => panel('active').props!.timeframe);
    createChart('other', () => broker.other, () => panel('other').props!.timeframe);
    activateActiveChartSource('trading-chart:active');
    const callbacks = props(); mount(callbacks);
    const fallbackTimeframe = vi.fn();
    releases.push(commandBus.subscribe('SET_TIMEFRAME', payload => applyChartTimeframeCommand(payload, fallbackTimeframe)));
    const bindings = keyboardShortcutManager.getShortcuts().filter(binding => binding.enabled !== false);
    expect(bindings.filter(binding => !isCovered(binding.id)).map(binding => binding.id)).toEqual([]);
    expect(keyboardShortcutManager.getConflicts()).toEqual([]);
    for (const binding of bindings) {
      fireEvent.pointerDown(document.body); document.body.focus();
      commandBus.clearHistory(); vi.clearAllMocks();
      act(() => useChartSettingsStore.setState({ symbolProperties: {}, globalProperties: { ...defaultChartProperties } }));
      const id = binding.id;
      const event = eventCases[id] ? listen(eventCases[id]) : undefined;
      const panelsEvent = ['view.market-watch', 'view.navigator', 'view.terminal'].includes(id) ? listen('togglePanel') : undefined;
      const layoutCase = layoutCases[id];
      const layout = layoutCase ? vi.spyOn(useDockLayoutStore.getState(), layoutCase[0] as 'undo').mockImplementation(() => undefined) : undefined;
      const selectAll = id === 'drawing.select-all' ? vi.spyOn(drawingManager, 'selectAll').mockImplementation(() => undefined) : undefined;
      const before = probe.state;
      const volumeBefore = defaultChartProperties.showTickVolumes;
      press(binding);
      if (commandCases[id]) {
        const expectation = commandCases[id];
        expect(commandBus.getHistory(), id).toEqual([{ type: expectation.type, payload: expect.objectContaining({ targetContextId: 'trading-chart:active', ...expectation.values }) }]);
        if (expectation.state) expect(probe.state, id).toMatchObject(expectation.state);
        if (id === 'charts.toggle-crosshair') expect(probe.state.crosshairEnabled).toBe(!before.crosshairEnabled);
        if (id === 'charts.zoom-in') expect(probe.state.candleWidth).toBe(before.candleWidth + 2);
        if (id === 'charts.zoom-out') expect(probe.state.candleWidth).toBe(before.candleWidth - 2);
      } else if (id.startsWith('timeframe.')) {
        const timeframe = id.slice('timeframe.'.length).toUpperCase();
        expect(commandBus.getHistory(), id).toHaveLength(1);
        expect(panel('active').props, id).toMatchObject({ symbol: broker.symbol, timeframe });
        expect(panel('other').props, id).toMatchObject({ symbol: broker.other, timeframe: 'H4' });
        expect(probe.state.timeframe, id).toBe(timeframe); expect(fallbackTimeframe).not.toHaveBeenCalled();
        expect(screen.getByText(timeframe).closest('button')).toHaveAttribute('aria-checked', 'true');
      } else if (propertyCases[id]) {
        const key = propertyCases[id];
        expect(useChartSettingsStore.getState().symbolProperties[broker.symbol][key], id).toBe(!defaultChartProperties[key]);
        expect(useChartSettingsStore.getState().symbolProperties[broker.other], id).toBeUndefined();
        if (id === 'charts.toggle-volumes') expect(useChartSettingsStore.getState().symbolProperties[broker.symbol].showTickVolumes).toBe(!volumeBefore);
        if (id === 'charts.auto-scroll') expect(probe.state.autoScrollEnabled).toBe(!defaultChartProperties.chartAutoScroll);
        if (id === 'charts.chart-shift') expect(probe.state.chartShiftEnabled).toBe(!defaultChartProperties.chartShift);
      } else if (event) {
        expect(event, id).toHaveBeenCalledOnce();
        if (id.startsWith('charts.')) expect((event.mock.calls[0][0] as CustomEvent).detail).toMatchObject({ targetContextId: 'trading-chart:active' });
        if (id.startsWith('charts.scroll-')) expect((event.mock.calls[0][0] as CustomEvent).detail.direction).toBe(id.slice('charts.scroll-'.length));
      } else if (callbackCases[id]) {
        const callback = callbacks[callbackCases[id] as keyof typeof callbacks];
        expect(callback, id).toHaveBeenCalledOnce();
        if (id === 'trading.quick-sell' || id === 'view.depth-of-market') expect(callback).toHaveBeenCalledWith(broker.symbol);
        if (id === 'tools.new-order') expect(callback).toHaveBeenCalledWith(broker.symbol, { bid: 0, ask: 0 });
      } else if (layout) {
        expect(layout, id).toHaveBeenCalledOnce();
        if (layoutCase[1]) expect(layout).toHaveBeenCalledWith(layoutCase[1]);
        layout.mockRestore();
      } else if (panelsEvent) {
        expect(panelsEvent, id).toHaveBeenCalledOnce();
        expect(panelsEvent.mock.calls[0][0].detail).toBe({ 'view.market-watch': 'MarketWatch', 'view.navigator': 'Navigator', 'view.terminal': 'Terminal' }[id]);
      } else if (selectAll) {
        expect(selectAll).toHaveBeenCalledWith('trading-chart:active'); selectAll.mockRestore();
      } else if (['trading.order-history', 'view.toolbox', 'tools.history-center'].includes(id)) {
        expect(getRequestedBottomDockTab()).toBe({ 'trading.order-history': 'History', 'view.toolbox': 'Toolbox', 'tools.history-center': 'Historical Data' }[id]);
      } else if (id === 'view.drawing-tools') {
        expect(useDrawingSidebarStore.getState().visible).toBe(false);
        act(() => useDrawingSidebarStore.setState({ visible: true }));
      } else if (id === 'drawing.emojis' || id === 'drawing.stamps') {
        expect(useDrawingSidebarStore.getState().visible).toBe(true);
        expect(screen.getByRole(id === 'drawing.emojis' ? 'dialog' : 'menu', { name: id === 'drawing.emojis' ? 'Emoji picker' : 'Icons and stamps' })).toBeTruthy();
      } else if (id === 'help.shortcuts') {
        expect(screen.getByTestId('shortcut-help')).toBeTruthy();
      } else if (id === 'navigation.close-modal') {
        expect(commandBus.getHistory().at(-1)).toMatchObject({ type: 'SELECT_TOOL', payload: { tool: 'cursor', targetContextId: 'trading-chart:active' } });
      }
    }
    if (broker.id === 'TEST') {
      mkdirSync(resolve(process.cwd(), 'tmp'), { recursive: true });
      writeFileSync(resolve(process.cwd(), 'tmp/shortcut-matrix-inventory.json'), JSON.stringify(getShortcutHelpEntries(bindings).map(row => ({
        ...row, handler: undefined,
        verification: row.id.startsWith('local.') ? 'Local handler suite (separate)' : layoutCases[row.id] ? 'Mounted key to real layout API; layout effects in dock tests'
          : eventCases[row.id] ? 'Mounted key to scoped event; consumer tested separately'
          : callbackCases[row.id] ? 'Mounted key to callback adapter; no live transaction'
          : 'Mounted key to command consumer or state/UI effect',
      })), null, 2));
    }
  });

  it('switches broker/suffix and chart without re-registering, preserves quotes and all nine target timeframes', () => {
    let currentSymbol = 'OLD'; let currentOther = 'OLD-OTHER';
    createChart('active', () => currentSymbol, () => panel('active').props!.timeframe);
    createChart('other', () => currentOther, () => panel('other').props!.timeframe);
    const callbacks = props(); mount(callbacks);
    const fallback = vi.fn(); releases.push(commandBus.subscribe('SET_TIMEFRAME', payload => applyChartTimeframeCommand(payload, fallback)));
    for (const broker of BROKERS) {
      currentSymbol = broker.symbol; currentOther = broker.other;
      act(() => useDockLayoutStore.getState().setLayout(makeLayout(currentSymbol, currentOther)));
      localStorage.setItem('broker_id', broker.id); localStorage.setItem('server_url', broker.server);
      useAppStore.setState({ ticks: {
        [currentSymbol.toUpperCase()]: { symbol: currentSymbol, bid: 101, ask: 102, spread: 1, timestamp: 1 },
        [currentOther.toUpperCase()]: { symbol: currentOther, bid: 201, ask: 202, spread: 1, timestamp: 1 },
        XAUUSD: { symbol: 'XAUUSD', bid: 901, ask: 902, spread: 1, timestamp: 1 },
      } });
      for (const targetId of ['other', 'active']) {
        act(() => activateActiveChartSource(`trading-chart:${targetId}`));
        expect(screen.getByText(panel(targetId).props!.timeframe).closest('button')).toHaveAttribute('aria-checked', 'true');
        for (const timeframe of CHART_TIMEFRAMES) {
          commandBus.clearHistory(); press(keyboardShortcutManager.findShortcut(`timeframe.${timeframe.toLowerCase()}`)!);
          expect(commandBus.getHistory()).toHaveLength(1);
          expect(panel(targetId).props!.timeframe).toBe(timeframe);
        }
        const symbol = targetId === 'active' ? currentSymbol : currentOther;
        press(keyboardShortcutManager.findShortcut('tools.new-order')!);
        const prices = symbol === 'XAUUSD' ? { bid: 901, ask: 902 } : targetId === 'active' ? { bid: 101, ask: 102 } : { bid: 201, ask: 202 };
        expect(callbacks.onOpenOrderPanel).toHaveBeenLastCalledWith(symbol, prices);
        press(keyboardShortcutManager.findShortcut('trading.quick-sell')!);
        expect(callbacks.onQuickSell).toHaveBeenLastCalledWith(symbol);
      }
    }
    expect(fallback).not.toHaveBeenCalled();
  });

  it('hydrates toolbar props without publishing chart commands and sends selector clicks once', () => {
    createChart('active', () => 'XAUUSD.raw', () => panel('active').props!.timeframe);
    activateActiveChartSource('trading-chart:active'); mount();
    expect(commandBus.getHistory()).toEqual([]);
    const defaultTimeframe = vi.fn();
    releases.push(commandBus.subscribe('SET_TIMEFRAME', payload => applyChartTimeframeCommand(payload, defaultTimeframe)));
    fireEvent.click(screen.getByText('H4'));
    expect(commandBus.getHistory()).toEqual([{ type: 'SET_TIMEFRAME', payload: { timeframe: 'H4', targetContextId: 'trading-chart:active', panelId: 'active' } }]);
    expect(panel('active').props!.timeframe).toBe('H4'); expect(defaultTimeframe).not.toHaveBeenCalled();
    commandBus.clearHistory(); fireEvent.click(screen.getByRole('radio', { name: 'Area Chart' }));
    expect(commandBus.getHistory()).toEqual([{ type: 'SET_CHART_TYPE', payload: { chartType: 'area', targetContextId: 'trading-chart:active' } }]);
  });

  it('shows the active panel type when same-symbol charts use different series, without changing any chart', () => {
    const layout = makeLayout('ADAUSD', 'ADAUSD');
    (layout.root.children[0] as DockPanelConfig).props!.chartType = 'line';
    (layout.root.children[1] as DockPanelConfig).props!.chartType = 'candlestick';
    useDockLayoutStore.getState().setLayout(layout);
    createChart('active', () => 'ADAUSD', () => 'M1'); createChart('other', () => 'ADAUSD', () => 'H4');
    activateActiveChartSource('trading-chart:active'); mount();
    expect(screen.getByRole('radio', { name: 'Line Chart' })).toHaveAttribute('aria-checked', 'true');
    act(() => activateActiveChartSource('trading-chart:other'));
    expect(screen.getByRole('radio', { name: 'Candlesticks' })).toHaveAttribute('aria-checked', 'true');
    act(() => activateActiveChartSource('trading-chart:active'));
    expect(screen.getByRole('radio', { name: 'Line Chart' })).toHaveAttribute('aria-checked', 'true');
    // A saved symbol preference cannot misrepresent the panel's native series.
    act(() => useChartSettingsStore.getState().updateSymbolProperty('ADAUSD', 'chartType', 'Candlesticks'));
    expect(screen.getByRole('radio', { name: 'Line Chart' })).toHaveAttribute('aria-checked', 'true');
    act(() => useDockLayoutStore.getState().updatePanelProps('active', { props: { chartType: 'area' } }));
    expect(screen.getByRole('radio', { name: 'Area Chart' })).toHaveAttribute('aria-checked', 'true');
    expect(panel('other').props!.chartType).toBe('candlestick');
    expect(commandBus.getHistory()).toEqual([]);
  });

  it('does not apply invalid or stale context requests to a different active chart', () => {
    const setDefault = vi.fn();
    for (const timeframe of ['', 'M2', 'm1', null, undefined]) {
      expect(applyChartTimeframeCommand({ timeframe }, setDefault)).toBe(false);
    }
    expect(setDefault).not.toHaveBeenCalled();
    expect(applyChartTimeframeCommand({ timeframe: 'H1' }, setDefault)).toBe(true);
    expect(setDefault).toHaveBeenCalledExactlyOnceWith('H1');
    createChart('active', () => 'XAUUSD.raw', () => 'M1');
    activateActiveChartSource('trading-chart:active');
    applyChartTimeframeCommand({ timeframe: 'MN', targetContextId: 'trading-chart:removed-panel' }, setDefault);
    expect(panel('active').props!.timeframe).toBe('M1');
    expect(setDefault).toHaveBeenCalledTimes(1);
    applyChartTimeframeCommand({ timeframe: 'W1', panelId: 'other' }, setDefault);
    expect(panel('other').props!.timeframe).toBe('W1');
    expect(panel('active').props!.timeframe).toBe('M1');
  });

  it.each(['dialog', 'menu'])('does not quick-sell from a focused %s button', role => {
    const callbacks = props(); mount(callbacks);
    const overlay = document.createElement('div'); overlay.setAttribute('role', role);
    const button = document.createElement('button'); overlay.appendChild(button); document.body.appendChild(overlay);
    button.focus(); press(keyboardShortcutManager.findShortcut('trading.quick-sell')!, button);
    expect(callbacks.onQuickSell).not.toHaveBeenCalled();
    document.body.focus(); press(keyboardShortcutManager.findShortcut('trading.quick-sell')!);
    expect(callbacks.onQuickSell).toHaveBeenCalledExactlyOnceWith('STALE');
  });

  it('executes left/right against the chart time scale and protects every binding inside a local dialog', () => {
    useDockLayoutStore.getState().setLayout(makeLayout('XAUUSD.raw', 'EURUSD.raw'));
    createChart('active', () => 'XAUUSD.raw', () => 'M1');
    createChart('other', () => 'EURUSD.raw', () => 'H4');
    activateActiveChartSource('trading-chart:active');
    const callbacks = props(); mount(callbacks);
    const scales = ['active', 'other'].map(panelId => {
      let range = { from: 10, to: 110 };
      const scale = { getVisibleLogicalRange: () => range, setVisibleLogicalRange: vi.fn(next => { range = next; }) };
      releases.push(bindChartKeyboardScroll({ getChart: () => ({ timeScale: () => scale }) as unknown as IChartApi,
        isTarget: target => target.targetContextId === `trading-chart:${panelId}`, beforeScroll: vi.fn(), onScrolled: vi.fn() }));
      return scale;
    });
    press(keyboardShortcutManager.findShortcut('charts.scroll-left')!);
    expect(scales[0].getVisibleLogicalRange()).toEqual({ from: 0, to: 100 });
    press(keyboardShortcutManager.findShortcut('charts.scroll-right')!);
    expect(scales[0].getVisibleLogicalRange()).toEqual({ from: 10, to: 110 });
    expect(scales[1].setVisibleLogicalRange).not.toHaveBeenCalled();
    const local = document.createElement('div'); local.dataset.shortcutScope = 'local'; local.setAttribute('role', 'dialog');
    const input = document.createElement('input'); local.appendChild(input); document.body.appendChild(local); input.focus();
    commandBus.clearHistory(); vi.clearAllMocks();
    for (const binding of keyboardShortcutManager.getShortcuts()) press(binding, input);
    expect(commandBus.getHistory()).toEqual([]);
    for (const callback of Object.values(callbacks)) if (typeof callback === 'function') expect(callback).not.toHaveBeenCalled();
    expect(scales[0].setVisibleLogicalRange).not.toHaveBeenCalled();
  });
});
