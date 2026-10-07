import type { TradeOverlayRelayoutRequest } from './createTradeOverlayRelayoutQueue';

/** New nodes stay hidden until one coalesced projection of the latest refs. */
export function layoutRebuiltTradeOverlay(
  queueTradeOverlayRelayout: (request?: TradeOverlayRelayoutRequest) => void,
): void {
  queueTradeOverlayRelayout({ retryOnce: true });
}
