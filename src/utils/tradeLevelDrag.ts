import { normalizeExactBrokerSymbol } from './exactBrokerSymbol';

export type TradeLevelDragSide = 'BUY' | 'SELL';
export type TradeLevelDragTarget = 'ENTRY' | 'SL' | 'TP';
export type TradeLevelDragResultRole = 'SL' | 'TP';

// Omitted levels are preserved by Gateway; zero explicitly removes a level.
// Never send the other level from a potentially stale chart snapshot.
export const tradeLevelModifyPatch = (role: TradeLevelDragResultRole, price: number) =>
  role === 'SL' ? { price_sl: price } : { price_tp: price };

export interface TradeLevelDragUpdateInput {
  side: TradeLevelDragSide;
  grabbedType: TradeLevelDragTarget;
  entryPrice: number;
  finalPrice: number;
  currentSl?: number;
  currentTp?: number;
  /** Broker precision; null = unknown: levels keep the raw dragged number. */
  digits: number | null;
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

export const normalizeTradeLevelDragPrice = (price: number, digits: number | null): number => {
  if (!Number.isFinite(price)) return Number.NaN;
  // Unknown broker precision: keep the raw number (never round by a guess).
  if (digits === null) return price;
  const safeDigits = getSafeDigits(digits);
  const scale = Math.pow(10, safeDigits);
  return Math.round(price * scale) / scale;
};

export const getTradeLevelDragMinDistance = (digits: number | null): number =>
  (digits === null ? 0 : 5 * Math.pow(10, -getSafeDigits(digits)));

/** Identical fills can belong to different tickets; metadata is never mutation ownership. */
export const getTradeLevelStateKeys = (trade: { key: string }): string[] => [trade.key];

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
  digits: number | null,
): number => {
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return price;
  // Unknown precision has no tick to step past the close; the side check
  // (protectionLevelViolation) blocks wrong-side levels instead.
  if (digits === null) return price;
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
    const safeDigits = digits === null ? null : getSafeDigits(digits);
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
      if (requiredDistance <= 0 && safeDigits === null) return null;
      const snapDistance = requiredDistance > 0 ? requiredDistance : Math.pow(10, -(safeDigits as number));
      price = normalizeTradeLevelDragPrice(entry + priceDirection * snapDistance, safeDigits);
      if (!Number.isFinite(price) || price <= 0) return null;
    }

    if (price === entry) {
      if (!priceDirection || safeDigits === null) return null;
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

/**
 * Fallback protection distance in points when neither the broker's stops
 * level nor a runtime-config default is available. Matches the pre-existing
 * hardcoded minimums (5 price steps) used by the chart drag clamp and the
 * modify notice.
 */
export const DEFAULT_PROTECTION_DISTANCE_POINTS = 5;

/**
 * Runtime-configured default SL/TP standoff in points
 * (`SLTP_DEFAULT_DISTANCE_POINTS`, `VITE_` alias accepted): the per-tenant
 * knob used when a symbol carries no stops level. Falls back to
 * DEFAULT_PROTECTION_DISTANCE_POINTS when unset, blank, or non-positive.
 * White-label: generic points value, never a symbol-specific default.
 */
export const readDefaultProtectionDistancePoints = (): number => {
  if (typeof window !== 'undefined') {
    const runtimeWindow = window as Window & {
      __RTX_RUNTIME_CONFIG__?: Record<string, unknown>;
      RUNTIME_CONFIG?: Record<string, unknown>;
      __RUNTIME_CONFIG__?: Record<string, unknown>;
    };
    const configs = [
      runtimeWindow.__RTX_RUNTIME_CONFIG__,
      runtimeWindow.RUNTIME_CONFIG,
      runtimeWindow.__RUNTIME_CONFIG__,
    ];
    for (const config of configs) {
      if (!config || typeof config !== 'object') continue;
      for (const key of ['SLTP_DEFAULT_DISTANCE_POINTS', 'VITE_SLTP_DEFAULT_DISTANCE_POINTS']) {
        const raw = config[key];
        const points = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
        if (Number.isFinite(points) && points > 0) return points;
      }
    }
  }
  return DEFAULT_PROTECTION_DISTANCE_POINTS;
};

/**
 * Resolve the SL/TP standoff distance in points: the broker's stops level
 * when it is a positive finite number, else the runtime-configured default.
 * Never invents a symbol-specific value (white-label: unknown means the
 * configured default, not zero).
 */
export const resolveStopsDistancePoints = (stopsLevel: unknown): number => {
  const points = typeof stopsLevel === 'number' ? stopsLevel : Number(stopsLevel);
  if (Number.isFinite(points) && points > 0) return points;
  return readDefaultProtectionDistancePoints();
};

export type ProtectionSide = 'BUY' | 'SELL';

/** Broker precision as a known integer (0..12), else null — never guessed. */
export const readKnownPriceDigits = (value: unknown): number | null => {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 12 ? parsed : null;
};

const readPositiveTickSize = (value: unknown): number | null => (
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
);

/**
 * Round a typed/dragged SL/TP level to the broker price grid before sending:
 * nearest multiple of the broker tick size (or one digit step when the
 * catalog publishes no tick size), at the broker precision. Unknown
 * precision (null) returns the value exactly as typed: the server validates
 * the grid and the client never rounds by a guessed precision.
 */
export const roundProtectionLevelToGrid = (
  value: number,
  digits: number | null,
  tickSize?: unknown,
): number => {
  if (!Number.isFinite(value) || value <= 0) return value;
  if (digits === null) return value;
  const safeDigits = getSafeDigits(digits);
  const step = readPositiveTickSize(tickSize) ?? Math.pow(10, -safeDigits);
  const snapped = Math.round(value / step) * step;
  return Number(snapped.toFixed(safeDigits));
};
export type ProtectionRole = 'SL' | 'TP';

/** Effective closing price for protection geometry: Bid for BUY, Ask for SELL. */
export const protectionClosePrice = (
  side: ProtectionSide,
  bid: number,
  ask: number,
): number | null => {
  const close = side === 'BUY' ? bid : ask;
  return Number.isFinite(close) && close > 0 ? close : null;
};

// Callers pass known broker precision only (readKnownPriceDigits).
const formatProtectionPrice = (value: number, safeDigits: number): string => {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: safeDigits,
    maximumFractionDigits: safeDigits,
  });
};

/**
 * Default SL/TP level on the VALID side of the current close price, so a
 * freshly opened modify flow never starts on a level the broker must refuse:
 * BUY SL below Bid / TP above Bid, SELL SL above Ask / TP below Ask, offset
 * by the stops distance. Returns null when no usable close price exists.
 */
export const defaultProtectionLevel = ({
  side,
  role,
  bid,
  ask,
  digits,
  distancePoints,
}: {
  side: ProtectionSide;
  role: ProtectionRole;
  bid: number;
  ask: number;
  digits: number | null;
  distancePoints?: unknown;
}): number | null => {
  const close = protectionClosePrice(side, bid, ask);
  if (close === null) return null;
  // Unknown precision: no grid to seed on, so no default level (never guessed).
  const safeDigits = readKnownPriceDigits(digits);
  if (safeDigits === null) return null;
  const step = Math.pow(10, -safeDigits);
  const distance = resolveStopsDistancePoints(distancePoints) * step;
  const raw = role === 'SL'
    ? (side === 'BUY' ? close - distance : close + distance)
    : (side === 'BUY' ? close + distance : close - distance);
  const rounded = Math.round(raw / step) * step;
  return Number.isFinite(rounded) && rounded > 0 ? rounded : null;
};

/**
 * Plain-words reason when a protection level violates the rules the
 * gateway enforces (rules_modify.go: side strictly off the current close
 * — BUY vs Bid, SELL vs Ask, equality refused — plus the price grid), or
 * null when the level is acceptable. There is deliberately NO minimum
 * distance: the backend enforces none, so the client must not refuse
 * in-gap levels. Distance lives only in defaultProtectionLevel (seeding).
 * The server stays final authority for race cases.
 */
export const protectionLevelViolation = ({
  side,
  role,
  price,
  bid,
  ask,
  digits,
  tickSize,
}: {
  side: ProtectionSide;
  role: ProtectionRole;
  price: number;
  bid: number;
  ask: number;
  digits: number | null;
  tickSize?: unknown;
}): string | null => {
  if (!Number.isFinite(price) || price <= 0) return null;
  const close = protectionClosePrice(side, bid, ask);
  if (close === null) return null;
  // Unknown precision (null): side-only check; the grid needs real digits
  // and the close is shown raw, never formatted by a guessed precision.
  const safeDigits = readKnownPriceDigits(digits);
  const digitsKnown = safeDigits !== null;
  const closeText = digitsKnown ? formatProtectionPrice(close, safeDigits) : String(close);
  const closeLabel = side === 'BUY' ? 'Bid' : 'Ask';
  const levelLabel = role === 'SL' ? 'Stop loss' : 'Take profit';
  const wrongSide = role === 'SL'
    ? (side === 'BUY' ? price >= close : price <= close)
    : (side === 'BUY' ? price <= close : price >= close);
  if (wrongSide) {
    const direction = role === 'SL'
      ? (side === 'BUY' ? 'below' : 'above')
      : (side === 'BUY' ? 'above' : 'below');
    return `${levelLabel} must be ${direction} the current ${closeLabel} ${closeText} for a ${side}`;
  }
  if (!digitsKnown) return null;
  const step = Math.pow(10, -safeDigits);
  const tick = typeof tickSize === 'number' && Number.isFinite(tickSize) && tickSize > 0 ? tickSize : step;
  const scaled = price / tick;
  const scaleFit = price * Math.pow(10, safeDigits);
  if (Math.abs(scaled - Math.round(scaled)) > 1e-6 || Math.abs(scaleFit - Math.round(scaleFit)) > 1e-6) {
    return `${levelLabel} must be on the ${safeDigits}-digit price grid`;
  }
  return null;
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
