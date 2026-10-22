import { API_V2_BASE_URL } from '../config/api';
import { getRuntimeBrokerConfiguration, isDesktopBackendTarget } from '../config/backendTarget.js';
import { toLocalDevProxyUrl } from '../config/localDevProxy';
import { apiClient } from './client';
import type { AccountClassificationFields } from '../types/api';

export interface DemoRegistrationInput {
  name: string;
  email: string;
  password: string;
}

export interface DemoRegistrationResponse extends AccountClassificationFields {
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
 * authority. Web registration always uses the deployment identity and API;
 * desktop registration can use the selected session broker.
 */
export const registerRuntimeBrokerDemoAccount = async (
  input: DemoRegistrationInput,
  policyBrokerId?: string,
): Promise<DemoRegistrationResponse> => {
  const configuration = getRuntimeBrokerConfiguration();
  const desktop = isDesktopBackendTarget();
  if (!desktop && !configuration.valid) {
    throw new Error('Demo registration is unavailable because this terminal has no valid broker configuration.');
  }
  const configuredBrokerId = configuration.brokerId;
  const sessionBrokerId = getStoredSessionBrokerId();
  const brokerId = String(desktop ? policyBrokerId || sessionBrokerId || configuredBrokerId : configuredBrokerId).trim();
  if (!brokerId) {
    throw new Error('Demo registration is unavailable because this terminal has no broker configured.');
  }
  const allowedBrokerIds = (desktop ? [sessionBrokerId, configuredBrokerId] : [configuredBrokerId])
    .map(value => value.trim()).filter(Boolean);
  if ((policyBrokerId && policyBrokerId.trim() !== brokerId)
    || (allowedBrokerIds.length && !allowedBrokerIds.includes(brokerId))) {
    throw new Error('Demo registration broker does not match this terminal deployment.');
  }

  const response = await apiClient.post<DemoRegistrationResponse>('/auth/register', {
    email: input.email.trim(),
    username: input.email.trim(),
    password: input.password,
    name: input.name.trim(),
    broker_id: brokerId,
  }, {
    baseUrl: desktop ? API_V2_BASE_URL : `${toLocalDevProxyUrl(configuration.apiHostExt.replace(/\/+$/, ''))}/api/v2`,
    skipDynamicUrl: true,
    skipAuth: true,
  });

  if (!desktop && JSON.stringify(getRuntimeBrokerConfiguration()) !== JSON.stringify(configuration)) {
    throw new Error('The broker configuration changed during demo registration. Please log in manually.');
  }
  if (response.broker_id && response.broker_id.trim() !== brokerId) {
    throw new Error('The demo account was returned for a different broker.');
  }
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
