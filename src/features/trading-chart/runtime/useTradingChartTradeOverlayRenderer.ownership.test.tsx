import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTradingChartTradeOverlayRenderer } from './useTradingChartTradeOverlayRenderer';
import { getPositionCloseScope, useAppStore } from '../../../store/useAppStore';
import { useBrokerAccountSessionScope } from '../../../hooks/useBrokerAccountSessionScope';
import { commitBrokerAccountSessionScope } from '../../../services/brokerSession';

const mocks = vi.hoisted(() => ({ bind: vi.fn(), dispose: vi.fn() }));
vi.mock('./bindTradeOverlayRuntimeSubscriptions', () => ({ bindTradeOverlayRuntimeSubscriptions: mocks.bind }));
vi.mock('./createTradeOverlayModelRuntime', () => ({ createTradeOverlayModelRuntime: () => ({}) }));
vi.mock('./createTradeOverlayDomRuntime', () => ({ createTradeOverlayDomRuntime: () => ({}) }));
type Options = Parameters<typeof useTradingChartTradeOverlayRenderer>[0];

function fixture() {
  const options = { visibleRuntime: { overlay: true }, isDisposedRef: { current: false },
    chartRef: { current: {} }, seriesRef: { current: {} }, symbol: 'BTCUSD', timeframe: 'M1', resolvedPriceDigits: 2,
    hydrateTradeLevelOverrides: vi.fn() } as unknown as Options;
  return renderHook(() => {
    const brokerAccountSessionScope = useBrokerAccountSessionScope();
    useTradingChartTradeOverlayRenderer({ ...options, brokerAccountSessionScope });
  });
}
beforeEach(() => {
  useAppStore.getState().reset();
  useAppStore.setState({ isAuthenticated: true, accountId: '1', authToken: 'fixture-initial-token' });
  commitBrokerAccountSessionScope({ authenticated: true, accountId: '1', brokerId: 'fixture', serverUrl: 'https://fixture.invalid' });
  mocks.dispose.mockClear(); mocks.bind.mockReset().mockImplementation(() => mocks.dispose);
});
afterEach(() => { cleanup(); useAppStore.getState().reset(); vi.restoreAllMocks(); });

describe('overlay runtime rebinds for financial ownership generation', () => {
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
