import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore, type Position } from '../store/useAppStore';
import {
  OPEN_POSITIONS_QUOTE_SOURCE,
  openPositionSymbolKey,
  useOpenPositionQuoteDemand,
} from './useOpenPositionQuoteDemand';

const managerMock = vi.hoisted(() => ({
  setDemand: vi.fn(),
  removeDemand: vi.fn(),
  isConnected: vi.fn(() => false),
}));

vi.mock('../services/quoteSocketManager', () => ({
  getQuoteSocketManager: vi.fn(() => managerMock),
}));

vi.mock('../services/brokerSession', () => ({
  getAccessToken: vi.fn(() => null),
  getServerUrl: vi.fn(() => ''),
  hasFeedBrokerToken: vi.fn(() => false),
  onSessionChange: vi.fn(() => vi.fn()),
  buildBrokerWsFeedUri: vi.fn(() => 'wss://broker.example/ws/feed'),
  buildBrokerWsV2Uri: vi.fn(() => 'wss://broker.example/ws/v2'),
}));

const position = (id: number, symbol: string, currentPrice = 1): Position => ({
  id, symbol, side: 'BUY', volume: 0.01, openPrice: 1, currentPrice,
  openTime: '2026-09-23T06:56:43.000Z', sl: 0, tp: 0, swap: 0, commission: 0, unrealizedPnL: 0,
});

describe('openPositionSymbolKey', () => {
  it('reduces many positions to one sorted entry per symbol', () => {
    const held = [
      ...Array.from({ length: 7 }, (_, index) => position(5224725 - index, 'GBPUSD')),
      position(5226809, 'btcusd'),
      position(5226810, ' BTCUSD '),
    ];
    expect(openPositionSymbolKey(held)).toBe('BTCUSD|GBPUSD');
  });

  it('ignores blank symbols and non-arrays', () => {
    expect(openPositionSymbolKey([position(1, ''), position(2, '  ')])).toBe('');
    expect(openPositionSymbolKey(undefined)).toBe('');
  });
});

describe('useOpenPositionQuoteDemand', () => {
  beforeEach(() => {
    managerMock.setDemand.mockClear();
    managerMock.removeDemand.mockClear();
    useAppStore.setState({ positions: [] });
  });
  afterEach(() => useAppStore.setState({ positions: [] }));

  it('streams every held symbol even when it is in neither Market Watch nor the chart', () => {
    useAppStore.setState({ positions: [position(1, 'GBPUSD'), position(2, 'GBPUSD'), position(3, 'BTCUSD')] });
    renderHook(() => useOpenPositionQuoteDemand());
    expect(managerMock.setDemand).toHaveBeenLastCalledWith(OPEN_POSITIONS_QUOTE_SOURCE, ['BTCUSD', 'GBPUSD']);
  });

  it('does not re-register demand when only prices change', () => {
    useAppStore.setState({ positions: [position(1, 'GBPUSD', 1.33185)] });
    renderHook(() => useOpenPositionQuoteDemand());
    const calls = managerMock.setDemand.mock.calls.length;

    act(() => { useAppStore.setState({ positions: [position(1, 'GBPUSD', 1.33139)] }); });

    expect(managerMock.setDemand).toHaveBeenCalledTimes(calls);
    expect(managerMock.removeDemand).not.toHaveBeenCalled();
  });

  it('follows symbols in and out as positions open and close', () => {
    useAppStore.setState({ positions: [position(1, 'GBPUSD')] });
    const { unmount } = renderHook(() => useOpenPositionQuoteDemand());

    act(() => { useAppStore.setState({ positions: [position(1, 'GBPUSD'), position(2, 'XAUUSD')] }); });
    expect(managerMock.setDemand).toHaveBeenLastCalledWith(OPEN_POSITIONS_QUOTE_SOURCE, ['GBPUSD', 'XAUUSD']);

    act(() => { useAppStore.setState({ positions: [position(2, 'XAUUSD')] }); });
    expect(managerMock.setDemand).toHaveBeenLastCalledWith(OPEN_POSITIONS_QUOTE_SOURCE, ['XAUUSD']);

    act(() => { useAppStore.setState({ positions: [] }); });
    expect(managerMock.removeDemand).toHaveBeenLastCalledWith(OPEN_POSITIONS_QUOTE_SOURCE);

    unmount();
  });
});
