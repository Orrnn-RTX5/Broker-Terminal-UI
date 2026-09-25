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

const getStoredSessionBrokerId = (): string => {
  if (typeof window === 'undefined') return '';
  try {
    return String(window.localStorage.getItem('broker_id') || window.localStorage.getItem('rtx_broker_id') || '').trim();
  } catch {
    return '';
  }
};

/**
 * Registers against this terminal's broker. The caller cannot pass group: the
 * resolved broker and the backend's enabled default demo group are the
 * authority. The broker is the active session broker (the one the Navigator
 * shows) when present, otherwise the runtime-configured deployment broker.
 */
export const registerRuntimeBrokerDemoAccount = async (
  input: DemoRegistrationInput,
  policyBrokerId?: string,
): Promise<DemoRegistrationResponse> => {
  const configuredBrokerId = getRuntimeConfiguredBrokerId();
  const sessionBrokerId = getStoredSessionBrokerId();
  const brokerId = String(policyBrokerId || sessionBrokerId || configuredBrokerId).trim();
  if (!brokerId) {
    throw new Error('Demo registration is unavailable because this terminal has no broker configured.');
  }
  const allowedBrokerIds = [sessionBrokerId, configuredBrokerId]
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (allowedBrokerIds.length && !allowedBrokerIds.includes(brokerId.toLowerCase())) {
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
