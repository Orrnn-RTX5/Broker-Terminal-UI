import {
  getBackendTarget,
  getRuntimeConfiguredBrokerId,
} from '../config/backendTarget.js';
import type { BrokerDiscoveryItem } from './brokerDiscovery';

export interface BrokerLoginPolicy {
  status: 'ready' | 'error';
  brokerId: string;
  displayName: string;
  locked: true;
  local: boolean;
  error?: string;
}

const DOMAIN_FIELDS = [
  'domain', 'domains', 'webterminal_domain', 'web_terminal_domain',
  'webterminal_url', 'web_terminal_url', 'frontend_domain', 'frontend_url',
  'client_domain', 'client_url', 'login_domain', 'login_url',
] as const;

const TARGET_FIELDS = [
  'server_url', 'backend_url', 'market_api_url', 'public_backend_url',
  'web_backend_url', 'services_url',
] as const;

const normalizeId = (value: unknown): string => String(value ?? '').trim().toLowerCase();

const hostnameOf = (value: unknown): string => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  try {
    const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    return new URL(candidate).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
};

const originOf = (value: unknown): string => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  try {
    return new URL(raw).origin.toLowerCase();
  } catch {
    return '';
  }
};

const brokerMatchesHostname = (broker: BrokerDiscoveryItem, hostname: string): boolean =>
  DOMAIN_FIELDS.some((field) => String(broker[field] ?? '').split(',').some((value) => hostnameOf(value) === hostname));

const brokerMatchesTarget = (broker: BrokerDiscoveryItem, targetOrigin: string): boolean =>
  Boolean(targetOrigin) && TARGET_FIELDS.some((field) => originOf(broker[field]) === targetOrigin);

const isLocalHostname = (hostname: string): boolean =>
  ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname) || hostname.endsWith('.localhost');

const failedPolicy = (message: string): BrokerLoginPolicy => ({
  status: 'error', brokerId: '', displayName: '', locked: true, local: false, error: message,
});

export const resolveBrokerLoginPolicy = (
  brokers: readonly BrokerDiscoveryItem[],
  locationLike: Pick<Location, 'hostname'> | undefined = typeof window === 'undefined' ? undefined : window.location,
): BrokerLoginPolicy => {
  const runtimeId = normalizeId(getRuntimeConfiguredBrokerId());
  const runtimeBroker = brokers.find((broker) => normalizeId(broker.broker_id) === runtimeId);
  const hostname = hostnameOf(locationLike?.hostname);
  const targetOrigin = originOf(getBackendTarget());
  // A developer's localhost is shared by every broker's local frontend. It
  // cannot identify a broker, even if discovery lists a demo on that hostname.
  const urlBroker = brokers.find((broker) =>
    brokerMatchesTarget(broker, targetOrigin)
    || (!isLocalHostname(hostname) && brokerMatchesHostname(broker, hostname)));

  if (urlBroker && runtimeBroker && normalizeId(urlBroker.broker_id) !== normalizeId(runtimeBroker.broker_id)) {
    return failedPolicy('This terminal broker configuration does not match its deployment URL.');
  }
  const broker = urlBroker || runtimeBroker;
  if (!broker || !runtimeId) {
    return failedPolicy('This terminal does not have a verified broker configured.');
  }
  if (normalizeId(broker.broker_id) !== runtimeId) {
    return failedPolicy('This terminal broker identity could not be verified.');
  }

  return {
    status: 'ready',
    brokerId: String(broker.broker_id),
    displayName: String(broker.broker_name || broker.broker_id),
    locked: true,
    local: false,
  };
};
