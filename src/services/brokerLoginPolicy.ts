import {
  getBackendTarget,
  getRuntimeConfiguredBrokerId,
  getBrokerConfigurationError,
  isDesktopBackendTarget,
} from '../config/backendTarget.js';
import type { BrokerDiscoveryItem } from './brokerDiscovery';
import { isBrokerSuspended } from './brokerDiscovery';

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

const normalizeId = (value: unknown): string => String(value ?? '').trim();

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

const readyPolicy = (broker: BrokerDiscoveryItem): BrokerLoginPolicy => ({
  status: 'ready',
  brokerId: String(broker.broker_id),
  displayName: String(broker.broker_name || broker.broker_id),
  locked: true,
  local: false,
});

const getStoredSessionBrokerId = (): string => {
  if (typeof window === 'undefined') return '';
  try {
    return normalizeId(window.localStorage.getItem('broker_id') || window.localStorage.getItem('rtx_broker_id'));
  } catch {
    return '';
  }
};

export const resolveBrokerLoginPolicy = (
  brokers: readonly BrokerDiscoveryItem[],
  locationLike: Pick<Location, 'hostname'> | undefined = typeof window === 'undefined' ? undefined : window.location,
): BrokerLoginPolicy => {
  const webDeployment = !isDesktopBackendTarget();
  if (webDeployment && getBrokerConfigurationError()) {
    return failedPolicy(getBrokerConfigurationError());
  }
  const runtimeId = normalizeId(getRuntimeConfiguredBrokerId());
  const runtimeBroker = brokers.find((broker) => normalizeId(broker.broker_id) === runtimeId);
  const hostname = hostnameOf(locationLike?.hostname);
  const targetOrigin = originOf(getBackendTarget());
  if (webDeployment) {
    if (!runtimeBroker || !runtimeId) return failedPolicy('This terminal does not have a verified broker configured.');
    if (isBrokerSuspended(runtimeBroker)) return failedPolicy('The configured broker is unavailable for account access.');
    const hostMatches = isLocalHostname(hostname) ? [] : brokers.filter(broker => brokerMatchesHostname(broker, hostname));
    const targetMatches = brokers.filter(broker => brokerMatchesTarget(broker, targetOrigin));
    if ((hostMatches.length && !hostMatches.includes(runtimeBroker))
      || (targetMatches.length && !targetMatches.includes(runtimeBroker))) {
      return failedPolicy('This terminal broker configuration does not match its deployment URL.');
    }
    return readyPolicy(runtimeBroker);
  }
  // A developer's localhost is shared by every broker's local frontend. It
  // cannot identify a broker, even if discovery lists a demo on that hostname.
  const hostBroker = isLocalHostname(hostname)
    ? undefined
    : brokers.find((broker) => brokerMatchesHostname(broker, hostname));
  const urlBroker = brokers.find((broker) =>
    brokerMatchesTarget(broker, targetOrigin)
    || (!isLocalHostname(hostname) && brokerMatchesHostname(broker, hostname)));

  // The broker of the active session — the one the Navigator shows after the
  // user selected/logged into a broker. New accounts (demo or real) belong to
  // that broker, so it outranks the build-time env broker. A terminal served
  // from a broker's own domain is still locked to that domain's broker.
  const sessionBroker = (() => {
    const sessionId = getStoredSessionBrokerId();
    return sessionId ? brokers.find((broker) => normalizeId(broker.broker_id) === sessionId) : undefined;
  })();
  if (!webDeployment && sessionBroker) {
    if (hostBroker && normalizeId(hostBroker.broker_id) !== normalizeId(sessionBroker.broker_id)) {
      return failedPolicy('The active broker session does not match this terminal deployment URL.');
    }
    return readyPolicy(sessionBroker);
  }

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

  if (webDeployment && String(broker.broker_id).trim() !== getRuntimeConfiguredBrokerId()) {
    return failedPolicy('This terminal broker identity does not match its configured broker.');
  }

  return readyPolicy(broker);
};
