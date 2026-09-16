import { toLocalDevProxyUrl } from '../config/api';
import { getPublicBackendTarget } from '../config/backendTarget.js';

export interface PublicQuote {
  symbol: string;
  bid?: number;
  ask?: number;
  time?: number;
}
// Guest requests never use the account API client, stored tokens, or cookies.
async function publicGet(path: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(toLocalDevProxyUrl(`${getPublicBackendTarget()}${path}`), {
    signal, credentials: 'omit', cache: 'no-store',
  });
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403
    ? 'This broker requires login to view market data.'
    : 'Market data is temporarily unavailable. Retrying…');
  return response.json();
}
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? value as Record<string, unknown> : {};
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export async function loadPublicQuotes(signal: AbortSignal): Promise<PublicQuote[]> {
  const data = await publicGet('/api/v1/market/symbols', signal);
  const rows = Array.isArray(data) ? data : record(data).symbols;
  if (!Array.isArray(rows)) throw new Error('The broker returned an invalid market catalog.');
  return rows.map(value => {
    const row = record(value);
    return {
      symbol: String(row.symbol || '').trim(),
      bid: finite(row.bid) ? row.bid : undefined,
      ask: finite(row.ask) ? row.ask : undefined,
      time: finite(row.time) ? row.time : undefined,
    };
  }).filter(row => row.symbol).sort((a, b) => a.symbol.localeCompare(b.symbol));
}

