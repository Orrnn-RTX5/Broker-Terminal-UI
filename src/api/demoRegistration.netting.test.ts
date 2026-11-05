/**
 * #21 terminal demo NETTING sign-up: request flag, response check, error copy
 * and the availability read. Fixtures are neutral (no real broker, host or login).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  class ApiError extends Error {
    constructor(public status: number, message: string, public data?: unknown) {
      super(message);
      this.name = 'ApiError';
    }
  }
  return { ApiError, post: vi.fn(), get: vi.fn() };
});

vi.mock('./client', () => ({ ApiError: mocks.ApiError, apiClient: { post: mocks.post, get: mocks.get } }));
vi.mock('../config/api', () => ({ API_V2_BASE_URL: 'https://stale.example/api/v2' }));

import {
  DEMO_ACCOUNT_MODE_MISMATCH_MESSAGE,
  DEMO_NETTING_NOT_CONFIGURED_MESSAGE,
  DEMO_NETTING_UNAVAILABLE_MESSAGE,
  loadDemoRegistrationModes,
  registerRuntimeBrokerDemoAccount,
} from './demoRegistration';

const runtime = window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> };
const BROKER = 'broker-alpha';
const BASE = 'https://broker.example/api/v2';
const input = { name: ' Demo User ', email: ' demo@example.test ', password: 'Password1' };
const hedgingBody = {
  email: 'demo@example.test', username: 'demo@example.test', password: 'Password1', name: 'Demo User', broker_id: BROKER,
};
const requestOptions = { baseUrl: BASE, skipAuth: true, skipDynamicUrl: true };
const configure = () => {
  runtime.__RTX_RUNTIME_CONFIG__ = {
    CONFIG_SOURCE: 'deployment', API_HOST: 'https://broker.example', WS_HOST: 'wss://broker.example',
    BROKER_ID: BROKER, DEFAULT_MT5_SERVER: 'Configured server',
  };
};
const created = (mode?: string) => ({
  token: 'demo-token', login: 700001, broker_id: BROKER, ...(mode === undefined ? {} : { account_mode: mode }),
});

beforeEach(() => {
  localStorage.clear();
  mocks.post.mockReset();
  mocks.get.mockReset();
  configure();
});
afterEach(() => {
  delete runtime.__RTX_RUNTIME_CONFIG__;
  localStorage.clear();
});

describe('demo registration account mode', () => {
  it('keeps the hedging request body exactly as before (no account_mode field)', async () => {
    mocks.post.mockResolvedValue(created());
    await registerRuntimeBrokerDemoAccount(input);
    await registerRuntimeBrokerDemoAccount({ ...input, accountMode: 'hedging' });
    expect(mocks.post).toHaveBeenNthCalledWith(1, '/auth/register', hedgingBody, requestOptions);
    expect(mocks.post).toHaveBeenNthCalledWith(2, '/auth/register', hedgingBody, requestOptions);
  });

  it('sends exactly account_mode "netting" for a netting request and never a group', async () => {
    mocks.post.mockResolvedValue(created('netting'));
    await expect(registerRuntimeBrokerDemoAccount({ ...input, accountMode: 'netting' }, BROKER))
      .resolves.toMatchObject({ account_login: 700001, account_mode: 'netting', broker_id: BROKER });
    expect(mocks.post).toHaveBeenCalledExactlyOnceWith(
      '/auth/register', { ...hedgingBody, account_mode: 'netting' }, requestOptions,
    );
    expect(mocks.post.mock.calls[0][1]).not.toHaveProperty('group');
  });

  it('accepts the netting confirmation case-insensitively', async () => {
    mocks.post.mockResolvedValue(created(' NETTING '));
    await expect(registerRuntimeBrokerDemoAccount({ ...input, accountMode: 'netting' })).resolves.toBeTruthy();
  });

  it.each([undefined, 'hedging', '', 'x'])('fails closed when a netting request comes back as %s', async (mode) => {
    mocks.post.mockResolvedValue(created(mode));
    await expect(registerRuntimeBrokerDemoAccount({ ...input, accountMode: 'netting' }))
      .rejects.toThrow(DEMO_ACCOUNT_MODE_MISMATCH_MESSAGE);
  });

  it('fails closed when a hedging request comes back as netting', async () => {
    mocks.post.mockResolvedValue(created('netting'));
    await expect(registerRuntimeBrokerDemoAccount(input)).rejects.toThrow(DEMO_ACCOUNT_MODE_MISMATCH_MESSAGE);
  });

  it.each([undefined, 'hedging'])('accepts a hedging response with account_mode %s (older backends omit it)', async (mode) => {
    mocks.post.mockResolvedValue(created(mode));
    await expect(registerRuntimeBrokerDemoAccount(input)).resolves.toMatchObject({ account_login: 700001 });
  });

  it.each([
    ['DEMO_NETTING_NOT_CONFIGURED', DEMO_NETTING_NOT_CONFIGURED_MESSAGE],
    ['DEMO_NETTING_UNAVAILABLE', DEMO_NETTING_UNAVAILABLE_MESSAGE],
  ])('maps the backend code %s to clear copy', async (code, message) => {
    mocks.post.mockRejectedValue(new mocks.ApiError(503, 'raw backend text', { error: code, message: 'raw backend text' }));
    await expect(registerRuntimeBrokerDemoAccount({ ...input, accountMode: 'netting' })).rejects.toThrow(message);
  });

  it('keeps every other backend error unchanged', async () => {
    const original = new mocks.ApiError(429, 'Too many demo registrations', { error: 'DEMO_REGISTRATION_RATE_LIMITED' });
    mocks.post.mockRejectedValue(original);
    await expect(registerRuntimeBrokerDemoAccount({ ...input, accountMode: 'netting' })).rejects.toBe(original);
    const network = new TypeError('Failed to fetch');
    mocks.post.mockRejectedValue(network);
    await expect(registerRuntimeBrokerDemoAccount(input)).rejects.toBe(network);
  });
});

describe('demo netting availability (GET broker/config)', () => {
  it('reads the same broker API as registration, anonymously, for this broker', async () => {
    mocks.get.mockResolvedValue({ broker_id: BROKER, demo_registration_enabled: true, demo_netting_registration_enabled: true });
    await expect(loadDemoRegistrationModes(BROKER)).resolves.toEqual({ hedging: true, netting: true });
    expect(mocks.get).toHaveBeenCalledExactlyOnceWith('/broker/config', {
      ...requestOptions, params: { broker_id: BROKER }, signal: undefined,
    });
  });

  it('passes an explicit hedging-off flag through', async () => {
    mocks.get.mockResolvedValue({ demo_registration_enabled: false, demo_netting_registration_enabled: true });
    await expect(loadDemoRegistrationModes(BROKER)).resolves.toEqual({ hedging: false, netting: true });
  });

  it.each([
    ['missing', {}],
    ['false', { demo_netting_registration_enabled: false }],
    ['a string', { demo_netting_registration_enabled: 'true' }],
    ['a number', { demo_netting_registration_enabled: 1 }],
    ['another broker', { broker_id: 'other-broker', demo_netting_registration_enabled: true }],
    ['not an object', null],
  ])('hides netting when the flag is %s', async (_label, payload) => {
    mocks.get.mockResolvedValue(payload);
    await expect(loadDemoRegistrationModes(BROKER)).resolves.toMatchObject({ netting: false });
  });

  it('hides netting when the config read fails', async () => {
    mocks.get.mockRejectedValue(new mocks.ApiError(503, 'unavailable', { error: 'BROKER_CONFIG_UNAVAILABLE' }));
    await expect(loadDemoRegistrationModes(BROKER)).resolves.toEqual({ hedging: null, netting: false });
  });

  it('does not read anything for a broker that is not this deployment', async () => {
    await expect(loadDemoRegistrationModes('other-broker')).resolves.toEqual({ hedging: null, netting: false });
    delete runtime.__RTX_RUNTIME_CONFIG__;
    await expect(loadDemoRegistrationModes()).resolves.toEqual({ hedging: null, netting: false });
    expect(mocks.get).not.toHaveBeenCalled();
  });
});
