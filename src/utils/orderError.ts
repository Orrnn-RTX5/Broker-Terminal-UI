/**
 * Produce a user-safe message for a failed order submission.
 *
 * Raw error strings from the API client can contain internal URLs, host:port
 * pairs, query strings (which may carry a token), or low-level fetch noise
 * ("Failed to fetch", "NetworkError when attempting to fetch resource ...").
 * Surfacing those verbatim in an alert leaks infrastructure detail and confuses
 * the trader. This helper maps known cases to clean copy and scrubs anything
 * URL-shaped out of the fallback message.
 */

const URL_LIKE_RE = /\b(?:wss?|https?):\/\/\S+/gi;
const HOST_PORT_RE = /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g;

const isApiErrorLike = (err: unknown): err is { status: number; message: string } =>
  typeof err === 'object' &&
  err !== null &&
  typeof (err as { status?: unknown }).status === 'number' &&
  typeof (err as { message?: unknown }).message === 'string';

const scrub = (message: string): string =>
  message
    .replace(URL_LIKE_RE, '[server]')
    .replace(HOST_PORT_RE, '[server]')
    .trim();

export const formatOrderError = (err: unknown): string => {
  if (isApiErrorLike(err)) {
    const status = err.status;
    if (status === 0) {
      return 'Order failed: cannot reach the trading server. Check your connection and try again.';
    }
    if (status === 401 || status === 403) {
      return 'Order failed: your session is no longer authorized. Please sign in again.';
    }
    if (status === 429) {
      return 'Order failed: too many requests. Please slow down and try again.';
    }
    if (status >= 500) {
      return 'Order failed: the trading server reported an error. Please try again shortly.';
    }
    const detail = scrub(err.message || '');
    return detail ? `Order failed: ${detail}` : 'Order failed. Please try again.';
  }

  const rawMessage =
    err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  const detail = scrub(rawMessage);

  if (!detail || /failed to fetch|networkerror|load failed/i.test(detail)) {
    return 'Order failed: cannot reach the trading server. Check your connection and try again.';
  }

  return `Order failed: ${detail}`;
};
