import { brokerV2Api } from '../api/trade';
import {
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

// Pre-white-label fallback label, recognised ONLY by digest so the retired
// brand string ships in no bundle. Behaviour is identical to comparing the
// lowercased value: FNV-1a-32 of 'rtx 5 web terminal' (the retired default).
// Recompute: node -e "let h=2166136261>>>0;for(const c of 'rtx 5 web terminal'){h^=c.codePointAt(0);h=Math.imul(h,16777619)>>>0}console.log(h.toString(16))"
// Kept ONLY to migrate previously stored state (localStorage / in-flight
// inputs); never shown to users and never used for routing.
const RETIRED_DEFAULT_DIGEST = 'f785e678';

const fnv1a32Hex = (value: string): string => {
  let hash = 2166136261 >>> 0;
  for (const ch of value) {
    hash ^= ch.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
};

const normalizeServerName = (value: unknown): string => String(value || '').trim();
/** True for the neutral fallback and the migrated legacy label (case-insensitive). */
export const isDefaultBrokerServerValue = (value: unknown): boolean => {
  const normalized = normalizeServerName(value).toLowerCase();
  return normalized === DEFAULT_BROKER_SERVER.toLowerCase()
    || fnv1a32Hex(normalized) === RETIRED_DEFAULT_DIGEST;
};
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
  // Previously stored legacy labels migrate to the neutral fallback on read.
  return !stored || isDefaultBrokerServerValue(stored) ? DEFAULT_BROKER_SERVER : stored;
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
  // Empty and legacy fallback labels carry no routing hint; normalize to neutral.
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
