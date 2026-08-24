/**
 * Produce a user-safe message for a failed order submission.
 *
 * Raw error strings from the API client can contain internal URLs, host:port
 * pairs, query strings (which may carry a token), or low-level fetch noise.
 * This helper maps known trading codes and scrubs anything URL-shaped.
 */

import { ApiError } from '../api/client';
import { mapBrokerError } from '../api/brokerApi';

const URL_LIKE_RE = /\b(?:wss?|https?):\/\/\S+/gi;
const HOST_PORT_RE = /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g;
const ERROR_CODE_RE = /\b([A-Z][A-Z0-9_]{3,})\b/;

const LOCAL_TRADING_ERROR_MESSAGES: Record<string, string> = {
  MARKET_CLOSED: 'the market is currently closed for this symbol.',
  INSUFFICIENT_MARGIN: 'not enough free margin to open this order.',
  MARGIN_INSUFFICIENT: 'not enough free margin to open this order.',
  INSUFFICIENT_FUNDS: 'not enough funds to complete this order.',
  INVALID_VOLUME: 'the volume is invalid. Check the lot size and try again.',
  INVALID_SYMBOL: 'this symbol cannot be traded on the current account.',
  INVALID_SL_TP: 'the Stop Loss or Take Profit levels are invalid.',
  NO_PRICE_AVAILABLE: 'no live price is available for this symbol right now.',
  OFF_QUOTES: 'no live quote is available for this symbol right now.',
  TRADE_DISABLED: 'trading is disabled for this symbol on the current account.',
  ACCOUNT_SUSPENDED: 'this trading account is suspended.',
  ACCOUNT_NOT_FOUND: 'the trading account was not found. Please sign in again.',
  INVALID_LOGIN: 'the trading account login is invalid. Please sign in again.',
  UNAUTHORIZED: 'your session is no longer authorized. Please sign in again.',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object';

const scrub = (message: string): string =>
  message
    .replace(URL_LIKE_RE, '[server]')
    .replace(HOST_PORT_RE, '[server]')
    .trim();

const readString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const extractErrorCode = (err: unknown): string => {
  if (!isRecord(err)) return '';

  const data = isRecord(err.data) ? err.data : isRecord(err.body) ? err.body : {};
  const nested = isRecord(data.error) ? data.error : {};
  const candidates = [
    data.error,
    data.code,
    data.error_code,
    data.reason,
    nested.code,
    nested.error,
    err.code,
  ];

  for (const candidate of candidates) {
    const value = readString(candidate);
    if (value && /^[A-Z][A-Z0-9_]+$/.test(value)) return value;
  }

  const message = readString(err.message);
  const match = message.match(ERROR_CODE_RE);
  return match?.[1] || '';
};

const mapKnownTradingCode = (code: string): string => {
  const normalized = code.toUpperCase();
  if (LOCAL_TRADING_ERROR_MESSAGES[normalized]) {
    return LOCAL_TRADING_ERROR_MESSAGES[normalized];
  }

  const mapped = mapBrokerError(normalized);
  return mapped === normalized ? '' : mapped;
};

export const formatOrderError = (err: unknown): string => {
  if (err instanceof ApiError || (isRecord(err) && typeof err.status === 'number')) {
    const status = Number((err as { status: number }).status);
    const code = extractErrorCode(err);
    const mappedCode = code ? mapKnownTradingCode(code) : '';
    if (mappedCode) {
      if (/^order failed:/i.test(mappedCode)) return mappedCode;
      return mappedCode === mappedCode.toLowerCase()
        ? `Order failed: ${mappedCode}`
        : `Order failed: ${mappedCode.charAt(0).toLowerCase()}${mappedCode.slice(1)}`;
    }

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

    const detail = scrub(readString((err as { message?: unknown }).message));
    if (!detail || /^HTTP Error:\s*\d+$/i.test(detail)) {
      return 'Order failed. Please try again.';
    }
    return `Order failed: ${detail}`;
  }

  const rawMessage =
    err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  const detail = scrub(rawMessage);

  if (!detail || /failed to fetch|networkerror|load failed/i.test(detail)) {
    return 'Order failed: cannot reach the trading server. Check your connection and try again.';
  }

  if (/missing account login/i.test(detail)) {
    return 'Order failed: no trading account is selected. Please sign in again.';
  }
  if (/missing symbol/i.test(detail)) {
    return 'Order failed: no symbol is selected.';
  }
  if (/volume must be greater than zero|missing order volume/i.test(detail)) {
    return 'Order failed: the volume is invalid. Check the lot size and try again.';
  }
  if (/side must be buy or sell/i.test(detail)) {
    return 'Order failed: the order side is invalid.';
  }

  const codeMatch = detail.match(ERROR_CODE_RE);
  if (codeMatch) {
    const mapped = mapKnownTradingCode(codeMatch[1]);
    if (mapped) return `Order failed: ${mapped}`;
  }

  return `Order failed: ${detail}`;
};
