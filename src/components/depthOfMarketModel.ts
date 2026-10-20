// Pure Depth of Market helpers (order routing, typography, ladder price
// split). Kept out of DepthOfMarket.tsx so that file exports components only
// (react-refresh/only-export-components).

/** Splits a formatted price so the pip digits can carry visual emphasis. */
export const splitPipDigits = (formattedPrice: string): [string, string] => (
  formattedPrice.replace(/[.,]/g, '').length > 2
    ? [formattedPrice.slice(0, -2), formattedPrice.slice(-2)]
    : ['', formattedPrice]
);

/**
 * Ladder price split from catalog digits. Unknown precision (null) renders
 * the raw value with no pip emphasis instead of guessing a format.
 */
export const splitLadderPrice = (price: number, digits: number | null): [string, string] => (
  digits === null ? [String(price), ''] : splitPipDigits(price.toFixed(digits))
);

export type DepthOrderExecution = 'market' | 'limit' | 'stop';

// MT5 rule: a BUY clicked above the live ask is a buy_stop (else buy_limit);
// a SELL clicked below the live bid is a sell_stop (else sell_limit).
// Unknown quote fails closed to 'limit' (previous behavior).
export const depthExecutionForLevel = (
  side: DepthOrderRequest['side'],
  price: number,
  bestBid: number,
  bestAsk: number,
): 'limit' | 'stop' => {
  if (!Number.isFinite(price) || price <= 0) return 'limit';
  if (side === 'BUY' && Number.isFinite(bestAsk) && bestAsk > 0 && price > bestAsk) return 'stop';
  if (side === 'SELL' && Number.isFinite(bestBid) && bestBid > 0 && price < bestBid) return 'stop';
  return 'limit';
};

export interface DepthOrderRequest {
    side: 'BUY' | 'SELL';
    price: number;
    volume: number;
    execution: DepthOrderExecution;
    priceSl?: number;
    priceTp?: number;
}

export const buildDepthOrderRequest = (
  side: DepthOrderRequest['side'],
  price: number,
  volume: number,
  execution: DepthOrderExecution,
  digits: number | null,
  stopLossPoints = 0,
  takeProfitPoints = 0,
): DepthOrderRequest => {
  const request: DepthOrderRequest = { side, price, volume, execution };

  // Unknown precision: omit digits-dependent protection rounding rather than
  // guessing a point size. The base price passes through raw.
  if (digits === null) return request;

  const point = 10 ** -Math.max(0, digits);
  const roundPrice = (value: number) => Number(value.toFixed(Math.max(0, digits)));

  if (price > 0 && stopLossPoints > 0) {
    request.priceSl = roundPrice(
      side === 'BUY' ? price - (stopLossPoints * point) : price + (stopLossPoints * point),
    );
  }
  if (price > 0 && takeProfitPoints > 0) {
    request.priceTp = roundPrice(
      side === 'BUY' ? price + (takeProfitPoints * point) : price - (takeProfitPoints * point),
    );
  }

  return request;
};

export const readDepthTypography = () => {
  const style = typeof document === 'undefined' ? null : getComputedStyle(document.documentElement);
  const readNumber = (name: string, fallback: number) => {
    const value = Number.parseFloat(style?.getPropertyValue(name) || '');
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  const fontSize = readNumber('--rtx-ui-font-size', 14);
  const lineHeight = Math.ceil(fontSize * 1.5);
  const isLight = typeof document !== 'undefined' && document.documentElement.classList.contains('rtx-skin-untitled-light');
  const fontFamily = style?.getPropertyValue(isLight ? '--rtx-ui-font-family' : '--font-mono').trim();
  return {
    fontSize,
    lineHeight,
    rowHeight: Math.max(26, lineHeight + 5),
    bodyWeight: readNumber('--rtx-font-weight-body', 400),
    controlWeight: readNumber('--rtx-font-weight-control', 400),
    headingWeight: readNumber('--rtx-font-weight-heading', 500),
    // Canvas2D needs a resolved font string, not CSS custom-property syntax.
    fontFamily: fontFamily && !fontFamily.includes('var(')
      ? fontFamily
      : isLight ? "'Segoe UI', Tahoma, Arial, sans-serif" : "'Courier New', monospace",
  };
};
