import { useEffect } from 'react';
import { loadPublicQuotes } from '../services/publicMarket';
import { enqueueLiveTick } from '../services/liveTickDispatcher';

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
          if (quote.bid === undefined || quote.ask === undefined || !quote.time) return;
          const timestamp = quote.time > 1e12 ? quote.time : quote.time * 1000;
          enqueueLiveTick(quote.symbol, { symbol: quote.symbol, bid: quote.bid, ask: quote.ask,
            spread: quote.ask - quote.bid, timestamp, sourceTimestamp: timestamp });
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
