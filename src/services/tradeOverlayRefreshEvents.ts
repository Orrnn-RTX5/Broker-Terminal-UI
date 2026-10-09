export const TRADE_OVERLAY_REFRESH_EVENT = 'rtx:flush-trade-overlay';

export type TradeOverlayRefreshDetail = {
  contextId: string;
  mode: 'geometry' | 'reconcile' | 'rebuild';
};

/** A chart layout change must not rebuild overlays belonging to other panes. */
export const requestChartTradeOverlayRefresh = (
  contextId: string,
  mode: TradeOverlayRefreshDetail['mode'],
): void => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<TradeOverlayRefreshDetail>(TRADE_OVERLAY_REFRESH_EVENT, {
    detail: { contextId, mode },
  }));
};
