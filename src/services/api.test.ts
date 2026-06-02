import { beforeEach, describe, expect, it, vi } from 'vitest';

import { authApi as endpointAuthApi } from '../api/endpoints';
import { normalizeBrokerServerUrl } from '../config/api';
import { api } from './api';

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });

const lastFetchCall = () => {
  const call = vi.mocked(fetch).mock.calls.at(-1);
  if (!call) throw new Error('Expected fetch to be called');
  return {
    url: String(call[0]),
    init: call[1] as RequestInit,
    body: call[1]?.body ? JSON.parse(String(call[1].body)) : undefined,
    headers: call[1]?.headers as Record<string, string>,
  };
};

const expectedLoginUrl = (baseUrl: string) =>
  `${normalizeBrokerServerUrl(baseUrl)}/api/v2/auth/login`;

describe('broker server URL normalization', () => {
  it('drops the HTTPS default port when forcing broker traffic to HTTP', () => {
    expect(normalizeBrokerServerUrl('https://103.91.186.142:443')).toBe('http://103.91.186.142');
    expect(normalizeBrokerServerUrl('http://103.91.186.142:443')).toBe('http://103.91.186.142');
    expect(normalizeBrokerServerUrl('https://103.91.186.142:8443')).toBe('http://103.91.186.142:8443');
  });
});

type TestWindow = Window & { electronAPI?: unknown };

describe('login payload normalization', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      broker_id: 'testorrnn',
      account_login: 900001,
    })));
    delete (window as TestWindow).electronAPI;
    localStorage.clear();
  });

  it('strips legacy server credentials from the lower auth endpoint payload', async () => {
    await endpointAuthApi.login({
      username: '900001',
      password: 'TestPass1234',
      broker_id: 'testorrnn',
      server: 'https://legacy-payload.example',
    }, { baseUrl: 'https://testbroker.example' });

    const request = lastFetchCall();
    expect(request.url).toBe(expectedLoginUrl('https://testbroker.example'));
    expect(request.body).toEqual({
      username: '900001',
      password: 'TestPass1234',
      broker_id: 'testorrnn',
    });
    expect(request.body).not.toHaveProperty('server');
  });

  it('maps lower auth login aliases to username and emits only whitelisted fields', async () => {
    await endpointAuthApi.login({
      login: 900001,
      email: 'ignored@example.com',
      password: 'TestPass1234',
      broker_id: 'testorrnn',
      server: 'https://legacy-payload.example',
    }, { baseUrl: 'https://testbroker.example' });

    const request = lastFetchCall();
    expect(request.body).toEqual({
      username: 900001,
      password: 'TestPass1234',
      broker_id: 'testorrnn',
    });
    expect(request.body).not.toHaveProperty('login');
    expect(request.body).not.toHaveProperty('email');
    expect(request.body).not.toHaveProperty('server');
  });

  it('routes api.auth.login to the selected broker base without stale server rewrite or aliases', async () => {
    (window as TestWindow).electronAPI = {};
    localStorage.setItem('server_url', 'https://stale-broker.example');

    await api.auth.login('900001', 'TestPass1234', {
      broker_id: 'testorrnn',
      server: 'https://testbroker.example',
    });

    const request = lastFetchCall();
    expect(request.url).toBe('http://testbroker.example/api/v2/auth/login');
    expect(request.headers.Authorization).toBeUndefined();
    expect(request.body).toEqual({
      username: '900001',
      password: 'TestPass1234',
      broker_id: 'testorrnn',
    });
    expect(request.body).not.toHaveProperty('login');
    expect(request.body).not.toHaveProperty('server');
    expect(localStorage.getItem('server_url')).toBe('http://testbroker.example');
  });
});
