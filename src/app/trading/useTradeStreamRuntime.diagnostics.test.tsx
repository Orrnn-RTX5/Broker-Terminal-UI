import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useTradeStreamRuntime } from './useTradeStreamRuntime';
import { getQuoteDiagnosticDump } from '../../services/quoteDiagnostics';
import { useAppStore } from '../../store/useAppStore';
import { normalizePosition } from '../../services/positionStream';

afterEach(() => { delete window.__RTX_QUOTE_DIAGNOSTICS_ENABLED__; });

it('records no position evidence for an invalid account or inactive session', () => {
  window.__RTX_QUOTE_DIAGNOSTICS_ENABLED__ = true;
  const count = getQuoteDiagnosticDump().controls.length;
  let receive: (message: unknown) => void = () => undefined;
  let sessionActive = true;
  const subscribe = vi.fn((_channel: string, callback: (message: unknown) => void) => { receive = callback; return vi.fn(); });
  const hook = renderHook(() => useTradeStreamRuntime({
    isAuthenticated: true, subscribe, isSessionActive: () => sessionActive,
    getAcceptedChannelLogin: () => 123, getLiveTradingLogin: () => 123,
    incrementPositionsStreamVersion: vi.fn(), hasServerClosedTicket: () => false,
    markServerClosedTickets: vi.fn(), markTradeWsMessage: vi.fn(),
    reconcileOptimisticClosedPositions: positions => positions,
    refreshOrdersAndHistory: vi.fn(async () => undefined), reloadMarketSymbols: vi.fn(),
  }));
  act(() => receive({ channel: 'positions.123', data: { type: 'position_update', data: [{ ticket: 991, account_login: 999, symbol: 'BTCUSD', price_current: 102 }] } }));
  sessionActive = false;
  act(() => receive({ channel: 'positions.123', data: { type: 'position_update', data: [{ ticket: 991, account_login: 123, symbol: 'BTCUSD', price_current: 102 }] } }));
  expect(getQuoteDiagnosticDump().controls.slice(count).filter(row => row.kind === 'position')).toEqual([]);
  hook.unmount();
});

it('records applied timing only after the accepted backend price reaches the store', () => {
  window.__RTX_QUOTE_DIAGNOSTICS_ENABLED__ = true;
  const position = normalizePosition({ ticket: 997, symbol: 'BTCUSD', volume: 0.01, side: 'buy', price_open: 100, price_current: 101, profit: 1, state_version: '9007199254740993', price_time_msc: '1800000000000' });
  useAppStore.setState({ positions: [position] });
  const count = getQuoteDiagnosticDump().controls.length;
  let receive: (message: unknown) => void = () => undefined;
  const subscribe = vi.fn((_channel: string, callback: (message: unknown) => void) => { receive = callback; return vi.fn(); });
  const hook = renderHook(() => useTradeStreamRuntime({
    isAuthenticated: true, subscribe, isSessionActive: () => true,
    getAcceptedChannelLogin: () => 123, getLiveTradingLogin: () => 123,
    incrementPositionsStreamVersion: vi.fn(), hasServerClosedTicket: () => false,
    markServerClosedTickets: vi.fn(), markTradeWsMessage: vi.fn(),
    reconcileOptimisticClosedPositions: positions => positions,
    refreshOrdersAndHistory: vi.fn(async () => undefined), reloadMarketSymbols: vi.fn(),
  }));
  act(() => receive({ channel: 'positions.123', data: { type: 'position_update', data: [{ ticket: 997, account_login: 123, update_kind: 'pnl', state_version: '9007199254740993', price_time_msc: '1800000000123', price_current: 102, profit: 2 }] } }));
  expect(useAppStore.getState().positions[0].currentPrice).toBe(102);
  const records = getQuoteDiagnosticDump().controls.slice(count).filter(row => row.kind === 'position');
  expect(records.map(row => row.phase)).toEqual(['position-received', 'position-applied']);
  expect(records[1]).toMatchObject({ backendPrice: 102, backendProfit: 2, positionVersion: '9007199254740993', sourcePriceTimeMs: '1800000000123', accepted: true });
  hook.unmount();
});
