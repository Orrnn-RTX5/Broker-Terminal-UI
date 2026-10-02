import { BROKER_DISCOVERY_URL } from '../config/api';
import { getBrokerConfigurationError, getRuntimeBrokerConfiguration, isDesktopBackendTarget } from '../config/backendTarget.js';
import { DEV_BROKER_DISCOVERY_PROXY_PREFIX, toLocalDevProxyUrl } from '../config/localDevProxy';
import { extractBrokerDiscoveryList, isDirectoryBrokerSelectable, type BrokerDiscoveryItem } from './brokerDiscovery';

export const BROKER_DIRECTORY_CACHE_TTL_MS = 5 * 60_000;
export const BROKER_DIRECTORY_TIMEOUT_MS = 10_000;

const extraDiscoveryUrlsFromEnv = (): string[] =>
  String(getRuntimeBrokerConfiguration().extraDiscoveryUrls || '')
    .split(/[,\s]+/)
    .map(value => value.trim().replace(/\/+$/, ''))
    .filter(Boolean);

interface DirectoryEntry {
  rows: BrokerDiscoveryItem[] | null;
  expiresAt: number;
  pending: Promise<BrokerDiscoveryItem[]> | null;
}

// Public directory metadata only. Never populate this from saved account/session
// routing, and never reuse it across different directory endpoints.
const directories = new Map<string, DirectoryEntry>();
const directoryEndpoint = (baseUrl: string): string =>
  `${baseUrl.replace(/\/+$/, '')}/api/v2/broker/servers`;

export const getCurrentBrokerDiscoveryUrl = (): string => {
  const configured = getRuntimeBrokerConfiguration().discoveryBaseUrl;
  return configured ? toLocalDevProxyUrl(configured, DEV_BROKER_DISCOVERY_PROXY_PREFIX) : BROKER_DISCOVERY_URL;
};

export function getCachedBrokerDirectory(discoveryUrl = getCurrentBrokerDiscoveryUrl()): BrokerDiscoveryItem[] | null {
  if (!isDesktopBackendTarget()) {
    const configuration = getRuntimeBrokerConfiguration();
    if (!configuration.valid || !configuration.discoveryBaseUrl) return null;
    const requestUrl = toLocalDevProxyUrl(configuration.discoveryBaseUrl, DEV_BROKER_DISCOVERY_PROXY_PREFIX);
    if (![configuration.discoveryBaseUrl, requestUrl].includes(discoveryUrl.replace(/\/+$/, ''))) return null;
    discoveryUrl = requestUrl;
  }
  if (!discoveryUrl.trim()) return null;
  const entry = directories.get(directoryEndpoint(discoveryUrl));
  return entry && entry.expiresAt > Date.now() ? entry.rows : null;
}

export function loadBrokerDirectory({
  forceRefresh = false,
  discoveryUrl = getCurrentBrokerDiscoveryUrl(),
}: { forceRefresh?: boolean; discoveryUrl?: string } = {}): Promise<BrokerDiscoveryItem[]> {
  if (!isDesktopBackendTarget()) {
    const configuration = getRuntimeBrokerConfiguration();
    const error = getBrokerConfigurationError();
    if (error) return Promise.reject(new Error(error));
    const configuredRequestUrl = toLocalDevProxyUrl(configuration.discoveryBaseUrl, DEV_BROKER_DISCOVERY_PROXY_PREFIX);
    if (!configuration.discoveryBaseUrl || ![configuration.discoveryBaseUrl, configuredRequestUrl].includes(discoveryUrl.replace(/\/+$/, ''))) {
      return Promise.reject(new Error('The discovery URL does not match this broker deployment.'));
    }
    discoveryUrl = configuredRequestUrl;
  }
  if (!discoveryUrl.trim()) return Promise.reject(new Error('Broker discovery URL is not configured.'));
  const endpoint = directoryEndpoint(discoveryUrl);
  let entry = directories.get(endpoint);
  if (!entry) {
    entry = { rows: null, expiresAt: 0, pending: null };
    directories.set(endpoint, entry);
  }
  if (entry.pending) return entry.pending;
  if (!forceRefresh && entry.rows !== null && entry.expiresAt > Date.now()) {
    return Promise.resolve(entry.rows);
  }

  // A fresh lookup replaces the previous authority, including on empty results
  // or failure; expired endpoints must not silently become actionable again.
  entry.rows = null;
  entry.expiresAt = 0;
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error('Broker directory request timed out. Please try again.'));
      controller.abort();
    }, BROKER_DIRECTORY_TIMEOUT_MS);
  });
  const request = Promise.resolve()
    .then(() => fetch(endpoint, { signal: controller.signal, cache: 'no-store', redirect: 'error', credentials: 'omit' }))
    .then(response => {
      if (!response.ok) throw new Error(`Broker discovery failed (${response.status})`);
      return response.json();
    })
    .then((payload: unknown) => extractBrokerDiscoveryList(payload));

  const currentEntry = entry;
  currentEntry.pending = Promise.race([request, deadline])
    .then(rows => {
      currentEntry.rows = rows;
      currentEntry.expiresAt = Date.now() + BROKER_DIRECTORY_CACHE_TTL_MS;
      return rows;
    })
    .finally(() => {
      clearTimeout(timeoutId);
      currentEntry.pending = null;
    });
  return currentEntry.pending;
}

const identity = (value: unknown): string => String(value ?? '').trim().replace(/\/+$/, '').toLowerCase();

const isLocalDirectoryBroker = (broker: BrokerDiscoveryItem): boolean => {
  if (identity(broker.region) === 'local') return true;
  try {
    const hostname = new URL(String(broker.server_url || '').trim()).hostname.toLowerCase();
    return hostname === 'localhost'
      || hostname.endsWith('.localhost')
      || hostname === '::1'
      || hostname.startsWith('127.')
      || hostname.endsWith('.local')
      || hostname.endsWith('.local.test');
  } catch {
    return false;
  }
};

export const mergeBrokerDirectories = (
  lists: Array<readonly BrokerDiscoveryItem[] | null | undefined>,
): BrokerDiscoveryItem[] => {
  const rows: BrokerDiscoveryItem[] = [];
  const seen = new Set<string>();

  const take = (broker: BrokerDiscoveryItem) => {
    // The backend's registered ID is the identity. Separate brokers can share
    // a gateway or display name, and registered IDs are case-sensitive.
    const brokerId = String(broker.broker_id ?? '').trim();
    const serverUrl = String(broker.server_url ?? '').trim().replace(/\/+$/, '');
    const brokerName = String(broker.broker_name ?? '').trim();
    if (!brokerId && !serverUrl && !brokerName) return;
    const key = brokerId
      ? `registered:${brokerId}`
      : `unregistered:${JSON.stringify([serverUrl, brokerName])}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(broker);
  };

  lists.forEach(list => {
    (list || []).forEach(take);
  });

  return [
    ...rows.filter(broker => !isLocalDirectoryBroker(broker)),
    ...rows.filter(isLocalDirectoryBroker),
  ];
};

export const getDesktopBrokerDirectoryUrls = (
  primaryUrl = getCurrentBrokerDiscoveryUrl(),
): string[] => {
  const urls: string[] = [];
  const seen = new Set<string>();
  [primaryUrl, ...extraDiscoveryUrlsFromEnv()].forEach(value => {
    const normalized = String(value || '').trim().replace(/\/+$/, '');
    if (!normalized) return;
    const endpoint = directoryEndpoint(normalized);
    if (seen.has(endpoint)) return;
    seen.add(endpoint);
    urls.push(normalized);
  });
  return urls;
};

/**
 * Desktop login unions broker metadata from configured Superadmin directories.
 * A failed extra directory never invents a
 * server and never hides a successful primary directory.
 */
export async function loadAppBrokerDirectory({
  forceRefresh = false,
  desktop = false,
  discoveryUrl = getCurrentBrokerDiscoveryUrl(),
}: { forceRefresh?: boolean; desktop?: boolean; discoveryUrl?: string } = {}): Promise<BrokerDiscoveryItem[]> {
  const primary = await loadBrokerDirectory({ forceRefresh, discoveryUrl });
  if (!desktop) return primary;
  if (!primary.some(isDirectoryBrokerSelectable)) return primary;

  const extraUrls = getDesktopBrokerDirectoryUrls(discoveryUrl).slice(1);
  const extraLists = await Promise.all(
    extraUrls.map(url => loadBrokerDirectory({ forceRefresh, discoveryUrl: url }).catch(() => [] as BrokerDiscoveryItem[])),
  );
  return mergeBrokerDirectories([primary, ...extraLists]);
}
