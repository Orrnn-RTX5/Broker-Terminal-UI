import { useEffect, useState } from 'react';
import { apiClient, type ApiRequestOptions } from '../../api/client';
import { API_V2_BASE_URL, toLocalDevProxyUrl } from '../../config/api';
import { applyAccountSpreadMarkup } from '../../services/accountSpreadMarkup';
import { getAccessToken, getServerUrl } from '../../services/brokerSession';
import { useAppStore } from '../../store/useAppStore';
import { asUnknownRecord, readBrokerTimestampMs } from '../../utils/brokerStreamSemantics';
import { normalizeExactBrokerSymbol } from '../../utils/exactBrokerSymbol';
import { MARKET_WATCH_TICK_CHART_LIMIT, type TickChartPoint } from './tickChartGeometry';

const EMPTY_HISTORY: readonly TickChartPoint[] = Object.freeze([]);

const positivePrice = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

/**
 * Parses `/api/v2/ticks/{symbol}` into chronological chart points. Rows for
 * another contract, without broker time, or without both quote sides are
 * skipped rather than repaired.
 */
export const parseMarketWatchTickHistory = (
  response: unknown,
  symbol: string,
): TickChartPoint[] => {
  const exactSymbol = normalizeExactBrokerSymbol(symbol);
  const record = asUnknownRecord(response);
  const rows = Array.isArray(response) ? response : record?.ticks ?? record?.data;
  if (!Array.isArray(rows)) return [];
  const points: TickChartPoint[] = [];
  rows.forEach((value) => {
    const row = asUnknownRecord(value);
    if (!row || (row.symbol && normalizeExactBrokerSymbol(row.symbol) !== exactSymbol)) return;
    const timestamp = readBrokerTimestampMs([row]);
    const rawBid = positivePrice(row.bid);
    const rawAsk = positivePrice(row.ask);
    if (timestamp === undefined || rawBid === null || rawAsk === null) return;
    // History arrives on the raw feed basis; live ticks carry the account's
    // spread markup, so both are shown on the same basis.
    const { bid, ask } = applyAccountSpreadMarkup(exactSymbol, { bid: rawBid, ask: rawAsk, spread: rawAsk - rawBid });
    points.push({ timestamp, bid: Number(bid), ask: Number(ask) });
  });
  return points.sort((left, right) => left.timestamp - right.timestamp);
};

/**
 * Recent broker ticks that precede this session's live buffer, loaded once
 * per symbol and broker/account scope. They are display data only and never
 * enter the live tick stores.
 */
export function useMarketWatchTickHistory(
  symbol: string,
  scopeKey: string | null | undefined,
): readonly TickChartPoint[] {
  const exactSymbol = normalizeExactBrokerSymbol(symbol);
  const requestKey = exactSymbol && scopeKey ? `${scopeKey}\u0000${exactSymbol}` : null;
  const [loaded, setLoaded] = useState<{ key: string; points: readonly TickChartPoint[] } | null>(null);

  useEffect(() => {
    if (!requestKey) return undefined;
    const controller = new AbortController();
    const serverUrl = getServerUrl().replace(/\/+$/, '');
    const baseUrl = serverUrl ? `${toLocalDevProxyUrl(serverUrl)}/api/v2` : API_V2_BASE_URL;
    const state = useAppStore.getState();
    const authToken = getAccessToken() || state.authToken;
    // Capture routing and credentials once so a later account switch cannot
    // attach this symbol's history to the next account.
    const options: ApiRequestOptions = {
      baseUrl,
      skipDynamicUrl: true,
      authToken,
      skipAuth: !authToken,
      signal: controller.signal,
      params: { limit: MARKET_WATCH_TICK_CHART_LIMIT },
      requestContext: {
        key: `market-watch-tick-history:${requestKey}`,
        backendOrigin: baseUrl.replace(/\/api\/v2\/?$/, ''),
        refreshEndpoint: `${baseUrl}/auth/refresh`,
        refreshToken: state.refreshToken,
      },
    };
    apiClient.get<unknown>(`/ticks/${encodeURIComponent(exactSymbol)}`, options)
      .then((response) => {
        if (controller.signal.aborted) return;
        setLoaded({ key: requestKey, points: parseMarketWatchTickHistory(response, exactSymbol) });
      })
      .catch(() => {
        // Brokers without tick history still chart the live ticks.
      });
    return () => controller.abort();
  }, [exactSymbol, requestKey]);

  return loaded?.key === requestKey ? loaded.points : EMPTY_HISTORY;
}
