import { normalizeExactBrokerSymbol } from './exactBrokerSymbol';

/**
 * Shareable trade deep links.
 *
 * The chart's Share button copies a URL with a `#share=<base64url(JSON)>`
 * fragment. Opening that URL restores the shared view: the app switches to
 * the trade's symbol/timeframe and the chart draws the shared trade (entry
 * line, marker, SL/TP) from the payload — so the link keeps showing the trade
 * exactly as shared even after the position itself is closed.
 */

export const TRADE_SHARE_HASH_PARAM = 'share';

export interface SharedChartTrade {
  version: 1;
  ticket: number;
  symbol: string;
  timeframe: string;
  side: 'BUY' | 'SELL';
  volume: number;
  entryPrice: number;
  /** Chart-domain unix seconds of the entry candle. 0 when unknown. */
  entryTime: number;
  sl: number;
  tp: number;
}

const toBase64Url = (text: string): string => {
  const base64 = typeof btoa === 'function'
    ? btoa(unescape(encodeURIComponent(text)))
    : Buffer.from(text, 'utf8').toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const fromBase64Url = (encoded: string): string | null => {
  try {
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const raw = typeof atob === 'function'
      ? atob(padded)
      : Buffer.from(padded, 'base64').toString('binary');
    return decodeURIComponent(escape(raw));
  } catch {
    return null;
  }
};

const toFinite = (value: unknown, fallback = 0): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

export const encodeTradeShare = (trade: SharedChartTrade): string => toBase64Url(JSON.stringify({
  v: 1,
  k: trade.ticket,
  s: trade.symbol,
  f: trade.timeframe,
  d: trade.side,
  q: trade.volume,
  e: trade.entryPrice,
  t: trade.entryTime,
  l: trade.sl,
  p: trade.tp,
}));

export const decodeTradeShare = (encoded: string): SharedChartTrade | null => {
  const json = fromBase64Url(String(encoded ?? '').trim());
  if (!json) return null;
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;
    if (Number(raw.v) !== 1) return null;
    // FIX: A shared chart must reopen the exact broker contract; stripping a
    // dot/hyphen silently redirected suffixed symbols to a different market.
    const symbol = normalizeExactBrokerSymbol(raw.s);
    const timeframe = String(raw.f ?? '').trim().toUpperCase();
    const side = String(raw.d ?? '').toUpperCase();
    const ticket = toFinite(raw.k);
    const volume = toFinite(raw.q);
    const entryPrice = toFinite(raw.e);
    if (!symbol || (side !== 'BUY' && side !== 'SELL')) return null;
    if (!(volume > 0) || !(entryPrice > 0)) return null;
    return {
      version: 1,
      ticket: ticket > 0 ? Math.floor(ticket) : 0,
      symbol,
      timeframe,
      side,
      volume,
      entryPrice,
      entryTime: Math.max(0, Math.floor(toFinite(raw.t))),
      sl: Math.max(0, toFinite(raw.l)),
      tp: Math.max(0, toFinite(raw.p)),
    };
  } catch {
    return null;
  }
};

/** Builds the share URL on top of the current page location (hash replaced). */
export const buildTradeShareUrl = (
  trade: SharedChartTrade,
  baseHref?: string,
): string => {
  const href = String(baseHref ?? (typeof window !== 'undefined' ? window.location.href : '')).trim();
  const withoutHash = href.split('#')[0] || '';
  return `${withoutHash}#${TRADE_SHARE_HASH_PARAM}=${encodeTradeShare(trade)}`;
};

export const parseTradeShareFromHref = (href: string): SharedChartTrade | null => {
  const hashIndex = String(href ?? '').indexOf('#');
  if (hashIndex < 0) return null;
  const hash = String(href).slice(hashIndex + 1);
  const match = new RegExp(`(?:^|[&;])${TRADE_SHARE_HASH_PARAM}=([A-Za-z0-9_-]+)`).exec(hash);
  if (!match) return null;
  return decodeTradeShare(match[1]);
};

let cachedSharedTrade: SharedChartTrade | null | undefined;

/**
 * The shared trade encoded in the URL this page was opened with, parsed once.
 * Stays stable for the whole session so the chart annotation cannot flicker.
 */
export const getSharedChartTrade = (): SharedChartTrade | null => {
  if (cachedSharedTrade === undefined) {
    cachedSharedTrade = typeof window === 'undefined'
      ? null
      : parseTradeShareFromHref(window.location.href);
  }
  return cachedSharedTrade;
};

/** Test hook: forget the cached URL parse. */
export const resetSharedChartTradeCache = (): void => {
  cachedSharedTrade = undefined;
};

export const copyTextToClipboard = async (text: string): Promise<boolean> => {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy path (clipboard API needs a secure context).
    }
  }
  if (typeof document === 'undefined') return false;
  let textarea: HTMLTextAreaElement | null = null;
  try {
    textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
    document.body.appendChild(textarea);
    textarea.select();
    return typeof document.execCommand === 'function' && document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea?.remove();
  }
};
