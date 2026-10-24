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
  /** Broker tick size; when finite and > 0, levels and snaps land on this grid. */
  tickSize?: unknown;
  minEntryDistance?: number;
  snapEntryToMinDistance?: boolean;
  entryDragDirection?: 1 | -1;
  /**
   * Live close for the position (Bid for BUY, Ask for SELL), from the same fresh
   * tick used for validation. Brokers validate SL/TP against the close (not the
   * entry): the role of an ENTRY drop follows it, and dragged levels are clamped
   * to the valid side of it. Null/absent falls back to the entry price for role.
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

const readPositiveTickSize = (value: unknown): number | null => (
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
);

const isValidSideTowardLower = (
  side: TradeLevelDragSide,
  role: TradeLevelDragResultRole,
): boolean => (side === 'BUY' && role === 'SL') || (side === 'SELL' && role === 'TP');

const RELATIVE_GRID_TOLERANCE = 1e-6;

const isWithinGridStepTolerance = (scaled: number): boolean => {
  if (!Number.isFinite(scaled)) return false;
  const nearest = Math.round(scaled);
  const tolerance = Math.max(RELATIVE_GRID_TOLERANCE, Math.abs(scaled) * Number.EPSILON * 16);
  return Math.abs(scaled - nearest) <= tolerance;
};

export const normalizeTradeLevelDragPrice = (price: number, digits: number | null): number => {
  if (!Number.isFinite(price)) return Number.NaN;
  // Unknown broker precision: keep the raw number (never round by a guess).
  if (digits === null) return price;
  const safeDigits = getSafeDigits(digits);
  const scale = Math.pow(10, safeDigits);
  return Number((Math.round(price * scale) / scale).toFixed(safeDigits));
};

export const getTradeLevelDragMinDistance = (digits: number | null, tickSize?: unknown): number => {
  if (digits === null) return 0;
  const safeDigits = getSafeDigits(digits);
  const step = readPositiveTickSize(tickSize) ?? Math.pow(10, -safeDigits);
  return normalizeTradeLevelDragPrice(5 * step, safeDigits);
};

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

/**
 * Role of an ENTRY-line drop. Decided against the live close (BUY: Bid, SELL:
 * Ask), because validity is checked against the close: on a position in profit
 * a drop between entry and close is an SL for a BUY, not a TP. Falls back to the
 * entry price only when no live close is available.
 */
export const resolveTradeLevelDragRole = (
  side: TradeLevelDragSide,
  grabbedType: TradeLevelDragTarget,
  entryPrice: number,
  price: number,
  closePrice?: number | null,
): TradeLevelDragResultRole => {
  if (grabbedType !== 'ENTRY') return grabbedType;
  const reference = Number.isFinite(closePrice) && (closePrice as number) > 0 ? (closePrice as number) : entryPrice;
  if (side === 'BUY') return price > reference ? 'TP' : 'SL';
  return price < reference ? 'TP' : 'SL';
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
  tickSize?: unknown,
): number => {
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return price;
  // Unknown precision has no tick to step past the close; the side check
  // (protectionLevelViolation) blocks wrong-side levels instead.
  if (digits === null) return price;
  const safeDigits = getSafeDigits(digits);
  const digitStep = Math.pow(10, -safeDigits);
  const safeGap = Math.max(digitStep, Number.isFinite(gap) && gap > 0 ? gap : 0);
  const slBoundaryForBuy = currentPrice - safeGap;
  const tpBoundaryForBuy = currentPrice + safeGap;

  let clamped = price;
  if (role === 'SL') {
    clamped = side === 'BUY' ? Math.min(price, slBoundaryForBuy) : Math.max(price, tpBoundaryForBuy);
  } else {
    clamped = side === 'BUY' ? Math.max(price, tpBoundaryForBuy) : Math.min(price, slBoundaryForBuy);
  }
  return roundLevelOutwardToTick(
    clamped,
    isValidSideTowardLower(side, role),
    safeDigits,
    tickSize,
  );
};

export const applyTradeLevelDragUpdate = ({
  side,
  grabbedType,
  entryPrice,
  finalPrice,
  currentSl = 0,
  currentTp = 0,
  digits,
  tickSize,
  minEntryDistance,
  snapEntryToMinDistance = false,
  entryDragDirection,
  currentPrice,
  minStopDistance,
}: TradeLevelDragUpdateInput): TradeLevelDragUpdate | null => {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0 || !Number.isFinite(finalPrice)) return null;

  const safeDigits = digits === null ? null : getSafeDigits(digits);
  const step = safeDigits === null ? 0 : (readPositiveTickSize(tickSize) ?? Math.pow(10, -safeDigits));
  let price = normalizeTradeLevelDragPrice(finalPrice, safeDigits);
  if (!Number.isFinite(price) || price <= 0) return null;

  if (safeDigits !== null) {
    const initialRole = resolveTradeLevelDragRole(side, grabbedType, entryPrice, price, currentPrice);
    price = roundLevelOutwardToTick(price, isValidSideTowardLower(side, initialRole), safeDigits, tickSize);
    if (!Number.isFinite(price) || price <= 0) return null;
  }

  if (grabbedType === 'ENTRY') {
    const entry = normalizeTradeLevelDragPrice(entryPrice, safeDigits);
    const requiredDistance = Math.max(0, minEntryDistance ?? getTradeLevelDragMinDistance(safeDigits, tickSize));
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
      const snapDistance = requiredDistance > 0 ? requiredDistance : step;
      const rawSnap = entry + priceDirection * snapDistance;
      price = safeDigits === null
        ? rawSnap
        : roundLevelOutwardToTick(rawSnap, priceDirection < 0, safeDigits, tickSize);
      if (!Number.isFinite(price) || price <= 0) return null;
    }

    if (price === entry) {
      if (!priceDirection || safeDigits === null) return null;
      price = roundLevelOutwardToTick(entry + priceDirection * step, priceDirection < 0, safeDigits, tickSize);
      if (!Number.isFinite(price) || price <= 0) return null;
    }
  }

  // currentPrice is the live close (Bid for BUY, Ask for SELL); role follows it.
  const role = resolveTradeLevelDragRole(side, grabbedType, entryPrice, price, currentPrice);
  if (safeDigits !== null) {
    price = roundLevelOutwardToTick(price, isValidSideTowardLower(side, role), safeDigits, tickSize);
    if (!Number.isFinite(price) || price <= 0) return null;
  }

  // Keep the level on the broker-valid side of the live market price so the modify
  // request is accepted instead of being rejected and silently reverted.
  if (Number.isFinite(currentPrice) && (currentPrice as number) > 0) {
    const gap = minStopDistance ?? getTradeLevelDragMinDistance(digits, tickSize);
    price = clampTradeLevelToCurrentPrice(side, role, price, currentPrice as number, gap, digits, tickSize);
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
/** First positive finite number among the runtime-config keys (all config sources). */
const readPositiveRuntimeConfigNumber = (keys: readonly string[]): number | null => {
  if (typeof window === 'undefined') return null;
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
    for (const key of keys) {
      const raw = config[key];
      const value = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
      if (Number.isFinite(value) && value > 0) return value;
    }
  }
  return null;
};

export const readDefaultProtectionDistancePoints = (): number => (
  readPositiveRuntimeConfigNumber(['SLTP_DEFAULT_DISTANCE_POINTS', 'VITE_SLTP_DEFAULT_DISTANCE_POINTS'])
    ?? DEFAULT_PROTECTION_DISTANCE_POINTS
);

/** Generic default; a feed silent for longer than this is not validated locally (the server decides). */
export const DEFAULT_QUOTE_MAX_AGE_MS = 60_000;

/**
 * Maximum age (ms) of the tick used to validate or seed SL/TP
 * (`QUOTE_MAX_AGE_MS`, `VITE_` alias accepted). Runtime config, never per symbol.
 * Quiet instruments can show an old source time, so raise this knob rather
 * than trade on a guess.
 */
export const readQuoteMaxAgeMs = (): number => (
  readPositiveRuntimeConfigNumber(['QUOTE_MAX_AGE_MS', 'VITE_QUOTE_MAX_AGE_MS']) ?? DEFAULT_QUOTE_MAX_AGE_MS
);

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

/**
 * Seed distance in points for a new SL/TP: the largest of the broker stops
 * level (only when the catalog provides one), the LIVE quote spread in points,
 * and the configured buffer. The catalog spread field is static and must never
 * be passed here; a stale spread would seed a level the live quote refuses.
 */
export const resolveSeedDistancePoints = (stopsLevel: unknown, liveSpreadPoints: number | null): number => {
  const stops = typeof stopsLevel === 'number' ? stopsLevel : Number(stopsLevel);
  const stopsPoints = Number.isFinite(stops) && stops > 0 ? stops : 0;
  const spreadPoints = liveSpreadPoints !== null && Number.isFinite(liveSpreadPoints) && liveSpreadPoints > 0
    ? liveSpreadPoints
    : 0;
  return Math.max(stopsPoints, spreadPoints, readDefaultProtectionDistancePoints());
};

export type ProtectionSide = 'BUY' | 'SELL';

/** Broker precision as a known integer (0..12), else null â€” never guessed. */
export const readKnownPriceDigits = (value: unknown): number | null => {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 12 ? parsed : null;
};

/**
 * Seed distance as a price: resolveSeedDistancePoints (catalog stops level when
 * present, live spread, configured buffer) at the broker step. Null when the
 * precision is unknown (no seed, never guessed).
 */
export const resolveSeedDistancePrice = ({
  bid,
  ask,
  digits,
  stopsLevel,
}: {
  bid: number;
  ask: number;
  digits: number | null;
  stopsLevel?: unknown;
}): number | null => {
  const safeDigits = readKnownPriceDigits(digits);
  if (safeDigits === null) return null;
  const points = resolveSeedDistancePoints(stopsLevel, readLiveSpreadPoints(bid, ask, safeDigits));
  return points * Math.pow(10, -safeDigits);
};

/** Live quote spread in broker points (ask - bid), or null when unknown or inverted. */
export const readLiveSpreadPoints = (bid: number, ask: number, digits: number | null): number | null => {
  const safeDigits = readKnownPriceDigits(digits);
  if (safeDigits === null) return null;
  if (!(bid > 0) || !(ask >= bid)) return null;
  return (ask - bid) * Math.pow(10, safeDigits);
};

/**
 * Bid/Ask to validate SL/TP against LOCALLY, or null. Null means "do not
 * validate here": the tick is missing, one-sided, never stamped by a live feed
 * message, or the feed has been silent for longer than maxAgeMs. Callers send
 * the request unvalidated and the server decides (server-final). No local
 * refusal is ever based on a null result.
 *
 * Freshness is ONLY the feed-activity stamp (store/quoteFeedActivity.ts, set by
 * the dispatcher for accepted or identical two-sided feed quotes). Broker time
 * is deliberately not used: a skewed or future broker clock would otherwise
 * keep an old quote fresh, and a quote without a stamp is not fresh.
 */
export const resolveFreshValidationQuote = (
  tick: { bid?: unknown; ask?: unknown } | null | undefined,
  nowMs: number,
  maxAgeMs: number,
  feedActivityMs?: number | null,
): { bid: number; ask: number } | null => {
  if (!tick) return null;
  const bid = Number(tick.bid);
  const ask = Number(tick.ask);
  if (!(bid > 0) || !(ask > 0)) return null;
  const stamped = feedActivityMs === undefined || feedActivityMs === null ? Number.NaN : Number(feedActivityMs);
  if (!(stamped > 0)) return null;
  return nowMs - stamped > maxAgeMs ? null : { bid, ask };
};

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
  tickSize,
  distancePoints,
}: {
  side: ProtectionSide;
  role: ProtectionRole;
  bid: number;
  ask: number;
  digits: number | null;
  /** Broker tick size: when present the seed is rounded outward to it (grid check). */
  tickSize?: unknown;
  distancePoints?: unknown;
}): number | null => {
  const close = protectionClosePrice(side, bid, ask);
  if (close === null) return null;
  // Unknown precision: no grid to seed on, so no default level (never guessed).
  const safeDigits = readKnownPriceDigits(digits);
  if (safeDigits === null) return null;
  const step = Math.pow(10, -safeDigits);
  // Seed beyond the live spread (and any catalog stops level), never inside it.
  const distance = resolveSeedDistancePoints(distancePoints, readLiveSpreadPoints(bid, ask, safeDigits)) * step;
  const raw = role === 'SL'
    ? (side === 'BUY' ? close - distance : close + distance)
    : (side === 'BUY' ? close + distance : close - distance);
  // The seed moves outward onto the tick (or the digit step), never inside the distance.
  const towardLower = isValidSideTowardLower(side, role);
  const rounded = roundLevelOutwardToTick(raw, towardLower, safeDigits, tickSize);
  return Number.isFinite(rounded) && rounded > 0 ? rounded : null;
};

/**
 * Whether a positive price sits on the broker tick grid (`tickSize` when finite
 * and > 0, else `10^-digits`) AND on the `digits`-decimal grid within relative
 * tick tolerance (handling IEEE-754 float ULP at large magnitudes).
 * Unknown precision (`digits === null`) returns true (server decides).
 */
export const isOnTickGrid = (
  price: number,
  digits: number | null,
  tickSize?: unknown,
): boolean => {
  if (!Number.isFinite(price) || price <= 0) return false;
  const safeDigits = readKnownPriceDigits(digits);
  if (safeDigits === null) return true;
  const step = Math.pow(10, -safeDigits);
  const tick = readPositiveTickSize(tickSize) ?? step;
  const scaled = price / tick;
  const scaleFit = price * Math.pow(10, safeDigits);
  return isWithinGridStepTolerance(scaled) && isWithinGridStepTolerance(scaleFit);
};

/**
 * Plain-words reason when a protection level violates the rules the
 * gateway enforces (rules_modify.go: side strictly off the current close
 * â€” BUY vs Bid, SELL vs Ask, equality refused â€” plus the price grid), or
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
  const wrongSide = role === 'SL'
    ? (side === 'BUY' ? price >= close : price <= close)
    : (side === 'BUY' ? price <= close : price >= close);
  if (wrongSide) {
    const direction = role === 'SL'
      ? (side === 'BUY' ? 'below' : 'above')
      : (side === 'BUY' ? 'above' : 'below');
    const priceText = digitsKnown ? formatProtectionPrice(price, safeDigits) : String(price);
    // Names the attempted level and the bound it must pass, e.g.
    // "TP 81,700.00 must be above Bid 81,736.54".
    return `${role} ${priceText} must be ${direction} ${closeLabel} ${closeText}`;
  }
  if (!digitsKnown) return null;
  if (!isOnTickGrid(price, safeDigits, tickSize)) {
    return `${role} ${formatProtectionPrice(price, safeDigits)} must be on the ${safeDigits}-digit price grid`;
  }
  return null;
};

/**
 * Round a level to the broker tick OUTWARD: down when the valid side is below
 * the close (BUY SL, SELL TP), up when it is above (BUY TP, SELL SL). The result
 * is never closer to the close than the input, so a seed or snap that passed the
 * side and distance rules still does after rounding. Tick size when present,
 * else one digit step. Levels already on the grid within relative tolerance
 * stay exact.
 */
export const roundLevelOutwardToTick = (
  price: number,
  towardLower: boolean,
  digits: number,
  tickSize?: unknown,
): number => {
  if (!Number.isFinite(price)) return Number.NaN;
  const safeDigits = getSafeDigits(digits);
  const step = readPositiveTickSize(tickSize) ?? Math.pow(10, -safeDigits);
  const scaled = price / step;
  const ticks = isWithinGridStepTolerance(scaled)
    ? Math.round(scaled)
    : towardLower
      ? Math.floor(scaled)
      : Math.ceil(scaled);
  return normalizeTradeLevelDragPrice(ticks * step, safeDigits);
};

/**
 * Round a candidate protection level toward its valid side on the broker tick
 * grid (BUY SL floors, BUY TP ceils, SELL SL ceils, SELL TP floors; exact when
 * already on the grid within relative tolerance). Unknown precision returns the
 * input unchanged.
 */
export const roundTradeLevelToSideGrid = (
  price: number,
  side: TradeLevelDragSide,
  role: TradeLevelDragResultRole,
  digits: number | null,
  tickSize?: unknown,
): number => {
  if (!Number.isFinite(price) || price <= 0) return price;
  if (digits === null) return price;
  const safeDigits = getSafeDigits(digits);
  return roundLevelOutwardToTick(
    price,
    isValidSideTowardLower(side, role),
    safeDigits,
    tickSize,
  );
};

/**
 * Price a SL/TP drop submits. Candidate levels are rounded toward the valid
 * side on the broker tick grid so a valid drop near the close is never rounded
 * across the close. A level not set yet (a chip) snaps to the valid side of the
 * live close plus the seed distance (catalog stops level, live spread, buffer),
 * rounded OUTWARD to the broker tick so the grid check passes. Without a fresh
 * quote there is no close to snap to: the dropped price is returned rounded to
 * the grid and the server decides.
 */
export const resolveDropPriceForRole = ({
  side,
  grabbedType,
  price,
  quote,
  digits,
  tickSize,
  stopsLevel,
  isNewLevel,
  entryPrice,
}: {
  side: TradeLevelDragSide;
  grabbedType: TradeLevelDragTarget;
  price: number;
  quote: { bid: number; ask: number } | null;
  digits: number | null;
  tickSize?: unknown;
  stopsLevel?: unknown;
  isNewLevel: boolean;
  entryPrice?: number;
}): number => {
  if (!Number.isFinite(price) || price <= 0 || digits === null) {
    return roundProtectionLevelToGrid(price, digits, tickSize);
  }
  const safeDigits = getSafeDigits(digits);
  const close = quote ? protectionClosePrice(side, quote.bid, quote.ask) : null;
  const hasRoleReference = grabbedType !== 'ENTRY'
    || close !== null
    || (typeof entryPrice === 'number' && Number.isFinite(entryPrice) && entryPrice > 0);
  const resolvedRole: TradeLevelDragResultRole | null = hasRoleReference
    ? (grabbedType === 'ENTRY'
        ? resolveTradeLevelDragRole(side, 'ENTRY', entryPrice ?? 0, price, close)
        : grabbedType)
    : null;
  const normalized = resolvedRole !== null
    ? roundLevelOutwardToTick(price, isValidSideTowardLower(side, resolvedRole), safeDigits, tickSize)
    : roundProtectionLevelToGrid(price, safeDigits, tickSize);
  if (!isNewLevel || grabbedType === 'ENTRY' || !quote) return normalized;
  const seed = resolveSeedDistancePrice({ bid: quote.bid, ask: quote.ask, digits: safeDigits, stopsLevel });
  if (close === null || seed === null) return normalized;
  const clamped = clampTradeLevelToCurrentPrice(side, grabbedType, normalized, close, seed, safeDigits, tickSize);
  if (clamped === normalized) return normalized;
  // The valid side of a SL/TP is below the close for a BUY SL and a SELL TP.
  const towardLower = isValidSideTowardLower(side, grabbedType);
  return roundLevelOutwardToTick(clamped, towardLower, safeDigits, tickSize);
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

export const pendingOrderPriceViolation = ({
  orderType,
  side,
  price,
  limitPrice,
  sl,
  tp,
  bid,
  ask,
  digits,
  tickSize,
  stopsLevelTicks = 0,
}: {
  orderType: string;
  side: 'BUY' | 'SELL';
  price: number;
  limitPrice?: number;
  sl?: number;
  tp?: number;
  bid: number;
  ask: number;
  digits: number | null;
  tickSize?: number | null;
  stopsLevelTicks?: number;
}): string | null => {
  if (!Number.isFinite(price) || price <= 0) {
    return 'Order price must be greater than zero';
  }
  const safeDigits = readKnownPriceDigits(digits);
  const step = (typeof tickSize === 'number' && Number.isFinite(tickSize) && tickSize > 0)
    ? tickSize
    : (safeDigits !== null ? Math.pow(10, -safeDigits) : 0);
  const minDist = Math.max(0, Number(stopsLevelTicks) || 0) * step;
  const normType = String(orderType || '').trim().toLowerCase();
  const fmt = (v: number) => (safeDigits !== null ? formatProtectionPrice(v, safeDigits) : String(v));

  if (ask > 0 && normType === 'buy_limit' && price >= ask - minDist + 1e-12) {
    return `Buy Limit price must be below Ask ${fmt(ask)}`;
  }
  if (bid > 0 && normType === 'sell_limit' && price <= bid + minDist - 1e-12) {
    return `Sell Limit price must be above Bid ${fmt(bid)}`;
  }
  if (ask > 0 && (normType === 'buy_stop' || normType === 'buy_stop_limit') && price <= ask + minDist - 1e-12) {
    return `${normType === 'buy_stop_limit' ? 'Buy Stop Limit' : 'Buy Stop'} price must be above Ask ${fmt(ask)}`;
  }
  if (bid > 0 && (normType === 'sell_stop' || normType === 'sell_stop_limit') && price >= bid - minDist + 1e-12) {
    return `${normType === 'sell_stop_limit' ? 'Sell Stop Limit' : 'Sell Stop'} price must be below Bid ${fmt(bid)}`;
  }

  const refPrice = (normType.endsWith('_stop_limit') && typeof limitPrice === 'number' && limitPrice > 0)
    ? limitPrice
    : price;
  if (typeof sl === 'number' && sl > 0) {
    if (side === 'BUY' && sl >= refPrice - minDist + 1e-12) {
      return `Stop Loss must be below order price ${fmt(refPrice)}`;
    }
    if (side === 'SELL' && sl <= refPrice + minDist - 1e-12) {
      return `Stop Loss must be above order price ${fmt(refPrice)}`;
    }
  }
  if (typeof tp === 'number' && tp > 0) {
    if (side === 'BUY' && tp <= refPrice + minDist - 1e-12) {
      return `Take Profit must be above order price ${fmt(refPrice)}`;
    }
    if (side === 'SELL' && tp >= refPrice - minDist + 1e-12) {
      return `Take Profit must be below order price ${fmt(refPrice)}`;
    }
  }
  return null;
};
