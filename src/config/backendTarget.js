export const WEB_BACKEND_FALLBACK = 'https://services.growtradingacademy.com';
export const DESKTOP_BACKEND_FALLBACK = 'http://103.91.186.142:8091';

const URL_SCHEME_RE = /^[a-z][a-z\d+.-]*:\/\//i;
const PUBLIC_SERVICES_HOST = 'services.growtradingacademy.com';

export const trimTrailingSlash = (value) => String(value || '').trim().replace(/\/+$/, '');

const runtimeConfig = () => {
  if (typeof window === 'undefined') return {};
  return {
    ...((window.RUNTIME_CONFIG && typeof window.RUNTIME_CONFIG === 'object') ? window.RUNTIME_CONFIG : {}),
    ...((window.__RTX_RUNTIME_CONFIG__ && typeof window.__RTX_RUNTIME_CONFIG__ === 'object') ? window.__RTX_RUNTIME_CONFIG__ : {}),
  };
};

const envValue = (key) => {
  try {
    return import.meta.env?.[key] || '';
  } catch {
    return '';
  }
};

const isDesktopTargetValue = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'desktop' || normalized === 'electron' || normalized === 'direct';
};

const isWebTargetValue = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'web' || normalized === 'browser' || normalized === 'public';
};

const isDesktopRuntime = () => {
  if (typeof window === 'undefined') return false;
  const config = runtimeConfig();
  const target = String(first(
    config.backendTarget,
    config.backend_target,
    config.BACKEND_TARGET,
    config.VITE_BACKEND_TARGET,
    config.runtimeTarget,
    config.runtime_target,
    config.target,
    config.platform,
    envValue('BACKEND_TARGET'),
    envValue('VITE_BACKEND_TARGET')
  )).toLowerCase();
  const mode = String(first(
    config.backendMode,
    config.backend_mode,
    config.BACKEND_MODE,
    config.VITE_BACKEND_MODE,
    envValue('BACKEND_MODE'),
    envValue('VITE_BACKEND_MODE')
  )).toLowerCase();
  if (isDesktopTargetValue(target) || isDesktopTargetValue(mode)) return true;
  if (isWebTargetValue(target) || isWebTargetValue(mode)) return false;
  return Boolean(window.electronAPI)
    || window.location?.protocol === 'file:'
    || (typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron'));
};

const normalizeHttpUrl = (value, fallbackProtocol = 'https') => {
  const trimmed = trimTrailingSlash(value);
  if (!trimmed) return '';
  if (trimmed.startsWith('//')) return `${fallbackProtocol}:${trimmed}`;
  return URL_SCHEME_RE.test(trimmed) ? trimmed : `${fallbackProtocol}://${trimmed}`;
};

const normalizeWsUrl = (value, fallbackProtocol = 'wss') => {
  const trimmed = trimTrailingSlash(value);
  if (!trimmed) return '';
  if (trimmed.startsWith('//')) return `${fallbackProtocol}:${trimmed}`;
  if (/^wss?:\/\//i.test(trimmed)) return trimmed;
  if (/^https:\/\//i.test(trimmed)) return trimmed.replace(/^https:\/\//i, 'wss://');
  if (/^http:\/\//i.test(trimmed)) return trimmed.replace(/^http:\/\//i, 'ws://');
  return URL_SCHEME_RE.test(trimmed) ? trimmed : `${fallbackProtocol}://${trimmed}`;
};

const isPublicServicesUrl = (value, normalize) => {
  const normalized = normalize(value);
  if (!normalized) return false;

  try {
    const parsed = new URL(normalized);
    return parsed.hostname.toLowerCase() === PUBLIC_SERVICES_HOST;
  } catch {
    return false;
  }
};

const first = (...values) => {
  for (const value of values) {
    const trimmed = trimTrailingSlash(value);
    if (trimmed) return trimmed;
  }
  return '';
};

const runtimeFirst = (...keys) => {
  const config = runtimeConfig();
  return first(...keys.map((key) => config[key]));
};

export const getPublicBackendTarget = () => {
  const candidate = runtimeFirst(
    'API_HOST',
    'API_HOST_EXT',
    'VITE_API_HOST',
    'VITE_API_HOST_EXT',
    'VITE_API_URL',
    'VITE_BACKEND_URL'
  );
  return isPublicServicesUrl(candidate, normalizeHttpUrl)
    ? normalizeHttpUrl(candidate, 'https')
    : WEB_BACKEND_FALLBACK;
};

export const getPublicWsTarget = () => {
  const candidate = runtimeFirst(
    'WS_HOST',
    'VITE_WS_HOST',
    'VITE_WS_URL',
    'VITE_RTX5_WS_URL',
    'VITE_MARKET_WS_URL'
  );
  return isPublicServicesUrl(candidate, normalizeWsUrl)
    ? normalizeWsUrl(candidate, 'wss')
    : normalizeWsUrl(getPublicBackendTarget(), 'wss');
};

export const getRuntimeDiscoveryBaseUrl = (fallback = '') => {
  const candidate = first(
    runtimeFirst('DISCOVERY_BASE_URL', 'VITE_DISCOVERY_BASE_URL', 'VITE_BROKER_DISCOVERY_URL'),
    envValue('VITE_DISCOVERY_BASE_URL'),
    envValue('VITE_BROKER_DISCOVERY_URL'),
    fallback
  );
  return normalizeHttpUrl(candidate, 'https');
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
    brokerInfo.port,
    '8091'
  );
  const protocol = String(first(brokerInfo.protocol, brokerInfo.backend_protocol) || 'http').replace(/:$/, '');
  const authority = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  return `${protocol}://${authority}${port ? `:${port}` : ''}`;
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

export const isDesktopBackendTarget = () => isDesktopRuntime();

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
  const config = runtimeConfig();
  const desktop = isDesktopBackendTarget();
  if (!desktop) return getPublicBackendTarget();

  const candidate = desktop
    ? first(
      config.desktopBackendUrl,
      config.desktop_backend_url,
      config.directBackendUrl,
      config.direct_backend_url,
      config.API_HOST,
      config.API_HOST_EXT,
      envValue('VITE_DESKTOP_BACKEND_URL'),
      envValue('VITE_DIRECT_BACKEND_URL')
    )
    : '';

  return normalizeHttpUrl(candidate || DESKTOP_BACKEND_FALLBACK, 'http');
};

export const normalizeBrokerInfo = (brokerInfo = {}) => {
  if (!brokerInfo || typeof brokerInfo !== 'object') return {};
  const directBackendUrl = normalizeHttpUrl(first(
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
    brokerInfo.servicesUrl
  ), 'https');
  const desktopExtApiUrl = normalizeHttpUrl(first(
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
    brokerInfo.ws_host
  ), 'wss');
  const desktopFeedWsUrl = normalizeWsUrl(first(
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
    brokerInfo.ws_host
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
  const normalized = normalizeBrokerInfo(brokerInfo);
  return isDesktopBackendTarget()
    ? (normalized.direct_backend_url || getBackendTarget())
    : getBackendTarget();
};

export const resolveBrokerExtApiUrl = (brokerInfo = {}) => {
  const normalized = normalizeBrokerInfo(brokerInfo);
  return isDesktopBackendTarget()
    ? (normalized.direct_ext_api_url || normalized.direct_backend_url || getBackendTarget())
    : getBackendTarget();
};

export const resolveBrokerWsUrl = (brokerInfo = {}, path = '/ws/v2') => {
  const normalized = normalizeBrokerInfo(brokerInfo);
  if (!isDesktopBackendTarget()) return wsPath(getPublicWsTarget(), path);

  const explicit = isDesktopBackendTarget()
    ? normalized.direct_ws_url
    : normalized.public_ws_url;
  if (explicit) return wsPath(explicit, path);
  return wsPath(resolveBrokerBackendUrl(normalized), path);
};

export const resolveBrokerDefaultMt5Server = (brokerInfo = {}) => {
  const normalized = normalizeBrokerInfo(brokerInfo);
  return normalized.default_mt5_server || normalized.broker_name || normalized.broker_id || 'RTX-Server';
};

export const normalizeBrokerInfoForTarget = (brokerInfo = {}) => {
  const normalized = normalizeBrokerInfo(brokerInfo);
  const backendUrl = resolveBrokerBackendUrl(normalized);
  const extApiUrl = resolveBrokerExtApiUrl(normalized);
  const wsUrl = resolveBrokerWsUrl(normalized, '/ws/v2');
  const feedUrl = (() => {
    const explicit = isDesktopBackendTarget() ? normalized.direct_feed_ws_url : normalized.public_feed_ws_url;
    return explicit ? wsPath(explicit, '/ws/feed') : resolveBrokerWsUrl(normalized, '/ws/feed');
  })();

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
