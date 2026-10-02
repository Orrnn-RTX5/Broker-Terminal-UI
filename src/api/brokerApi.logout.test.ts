// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrokerAPI } from './brokerApi';
import { useAppStore } from '../store/useAppStore';

describe('logout during broker token refresh', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('broker_id', 'Fixture');
    localStorage.setItem('server_url', 'https://broker.example');
    (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__ = {
      backendTarget: 'desktop', API_HOST: 'https://broker.example', WS_HOST: 'wss://broker.example',
      BROKER_ID: 'Fixture', DEFAULT_MT5_SERVER: 'Fixture-Live',
    };
    useAppStore.getState().reset();
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    useAppStore.getState().setAuthenticated(true, '200001', 'old-access', 'old-refresh', Date.now() + 30_000);
    useAppStore.getState().setAuthTokens('old-access', 'old-refresh', Date.now() + 30_000);
  });

  afterEach(() => {
    delete (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__;
    vi.unstubAllGlobals();
  });

  it('does not restore credentials when a pending refresh finishes after logout', async () => {
    let complete!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { complete = resolve; })));
    const pending = new BrokerAPI().checkAndProactiveRefresh();

    useAppStore.getState().logout();
    complete(new Response(JSON.stringify({ access_token: 'late-access', refresh_token: 'late-refresh', expires_in: 3600 })));

    await expect(pending).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
    expect(localStorage.getItem('auth_token')).toBeNull();
    expect(localStorage.getItem('refresh_token')).toBeNull();
    expect(useAppStore.getState()).toMatchObject({ isAuthenticated: false, authToken: null });
  });

  it('does not clear a new login when the previous session refresh fails', async () => {
    let complete!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { complete = resolve; })));
    const pending = new BrokerAPI().checkAndProactiveRefresh();

    useAppStore.getState().logout();
    useAppStore.getState().setAuthenticated(true, '200002', 'new-access', 'new-refresh', Date.now() + 3600_000);
    useAppStore.getState().setAuthTokens('new-access', 'new-refresh', Date.now() + 3600_000);
    complete(new Response('{}', { status: 401 }));

    await expect(pending).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
    expect(localStorage.getItem('auth_token')).toBe('new-access');
    expect(useAppStore.getState()).toMatchObject({ isAuthenticated: true, accountId: '200002', authToken: 'new-access' });
  });

  it('still coalesces a valid refresh and commits its tokens', async () => {
    let complete!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>(resolve => { complete = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    const api = new BrokerAPI();
    const first = api.checkAndProactiveRefresh();
    const second = api.checkAndProactiveRefresh();
    expect(fetchMock).toHaveBeenCalledOnce();

    complete(new Response(JSON.stringify({ access_token: 'renewed-access', refresh_token: 'renewed-refresh', expires_in: 3600 })));

    await expect(Promise.all([first, second])).resolves.toEqual(['renewed-access', 'renewed-access']);
    expect(localStorage.getItem('auth_token')).toBe('renewed-access');
    expect(useAppStore.getState()).toMatchObject({ isAuthenticated: true, accountId: '200001', authToken: 'renewed-access' });
  });

  it('gives a newly signed-in account its own refresh while the old refresh is still pending', async () => {
    const completions: Array<(response: Response) => void> = [];
    const fetchMock = vi.fn(() => new Promise<Response>(resolve => { completions.push(resolve); }));
    vi.stubGlobal('fetch', fetchMock);
    const api = new BrokerAPI();
    const previous = api.checkAndProactiveRefresh();
    useAppStore.getState().logout();
    useAppStore.getState().setAuthenticated(true, '200002', 'new-access', 'new-refresh', Date.now() + 30_000);
    useAppStore.getState().setAuthTokens('new-access', 'new-refresh', Date.now() + 30_000);
    const current = api.checkAndProactiveRefresh();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    completions[0](new Response(JSON.stringify({ access_token: 'obsolete-access' })));
    await expect(previous).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
    const joined = api.checkAndProactiveRefresh();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    completions[1](new Response(JSON.stringify({ access_token: 'renewed-access', refresh_token: 'renewed-refresh', expires_in: 3600 })));

    await expect(Promise.all([current, joined])).resolves.toEqual(['renewed-access', 'renewed-access']);
    expect(useAppStore.getState()).toMatchObject({ isAuthenticated: true, accountId: '200002', authToken: 'renewed-access' });
  });
});
