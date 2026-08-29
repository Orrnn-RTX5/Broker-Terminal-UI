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

import {
  CANDLE_TIMEFRAMES,
  TIMEFRAME_SECONDS,
  getTimeframePeriodSeconds,
  getTimeframeSeconds as getBoundaryTimeframeSeconds,
  type BoundaryTimeframe,
} from '../utils/timeframeBoundary';

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

export type Timeframe = BoundaryTimeframe;

// ---------------------------------------------------------------------------
// Timeframe registry
// ---------------------------------------------------------------------------

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
export function alignToTimeframe(
  timestampMs: number,
  tf: Timeframe,
  boundaryOffsetSeconds = 0,
): number {
  const period = getTimeframePeriodSeconds(timestampMs / 1000, tf, boundaryOffsetSeconds);
  return (period?.startTime ?? timestampMs / 1000) * 1000;
}

/** Return the period length in seconds for a Timeframe label. */
export function getTimeframeSeconds(tf: Timeframe): number {
  return getBoundaryTimeframeSeconds(tf);
}

/**
 * Remove the leading aggregate only when retained M1 coverage starts inside
 * that same timeframe bucket. If the seed starts on the boundary, or builder
 * trimming has already advanced beyond that bucket, the first aggregate is
 * complete relative to the retained M1 source and must be kept.
 */
export function omitPartialLeadingM1Aggregate(
  candles: OHLCV[],
  oldestM1Time: number | null | undefined,
  timeframe: Timeframe,
  boundaryOffsetSeconds = 0,
): OHLCV[] {
  if (candles.length === 0 || !Number.isFinite(oldestM1Time)) return candles;

  const normalizedOldestM1Time = Number(oldestM1Time);
  const seedPeriodStart = getTimeframePeriodSeconds(
    normalizedOldestM1Time,
    timeframe,
    boundaryOffsetSeconds,
  )?.startTime;
  const firstAggregateTime = candles[0]?.time;
  const startsInsideFirstAggregate = (
    Number.isFinite(seedPeriodStart)
    && firstAggregateTime === seedPeriodStart
    && normalizedOldestM1Time > Number(seedPeriodStart)
  );

  return startsInsideFirstAggregate ? candles.slice(1) : candles;
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
  /** Broker wall-clock offset after REST candles have been normalized to UTC. */
  boundaryOffsetSeconds?: number;
}

interface HigherTimeframeState {
  forming: OHLCV | null;
  completed: OHLCV[];
  lastAppliedM1Time: number | null;
  lastAppliedM1Volume: number;
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
  private boundaryOffsetSeconds: number;
  private lastTickKey: string | null = null;

  // M1 state
  private m1Completed: OHLCV[] = [];
  private m1Forming: OHLCV | null = null;

  // Higher TF state
  private higherTFs: Map<Timeframe, HigherTimeframeState> = new Map();

  constructor(symbol: string, options?: SymbolCandleBuilderOptions) {
    this.symbol = symbol;
    this.lateTickGraceFactor = options?.lateTickGraceFactor ?? 2;
    this.boundaryOffsetSeconds = options?.boundaryOffsetSeconds ?? 0;

    CANDLE_TIMEFRAMES.forEach(tf => {
      if (tf !== 'M1') {
        this.higherTFs.set(tf, {
          forming: null,
          completed: [],
          lastAppliedM1Time: null,
          lastAppliedM1Volume: 0,
        });
      }
    });
  }

  setBoundaryOffsetSeconds(boundaryOffsetSeconds: number): void {
    this.boundaryOffsetSeconds = Number.isFinite(boundaryOffsetSeconds) ? boundaryOffsetSeconds : 0;
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
    // MT-style chart candles are Bid candles; Ask remains available for order
    // execution but must not shift the displayed OHLC by half the spread.
    const price = Number.isFinite(tick.bid) ? tick.bid : tick.ask;
    const volume = Number.isFinite(tick.volume) && (tick.volume ?? 0) > 0 ? tick.volume! : 1;

    if (!Number.isFinite(tsMs) || !Number.isFinite(price)) return updates;

    // More than one chart surface can forward the same feed frame into this
    // shared builder. Exact-frame idempotency prevents volume inflation.
    const tickKey = `${tsMs}:${tick.bid}:${tick.ask}:${volume}`;
    if (tickKey === this.lastTickKey) return updates;
    this.lastTickKey = tickKey;

    // ── M1 bucket ──────────────────────────────────────────────────────────
    const m1Period = getTimeframePeriodSeconds(
      tsMs / 1000,
      'M1',
      this.boundaryOffsetSeconds,
    );
    if (!m1Period) return updates;
    const m1TimeSeconds = m1Period.startTime;

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
      // Higher frames consume M1 OHLCV snapshots. Repeated snapshots of the
      // current minute contribute only their volume delta.
      this.updateHigherTimeframesWithM1(this.m1Forming, updates, true);
    }

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
    const nowSec = Math.floor(Date.now() / 1000);
    const currentBoundary = getTimeframePeriodSeconds(
      nowSec,
      timeframe,
      this.boundaryOffsetSeconds,
    )?.startTime ?? nowSec;
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
      this.rebuildHigherTimeframes();

      // Fold the forming M1 into higher TFs
      if (this.m1Forming) {
        const updates = new Map<Timeframe, OHLCV>();
        this.updateHigherTimeframesWithM1(this.m1Forming, updates, true);
      }
      // Rebuild every higher frame from the complete fetched M1 coverage first;
      // only the retained minute-level working set is trimmed afterward.
      this.trimM1History();
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
        data.lastAppliedM1Time = null;
        data.lastAppliedM1Volume = 0;
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

    if (fillGaps && timeframe !== 'MN' && completed.length >= 2) {
      completed = fillCandleGaps(completed, TIMEFRAME_SECONDS[timeframe]);
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
    this.lastTickKey = null;
    for (const [, data] of this.higherTFs) {
      data.completed = [];
      data.forming   = null;
      data.lastAppliedM1Time = null;
      data.lastAppliedM1Volume = 0;
    }
  }

  // ─── Private: higher-TF propagation ──────────────────────────────────────

  /**
   * Propagate a completed M1 candle into every higher timeframe.
   * This is the ONLY place where new higher-TF forming candles are opened.
   */
  private processCompletedM1(m1: OHLCV, updates: Map<Timeframe, OHLCV>): void {
    this.updateHigherTimeframesWithM1(m1, updates, false);
  }

  /**
   * Fold an M1 candle (forming or completed) into higher TFs.
   * Used after loading historical M1 data to prime the higher-TF state.
   */
  private updateHigherTimeframesWithM1(
    m1: OHLCV,
    updates: Map<Timeframe, OHLCV>,
    isForming: boolean,
  ): void {
    for (const [tf, data] of this.higherTFs) {
      const period = getTimeframePeriodSeconds(
        m1.time,
        tf,
        this.boundaryOffsetSeconds,
      );
      if (!period) continue;
      const tfTimeSeconds = period.startTime;

      if (data.forming && data.forming.time > tfTimeSeconds) {
        // Completed bars remain immutable when an older M1 frame arrives late.
        continue;
      }

      if (data.forming && data.forming.time < tfTimeSeconds) {
        data.forming.isComplete = true;
        data.completed.push(data.forming);
        this.trimHigherTFHistory(tf);
        data.forming = null;
        data.lastAppliedM1Time = null;
        data.lastAppliedM1Volume = 0;
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
        data.lastAppliedM1Time = m1.time;
        data.lastAppliedM1Volume = m1.volume;
      } else {
        if (data.lastAppliedM1Time !== null && m1.time < data.lastAppliedM1Time) {
          continue;
        }

        data.forming.high    = Math.max(data.forming.high, m1.high);
        data.forming.low     = Math.min(data.forming.low,  m1.low);
        data.forming.close   = m1.close;

        if (data.lastAppliedM1Time === m1.time) {
          const volumeDelta = m1.volume - data.lastAppliedM1Volume;
          data.forming.volume = Math.max(0, data.forming.volume + volumeDelta);
        } else {
          data.forming.volume += m1.volume;
        }
        data.lastAppliedM1Time = m1.time;
        data.lastAppliedM1Volume = m1.volume;
      }

      if (!isForming && data.lastAppliedM1Time === m1.time) {
        // Keep the contribution ledger so a duplicate completed M1 is a no-op.
        data.lastAppliedM1Volume = m1.volume;
      }

      updates.set(tf, data.forming);
    }
  }

  /** Rebuild all higher TFs from scratch using the stored M1 completed array. */
  private rebuildHigherTimeframes(): void {
    for (const [, data] of this.higherTFs) {
      data.completed = [];
      data.forming   = null;
      data.lastAppliedM1Time = null;
      data.lastAppliedM1Volume = 0;
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
      if (data) {
        data.completed = [];
        data.forming = null;
        data.lastAppliedM1Time = null;
        data.lastAppliedM1Volume = 0;
      }
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
  loadHistoricalCandles(
    symbol: string,
    timeframe: Timeframe,
    candles: OHLCV[],
    boundaryOffsetSeconds = 0,
  ): void {
    const builder = this.getOrCreateBuilder(symbol);
    builder.setBoundaryOffsetSeconds(boundaryOffsetSeconds);
    builder.loadHistoricalCandles(timeframe, candles);
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
