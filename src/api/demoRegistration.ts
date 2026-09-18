import { API_V2_BASE_URL } from '../config/api';
import { getRuntimeConfiguredBrokerId } from '../config/backendTarget.js';
import { apiClient } from './client';

export interface DemoRegistrationInput {
  name: string;
  email: string;
  password: string;
}

export interface DemoRegistrationResponse {
  access_token?: string;
  token?: string;
  refresh_token?: string;
  expires_at?: number | string;
  expires_in?: number;
  login?: number | string;
  account_login?: number | string;
  broker_id?: string;
  broker_name?: string;
  server?: string;
  group?: string;
  name?: string;
  username?: string;
}

/**
 * Registers against this terminal deployment's broker. The caller cannot pass
 * broker_id or group: the runtime-configured broker and the backend's enabled
 * default demo group are the authority for both values.
 */
export const registerRuntimeBrokerDemoAccount = async (
  input: DemoRegistrationInput,
  policyBrokerId?: string,
): Promise<DemoRegistrationResponse> => {
  const configuredBrokerId = getRuntimeConfiguredBrokerId();
  const brokerId = String(policyBrokerId || configuredBrokerId).trim();
  if (!brokerId) {
    throw new Error('Demo registration is unavailable because this terminal has no broker configured.');
  }
  if (configuredBrokerId && configuredBrokerId.toLowerCase() !== brokerId.toLowerCase()) {
    throw new Error('Demo registration broker does not match this terminal deployment.');
  }

  const response = await apiClient.post<DemoRegistrationResponse>('/auth/register', {
    email: input.email.trim(),
    username: input.email.trim(),
    password: input.password,
    name: input.name.trim(),
    broker_id: brokerId,
  }, {
    baseUrl: API_V2_BASE_URL,
    skipAuth: true,
  });

  const token = response.access_token || response.token;
  const login = response.account_login ?? response.login;
  if (!token || !login) {
    throw new Error('Demo account was created without a usable trading session. Please log in manually.');
  }

  return {
    ...response,
    access_token: token,
    token,
    account_login: login,
    broker_id: response.broker_id || brokerId,
  };
};
