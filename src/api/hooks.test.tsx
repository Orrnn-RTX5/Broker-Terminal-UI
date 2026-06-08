import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { normalizeBrokerServerUrl } from '../config/api';
import { useLogin } from './hooks';

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
  };
};

const expectedLoginUrl = (baseUrl: string) =>
  `${normalizeBrokerServerUrl(baseUrl)}/api/v2/auth/login`;

describe('useLogin', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      broker_id: 'testorrnn',
      account_login: 100001,
    })));
    localStorage.clear();
  });

  it('routes direct broker login through the selected base without emitting server credentials', async () => {
    const { result } = renderHook(() => useLogin());

    await act(async () => {
      await result.current.login({
        username: '100001',
        password: 'FixturePassword123',
        broker_id: 'testorrnn',
        server: 'https://testbroker.example',
      });
    });

    const request = lastFetchCall();
    expect(request.url).toBe(expectedLoginUrl('https://testbroker.example'));
    expect(request.body).toEqual({
      username: '100001',
      password: 'FixturePassword123',
      broker_id: 'testorrnn',
    });
    expect(request.body).not.toHaveProperty('server');
    expect(localStorage.getItem('server_url')).toBe('https://testbroker.example');
  });
});
