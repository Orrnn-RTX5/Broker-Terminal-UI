import { useEffect, useState } from 'react';
import {
  apiClient,
  ApiError,
  type ApiRequestContext,
  type ApiRequestOptions,
} from '../../api/client';
import { API_V2_BASE_URL, toLocalDevProxyUrl } from '../../config/api';
import {
  getAccessToken,
  getServerUrl,
  onSessionChange,
} from '../../services/brokerSession';

const toV2Endpoint = (endpoint: string): string =>
  endpoint.replace(/^\/api\/v2(?=\/|$)/, '') || '/';

export const getApiRootBaseUrl = (): string => API_V2_BASE_URL.replace(/\/api\/v2\/?$/, '');

const resolveRestEndpoint = (endpoint: string): { baseUrl: string; endpoint: string } =>
  endpoint.startsWith('/api/v2')
    ? { baseUrl: API_V2_BASE_URL, endpoint: toV2Endpoint(endpoint) }
    : { baseUrl: getApiRootBaseUrl(), endpoint };

export const fetchMarketDataJson = async <T,>(
  endpoint: string,
  params?: Record<string, unknown>,
): Promise<T> => {
  const request = resolveRestEndpoint(endpoint);
  return apiClient.get<T>(request.endpoint, { baseUrl: request.baseUrl, params });
};

export interface ApiSessionDescriptor {
  storageScopeKey: string;
  v2BaseUrl: string;
  apiRootBaseUrl: string;
  accountId: string;
  brokerId: string;
}

export interface CapturedApiSession extends ApiSessionDescriptor {
  runtimeKey: string;
  authToken: string | null;
  requestContext: ApiRequestContext | null;
}

let apiSessionGeneration = 0;
const apiSessionIdentities = new Map<string, {
  tokenFingerprint: string;
  v2BaseUrl: string;
  runtimeKey: string;
}>();

const apiSessionFingerprintSeed = (() => {
  const seed = new Uint32Array(2);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(seed);
  } else {
    seed[0] = Math.floor(Math.random() * 0xffffffff);
    seed[1] = Math.floor(Math.random() * 0xffffffff);
  }
  return seed;
})();

const getOpaqueSessionFingerprint = (token: string): string => {
  let left = (0x811c9dc5 ^ apiSessionFingerprintSeed[0]) >>> 0;
  let right = (0x9e3779b9 ^ apiSessionFingerprintSeed[1]) >>> 0;
  for (let index = 0; index < token.length; index += 1) {
    const code = token.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193) >>> 0;
    right = Math.imul(right ^ code, 0x85ebca6b) >>> 0;
  }
  return `${left.toString(36)}.${right.toString(36)}`;
};

export const getStoredBrokerId = (): string => {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem('broker_id')
    || window.localStorage.getItem('rtx_broker_id')
    || '';
};

export const normalizeMarketDataScopePart = (value: unknown): string =>
  encodeURIComponent(String(value ?? '').trim() || 'default');

export const getApiSessionDescriptor = (accountId: string): ApiSessionDescriptor => {
  const serverUrl = getServerUrl().replace(/\/+$/, '');
  const v2BaseUrl = serverUrl
    ? `${toLocalDevProxyUrl(serverUrl)}/api/v2`
    : API_V2_BASE_URL;
  const apiRootBaseUrl = v2BaseUrl.replace(/\/api\/v2\/?$/, '');
  const brokerId = getStoredBrokerId();
  const storageScopeKey = [v2BaseUrl, brokerId, accountId]
    .map(normalizeMarketDataScopePart)
    .join('|');
  return { storageScopeKey, v2BaseUrl, apiRootBaseUrl, accountId, brokerId };
};

export const captureApiSession = (
  descriptor: ApiSessionDescriptor,
  storeAuthToken: string | null,
  storeRefreshToken: string | null,
): CapturedApiSession | null => {
  const authToken = getAccessToken() || storeAuthToken;
  if (!authToken) return null;
  const refreshToken = typeof window === 'undefined'
    ? storeRefreshToken
    : window.localStorage.getItem('refresh_token')
      || window.sessionStorage.getItem('refresh_token')
      || storeRefreshToken;
  const tokenFingerprint = getOpaqueSessionFingerprint(`${authToken}\u0000${refreshToken ?? ''}`);
  const previous = apiSessionIdentities.get(descriptor.storageScopeKey);
  const runtimeKey = previous
    && previous.tokenFingerprint === tokenFingerprint
    && previous.v2BaseUrl === descriptor.v2BaseUrl
    ? previous.runtimeKey
    : `${descriptor.storageScopeKey}|session:${++apiSessionGeneration}`;

  if (!previous || previous.runtimeKey !== runtimeKey) {
    apiSessionIdentities.set(descriptor.storageScopeKey, {
      tokenFingerprint,
      v2BaseUrl: descriptor.v2BaseUrl,
      runtimeKey,
    });
  }

  return {
    ...descriptor,
    runtimeKey,
    authToken,
    requestContext: Object.freeze({
      key: runtimeKey,
      backendOrigin: descriptor.apiRootBaseUrl,
      refreshEndpoint: `${descriptor.v2BaseUrl}/auth/refresh`,
      refreshToken,
    }),
  };
};

export const getCapturedRequestOptions = (
  session: CapturedApiSession,
  baseUrl: string,
  signal?: AbortSignal,
): ApiRequestOptions => {
  if (!session.authToken || !session.requestContext) {
    throw new ApiError(401, 'Captured API session is no longer active');
  }
  return {
    baseUrl,
    authToken: session.authToken,
    requestContext: session.requestContext,
    skipDynamicUrl: true,
    signal,
  };
};

export const useBrokerSessionRevision = (): number => {
  const [revision, setRevision] = useState(0);
  useEffect(() => onSessionChange(() => setRevision((current) => current + 1)), []);
  return revision;
};
