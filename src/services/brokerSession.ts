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

export type SessionChangeReason =
  | 'token_rotation'
  | 'login'
  | 'logout'
  | 'broker_url_change'
  | 'account_change';

type SessionChangeCallback = (reason: SessionChangeReason) => void;

const sessionChangeListeners = new Set<SessionChangeCallback>();

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

// ─── Runtime Input Accessors ─────────────────────────────────────────────────

/** Step 1 — Broker server URL persisted after user selects broker + logs in. */
export function getServerUrl(): string {
  if (typeof window === 'undefined') return '';
  const url = (localStorage.getItem('server_url') || '').trim().replace(/\/+$/, '');
  return url;
}

/** Step 3 — Access token stored after successful login. */
export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('auth_token') || null;
}

/** Current account login (numeric MT5 login). */
export function getAccountLogin(): number | null {
  if (typeof window === 'undefined') return null;

  // Zustand persists accountId in localStorage under 'trading-app-storage'
  const storeRaw = localStorage.getItem('trading-app-storage');
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
    const raw = localStorage.getItem(key);
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

function httpToWss(serverUrl: string): string {
  const host = getBrokerWsHost(serverUrl);
  return host ? `wss://${host}` : '';
}

/** Build authenticated WebSocket URI for the /ws/v2 endpoint (candles, account, positions). */
export function buildBrokerWsV2Uri(token?: string | null): string {
  const server = getServerUrl();
  const activeToken = token !== undefined ? token : getAccessToken();
  const fallback = import.meta.env.VITE_RTX5_WS_URL as string || 'wss://backend.orrnn.com/ws/v2';
  if (!server) return activeToken ? appendTokenToWsUrl(fallback, activeToken) : fallback;

  const brokerOrigin = httpToWss(server);
  const base = brokerOrigin ? `${brokerOrigin}/ws/v2` : fallback;
  return activeToken ? appendTokenToWsUrl(base, activeToken) : base;
}

/** Build WebSocket URI for the /ws/feed endpoint (live bid/ask quotes). */
export function buildBrokerWsFeedUri(): string {
  const server = getServerUrl();
  const fallback = import.meta.env.VITE_MARKET_WS_URL as string || 'wss://backend.orrnn.com/ws/feed';
  if (!server) return fallback;
  return `${httpToWss(server)}/ws/feed`;
}

/** Build REST API v2 base URL. */
export function buildBrokerApiV2(path = ''): string {
  const server = getServerUrl();
  const fallback = import.meta.env.VITE_RTX5_API_URL as string || '';
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
