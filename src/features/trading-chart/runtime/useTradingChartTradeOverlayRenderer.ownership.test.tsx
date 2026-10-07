import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTradingChartTradeOverlayRenderer } from './useTradingChartTradeOverlayRenderer';
import { getPositionCloseScope, useAppStore } from '../../../store/useAppStore';
import { useBrokerAccountSessionScope } from '../../../hooks/useBrokerAccountSessionScope';
import { commitBrokerAccountSessionScope } from '../../../services/brokerSession';

const mocks = vi.hoisted(() => ({ bind: vi.fn(), dispose: vi.fn(), model: vi.fn(), disposeRelayout: vi.fn(), flush: vi.fn(), committed: vi.fn() }));
vi.mock('./bindTradeOverlayRuntimeSubscriptions', () => ({ bindTradeOverlayRuntimeSubscriptions: mocks.bind }));
vi.mock('./createTradeOverlayModelRuntime', () => ({ createTradeOverlayModelRuntime: mocks.model }));
vi.mock('./createTradeOverlayDomRuntime', () => ({ createTradeOverlayDomRuntime: () => ({}) }));
type Options = Parameters<typeof useTradingChartTradeOverlayRenderer>[0];

function fixture() {
  const options = { visibleRuntime: { overlay: true }, isDisposedRef: { current: false },
    chartRef: { current: {} }, seriesRef: { current: {} }, symbol: 'BTCUSD', timeframe: 'M1', resolvedPriceDigits: 2,
    overlayRef: { current: {} }, drawingRuntimeContextRef: { current: { contextId: 'original' } },postInteractionTradeOverlayLayoutRef: { current: null },committedTradeOverlayLayoutRef: { current: null },
    activeOverlayNodesRef:{current:[]},activeOverlayNodeDataRef:{current:[]},tradeControlLiveUpdatersRef:{current:[]},
    historyOverlayNodesRef: { current: [] }, historyOverlayNodeDataRef: { current: [] },
    hydrateTradeLevelOverrides: vi.fn() } as unknown as Options;
  const hook = renderHook(() => {
    const brokerAccountSessionScope = useBrokerAccountSessionScope();
    useTradingChartTradeOverlayRenderer({ ...options, brokerAccountSessionScope });
  });
  return { ...hook, options };
}
beforeEach(() => {
  useAppStore.getState().reset();
  useAppStore.setState({ isAuthenticated: true, accountId: '1', authToken: 'fixture-initial-token' });
  commitBrokerAccountSessionScope({ authenticated: true, accountId: '1', brokerId: 'fixture', serverUrl: 'https://fixture.invalid' });
  mocks.dispose.mockClear(); mocks.bind.mockReset().mockImplementation(() => mocks.dispose);
  mocks.disposeRelayout.mockClear();mocks.flush.mockClear();mocks.committed.mockClear();mocks.model.mockReset().mockReturnValue({disposeTradeOverlayRelayout:mocks.disposeRelayout,flushPostInteractionTradeOverlay:mocks.flush,projectCommittedTradeOverlayGeometry:mocks.committed});
});
afterEach(() => { cleanup(); useAppStore.getState().reset(); vi.restoreAllMocks(); });

describe('overlay runtime rebinds for financial ownership generation', () => {
  it('fences chart/context changes and disposes relayout before clearing subscription-owned visuals', () => {
    const hook=fixture(), current=mocks.model.mock.calls[0][0].isRuntimeCurrent;
    expect(current()).toBe(true);const chart=hook.options.chartRef.current;
    hook.options.chartRef.current={} as Options['chartRef']['current'];expect(current()).toBe(false);hook.options.chartRef.current=chart;
    hook.options.drawingRuntimeContextRef.current.contextId='replacement';expect(current()).toBe(false);
    hook.options.drawingRuntimeContextRef.current.contextId='original';expect(current()).toBe(true);
    hook.unmount();expect(current()).toBe(false);expect(mocks.disposeRelayout).toHaveBeenCalledTimes(1);
    expect(mocks.disposeRelayout.mock.invocationCallOrder[0]).toBeLessThan(mocks.dispose.mock.invocationCallOrder[0]);
    expect(hook.options.postInteractionTradeOverlayLayoutRef.current).toBeNull();
    expect(hook.options.committedTradeOverlayLayoutRef.current).toBeNull();
  });
  it('installs the current committed-draw callback and does not clear a replacement callback during old cleanup', () => {
    const hook=fixture();expect(hook.options.committedTradeOverlayLayoutRef.current).toBe(mocks.committed);
    const replacement=vi.fn();hook.options.committedTradeOverlayLayoutRef.current=replacement;
    hook.unmount();expect(hook.options.committedTradeOverlayLayoutRef.current).toBe(replacement);
  });
  it('preserves a working runtime through explicit same-account credential refresh', () => {
    fixture(); const scope = getPositionCloseScope(); expect(mocks.bind).toHaveBeenCalledTimes(1);
    act(() => useAppStore.getState().setAuthTokens('fixture-refreshed-token', 'fixture-refresh', Date.now() + 60000));
    expect(getPositionCloseScope()).toBe(scope); expect(mocks.bind).toHaveBeenCalledTimes(1);
    expect(mocks.dispose).not.toHaveBeenCalled();
    act(() => { commitBrokerAccountSessionScope({ authenticated: true, accountId: '1', brokerId: 'fixture', serverUrl: 'https://fixture.invalid' }); });
    expect(getPositionCloseScope()).toBe(scope); expect(mocks.bind).toHaveBeenCalledTimes(1);
  });
  it('rebinds a same-account raw credential replacement even when the committed scope key stays the same', () => {
    fixture(); const scope = getPositionCloseScope();
    act(() => useAppStore.setState({ authToken: 'fixture-replacement-token' }));
    expect(getPositionCloseScope()).toBeGreaterThan(scope);
    expect(mocks.dispose).toHaveBeenCalledTimes(1); expect(mocks.bind).toHaveBeenCalledTimes(2);
  });
  it('rebinds committed broker changes and logout and does not leave old subscriptions active', () => {
    const hook = fixture();
    act(() => { commitBrokerAccountSessionScope({ authenticated: true, accountId: '1', brokerId: 'other-fixture', serverUrl: 'https://other.invalid' }); });
    expect(mocks.dispose).toHaveBeenCalledTimes(1); expect(mocks.bind).toHaveBeenCalledTimes(2);
    act(() => useAppStore.setState({ isAuthenticated: false, authToken: null }));
    expect(mocks.dispose).toHaveBeenCalledTimes(2); expect(mocks.bind).toHaveBeenCalledTimes(3);
    hook.unmount(); expect(mocks.dispose).toHaveBeenCalledTimes(3);
  });
});
