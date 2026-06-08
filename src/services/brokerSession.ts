/**
 * Shared Broker + Session Inputs (Section 1 of WebSocket Flow)
 *
 * Single source of truth for the runtime values every WebSocket connection needs:
 *   brokerServerUrl, accessToken, accountLogin, quoteSymbols, chartSymbol + timeframe
 *
 * Flow:
 *   1. User chooses broker on login  → brokerId, serverUrl
 *   2. Persist broker session        → stored in Zustand + secure storage
 *   3. Login returns tokens           → accessToken, refreshToken
 *   4. Build WS origins              → Broker HTTP origin → WSS
 *   5. Runtime inputs are ready       → Screens/services consume them
 *
 * Dynamic values come from API, config, or user state — never hardcoded.
 */

// ─── Session Change Event Bus ────────────────────────────────────────────────

import { getBackendTarget, isDesktopBackendTarget, normalizeBrokerInfoForTarget } from '../config/backendTarget.js';
import { isCleartextDowngradeAllowedHost } from '../config/urlSecurity';

export type SessionChangeReason =
  | 'token_rotation'
  | 'login'
  | 'logout'
  | 'broker_url_change'
  | 'account_change';

type SessionChangeCallback = (reason: SessionChangeReason) => void;

const sessionChangeListeners = new Set<SessionChangeCallback>();

const emitAuthTokenUpdated = (): void => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event('auth:token-updated'));
};

const getBrowserStorage = (kind: 'localStorage' | 'sessionStorage'): Storage | null => {
  if (typeof window === 'undefined') return null;

  try {
    const storage = window[kind];
    return storage && typeof storage.getItem === 'function' ? storage : null;
  } catch {
    return null;
  }
};

const getLocalStorageItem = (key: string): string | null => getBrowserStorage('localStorage')?.getItem(key) ?? null;
const setLocalStorageItem = (key: string, value: string): void => getBrowserStorage('localStorage')?.setItem(key, value);
const removeLocalStorageItem = (key: string): void => getBrowserStorage('localStorage')?.removeItem(key);
const getSessionStorageItem = (key: string): string | null => getBrowserStorage('sessionStorage')?.getItem(key) ?? null;
const removeSessionStorageItem = (key: string): void => getBrowserStorage('sessionStorage')?.removeItem(key);

const FORCE_HTTP_ONLY = import.meta.env.VITE_FORCE_HTTP_ONLY === 'true';
const hasUrlScheme = (value: string): boolean => /^[a-z][a-z\d+.-]*:\/\//i.test(value);

const getRuntimePageProtocol = (): string => {
  if (typeof window === 'undefined' || !window.location?.protocol) return 'https:';
  return window.location.protocol === 'https:' ? 'https:' : 'http:';
};

const shouldForceHttpProtocol = (): boolean =>
  FORCE_HTTP_ONLY && getRuntimePageProtocol() !== 'https:';

const getRuntimeProtocol = (): string => {
  if (shouldForceHttpProtocol()) return 'http:';
  return getRuntimePageProtocol();
};

const getRuntimeWsProtocol = (): string => {
  return getRuntimeProtocol() === 'https:' ? 'wss:' : 'ws:';
};

const normalizeServerUrl = (value: string): string => {
  const trimmed = String(value || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (trimmed.startsWith('//')) return `${getRuntimeProtocol()}${trimmed}`;
  return hasUrlScheme(trimmed) ? trimmed : `${getRuntimeProtocol()}//${trimmed}`;
};

const normalizeBrokerServerUrl = (value: string): string => {
  const normalized = normalizeServerUrl(value);
  if (!shouldForceHttpProtocol() || !normalized) return normalized;

  try {
    const parsed = new URL(normalized);
    // Only downgrade to cleartext for loopback/RFC1918/link-local targets. A
    // public broker host must NEVER be silently stripped of TLS even under
    // FORCE_HTTP_ONLY — that would expose the bearer token + orders to MITM.
    // Mirrors the guard in config/api.ts:normalizeBrokerServerUrl.
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
    // Unparseable URL: cannot safely identify the host, so never downgrade.
    return normalized;
  }
};

const normalizeWsUrl = (value: string): string => {
  const trimmed = String(value || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (trimmed.startsWith('//')) return `${getRuntimeWsProtocol()}${trimmed}`;
  if (/^wss?:\/\//i.test(trimmed)) return trimmed;
  if (/^https:\/\//i.test(trimmed)) return trimmed.replace(/^https:\/\//i, 'wss://');
  if (/^http:\/\//i.test(trimmed)) return trimmed.replace(/^http:\/\//i, 'ws://');
  if (hasUrlScheme(trimmed)) return trimmed;
  return `${getRuntimeWsProtocol()}//${trimmed}`;
};

export interface BrokerSessionDiscoveryInput {
  access_token?: string | null;
  token?: string | null;
  broker_id?: string | null;
  backend_url?: string | null;
  market_api_url?: string | null;
  server_url?: string | null;
  broker_server?: string | null;
  ws_url?: string | null;
  feed_url?: string | null;
  feed_ws_url?: string | null;
  feed_status_url?: string | null;
  logo_url?: string | null;
}

export function onSessionChange(cb: SessionChangeCallback): () => void {
  sessionChangeListeners.add(cb);
  return () => { sessionChangeListeners.delete(cb); };
}

export function emitSessionChange(reason: SessionChangeReason): void {
  console.log(`[BrokerSession] Session change: ${reason}`);
  sessionChangeListeners.forEach((cb) => {
    try { cb(reason); } catch (e) { console.error('[BrokerSession] listener error:', e); }
  });
}

const normalizeOptionalHttpUrl = (value: string | null | undefined): string => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  return isDesktopBackendTarget() ? normalizeBrokerServerUrl(trimmed) : normalizeServerUrl(trimmed);
};

const isUrlLikeParsedHost = (parsed: URL): boolean => {
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  return Boolean(
    host
    && (
      host.toLowerCase() === 'localhost'
      || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)
      || host.includes(':')
      || host.includes('.')
      || Boolean(parsed.port)
    )
  );
};

const isUrlLikeHttpOriginValue = (value: string | null | undefined): boolean => {
  const raw = String(value || '').trim();
  if (!raw) return false;

  const normalized = normalizeServerUrl(raw);

  try {
    const parsed = new URL(normalized);
    return isUrlLikeParsedHost(parsed);
  } catch {
    return false;
  }
};

const isUrlLikeWsEndpointValue = (value: string | null | undefined): boolean => {
  const raw = String(value || '').trim();
  if (!raw) return false;

  const normalized = normalizeWsUrl(raw);

  try {
    const parsed = new URL(normalized);
    return (parsed.protocol === 'ws:' || parsed.protocol === 'wss:') && isUrlLikeParsedHost(parsed);
  } catch {
    return false;
  }
};

const normalizeOptionalMarketHttpUrl = (value: string | null | undefined): string => {
  const trimmed = String(value || '').trim();
  if (!trimmed || !isUrlLikeHttpOriginValue(trimmed)) return '';
  return isDesktopBackendTarget() ? normalizeBrokerServerUrl(trimmed) : normalizeServerUrl(trimmed);
};

const pickFirstMarketHttpUrl = (...values: Array<string | null | undefined>): string => {
  for (const value of values) {
    const normalized = normalizeOptionalMarketHttpUrl(value);
    if (normalized) return normalized;
  }

  return '';
};

const normalizeOptionalWsUrl = (value: string | null | undefined): string => {
  const trimmed = String(value || '').trim();
  return trimmed && isUrlLikeWsEndpointValue(trimmed) ? normalizeWsUrl(trimmed) : '';
};

const forceWssForHttpsFrontend = (url: string): string => {
  if (typeof window === 'undefined' || window.location?.protocol !== 'https:') return url;
  return url.replace(/^ws:\/\//i, 'wss://');
};

const getStoredUrlByKeys = (keys: string[]): string => {
  if (typeof window === 'undefined') return '';

  for (const key of keys) {
    const value = (getLocalStorageItem(key) || '').trim();
    if (value) return value;
  }

  return '';
};

const setOrRemove = (key: string, value: string): void => {
  if (value) {
    setLocalStorageItem(key, value);
  } else {
    removeLocalStorageItem(key);
  }
};

const hasBrokerServerChanged = (nextServerUrl: string): boolean => {
  if (!nextServerUrl || typeof window === 'undefined') return false;
  const currentServerUrl = normalizeOptionalMarketHttpUrl(getLocalStorageItem('server_url'));
  return Boolean(currentServerUrl && currentServerUrl !== nextServerUrl);
};

const isPort8091Url = (value: string): boolean => {
  if (!value) return false;

  try {
    const parsed = new URL(value);
    return parsed.port === '8091';
  } catch {
    return /(^|\/\/|\])[^/?#]*:8091(?=\/|[?#]|$)/i.test(value);
  }
};

const isValidMarketOrigin = (value: string): boolean => Boolean(value && !isPort8091Url(value));

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

const isAllowedPublicBrokerHostname = (hostname: string): boolean => {
  const normalized = hostname.toLowerCase();
  return (normalized.startsWith('services.')
    || normalized === 'backend.orrnn.com'
    || normalized === 'testbrokerbackend.orrnn.com')
    && !LOCAL_HOSTS.has(normalized)
    && !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalized)
    && !normalized.includes(':');
};

const isPublicBrokerWsUrl = (value: string): boolean => {
  const normalized = normalizeOptionalWsUrl(value);
  if (!normalized) return false;

  try {
    const parsed = new URL(normalized);
    return parsed.protocol === 'wss:' && isAllowedPublicBrokerHostname(parsed.hostname);
  } catch {
    return false;
  }
};

const getHttpOriginFromHttpUrl = (value: string | null | undefined): string => {
  const normalized = normalizeOptionalMarketHttpUrl(value);
  if (!normalized) return '';

  try {
    const parsed = new URL(normalized);
    parsed.pathname = '';
    parsed.search = '';
    parsed.hash = '';
    return normalizeOptionalHttpUrl(parsed.toString());
  } catch {
    return '';
  }
};

const getHttpOriginFromStoredHttpUrl = (value: string | null | undefined): string => {
  const raw = String(value || '').trim();
  if (!/^https?:\/\//i.test(raw)) return '';
  return getHttpOriginFromHttpUrl(raw);
};

const getHttpOriginFromWsUrl = (value: string | null | undefined): string => {
  const normalized = normalizeOptionalWsUrl(value);
  if (!normalized) return '';

  try {
    const parsed = new URL(normalized);
    if (parsed.protocol === 'ws:') {
      parsed.protocol = 'http:';
    } else if (parsed.protocol === 'wss:') {
      parsed.protocol = 'https:';
    } else {
      return '';
    }
    parsed.pathname = '';
    parsed.search = '';
    parsed.hash = '';
    return normalizeOptionalHttpUrl(parsed.toString());
  } catch {
    return '';
  }
};

const getCurrentValidMarketOrigin = (): string => {
  if (typeof window === 'undefined') return '';

  const httpCandidates = [
    getHttpOriginFromHttpUrl(getLocalStorageItem('backend_url')),
    getHttpOriginFromHttpUrl(getLocalStorageItem('server_url')),
    getHttpOriginFromStoredHttpUrl(getLocalStorageItem('rtx_broker_server')),
  ];

  for (const candidate of httpCandidates) {
    if (isValidMarketOrigin(candidate)) return candidate;
  }

  const wsCandidates = [
    getHttpOriginFromWsUrl(getLocalStorageItem('feed_url')),
    getHttpOriginFromWsUrl(getLocalStorageItem('ws_url')),
  ];

  for (const candidate of wsCandidates) {
    if (isValidMarketOrigin(candidate)) return candidate;
  }

  return '';
};

const isSameOrUnknownBroker = (nextBrokerId: string): boolean => {
  if (typeof window === 'undefined') return true;
  const currentBrokerId = String(
    getLocalStorageItem('broker_id')
    || getLocalStorageItem('rtx_broker_id')
    || ''
  ).trim();
  return !currentBrokerId || !nextBrokerId || currentBrokerId === nextBrokerId;
};

const shouldKeepCurrentMarketOrigin = (
  nextUrl: string,
  hasToken: boolean,
  hasExplicitValidMarketUrl: boolean,
  currentMarketOrigin: string,
  sameBroker: boolean
): boolean =>
  Boolean(
    hasToken
    && sameBroker
    && currentMarketOrigin
    && !hasExplicitValidMarketUrl
    && nextUrl
    && isPort8091Url(nextUrl)
  );

const pickPersistedMarketOrigin = (
  nextUrl: string,
  hasToken: boolean,
  hasExplicitValidMarketUrl: boolean,
  currentMarketOrigin: string,
  sameBroker: boolean
): string => {
  if (shouldKeepCurrentMarketOrigin(nextUrl, hasToken, hasExplicitValidMarketUrl, currentMarketOrigin, sameBroker)) {
    return currentMarketOrigin;
  }

  return nextUrl;
};

const pickPersistedFeedUrl = (nextFeedUrl: string, nextWsUrl: string, hasToken: boolean): string => {
  if (typeof window === 'undefined') return nextFeedUrl;

  const currentFeedUrl = normalizeOptionalWsUrl(getLocalStorageItem('feed_url'));
  const hasValidDiscoveryFeed = Boolean(currentFeedUrl && !isPort8091Url(currentFeedUrl));
  const nextLooksLikeBadLoginFeed = Boolean(
    (nextFeedUrl && isPort8091Url(nextFeedUrl))
    || (!nextFeedUrl && nextWsUrl && isPort8091Url(nextWsUrl))
  );

  if (hasValidDiscoveryFeed && (nextLooksLikeBadLoginFeed || (hasToken && !nextFeedUrl))) {
    return currentFeedUrl;
  }

  return nextFeedUrl;
};

const pickPersistedWsUrl = (
  nextWsUrl: string,
  hasToken: boolean,
  hasExplicitValidMarketUrl: boolean,
  currentMarketOrigin: string,
  sameBroker: boolean
): string => {
  if (!shouldKeepCurrentMarketOrigin(nextWsUrl, hasToken, hasExplicitValidMarketUrl, currentMarketOrigin, sameBroker)) {
    return nextWsUrl;
  }

  const currentWsUrl = normalizeOptionalWsUrl(getLocalStorageItem('ws_url'));
  if (isValidMarketOrigin(currentWsUrl)) {
    return normalizeWsUrlToV2(currentWsUrl);
  }

  const currentFeedUrl = normalizeOptionalWsUrl(getLocalStorageItem('feed_url'));
  if (isValidMarketOrigin(currentFeedUrl)) {
    return normalizeWsUrlToV2(currentFeedUrl);
  }

  return appendWsV2Path(httpToWss(currentMarketOrigin));
};

export function persistBrokerSessionDiscovery(input: BrokerSessionDiscoveryInput): void {
  if (typeof window === 'undefined') return;

  const normalizedInput = normalizeBrokerInfoForTarget(input) as BrokerSessionDiscoveryInput;
  const token = String(normalizedInput.access_token || normalizedInput.token || '').trim();
  const brokerId = String(normalizedInput.broker_id || '').trim();
  const hasToken = Boolean(token);
  const sameBroker = isSameOrUnknownBroker(brokerId);
  const currentMarketOrigin = getCurrentValidMarketOrigin();
  const explicitMarketUrl = pickFirstMarketHttpUrl(normalizedInput.market_api_url, normalizedInput.backend_url);
  const hasExplicitValidMarketUrl = isValidMarketOrigin(explicitMarketUrl);
  const backendCandidateUrl = explicitMarketUrl;
  const serverCandidateUrl = explicitMarketUrl || pickFirstMarketHttpUrl(normalizedInput.server_url, normalizedInput.broker_server);
  const wsCandidateUrl = normalizeOptionalWsUrl(normalizedInput.ws_url);
  const backendUrl = pickPersistedMarketOrigin(backendCandidateUrl, hasToken, hasExplicitValidMarketUrl, currentMarketOrigin, sameBroker);
  const serverUrl = pickPersistedMarketOrigin(serverCandidateUrl, hasToken, hasExplicitValidMarketUrl, currentMarketOrigin, sameBroker);
  const wsUrl = pickPersistedWsUrl(wsCandidateUrl, hasToken, hasExplicitValidMarketUrl, currentMarketOrigin, sameBroker);
  const feedUrl = pickPersistedFeedUrl(normalizeOptionalWsUrl(normalizedInput.feed_url || normalizedInput.feed_ws_url), wsUrl, Boolean(token));
  const feedStatusUrl = normalizeOptionalHttpUrl(normalizedInput.feed_status_url);
  const logoUrl = String(normalizedInput.logo_url || '').trim();
  const brokerChangedWithoutToken = !token && hasBrokerServerChanged(serverUrl);

  if (token) {
    setLocalStorageItem('auth_token', token);
    emitAuthTokenUpdated();
  } else if (brokerChangedWithoutToken) {
    removeLocalStorageItem('auth_token');
    removeSessionStorageItem('auth_token');
    emitAuthTokenUpdated();
  }
  if (brokerId) {
    setLocalStorageItem('broker_id', brokerId);
    setLocalStorageItem('rtx_broker_id', brokerId);
  }
  if (backendUrl) setLocalStorageItem('backend_url', backendUrl);
  if (serverUrl) {
    setLocalStorageItem('server_url', serverUrl);
    setLocalStorageItem('rtx_broker_server', serverUrl);
  }
  setOrRemove('ws_url', wsUrl);
  setOrRemove('feed_url', feedUrl);
  setOrRemove('feed_status_url', feedStatusUrl);
  if (logoUrl) setLocalStorageItem('logo_url', logoUrl);

  emitSessionChange(token ? 'login' : 'broker_url_change');
}

// ─── Runtime Input Accessors ─────────────────────────────────────────────────

/** Step 1 — Broker server URL persisted after user selects broker + logs in. */
export function getServerUrl(): string {
  if (typeof window === 'undefined') return '';
  if (!isDesktopBackendTarget()) return getBackendTarget();

  const raw = (getLocalStorageItem('server_url') || '').trim().replace(/\/+$/, '');
  if (!raw) return getCurrentValidMarketOrigin();

  const normalized = normalizeOptionalMarketHttpUrl(raw);
  if (!normalized) {
    return getCurrentValidMarketOrigin();
  }
  if (isPort8091Url(normalized)) {
    return getCurrentValidMarketOrigin() || normalized;
  }

  return normalized;
}

/** Step 3 — Access token stored after successful login. */
export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return getLocalStorageItem('auth_token') || getSessionStorageItem('auth_token') || null;
}

/** Current account login (numeric MT5 login). */
export function getAccountLogin(): number | null {
  if (typeof window === 'undefined') return null;

  // Zustand persists accountId in localStorage under 'trading-app-storage'
  const storeRaw = getLocalStorageItem('trading-app-storage');
  if (storeRaw) {
    try {
      const parsed = JSON.parse(storeRaw);
      const id = Number.parseInt(String(parsed?.state?.accountId ?? ''), 10);
      if (Number.isFinite(id) && id > 0) return id;
    } catch { /* ignore */ }
  }

  // Fallback: direct keys
  const directKeys = ['rtx_saved_username', 'rtx_last_login'];
  for (const key of directKeys) {
    const raw = getLocalStorageItem(key);
    const parsed = Number.parseInt(String(raw ?? ''), 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  return null;
}

// ─── Step 4 — Build WS Origins ──────────────────────────────────────────────

/** Convert HTTP broker origin to WSS and append a path.
 *  e.g. https://broker.orrnn.com → wss://broker.orrnn.com/ws/v2 */
export function getBrokerWsHost(serverUrl: string): string {
  const trimmed = String(serverUrl || '').trim();
  if (!trimmed) return '';

  const authority = trimmed
    .replace(/^[a-z][a-z\d+.-]*:\/\//i, '')
    .replace(/^\/+/, '')
    .split(/[/?#]/)[0];
  const host = authority.includes('@') ? authority.slice(authority.lastIndexOf('@') + 1) : authority;
  if (host) return host.replace(/\/+$/, '');

  try {
    const parsed = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    return parsed.host;
  } catch {
    return trimmed
      .replace(/^https?:\/\//i, '')
      .replace(/^\/+/, '')
      .split(/[/?#]/)[0]
      .replace(/\/+$/, '');
  }
}

const appendTokenToWsUrl = (url: string, token: string): string => {
  const hashIndex = url.indexOf('#');
  const withoutHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : '';
  const queryIndex = withoutHash.indexOf('?');

  if (queryIndex < 0) {
    return `${withoutHash}?token=${encodeURIComponent(token)}${hash}`;
  }

  const base = withoutHash.slice(0, queryIndex);
  const params = new URLSearchParams(withoutHash.slice(queryIndex + 1));
  params.set('token', token);
  return `${base}?${params.toString()}${hash}`;
};

const getBrokerWsProtocol = (serverUrl: string): string => {
  const trimmed = String(serverUrl || '').trim();
  if (!trimmed) {
    if (typeof window === 'undefined' || !window.location?.protocol) return 'wss:';
    return window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  }

  const normalized = trimmed.includes('://') ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(normalized);
    return parsed.protocol === 'https:' ? 'wss:' : 'ws:';
  } catch {
    if (trimmed.startsWith('//')) {
      return window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    }
    return trimmed.toLowerCase().startsWith('https://') ? 'wss:' : 'ws:';
  }
};

function httpToWss(serverUrl: string): string {
  const host = getBrokerWsHost(serverUrl);
  const protocol = getBrokerWsProtocol(serverUrl);
  return host ? `${protocol}//${host}` : '';
}

function appendWsFeedPath(wsOrigin: string): string {
  if (!wsOrigin) return '';

  const trimmed = wsOrigin.replace(/\/+$/, '');
  return /\/ws\/feed$/i.test(trimmed) ? trimmed : `${trimmed}/ws/feed`;
}

function appendWsV2Path(wsOrigin: string): string {
  if (!wsOrigin) return '';

  const trimmed = wsOrigin.replace(/\/+$/, '');
  return /\/ws\/v2$/i.test(trimmed) ? trimmed : `${trimmed}/ws/v2`;
}

function normalizeWsUrlToFeed(wsUrl: string): string {
  const normalized = normalizeWsUrl(wsUrl);
  if (!normalized) return '';
  if (/\/ws\/feed(?:[?#].*)?$/i.test(normalized)) return normalized;

  try {
    const parsed = new URL(normalized);
    parsed.pathname = '/ws/feed';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return appendWsFeedPath(normalized.replace(/\/ws\/v2(?:[?#].*)?$/i, ''));
  }
}

function normalizeWsUrlToV2(wsUrl: string): string {
  const normalized = normalizeWsUrl(wsUrl);
  if (!normalized) return '';
  if (/\/ws\/v2(?:[?#].*)?$/i.test(normalized)) {
    return normalized.replace(/[?#].*$/, '');
  }

  try {
    const parsed = new URL(normalized);
    parsed.pathname = '/ws/v2';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return appendWsV2Path(normalized.replace(/\/ws\/feed(?:[?#].*)?$/i, ''));
  }
}

const getRuntimeMarketOrigin = (): string => {
  if (!isDesktopBackendTarget()) return getBackendTarget();

  const currentMarketOrigin = getCurrentValidMarketOrigin();
  if (isValidMarketOrigin(currentMarketOrigin)) return currentMarketOrigin;

  return getServerUrl();
};

const canUseStoredWsUrl = (candidate: string, marketOrigin: string): boolean =>
  Boolean(
    candidate
    && isUrlLikeWsEndpointValue(candidate)
    && (isDesktopBackendTarget() || isPublicBrokerWsUrl(candidate))
    && !(isPort8091Url(candidate) && isValidMarketOrigin(marketOrigin))
  );

const pickStoredWsUrl = (candidates: string[], marketOrigin: string): string => {
  for (const candidate of candidates) {
    if (canUseStoredWsUrl(candidate, marketOrigin)) return candidate;
  }

  return '';
};

/** Build authenticated WebSocket URI for the /ws/v2 endpoint (candles, account, positions). */
export function buildBrokerWsV2Uri(token?: string | null): string {
  const server = getRuntimeMarketOrigin();
  const activeToken = token !== undefined ? token : getAccessToken();
  const storedWsCandidate = typeof window !== 'undefined'
    ? normalizeWsUrlToV2(getLocalStorageItem('ws_url') || '')
    : '';
  const storedFeedCandidate = typeof window !== 'undefined'
    ? normalizeWsUrlToV2(getLocalStorageItem('feed_url') || '')
    : '';
  const storedWsUrl = pickStoredWsUrl([storedWsCandidate, storedFeedCandidate], server);
  const fallback = normalizeWsUrlToV2(
    import.meta.env.VITE_RTX5_WS_URL as string
    || import.meta.env.VITE_WS_URL as string
    || import.meta.env.VITE_MARKET_WS_URL as string
    || ''
  );
  const secureStoredWsUrl = forceWssForHttpsFrontend(storedWsUrl);
  const secureFallback = forceWssForHttpsFrontend(fallback);
  if (secureStoredWsUrl) return activeToken ? appendTokenToWsUrl(secureStoredWsUrl, activeToken) : secureStoredWsUrl;
  if (!server) return activeToken ? (secureFallback ? appendTokenToWsUrl(secureFallback, activeToken) : '') : secureFallback;

  const brokerOrigin = forceWssForHttpsFrontend(httpToWss(server));
  const base = brokerOrigin ? `${brokerOrigin}/ws/v2` : secureFallback;
  return activeToken ? appendTokenToWsUrl(base, activeToken) : base;
}

/** Build WebSocket URI for the /ws/feed endpoint (live bid/ask quotes). */
export function buildBrokerWsFeedUri(): string {
  const server = getRuntimeMarketOrigin();
  const providedFeedUrl = normalizeWsUrl(getStoredUrlByKeys(['feed_url']));
  if (canUseStoredWsUrl(providedFeedUrl, server)) {
    return forceWssForHttpsFrontend(providedFeedUrl);
  }

  const providedWsUrl = normalizeWsUrlToFeed(getStoredUrlByKeys(['ws_url']));
  if (canUseStoredWsUrl(providedWsUrl, server)) {
    return forceWssForHttpsFrontend(providedWsUrl);
  }

  const fallback = normalizeWsUrl(
    import.meta.env.VITE_MARKET_WS_URL as string
    || import.meta.env.VITE_RTX5_WS_URL as string
    || ''
  );
  if (!server) return forceWssForHttpsFrontend(fallback);
  return forceWssForHttpsFrontend(appendWsFeedPath(httpToWss(server)));
}

/** Build REST API v2 base URL. */
export function buildBrokerApiV2(path = ''): string {
  const server = getServerUrl();
  const fallback = normalizeServerUrl(
    import.meta.env.VITE_RTX5_API_URL as string
    || import.meta.env.VITE_API_URL as string
    || import.meta.env.VITE_BACKEND_URL as string
    || ''
  );
  const base = server ? `${server}/api/v2` : (fallback ? `${fallback.replace(/\/$/, '')}/api/v2` : '');
  return path ? `${base}${path.startsWith('/') ? '' : '/'}${path}` : base;
}

// ─── Step 5 — Runtime Inputs Ready Check ─────────────────────────────────────

/** All three runtime inputs must be available before WebSocket connections are opened. */
export function isSessionReady(): boolean {
  const server = getServerUrl();
  const token = getAccessToken();
  const ready = Boolean(server && token);
  if (!ready) {
    console.warn(`[BrokerSession] isSessionReady=false | server_url=${server ? 'SET' : 'MISSING'} | auth_token=${token ? 'SET' : 'MISSING'}`);
  }
  return ready;
}

// ─── Convenience: get the broker WebSocket URL used by config/api.ts ─────────

/** Called by config/api.ts updateDynamicUrls(). */
export function getWsV2Url(): string {
  return buildBrokerWsV2Uri();
}

export function getWsFeedUrl(): string {
  return buildBrokerWsFeedUri();
}

/** Helper: extract server URL from socket URI for reconnect checks. */
export function getSocketServerOrigin(): string {
  const server = getServerUrl();
  if (!server) return '';
  return httpToWss(server);
}
