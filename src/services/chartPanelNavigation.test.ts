// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useDockLayoutStore } from '../store/useDockLayoutStore';
import { registerActiveChartSource } from './activeChartSource';
import type { DockLayout, DockPanelConfig } from './dockManager';
import { activateChartPanel, changeChartPanelSymbol, findChartPanelById, getActiveDockChartPanel, getChartPanels, getChartPanelSymbolUpdates, requestActiveChartSymbolChange } from './chartPanelNavigation';
import { getChartSymbolTabs } from '../utils/chartSymbolTabs';
import { applyChartTimeframeCommand, CHART_TIMEFRAMES } from './chartTimeframeCommand';

const symbols = ['XAUUSD.RAW', 'EURUSD.R', 'BTCUSD-PRO', 'ADAUSD', 'USDJPY.R', 'GBPUSD'];
const frames = ['M1', 'M5', 'M15', 'M30', 'H1', 'MN'];
const originalLayout = useDockLayoutStore.getState().layout;
let unregister: Array<() => void> = [];
const panels = (): DockPanelConfig[] => symbols.map((symbol, index) => ({
  id: `chart-${index}`, title: `${symbol},${frames[index]}`, component: 'Chart',
  props: { symbol, timeframe: frames[index], chartType: index % 2 ? 'line' : 'candlestick', custom: `kept-${index}` },
}));
const fixture = (): DockLayout => {
  const all = panels();
  return {
    version: '1.0', root: { id: 'root', type: 'root', ratio: 1, children: [
      { id: 'nested-tabs', type: 'tabs', ratio: 0.5, activeTab: 'chart-0', children: all.slice(0, 2) },
      ...all.slice(2, 5),
    ] },
    floatingPanels: [{ id: 'float', type: 'panel', ratio: 1, isFloating: true, position: { x: 20, y: 20 }, size: { width: 320, height: 200 }, children: [{ ...all[5], minimized: true }] }],
  };
};
beforeEach(() => {
  useDockLayoutStore.getState().setLayout(fixture());
  unregister = panels().map(panel => {
    const container = document.createElement('div'); document.body.append(container);
    const off = registerActiveChartSource({ id: `trading-chart:${panel.id}`, getContainer: () => container });
    return () => { off(); container.remove(); };
  });
});
afterEach(() => { unregister.forEach(off => off()); useDockLayoutStore.getState().setLayout(originalLayout); });

describe('independent chart symbol navigation', () => {
  const navigationSymbols = [...symbols, 'XAUUSD', 'BTCUSD', 'EURUSD', 'NAS100-F', 'JPN225', 'COFFEE', 'SPA35-F', 'AAPL.US', 'USDJPY', 'TEST-CONTRACT.RAW'];
  it.each(CHART_TIMEFRAMES)('opens every authorized symbol and restores its saved %s chart after navigation', timeframe => {
    const store = useDockLayoutStore.getState();
    const siblings = getChartPanels(store.layout).filter(panel => panel.id !== 'chart-0');
    for (const symbol of navigationSymbols) {
      expect(changeChartPanelSymbol('chart-0', symbol, navigationSymbols)).toBe(true);
      expect(applyChartTimeframeCommand({ panelId: 'chart-0', timeframe }, () => {})).toBe(true);
    }
    store.setLayout(JSON.parse(JSON.stringify(useDockLayoutStore.getState().layout)));
    for (const symbol of [...navigationSymbols].reverse()) {
      expect(changeChartPanelSymbol('chart-0', symbol, navigationSymbols)).toBe(true);
      const panel = findChartPanelById(useDockLayoutStore.getState().layout, 'chart-0')!;
      expect(panel.props).toMatchObject({ symbol, timeframe });
      expect(panel.title).toBe(`${symbol},${timeframe}`);
      expect(getChartSymbolTabs(panel)).toHaveLength(navigationSymbols.length);
    }
    expect(getChartPanels(useDockLayoutStore.getState().layout).filter(panel => panel.id !== 'chart-0')).toEqual(siblings);
  });
  it('restores each symbol timeframe and style after switching tabs and reloading the layout', () => {
    const store = useDockLayoutStore.getState();
    const siblings = getChartPanels(store.layout).filter(panel => panel.id !== 'chart-0');
    expect(changeChartPanelSymbol('chart-0', 'BTCUSD-PRO', symbols)).toBe(true);
    applyChartTimeframeCommand({ panelId: 'chart-0', timeframe: 'M5' }, () => {});
    store.updatePanelProps('chart-0', { props: { chartType: 'line' } });
    expect(changeChartPanelSymbol('chart-0', 'XAUUSD.RAW', symbols)).toBe(true);
    expect(findChartPanelById(store.layout, 'chart-0')).toBeDefined();
    const read = () => findChartPanelById(useDockLayoutStore.getState().layout, 'chart-0')!;
    expect(read().props).toMatchObject({ symbol: 'XAUUSD.RAW', timeframe: 'M1', chartType: 'candlestick' });
    expect(getChartSymbolTabs(read()).map(tab => [tab.symbol, tab.timeframe])).toEqual([
      ['XAUUSD.RAW', 'M1'], ['BTCUSD-PRO', 'M5'],
    ]);
    store.setLayout(JSON.parse(JSON.stringify(useDockLayoutStore.getState().layout)));
    expect(changeChartPanelSymbol('chart-0', 'BTCUSD-PRO', symbols)).toBe(true);
    expect(read().props).toMatchObject({ symbol: 'BTCUSD-PRO', timeframe: 'M5', chartType: 'line' });
    expect(getChartSymbolTabs(read())).toHaveLength(2);
    expect(getChartPanels(useDockLayoutStore.getState().layout).filter(panel => panel.id !== 'chart-0')).toEqual(siblings);
  });
  it.each(['grid', 'horizontal', 'vertical', 'cascade'] as const)(
    'routes Market Watch to every clicked pane in %s without opening another chart', (mode) => {
      useDockLayoutStore.getState().arrangeCharts(mode);
      const requests: Array<{ symbol: string; panelId: string }> = [];
      const onOpenChart = (event: Event) => {
        const detail = (event as CustomEvent).detail;
        requests.push(detail);
        expect(changeChartPanelSymbol(detail.panelId, detail.symbol, symbols)).toBe(true);
      };
      window.addEventListener('openChart', onOpenChart);
      try {
        for (const panel of panels()) {
          activateChartPanel(panel.id);
          const before = getChartPanels(useDockLayoutStore.getState().layout);
          // The chosen symbol already exists in another pane. That pane must
          // remain untouched, even when all six chart slots are occupied.
          requestActiveChartSymbolChange(symbols[0]);
          expect(requests.at(-1)).toEqual({ symbol: symbols[0], panelId: panel.id });
          const after = getChartPanels(useDockLayoutStore.getState().layout);
          expect(after).toHaveLength(6);
          expect(after.filter(item => item.id !== panel.id)).toEqual(before.filter(item => item.id !== panel.id));
          expect(after.find(item => item.id === panel.id)?.props).toEqual({ ...panel.props, symbol: symbols[0] });
        }
        expect(requests).toHaveLength(6);
      } finally {
        window.removeEventListener('openChart', onOpenChart);
      }
    },
  );
  it('preserves saved charts through a partial startup feed and only replaces invalid contracts after current catalog success', () => {
    const layout = useDockLayoutStore.getState().layout;
    const before = getChartPanels(layout).map(panel => ({ ...panel, props: { ...panel.props } }));
    const partialResolve = (value: unknown) => value === 'AAPL.US' ? 'AAPL.US' : '';
    // An early feed-status response and failed/unfinished catalog requests
    // must never collapse every saved chart onto the first live instrument.
    expect(getChartPanelSymbolUpdates(layout, partialResolve, 'AAPL.US', 'M5', false)).toEqual([]);
    expect(getChartPanels(layout)).toEqual(before);
    const completeResolve = (value: unknown) => symbols.find(symbol => symbol === String(value).toUpperCase()) || '';
    expect(getChartPanelSymbolUpdates(layout, completeResolve, 'ADAUSD', 'M5', true)).toEqual([]);
    getChartPanels(layout)[5].props = { symbol: 'OLD-BROKER.XAU', timeframe: 'MN', chartType: 'line' };
    expect(getChartPanelSymbolUpdates(layout, completeResolve, 'ADAUSD', 'M5', false)).toEqual([]);
    expect(getChartPanelSymbolUpdates(layout, completeResolve, 'ADAUSD', 'M5', true)).toEqual([
      { id: 'chart-5', title: 'ADAUSD,MN', props: { symbol: 'ADAUSD', timeframe: 'MN', chartType: 'line' } },
    ]);
  });

  it('changes any of six chart panels while preserving all other symbols, timeframes and styles', () => {
    for (const panel of panels()) {
      const before = getChartPanels(useDockLayoutStore.getState().layout);
      expect(changeChartPanelSymbol(panel.id, ' xagusd.raw ', [...symbols, 'XAGUSD.RAW'])).toBe(true);
      const after = getChartPanels(useDockLayoutStore.getState().layout);
      expect(after).toHaveLength(6);
      expect(after.filter(item => item.id !== panel.id)).toEqual(before.filter(item => item.id !== panel.id));
      expect(after.find(item => item.id === panel.id)?.props).toEqual({ ...panel.props, symbol: 'XAGUSD.RAW' });
      expect(getActiveDockChartPanel()?.id).toBe(panel.id);
    }
  });

  it('allows duplicate symbols without replacing another chart and restores the selected floating panel', () => {
    expect(changeChartPanelSymbol('chart-5', symbols[0], symbols)).toBe(true);
    expect(getChartPanels(useDockLayoutStore.getState().layout).filter(panel => panel.props?.symbol === symbols[0])).toHaveLength(2);
    expect(findChartPanelById(useDockLayoutStore.getState().layout, 'chart-5')).toMatchObject({ props: { timeframe: 'MN', chartType: 'line' } });
    expect(findChartPanelById(useDockLayoutStore.getState().layout, 'chart-5')?.minimized).not.toBe(true);
    expect(activateChartPanel('chart-1')).toBe(true);
    expect(useDockLayoutStore.getState().layout.root.children[0]).toMatchObject({ activeTab: 'chart-1' });
  });

  it('rejects wrong suffixes, unknown contracts and a closed target without falling back to another chart', () => {
    const before = useDockLayoutStore.getState().layout;
    expect(changeChartPanelSymbol('chart-0', 'XAUUSD', symbols)).toBe(false);
    expect(changeChartPanelSymbol('chart-0', 'XAUUSD-PRO', symbols)).toBe(false);
    expect(changeChartPanelSymbol('closed-chart', symbols[0], symbols)).toBe(false);
    expect(useDockLayoutStore.getState().layout).toBe(before);
  });

  it('binds placeholder and title-only charts once while retaining valid quiet broker contracts', () => {
    const layout = fixture();
    const all = getChartPanels(layout);
    all[0].props = undefined; all[0].title = 'Chart';
    all[1].props = { timeframe: 'H4', chartType: 'area' }; all[1].title = 'EURUSD.R,H4';
    all[5].props = { symbol: 'OLD-BROKER.GOLD', timeframe: 'MN', chartType: 'line' };
    const resolve = (value: unknown) => symbols.find(symbol => symbol === String(value).toUpperCase()) || '';
    const updates = getChartPanelSymbolUpdates(layout, resolve, 'ADAUSD', 'M5');
    expect(updates.map(update => update.id)).toEqual(['chart-0', 'chart-1', 'chart-5']);
    expect(updates[0]).toMatchObject({ title: 'ADAUSD,M5', props: { symbol: 'ADAUSD', timeframe: 'M5' } });
    expect(updates[1]).toMatchObject({ title: 'EURUSD.R,H4', props: { symbol: 'EURUSD.R', timeframe: 'H4', chartType: 'area' } });
    expect(updates[2]).toMatchObject({ title: 'ADAUSD,MN', props: { symbol: 'ADAUSD', timeframe: 'MN', chartType: 'line' } });
    useDockLayoutStore.getState().setLayout(layout);
    updates.forEach(update => useDockLayoutStore.getState().updatePanelProps(update.id, { props: update.props, title: update.title }));
    expect(getChartPanelSymbolUpdates(useDockLayoutStore.getState().layout, resolve, 'BTCUSD-PRO', 'M1')).toEqual([]);
  });
});
