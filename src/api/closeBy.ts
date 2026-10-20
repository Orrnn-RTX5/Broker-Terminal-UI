import { API_V2_BASE_URL } from '../config/api';
import { apiClient, type ApiRequestOptions } from './client';
import { createTradeOrderUuid, isTradeOrderUuidV4 } from './tradeSocket';

/**
 * Close-by (net two opposite-side same-symbol positions against each other).
 *
 * Backend contract: POST /api/v2/positions/close-by decodes with
 * DisallowUnknownFields into CloseByPositionCommand —
 * `{ client_order_id, account_login, position_ticket, other_position_ticket,
 *    expected_state_version, other_expected_state_version }`.
 *
 * Tickets and versions are canonical decimal STRINGS (positive, no leading
 * zeros) and are never coerced to Number: ticket/version scale can exceed
 * Number.MAX_SAFE_INTEGER (PostgreSQL bigint), so any numeric coercion would
 * silently corrupt the identity. Fail closed: every leg must carry a usable
 * ticket and a positive version or no request is sent.
 */

export const CLOSE_BY_ENDPOINT = '/positions/close-by';
export const CLOSE_BY_CONTEXT = '/api/v2/positions/close-by';

const DECIMAL_PATTERN = /^\d+$/;

/** Minimal structural shape of a position leg. Accepts store and gateway aliases. */
export interface CloseByLegSource {
  readonly ticket?: unknown;
  readonly id?: unknown;
  readonly state_version?: unknown;
  readonly state_version_text?: unknown;
}

/** Minimal structural shape needed for counterpart matching. */
export interface CloseByMatchable extends CloseByLegSource {
  readonly symbol?: unknown;
  readonly side?: unknown;
}

export interface CloseByRequestBody {
  client_order_id: string;
  account_login: number;
  position_ticket: string;
  other_position_ticket: string;
  expected_state_version: string;
  other_expected_state_version: string;
}

export interface CloseByCallOptions extends ApiRequestOptions {
  client_order_id?: string;
  account_login?: unknown;
}

/**
 * Canonical positive-int64 decimal string without leading zeros (gateway
 * CloseByPositionCommand). Version '0'/missing means the row predates
 * versioning or the feed hasn't delivered it: block with a refresh message,
 * never send (the gateway would 409 POSITION_STATE_CHANGED).
 */
export const requireCloseByCanonicalVersion = (value: unknown): string => {
  const text = typeof value === 'number'
    ? (Number.isSafeInteger(value) ? String(value) : '')
    : String(value ?? '').trim();
  if (/^[1-9]\d*$/.test(text)) return text;
  throw new Error(
    `Position data is stale for ${CLOSE_BY_CONTEXT}: refresh the positions list and retry`,
  );
};

/** Account login for the body (gateway requires account_login > 0 in-body). */
export const requireCloseByAccountLogin = (value: unknown): number => {
  const login = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  if (Number.isSafeInteger(login) && login > 0) return login;
  throw new Error(`No trading account is selected for ${CLOSE_BY_CONTEXT}`);
};

/** Canonical positive decimal ticket as a string (no leading zeros — the
 * gateway requires strconv.FormatInt(v,10)==s). Rejects unsafe numbers,
 * zero, fractions and padded strings like "007". */
export const requireCloseByTicket = (value: unknown): string => {
  if (typeof value === 'number') {
    if (Number.isSafeInteger(value) && value > 0) return String(value);
  } else if (typeof value === 'string' && /^[1-9]\d*$/.test(value.trim())) {
    return value.trim();
  }
  throw new Error(`Invalid ticket for ${CLOSE_BY_CONTEXT}`);
};

/**
 * Position version as a decimal string. `'0'` is accepted (unversioned legacy
 * rows); the concurrency check itself is server-side. Never coerced to Number.
 */
export const requireCloseByVersion = (value: unknown): string => {
  if (typeof value === 'number') {
    if (Number.isSafeInteger(value) && value >= 0) return String(value);
  } else if (typeof value === 'string' && DECIMAL_PATTERN.test(value)) {
    return value;
  }
  throw new Error(`Invalid version for ${CLOSE_BY_CONTEXT}`);
};

/** Canonical decimal ticket string, or null when the leg names no usable ticket. */
export const readCloseByLegTicket = (leg: CloseByLegSource | null | undefined): string | null => {
  if (!leg || typeof leg !== 'object') return null;
  try {
    return requireCloseByTicket(leg.ticket ?? leg.id);
  } catch {
    return null;
  }
};

/** Canonical decimal version string (`state_version_text` wins: exact bigint text). */
export const readCloseByLegVersion = (leg: CloseByLegSource | null | undefined): string | null => {
  if (!leg || typeof leg !== 'object') return null;
  const record = leg as Record<string, unknown>;
  try {
    return requireCloseByVersion(record.state_version_text ?? record.state_version);
  } catch {
    return null;
  }
};

const normalizeCloseBySide = (side: unknown): 'BUY' | 'SELL' | null => {
  const normalized = String(side ?? '').trim().toUpperCase();
  return normalized === 'BUY' || normalized === 'SELL' ? normalized : null;
};

const normalizeCloseBySymbol = (symbol: unknown): string => String(symbol ?? '').trim().toUpperCase();

const compareDecimalStrings = (a: string, b: string): number => {
  const left = a.replace(/^0+/, '') || '0';
  const right = b.replace(/^0+/, '') || '0';
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  return left < right ? -1 : left > right ? 1 : 0;
};

/**
 * Find the opposite-side same-symbol counterpart for a close-by pair.
 *
 * Deterministic lowest-ticket rule: when several opposite-side same-symbol
 * positions exist, the one with the lowest decimal ticket wins. Returns null
 * (no menu item, no request) when the row itself is unusable or no counterpart
 * exists. Fail-closed by construction: unknown sides, blank symbols, invalid
 * tickets and self-matches never pair.
 */
export const findCloseByCounterpart = <T extends CloseByMatchable>(
  row: T | null | undefined,
  all: readonly T[] | null | undefined,
): T | null => {
  if (!row || typeof row !== 'object' || !Array.isArray(all)) return null;
  const rowTicket = readCloseByLegTicket(row);
  const rowSide = normalizeCloseBySide(row.side);
  const rowSymbol = normalizeCloseBySymbol(row.symbol);
  if (!rowTicket || !rowSide || !rowSymbol) return null;

  let best: T | null = null;
  let bestTicket: string | null = null;
  for (const candidate of all) {
    if (!candidate || typeof candidate !== 'object' || candidate === row) continue;
    if (normalizeCloseBySide(candidate.side) === null || normalizeCloseBySide(candidate.side) === rowSide) continue;
    if (normalizeCloseBySymbol(candidate.symbol) !== rowSymbol) continue;
    const ticket = readCloseByLegTicket(candidate);
    if (!ticket || ticket === rowTicket) continue;
    if (bestTicket === null || compareDecimalStrings(ticket, bestTicket) < 0) {
      best = candidate;
      bestTicket = ticket;
    }
  }
  return best;
};

/** Deterministic pair key for in-flight guards (order-independent). */
export const buildCloseByPairKey = (firstTicket: string, secondTicket: string): string => (
  [firstTicket, secondTicket].sort().join(':')
);

/**
 * Build the exact POST body in backend DTO field order. Legs are ordered
 * ascending by ticket with each version following its ticket. Throws —
 * sending nothing — on any invalid leg, on a self-pair, on a stale/missing
 * version, on a missing account login, or on a non-UUID caller-supplied
 * idempotency key.
 */
export const buildCloseByRequestBody = (
  first: CloseByLegSource | null | undefined,
  second: CloseByLegSource | null | undefined,
  options?: { client_order_id?: unknown; account_login?: unknown },
): CloseByRequestBody => {
  const accountLogin = requireCloseByAccountLogin(options?.account_login);
  const firstTicket = requireCloseByTicket((first as Record<string, unknown> | null | undefined)?.ticket ?? (first as Record<string, unknown> | null | undefined)?.id);
  const secondTicket = requireCloseByTicket((second as Record<string, unknown> | null | undefined)?.ticket ?? (second as Record<string, unknown> | null | undefined)?.id);
  if (firstTicket === secondTicket) {
    throw new Error(`Refusing ambiguous close-by for ${CLOSE_BY_CONTEXT}: both legs name the same ticket`);
  }
  const firstVersion = requireCloseByCanonicalVersion(
    (first as Record<string, unknown> | null | undefined)?.state_version_text ?? (first as Record<string, unknown> | null | undefined)?.state_version,
  );
  const secondVersion = requireCloseByCanonicalVersion(
    (second as Record<string, unknown> | null | undefined)?.state_version_text ?? (second as Record<string, unknown> | null | undefined)?.state_version,
  );
  const supplied = String(options?.client_order_id ?? '').trim();
  if (supplied && !isTradeOrderUuidV4(supplied)) throw new Error('client_order_id must be a UUID v4');

  const firstIsLow = compareDecimalStrings(firstTicket, secondTicket) <= 0;
  return {
    client_order_id: supplied || createTradeOrderUuid(),
    account_login: accountLogin,
    position_ticket: firstIsLow ? firstTicket : secondTicket,
    other_position_ticket: firstIsLow ? secondTicket : firstTicket,
    expected_state_version: firstIsLow ? firstVersion : secondVersion,
    other_expected_state_version: firstIsLow ? secondVersion : firstVersion,
  };
};

/**
 * POST the close-by intent. The gateway requires account_login in the body
 * (auth token alone is not enough — unlike single-position close).
 */
export const closePositionsBy = async (
  first: CloseByLegSource | null | undefined,
  second: CloseByLegSource | null | undefined,
  options?: CloseByCallOptions,
): Promise<unknown> => {
  const { client_order_id: clientOrderId, account_login: accountLogin, ...requestInit } = options ?? {};
  return apiClient.post<unknown>(
    CLOSE_BY_ENDPOINT,
    buildCloseByRequestBody(first, second, { client_order_id: clientOrderId, account_login: accountLogin }),
    { ...requestInit, baseUrl: API_V2_BASE_URL },
  );
};
