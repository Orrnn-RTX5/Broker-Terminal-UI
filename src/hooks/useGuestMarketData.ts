import { useEffect } from 'react';
import { loadPublicQuotes } from '../services/publicMarket';
import { enqueueSnapshotTick } from '../services/liveTickDispatcher';

/** Refresh the existing quote stores without opening account transports. */
export function useGuestMarketData(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        if (document.visibilityState === 'hidden') return;
        const quotes = await loadPublicQuotes(controller.signal);
        if (controller.signal.aborted) return;
        quotes.forEach(quote => {
          if (!quote.time || (quote.bid === undefined && quote.ask === undefined && quote.dailyChangeInput?.last === undefined)) return;
          const timestamp = quote.time > 1e12 ? quote.time : quote.time * 1000;
          // Polled snapshot (not a push frame): never stamps feed activity.
          enqueueSnapshotTick(quote.symbol, { symbol: quote.symbol, bid: quote.bid ?? 0, ask: quote.ask ?? 0,
            dailyChangeInput: quote.dailyChangeInput,
            spread: (quote.ask ?? 0) - (quote.bid ?? 0), timestamp, sourceTimestamp: timestamp });
        });
      } catch {
        // Preserve upstream timestamps: a failed refresh never makes prices fresh.
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(refresh, 3000);
      }
    };
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [enabled]);
}
