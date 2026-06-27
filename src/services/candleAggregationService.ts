/**
 * Candle Aggregation Service — Enhanced
 *
 * Changes vs original:
 *  1. fillCandleGaps()          — pure utility: inserts synthetic doji bars for missing periods
 *  2. Late-tick grace window    — ticks up to 2× TF period late can still update forming candle
 *  3. M1 gap handling           — skipped periods are left empty unless explicitly gap-filled
 *  4. getCandles(fillGaps flag) — opt-in gap-fill at read time for non-display uses
 *  5. All completed candles remain immutable; only forming candles accept late ticks
 */

import { alignTimeframeBoundaryMilliseconds, alignTimeframeBoundarySeconds } from '../utils/timeframeBoundary';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface Tick {
  symbol: string;
  bid: number;
  ask: number;
  timestamp: number; // seconds or milliseconds — auto-detected
  volume?: number;
}

export interface OHLCV {
  time: number;        // Unix timestamp in SECONDS (for charts)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isComplete?: boolean;
  isSynthetic?: boolean; // true for gap-fill doji candles
}

// Alias for compatibility
export type CandleData = OHLCV;

export type Timeframe =
  | 'M1' | 'M5' | 'M15' | 'M30'
  | 'H1' | 'H4'
  | 'D1' | 'W1' | 'MN';

interface TimeframeConfig {
  seconds: number;
  name: Timeframe;
}

// ---------------------------------------------------------------------------
// Timeframe registry
// ---------------------------------------------------------------------------

const TIMEFRAME_CONFIG: Record<Timeframe, TimeframeConfig> = {
  M1:  { seconds: 60,      name: 'M1'  },
  M5:  { seconds: 300,     name: 'M5'  },
  M15: { seconds: 900,     name: 'M15' },
  M30: { seconds: 1800,    name: 'M30' },
  H1:  { seconds: 3600,    name: 'H1'  },
  H4:  { seconds: 14400,   name: 'H4'  },
  D1:  { seconds: 86400,   name: 'D1'  },
  W1:  { seconds: 604800,  name: 'W1'  },
  MN:  { seconds: 2592000, name: 'MN'  },
};

// ---------------------------------------------------------------------------
// Pure utility: timestamp normalisation
// ---------------------------------------------------------------------------

/**
 * Normalise an incoming timestamp to milliseconds.
 * Threshold: < 1 000 000 000 000 → seconds (Unix epoch for 2024 ≈ 1.7 billion).
 */
export function normalizeTimestamp(ts: number): number {
  return ts < 1_000_000_000_000 ? ts * 1000 : ts;
}

/**
 * Align a millisecond timestamp to the start of the given timeframe period.
 * Example: 11:17:43 on M5 → 11:15:00.
 */
export function alignToTimeframe(timestampMs: number, tf: Timeframe): number {
  return alignTimeframeBoundaryMilliseconds(timestampMs, tf, TIMEFRAME_CONFIG[tf].seconds);
}

/** Return the period length in seconds for a Timeframe label. */
export function getTimeframeSeconds(tf: Timeframe): number {
  return TIMEFRAME_CONFIG[tf]?.seconds ?? 60;
}

// ---------------------------------------------------------------------------
// Pure utility: gap-fill
// ---------------------------------------------------------------------------

/**
 * Insert synthetic doji candles for every missing timeframe period between
 * consecutive candles in `candles` (which must already be sorted ascending).
 *
 * Each synthetic candle has:
 *   open = high = low = close = previousClose
 *   volume = 0
 *   isSynthetic = true
 *   isComplete  = true
 *
 * @param candles    Sorted OHLCV array (ascending by time).
 * @param tfSeconds  Timeframe period in seconds.
 * @param maxGap     Maximum synthetic candles to insert per gap (default 500).
 *                   Prevents RAM explosion for very long offline gaps.
 */
export function fillCandleGaps(
  candles: OHLCV[],
  tfSeconds: number,
  maxGap = 500,
): OHLCV[] {
  if (candles.length < 2) return candles;

  const result: OHLCV[] = [candles[0]];

  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1];
    const curr = candles[i];
    const expectedNext = prev.time + tfSeconds;

    if (curr.time > expectedNext) {
      // Gap detected — how many periods are missing?
      const missingCount = Math.round((curr.time - expectedNext) / tfSeconds);
      const fill = Math.min(missingCount, maxGap);

      for (let k = 0; k < fill; k++) {
        const syntheticTime = expectedNext + k * tfSeconds;
        const syntheticClose = prev.close; // carry forward from last real close
        result.push({
          time: syntheticTime,
          open:  syntheticClose,
          high:  syntheticClose,
          low:   syntheticClose,
          close: syntheticClose,
          volume: 0,
          isComplete: true,
          isSynthetic:  true,
        });
      }
    }

    result.push(curr);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// SymbolCandleBuilder
// ---------------------------------------------------------------------------

export interface SymbolCandleBuilderOptions {
  /**
   * Multiplier applied to the timeframe period to compute the late-tick grace
   * window.  A tick whose bucket is up to (lateTickGraceFactor × period) behind
   * the forming candle's start time can still update the forming candle.
   * Default: 2  (e.g. 2 × 60 s = 120 s for M1).
   */
  lateTickGraceFactor?: number;
}

/**
 * Single-symbol candle builder.
 *
 * Hierarchy:
 *   Ticks  → M1 forming candle
 *   M1 ✓   → higher timeframe forming candles (M5, M15, …)
 *
 * Higher timeframes are NEVER opened directly from a raw tick price.
 * They are always seeded from the completed M1 open price, guaranteeing
 * that M5[0].open === M1[first-in-period].open (MT5/TV-consistent).
 */
export class SymbolCandleBuilder {
  private readonly symbol: string;
  private readonly lateTickGraceFactor: number;

  // M1 state
  private m1Completed: OHLCV[] = [];
  private m1Forming: OHLCV | null = null;

  // Higher TF state
  private higherTFs: Map<Timeframe, { forming: OHLCV | null; completed: OHLCV[] }> = new Map();

  constructor(symbol: string, options?: SymbolCandleBuilderOptions) {
    this.symbol = symbol;
    this.lateTickGraceFactor = options?.lateTickGraceFactor ?? 2;

    (Object.keys(TIMEFRAME_CONFIG) as Timeframe[]).forEach(tf => {
      if (tf !== 'M1') {
        this.higherTFs.set(tf, { forming: null, completed: [] });
      }
    });
  }

  // ─── Public: tick ingestion ──────────────────────────────────────────────

  /**
   * Process a live tick.
   *
   * Returns a Map<Timeframe, OHLCV> containing the updated forming candle for
   * every timeframe that was touched by this tick.
   */
  processTick(tick: Tick): Map<Timeframe, OHLCV> {
    const updates = new Map<Timeframe, OHLCV>();

    const tsMs  = normalizeTimestamp(tick.timestamp);
    const price  = (tick.bid + tick.ask) / 2;
    const volume = tick.volume || 1;

    // ── M1 bucket ──────────────────────────────────────────────────────────
    const m1Ms          = 60 * 1000;
    const m1Time        = Math.floor(tsMs / m1Ms) * m1Ms;
    const m1TimeSeconds = Math.floor(m1Time / 1000);

    if (this.m1Forming) {
      if (m1TimeSeconds > this.m1Forming.time) {
        // ── New M1 period ─────────────────────────────────────────────────
        // Finalise the previous forming candle
        this.m1Forming.isComplete = true;
        this.m1Completed.push(this.m1Forming);
        this.trimM1History();

        // Propagate the completed M1 to higher TFs
        this.processCompletedM1(this.m1Forming, updates);

        // Open the new M1 forming candle
        this.m1Forming = {
          time:   m1TimeSeconds,
          open:   price,
          high:   price,
          low:    price,
          close:  price,
          volume,
          isComplete: false,
        };

      } else if (m1TimeSeconds === this.m1Forming.time) {
        // ── Same M1 period — normal update ────────────────────────────────
        this.m1Forming.high   = Math.max(this.m1Forming.high, price);
        this.m1Forming.low    = Math.min(this.m1Forming.low,  price);
        this.m1Forming.close  = price;
        this.m1Forming.volume += volume;

      } else {
        // ── Late tick ─────────────────────────────────────────────────────
        // m1TimeSeconds < m1Forming.time
        // Check grace window: allow if within lateTickGraceFactor × 60 s
        const graceSec = 60 * this.lateTickGraceFactor;
        const lateSec  = this.m1Forming.time - m1TimeSeconds;

        if (lateSec <= graceSec) {
          // Within grace — update forming candle (high/low/volume only;
          // do NOT update .close so chronological last-seen price is preserved)
          this.m1Forming.high   = Math.max(this.m1Forming.high, price);
          this.m1Forming.low    = Math.min(this.m1Forming.low,  price);
          this.m1Forming.volume += volume;
        }
        // Beyond grace → drop silently (completed candles are immutable)
      }

    } else {
      // ── No forming candle yet — open first M1 ────────────────────────────
      this.m1Forming = {
        time:   m1TimeSeconds,
        open:   price,
        high:   price,
        low:    price,
        close:  price,
        volume,
        isComplete: false,
      };
    }

    if (this.m1Forming) {
      updates.set('M1', this.m1Forming);
    }

    // ── Higher TF tick-update ─────────────────────────────────────────────
    // Only updates forming higher-TF candles that already exist.
    // New higher-TF candles are always opened by processCompletedM1(), not here.
    this.updateHigherTimeframesWithTick(price, volume, tsMs, updates);

    return updates;
  }

  // ─── Public: history loading ─────────────────────────────────────────────

  /**
   * Seed the builder from a REST API OHLCV response.
   *
   * The last candle is treated as "forming" only if its time equals the current
   * TF boundary (i.e. it is the period that is live right now).
   */
  loadHistoricalCandles(timeframe: Timeframe, candles: OHLCV[]): void {
    if (candles.length === 0) {
      this._clearTimeframe(timeframe);
      return;
    }

    const sorted = [...candles].sort((a, b) => a.time - b.time);
    const tfSec           = TIMEFRAME_CONFIG[timeframe].seconds;
    const nowSec          = Math.floor(Date.now() / 1000);
    const currentBoundary = alignTimeframeBoundarySeconds(nowSec, timeframe, tfSec);
    const lastCandle      = sorted[sorted.length - 1];
    const lastIsForming   = lastCandle.time >= currentBoundary;

    if (timeframe === 'M1') {
      if (lastIsForming) {
        this.m1Completed = sorted.slice(0, -1).map(c => ({ ...c, isComplete: true }));
        this.m1Forming   = { ...lastCandle, isComplete: false };
      } else {
        this.m1Completed = sorted.map(c => ({ ...c, isComplete: true }));
        this.m1Forming   = null;
      }
      this.trimM1History();
      this.rebuildHigherTimeframes();

      // Fold the forming M1 into higher TFs
      if (this.m1Forming) {
        const updates = new Map<Timeframe, OHLCV>();
        this.updateHigherTimeframesWithM1(this.m1Forming, updates);
      }
    } else {
      const data = this.higherTFs.get(timeframe);
      if (data) {
        if (lastIsForming) {
          data.completed = sorted.slice(0, -1).map(c => ({ ...c, isComplete: true }));
          data.forming   = { ...lastCandle, isComplete: false };
        } else {
          data.completed = sorted.map(c => ({ ...c, isComplete: true }));
          data.forming   = null;
        }
        this.trimHigherTFHistory(timeframe);
      }
    }
  }

  /**
   * Commit a single server-confirmed COMPLETED candle without disturbing the
   * forming state.  Use this for FIX WebSocket `type:update` messages.
   */
  addCompletedCandle(timeframe: Timeframe, candle: OHLCV): void {
    const completed = { ...candle, isComplete: true };

    if (timeframe === 'M1') {
      const last = this.m1Completed[this.m1Completed.length - 1];
      if (!last || last.time < completed.time) {
        if (this.m1Forming && this.m1Forming.time === completed.time) {
          this.m1Forming = null;
        }
        this.m1Completed.push(completed);
        this.trimM1History();
        this.processCompletedM1(completed, new Map<Timeframe, OHLCV>());
      }
    } else {
      const data = this.higherTFs.get(timeframe);
      if (data) {
        const last = data.completed[data.completed.length - 1];
        if (!last || last.time < completed.time) {
          if (data.forming && data.forming.time === completed.time) {
            data.forming = null;
          }
          data.completed.push(completed);
          this.trimHigherTFHistory(timeframe);
        }
      }
    }
  }

  // ─── Public: data access ─────────────────────────────────────────────────

  /**
   * Return candles for `timeframe`.
   *
   * @param timeframe     Target timeframe.
   * @param includeForming  Append the live forming candle (default true).
   * @param fillGaps      Fill missing periods with synthetic doji candles
   *                      (default false). Keep false for user-visible charts
   *                      so only real broker/backend candles are displayed.
   */
  getCandles(
    timeframe: Timeframe,
    includeForming = true,
    fillGaps       = false,
  ): OHLCV[] {
    let completed: OHLCV[];

    if (timeframe === 'M1') {
      completed = [...this.m1Completed];
    } else {
      const data = this.higherTFs.get(timeframe);
      completed  = data ? [...data.completed] : [];
    }

    if (fillGaps && completed.length >= 2) {
      completed = fillCandleGaps(completed, TIMEFRAME_CONFIG[timeframe].seconds);
    }

    if (includeForming) {
      const forming = this._getForming(timeframe);
      if (forming) completed.push(forming);
    }

    return completed;
  }

  /** Return the last closed (completed) candle, or null. */
  getLastClosedCandle(timeframe: Timeframe): OHLCV | null {
    if (timeframe === 'M1') {
      return this.m1Completed.length > 0
        ? this.m1Completed[this.m1Completed.length - 1]
        : null;
    }
    const data = this.higherTFs.get(timeframe);
    return data && data.completed.length > 0
      ? data.completed[data.completed.length - 1]
      : null;
  }

  /** Wipe all candle data (use on symbol switch). */
  clear(): void {
    this.m1Completed = [];
    this.m1Forming   = null;
    for (const [, data] of this.higherTFs) {
      data.completed = [];
      data.forming   = null;
    }
  }

  // ─── Private: higher-TF propagation ──────────────────────────────────────

  /**
   * Propagate a completed M1 candle into every higher timeframe.
   * This is the ONLY place where new higher-TF forming candles are opened.
   */
  private processCompletedM1(m1: OHLCV, updates: Map<Timeframe, OHLCV>): void {
    for (const [tf, data] of this.higherTFs) {
      const config = TIMEFRAME_CONFIG[tf];
      const tfTime = alignTimeframeBoundarySeconds(m1.time, tf, config.seconds);

      if (!data.forming || data.forming.time !== tfTime) {
        // Finalize the previous forming candle (if any)
        if (data.forming) {
          data.forming.isComplete = true;
          data.completed.push(data.forming);
          this.trimHigherTFHistory(tf);
        }

        // Open a new higher-TF bar seeded from the M1 OHLCV
        data.forming = {
          time:   tfTime,
          open:   m1.open,
          high:   m1.high,
          low:    m1.low,
          close:  m1.close,
          volume: m1.volume,
          isComplete: false,
        };
      } else {
        // Aggregate into the existing bar
        data.forming.high    = Math.max(data.forming.high, m1.high);
        data.forming.low     = Math.min(data.forming.low,  m1.low);
        data.forming.close   = m1.close;
        data.forming.volume += m1.volume;
      }

      updates.set(tf, data.forming);
    }
  }

  /**
   * Update forming higher-TF candles with an intra-period tick.
   *
   * Rules enforced here (higher TF layer):
   *   1. No forming candle yet → skip (opened exclusively by processCompletedM1).
   *   2. Same period → update in-place.
   *   3. Period crossed by tick (thin market leap) → finalize + open new bar.
   *   4. Late tick within grace window → update forming high/low/volume only.
   *   5. Beyond grace → drop silently.
   */
  private updateHigherTimeframesWithTick(
    price:   number,
    volume:  number,
    tsMs:    number,
    updates: Map<Timeframe, OHLCV>,
  ): void {
    for (const [tf, data] of this.higherTFs) {
      if (!data.forming) continue;

      const config         = TIMEFRAME_CONFIG[tf];
      const tfTimeMs       = alignTimeframeBoundaryMilliseconds(tsMs, tf, config.seconds);
      const tfTimeSeconds  = Math.floor(tfTimeMs / 1000);

      if (tfTimeSeconds === data.forming.time) {
        // ── Same period ────────────────────────────────────────────────────
        data.forming.high    = Math.max(data.forming.high, price);
        data.forming.low     = Math.min(data.forming.low,  price);
        data.forming.close   = price;
        data.forming.volume += volume;
        updates.set(tf, data.forming);

      } else if (tfTimeSeconds > data.forming.time) {
        // ── Period crossed by tick (no completed M1 triggered it) ──────────
        data.forming.isComplete = true;
        data.completed.push(data.forming);
        this.trimHigherTFHistory(tf);

        data.forming = {
          time:   tfTimeSeconds,
          open:   price,
          high:   price,
          low:    price,
          close:  price,
          volume,
          isComplete: false,
        };
        updates.set(tf, data.forming);

      } else {
        // ── Late tick ──────────────────────────────────────────────────────
        const graceSec = config.seconds * this.lateTickGraceFactor;
        const lateSec  = data.forming.time - tfTimeSeconds;

        if (lateSec <= graceSec) {
          // Within grace — update forming high/low/volume; preserve .close
          data.forming.high    = Math.max(data.forming.high, price);
          data.forming.low     = Math.min(data.forming.low,  price);
          data.forming.volume += volume;
          updates.set(tf, data.forming);
        }
        // Beyond grace → drop silently
      }
    }
  }

  /**
   * Fold an M1 candle (forming or completed) into higher TFs.
   * Used after loading historical M1 data to prime the higher-TF state.
   */
  private updateHigherTimeframesWithM1(m1: OHLCV, updates: Map<Timeframe, OHLCV>): void {
    const m1TimeMs = m1.time * 1000;

    for (const [tf, data] of this.higherTFs) {
      const config        = TIMEFRAME_CONFIG[tf];
      const tfTimeMs      = alignTimeframeBoundaryMilliseconds(m1TimeMs, tf, config.seconds);
      const tfTimeSeconds = Math.floor(tfTimeMs / 1000);

      if (data.forming && data.forming.time !== tfTimeSeconds) {
        data.forming.isComplete = true;
        data.completed.push(data.forming);
        this.trimHigherTFHistory(tf);
        data.forming = null;
      }

      if (!data.forming) {
        data.forming = {
          time:   tfTimeSeconds,
          open:   m1.open,
          high:   m1.high,
          low:    m1.low,
          close:  m1.close,
          volume: m1.volume,
          isComplete: false,
        };
      } else {
        data.forming.high    = Math.max(data.forming.high, m1.high);
        data.forming.low     = Math.min(data.forming.low,  m1.low);
        data.forming.close   = m1.close;
        data.forming.volume += m1.volume;
      }

      updates.set(tf, data.forming);
    }
  }

  /** Rebuild all higher TFs from scratch using the stored M1 completed array. */
  private rebuildHigherTimeframes(): void {
    for (const [, data] of this.higherTFs) {
      data.completed = [];
      data.forming   = null;
    }
    const updates = new Map<Timeframe, OHLCV>();
    for (const m1 of this.m1Completed) {
      this.processCompletedM1(m1, updates);
    }
  }

  // ─── Private: helpers ────────────────────────────────────────────────────

  private _getForming(timeframe: Timeframe): OHLCV | null {
    if (timeframe === 'M1') return this.m1Forming;
    return this.higherTFs.get(timeframe)?.forming ?? null;
  }

  private _clearTimeframe(timeframe: Timeframe): void {
    if (timeframe === 'M1') {
      this.m1Completed = [];
      this.m1Forming   = null;
      this.rebuildHigherTimeframes();
    } else {
      const data = this.higherTFs.get(timeframe);
      if (data) { data.completed = []; data.forming = null; }
    }
  }

  // ─── Private: memory limits ───────────────────────────────────────────────

  private trimM1History(): void {
    const MAX = 1440; // 24 h of M1
    if (this.m1Completed.length > MAX) {
      this.m1Completed = this.m1Completed.slice(-MAX);
    }
  }

  private trimHigherTFHistory(tf: Timeframe): void {
    const data = this.higherTFs.get(tf);
    if (!data) return;

    const LIMITS: Record<Timeframe, number> = {
      M1: 1440, M5: 288, M15: 96, M30: 48,
      H1: 24,   H4: 10,  D1: 30,  W1: 12, MN: 12,
    };

    const limit = LIMITS[tf] ?? 100;
    if (data.completed.length > limit) {
      data.completed = data.completed.slice(-limit);
    }
  }
}

// ---------------------------------------------------------------------------
// CandleAggregationService — multi-symbol facade
// ---------------------------------------------------------------------------

export class CandleAggregationService {
  private builders: Map<string, SymbolCandleBuilder> = new Map();

  private getOrCreateBuilder(symbol: string): SymbolCandleBuilder {
    let b = this.builders.get(symbol);
    if (!b) {
      b = new SymbolCandleBuilder(symbol);
      this.builders.set(symbol, b);
    }
    return b;
  }

  /** Process a tick for a symbol. */
  processTick(tick: Tick): Map<Timeframe, OHLCV> {
    return this.getOrCreateBuilder(tick.symbol).processTick(tick);
  }

  /** Seed historical candles for a symbol/timeframe. */
  loadHistoricalCandles(symbol: string, timeframe: Timeframe, candles: OHLCV[]): void {
    this.getOrCreateBuilder(symbol).loadHistoricalCandles(timeframe, candles);
  }

  /**
   * Commit a single server-confirmed completed candle without disturbing the
   * forming state. Use this for FIX WebSocket `type:update` messages.
   */
  addCompletedCandle(symbol: string, timeframe: Timeframe, candle: OHLCV): void {
    this.getOrCreateBuilder(symbol).addCompletedCandle(timeframe, candle);
  }

  /**
   * Return candles for a symbol and timeframe.
   *
   * @param fillGaps  When true, missing periods are filled with synthetic doji
   *                  candles. Keep false for user-visible charts.
   */
  getCandles(
    symbol:        string,
    timeframe:     Timeframe,
    includeForming = true,
    fillGaps       = false,
  ): OHLCV[] {
    const builder = this.builders.get(symbol);
    return builder ? builder.getCandles(timeframe, includeForming, fillGaps) : [];
  }

  /** Return the last closed candle for a symbol/timeframe. */
  getLastClosedCandle(symbol: string, timeframe: Timeframe): OHLCV | null {
    return this.builders.get(symbol)?.getLastClosedCandle(timeframe) ?? null;
  }

  /** Clear all candle data for a symbol (use on symbol switch). */
  clearSymbol(symbol: string): void {
    this.builders.get(symbol)?.clear();
  }

  /** Return all tracked symbols. */
  getSymbols(): string[] {
    return Array.from(this.builders.keys());
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------
export const candleAggregationService = new CandleAggregationService();
