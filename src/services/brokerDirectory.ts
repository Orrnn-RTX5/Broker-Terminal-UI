import { BROKER_DISCOVERY_URL } from '../config/api';
import { SHARED_DISCOVERY_FALLBACK } from '../config/backendTarget.js';
import { extractBrokerDiscoveryList, isDirectoryBrokerSelectable, type BrokerDiscoveryItem } from './brokerDiscovery';

export const BROKER_DIRECTORY_CACHE_TTL_MS = 5 * 60_000;
export const BROKER_DIRECTORY_TIMEOUT_MS = 10_000;

/** Published production brokers that Superadmin may split across directories. */
export const DESKTOP_PUBLISHED_BROKERS: BrokerDiscoveryItem[] = [
  {
    broker_id: 'achiever-financials',
    broker_name: 'Achiever Financials',
    server_url: 'https://service.achieverfinancials.com',
    backend_url: 'https://service.achieverfinancials.com',
    market_api_url: 'https://service.achieverfinancials.com',
    logo_url: `${SHARED_DISCOVERY_FALLBACK}/api/v1/brokers/achiever-financials/logo`,
    enabled: true,
    active: true,
  },
  {
    broker_id: 'gta_broker',
    broker_name: 'Grow Trading Academy',
    server_url: 'https://services.growtradingacademy.com',
    backend_url: 'https://services.growtradingacademy.com',
    market_api_url: 'https://services.growtradingacademy.com',
    logo_url: `${SHARED_DISCOVERY_FALLBACK}/api/v1/brokers/grow-trading-academy/logo`,
    enabled: true,
    active: true,
  },
  {
    broker_id: 'myprop-trade',
    broker_name: 'MyProp',
    server_url: 'https://services.myprop.trade',
    backend_url: 'https://services.myprop.trade',
    market_api_url: 'https://services.myprop.trade',
    logo_url: `${SHARED_DISCOVERY_FALLBACK}/api/v1/brokers/myprop-trade/logo`,
    enabled: true,
    active: true,
  },
];

const extraDiscoveryUrlsFromEnv = (): string[] =>
  String((import.meta.env && import.meta.env.VITE_EXTRA_BROKER_DISCOVERY_URLS) || '')
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

export function getCachedBrokerDirectory(discoveryUrl = BROKER_DISCOVERY_URL): BrokerDiscoveryItem[] | null {
  const entry = directories.get(directoryEndpoint(discoveryUrl));
  return entry && entry.expiresAt > Date.now() ? entry.rows : null;
}

export function loadBrokerDirectory({
  forceRefresh = false,
  discoveryUrl = BROKER_DISCOVERY_URL,
}: { forceRefresh?: boolean; discoveryUrl?: string } = {}): Promise<BrokerDiscoveryItem[]> {
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
    .then(() => fetch(endpoint, { signal: controller.signal, cache: 'no-store' }))
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
    const keys = [identity(broker.broker_id), identity(broker.server_url), identity(broker.broker_name)]
      .filter(Boolean);
    if (keys.length === 0 || keys.some(key => seen.has(key))) return;
    keys.forEach(key => seen.add(key));
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
  primaryUrl = BROKER_DISCOVERY_URL,
): string[] => {
  const urls: string[] = [];
  const seen = new Set<string>();
  [primaryUrl, SHARED_DISCOVERY_FALLBACK, ...extraDiscoveryUrlsFromEnv()].forEach(value => {
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
 * Desktop login unions every configured Superadmin directory plus the known
 * published production brokers. A failed extra directory never invents a
 * server and never hides a successful primary directory.
 */
export async function loadAppBrokerDirectory({
  forceRefresh = false,
  desktop = false,
  discoveryUrl = BROKER_DISCOVERY_URL,
}: { forceRefresh?: boolean; desktop?: boolean; discoveryUrl?: string } = {}): Promise<BrokerDiscoveryItem[]> {
  const primary = await loadBrokerDirectory({ forceRefresh, discoveryUrl });
  if (!desktop) return primary;
  if (!primary.some(isDirectoryBrokerSelectable)) return primary;

  const extraUrls = getDesktopBrokerDirectoryUrls(discoveryUrl).slice(1);
  const extraLists = await Promise.all(
    extraUrls.map(url => loadBrokerDirectory({ forceRefresh, discoveryUrl: url }).catch(() => [] as BrokerDiscoveryItem[])),
  );
  return mergeBrokerDirectories([primary, ...extraLists, DESKTOP_PUBLISHED_BROKERS]);
}
