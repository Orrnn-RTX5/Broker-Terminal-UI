import { describe, expect, it } from 'vitest';
import type { DockLayout } from '../services/dockManager';
import { pickPreferredChartSymbol } from './symbolEligibility';
import {
  buildChartSelectionReconciliationKey,
  getAuthorizedChartDiagnosticSymbol,
  getChartPanelDiagnosticId,
  getChartSelectionDiagnosticAttributes,
  getChartSelectionReadinessSnapshot,
  shouldMountChartRuntime,
} from './chartSelectionReadiness';

const chartPanel = (id: string, symbol?: string) => ({
  id,
  type: 'panel' as const,
  component: 'Chart',
  title: `${symbol || 'Chart'},M5`,
  props: { symbol, timeframe: 'M5' },
});

const layoutWithChart = (symbol?: string): DockLayout => ({
  version: 'test',
  floatingPanels: [],
  root: {
    id: 'root',
    type: 'split',
    ratio: 1,
    children: [chartPanel('chart-1', symbol)],
  },
});

const tabLayout = (activeTab: string): DockLayout => ({
  version: 'test',
  floatingPanels: [],
  root: {
    id: 'chart-tabs',
    type: 'tabs',
    ratio: 1,
    activeTab,
    children: [chartPanel('xau-chart', 'XAUUSD'), chartPanel('btc-chart', 'BTCUSD')],
  },
});

const ambiguousLayout = (floating = false): DockLayout => ({
  version: 'test',
  root: {
    id: 'root',
    type: 'split',
    ratio: 1,
    children: [chartPanel('xau-chart', 'XAUUSD'), ...(floating ? [] : [chartPanel('btc-chart', 'BTCUSD')])],
  },
  floatingPanels: floating ? [{
    id: 'floating',
    type: 'split',
    ratio: 1,
    children: [chartPanel('btc-chart', 'BTCUSD')],
  }] : [],
});

const snapshot = ({
  selectedSymbol = 'XAUUSD',
  layout = layoutWithChart(selectedSymbol),
  feedPreferenceSettled = true,
  committed = true,
  authenticated = true,
  layoutRestored = true,
}: {
  selectedSymbol?: string;
  layout?: DockLayout;
  feedPreferenceSettled?: boolean;
  committed?: boolean;
  authenticated?: boolean;
  layoutRestored?: boolean;
} = {}) => {
  const authorizedSymbols = ['XAUUSD', 'BTCUSD'];
  const reconciliationKey = buildChartSelectionReconciliationKey({
    sessionKey: 'session',
    selectedSymbol,
    authorizedSymbols,
    layout,
  });
  return getChartSelectionReadinessSnapshot({
    authenticated,
    layoutRestored,
    catalogSettled: true,
    feedPreferenceSettled,
    selectedSymbol,
    authorizedSymbols,
    layout,
    reconciliationKey,
    committedReconciliationKey: committed ? reconciliationKey : 'older-selection',
  });
};

describe('chart selection benchmark readiness', () => {
  it('mounts the authorized chart runtime without waiting for feed-status preference', () => {
    expect(shouldMountChartRuntime({
      authenticated: true,
      accountId: '200002',
      restoredLayoutAccountId: '200002',
      catalogSettled: true,
      feedPreferenceSettled: false,
    })).toBe(true);
  });

  it('allows only short strict internal IDs in chart diagnostics', () => {
    expect(getChartPanelDiagnosticId('chart-1700000000000')).toBe('chart-1700000000000');
    expect(getChartPanelDiagnosticId('chart:200002')).toBe('');
    expect(getChartPanelDiagnosticId('x'.repeat(65))).toBe('');
  });

  it('stays not-ready while the first current feed-status decision is delayed', () => {
    expect(snapshot({ feedPreferenceSettled: false })).toMatchObject({
      ready: false,
      selectedSymbol: 'XAUUSD',
      renderedChartSymbol: 'XAUUSD',
    });
  });

  it('becomes ready only after the async XAUUSD to BTCUSD fallback is reconciled', () => {
    const fallback = pickPreferredChartSymbol(['XAUUSD', 'BTCUSD'], ['BTCUSD'], 'XAUUSD');
    expect(fallback).toBe('BTCUSD');
    expect(snapshot({ selectedSymbol: fallback, layout: layoutWithChart('XAUUSD') })).toEqual({
      ready: false,
      selectedSymbol: 'BTCUSD',
      activePanelSymbol: 'XAUUSD',
      renderedChartSymbol: 'XAUUSD',
    });

    const reconciled = snapshot({ selectedSymbol: fallback, layout: layoutWithChart(fallback) });
    expect(reconciled).toEqual({
      ready: true,
      selectedSymbol: 'BTCUSD',
      activePanelSymbol: 'BTCUSD',
      renderedChartSymbol: 'BTCUSD',
    });
    expect(snapshot({ selectedSymbol: fallback, layout: layoutWithChart(fallback) })).toEqual(reconciled);
  });

  it('uses the explicit active tab as the one unambiguous chart target', () => {
    expect(snapshot({ selectedSymbol: 'BTCUSD', layout: tabLayout('btc-chart') })).toEqual({
      ready: true,
      selectedSymbol: 'BTCUSD',
      activePanelSymbol: 'BTCUSD',
      renderedChartSymbol: 'BTCUSD',
    });
    expect(snapshot({ selectedSymbol: 'BTCUSD', layout: tabLayout('xau-chart') }).ready).toBe(false);
  });

  it.each([false, true])('rejects ambiguous %s multi-visible chart layouts', (floating) => {
    expect(snapshot({ layout: ambiguousLayout(floating) })).toEqual({
      ready: false,
      selectedSymbol: 'XAUUSD',
      activePanelSymbol: '',
      renderedChartSymbol: '',
    });
  });

  it('never exposes credential-shaped saved input as a diagnostic symbol', () => {
    const hostile = '200002:1234@mql5helpline@gmail.com';
    const result = snapshot({ selectedSymbol: hostile, layout: layoutWithChart(hostile) });
    const attributes = getChartSelectionDiagnosticAttributes(result);

    expect(getAuthorizedChartDiagnosticSymbol(hostile, ['XAUUSD', 'BTCUSD'])).toBe('');
    expect(result.ready).toBe(false);
    expect(Object.values(attributes).join('|')).not.toContain(hostile);
    expect(attributes['data-chart-selected-symbol']).toBe('');
    expect(attributes['data-chart-active-panel-symbol']).toBe('');
    expect(attributes['data-chart-rendered-symbol']).toBe('XAUUSD');
  });

  it('publishes ready only after commit and clears it on session or layout reset', () => {
    const marker = document.createElement('div');
    const commit = (value: ReturnType<typeof snapshot>) => {
      Object.entries(getChartSelectionDiagnosticAttributes(value))
        .forEach(([name, attribute]) => marker.setAttribute(name, attribute));
    };

    commit(snapshot({ committed: false }));
    expect(marker.getAttribute('data-chart-selection-ready')).toBe('false');
    commit(snapshot());
    expect(marker.getAttribute('data-chart-selection-ready')).toBe('true');
    expect(marker.getAttribute('data-chart-rendered-symbol')).toBe('XAUUSD');
    commit(snapshot({ layout: layoutWithChart(), committed: false }));
    expect(marker.getAttribute('data-chart-selection-ready')).toBe('false');
    commit(snapshot({ authenticated: false }));
    expect(marker.getAttribute('data-chart-selection-ready')).toBe('false');
    commit(snapshot({ layoutRestored: false }));
    expect(marker.getAttribute('data-chart-selection-ready')).toBe('false');
  });
});
