/**
 * Transport-level reachability of the broker API (white-label, all brokers).
 *
 * A gateway restart surfaces in the browser as a failed fetch, a gateway
 * 502/503/504, or a request timeout. Those are "reconnecting" conditions:
 * the terminal shows one clear "Reconnecting to server…" state and retries
 * with a capped exponential backoff until the API answers. Every other
 * failure (configuration, authorization, compatibility) stays a visible error.
 */

/** Message the public market catalog uses for a temporary gateway failure. */
export const MARKET_DATA_TEMPORARILY_UNAVAILABLE = 'Market data is temporarily unavailable. Retrying…';

export const RECONNECT_BASE_DELAY_MS = 1_000;
export const RECONNECT_MAX_DELAY_MS = 30_000;

// Browser transport failures (Chromium, Firefox, Safari, React Native style)
// and the request-timeout messages of this terminal's own HTTP clients.
const TRANSPORT_FAILURE_MESSAGES: readonly RegExp[] = [
  /^failed to fetch\b/i,
  /^networkerror when attempting to fetch resource\.?$/i,
  /^load failed$/i,
  /^network ?error$/i,
  /^network request failed$/i,
  /\btimed out after \d+(?:\.\d+)? seconds?\.?$/i,
  // A gateway answering for an unavailable upstream (apiClient status text).
  /^HTTP Error: 50[234]$/i,
];

const GATEWAY_UNAVAILABLE_STATUSES = new Set([502, 503, 504]);

const messageOf = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object' && 'message' in value) {
    const message = (value as { message?: unknown }).message;
    return typeof message === 'string' ? message.trim() : '';
  }
  return '';
};

/** True when the error (or its display message) means the API is unreachable. */
export const isServerUnreachableError = (value: unknown): boolean => {
  if (!value) return false;
  if (typeof value === 'object') {
    const name = (value as { name?: unknown }).name;
    if (name === 'AbortError') return false;
    if (name === 'TimeoutError' || name === 'NetworkError') return true;
    const status = (value as { status?: unknown }).status;
    if (typeof status === 'number' && GATEWAY_UNAVAILABLE_STATUSES.has(status)) return true;
  }
  const message = messageOf(value);
  if (!message) return false;
  if (message === MARKET_DATA_TEMPORARILY_UNAVAILABLE) return true;
  return TRANSPORT_FAILURE_MESSAGES.some(pattern => pattern.test(message));
};

/** Capped exponential backoff: 1 s, 2 s, 4 s, … up to 30 s. */
export const getReconnectDelayMs = (attempt: number): number => {
  const step = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 0;
  return Math.min(RECONNECT_BASE_DELAY_MS * 2 ** Math.min(step, 15), RECONNECT_MAX_DELAY_MS);
};
