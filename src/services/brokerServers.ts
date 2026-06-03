import { brokerV2Api } from '../api/trade';
import {
  normalizeBrokerInfo,
  normalizeBrokerInfoForTarget,
  resolveBrokerBackendUrl,
  resolveBrokerDefaultMt5Server,
} from '../config/backendTarget.js';
import type { BrokerServer } from '../types/api';

export const DEFAULT_BROKER_SERVER = 'FlexyMarkets-Server';
export const BROKER_SERVER_STORAGE_KEY = 'rtx_broker_server';

const normalizeServerName = (value: unknown): string => String(value || '').trim();
const brokerServerRegistry = new Map<string, BrokerServer>();

export interface LoginBrokerTarget {
  displayValue: string;
  broker_id?: string;
  server?: string;
}

export const getStoredBrokerServer = (): string => {
  if (typeof window === 'undefined') return DEFAULT_BROKER_SERVER;
  return normalizeServerName(localStorage.getItem(BROKER_SERVER_STORAGE_KEY)) || DEFAULT_BROKER_SERVER;
};

export const persistBrokerServer = (server: string): string => {
  const normalized = normalizeBrokerInfoForTarget({ server_url: server, server });
  const resolvedServer = normalizeServerName(normalized.broker_server || normalized.server_url || server) || DEFAULT_BROKER_SERVER;
  if (typeof window !== 'undefined') {
    localStorage.setItem(BROKER_SERVER_STORAGE_KEY, resolvedServer);
    if (normalized.server_url) localStorage.setItem('server_url', normalized.server_url);
    if (normalized.backend_url) localStorage.setItem('backend_url', normalized.backend_url);
    if (normalized.market_api_url) localStorage.setItem('market_api_url', normalized.market_api_url);
  }
  return resolvedServer;
};

const toServerName = (server: BrokerServer | string): string => {
  if (typeof server === 'string') return normalizeServerName(server);
  return normalizeServerName(resolveBrokerDefaultMt5Server(server));
};

const rememberBrokerServer = (server: BrokerServer): void => {
  const normalizedServer = normalizeBrokerInfo(server) as BrokerServer;
  const values = [
    normalizedServer.server,
    normalizedServer.server_url,
    normalizedServer.backend_url,
    normalizedServer.market_api_url,
    normalizedServer.broker_id,
    normalizedServer.broker_name,
  ].map(normalizeServerName).filter(Boolean);

  values.forEach((value) => brokerServerRegistry.set(value.toLowerCase(), normalizedServer));
};

const getBrokerServerUrl = (server: BrokerServer): string => {
  const explicitUrl = normalizeServerName(resolveBrokerBackendUrl(server));
  if (explicitUrl) return explicitUrl;

  const serverValue = normalizeServerName(server.server);
  return looksLikeBrokerServerAddress(serverValue) ? serverValue : '';
};

export const normalizeBrokerServers = (servers: Array<BrokerServer | string>): string[] => {
  const names = servers.map((server) => {
    if (typeof server !== 'string') rememberBrokerServer(server);
    return toServerName(server);
  }).filter(Boolean);
  return Array.from(new Set(names));
};

export const loadBrokerServers = async (): Promise<string[]> => {
  const servers = await brokerV2Api.getServers();
  return normalizeBrokerServers(servers);
};

const looksLikeBrokerServerAddress = (value: string): boolean => {
  if (!value) return false;
  if (/^[^:\s]+:\d{2,5}$/.test(value)) return true;

  try {
    const hasExplicitProtocol = value.includes('://');
    const url = new URL(hasExplicitProtocol ? value : `tcp://${value}`);
    return Boolean(url.hostname && (hasExplicitProtocol || url.port));
  } catch {
    return false;
  }
};

export const resolveLoginBrokerTarget = (serverInput: string): LoginBrokerTarget => {
  const displayValue = normalizeServerName(serverInput) || DEFAULT_BROKER_SERVER;

  if (looksLikeBrokerServerAddress(displayValue)) {
    return { displayValue, server: displayValue };
  }

  const registeredServer = brokerServerRegistry.get(displayValue.toLowerCase());

  if (registeredServer?.broker_id) {
    const server = getBrokerServerUrl(registeredServer);
    return {
      displayValue,
      broker_id: normalizeServerName(registeredServer.broker_id),
      ...(server ? { server } : {}),
    };
  }

  return { displayValue, broker_id: displayValue };
};
