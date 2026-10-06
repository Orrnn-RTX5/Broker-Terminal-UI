import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isInvestorRestrictedRequest, isInvestorToken } from './investorSession';
import { useInvestorSession } from '../hooks/useInvestorSession';
import { useAppStore } from '../store/useAppStore';
import { installTestBrokerRuntime } from '../test/brokerRuntime';
import { apiClient, setToken } from '../api/client';
import { brokerApi } from '../api/brokerApi';
import { TradeWebSocketClient } from '../api/tradeSocket';
import { ChangePasswordDialog } from '../components/ChangePasswordDialog';
import { hasAuthenticatedTradingSession, requireNewOrderAuth } from './tradingAuthGate';
import { normalizeBrokerAuthLoginPayload } from '../api/authLoginPayload';

const token = (investor: boolean) => `header.${btoa(JSON.stringify({ investor, broker_id: 'test-broker', account_login: 12345 }))}.signature`;
let restoreRuntime: () => void;
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  useAppStore.setState({ authToken: null, isAuthenticated: false, accountId: null, tokenExpiresAt: null });
  restoreRuntime = installTestBrokerRuntime();
  localStorage.setItem('broker_id', 'test-broker');
  localStorage.setItem('server_url', 'https://broker.example');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
});
afterEach(() => { restoreRuntime(); vi.unstubAllGlobals(); });

describe('investor access', () => {
  it('recognizes only the signed token investor boolean', () => {
    expect(isInvestorToken(token(true))).toBe(true);
    for (const value of [token(false), null, 'invalid', 'a.bnVsbA.b', `a.${btoa('{"investor":"true"}')}.b`]) {
      expect(isInvestorToken(value)).toBe(false);
    }
  });

  it('restores read-only mode, retains it on refresh, and clears it on account switch and logout', () => {
    setToken(token(true));
    const { result } = renderHook(useInvestorSession);
    expect(result.current).toBe(true);
    act(() => setToken(token(true)));
    expect(result.current).toBe(true);
    act(() => useAppStore.getState().setAuthToken(token(false)));
    expect(result.current).toBe(false);
    act(() => useAppStore.getState().setAuthToken(token(true)));
    expect(result.current).toBe(true);
    act(() => useAppStore.getState().logout());
    expect(result.current).toBe(false);
  });

  it.each([
    ['POST', '/orders'], ['PUT', '/positions/99'], ['DELETE', '/orders/pending/99'],
    ['POST', '/accounts/12345/close-all'], ['POST', '/accounts/12345/investor-password'],
    ['POST', '/auth/change-password'],
  ])('blocks %s %s before any HTTP request', async (method, endpoint) => {
    setToken(token(true));
    const options = { baseUrl: 'https://broker.example/api/v2' };
    const call = method === 'DELETE' ? apiClient.delete(endpoint, options)
      : method === 'PUT' ? apiClient.put(endpoint, {}, options) : apiClient.post(endpoint, {}, options);
    await expect(call).rejects.toMatchObject({ status: 403 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('also blocks the broker client and WebSocket placement', async () => {
    setToken(token(true));
    await expect(brokerApi.post('/orders', {})).rejects.toMatchObject({ status: 403 });
    const socket = new TradeWebSocketClient({ token: token(true), reconnect: false });
    await expect(socket.placeOrder({ account_login: 12345, symbol: 'EURUSD', side: 'buy', type: 'market', volume: 0.01 }))
      .rejects.toMatchObject({ code: 'INVESTOR_READ_ONLY' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('allows market/account reads, calculations and watchlist preferences', async () => {
    setToken(token(true));
    for (const [method, path] of [['GET', '/orders/12345'], ['GET', '/positions/12345'], ['POST', '/calculate/margin'], ['PUT', '/watchlist']]) {
      expect(isInvestorRestrictedRequest(method, path)).toBe(false);
    }
    await apiClient.get('/positions/12345', { baseUrl: 'https://broker.example/api/v2' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('blocks every WebSocket mutation action and type alias while retaining reads', () => {
    setToken(token(true));
    const socket = new TradeWebSocketClient({ token: token(true), reconnect: false });
    const send = vi.fn();
    Object.assign(socket, { ws: { readyState: 1, send }, hasCurrentDeploymentConnection: () => true });
    for (const action of ['place_order', 'place_pending_order', 'cancel_pending_order', 'modify_pending_order', 'close_position', 'modify_position']) {
      expect(socket.send({ action })).toBe(false);
      expect(socket.send({ type: action })).toBe(false);
    }
    expect(send).not.toHaveBeenCalled();
    expect(socket.send({ action: 'get_order_status' })).toBe(true);
    expect(socket.send({ action: 'subscribe', channel: 'positions' })).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('keeps master mutations enabled', async () => {
    setToken(token(false));
    await apiClient.post('/orders', {}, { baseUrl: 'https://broker.example/api/v2' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('disables investor password changes and trading auth gates without requesting guest login', () => {
    setToken(token(true));
    useAppStore.setState({ authToken: token(true), isAuthenticated: true, accountId: '12345' });
    const authRequest = vi.fn();
    window.addEventListener('rtx:request-trading-auth', authRequest);
    expect(hasAuthenticatedTradingSession()).toBe(false);
    expect(requireNewOrderAuth('EURUSD')).toBe(false);
    expect(authRequest).not.toHaveBeenCalled();
    window.removeEventListener('rtx:request-trading-auth', authRequest);
    render(<ChangePasswordDialog isOpen onClose={() => {}} accountLogin="12345" />);
    expect(screen.getByRole('button', { name: /change password/i })).toBeDisabled();
  });

  it('preserves an explicit login type while leaving automatic login unspecified', () => {
    expect(normalizeBrokerAuthLoginPayload({ login: 12345, password: 'fixture', login_type: 'investor' }))
      .toMatchObject({ login: 12345, login_type: 'investor' });
    expect(normalizeBrokerAuthLoginPayload({ login: 12345, password: 'fixture' })).not.toHaveProperty('login_type');
  });
});
