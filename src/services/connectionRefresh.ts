/**
 * Full connection refresh (T12).
 *
 * Single broker-agnostic orchestrator for a manual FULL reconnect across every
 * terminal transport:
 * - trade stream (account/positions/orders/deals + chart tick/candle/depth
 *   channels) via the caller's existing trade-stream reconnect entry point;
 * - feed/quotes via the QuoteSocketManager public reconnect;
 * - chart/data candle streams via the ChartDataService public refresh entry
 *   point (which reuses each live transport's internal refresh path);
 * - order-placement socket via the TradeWebSocketClient public connect only
 *   (a no-op when the socket is already open; never force-drops in-flight
 *   orders);
 * - authoritative market snapshot via the caller's existing reload entry point.
 *
 * No new socket layer is created here; every transport reuses its own
 * reconnect/refresh entry point. No broker, tenant, symbol, or endpoint
 * literals: everything resolves from the runtime session configuration.
 */

import { getTradeWebSocketClient } from '../api/tradeSocket';
import { chartDataService } from './chartDataService';
import { getQuoteSocketManager } from './quoteSocketManager';

export interface FullConnectionRefreshDeps {
  /** Existing trade-stream reconnect (e.g. the authenticated WS hook entry point). */
  reconnectTradeStream: () => void;
  /** Existing authoritative market-snapshot reload. */
  reloadMarketSnapshot: () => void | Promise<unknown>;
}

export function refreshAllConnections(deps: FullConnectionRefreshDeps): void {
  deps.reconnectTradeStream();
  getQuoteSocketManager().reconnect();
  chartDataService.refreshCandleStreams();
  getTradeWebSocketClient().connect();
  void deps.reloadMarketSnapshot();
}
