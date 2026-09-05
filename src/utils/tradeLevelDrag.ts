import { normalizeExactBrokerSymbol } from './exactBrokerSymbol';

export type TradeLevelDragSide = 'BUY' | 'SELL';
export type TradeLevelDragTarget = 'ENTRY' | 'SL' | 'TP';
export type TradeLevelDragResultRole = 'SL' | 'TP';

export interface TradeLevelDragUpdateInput {
  side: TradeLevelDragSide;
  grabbedType: TradeLevelDragTarget;
  entryPrice: number;
  finalPrice: number;
  currentSl?: number;
  currentTp?: number;
  digits: number;
  minEntryDistance?: number;
  snapEntryToMinDistance?: boolean;
  entryDragDirection?: 1 | -1;
  /**
   * Live market price for the position. Brokers validate SL/TP against the
   * current price (not the entry), so we clamp dragged levels to the valid side
   * of this price to keep the modify request acceptable.
   */
  currentPrice?: number;
  /** Minimum gap a level must keep from the current price (defaults to the symbol minimum). */
  minStopDistance?: number;
}

export interface TradeLevelDragUpdate {
  role: TradeLevelDragResultRole;
  price: number;
  sl: number;
  tp: number;
}

export interface TradeLevelDragCandidate {
  grabbedType: TradeLevelDragTarget;
  y: number | null | undefined;
}

export interface TradeLevelDragSelection {
  grabbedType: TradeLevelDragTarget;
  distance: number;
}

export interface TradeLevelOverrideIdentity {
  symbol: string;
  side: TradeLevelDragSide;
  volume: number;
  entryPrice: number;
  entryTime: number;
  digits: number;
}

const normalizeExistingTradeLevel = (price: number | undefined): number =>
  Number.isFinite(price) && Number(price) > 0 ? Number(price) : 0;

const getSafeDigits = (digits: number): number =>
  Number.isFinite(digits) && digits >= 0 ? Math.floor(digits) : 0;

export const normalizeTradeLevelDragPrice = (price: number, digits: number): number => {
  if (!Number.isFinite(price)) return Number.NaN;
  const safeDigits = getSafeDigits(digits);
  const scale = Math.pow(10, safeDigits);
  return Math.round(price * scale) / scale;
};

export const getTradeLevelDragMinDistance = (digits: number): number =>
  5 * Math.pow(10, -getSafeDigits(digits));

export const createTradeLevelOverrideFingerprint = ({
  symbol,
  side,
  volume,
  entryPrice,
  entryTime,
  digits,
}: TradeLevelOverrideIdentity): string => {
  // FIX: Keep broker punctuation in the ownership key so two contracts cannot
  // share and overwrite the same local dragged SL/TP override.
  const normalizedSymbol = normalizeExactBrokerSymbol(symbol);
  const normalizedSide = side === 'SELL' ? 'SELL' : 'BUY';
  const normalizedVolume = Number.isFinite(volume) ? Number(volume) : 0;
  const normalizedEntryTime = Number.isFinite(entryTime) ? Math.trunc(entryTime) : 0;
  const safeDigits = getSafeDigits(digits);
  const normalizedEntryPrice = normalizeTradeLevelDragPrice(entryPrice, safeDigits);

  return [
    'trade-level',
    normalizedSymbol,
    normalizedSide,
    normalizedVolume.toFixed(4),
    normalizedEntryTime,
    Number.isFinite(normalizedEntryPrice) ? normalizedEntryPrice.toFixed(safeDigits) : '0',
  ].join(':');
};

export const resolveTradeLevelDragRole = (
  side: TradeLevelDragSide,
  grabbedType: TradeLevelDragTarget,
  entryPrice: number,
  price: number,
): TradeLevelDragResultRole => {
  if (grabbedType !== 'ENTRY') return grabbedType;
  if (side === 'BUY') return price > entryPrice ? 'TP' : 'SL';
  return price < entryPrice ? 'TP' : 'SL';
};

/**
 * Clamp a dragged SL/TP price to the broker-valid side of the current market price.
 *
 * A stop loss must sit on the losing side of the current price and a take profit on
 * the winning side (for a BUY: SL below / TP above the current price, inverted for a
 * SELL). Dropping a level on the wrong side makes the broker reject the modify, which
 * is what made dragged levels silently vanish. Clamping keeps the level just past the
 * current price so the request is always accepted.
 */
export const clampTradeLevelToCurrentPrice = (
  side: TradeLevelDragSide,
  role: TradeLevelDragResultRole,
  price: number,
  currentPrice: number,
  gap: number,
  digits: number,
): number => {
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return price;
  const safeDigits = getSafeDigits(digits);
  const safeGap = Math.max(Math.pow(10, -safeDigits), Number.isFinite(gap) && gap > 0 ? gap : 0);
  const slBoundaryForBuy = currentPrice - safeGap;
  const tpBoundaryForBuy = currentPrice + safeGap;

  let clamped = price;
  if (role === 'SL') {
    clamped = side === 'BUY' ? Math.min(price, slBoundaryForBuy) : Math.max(price, tpBoundaryForBuy);
  } else {
    clamped = side === 'BUY' ? Math.max(price, tpBoundaryForBuy) : Math.min(price, slBoundaryForBuy);
  }
  return normalizeTradeLevelDragPrice(clamped, safeDigits);
};

export const applyTradeLevelDragUpdate = ({
  side,
  grabbedType,
  entryPrice,
  finalPrice,
  currentSl = 0,
  currentTp = 0,
  digits,
  minEntryDistance,
  snapEntryToMinDistance = false,
  entryDragDirection,
  currentPrice,
  minStopDistance,
}: TradeLevelDragUpdateInput): TradeLevelDragUpdate | null => {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0 || !Number.isFinite(finalPrice)) return null;

  let price = normalizeTradeLevelDragPrice(finalPrice, digits);
  if (!Number.isFinite(price) || price <= 0) return null;
  if (grabbedType === 'ENTRY') {
    const safeDigits = getSafeDigits(digits);
    const entry = normalizeTradeLevelDragPrice(entryPrice, safeDigits);
    const requiredDistance = Math.max(0, minEntryDistance ?? getTradeLevelDragMinDistance(safeDigits));
    const priceDirection = entryDragDirection === 1 || entryDragDirection === -1
      ? entryDragDirection
      : finalPrice > entryPrice
        ? 1
        : finalPrice < entryPrice
          ? -1
          : null;
    const entryDistance = Math.abs(price - entry);

    if (entryDistance < requiredDistance) {
      if (!snapEntryToMinDistance) return null;
      if (!priceDirection) return null;
      const snapDistance = requiredDistance > 0 ? requiredDistance : Math.pow(10, -safeDigits);
      price = normalizeTradeLevelDragPrice(entry + priceDirection * snapDistance, safeDigits);
      if (!Number.isFinite(price) || price <= 0) return null;
    }

    if (price === entry) {
      if (!priceDirection) return null;
      const tickSize = Math.pow(10, -safeDigits);
      price = normalizeTradeLevelDragPrice(entry + priceDirection * tickSize, safeDigits);
      if (!Number.isFinite(price) || price <= 0) return null;
    }
  }

  const role = resolveTradeLevelDragRole(side, grabbedType, entryPrice, price);

  // Keep the level on the broker-valid side of the live market price so the modify
  // request is accepted instead of being rejected and silently reverted.
  if (Number.isFinite(currentPrice) && (currentPrice as number) > 0) {
    const gap = minStopDistance ?? getTradeLevelDragMinDistance(digits);
    price = clampTradeLevelToCurrentPrice(side, role, price, currentPrice as number, gap, digits);
    if (!Number.isFinite(price) || price <= 0) return null;
  }

  return {
    role,
    price,
    sl: role === 'SL' ? price : normalizeExistingTradeLevel(currentSl),
    tp: role === 'TP' ? price : normalizeExistingTradeLevel(currentTp),
  };
};

export const selectNearestTradeLevel = (
  candidates: TradeLevelDragCandidate[],
  pointerY: number,
  maxDistance: number,
): TradeLevelDragSelection | null => {
  let closest: TradeLevelDragSelection | null = null;

  candidates.forEach(({ grabbedType, y }) => {
    if (!Number.isFinite(y)) return;
    const distance = Math.abs((y as number) - pointerY);
    if (distance <= maxDistance && (!closest || distance < closest.distance)) {
      closest = { grabbedType, distance };
    }
  });

  return closest;
};
