// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DockLayout } from '../../services/dockManager';
import { commandBus } from '../../services/commandBus';
import type { CommandType } from '../../types/commands';
import { useDockLayoutStore } from '../../store/useDockLayoutStore';
import { useChartSettingsStore } from '../../store/useChartSettingsStore';
import type { ActiveMarketSymbolsSnapshot } from '../layout/MarketWatchPanel';
import type { MarketInstrumentsSnapshot } from '../../hooks/useLiveMarketData';
import { DockWorkspace } from './DockWorkspace';

const chartMocks = vi.hoisted(() => ({
  render: vi.fn(),
  marketWatchRender: vi.fn(),
}));

vi.mock('../TradingChart', () => ({
  TradingChart: (props: unknown) => {
    chartMocks.render(props);
    return null;
  },
}));

vi.mock('../layout/MarketWatchPanel', () => ({
  MarketWatchPanel: (props: unknown) => {
    chartMocks.marketWatchRender(props);
    return null;
  },
}));
vi.mock('../layout/NavigatorPanel', () => ({ NavigatorPanel: () => null }));
vi.mock('../BottomDock', () => ({ BottomDock: () => null }));

vi.mock('../../hooks/useCommandBus', async () => {
  const { commandBus: bus } = await vi.importActual<typeof import('../../services/commandBus')>('../../services/commandBus');
  return {
    useCommandBus: () => ({
      subscribe: (handler: (cmd: unknown) => void) => bus.subscribe('*' as CommandType, handler),
    }),
  };
});

const originalLayout = useDockLayoutStore.getState().layout;

beforeAll(async () => {
  await import('../TradingChart');
});

afterAll(() => {
  useDockLayoutStore.setState({ layout: originalLayout });
});

const chartLayout = (id: string, symbol: string): DockLayout => ({
  version: 'diagnostic-test',
  floatingPanels: [],
  root: {
    id: 'root',
    type: 'split',
    ratio: 1,
    children: [{
      id,
      type: 'panel',
      component: 'Chart',
      title: `${symbol},M5`,
      props: { symbol, timeframe: 'M5' },
      ratio: 1,
    }],
  },
});

const chartAndMarketWatchLayout = (symbol: string): DockLayout => ({
  version: 'freshness-owner-test',
  floatingPanels: [],
  root: {
    id: 'root',
    type: 'split',
    ratio: 1,
    children: [
      {
        id: 'chart-1',
        type: 'panel',
        component: 'Chart',
        title: `${symbol},M1`,
        props: { symbol, timeframe: 'M1' },
        ratio: 0.75,
      },
      {
        id: 'market-watch-1',
        type: 'panel',
        component: 'MarketWatch',
        title: 'Market Watch',
        props: {},
        ratio: 0.25,
      },
    ],
  },
});

const createActiveMarketSnapshot = (
  overrides: Partial<ActiveMarketSymbolsSnapshot> = {},
): ActiveMarketSymbolsSnapshot => ({
  symbols: ['BTCUSD'],
  loading: false,
  settled: true,
  current: true,
  error: null,
  reload: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

const createMarketInstrumentsSnapshot = (
  overrides: Partial<MarketInstrumentsSnapshot> = {},
): MarketInstrumentsSnapshot => ({
  symbols: [{ symbol: 'BTCUSD' }],
  authorizedInstruments: [{ symbol: 'BTCUSD' }],
  authorizedSymbols: ['BTCUSD'],
  disabledSymbols: [],
  authorizationSettled: true,
  loading: false,
  error: null,
  reload: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

const renderWorkspace = (
  layout: DockLayout,
  selectedSymbol: string,
  chartRuntimeEnabled = true,
  activeMarketSnapshot = createActiveMarketSnapshot(),
  allSymbols: unknown[] = ['BTCUSD'],
  marketInstrumentsSnapshot = createMarketInstrumentsSnapshot(),
) => {
  useDockLayoutStore.setState({ layout });
  return render(
    <DockWorkspace
      globalChartType="candlestick"
      globalTimeframe="M5"
      allSymbols={allSymbols}
      chartSymbols={allSymbols}
      tradeSymbols={activeMarketSnapshot.current ? activeMarketSnapshot.symbols : []}
      activeMarketSnapshot={activeMarketSnapshot}
      marketInstrumentsSnapshot={marketInstrumentsSnapshot}
      selectedSymbol={selectedSymbol}
      chartRuntimeEnabled={chartRuntimeEnabled}
      onSymbolSelect={vi.fn()}
      onClosePosition={vi.fn()}
      onModifyPosition={vi.fn()}
      onCancelOrder={vi.fn()}
      onCloseBulk={vi.fn()}
    />,
  );
};

describe('DockWorkspace chart diagnostic attributes', () => {
  beforeEach(() => {
    chartMocks.render.mockReset();
    chartMocks.marketWatchRender.mockReset();
  });

  afterEach(() => {
    cleanup();
    useDockLayoutStore.setState({ layout: originalLayout });
    useChartSettingsStore.setState({ symbolProperties: {} });
  });

  it('does not rerender market/chart panels when a parent overlay opens, but still reacts to chart changes', async () => {
    const symbols = ['BTCUSD', 'XAUUSD'];
    useDockLayoutStore.setState({ layout: chartAndMarketWatchLayout('BTCUSD') });
    const props = {
      globalChartType: 'candlestick' as const, globalTimeframe: 'M5' as const,
      allSymbols: symbols, chartSymbols: symbols, tradeSymbols: symbols,
      activeMarketSnapshot: createActiveMarketSnapshot({ symbols }),
      marketInstrumentsSnapshot: createMarketInstrumentsSnapshot(),
      selectedSymbol: 'BTCUSD', onSymbolSelect: vi.fn(), onClosePosition: vi.fn(),
      onModifyPosition: vi.fn(), onCancelOrder: vi.fn(), onCloseBulk: vi.fn(),
    };
    const view = (open: boolean) => <><DockWorkspace {...props} />{open && <div role="dialog">New Order</div>}</>;
    const mounted = render(view(false));
    await waitFor(() => expect(chartMocks.render).toHaveBeenCalled());
    chartMocks.render.mockClear();
    chartMocks.marketWatchRender.mockClear();
    mounted.rerender(view(true));
    expect(chartMocks.render).not.toHaveBeenCalled();
    expect(chartMocks.marketWatchRender).not.toHaveBeenCalled();
    act(() => useDockLayoutStore.setState({ layout: chartAndMarketWatchLayout('XAUUSD') }));
    await waitFor(() => expect(chartMocks.render).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'XAUUSD' })));
  });

  it('grows the chart grid by one window per Arrange Windows command from the toolbar icon', () => {
    renderWorkspace(chartLayout('chart-1', 'BTCUSD'), 'BTCUSD');
    expect(useDockLayoutStore.getState().getChartCount()).toBe(1);
    act(() => commandBus.dispatch({ type: 'TILE_WINDOWS', payload: { mode: 'grid' } }));
    expect(useDockLayoutStore.getState().getChartCount()).toBe(2);
    act(() => commandBus.dispatch({ type: 'TILE_WINDOWS', payload: { mode: 'grid' } }));
    expect(useDockLayoutStore.getState().getChartCount()).toBe(3);
    act(() => commandBus.dispatch({ type: 'TILE_WINDOWS', payload: { mode: 'vertical' } }));
    expect(useDockLayoutStore.getState().getChartCount()).toBe(3);
  });

  it('inherits per-symbol chart settings only into symbols without their own entry', () => {
    const store = useChartSettingsStore.getState();
    store.updateSymbolProperty('AAA', 'showOHLC', true);
    store.updateSymbolProperty('BBB', 'showOHLC', false);
    useChartSettingsStore.getState().inheritSymbolProperties('AAA', 'BBB');
    expect(useChartSettingsStore.getState().symbolProperties.BBB.showOHLC).toBe(false);
    useChartSettingsStore.getState().inheritSymbolProperties('AAA', 'CCC');
    expect(useChartSettingsStore.getState().symbolProperties.CCC.showOHLC).toBe(true);
    useChartSettingsStore.getState().inheritSymbolProperties('MISSING', 'DDD');
    expect(useChartSettingsStore.getState().symbolProperties.DDD).toBeUndefined();
  });

  it('keeps Show-section choices when the rendered chart symbol settles to the saved panel symbol', () => {
    useChartSettingsStore.getState().updateSymbolProperty('BTCUSD', 'showOHLC', true);
    const layout: DockLayout = {
      version: 'settings-carry', floatingPanels: [], root: {
        id: 'root', type: 'split', ratio: 1, children: [{
          id: 'chart-1', type: 'panel', component: 'Chart', title: 'XAUUSD,M5',
          props: { symbol: 'XAUUSD', timeframe: 'M5' }, ratio: 1,
        }],
      },
    };
    useDockLayoutStore.setState({ layout });
    const workspace = (symbols: string[]) => <DockWorkspace
      globalChartType="candlestick" globalTimeframe="M5" selectedSymbol="BTCUSD"
      allSymbols={symbols} chartSymbols={symbols} tradeSymbols={symbols}
      activeMarketSnapshot={createActiveMarketSnapshot({ symbols })}
      marketInstrumentsSnapshot={createMarketInstrumentsSnapshot({ symbols: symbols.map(symbol => ({ symbol })) })}
      onSymbolSelect={vi.fn()} onClosePosition={vi.fn()} onModifyPosition={vi.fn()}
      onCancelOrder={vi.fn()} onCloseBulk={vi.fn()} />;
    const view = render(workspace(['BTCUSD']));
    expect(view.container.querySelector('[data-chart-rendered-symbol]')).toHaveAttribute('data-chart-rendered-symbol', 'BTCUSD');
    view.rerender(workspace(['BTCUSD', 'XAUUSD']));
    expect(view.container.querySelector('[data-chart-rendered-symbol]')).toHaveAttribute('data-chart-rendered-symbol', 'XAUUSD');
    expect(useChartSettingsStore.getState().symbolProperties.XAUUSD).toMatchObject({ showOHLC: true });
  });

  it('keeps an explicit saved chart blank during a partial catalog, then renders its own contract when settled', async () => {
    useDockLayoutStore.setState({ layout: chartLayout('saved-gold', 'XAUUSD.raw') });
    const workspace = (current: boolean, symbols: string[]) => <DockWorkspace
      globalChartType="candlestick" globalTimeframe="M5" selectedSymbol="AAPL.US"
      allSymbols={symbols} chartSymbols={symbols} tradeSymbols={symbols}
      activeMarketSnapshot={createActiveMarketSnapshot({ symbols })}
      marketInstrumentsSnapshot={createMarketInstrumentsSnapshot({ chartCatalogCurrent: current, authorizationSettled: current })}
      onSymbolSelect={vi.fn()} onClosePosition={vi.fn()} onModifyPosition={vi.fn()}
      onCancelOrder={vi.fn()} onCloseBulk={vi.fn()} />;
    const view = render(workspace(false, ['AAPL.US']));
    expect(view.container.querySelector('[data-chart-rendered-symbol]')).toHaveAttribute('data-chart-rendered-symbol', '');
    expect(chartMocks.render).not.toHaveBeenCalled();
    view.rerender(workspace(true, ['AAPL.US', 'XAUUSD.raw', 'BTCUSD']));
    await waitFor(() => expect(chartMocks.render).toHaveBeenCalled());
    expect(chartMocks.render.mock.calls.every(([props]) => props.symbol === 'XAUUSD.RAW')).toBe(true);
    expect(view.container.querySelector('[data-chart-rendered-symbol]')).toHaveAttribute('data-chart-rendered-symbol', 'XAUUSD.RAW');
  });

  it.each([
    { name: 'an unbound placeholder', saved: 'Chart', current: false },
    { name: 'an invalid contract after successful catalog loading', saved: 'OLD-BROKER.GOLD', current: true },
  ])('allows the existing fallback for $name', async ({ saved, current }) => {
    const view = renderWorkspace(chartLayout('chart-fallback', saved), 'BTCUSD', true,
      createActiveMarketSnapshot(), ['BTCUSD'], createMarketInstrumentsSnapshot({ chartCatalogCurrent: current }));
    await waitFor(() => expect(chartMocks.render).toHaveBeenCalled());
    expect(view.container.querySelector('[data-chart-rendered-symbol]')).toHaveAttribute('data-chart-rendered-symbol', 'BTCUSD');
  });

  it('does not expose hostile persisted panel IDs or symbols in any data-chart attribute', async () => {
    const hostileId = 'panel:200002:1234@mql5helpline@gmail.com';
    const hostileSymbol = 'BTCUSD" data-password="1234';
    const { container } = renderWorkspace(chartLayout(hostileId, hostileSymbol), hostileSymbol);

    await waitFor(() => expect(chartMocks.render).toHaveBeenCalled(), { timeout: 5_000 });
    const panel = container.querySelector<HTMLElement>('.rtx-chart-panel');
    expect(panel).not.toBeNull();
    expect(panel?.getAttribute('data-chart-panel-id')).toBe('');
    expect(panel?.getAttribute('data-chart-panel-symbol')).toBe('');
    expect(panel?.getAttribute('data-chart-rendered-symbol')).toBe('BTCUSD');

    const diagnosticValues = Array.from(container.querySelectorAll<HTMLElement>('*'))
      .flatMap((element) => element.getAttributeNames()
        .filter((name) => name.startsWith('data-chart-'))
        .map((name) => element.getAttribute(name) ?? ''))
      .join('|');
    expect(diagnosticValues).not.toContain('200002');
    expect(diagnosticValues).not.toContain('1234');
    expect(diagnosticValues).not.toContain('@');
    expect(chartMocks.render.mock.lastCall?.[0]).toMatchObject({ panelId: hostileId, symbol: 'BTCUSD' });
  });

  it('keeps valid internal panel IDs and canonical authorized symbols useful', async () => {
    const { container } = renderWorkspace(chartLayout('chart-1700000000000', 'btcusd'), 'btcusd');

    await waitFor(() => expect(chartMocks.render).toHaveBeenCalled());
    const panel = container.querySelector<HTMLElement>('.rtx-chart-panel');
    expect(panel?.getAttribute('data-chart-panel-id')).toBe('chart-1700000000000');
    expect(panel?.getAttribute('data-chart-panel-symbol')).toBe('BTCUSD');
    expect(panel?.getAttribute('data-chart-rendered-symbol')).toBe('BTCUSD');
  });

  it('keeps the dock flush on every edge after the right-side rail is removed', () => {
    const { container } = renderWorkspace(chartLayout('chart-1', 'BTCUSD'), 'BTCUSD');
    const workspace = container.querySelector<HTMLElement>('[data-rtx-authenticated-viewport="true"]');

    expect(workspace).not.toBeNull();
    expect(workspace?.style.paddingTop).toBe('0px');
    // FIX: The removed right-side exposure rail no longer reserves a 6px gutter.
    expect(workspace?.style.paddingRight).toBe('0px');
    expect(workspace?.style.paddingBottom).toBe('0px');
    expect(workspace?.style.paddingLeft).toBe('0px');
  });

  it('passes broker-authoritative zero-digit precision to the chart', async () => {
    renderWorkspace(
      chartLayout('chart-1', 'BTCUSD'),
      'BTCUSD',
      true,
      createActiveMarketSnapshot(),
      [{ symbol: 'BTCUSD', digits: 0 }],
    );

    await waitFor(() => expect(chartMocks.render).toHaveBeenCalled());
    expect(chartMocks.render.mock.lastCall?.[0]).toMatchObject({
      symbol: 'BTCUSD',
      priceDigits: 0,
    });
  });

  it('passes authenticated broker lot constraints to the exact chart symbol', async () => {
    renderWorkspace(
      chartLayout('chart-1', 'BTCUSD'),
      'BTCUSD',
      true,
      createActiveMarketSnapshot(),
      [{ symbol: 'BTCUSD', minVolume: 0.01, maxVolume: 100, volumeStep: 0.01 }],
      createMarketInstrumentsSnapshot({
        authorizedInstruments: [{
          symbol: 'BTCUSD',
          minVolume: 0.001,
          maxVolume: 25,
          volumeStep: 0.001,
        }],
      }),
    );

    await waitFor(() => expect(chartMocks.render).toHaveBeenCalled());
    // FIX regression: authenticated metadata overrides the public catalog for
    // the exact symbol before reaching the one-click lot editor.
    expect(chartMocks.render.mock.lastCall?.[0]).toMatchObject({
      symbol: 'BTCUSD',
      minVolume: 0.001,
      maxVolume: 25,
      volumeStep: 0.001,
    });
  });

  it('keeps chart network runtime disabled until startup selection is settled', async () => {
    const view = renderWorkspace(chartLayout('chart-1', 'BTCUSD'), 'BTCUSD', false);

    await waitFor(() => expect(view.container.querySelector('.rtx-chart-panel')).not.toBeNull());
    expect(chartMocks.render).not.toHaveBeenCalled();

    view.rerender(
      <DockWorkspace
        globalChartType="candlestick"
        globalTimeframe="M5"
        allSymbols={['BTCUSD']}
        chartSymbols={['BTCUSD']}
        tradeSymbols={['BTCUSD']}
        activeMarketSnapshot={createActiveMarketSnapshot()}
        marketInstrumentsSnapshot={createMarketInstrumentsSnapshot()}
        selectedSymbol="BTCUSD"
        chartRuntimeEnabled
        onSymbolSelect={vi.fn()}
        onClosePosition={vi.fn()}
        onModifyPosition={vi.fn()}
        onCancelOrder={vi.fn()}
        onCloseBulk={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(chartMocks.render.mock.lastCall?.[0]).toMatchObject({
        symbol: 'BTCUSD',
        isActive: true,
      });
    });
  });

  it('uses one non-current freshness snapshot for Market Watch and the chart trade gate', async () => {
    const activeMarketSnapshot = createActiveMarketSnapshot({
      current: false,
      error: 'Active feed status is stale',
    });
    renderWorkspace(
      chartAndMarketWatchLayout('BTCUSD'),
      'BTCUSD',
      true,
      activeMarketSnapshot,
    );

    await waitFor(() => {
      expect(chartMocks.render).toHaveBeenCalled();
      expect(chartMocks.marketWatchRender).toHaveBeenCalled();
    });

    expect(chartMocks.render.mock.lastCall?.[0]).toMatchObject({
      symbol: 'BTCUSD',
      timeframe: 'M1',
      tradeAllowed: false,
    });
    expect(chartMocks.marketWatchRender.mock.lastCall?.[0]).toMatchObject({
      activeMarketSnapshot,
      selectedSymbol: 'BTCUSD',
    });
    expect(activeMarketSnapshot.current).toBe(false);
  });
});
