// @vitest-environment jsdom

import React from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DockLayout } from '../../services/dockManager';
import { useDockLayoutStore } from '../../store/useDockLayoutStore';
import type { ActiveMarketSymbolsSnapshot } from '../layout/MarketWatchPanel';
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

vi.mock('../../hooks/useCommandBus', () => ({
  useCommandBus: () => ({ subscribe: () => () => undefined }),
}));

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

const renderWorkspace = (
  layout: DockLayout,
  selectedSymbol: string,
  chartRuntimeEnabled = true,
  activeMarketSnapshot = createActiveMarketSnapshot(),
  allSymbols: unknown[] = ['BTCUSD'],
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

  it('keeps the dock flush against the toolbar and status bar while preserving side gutters', () => {
    const { container } = renderWorkspace(chartLayout('chart-1', 'BTCUSD'), 'BTCUSD');
    const workspace = container.querySelector<HTMLElement>('[data-rtx-authenticated-viewport="true"]');

    expect(workspace).not.toBeNull();
    expect(workspace?.style.paddingTop).toBe('0px');
    expect(workspace?.style.paddingRight).toBe('6px');
    expect(workspace?.style.paddingBottom).toBe('0px');
    expect(workspace?.style.paddingLeft).toBe('6px');
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
