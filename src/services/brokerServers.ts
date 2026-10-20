import { brokerV2Api } from '../api/trade';
import {
  getRuntimeBrokerConfiguration,
  normalizeBrokerInfo,
  normalizeBrokerInfoForTarget,
  resolveBrokerBackendUrl,
  resolveBrokerDefaultMt5Server,
} from '../config/backendTarget.js';
import type { BrokerServer } from '../types/api';

// Neutral fallback display label for "no broker server known yet". This must stay
// brand-free: the brand-driven display name is resolved downstream by
// brokerDisplayName(), which reads the per-tenant broker-config (brokerName /
// defaultMt5Server) when the server matches the deployment. A module-level
// constant cannot read runtime config, so the fallback itself stays neutral.
// 'Broker' matches the existing neutral label brokerDisplayName() already uses
// for unknown/URL-like servers.
export const DEFAULT_BROKER_SERVER = 'Broker';
export const BROKER_SERVER_STORAGE_KEY = 'rtx_broker_server';

// Broker-neutral stored-server rule (white-label): on load, a remembered
// server is honoured ONLY when it belongs to the current broker's runtime
// server list (deployment runtime config). Anything else is discarded and
// the first configured server is used (neutral fallback when unconfigured).
// No brand names, no hashes, no per-broker special cases anywhere.
export interface RuntimeBrokerServerConfig {
  defaultMt5Server?: unknown;
  brokerId?: unknown;
  broker_id?: unknown;
  apiHost?: unknown;
  apiHostExt?: unknown;
}

const readRuntimeServerConfig = (): RuntimeBrokerServerConfig | null => {
  try {
    return getRuntimeBrokerConfiguration() as RuntimeBrokerServerConfig | null;
  } catch {
    return null;
  }
};

/** Servers the current broker deployment configures, display order first. */
export const getConfiguredBrokerServers = (): string[] => {
  const config = readRuntimeServerConfig();
  const seen = new Set<string>();
  const servers: string[] = [];
  for (const value of [config?.defaultMt5Server, config?.brokerId, config?.broker_id, config?.apiHost, config?.apiHostExt]) {
    const name = normalizeServerName(value);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    servers.push(name);
  }
  return servers;
};

const isConfiguredBrokerServer = (value: string): boolean => {
  const normalized = normalizeServerName(value).toLowerCase();
  if (!normalized) return false;
  return getConfiguredBrokerServers().some((server) => server.toLowerCase() === normalized);
};

const normalizeServerName = (value: unknown): string => String(value || '').trim();
/** True for the neutral fallback label (case-insensitive). */
export const isDefaultBrokerServerValue = (value: unknown): boolean =>
  normalizeServerName(value).toLowerCase() === DEFAULT_BROKER_SERVER.toLowerCase();
const isDefaultDisplayServer = (value: string): boolean => isDefaultBrokerServerValue(value);
const brokerServerRegistry = new Map<string, BrokerServer>();

export interface LoginBrokerTarget {
  displayValue: string;
  broker_id?: string;
  server?: string;
}

export const getStoredBrokerServer = (): string => {
  if (typeof window === 'undefined') return DEFAULT_BROKER_SERVER;
  const stored = normalizeServerName(localStorage.getItem(BROKER_SERVER_STORAGE_KEY));
  if (!stored || isDefaultBrokerServerValue(stored)) return DEFAULT_BROKER_SERVER;
  const configured = getConfiguredBrokerServers();
  // Unconfigured broker: no runtime list to validate against, so keep the
  // stored value (directory/desktop flows resolve it downstream). A
  // configured list is enforced strictly below.
  if (configured.length === 0) return stored;
  if (isConfiguredBrokerServer(stored)) return stored;
  // Not in the current broker's runtime list: discard, use first configured.
  return configured[0] || DEFAULT_BROKER_SERVER;
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
  const raw = normalizeServerName(serverInput);
  // Empty input carries no routing hint; normalize to neutral.
  const displayValue = !raw || isDefaultBrokerServerValue(raw) ? DEFAULT_BROKER_SERVER : raw;

  if (isDefaultDisplayServer(displayValue)) {
    return { displayValue };
  }

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
