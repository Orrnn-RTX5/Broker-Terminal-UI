import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../store/useAppStore';
import {
  completeTradingAuthentication,
  requireTradingAuth,
  TRADING_AUTH_REQUEST_EVENT,
} from './tradingAuthGate';

describe('tradingAuthGate', () => {
  beforeEach(() => {
    useAppStore.setState({
      isAuthenticated: false,
      accountId: null,
      authToken: null,
      tokenExpiresAt: null,
    });
  });

  it('requests login and blocks an unauthenticated order', () => {
    const listener = vi.fn();
    window.addEventListener(TRADING_AUTH_REQUEST_EVENT, listener);
    const allowed = requireTradingAuth({
      source: 'quick-trade', side: 'BUY', symbol: ' eurusd ', volume: 0.2,
    });
    expect(allowed).toBe(false);
    expect(listener).toHaveBeenCalledOnce();
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toMatchObject({
      side: 'BUY', symbol: 'EURUSD', volume: 0.2,
    });
    window.removeEventListener(TRADING_AUTH_REQUEST_EVENT, listener);
  });

  it('allows an authenticated unexpired session without requesting login', () => {
    useAppStore.setState({
      isAuthenticated: true,
      accountId: '123456',
      authToken: 'jwt',
      tokenExpiresAt: Date.now() + 60_000,
    });
    const listener = vi.fn();
    window.addEventListener(TRADING_AUTH_REQUEST_EVENT, listener);
    expect(requireTradingAuth({
      source: 'quick-trade', side: 'SELL', symbol: 'EURUSD', volume: 0.1,
    })).toBe(true);
    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener(TRADING_AUTH_REQUEST_EVENT, listener);
  });

  it('reopens a captured order draft only after authentication', () => {
    const actions = {
      login: vi.fn(), closeDialog: vi.fn(), clearIntent: vi.fn(), openOrderDraft: vi.fn(),
    };
    const intent = { source: 'quick-trade' as const, side: 'BUY' as const, symbol: 'EURUSD', volume: 0.1 };
    completeTradingAuthentication('123456', intent, actions);
    expect(actions.login).toHaveBeenCalledWith('123456');
    expect(actions.openOrderDraft).toHaveBeenCalledWith(intent);
    expect(actions.clearIntent).toHaveBeenCalledOnce();
  });
});
