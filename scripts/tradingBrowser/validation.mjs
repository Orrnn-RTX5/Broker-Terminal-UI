/**
 * Pure helpers for the trading-browser latency harness.
 *
 * Dependency-free so `node --test` can exercise them without vite/puppeteer.
 * Nothing here logs tokens: callers must redact before printing.
 */

// Loopback + RFC1918/link-local only. Anything else (public IPs, public
// hostnames, production broker hosts) is rejected by the harness entrypoint.
const PRODUCTION_HOST_HINTS = [
  'orrnn.com',
  'backend.orrnn.com',
  'testbrokerbackend.orrnn.com',
];

export const isLoopbackHostname = (hostname) => {
  const h = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '::ffff:127.0.0.1';
};

const isPrivateIpv4 = (hostname) => {
  const m = String(hostname || '').trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (m.slice(1).some((o) => Number(o) > 255)) return false;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // link-local
  return false;
};

export const isLocalGatewayUrl = (value) => {
  let url;
  try {
    url = new URL(String(value || ''));
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'ws:') return false;
  const hostname = url.hostname.toLowerCase();
  if (PRODUCTION_HOST_HINTS.some((hint) => hostname === hint || hostname.endsWith(`.${hint}`))) return false;
  return isLoopbackHostname(hostname) || isPrivateIpv4(hostname);
};

export const redactIdentity = (identity) => {
  if (!identity || typeof identity !== 'object') return { account_login: null, token: '[redacted]' };
  return {
    account_login: Number(identity.account_login) || null,
    token: identity.token ? '[redacted]' : '[missing]',
  };
};

/** Parse `--key value` / `--key=value` args. Repeated keys keep the last value. */
export const parseTradingBrowserArgs = (argv) => {
  const out = {
    mode: 'transport',
    gatewayUrl: '',
    identity: '',
    symbol: 'EURUSD',
    volume: 0.01,
    samples: 5,
    timeoutMs: 30_000,
    headless: true,
    screenshots: '',
    vitePort: 0,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const raw = String(argv[i] ?? '');
    if (!raw.startsWith('--')) continue;
    const eq = raw.indexOf('=');
    const key = eq === -1 ? raw.slice(2) : raw.slice(2, eq);
    const next = eq === -1 ? argv[i + 1] : raw.slice(eq + 1);
    const takeValue = () => {
      if (eq !== -1) return String(next ?? '');
      if (i + 1 < argv.length && !String(argv[i + 1]).startsWith('--')) {
        i += 1;
        return String(argv[i]);
      }
      return 'true';
    };
    switch (key) {
      case 'mode': out.mode = takeValue(); break;
      case 'gateway-url': case 'gatewayUrl': out.gatewayUrl = takeValue(); break;
      case 'identity': out.identity = takeValue(); break;
      case 'symbol': out.symbol = takeValue(); break;
      case 'volume': out.volume = Number(takeValue()); break;
      case 'samples': out.samples = Math.max(1, Math.min(50, Number.parseInt(takeValue(), 10) || 1)); break;
      case 'timeout-ms': case 'timeoutMs': out.timeoutMs = Number(takeValue()) || out.timeoutMs; break;
      case 'headless': out.headless = takeValue() !== 'false'; break;
      case 'screenshots': out.screenshots = takeValue() === 'true' ? '' : takeValue(); break;
      case 'vite-port': case 'vitePort': out.vitePort = Number.parseInt(takeValue(), 10) || 0; break;
      default: break;
    }
  }
  return out;
};

const sortedCopy = (values) => [...values].filter(Number.isFinite).sort((a, b) => a - b);

export const percentile = (values, ratio) => {
  const sorted = sortedCopy(values);
  if (!sorted.length) return null;
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(ratio * sorted.length) - 1));
  return sorted[rank];
};

/** Real measured samples only: { count, p50, p95, max, min }. Null when empty. */
export const summarizeMs = (values) => {
  const sorted = sortedCopy(values);
  if (!sorted.length) return null;
  return {
    count: sorted.length,
    min: sorted[0],
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted[sorted.length - 1],
  };
};

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isUuidV4 = (value) => typeof value === 'string' && UUID_V4.test(value.trim());

/**
 * Count distinct user intents vs transport frames.
 * Duplicate-intent bug = same logical action minted a second client_order_id.
 * Transport retry with the SAME id = exactly one intent (correct).
 */
export const countIntents = (frames) => {
  const byClientOrderId = new Map();
  for (const frame of frames || []) {
    const id = String(frame?.client_order_id || '').trim();
    if (!id) continue;
    byClientOrderId.set(id, (byClientOrderId.get(id) || 0) + 1);
  }
  return {
    distinctIntents: byClientOrderId.size,
    framesByIntent: Object.fromEntries(byClientOrderId),
  };
};

export const validateSyntheticIdentity = (identity) => {
  if (!identity || typeof identity !== 'object') return 'identity must be a JSON object';
  if (!Number.isFinite(Number(identity.account_login)) || Number(identity.account_login) <= 0) {
    return 'identity.account_login must be a positive number';
  }
  if (typeof identity.token !== 'string' || !identity.token.trim()) {
    return 'identity.token must be a non-empty string';
  }
  return null;
};
export const LIVE_SYMBOL = 'PERFUSD';
export const LIVE_BASE_PRICE = 100;
export const LIVE_MODIFY_SL = 95;
export const LIVE_MODIFY_TP = 105;
export const LIVE_PENDING_PRICE = 90;
export const LIVE_PENDING_SIDE = 'buy';
export const LIVE_PENDING_TYPE = 'buy_limit';

export const isLiveSymbol = (value) => String(value || '').trim() === LIVE_SYMBOL;

/**
 * Normalize a live identity JSON value (already parsed) to
 * { account_login, token }. Accepts an object
 * ({account_login|login|accountLogin, token|auth_token|access_token}) or a
 * file array form: [login, token] or [{...}, ...] (first entry wins).
 * Never includes the token value in errors.
 */
export const normalizeLiveIdentity = (parsed) => {
  let candidate = parsed;
  if (Array.isArray(candidate)) {
    if (candidate.length === 2 && (typeof candidate[0] === 'number' || typeof candidate[0] === 'string') && typeof candidate[1] === 'string' && (typeof candidate[0] !== 'object')) {
      candidate = { account_login: candidate[0], token: candidate[1] };
    } else if (candidate.length >= 1 && candidate[0] && typeof candidate[0] === 'object') {
      candidate = candidate[0];
    } else {
      throw new Error('live identity file must be an object or [login, token] / [{...}] array');
    }
  }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error('live identity file must be an object or [login, token] / [{...}] array');
  }
  const loginRaw = candidate.account_login ?? candidate.login ?? candidate.accountLogin;
  const tokenRaw = candidate.token ?? candidate.auth_token ?? candidate.authToken ?? candidate.access_token ?? candidate.accessToken;
  const normalized = { account_login: Number(loginRaw), token: typeof tokenRaw === 'string' ? tokenRaw : '' };
  const problem = validateSyntheticIdentity(normalized);
  if (problem) throw new Error(`live identity invalid: ${problem}`);
  return normalized;
};

/**
 * Derive the WS URL for a loopback HTTP gateway URL.
 * http://host:port[/...] -> ws://host:port/ws/v2. Rejects non-local URLs.
 */
export const deriveLiveWsUrl = (httpUrl) => {
  let url;
  try {
    url = new URL(String(httpUrl || ''));
  } catch {
    throw new Error('live --gateway-url must be a loopback http URL');
  }
  if (url.protocol !== 'http:') throw new Error('live --gateway-url must be a loopback http URL (http only)');
  if (!isLocalGatewayUrl(url.toString())) throw new Error('live --gateway-url must be a loopback http URL (local only)');
  return `ws://${url.host}/ws/v2`;
};
