// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { DockLayout } from '../services/dockManager';
import { useGuestChartLoginContinuity } from './useGuestChartLoginContinuity';

const layout = (symbol = 'XAUUSD.raw', timeframe = 'H4'): DockLayout => ({
  version: 'test', floatingPanels: [], root: {
    id: 'root', type: 'split', ratio: 1, children: [{
      id: 'gold-chart', type: 'panel', component: 'Chart',
      title: `${symbol},${timeframe}`, props: { symbol, timeframe }, ratio: 1,
    }],
  },
});

type Options = Parameters<typeof useGuestChartLoginContinuity>[0];
const guest: Options = {
  enabled: true, sessionScope: 'anonymous||broker-a|https://market.example',
  marketSource: 'configured-market-a', guestReady: true, accountCatalogPending: false,
  layout: layout(), chartSymbols: ['XAUUSD.RAW'], selectedSymbol: 'XAUUSD.RAW', timeframe: 'H4',
};
const pending: Options = {
  ...guest, sessionScope: 'authenticated|200003|broker-a|https://market.example',
  guestReady: false, accountCatalogPending: true, chartSymbols: [],
};

afterEach(cleanup);

describe('guest chart login continuity', () => {
  it('keeps the exact committed chart while the first same-source account catalogue loads', () => {
    const view = renderHook(useGuestChartLoginContinuity, { initialProps: guest });
    expect(view.result.current.retainedCharts).toEqual({});
    act(() => view.rerender(pending));
    expect(view.result.current).toEqual({
      retainedCharts: { 'gold-chart': { symbol: 'XAUUSD.RAW', timeframe: 'H4' } },
      preserveGuestLayout: true,
    });
    act(() => view.rerender({ ...pending }));
    expect(view.result.current.retainedCharts['gold-chart'].symbol).toBe('XAUUSD.RAW');
  });

  it('keeps the baseline when the authenticated store catalogue updates before canonical ownership notification', () => {
    const view = renderHook(useGuestChartLoginContinuity, { initialProps: guest });
    view.rerender({ ...pending, sessionScope: guest.sessionScope });
    expect(view.result.current.retainedCharts).toEqual({
      'gold-chart': { symbol: 'XAUUSD.RAW', timeframe: 'H4' },
    });
    expect(view.result.current.preserveGuestLayout).toBe(true);
    view.rerender(pending);
    expect(view.result.current.retainedCharts).toEqual({
      'gold-chart': { symbol: 'XAUUSD.RAW', timeframe: 'H4' },
    });
  });

  it('does not keep the pre-notification preview if the configured source already changed', () => {
    const view = renderHook(useGuestChartLoginContinuity, { initialProps: guest });
    view.rerender({ ...pending, sessionScope: guest.sessionScope, marketSource: 'configured-market-b' });
    expect(view.result.current).toEqual({ retainedCharts: {}, preserveGuestLayout: false });
    view.rerender(pending);
    expect(view.result.current.retainedCharts).toEqual({});
  });

  it('finishes the bridge when the account catalogue settles and never restores it on a later refresh', () => {
    const view = renderHook(useGuestChartLoginContinuity, { initialProps: guest });
    view.rerender(pending);
    view.rerender({ ...pending, accountCatalogPending: false, chartSymbols: ['EURUSD'] });
    expect(view.result.current.retainedCharts).toEqual({});
    expect(view.result.current.preserveGuestLayout).toBe(true);
    view.rerender(pending);
    expect(view.result.current.retainedCharts).toEqual({});
  });

  it('keeps the guest layout even when the catalogue arrives in the first authenticated render', () => {
    const view = renderHook(useGuestChartLoginContinuity, { initialProps: guest });
    view.rerender({ ...pending, accountCatalogPending: false, chartSymbols: ['XAUUSD.RAW'] });
    expect(view.result.current).toEqual({ retainedCharts: {}, preserveGuestLayout: true });
  });

  it.each([
    ['another configured broker', { marketSource: 'configured-market-b' }],
    ['another symbol suffix', { layout: layout('XAUUSD.pro') }],
    ['another timeframe', { layout: layout('XAUUSD.raw', 'M1') }],
    ['a desktop session', { enabled: false }],
    ['invalid configuration', { marketSource: '' }],
  ] as const)('never retains a public canvas for %s', (_description, change) => {
    const view = renderHook(useGuestChartLoginContinuity, { initialProps: guest });
    view.rerender({ ...pending, ...change });
    expect(view.result.current).toEqual({ retainedCharts: {}, preserveGuestLayout: false });
  });

  it('does not carry the public bridge into a different authenticated account', () => {
    const view = renderHook(useGuestChartLoginContinuity, { initialProps: guest });
    view.rerender(pending);
    view.rerender({ ...pending, sessionScope: 'authenticated|200004|broker-a|https://market.example' });
    expect(view.result.current).toEqual({ retainedCharts: {}, preserveGuestLayout: false });
    view.rerender(pending);
    expect(view.result.current.retainedCharts).toEqual({});
  });

  it('never treats an authenticated canvas or an unmounted guest chart as a public baseline', () => {
    const account = renderHook(useGuestChartLoginContinuity, { initialProps: { ...pending, accountCatalogPending: false } });
    account.rerender(pending);
    expect(account.result.current.retainedCharts).toEqual({});
    const unready = renderHook(useGuestChartLoginContinuity, { initialProps: { ...guest, guestReady: false } });
    unready.rerender(pending);
    expect(unready.result.current.retainedCharts).toEqual({});
  });
});
