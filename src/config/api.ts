import {
  buildBrokerWsV2Uri,
  buildBrokerWsFeedUri,
} from '../services/brokerSession';
import {
  getBackendTarget,
  resolveBrokerExtApiUrl,
  getBrokerConfigurationError,
  isConfiguredBrokerEndpoint,
  getRuntimeDiscoveryBaseUrl,
  isDesktopBackendTarget,
  normalizeBrokerInfoForTarget,
  trimTrailingSlash,
} from './backendTarget.js';
import { isCleartextDowngradeAllowedHost } from './urlSecurity';
import {
  DEV_BROKER_API_PROXY_PREFIX,
  DEV_BROKER_DISCOVERY_PROXY_PREFIX,
  isLocalViteDevServer,
  toLocalDevProxyUrl,
} from './localDevProxy';

export { isCleartextDowngradeAllowedHost } from './urlSecurity';
export { DEV_BROKER_API_PROXY_PREFIX, DEV_BROKER_DISCOVERY_PROXY_PREFIX, isLocalViteDevServer, toLocalDevProxyUrl };

export const FORCE_HTTP_ONLY = import.meta.env.VITE_FORCE_HTTP_ONLY === 'true';

const getRuntimePageProtocol = (): string => {
  if (typeof window === 'undefined' || !window.location?.protocol) {
    return 'https:';
  }

  return window.location.protocol === 'https:' ? 'https:' : 'http:';
};

const shouldForceHttpProtocol = (): boolean =>
  FORCE_HTTP_ONLY && getRuntimePageProtocol() !== 'https:';

const getRuntimeProtocol = (): string => {
  if (shouldForceHttpProtocol()) return 'http:';
  return getRuntimePageProtocol();
};

const hasUrlScheme = (value: string): boolean => /^[a-z][a-z\d+.-]*:\/\//i.test(value);

const getLocalStorageItem = (key: string): string | null => {
  if (typeof window === 'undefined') return null;

  try {
    const storage = window.localStorage;
    return storage && typeof storage.getItem === 'function' ? storage.getItem(key) : null;
  } catch {
    return null;
  }
};

export const normalizeServerUrl = (value: string): string => {
  const trimmed = String(value || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';

  if (trimmed.startsWith('//')) {
    return `${getRuntimeProtocol()}${trimmed}`;
  }

  return hasUrlScheme(trimmed) ? trimmed : `${getRuntimeProtocol()}//${trimmed}`;
};

// Hosts for which an opt-in (VITE_FORCE_HTTP_ONLY) https→http downgrade is safe:
// loopback and RFC1918/link-local private ranges only. A public hostname or
// publicly-routable IP must NEVER be silently downgraded to cleartext, even on
// an Electron file:/http: origin — that would expose broker REST/WS in the clear.
export const normalizeBrokerServerUrl = (value: string): string => {
  const normalized = normalizeServerUrl(value);
  if (!shouldForceHttpProtocol() || !normalized) return normalized;

  try {
    const parsed = new URL(normalized);
    // Only downgrade to cleartext for local/private targets. Never strip TLS
    // from a public broker even when FORCE_HTTP_ONLY is opted in.
    if (!isCleartextDowngradeAllowedHost(parsed.hostname)) {
      return normalized;
    }
    if (parsed.protocol === 'https:') {
      parsed.protocol = 'http:';
    }
    if (parsed.protocol === 'http:' && parsed.port === '443') {
      parsed.port = '';
    }
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return normalized;
  }
};

const getRuntimeWsProtocol = (): string => {
  return getRuntimeProtocol() === 'https:' ? 'wss:' : 'ws:';
};

const normalizeDynamicServerUrl = (value: string): string => {
  const trimmed = String(value || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';

  return isDesktopBackendTarget() ? normalizeBrokerServerUrl(trimmed) : normalizeServerUrl(trimmed);
};

export const normalizeWsUrl = (value: string): string => {
  const trimmed = String(value || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';

  if (trimmed.startsWith('//')) {
    return `${getRuntimeWsProtocol()}${trimmed}`;
  }

  if (/^wss?:\/\//i.test(trimmed)) return trimmed;
  if (/^https:\/\//i.test(trimmed)) return trimmed.replace(/^https:\/\//i, 'wss://');
  if (/^http:\/\//i.test(trimmed)) return trimmed.replace(/^http:\/\//i, 'ws://');
  if (hasUrlScheme(trimmed)) return trimmed;

  return `${getRuntimeWsProtocol()}//${trimmed}`;
};

let RTX5_API_URL = normalizeServerUrl(resolveBrokerExtApiUrl());

const getDynamicServerUrl = (extended = false): string => {
  if (typeof window === 'undefined') return '';
  const normalizedBroker = normalizeBrokerInfoForTarget({
    broker_id: getLocalStorageItem('broker_id') || getLocalStorageItem('rtx_broker_id') || '',
    broker_name: getLocalStorageItem('broker_name') || '',
    backend_url: getLocalStorageItem('backend_url') || '',
    market_api_url: getLocalStorageItem('market_api_url') || '',
    server_url: getLocalStorageItem('server_url') || getLocalStorageItem('rtx_broker_server') || '',
    ws_url: getLocalStorageItem('ws_url') || '',
    feed_url: getLocalStorageItem('feed_url') || '',
    feed_ws_url: getLocalStorageItem('feed_url') || '',
  });
  return normalizeDynamicServerUrl((extended ? normalizedBroker.market_api_url : normalizedBroker.server_url) || '');
};

const getRuntimeApiBase = (): string => {
  const brokerServer = getDynamicServerUrl();
  if (brokerServer) return toLocalDevProxyUrl(brokerServer);

  return toLocalDevProxyUrl(normalizeServerUrl(getBackendTarget()));
};

const getRuntimeBrokerApiBase = (): string => {
  const brokerServer = getDynamicServerUrl(true);
  if (brokerServer) return toLocalDevProxyUrl(brokerServer);

  return toLocalDevProxyUrl(normalizeServerUrl(resolveBrokerExtApiUrl()));
};

const getRuntimeFixApiBase = (): string => {
  const brokerServer = getDynamicServerUrl();
  if (brokerServer) return toLocalDevProxyUrl(brokerServer);

  return toLocalDevProxyUrl(normalizeServerUrl(getBackendTarget()));
};

/** /ws/feed endpoint for live bid/ask quotes (Section 2 of WS flow). */
export let MARKET_WS_FEED_URL = buildBrokerWsFeedUri();

const getInitialV2BaseUrl = (): string => {
  const base = getRuntimeBrokerApiBase();
  return base ? `${base}/api/v2` : '';
};

const getInitialHistoryBaseUrl = (): string => {
  const base = getRuntimeBrokerApiBase();
  return base ? `${base}/history` : '';
};

const getInitialWsUrl = (): string => buildBrokerWsV2Uri(null);
const getInitialMarketWsUrl = getInitialWsUrl;
const getInitialFixWsUrl = getInitialWsUrl;
const getInitialGeneralWsUrl = getInitialWsUrl;

export let API_V2_BASE_URL = getInitialV2BaseUrl();
export let API_HISTORY_BASE_URL = getInitialHistoryBaseUrl();
export let RTX5_WS_URL = getInitialWsUrl();
let API_BASE_URL = getRuntimeApiBase();

let FIX_API_URL = getRuntimeFixApiBase();
let FIX_WS_URL = getInitialFixWsUrl();
let WS_URL = getInitialGeneralWsUrl();

// Optional with undefined default
let ADMIN_API_URL = API_BASE_URL;
export let MARKET_WS_URL = getInitialMarketWsUrl();
let ADMIN_WS_URL = buildBrokerWsV2Uri(null);

export function updateDynamicUrls(): void {
  API_BASE_URL = getRuntimeApiBase();
  RTX5_API_URL = normalizeServerUrl(resolveBrokerExtApiUrl());
  ADMIN_API_URL = API_BASE_URL;
  ADMIN_WS_URL = buildBrokerWsV2Uri(null);
  API_V2_BASE_URL = getInitialV2BaseUrl();
  API_HISTORY_BASE_URL = getInitialHistoryBaseUrl();
  RTX5_WS_URL = getInitialWsUrl();
  FIX_WS_URL = getInitialFixWsUrl();
  WS_URL = getInitialGeneralWsUrl();
  MARKET_WS_URL = getInitialMarketWsUrl();
  MARKET_WS_FEED_URL = buildBrokerWsFeedUri();
  FIX_API_URL = getRuntimeFixApiBase();
  API_ENDPOINTS = buildApiEndpoints();
}

const getApiBase = (): string => API_BASE_URL;
const getFixApiBase = (): string => FIX_API_URL;
const getV2Base = (): string => API_V2_BASE_URL;

// API Endpoints
const buildApiEndpoints = () => ({

  login: `${getApiBase()}/api/login`,
  logout: `${getApiBase()}/api/logout`,
  refresh: `${getApiBase()}/api/refresh`,
  v2: {
    auth: {
      login: `${getV2Base()}/auth/login`,
      me: `${getV2Base()}/auth/me`,
      refresh: `${getV2Base()}/auth/refresh`,
      changePassword: `${getV2Base()}/auth/change-password`,
    },
    trading: {
      placeOrder: `${getV2Base()}/orders`,
      positions: (login: number | string) => `${getV2Base()}/positions/${login}`,
      positionHistory: (login: number | string) => `${getV2Base()}/positions/${login}/history`,
      closePosition: (id: number | string) => `${getV2Base()}/positions/${id}/close`,
      modifyPosition: (id: number | string) => `${getV2Base()}/positions/${id}`,
      orders: (login: number | string) => `${getV2Base()}/orders/${login}`,
      userOrders: `${getV2Base()}/account/orders`,
      deals: (login: number | string) => `${getV2Base()}/deals/${login}`,
      userDeals: `${getV2Base()}/account/deals`,
      pendingOrders: `${getV2Base()}/orders/pending`,
      pendingOrdersForAccount: (login: number | string) => `${getV2Base()}/orders/pending/${login}`,
      pendingOrder: (ticket: number | string) => `${getV2Base()}/orders/pending/${ticket}`,
      ocoOrders: `${getV2Base()}/orders/oco`,
      ocoOrdersForAccount: (login: number | string) => `${getV2Base()}/orders/oco/${login}`,
      ocoOrder: (id: number | string) => `${getV2Base()}/orders/oco/${id}`,
    },
    market: {
      status: `${getV2Base()}/market/status`,
      symbolStatus: (symbol: string) => `${getV2Base()}/market/status/${encodeURIComponent(symbol)}`,
      instruments: `${getV2Base()}/instruments`,
      instrumentSpecification: (symbol: string) => `${getV2Base()}/instruments/${encodeURIComponent(symbol)}/specification`,
      quotes: `${getV2Base()}/quotes`,
      quote: (symbol: string) => `${getV2Base()}/quotes/${encodeURIComponent(symbol)}`,
      candles: (symbol: string) => `${getV2Base()}/candles/${encodeURIComponent(symbol)}`,
      ticks: (symbol: string) => `${getV2Base()}/ticks/${encodeURIComponent(symbol)}`,
      depth: (symbol: string) => `${getV2Base()}/depth/${encodeURIComponent(symbol)}`,
      calculateMargin: `${getV2Base()}/calculate/margin`,
      calculateProfit: `${getV2Base()}/calculate/profit`,
    },
    broker: {
      servers: `${getV2Base()}/broker/servers`,
      config: `${getV2Base()}/broker/config`,
    },
    history: {
      candles: (symbol: string) => `${getV2Base()}/candles/${encodeURIComponent(symbol)}`,
      latestCandle: (symbol: string) => `${getV2Base()}/candles/${encodeURIComponent(symbol)}`,
      ticks: (symbol: string) => `${getV2Base()}/ticks/${encodeURIComponent(symbol)}`,
    },
    watchlist: {
      list: `${getV2Base()}/watchlist`,
      update: `${getV2Base()}/watchlist`,
      item: (symbol: string) => `${getV2Base()}/watchlist/${encodeURIComponent(symbol)}`,
    },
    account: {
      list: `${getV2Base()}/accounts`,
      create: `${getV2Base()}/accounts`,
      byLogin: (login: number | string) => `${getV2Base()}/account/${login}`,
      metrics: (login: number | string) => `${getV2Base()}/account/${login}/metrics`,
      equity: (login: number | string) => `${getV2Base()}/account/${login}/equity`,
      history: (login: number | string) => `${getV2Base()}/accounts/${login}/history`,
      closeAll: (login: number | string) => `${getV2Base()}/accounts/${login}/close-all`,
      investorPassword: (login: number | string) => `${getV2Base()}/accounts/${login}/investor-password`,
    },
  },

  // Market Data (Protected)
  symbols: `${getApiBase()}/api/symbols`,
  quotes: `${getApiBase()}/api/quotes`,
  candles: `${getApiBase()}/api/candles`,
  ticks: `${getApiBase()}/api/ticks`,

  // Account Info
  account: {
    summary: `${getApiBase()}/api/account/summary`,
    transactions: `${getApiBase()}/api/account/transactions`,
    equityHistory: `${getApiBase()}/api/account/equity-history`,
    settings: `${getApiBase()}/api/account/settings`,
    password: `${getApiBase()}/api/account/password`,
  },

  payments: {
    history: `${getApiBase()}/api/payments/history`,
    deposit: `${getApiBase()}/api/payments/deposit`,
    withdrawal: `${getApiBase()}/api/payments/withdrawal`,
  },

  admin: {
    users: `${getApiBase()}/api/admin/users`,
    settings: `${getApiBase()}/api/admin/settings`,
    config: `${getApiBase()}/api/admin/config`,
    lp: `${getApiBase()}/api/admin/lp`,
    symbols: `${getApiBase()}/api/admin/symbols`,
    routingRules: `${getApiBase()}/api/admin/routing-rules`,
  },

  chartAnalysis: {
    upload: `${getApiBase()}/api/chart/upload`,
  },

  // Trading
  trading: {
    orders: `${getApiBase()}/api/orders`,
    positions: (login: number | string) => API_ENDPOINTS.v2.trading.positions(login),
    closePosition: (id: string) => API_ENDPOINTS.v2.trading.closePosition(id),
    cancelOrder: (id: string) => `${getApiBase()}/api/orders/${id}`,
  },

  // FIX API Direct (Port 8081) - Legacy references
  workspace: {
    layouts: `${getFixApiBase()}/workspace/layouts`,
    drawings: `${getFixApiBase()}/api/drawings`,
    preferences: `${getFixApiBase()}/workspace/preferences`,
  },
});

export let API_ENDPOINTS = buildApiEndpoints();

// WebSocket Endpoints
export const WS_ENDPOINTS = {
  get market() { return MARKET_WS_URL; },
  get admin() { return ADMIN_WS_URL; },
  get general() { return WS_URL; },
  get rtx5() { return RTX5_WS_URL; },
  get v2() { return RTX5_WS_URL; },
};

// Helper functions
const buildConfiguredHttpUrl = (endpoint: string, base: string): string => {
  const error = getBrokerConfigurationError();
  if (error) throw new Error(error);
  const url = /^https?:\/\//i.test(endpoint) ? endpoint : `${base}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
  if (!isConfiguredBrokerEndpoint(url)) throw new Error('Broker endpoint does not belong to this deployment.');
  return url;
};

export function buildApiUrl(endpoint: string): string {
  return buildConfiguredHttpUrl(endpoint, getRuntimeApiBase());
}

export function buildApiV2Url(endpoint: string): string {
  return buildConfiguredHttpUrl(endpoint, getInitialV2BaseUrl());
}

export function buildHistoryUrl(endpoint: string): string {
  return buildConfiguredHttpUrl(endpoint, getInitialHistoryBaseUrl());
}

export function buildAdminUrl(endpoint: string): string {
  return buildConfiguredHttpUrl(endpoint, getRuntimeApiBase());
}

export function buildWsUrl(endpoint: string): string {
  const error = getBrokerConfigurationError();
  if (error) throw new Error(error);
  if (/^wss?:\/\//i.test(endpoint)) {
    if (!isConfiguredBrokerEndpoint(endpoint, 'ws')) throw new Error('WebSocket endpoint does not belong to this broker deployment.');
    return endpoint;
  }
  const currentWsUrl = getInitialWsUrl();
  if (!currentWsUrl) throw new Error('Broker WebSocket configuration is missing.');
  const wsBase = new URL(currentWsUrl).origin;
  const url = `${wsBase}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
  if (!isConfiguredBrokerEndpoint(url, 'ws')) throw new Error('WebSocket endpoint does not belong to this broker deployment.');
  return url;
}

export function buildApiV2WsUrl(token?: string): string {
  return buildBrokerWsV2Uri(token ?? null);
}

// Export base URLs for backward compatibility
export { API_BASE_URL, RTX5_API_URL, ADMIN_API_URL, FIX_API_URL, FIX_WS_URL, WS_URL, ADMIN_WS_URL };

export const BROKER_DISCOVERY_URL = toLocalDevProxyUrl(
  trimTrailingSlash(normalizeServerUrl(
    getRuntimeDiscoveryBaseUrl()
  )),
  DEV_BROKER_DISCOVERY_PROXY_PREFIX
);

// Optional exports with undefined default
export const ENABLE_DEBUG = import.meta.env.VITE_ENABLE_DEBUG === 'true';
