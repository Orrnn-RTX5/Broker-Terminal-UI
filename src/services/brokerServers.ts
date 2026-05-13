import { brokerV2Api } from '../api/trade';
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
  const resolvedServer = normalizeServerName(server) || DEFAULT_BROKER_SERVER;
  if (typeof window !== 'undefined') {
    localStorage.setItem(BROKER_SERVER_STORAGE_KEY, resolvedServer);
  }
  return resolvedServer;
};

const toServerName = (server: BrokerServer | string): string => {
  if (typeof server === 'string') return normalizeServerName(server);
  return normalizeServerName(server.server);
};

const rememberBrokerServer = (server: BrokerServer): void => {
  const values = [
    server.server,
    server.broker_id,
    server.broker_name,
  ].map(normalizeServerName).filter(Boolean);

  values.forEach((value) => brokerServerRegistry.set(value.toLowerCase(), server));
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
    return { displayValue, broker_id: normalizeServerName(registeredServer.broker_id) };
  }

  return { displayValue, broker_id: displayValue };
};
