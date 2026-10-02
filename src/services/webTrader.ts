import { BROKER_DISCOVERY_URL } from '../config/api';
import { getBrokerConfigurationError, getRuntimeBrokerConfiguration, getRuntimeConfiguredBrokerId, isDesktopBackendTarget } from '../config/backendTarget.js';
import { DEV_BROKER_DISCOVERY_PROXY_PREFIX, toLocalDevProxyUrl } from '../config/localDevProxy';
import { extractBrokerDiscoveryList, type BrokerDiscoveryItem } from './brokerDiscovery';

const WEB_TRADER_URL_FIELDS = [
  'webterminal_domain',
  'web_terminal_domain',
  'webterminal_url',
  'web_terminal_url',
] as const;

export type WebTraderUrlField = typeof WEB_TRADER_URL_FIELDS[number];
export type WebTraderUrlSource = WebTraderUrlField | 'domains.webterminal' | 'current_app';

export type WebTraderResolution =
  | {
      status: 'ready';
      brokerId: string;
      brokerName: string;
      url: string;
      sourceField: WebTraderUrlSource;
    }
  | {
      status: 'broker_not_selected';
      message: string;
    }
  | {
      status: 'broker_not_found';
      brokerId: string;
      message: string;
    }
  | {
      status: 'url_not_configured';
      brokerId: string;
      brokerName: string;
      message: string;
    }
  | {
      status: 'invalid_url';
      brokerId: string;
      brokerName: string;
      message: string;
    }
  | {
      status: 'discovery_failed';
      brokerId: string;
      message: string;
    };

export type WebTraderOpenResult =
  | Exclude<WebTraderResolution, { status: 'ready' }>
  | {
      status: 'opened';
      brokerId: string;
      brokerName: string;
      url: string;
      openedWith: 'electron' | 'browser';
    }
  | {
      status: 'open_failed';
      brokerId: string;
      brokerName: string;
      url: string;
      message: string;
    };

type StorageReader = Pick<Storage, 'getItem'>;

export interface ResolveWebTraderOptions {
  /** Explicit broker identity, primarily for callers that already own session state. */
  brokerId?: string | null;
  /** Dependency overrides keep the resolver deterministic in tests. */
  discoveryUrl?: string;
  fetcher?: typeof fetch;
  storage?: StorageReader | null;
  runtimeBrokerId?: string | null;
  /** Current app URL override for deterministic tests. */
  currentAppUrl?: string | null;
  /** Physical desktop override for deterministic tests. */
  isElectronRuntime?: boolean;
}

const normalizeBrokerIdentity = (value: unknown): string => String(value ?? '').trim();

const getStorage = (override: StorageReader | null | undefined): StorageReader | null => {
  if (override !== undefined) return override;
  if (typeof window === 'undefined') return null;

  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export const getCurrentWebTraderBrokerId = (options: ResolveWebTraderOptions = {}): string => {
  if (!isDesktopBackendTarget()) {
    return normalizeBrokerIdentity(getRuntimeConfiguredBrokerId());
  }
  if (options.brokerId !== undefined) {
    return normalizeBrokerIdentity(options.brokerId);
  }

  const storage = getStorage(options.storage);
  try {
    const storedBrokerId = storage?.getItem('broker_id') || storage?.getItem('rtx_broker_id');
    if (storedBrokerId) return normalizeBrokerIdentity(storedBrokerId);
  } catch {
    // Hardened browser contexts can deny access to storage.
  }

  const runtimeBrokerId = options.runtimeBrokerId !== undefined
    ? options.runtimeBrokerId
    : getRuntimeConfiguredBrokerId();
  return normalizeBrokerIdentity(runtimeBrokerId);
};

/**
 * Accepts only HTTP(S). Values declared as a bare domain are promoted to HTTPS;
 * unsupported schemes are rejected instead of being rewritten into a plausible URL.
 */
export const normalizeWebTraderUrl = (value: unknown): string | null => {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return null;

  let candidate: string;
  if (raw.startsWith('//')) {
    candidate = `https:${raw}`;
  } else if (/^[a-z][a-z\d+.-]*:\/\//i.test(raw)) {
    if (!/^https?:\/\//i.test(raw)) return null;
    candidate = raw;
  } else {
    // Reject non-hierarchical schemes such as javascript: and data:, while
    // retaining ordinary domain:port declarations.
    const looksLikeHostWithPort = /^[^/?#\s:]+:\d+(?:[/?#]|$)/.test(raw);
    if (/^[a-z][a-z\d+.-]*:/i.test(raw) && !looksLikeHostWithPort) return null;
    candidate = `https://${raw}`;
  }

  try {
    const parsed = new URL(candidate);
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname) {
      return null;
    }
    if (parsed.username || parsed.password) return null;

    if (parsed.pathname === '/' && !parsed.search && !parsed.hash) {
      return `${parsed.protocol}//${parsed.host}`;
    }
    return parsed.toString();
  } catch {
    return null;
  }
};

const getDiscoveryEndpoint = (baseUrl: string): string =>
  `${String(baseUrl || '').trim().replace(/\/+$/, '')}/api/v2/broker/servers`;

const getBrokerName = (broker: BrokerDiscoveryItem, brokerId: string): string =>
  normalizeBrokerIdentity(broker.broker_name || broker.name || brokerId) || brokerId;

const getNestedWebTraderUrl = (broker: BrokerDiscoveryItem): unknown => {
  const domains = broker.domains;
  if (!domains || Array.isArray(domains) || typeof domains !== 'object') return null;

  const domainMap = domains as Record<string, unknown>;
  return domainMap.webterminal ?? domainMap.web_terminal;
};

const isPhysicalElectronRuntime = (override: boolean | undefined): boolean => {
  if (override !== undefined) return override;
  if (typeof window === 'undefined') return false;

  return Boolean(window.electron?.window)
    || Boolean((window as Window & { electronAPI?: unknown }).electronAPI)
    || window.location?.protocol === 'file:'
    || (typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron'));
};

const getCurrentWebAppUrl = (options: ResolveWebTraderOptions): string | null => {
  if (isPhysicalElectronRuntime(options.isElectronRuntime)) return null;

  const rawUrl = options.currentAppUrl !== undefined
    ? options.currentAppUrl
    : typeof window !== 'undefined'
      ? window.location?.href
      : null;
  if (!rawUrl) return null;

  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    parsed.search = '';
    parsed.hash = '';
    return normalizeWebTraderUrl(parsed.toString());
  } catch {
    return null;
  }
};

export const resolveWebTraderTarget = async (
  options: ResolveWebTraderOptions = {},
): Promise<WebTraderResolution> => {
  const brokerId = getCurrentWebTraderBrokerId(options);
  if (!brokerId) {
    return {
      status: 'broker_not_selected',
      message: 'Select or log in to a broker before opening Web Trader.',
    };
  }

  const fetcher = options.fetcher || fetch;
  let brokers: BrokerDiscoveryItem[];

  try {
    let discoveryUrl = options.discoveryUrl || BROKER_DISCOVERY_URL;
    if (!isDesktopBackendTarget()) {
      const configuration = getRuntimeBrokerConfiguration();
      const error = getBrokerConfigurationError();
      if (error) throw new Error(error);
      const configuredRequestUrl = toLocalDevProxyUrl(configuration.discoveryBaseUrl, DEV_BROKER_DISCOVERY_PROXY_PREFIX);
      if (!configuration.discoveryBaseUrl || (options.discoveryUrl && ![configuration.discoveryBaseUrl, configuredRequestUrl].includes(options.discoveryUrl.replace(/\/+$/, '')))) {
        throw new Error('The discovery URL does not match this broker deployment.');
      }
      discoveryUrl = configuredRequestUrl;
    }
    const response = await fetcher(getDiscoveryEndpoint(discoveryUrl), {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      credentials: 'omit',
    });
    if (!response.ok) {
      throw new Error(`Broker discovery failed (${response.status})`);
    }
    brokers = extractBrokerDiscoveryList(await response.json());
  } catch (error) {
    return {
      status: 'discovery_failed',
      brokerId,
      message: error instanceof Error ? error.message : 'Broker discovery failed.',
    };
  }

  const normalizedBrokerId = brokerId.toLowerCase();
  const broker = brokers.find((item) =>
    isDesktopBackendTarget()
      ? normalizeBrokerIdentity(item.broker_id || item.id).toLowerCase() === normalizedBrokerId
      : normalizeBrokerIdentity(item.broker_id || item.id) === brokerId,
  );
  if (!broker) {
    return {
      status: 'broker_not_found',
      brokerId,
      message: `Broker "${brokerId}" is not available in the broker directory.`,
    };
  }

  const brokerName = getBrokerName(broker, brokerId);
  let hasDeclaredUrl = false;
  const declaredUrls: Array<{ sourceField: WebTraderUrlSource; rawValue: unknown }> = [
    ...WEB_TRADER_URL_FIELDS.map((sourceField) => ({ sourceField, rawValue: broker[sourceField] })),
    { sourceField: 'domains.webterminal', rawValue: getNestedWebTraderUrl(broker) },
  ];
  for (const { sourceField, rawValue } of declaredUrls) {
    if (typeof rawValue !== 'string' || !rawValue.trim()) continue;
    hasDeclaredUrl = true;
    const url = normalizeWebTraderUrl(rawValue);
    if (url) {
      return {
        status: 'ready',
        brokerId,
        brokerName,
        url,
        sourceField,
      };
    }
  }

  if (hasDeclaredUrl) {
    return {
      status: 'invalid_url',
      brokerId,
      brokerName,
      message: `${brokerName} has an invalid Web Trader URL in broker discovery.`,
    };
  }

  const runtimeBrokerId = normalizeBrokerIdentity(
    options.runtimeBrokerId !== undefined ? options.runtimeBrokerId : getRuntimeConfiguredBrokerId(),
  );
  if (runtimeBrokerId && runtimeBrokerId.toLowerCase() === normalizedBrokerId) {
    const currentAppUrl = getCurrentWebAppUrl(options);
    if (currentAppUrl) {
      return {
        status: 'ready',
        brokerId,
        brokerName,
        url: currentAppUrl,
        sourceField: 'current_app',
      };
    }
  }

  return {
    status: 'url_not_configured',
    brokerId,
    brokerName,
    message: `${brokerName} has not configured a Web Trader URL.`,
  };
};

export const openWebTrader = async (
  options: ResolveWebTraderOptions = {},
): Promise<WebTraderOpenResult> => {
  const resolution = await resolveWebTraderTarget(options);
  if (resolution.status !== 'ready') return resolution;

  if (typeof window === 'undefined') {
    return {
      status: 'open_failed',
      brokerId: resolution.brokerId,
      brokerName: resolution.brokerName,
      url: resolution.url,
      message: 'Web Trader can only be opened from the terminal application.',
    };
  }

  try {
    if (window.electron?.shell?.openExternal) {
      await window.electron.shell.openExternal(resolution.url);
      return {
        status: 'opened',
        brokerId: resolution.brokerId,
        brokerName: resolution.brokerName,
        url: resolution.url,
        openedWith: 'electron',
      };
    }

    // A successful window.open call with the `noopener` feature is allowed to
    // return null, which is indistinguishable from a blocked popup. Open a
    // same-origin blank page first so we can detect a real block, detach its
    // opener before navigation, and then send it to the resolved broker URL.
    const popup = window.open('', '_blank');
    if (!popup) {
      return {
        status: 'open_failed',
        brokerId: resolution.brokerId,
        brokerName: resolution.brokerName,
        url: resolution.url,
        message: 'The browser blocked the Web Trader window. Allow pop-ups and try again.',
      };
    }
    try {
      popup.opener = null;
    } catch {
      // Continue with navigation even in hardened browser contexts.
    }
    popup.location.replace(resolution.url);
    return {
      status: 'opened',
      brokerId: resolution.brokerId,
      brokerName: resolution.brokerName,
      url: resolution.url,
      openedWith: 'browser',
    };
  } catch (error) {
    return {
      status: 'open_failed',
      brokerId: resolution.brokerId,
      brokerName: resolution.brokerName,
      url: resolution.url,
      message: error instanceof Error ? error.message : 'Unable to open Web Trader.',
    };
  }
};
