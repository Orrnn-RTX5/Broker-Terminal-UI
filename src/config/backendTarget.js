export const WEB_BACKEND_FALLBACK = 'https://backend.orrnn.com';
export const SHARED_DISCOVERY_FALLBACK = 'https://superbackend.orrnn.com';
// Last-resort desktop default. Must NOT hardcode a public broker IP: doing so
// leaks infra detail and sends the Bearer JWT in cleartext to a public host,
// defeating the TLS intent of normalizeBrokerServerUrl. A desktop build should
// always receive its real backend via runtime/env config; this loopback default
// only exists so the app does not crash when nothing is configured, and cleartext
// to loopback is already permitted by the cleartext-downgrade allow-list.
export const DESKTOP_BACKEND_FALLBACK = 'http://127.0.0.1:8090';

const URL_SCHEME_RE = /^[a-z][a-z\d+.-]*:\/\//i;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export const trimTrailingSlash = (value) => String(value || '').trim().replace(/\/+$/, '');

const runtimeConfig = () => {
  if (typeof window === 'undefined') return {};
  return {
    ...((window.RUNTIME_CONFIG && typeof window.RUNTIME_CONFIG === 'object') ? window.RUNTIME_CONFIG : {}),
    ...((window.__RTX_RUNTIME_CONFIG__ && typeof window.__RTX_RUNTIME_CONFIG__ === 'object') ? window.__RTX_RUNTIME_CONFIG__ : {}),
  };
};

const buildTimeEnvValues = () => ({
  BACKEND_TARGET: import.meta.env.BACKEND_TARGET || '',
  VITE_BACKEND_TARGET: import.meta.env.VITE_BACKEND_TARGET || '',
  BACKEND_MODE: import.meta.env.BACKEND_MODE || '',
  VITE_BACKEND_MODE: import.meta.env.VITE_BACKEND_MODE || '',
  VITE_API_HOST: import.meta.env.VITE_API_HOST || '',
  VITE_API_HOST_EXT: import.meta.env.VITE_API_HOST_EXT || '',
  VITE_API_URL: import.meta.env.VITE_API_URL || '',
  VITE_BACKEND_URL: import.meta.env.VITE_BACKEND_URL || '',
  VITE_WS_HOST: import.meta.env.VITE_WS_HOST || '',
  VITE_WS_URL: import.meta.env.VITE_WS_URL || '',
  VITE_RTX5_WS_URL: import.meta.env.VITE_RTX5_WS_URL || '',
  VITE_MARKET_WS_URL: import.meta.env.VITE_MARKET_WS_URL || '',
  VITE_DISCOVERY_BASE_URL: import.meta.env.VITE_DISCOVERY_BASE_URL || '',
  VITE_BROKER_DISCOVERY_URL: import.meta.env.VITE_BROKER_DISCOVERY_URL || '',
  VITE_BROKER_ID: import.meta.env.VITE_BROKER_ID || '',
  VITE_DESKTOP_BACKEND_URL: import.meta.env.VITE_DESKTOP_BACKEND_URL || '',
  VITE_DIRECT_BACKEND_URL: import.meta.env.VITE_DIRECT_BACKEND_URL || '',
});

const envValue = (key) => {
  try {
    const values = buildTimeEnvValues();
    return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : '';
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

// UI selection is independent of backend transport: a browser may use a local backend.
export const isElectronRuntime = () => {
  if (typeof window === 'undefined') return false;
  return Boolean(
    window.electron?.window
    || window.electronAPI
    || window.location?.protocol === 'file:'
    || (typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron'))
  );
};

const isDesktopRuntime = () => {
  if (typeof window === 'undefined') return false;
  if (isElectronRuntime()) return true;

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
  return false;
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

const isAllowedPublicBrokerHostname = (hostname = '') => {
  const normalized = String(hostname || '').trim().toLowerCase();
  return normalized.startsWith('services.')
    || normalized === 'service.achieverfinancials.com'
    || normalized === 'fxtrusts-broker.orrnn.com'
    || normalized === 'nexa.orrnn.com'
    || normalized === 'backend.orrnn.com'
    || normalized === 'testbrokerbackend.orrnn.com'
    || normalized === 'fxtrustbrokerbackend.orrnn.com'
    || normalized === 'services.growtradingacademy.com'
    || normalized === 'services.myprop.trade';
};

const isPublicBrokerUrl = (value, normalize) => {
  const normalized = normalize(value);
  if (!normalized) return false;

  try {
    const parsed = new URL(normalized);
    const hostname = parsed.hostname.toLowerCase();
    const protocol = parsed.protocol.toLowerCase();
    const isSecure = protocol === 'https:' || protocol === 'wss:';
    return isSecure
      && !LOCAL_HOSTS.has(hostname)
      && !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)
      && !hostname.includes(':')
      && isAllowedPublicBrokerHostname(hostname);
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

const runtimeApiHostCandidates = () => [
  runtimeFirst(
    'API_HOST',
    'API_HOST_EXT',
    'VITE_API_HOST',
    'VITE_API_HOST_EXT',
    'VITE_API_URL',
    'VITE_BACKEND_URL'
  ),
  envValue('VITE_API_HOST'),
  envValue('VITE_API_HOST_EXT'),
  envValue('VITE_API_URL'),
  envValue('VITE_BACKEND_URL'),
  getPublicBackendTarget(),
];

const isBrokerApiHost = (value) => {
  const normalized = normalizeHttpUrl(value, 'https');
  if (!normalized || normalized === SHARED_DISCOVERY_FALLBACK) return false;

  return runtimeApiHostCandidates().some((candidate) =>
    normalizeHttpUrl(candidate, 'https') === normalized
  );
};

const isConfirmedExplicitBrokerDiscoveryUrl = (value) => {
  const normalized = normalizeHttpUrl(value, 'https');
  if (!normalized || !isPublicBrokerUrl(normalized, normalizeHttpUrl)) return false;

  const config = runtimeConfig();
  const configuredPairs = [
    [
      first(config.DISCOVERY_BASE_URL, config.VITE_DISCOVERY_BASE_URL),
      first(config.BROKER_DISCOVERY_URL, config.VITE_BROKER_DISCOVERY_URL),
    ],
    [envValue('VITE_DISCOVERY_BASE_URL'), envValue('VITE_BROKER_DISCOVERY_URL')],
  ];

  return configuredPairs.some(([discoveryBaseUrl, brokerDiscoveryUrl]) =>
    normalizeHttpUrl(discoveryBaseUrl, 'https') === normalized
    && normalizeHttpUrl(brokerDiscoveryUrl, 'https') === normalized
  );
};

export const getPublicBackendTarget = () => {
  const candidate = first(
    runtimeFirst(
      'API_HOST',
      'API_HOST_EXT',
      'VITE_API_HOST',
      'VITE_API_HOST_EXT',
      'VITE_API_URL',
      'VITE_BACKEND_URL'
    ),
    envValue('VITE_API_HOST'),
    envValue('VITE_API_HOST_EXT'),
    envValue('VITE_API_URL'),
    envValue('VITE_BACKEND_URL')
  );
  return isPublicBrokerUrl(candidate, normalizeHttpUrl)
    ? normalizeHttpUrl(candidate, 'https')
    : WEB_BACKEND_FALLBACK;
};

export const getPublicWsTarget = () => {
  const candidate = first(
    runtimeFirst(
      'WS_HOST',
      'VITE_WS_HOST',
      'VITE_WS_URL',
      'VITE_RTX5_WS_URL',
      'VITE_MARKET_WS_URL'
    ),
    envValue('VITE_WS_HOST'),
    envValue('VITE_WS_URL'),
    envValue('VITE_RTX5_WS_URL'),
    envValue('VITE_MARKET_WS_URL')
  );
  return isPublicBrokerUrl(candidate, normalizeWsUrl)
    ? normalizeWsUrl(candidate, 'wss')
    : normalizeWsUrl(getPublicBackendTarget(), 'wss');
};

export const getRuntimeDiscoveryBaseUrl = (fallback = SHARED_DISCOVERY_FALLBACK) => {
  const candidates = [
    runtimeFirst('DISCOVERY_BASE_URL', 'VITE_DISCOVERY_BASE_URL', 'VITE_BROKER_DISCOVERY_URL'),
    envValue('VITE_DISCOVERY_BASE_URL'),
    envValue('VITE_BROKER_DISCOVERY_URL'),
    fallback,
    SHARED_DISCOVERY_FALLBACK,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeHttpUrl(candidate, 'https');
    if (normalized && (
      !isBrokerApiHost(normalized)
      || isConfirmedExplicitBrokerDiscoveryUrl(normalized)
    )) return normalized;
  }

  return SHARED_DISCOVERY_FALLBACK;
};

// The broker id that identifies THIS deployment. Each terminal is the same
// shared bundle differentiated at runtime by `runtime-config.js`
// (window.__RTX_RUNTIME_CONFIG__.BROKER_ID), so the runtime value must win over
// the build-time env baked into the shared bundle.
export const getRuntimeConfiguredBrokerId = () =>
  String(first(
    runtimeFirst('BROKER_ID', 'VITE_BROKER_ID', 'brokerId', 'broker_id'),
    envValue('VITE_BROKER_ID'),
  )).trim();

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
      envValue('VITE_DIRECT_BACKEND_URL'),
      envValue('VITE_API_HOST'),
      envValue('VITE_API_HOST_EXT'),
      envValue('VITE_API_URL'),
      envValue('VITE_BACKEND_URL')
    )
    : '';

  return normalizeHttpUrl(candidate || DESKTOP_BACKEND_FALLBACK, 'http');
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
    brokerInfo.servicesUrl
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
    brokerInfo.ws_host
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
