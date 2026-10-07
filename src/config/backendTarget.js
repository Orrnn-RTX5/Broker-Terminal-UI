// Deployment routing is authoritative and complete: no broker-specific fallback.
import { selectBrokerRuntimeConfig, validateBrokerRuntimeConfig } from './brokerRuntimeConfig';
import { createBrokerRuntimeValidationCache } from './brokerRuntimeValidationCache';

const URL_SCHEME_RE = /^[a-z][a-z\d+.-]*:\/\//i;
export const trimTrailingSlash = (value) => String(value || '').trim().replace(/\/+$/, '');
const first = (...values) => values.map(trimTrailingSlash).find(Boolean) || '';
const runtimeConfig = () => {
  if (typeof window === 'undefined') return undefined;
  return selectBrokerRuntimeConfig([window.__RTX_RUNTIME_CONFIG__, window.RUNTIME_CONFIG, window.__RUNTIME_CONFIG__]);
};
const buildTimeEnvValues = () => Object.fromEntries(Object.entries({
  BACKEND_TARGET: import.meta.env.BACKEND_TARGET || '',
  VITE_BACKEND_TARGET: import.meta.env.VITE_BACKEND_TARGET || '',
  BACKEND_MODE: import.meta.env.BACKEND_MODE || '',
  VITE_BACKEND_MODE: import.meta.env.VITE_BACKEND_MODE || '',
  VITE_API_HOST: import.meta.env.VITE_API_HOST || '',
  VITE_API_HOST_EXT: import.meta.env.VITE_API_HOST_EXT || '',
  VITE_API_URL: import.meta.env.VITE_API_URL || '',
  VITE_BACKEND_URL: import.meta.env.VITE_BACKEND_URL || '',
  VITE_RTX5_API_URL: import.meta.env.VITE_RTX5_API_URL || '',
  VITE_API_V2_URL: import.meta.env.VITE_API_V2_URL || '',
  VITE_FIX_API_URL: import.meta.env.VITE_FIX_API_URL || '',
  VITE_WS_HOST: import.meta.env.VITE_WS_HOST || '',
  VITE_WS_URL: import.meta.env.VITE_WS_URL || '',
  VITE_FIX_WS_URL: import.meta.env.VITE_FIX_WS_URL || '',
  VITE_RTX5_WS_URL: import.meta.env.VITE_RTX5_WS_URL || '',
  VITE_MARKET_WS_URL: import.meta.env.VITE_MARKET_WS_URL || '',
  VITE_DISCOVERY_BASE_URL: import.meta.env.VITE_DISCOVERY_BASE_URL || '',
  VITE_BROKER_DISCOVERY_URL: import.meta.env.VITE_BROKER_DISCOVERY_URL || '',
  VITE_SHARED_DISCOVERY_BASE_URL: import.meta.env.VITE_SHARED_DISCOVERY_BASE_URL || '',
  VITE_EXTRA_BROKER_DISCOVERY_URLS: import.meta.env.VITE_EXTRA_BROKER_DISCOVERY_URLS || '',
  VITE_BROKER_ID: import.meta.env.VITE_BROKER_ID || '',
  VITE_FEED_BROKER_ID: import.meta.env.VITE_FEED_BROKER_ID || '',
  VITE_DEFAULT_MT5_SERVER: import.meta.env.VITE_DEFAULT_MT5_SERVER || '',
  VITE_BROKER_NAME: import.meta.env.VITE_BROKER_NAME || '',
  VITE_BROKER_LOGO_URL: import.meta.env.VITE_BROKER_LOGO_URL || '',
  VITE_BROKER_LOGIN_HERO_URL: import.meta.env.VITE_BROKER_LOGIN_HERO_URL || '',
  VITE_BROKER_LOGIN_HERO_MOBILE_URL: import.meta.env.VITE_BROKER_LOGIN_HERO_MOBILE_URL || '',
  VITE_BROKER_TERMS_URL: import.meta.env.VITE_BROKER_TERMS_URL || '',
  VITE_BROKER_ALLOWED_ORIGINS: import.meta.env.VITE_BROKER_ALLOWED_ORIGINS || '',
  VITE_PUBLIC_CANDLE_BRIDGE: import.meta.env.VITE_PUBLIC_CANDLE_BRIDGE || '',
  VITE_PUBLIC_MARKET_API: import.meta.env.VITE_PUBLIC_MARKET_API || '',
  VITE_DESKTOP_BACKEND_URL: import.meta.env.VITE_DESKTOP_BACKEND_URL || '',
  VITE_DIRECT_BACKEND_URL: import.meta.env.VITE_DIRECT_BACKEND_URL || '',
}).filter(([, value]) => value !== ''));
export const isElectronRuntime = () => typeof window !== 'undefined' && Boolean(
  window.electron?.window || window.electronAPI || window.location?.protocol === 'file:'
  || (typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron'))
);
const isDesktopTargetValue = (value) => /^(desktop|electron|direct)$/i.test(String(value || '').trim());
const isLocalPage = () => typeof window !== 'undefined' && /^(localhost|127\.0\.0\.1|\[?::1\]?)$|\.localhost$/i.test(window.location?.hostname || '');
const presentValue = (config, keys) => {
  for (const key of keys) if (config[key] !== undefined && config[key] !== null) return String(config[key]).trim();
  return '';
};
const isDesktopRuntime = () => {
  if (isElectronRuntime()) return true;
  const config = runtimeConfig() || (import.meta.env.DEV ? buildTimeEnvValues() : {});
  if (config.CONFIG_SOURCE === 'deployment') return false;
  return isLocalPage() && isDesktopTargetValue(presentValue(config, [
    'BACKEND_TARGET', 'BACKEND_MODE', 'VITE_BACKEND_TARGET', 'VITE_BACKEND_MODE',
    'backendTarget', 'backend_target', 'backendMode', 'backend_mode',
  ]));
};
export const isDesktopBackendTarget = () => isDesktopRuntime();
export const isBrokerDeploymentPinned = () => !isDesktopBackendTarget();
const cachedRuntimeValidation = createBrokerRuntimeValidationCache(validateBrokerRuntimeConfig);
export const getRuntimeBrokerConfiguration = () => {
  const config = runtimeConfig() || (import.meta.env.DEV || isElectronRuntime() ? buildTimeEnvValues() : undefined);
  const desktop = isDesktopBackendTarget();
  return cachedRuntimeValidation(config, { allowLocal: Boolean(import.meta.env.DEV && isLocalPage()) || desktop, desktop });
};
export const getBrokerConfigurationErrors = () => isDesktopBackendTarget() ? [] : getRuntimeBrokerConfiguration().errors;
export const getBrokerConfigurationError = () => getBrokerConfigurationErrors().join(' ');
export const getPublicBackendTarget = () => {
  const config = getRuntimeBrokerConfiguration();
  return config.valid ? config.apiHost : '';
};
export const getPublicWsTarget = () => {
  const config = getRuntimeBrokerConfiguration();
  return config.valid ? config.wsHost : '';
};
export const getRuntimeConfiguredBrokerId = () => getRuntimeBrokerConfiguration().brokerId;
export const getRuntimeDiscoveryBaseUrl = () => {
  const config = getRuntimeBrokerConfiguration();
  return config.valid || isDesktopBackendTarget() ? config.discoveryBaseUrl : '';
};
export const isConfiguredBrokerEndpoint = (value, kind = 'http') => {
  if (!value) return false;
  try {
    let url = new URL(value, typeof window !== 'undefined' ? window.location.origin : undefined);
    // Only the existing loopback Vite proxy may wrap a configured broker URL.
    if (import.meta.env.DEV && isLocalPage() && url.origin === window.location.origin && /^\/__broker_api\//.test(url.pathname)) {
      const encodedOrigin = url.pathname.slice('/__broker_api/'.length).split('/')[0];
      url = new URL(decodeURIComponent(encodedOrigin));
    }
    if (url.username || url.password) return false;
    if (isDesktopBackendTarget()) return (kind === 'ws' ? ['ws:', 'wss:'] : ['http:', 'https:']).includes(url.protocol);
    const config = getRuntimeBrokerConfiguration();
    if (!config.valid) return false;
    const origin = kind === 'ws' ? url.origin.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:') : url.origin;
    const localAllowed = Boolean(import.meta.env.DEV && isLocalPage());
    const protocols = kind === 'ws' ? (localAllowed ? ['wss:', 'ws:'] : ['wss:']) : (localAllowed ? ['https:', 'http:'] : ['https:']);
    return protocols.includes(url.protocol) && config.allowedOrigins.includes(origin);
  } catch { return false; }
};
const normalizeHttpUrl = (value, protocol = 'https') => {
  const trimmed = trimTrailingSlash(value);
  return !trimmed ? '' : trimmed.startsWith('//') ? `${protocol}:${trimmed}` : URL_SCHEME_RE.test(trimmed) ? trimmed : `${protocol}://${trimmed}`;
};
const normalizeWsUrl = (value, protocol = 'wss') => {
  const trimmed = trimTrailingSlash(value);
  return !trimmed ? '' : trimmed.startsWith('//') ? `${protocol}:${trimmed}` : /^https?:\/\//i.test(trimmed)
    ? trimmed.replace(/^http/i, 'ws') : URL_SCHEME_RE.test(trimmed) ? trimmed : `${protocol}://${trimmed}`;
};
const directUrlFromHostPort = (brokerInfo = {}) => {
  const host = first(
    brokerInfo.server_ip,
    brokerInfo.backend_ip,
    brokerInfo.direct_ip,
    brokerInfo.ip
  );
  if (!host) return '';

  const port = first(
    brokerInfo.server_port,
    brokerInfo.backend_port,
    brokerInfo.direct_port,
    brokerInfo.port
  );
  const protocol = String(first(brokerInfo.protocol, brokerInfo.backend_protocol) || 'http').replace(/:$/, '');
  const authority = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  return `${protocol}://${authority}${port ? `:${port}` : ''}`;
};

const isIpLikeHost = (host = '') => {
  const normalized = String(host || '').trim().replace(/^\[|\]$/g, '');
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalized) || normalized.includes(':');
};

const isDomainLikeHost = (host = '') => {
  const normalized = String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  return Boolean(
    normalized
    && !isIpLikeHost(normalized)
    && !normalized.includes('_')
    && (normalized === 'localhost' || /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(normalized))
  );
};

const firstDomainHttpUrl = (...values) => {
  for (const value of values) {
    const normalized = normalizeHttpUrl(value);
    if (!normalized) continue;
    try {
      const parsed = new URL(normalized);
      if (isDomainLikeHost(parsed.hostname)) return normalized;
    } catch {
      // Ignore values that normalize but still fail URL parsing.
    }
  }
  return '';
};

const firstDomainWsUrl = (...values) => {
  for (const value of values) {
    const normalized = normalizeWsUrl(value);
    if (!normalized) continue;
    try {
      const parsed = new URL(normalized);
      if (isDomainLikeHost(parsed.hostname)) return normalized;
    } catch {
      // Ignore values that normalize but still fail URL parsing.
    }
  }
  return '';
};

const wsPath = (url, path) => {
  const normalized = normalizeWsUrl(url, isDesktopBackendTarget() ? 'ws' : 'wss');
  if (!normalized) return '';
  try {
    const parsed = new URL(normalized);
    parsed.pathname = path;
    parsed.search = '';
    parsed.hash = '';
    return trimTrailingSlash(parsed.toString());
  } catch {
    return `${normalized.replace(/\/ws\/(?:v2|feed)$/i, '')}${path}`;
  }
};

export const isDirectBrokerBackendUrl = (value) => {
  const normalized = normalizeHttpUrl(value);
  if (!normalized) return false;
  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.replace(/^\[|\]$/g, '');
    return parsed.protocol === 'http:'
      || Boolean(parsed.port)
      || host === 'localhost'
      || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)
      || host.includes(':');
  } catch {
    return false;
  }
};

export const getBackendTarget = () => {
  const desktop = isDesktopBackendTarget();
  if (!desktop) return getPublicBackendTarget();
  const config = runtimeConfig() || buildTimeEnvValues();
  // An explicitly supplied desktop config is authoritative too. Missing its
  // URL never selects a broker packaged for a different desktop installation.
  if (isElectronRuntime() && config.PINNED_BROKER === true) return '';
  return normalizeHttpUrl(presentValue(config, [
    'desktopBackendUrl', 'desktop_backend_url', 'directBackendUrl', 'direct_backend_url',
    'API_HOST', 'API_HOST_EXT', 'API_URL', 'BACKEND_URL',
    'VITE_DESKTOP_BACKEND_URL', 'VITE_DIRECT_BACKEND_URL',
    'VITE_API_HOST', 'VITE_API_HOST_EXT', 'VITE_API_URL', 'VITE_BACKEND_URL',
  ]), 'http');
};

export const normalizeBrokerInfo = (brokerInfo = {}) => {
  if (!brokerInfo || typeof brokerInfo !== 'object') return {};
  const domainBackendUrl = firstDomainHttpUrl(
    brokerInfo.server_url,
    brokerInfo.market_api_url,
    brokerInfo.backend_url,
    brokerInfo.public_backend_url,
    brokerInfo.publicBackendUrl,
    brokerInfo.web_backend_url,
    brokerInfo.webBackendUrl,
    brokerInfo.public_ext_api_url,
    brokerInfo.publicExtApiUrl,
    brokerInfo.web_ext_api_url,
    brokerInfo.webExtApiUrl,
    brokerInfo.API_HOST,
    brokerInfo.api_host,
    brokerInfo.API_HOST_EXT,
    brokerInfo.api_host_ext,
    brokerInfo.services_url,
    brokerInfo.servicesUrl
  );
  const domainWsUrl = firstDomainWsUrl(
    brokerInfo.ws_url,
    brokerInfo.wss_url,
    brokerInfo.public_ws_url,
    brokerInfo.publicWsUrl,
    brokerInfo.web_ws_url,
    brokerInfo.webWsUrl,
    brokerInfo.WS_HOST,
    brokerInfo.ws_host
  );
  const domainFeedWsUrl = firstDomainWsUrl(
    brokerInfo.feed_ws_url,
    brokerInfo.feed_wss_url,
    brokerInfo.feed_url,
    brokerInfo.public_feed_ws_url,
    brokerInfo.publicFeedWsUrl,
    brokerInfo.web_feed_ws_url,
    brokerInfo.webFeedWsUrl,
    brokerInfo.WS_HOST,
    brokerInfo.ws_host
  );
  const directBackendUrl = normalizeHttpUrl(first(
    domainBackendUrl,
    directUrlFromHostPort(brokerInfo),
    brokerInfo.desktop_backend_url,
    brokerInfo.desktopBackendUrl,
    brokerInfo.direct_backend_url,
    brokerInfo.directBackendUrl,
    brokerInfo.backend_url,
    brokerInfo.market_api_url,
    brokerInfo.server_url
  ), 'http');
  const publicBackendUrl = normalizeHttpUrl(first(
    brokerInfo.public_backend_url,
    brokerInfo.publicBackendUrl,
    brokerInfo.web_backend_url,
    brokerInfo.webBackendUrl,
    brokerInfo.API_HOST,
    brokerInfo.api_host,
    brokerInfo.services_url,
    brokerInfo.servicesUrl,
    domainBackendUrl
  ), 'https');
  const desktopExtApiUrl = normalizeHttpUrl(first(
    domainBackendUrl,
    brokerInfo.desktop_ext_api_url,
    brokerInfo.desktopExtApiUrl,
    brokerInfo.direct_ext_api_url,
    brokerInfo.directExtApiUrl,
    brokerInfo.ext_api_url,
    directBackendUrl,
    brokerInfo.market_api_url
  ), 'http');
  const publicExtApiUrl = normalizeHttpUrl(first(
    brokerInfo.public_ext_api_url,
    brokerInfo.publicExtApiUrl,
    brokerInfo.web_ext_api_url,
    brokerInfo.webExtApiUrl,
    brokerInfo.API_HOST_EXT,
    brokerInfo.api_host_ext,
    publicBackendUrl
  ), 'https');
  const desktopWsUrl = normalizeWsUrl(first(
    domainWsUrl,
    directUrlFromHostPort(brokerInfo),
    brokerInfo.desktop_ws_url,
    brokerInfo.desktopWsUrl,
    brokerInfo.direct_ws_url,
    brokerInfo.directWsUrl,
    brokerInfo.ws_url
  ), 'ws');
  const publicWsUrl = normalizeWsUrl(first(
    brokerInfo.public_ws_url,
    brokerInfo.publicWsUrl,
    brokerInfo.web_ws_url,
    brokerInfo.webWsUrl,
    brokerInfo.WS_HOST,
    brokerInfo.ws_host,
    domainWsUrl
  ), 'wss');
  const desktopFeedWsUrl = normalizeWsUrl(first(
    domainFeedWsUrl,
    directUrlFromHostPort(brokerInfo),
    brokerInfo.desktop_feed_ws_url,
    brokerInfo.desktopFeedWsUrl,
    brokerInfo.direct_feed_ws_url,
    brokerInfo.directFeedWsUrl,
    brokerInfo.feed_ws_url,
    brokerInfo.feed_url
  ), 'ws');
  const publicFeedWsUrl = normalizeWsUrl(first(
    brokerInfo.public_feed_ws_url,
    brokerInfo.publicFeedWsUrl,
    brokerInfo.web_feed_ws_url,
    brokerInfo.webFeedWsUrl,
    brokerInfo.WS_HOST,
    brokerInfo.ws_host,
    domainFeedWsUrl
  ), 'wss');

  return {
    ...brokerInfo,
    broker_id: first(brokerInfo.broker_id, brokerInfo.id),
    broker_name: first(brokerInfo.broker_name, brokerInfo.name),
    direct_backend_url: directBackendUrl,
    public_backend_url: publicBackendUrl,
    direct_ext_api_url: desktopExtApiUrl,
    public_ext_api_url: publicExtApiUrl,
    direct_ws_url: desktopWsUrl,
    public_ws_url: publicWsUrl,
    direct_feed_ws_url: desktopFeedWsUrl,
    public_feed_ws_url: publicFeedWsUrl,
    default_mt5_server: first(
      brokerInfo.default_mt5_server,
      brokerInfo.defaultMt5Server,
      brokerInfo.mt5_server,
      brokerInfo.server,
      brokerInfo.broker_server,
      brokerInfo.broker_name,
      brokerInfo.broker_id
    ),
    logo_url: first(brokerInfo.logo_url, brokerInfo.logoUrl),
    feed_status_url: normalizeHttpUrl(first(brokerInfo.feed_status_url, brokerInfo.feedStatusUrl), isDesktopBackendTarget() ? 'http' : 'https'),
  };
};

export const resolveBrokerBackendUrl = (brokerInfo = {}) => {
  if (!isDesktopBackendTarget()) return getPublicBackendTarget();
  return normalizeBrokerInfo(brokerInfo).direct_backend_url || getBackendTarget();
};
export const resolveBrokerExtApiUrl = (brokerInfo = {}) => {
  if (!isDesktopBackendTarget()) {
    const config = getRuntimeBrokerConfiguration();
    return config.valid ? config.apiHostExt : '';
  }
  const normalized = normalizeBrokerInfo(brokerInfo);
  return normalized.direct_ext_api_url || normalized.direct_backend_url || getBackendTarget();
};
export const resolveBrokerWsUrl = (brokerInfo = {}, path = '/ws/v2') => {
  if (!isDesktopBackendTarget()) return wsPath(getPublicWsTarget(), path);
  const normalized = normalizeBrokerInfo(brokerInfo);
  return wsPath(normalized.direct_ws_url || resolveBrokerBackendUrl(normalized), path);
};

export const resolveBrokerDefaultMt5Server = (brokerInfo = {}) => {
  const normalized = normalizeBrokerInfo(brokerInfo);
  return !isDesktopBackendTarget() ? getRuntimeBrokerConfiguration().defaultMt5Server : normalized.default_mt5_server || normalized.broker_name || normalized.broker_id || '';
};

export const normalizeBrokerInfoForTarget = (brokerInfo = {}) => {
  const normalized = normalizeBrokerInfo(brokerInfo);
  const backendUrl = resolveBrokerBackendUrl(normalized);
  const extApiUrl = resolveBrokerExtApiUrl(normalized);
  const wsUrl = resolveBrokerWsUrl(normalized, '/ws/v2');
  const feedUrl = isDesktopBackendTarget()
    ? wsPath(normalized.direct_feed_ws_url || normalized.direct_ws_url || backendUrl, '/ws/feed')
    : wsPath(getPublicWsTarget(), '/ws/feed');

  return {
    ...normalized,
    backend_url: backendUrl,
    market_api_url: extApiUrl,
    server_url: backendUrl,
    ws_url: wsUrl,
    feed_url: feedUrl,
    feed_ws_url: feedUrl,
    broker_server: resolveBrokerDefaultMt5Server(normalized),
  };
};
