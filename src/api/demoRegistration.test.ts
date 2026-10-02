import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from './client';
import { registerRuntimeBrokerDemoAccount } from './demoRegistration';

vi.mock('./client', () => ({ apiClient: { post: vi.fn() } }));
vi.mock('../config/api', () => ({ API_V2_BASE_URL: 'https://stale.example/api/v2' }));

const runtime = window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> };
const input = { name: 'Demo User', email: 'demo@example.test', password: 'Password1' };
const configure = (brokerId = 'Orrnn', apiHost = 'https://broker.example') => {
  runtime.__RTX_RUNTIME_CONFIG__ = {
    CONFIG_SOURCE: 'deployment', API_HOST: apiHost, WS_HOST: apiHost.replace('https:', 'wss:'),
    BROKER_ID: brokerId, DEFAULT_MT5_SERVER: 'Configured server',
  };
};

describe('deployment-bound demo registration', () => {
  beforeEach(() => { localStorage.clear(); vi.mocked(apiClient.post).mockReset(); configure(); });
  afterEach(() => { delete runtime.__RTX_RUNTIME_CONFIG__; localStorage.clear(); });

  it.each(['Orrnn', 'new-broker-42'])('registers only with configured broker %s despite a stale session', async brokerId => {
    configure(brokerId);
    localStorage.setItem('broker_id', 'other-broker');
    vi.mocked(apiClient.post).mockResolvedValue({ token: 'demo-token', login: 123, broker_id: brokerId });
    await expect(registerRuntimeBrokerDemoAccount(input)).resolves.toMatchObject({ broker_id: brokerId });
    expect(apiClient.post).toHaveBeenCalledWith('/auth/register', expect.objectContaining({ broker_id: brokerId }), {
      baseUrl: 'https://broker.example/api/v2', skipAuth: true, skipDynamicUrl: true,
    });
  });

  it.each(['orrnn', 'other-broker'])('rejects a caller requesting %s before sending personal details', async brokerId => {
    localStorage.setItem('broker_id', brokerId);
    await expect(registerRuntimeBrokerDemoAccount(input, brokerId)).rejects.toThrow('does not match');
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('refuses incomplete deployment settings', async () => {
    runtime.__RTX_RUNTIME_CONFIG__ = { CONFIG_SOURCE: 'deployment', BROKER_ID: 'Orrnn' };
    await expect(registerRuntimeBrokerDemoAccount(input)).rejects.toThrow('no valid broker configuration');
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it.each(['orrnn', 'other-broker'])('rejects a response belonging to %s', async brokerId => {
    vi.mocked(apiClient.post).mockResolvedValue({ token: 'wrong-token', login: 123, broker_id: brokerId });
    await expect(registerRuntimeBrokerDemoAccount(input)).rejects.toThrow('different broker');
  });

  it('rejects an in-flight result after deployment configuration changes', async () => {
    vi.mocked(apiClient.post).mockImplementation(async () => {
      configure('new-broker', 'https://new.example');
      return { token: 'old-token', login: 123, broker_id: 'Orrnn' };
    });
    await expect(registerRuntimeBrokerDemoAccount(input)).rejects.toThrow('configuration changed');
  });
});
