/**
 * ============================================================================
 * 🚫 AI FENCE: ISOLATED SYSTEM COMPONENT
 * ============================================================================
 * Do not modify, rewrite, or alter this file when processing other features.
 * Drawing tools are self-contained and highly sensitive to state/prop updates.
 * Any adjustments must be done ONLY under explicit drawing-specific requests.
 * ============================================================================
 */

/**
 * DrawingManager — SVG Overlay Based
 *
 * Architecture:
 * - A single <svg> element is stretched over the chart area (absolute, inset-0)
 * - Drawings are SVG path/line/rect elements inside this SVG
 * - Coordinates are recalculated from lightweight-charts IChartApi + ISeriesApi
 *   on every zoom/pan/resize event, keeping drawings pinned to candle prices/times
 * - Click events are forwarded from the chart canvas into this service via addPoint()
 * - Dragging updates individual points and re-renders
 */

import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import {
  buildDrawingContextKey,
  buildDrawingStorageKey,
  type DrawingContextIdentity,
} from '../drawing-tools/contextKey';
import { getTrendLineToolFromDrawing } from '../drawing-tools/toolCatalog';
import {
  getTrendToolRuntimeDefaults,
  type RegressionSource,
} from '../drawing-tools/toolDefaults';
import {
  clipLineToViewport,
  screenAngleDegrees,
  type ScreenSegment,
} from '../drawing-tools/geometry/trendToolGeometry';
import {
  buildInfoLineMetrics,
  calculateRegressionTrend,
  createChannelGeometry,
  createPitchforkLevels,
  type InfoLineMetricDisplay,
  type PitchforkBand,
  type PitchforkRay,
} from '../drawing-tools/geometry/tradingViewTrendGeometry';
import { drawingApi, type ClientDrawing } from './drawingApi';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────
export type DrawingType =
  | 'trendline'
  | 'hline'
  | 'vline'
  | 'text'
  | 'channel'
  | 'fibonacci'
  | 'fib_extension'
  | 'measure'
  | 'freehand'
  | 'callout'
  | 'rectangle'
  | 'ellipse'
  | 'shapes'
  | 'stamp';

export interface DrawingPoint {
  time: number;   // unix timestamp (seconds) — anchors bar after pan/zoom
  price: number;
  logicalIndex?: number;  // kept for backward compat with saved drawings
  pixelXOffset?: number;  // vline only: pixel offset from timeToCoordinate(time), sub-bar precise
}

export interface DrawingSeriesDataPoint {
  time: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  value?: number;
}

export type DrawingSeriesDataProvider = () => readonly DrawingSeriesDataPoint[];

export interface ChartContext {
  chart: IChartApi;
  series: ISeriesApi<any>;
  contextId: string;
  symbol: string;
  timeframe: string;
  accountScope?: string;
  seriesDataProvider?: DrawingSeriesDataProvider;
  svgOverlay: SVGSVGElement | null;
}

export interface Drawing {
  id: string;
  type: DrawingType;
  subtype?: string;
  points: DrawingPoint[];
  text?: string;
  color?: string;
  lineWidth?: number;
  lineStyle?: 'solid' | 'dashed' | 'dotted';
  selected?: boolean;
  locked?: boolean;
  serverId?: string;
  // Channel-specific fields
  channelOffset?: number;   // signed price offset for parallel line (price units, zoom-invariant)
  rayLeft?: boolean;        // extend lines leftward past anchor1
  rayRight?: boolean;       // extend lines rightward past anchor2
  channelMidpointRatio?: number;
  regressionSource?: RegressionSource;
  regressionUpperDeviation?: number;
  regressionLowerDeviation?: number;
  showRegressionPearson?: boolean;
  pitchforkLevels?: number[];
}

interface DrawingHistory {
  action: 'add' | 'delete' | 'modify';
  drawing?: Drawing;
  oldDrawing?: Drawing;
  newDrawing?: Drawing;
}

interface ScrollLockCallbacks {
  lock: () => void;
  unlock: () => void;
}

// How many clicks each tool needs
const REQUIRED_POINTS: Record<DrawingType, number> = {
  hline: 1,
  vline: 1,
  text: 1,
  shapes: 1,
  stamp: 1,
  trendline: 2,
  channel: 2,
  fibonacci: 2,
  rectangle: 2,
  ellipse: 2,
  measure: 2,
  callout: 2,
  fib_extension: 3,
  freehand: 0, // special — continuous
};

const requiredPointsForDrawing = (drawing: Pick<Drawing, 'type' | 'subtype'>): number =>
  getTrendLineToolFromDrawing(drawing.type, drawing.subtype)?.requiredPoints
  ?? REQUIRED_POINTS[drawing.type];

interface StampIconDef {
  kind?: 'icon' | 'label';
  path?: string;
  color: string;
  size: number;
  bg?: string;
  side?: 'left' | 'right';
  filled?: boolean;
}

const STAMP_ICONS: Record<string, StampIconDef> = {
  thumbsUp: {
    path: 'M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3',
    color: '#22c55e', size: 24,
  },
  thumbsDown: {
    path: 'M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17',
    color: '#ef4444', size: 24,
  },
  arrowUp: {
    path: 'M12 19V5M5 12l7-7 7 7',
    color: '#22c55e', size: 24,
  },
  arrowDown: {
    path: 'M12 5v14M19 12l-7 7-7-7',
    color: '#ef4444', size: 24,
  },
  stopSign: {
    path: 'M7.86 2h8.28L22 7.86v8.28L16.14 22H7.86L2 16.14V7.86z',
    color: '#ef4444', size: 24,
  },
  checkSign: {
    path: 'M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4L12 14.01l-3-3',
    color: '#22c55e', size: 24,
  },
  buy: {
    path: 'M12 3L23 21H1Z',
    color: '#22c55e', size: 24, filled: true,
  },
  sell: {
    path: 'M12 21L1 3H23Z',
    color: '#ef4444', size: 24, filled: true,
  },
  leftPriceLabel: {
    kind: 'label', color: '#2563eb', size: 24, bg: '#2563eb', side: 'left',
  },
  rightPriceLabel: {
    kind: 'label', color: '#2563eb', size: 24, bg: '#2563eb', side: 'right',
  },
};

// Fibonacci standard levels
const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const FIB_COLORS: Record<string, string> = {
  '0': '#888888',
  '0.236': '#2196F3',
  '0.382': '#4CAF50',
  '0.5': '#FF9800',
  '0.618': '#F44336',
  '0.786': '#9C27B0',
  '1': '#888888',
};

// ──────────────────────────────────────────────
// Class
// ──────────────────────────────────────────────
export class DrawingManager {
  // The map name is kept for backwards source compatibility, but keys are now
  // account + symbol + timeframe scopes rather than symbol-only buckets.
  private drawingsBySymbol: Map<string, Drawing[]> = new Map();
  private activeDrawing: Drawing | null = null;
  private activeDrawingOwner: DrawingContextIdentity | null = null;
  private previewPoint: DrawingPoint | null = null;
  private magnetEnabled = false;

  private chartContexts: Map<HTMLElement, ChartContext> = new Map();
  private activeContainer: HTMLElement | null = null;

  private chart: IChartApi | null = null;
  private series: ISeriesApi<any> | null = null;
  private currentContextId: string | null = null;
  private currentSymbol: string | null = null;
  private currentTimeframe: string = 'M1'; // default matches app default timeframe
  private currentAccountScope: string | undefined;

  private get currentContextIdentity(): DrawingContextIdentity | null {
    if (!this.currentSymbol) return null;
    return {
      contextId: this.currentContextId || `legacy:${this.currentSymbol}:${this.currentTimeframe}`,
      symbol: this.currentSymbol,
      timeframe: this.currentTimeframe,
      accountScope: this.currentAccountScope,
    };
  }

  private get currentDrawingContextKey(): string | null {
    const identity = this.currentContextIdentity;
    return identity ? buildDrawingContextKey(identity) : null;
  }

  private get drawings(): Drawing[] {
    const key = this.currentDrawingContextKey;
    if (!key) return [];
    let list = this.drawingsBySymbol.get(key);
    if (!list) {
      list = [];
      this.drawingsBySymbol.set(key, list);
    }
    return list;
  }

  private set drawings(val: Drawing[]) {
    const key = this.currentDrawingContextKey;
    if (key) this.drawingsBySymbol.set(key, val);
  }

  private get svgOverlay(): SVGSVGElement | null {
    if (!this.activeContainer) return null;
    return this.chartContexts.get(this.activeContainer)?.svgOverlay || null;
  }

  private set svgOverlay(val: SVGSVGElement | null) {
    if (this.activeContainer) {
      const ctx = this.chartContexts.get(this.activeContainer);
      if (ctx) ctx.svgOverlay = val;
    }
  }

  private get overlayContainer(): HTMLElement | null {
    return this.activeContainer;
  }

  private set overlayContainer(val: HTMLElement | null) {
    this.activeContainer = val;
  }

  private undoStacksByContext: Map<string, DrawingHistory[]> = new Map();
  private redoStacksByContext: Map<string, DrawingHistory[]> = new Map();
  private loadedDrawingContexts: Set<string> = new Set();

  private get undoStack(): DrawingHistory[] {
    const key = this.currentDrawingContextKey || 'legacy';
    const stack = this.undoStacksByContext.get(key) || [];
    if (!this.undoStacksByContext.has(key)) this.undoStacksByContext.set(key, stack);
    return stack;
  }

  private get redoStack(): DrawingHistory[] {
    const key = this.currentDrawingContextKey || 'legacy';
    const stack = this.redoStacksByContext.get(key) || [];
    if (!this.redoStacksByContext.has(key)) this.redoStacksByContext.set(key, stack);
    return stack;
  }

  private set redoStack(entries: DrawingHistory[]) {
    const key = this.currentDrawingContextKey || 'legacy';
    this.redoStacksByContext.set(key, entries);
  }

  private getUndoStackFor(identity: DrawingContextIdentity): DrawingHistory[] {
    const key = buildDrawingContextKey(identity);
    const stack = this.undoStacksByContext.get(key) || [];
    if (!this.undoStacksByContext.has(key)) this.undoStacksByContext.set(key, stack);
    return stack;
  }

  private getRedoStackFor(identity: DrawingContextIdentity): DrawingHistory[] {
    const key = buildDrawingContextKey(identity);
    const stack = this.redoStacksByContext.get(key) || [];
    if (!this.redoStacksByContext.has(key)) this.redoStacksByContext.set(key, stack);
    return stack;
  }

  private getDrawingsFor(identity: DrawingContextIdentity): Drawing[] {
    const key = buildDrawingContextKey(identity);
    let drawings = this.drawingsBySymbol.get(key);
    if (!drawings) {
      drawings = [];
      this.drawingsBySymbol.set(key, drawings);
    }
    return drawings;
  }

  private identityForContext(context: ChartContext): DrawingContextIdentity {
    return {
      contextId: context.contextId,
      symbol: context.symbol,
      timeframe: context.timeframe,
      accountScope: context.accountScope,
    };
  }

  private contextOwnsActiveDrawing(context: ChartContext): boolean {
    if (!this.activeDrawingOwner) return false;
    return (
      this.activeDrawingOwner.contextId === context.contextId
      && buildDrawingContextKey(this.activeDrawingOwner) === buildDrawingContextKey(context)
    );
  }

  private activateContext(container: HTMLElement, context: ChartContext): void {
    this.activeContainer = container;
    this.chart = context.chart;
    this.series = context.series;
    this.currentContextId = context.contextId;
    this.currentSymbol = context.symbol;
    this.currentTimeframe = context.timeframe;
    this.currentAccountScope = context.accountScope;
  }

  private activateContextFromEventTarget(target: EventTarget | null): ChartContext | null {
    if (!(target instanceof Node)) return null;
    for (const [container, context] of this.chartContexts.entries()) {
      if (context.svgOverlay?.contains(target)) {
        this.activateContext(container, context);
        return context;
      }
    }
    return null;
  }

  private activateDrawingOwner(identity: DrawingContextIdentity | null): boolean {
    if (!identity) return false;
    for (const [container, context] of this.chartContexts.entries()) {
      if (
        context.contextId === identity.contextId
        && buildDrawingContextKey(context) === buildDrawingContextKey(identity)
      ) {
        this.activateContext(container, context);
        return true;
      }
    }
    return false;
  }

  private activateTargetContext(contextId?: string): DrawingContextIdentity | null {
    if (!contextId) return this.currentContextIdentity;

    for (const [container, context] of this.chartContexts.entries()) {
      if (context.contextId !== contextId) continue;
      this.activateContext(container, context);
      return this.identityForContext(context);
    }

    return null;
  }

  // Drag state
  private draggingId: string | null = null;
  private draggingOwner: DrawingContextIdentity | null = null;
  private draggingNodeIndex: number | null = null; // null = whole drawing
  private dragStartX = 0;
  private dragStartY = 0;
  private dragInitialPoints: DrawingPoint[] = [];
  private dragInitialDrawingCopy: Drawing | null = null;
  private draggingScrollLockCallbacks: ScrollLockCallbacks | null = null;

  // Each chart owns its own pan/scale lock. A singleton callback pair could
  // otherwise lock whichever chart happened to register last.
  private scrollLockCallbacksByContext: Map<string, ScrollLockCallbacks> = new Map();

  constructor() {
    // Global pointer events for drag
    window.addEventListener('pointermove', this.onGlobalPointerMove);
    window.addEventListener('pointerup', this.onGlobalPointerUp);

    // Shortcut listeners
    window.addEventListener('chart-undo-drawing', (event) => {
      this.undo((event as CustomEvent<{ targetContextId?: string }>).detail?.targetContextId);
    });
    window.addEventListener('chart-redo-drawing', (event) => {
      this.redo((event as CustomEvent<{ targetContextId?: string }>).detail?.targetContextId);
    });
    window.addEventListener('chart-delete-drawing', (event) => {
      this.deleteSelected((event as CustomEvent<{ targetContextId?: string }>).detail?.targetContextId);
    });
  }

  // ──────────────────────────────────────────────
  // Setup
  // ──────────────────────────────────────────────
  setChart(
    chart: IChartApi | null,
    series: ISeriesApi<any> | null,
    symbol: string | null = null,
    _accountId = 1,
    overlayContainer?: HTMLElement | null,
    timeframe?: string,
    contextId?: string,
    accountScope?: string,
    seriesDataProvider?: DrawingSeriesDataProvider,
  ): void {
    if (!overlayContainer) return;

    if (!chart || !series) {
      // Cleanup / dispose chart panel
      const context = this.chartContexts.get(overlayContainer);
      if (context?.svgOverlay) {
        context.svgOverlay.remove();
      }
      this.chartContexts.delete(overlayContainer);
      if (context) {
        this.scrollLockCallbacksByContext.delete(context.contextId);
        if (this.activeDrawingOwner?.contextId === context.contextId) {
          this.activeDrawing = null;
          this.activeDrawingOwner = null;
          this.previewPoint = null;
        }
        if (this.draggingOwner?.contextId === context.contextId) {
          this.draggingScrollLockCallbacks?.unlock();
          this.resetDragState();
        }
      }
      if (this.activeContainer === overlayContainer) {
        this.activeContainer = null;
        this.chart = null;
        this.series = null;
        this.currentContextId = null;
        this.currentSymbol = null;
        this.currentTimeframe = 'M1';
        this.currentAccountScope = undefined;
      }
      return;
    }

    const existingContext = this.chartContexts.get(overlayContainer);
    const nextSymbol = symbol || existingContext?.symbol || '';
    const nextTimeframe = timeframe || existingContext?.timeframe || 'M1';
    const nextContextId = contextId || existingContext?.contextId || `legacy:${nextSymbol}:${nextTimeframe}`;
    const nextAccountScope = accountScope ?? existingContext?.accountScope;
    const nextSeriesDataProvider = seriesDataProvider ?? existingContext?.seriesDataProvider;
    const isIdenticalActiveContext =
      this.activeContainer === overlayContainer &&
      existingContext?.chart === chart &&
      existingContext.series === series &&
      existingContext.contextId === nextContextId &&
      existingContext.symbol === nextSymbol &&
      existingContext.timeframe === nextTimeframe &&
      existingContext.accountScope === nextAccountScope &&
      existingContext.seriesDataProvider === nextSeriesDataProvider &&
      existingContext.svgOverlay?.parentElement === overlayContainer;

    this.activeContainer = overlayContainer;
    this.chart = chart;
    this.series = series;
    this.currentContextId = nextContextId;
    this.currentSymbol = nextSymbol;
    this.currentTimeframe = nextTimeframe;
    this.currentAccountScope = nextAccountScope;

    // Crosshair movement re-binds the active panel on every pointer event. If
    // that binding is already current, rebuilding every SVG drawing is pure
    // duplicate work and competes with lightweight-charts' pan frame.
    if (isIdenticalActiveContext) return;

    // Get or create context
    let context = existingContext;
    const identityChanged = !context
      || context.contextId !== nextContextId
      || context.symbol !== nextSymbol
      || context.timeframe !== nextTimeframe
      || context.accountScope !== nextAccountScope;

    if (!context) {
      context = {
        chart,
        series,
        contextId: nextContextId,
        symbol: nextSymbol,
        timeframe: nextTimeframe,
        accountScope: nextAccountScope,
        seriesDataProvider: nextSeriesDataProvider,
        svgOverlay: null,
      };
      this.chartContexts.set(overlayContainer, context);
    } else {
      context.chart = chart;
      context.series = series;
      context.contextId = nextContextId;
      context.symbol = nextSymbol;
      context.timeframe = nextTimeframe;
      context.accountScope = nextAccountScope;
      context.seriesDataProvider = nextSeriesDataProvider;
    }

    // Build or relocate the SVG overlay for this container
    this.ensureSvgOverlayForContainer(overlayContainer, context);

    const identity = this.identityForContext(context);
    const drawingContextKey = buildDrawingContextKey(identity);
    if (!this.drawingsBySymbol.has(drawingContextKey)) {
      this.drawingsBySymbol.set(drawingContextKey, []);
    }

    this.renderAll();
    if (nextSymbol && !this.loadedDrawingContexts.has(drawingContextKey)) {
      this.loadedDrawingContexts.add(drawingContextKey);
      void this.loadFromBackend(identity).finally(() => this.renderAll());
    } else if (identityChanged) {
      this.renderContext(overlayContainer);
    }
  }

  /** Create or heal the SVG overlay. Tries stored container, then document.body as last resort. */
  private ensureSvgOverlay(): void {
    if (this.activeContainer) {
      const ctx = this.chartContexts.get(this.activeContainer);
      if (ctx) this.ensureSvgOverlayForContainer(this.activeContainer, ctx);
    }
  }

  private ensureSvgOverlayForContainer(container: HTMLElement, context: ChartContext): void {
    if (context.svgOverlay && context.svgOverlay.parentElement !== container) {
      context.svgOverlay.remove();
      context.svgOverlay = null;
    }

    if (!context.svgOverlay) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'chart-svg-overlay');
      // Use the SVG *attribute* (not CSS) for pointer-events:none on the root SVG.
      // This allows individual child elements (hit-zones) to override it with their
      // own pointer-events attribute — CSS pointer-events:none on parent blocks children.
      svg.setAttribute('pointer-events', 'none');
      svg.style.cssText = [
        'position:absolute',
        'top:0',
        'left:0',
        'width:100%',
        'height:100%',
        'overflow:visible',
        'z-index:10',
      ].join(';');
      container.appendChild(svg);
      context.svgOverlay = svg;
      console.log('[DrawingManager] SVG overlay created in', container.className || container.tagName);
    }
  }

  setScrollLockCallbacks(contextId: string, lock: () => void, unlock: () => void): () => void;
  setScrollLockCallbacks(lock: () => void, unlock: () => void): () => void;
  setScrollLockCallbacks(
    contextIdOrLock: string | (() => void),
    lockOrUnlock: () => void,
    maybeUnlock?: () => void,
  ): () => void {
    const contextId = typeof contextIdOrLock === 'string'
      ? contextIdOrLock
      : (this.currentContextId || 'legacy');
    const callbacks: ScrollLockCallbacks = typeof contextIdOrLock === 'string'
      ? { lock: lockOrUnlock, unlock: maybeUnlock || (() => undefined) }
      : { lock: contextIdOrLock, unlock: lockOrUnlock };

    this.scrollLockCallbacksByContext.set(contextId, callbacks);
    return () => {
      if (this.scrollLockCallbacksByContext.get(contextId) === callbacks) {
        this.scrollLockCallbacksByContext.delete(contextId);
      }
    };
  }

  setMagnetEnabled(enabled: boolean): void {
    this.magnetEnabled = enabled;
  }

  // ──────────────────────────────────────────────
  // Drawing Lifecycle
  // ──────────────────────────────────────────────
  startDrawing(type: DrawingType, color = '#2196F3', meta?: { subtype?: string }): string {
    const id = `d-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const runtimeDefaults = getTrendToolRuntimeDefaults(meta?.subtype);
    this.activeDrawing = {
      id,
      type,
      points: [],
      color,
      lineWidth: 2,
      ...runtimeDefaults,
      pitchforkLevels: runtimeDefaults.pitchforkLevels
        ? [...runtimeDefaults.pitchforkLevels]
        : undefined,
    };
    if (meta?.subtype) this.activeDrawing.subtype = meta.subtype;
    this.activeDrawingOwner = this.currentContextIdentity
      ? { ...this.currentContextIdentity }
      : {
        contextId: 'legacy:detached',
        symbol: 'UNKNOWN',
        timeframe: this.currentTimeframe,
      };
    this.previewPoint = null;
    return id;
  }

  cancelDrawing(contextId?: string): void {
    if (contextId && this.activeDrawingOwner?.contextId !== contextId) return;
    this.activeDrawing = null;
    this.activeDrawingOwner = null;
    this.previewPoint = null;
    this.renderAll();
  }

  /**
   * Called on every chart click while a drawing tool is active.
   * Returns true when the drawing is complete.
   */
  addPoint(time: number, price: number, seriesData?: any, contextId?: string): boolean {
    if (!this.activeDrawing) return false;
    if (contextId && this.activeDrawingOwner?.contextId !== contextId) return false;

    // Magnet snap to OHLC
    let finalPrice = price;
    if (this.magnetEnabled && seriesData) {
      const candidates = [
        seriesData.open,
        seriesData.high,
        seriesData.low,
        seriesData.close,
      ].filter((p): p is number => typeof p === 'number');
      if (candidates.length) {
        finalPrice = candidates.reduce((best, p) =>
          Math.abs(p - price) < Math.abs(best - price) ? p : best,
        );
      }
    }

    this.activeDrawing.points.push({ time, price: finalPrice });

    const required = requiredPointsForDrawing(this.activeDrawing);
    if (required > 0 && this.activeDrawing.points.length >= required) {
      return this._completeDrawing() !== null;
    }

    this.renderAll();
    return false;
  }

  /**
   * Called on chart click for vlines.
   * pixelXOffset = rawX - timeToCoordinate(time), the within-bar pixel offset.
   * Storing this (instead of logicalIndex) gives pixel-perfect drag just like hline uses price.
   */
  addPointWithLogical(time: number, price: number, pixelXOffset: number, contextId?: string): boolean {
    if (!this.activeDrawing) return false;
    if (contextId && this.activeDrawingOwner?.contextId !== contextId) return false;
    this.activeDrawing.points.push({ time, price, pixelXOffset });

    const required = requiredPointsForDrawing(this.activeDrawing);
    if (required > 0 && this.activeDrawing.points.length >= required) {
      return this._completeDrawing() !== null;
    }

    this.renderAll();
    return false;
  }

  /**
   * Called on every crosshair move while a drawing tool is active.
   * Always stores the latest cursor position so renderAll can draw the ghost preview.
   */
  updatePreviewPoint(time: number, price: number, contextId?: string): void {
    if (contextId && this.activeDrawingOwner?.contextId !== contextId) return;
    if (!this.activeDrawing) {
      if (this.previewPoint) {
        this.previewPoint = null;
        this.renderAll();
      }
      return;
    }
    // Always update — both before first click (ghost preview) and after
    this.previewPoint = { time, price };
    this.renderAll();
  }

  /** Like updatePreviewPoint but also stores pixelXOffset for vline pixel-precise ghost. */
  updatePreviewPointWithLogical(time: number, price: number, pixelXOffset?: number, contextId?: string): void {
    if (contextId && this.activeDrawingOwner?.contextId !== contextId) return;
    if (!this.activeDrawing) {
      if (this.previewPoint) {
        this.previewPoint = null;
        this.renderAll();
      }
      return;
    }
    this.previewPoint = { time, price, pixelXOffset };
    this.renderAll();
  }

  private _completeDrawing(): Drawing | null {
    if (!this.activeDrawing) return null;
    const owner = this.activeDrawingOwner || this.currentContextIdentity;
    if (!owner) return null;

    const completed: Drawing = { ...this.activeDrawing, selected: true };

    // Legacy/equidistant and parallel channels retain a zoom-invariant price offset.
    if (
      completed.type === 'channel'
      && (completed.subtype === undefined || completed.subtype === 'parallel_channel')
      && completed.channelOffset === undefined
      && completed.points.length >= 2
    ) {
      const priceDelta = Math.abs(completed.points[1].price - completed.points[0].price);
      if (completed.points[2]) {
        const first = completed.points[0];
        const second = completed.points[1];
        const widthPoint = completed.points[2];
        const timeScale = this.chart?.timeScale();
        const firstScreen = this.px(first);
        const secondScreen = this.px(second);
        const widthScreen = this.px(widthPoint);
        const firstLogical = first.logicalIndex
          ?? (firstScreen ? timeScale?.coordinateToLogical(firstScreen.x) : null);
        const secondLogical = second.logicalIndex
          ?? (secondScreen ? timeScale?.coordinateToLogical(secondScreen.x) : null);
        const widthLogical = widthPoint.logicalIndex
          ?? (widthScreen ? timeScale?.coordinateToLogical(widthScreen.x) : null);
        const logicalSpan = firstLogical !== null && firstLogical !== undefined
          && secondLogical !== null && secondLogical !== undefined
          ? secondLogical - firstLogical
          : 0;
        const progress = Math.abs(logicalSpan) > 0.0001
          && widthLogical !== null && widthLogical !== undefined
          && firstLogical !== null && firstLogical !== undefined
          ? (widthLogical - firstLogical) / logicalSpan
          : 0;
        const baselinePrice = first.price + progress * (second.price - first.price);
        completed.channelOffset = widthPoint.price - baselinePrice;
      } else {
        completed.channelOffset = priceDelta > 0 ? priceDelta * 0.2 : 0.001;
      }
      completed.rayLeft = false;
      completed.rayRight = false;
    }

    const ownerDrawings = this.getDrawingsFor(owner);
    ownerDrawings.forEach(drawing => {
      drawing.selected = false;
    });
    ownerDrawings.push(completed);
    this.activeDrawing = null;
    this.activeDrawingOwner = null;
    this.previewPoint = null;

    this.getUndoStackFor(owner).push({ action: 'add', drawing: JSON.parse(JSON.stringify(completed)) });
    this.redoStacksByContext.set(buildDrawingContextKey(owner), []);

    this.renderAll();
    this.dispatchDrawingSelection(completed, owner);
    if (owner.contextId !== 'legacy:detached') {
      void this.saveToBackend(completed, owner);
      this.persistLocalFor(owner, ownerDrawings);
    }

    window.dispatchEvent(new CustomEvent('drawing:saved', {
      detail: {
        ...completed,
        contextId: owner.contextId,
        symbol: owner.symbol,
        timeframe: owner.timeframe,
        accountScope: owner.accountScope,
      },
    }));
    return completed;
  }

  private dispatchDrawingSelection(
    drawing: Drawing,
    identity: DrawingContextIdentity | null,
  ): void {
    const screenPoints = drawing.points
      .map(point => this.px(point))
      .filter((point): point is { x: number; y: number } => point !== null);
    const containerRect = this.overlayContainer?.getBoundingClientRect();
    const centerX = screenPoints.length > 0
      ? screenPoints.reduce((sum, point) => sum + point.x, 0) / screenPoints.length
      : (this.overlayContainer?.clientWidth ?? 0) / 2;
    const topY = screenPoints.length > 0
      ? Math.min(...screenPoints.map(point => point.y))
      : 0;
    window.dispatchEvent(new CustomEvent('drawing:selected', {
      detail: {
        drawingId: drawing.id,
        contextId: identity?.contextId,
        type: drawing.type,
        subtype: drawing.subtype,
        color: drawing.color,
        lineWidth: drawing.lineWidth,
        lineStyle: drawing.lineStyle,
        locked: drawing.locked,
        anchorClientX: (containerRect?.left ?? 0) + centerX,
        anchorClientY: (containerRect?.top ?? 0) + topY,
      },
    }));
  }

  selectDrawing(id: string, multi = false): void {
    if (!multi) this.drawings.forEach(d => (d.selected = false));
    const d = this.drawings.find(d => d.id === id);
    if (d) {
      d.selected = true;
      // Bring to front
      const idx = this.drawings.indexOf(d);
      this.drawings.splice(idx, 1);
      this.drawings.push(d);
    }
    this.renderAll();
    if (d) this.dispatchDrawingSelection(d, this.currentContextIdentity);
  }

  unselectAll(): void {
    this.drawings.forEach(d => (d.selected = false));
    this.renderAll();
    window.dispatchEvent(new CustomEvent('drawing:selection-cleared', {
      detail: { contextId: this.currentContextId },
    }));
  }

  deleteDrawing(id: string, targetContextId?: string): boolean {
    const identity = this.activateTargetContext(targetContextId);
    if (!identity) return false;
    const idx = this.drawings.findIndex(d => d.id === id);
    if (idx === -1) return false;
    const removed = this.drawings.splice(idx, 1)[0];
    const removedSelection = removed.selected === true;
    this.undoStack.push({ action: 'delete', drawing: JSON.parse(JSON.stringify(removed)) });
    this.redoStack = [];
    this.renderAll();
    void this.deleteFromBackend(id, removed.serverId, identity);
    this.persistLocal();
    window.dispatchEvent(new CustomEvent('drawing:deleted', {
      detail: {
        id,
        contextId: identity?.contextId,
        symbol: identity?.symbol,
        timeframe: identity?.timeframe,
      },
    }));
    if (removedSelection) {
      window.dispatchEvent(new CustomEvent('drawing:selection-cleared', {
        detail: { contextId: identity.contextId },
      }));
    }
    return true;
  }

  deleteSelected(targetContextId?: string): void {
    if (!this.activateTargetContext(targetContextId)) return;
    const toDelete = this.drawings.filter(d => d.selected).map(d => d.id);
    toDelete.forEach(id => this.deleteDrawing(id, targetContextId));
  }

  clearAllDrawings(persist = true, targetContextId?: string): void {
    const identity = this.activateTargetContext(targetContextId);
    if (!identity) return;
    const deleteInfo = this.drawings.map(d => ({ id: d.id, serverId: d.serverId }));
    this.drawings = [];
    this.renderAll();
    if (persist) {
      this.persistLocal();
      deleteInfo.forEach(({ id, serverId }) => void this.deleteFromBackend(id, serverId, identity));
    }
    window.dispatchEvent(new CustomEvent('drawings:cleared'));
    window.dispatchEvent(new CustomEvent('drawing:selection-cleared', {
      detail: { contextId: identity.contextId },
    }));
  }

  getDrawings(): Drawing[] {
    return [...this.drawings];
  }

  updateDrawingProperties(
    id: string,
    properties: Partial<Drawing>,
    targetContextId?: string,
  ): boolean {
    const identity = this.activateTargetContext(targetContextId);
    if (!identity) return false;
    const drawing = this.drawings.find(candidate => candidate.id === id);
    if (!drawing) return false;
    const previous = JSON.parse(JSON.stringify(drawing)) as Drawing;
    Object.assign(drawing, properties, { id: drawing.id, type: drawing.type });
    if (JSON.stringify(previous) === JSON.stringify(drawing)) return true;
    this.undoStack.push({
      action: 'modify',
      oldDrawing: previous,
      newDrawing: JSON.parse(JSON.stringify(drawing)),
    });
    this.redoStack = [];
    this.persistLocalFor(identity, this.getDrawingsFor(identity));
    void this.saveToBackend(drawing, identity);
    this.renderAll();
    this.dispatchDrawingSelection(drawing, identity);
    return true;
  }

  ownsActiveDrawing(contextId: string): boolean {
    return Boolean(this.activeDrawing && this.activeDrawingOwner?.contextId === contextId);
  }

  getActiveDrawing(contextId?: string): Drawing | null {
    if (contextId && this.activeDrawingOwner?.contextId !== contextId) return null;
    return this.activeDrawing ? { ...this.activeDrawing } : null;
  }

  undo(targetContextId?: string): void {
    const identity = this.activateTargetContext(targetContextId);
    if (!identity) return;
    const entry = this.undoStack.pop();
    if (!entry) return;
    if (entry.action === 'add' && entry.drawing) {
      this.drawings = this.drawings.filter(d => d.id !== entry.drawing!.id);
      void this.deleteFromBackend(entry.drawing.id, entry.drawing.serverId, identity);
    } else if (entry.action === 'delete' && entry.drawing) {
      this.drawings.push(entry.drawing);
      this.saveToBackend(entry.drawing, identity);
    } else if (entry.action === 'modify' && entry.oldDrawing) {
      const idx = this.drawings.findIndex(d => d.id === entry.oldDrawing!.id);
      if (idx !== -1) {
        this.drawings[idx] = entry.oldDrawing;
        this.saveToBackend(entry.oldDrawing, identity);
      }
    }
    this.redoStack.push(entry);
    this.renderAll();
    this.persistLocal();
  }

  redo(targetContextId?: string): void {
    const identity = this.activateTargetContext(targetContextId);
    if (!identity) return;
    const entry = this.redoStack.pop();
    if (!entry) return;
    if (entry.action === 'add' && entry.drawing) {
      this.drawings.push(entry.drawing);
      this.saveToBackend(entry.drawing, identity);
    } else if (entry.action === 'delete' && entry.drawing) {
      this.drawings = this.drawings.filter(d => d.id !== entry.drawing!.id);
      void this.deleteFromBackend(entry.drawing.id, entry.drawing.serverId, identity);
    } else if (entry.action === 'modify' && entry.newDrawing) {
      const idx = this.drawings.findIndex(d => d.id === entry.newDrawing!.id);
      if (idx !== -1) {
        this.drawings[idx] = entry.newDrawing;
        this.saveToBackend(entry.newDrawing, identity);
      }
    }
    this.undoStack.push(entry);
    this.renderAll();
    this.persistLocal();
  }

  updateDrawingPositions(): void {
    if (!this.chart || !this.series) return;
    this.renderAll();
  }

  private px(point: DrawingPoint): { x: number; y: number } | null {
    if (!this.chart || !this.series) return null;
    let x = null;
    if (point.logicalIndex !== undefined) {
      x = this.chart.timeScale().logicalToCoordinate(point.logicalIndex as any);
    }
    if (x === null) {
      x = this.chart.timeScale().timeToCoordinate(point.time as any);
    }
    const y = this.series.priceToCoordinate(point.price);
    if (x === null || y === null) return null;
    return { x, y };
  }

  private toDashArray(style?: string): string {
    if (style === 'dashed') return '8 4';
    if (style === 'dotted') return '3 3';
    return 'none';
  }

  /** Whether this chart panel currently owns anything that must track its viewport. */
  hasRenderableContent(overlayContainer?: HTMLElement | null): boolean {
    if (!overlayContainer) return false;
    const context = this.chartContexts.get(overlayContainer);
    if (!context) return false;

    const hasDrawings = (
      this.drawingsBySymbol.get(buildDrawingContextKey(this.identityForContext(context)))?.length
      ?? 0
    ) > 0;
    const ownsPreview =
      this.contextOwnsActiveDrawing(context) &&
      this.activeDrawing !== null &&
      this.previewPoint !== null;
    return hasDrawings || ownsPreview;
  }

  /** Re-render one chart panel after its own viewport changes. */
  renderContext(overlayContainer?: HTMLElement | null): void {
    if (!overlayContainer || !this.hasRenderableContent(overlayContainer)) return;
    const context = this.chartContexts.get(overlayContainer);
    if (!context) return;

    const origChart = this.chart;
    const origSeries = this.series;
    const origContextId = this.currentContextId;
    const origSymbol = this.currentSymbol;
    const origTimeframe = this.currentTimeframe;
    const origAccountScope = this.currentAccountScope;

    try {
      this.renderContextContents(overlayContainer, context);
    } finally {
      this.chart = origChart;
      this.series = origSeries;
      this.currentContextId = origContextId;
      this.currentSymbol = origSymbol;
      this.currentTimeframe = origTimeframe;
      this.currentAccountScope = origAccountScope;
    }
  }

  private renderContextContents(container: HTMLElement, context: ChartContext): void {
    this.ensureSvgOverlayForContainer(container, context);
    const svg = context.svgOverlay;
    if (!svg) return;

    // Clear only this context. Pan frames must not tear down sibling overlays.
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    if (!context.chart || !context.series) return;

    // Set active context temporarily for px() and rendering helpers
    this.chart = context.chart;
    this.series = context.series;
    this.currentContextId = context.contextId;
    this.currentSymbol = context.symbol;
    this.currentTimeframe = context.timeframe;
    this.currentAccountScope = context.accountScope;

    // Get chart container dimensions for full-span lines (hline, vline)
    const W = container.clientWidth || 2000;
    const H = container.clientHeight || 1200;

    // Add defs for arrowhead
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML = `
      <marker id="arr" markerWidth="7" markerHeight="7" refX="3" refY="3.5" orient="auto">
        <polygon points="0 0, 7 3.5, 0 7" fill="#2196F3" />
      </marker>`;
    svg.appendChild(defs);

    // Fetch drawings for this account, symbol, and timeframe.
    const symbolDrawings = this.drawingsBySymbol.get(
      buildDrawingContextKey(this.identityForContext(context)),
    ) || [];

    // Render drawings for this symbol
    symbolDrawings.forEach(d => this.renderDrawing(svg, d, W, H, false));

    // Render cursor-following ghost BEFORE first click (vline, hline get a ghost from day 0)
    // Only draw the active/preview drawings on the active container if it matches this context!
    if (this.contextOwnsActiveDrawing(context) && this.activeDrawing && this.activeDrawing.points.length === 0 && this.previewPoint) {
      const type = this.activeDrawing.type;
      if (type === 'vline' || type === 'hline' || type === 'stamp') {
        const ghost: Drawing = {
          ...this.activeDrawing,
          id: this.activeDrawing.id + '-ghost',
          points: [this.previewPoint],
          selected: false,
          color: this.activeDrawing.color || '#2196F3',
        };
        this.renderDrawing(svg, ghost, W, H, true);
      }
    }

    // Render active drawing in progress with preview point appended
    if (this.contextOwnsActiveDrawing(context) && this.activeDrawing && this.activeDrawing.points.length > 0 && this.previewPoint) {
      const preview: Drawing = {
        ...this.activeDrawing,
        id: this.activeDrawing.id + '-preview',
        points: [...this.activeDrawing.points, this.previewPoint],
        selected: false,
        color: this.activeDrawing.color || '#2196F3',
      };
      this.renderDrawing(svg, preview, W, H, true);
    }
  }


  renderAll(): void {
    const origChart = this.chart;
    const origSeries = this.series;
    const origContextId = this.currentContextId;
    const origSymbol = this.currentSymbol;
    const origTimeframe = this.currentTimeframe;
    const origAccountScope = this.currentAccountScope;

    try {
      for (const [container, context] of this.chartContexts.entries()) {
        this.renderContextContents(container, context);
      }
    } finally {
      // Restore original references
      this.chart = origChart;
      this.series = origSeries;
      this.currentContextId = origContextId;
      this.currentSymbol = origSymbol;
      this.currentTimeframe = origTimeframe;
      this.currentAccountScope = origAccountScope;
    }
  }

  private renderDrawing(
    svg: SVGSVGElement,
    d: Drawing,
    W: number,
    H: number,
    isPreview = false,
  ): void {
    const color = d.color || '#2196F3';
    const lw = d.lineWidth || 2;
    const dash = this.toDashArray(d.lineStyle);
    const opacity = isPreview ? '0.7' : '1';

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('data-id', d.id);

    switch (d.type) {

      // ─── Horizontal Line ─────────────────────────────────────────
      case 'hline': {
        if (d.points.length < 1) break;
        const y = this.series!.priceToCoordinate(d.points[0].price);
        if (y === null) break;

        const anchor = this.px(d.points[0]);
        const plotW = Math.max(0, W - (this.chart?.priceScale('right').width() ?? 0));
        const x1 = d.subtype === 'horizontal_ray' && anchor ? anchor.x : 0;

        const line = this.svgLine(x1, y, plotW, y, color, lw, dash);
        line.style.opacity = opacity;
        g.appendChild(line);

        if (!isPreview) {
          const hit = this.svgLine(x1, y, plotW, y, 'transparent', 12, 'none');
          hit.setAttribute('pointer-events', 'stroke');
          hit.style.cursor = 'move';
          hit.addEventListener('pointerdown', e => this.beginDrag(e, d.id, null));
          hit.addEventListener('contextmenu', e => this.onContextMenu(e, d.id));
          g.appendChild(hit);
        }

        this.appendPriceScaleLabel(g, plotW, y, d.points[0].price, color);
        break;
      }


      case 'vline': {
        if (d.points.length < 1) break;
        const pt = d.points[0];
        let x: number | null = null;

        if (pt.pixelXOffset !== undefined) {
          // NEW: pixel-space coordinate — identical pattern to hline's priceToCoordinate
          // barX = where the bar centre sits now (updates automatically on pan/zoom)
          // x    = barX + stored pixel offset from that centre
          const barX = this.chart!.timeScale().timeToCoordinate(pt.time as any);
          if (barX !== null) x = barX + pt.pixelXOffset;
        } else if (pt.logicalIndex !== undefined) {
          // Backward compat: old saved drawings that used logicalIndex
          x = this.chart!.timeScale().logicalToCoordinate(pt.logicalIndex as any);
        } else {
          // Absolute fallback — snaps to bar centre
          x = this.chart!.timeScale().timeToCoordinate(pt.time as any);
        }
        if (x === null) break;

        const plotW = Math.max(0, W - (this.chart?.priceScale('right').width() ?? 0));
        const plotH = Math.max(0, H - (this.chart?.timeScale().height() ?? 0));
        const crossY = this.series!.priceToCoordinate(pt.price);

        const line = this.svgLine(x, 0, x, plotH, color, lw, dash);
        line.style.opacity = opacity;
        g.appendChild(line);

        if (d.subtype === 'crossline' && crossY !== null) {
          const horizontal = this.svgLine(0, crossY, plotW, crossY, color, lw, dash);
          horizontal.style.opacity = opacity;
          g.appendChild(horizontal);
          this.appendPriceScaleLabel(g, plotW, crossY, pt.price, color);
        }

        this.appendTimeScaleLabel(g, x, plotH, pt.time, color);

        // Invisible wide hit-zone for interaction
        if (!isPreview) {
          const hit = this.svgLine(x, 0, x, plotH, 'transparent', 12, 'none');
          hit.setAttribute('pointer-events', 'stroke');
          hit.style.cursor = 'ew-resize';
          hit.addEventListener('pointerdown', e => this.beginDrag(e, d.id, 0));
          hit.addEventListener('contextmenu', e => this.onContextMenu(e, d.id));
          g.appendChild(hit);

          if (d.subtype === 'crossline' && crossY !== null) {
            const horizontalHit = this.svgLine(0, crossY, plotW, crossY, 'transparent', 12, 'none');
            horizontalHit.setAttribute('pointer-events', 'stroke');
            horizontalHit.style.cursor = 'move';
            horizontalHit.addEventListener('pointerdown', e => this.beginDrag(e, d.id, 0));
            horizontalHit.addEventListener('contextmenu', e => this.onContextMenu(e, d.id));
            g.appendChild(horizontalHit);
          }

        }
        break;
      }

      // ─── Trend Line (Segment) ─────────────────────────────────────────
      case 'trendline': {
        if (d.points.length < 2) break;
        const p1 = this.px(d.points[0]);
        const p2 = this.px(d.points[1]);
        if (!p1 || !p2) break;

        const plotW = Math.max(0, W - (this.chart?.priceScale('right').width() ?? 0));
        const plotH = Math.max(0, H - (this.chart?.timeScale().height() ?? 0));
        const extent = d.subtype === 'ray'
          ? 'ray'
          : d.subtype === 'extended_line'
            ? 'infinite'
            : 'segment';
        const segment = clipLineToViewport(p1, p2, plotW, plotH, extent) ?? { start: p1, end: p2 };

        const line = this.svgLine(
          segment.start.x,
          segment.start.y,
          segment.end.x,
          segment.end.y,
          color,
          lw,
          dash,
        );
        line.style.opacity = opacity;
        g.appendChild(line);

        if (d.subtype === 'info_line' || d.subtype === 'trend_angle') {
          const angle = screenAngleDegrees(p1, p2);
          if (d.subtype === 'trend_angle') {
            const guideDirection = p2.x >= p1.x ? 1 : -1;
            const guideLength = Math.min(72, Math.max(28, Math.abs(p2.x - p1.x) * 0.36));
            const guideEndX = p1.x + (guideDirection * guideLength);
            const baseline = this.svgLine(p1.x, p1.y, guideEndX, p1.y, color, 1, '2 2');
            baseline.setAttribute('data-geometry-role', 'angle-reference');
            baseline.style.opacity = isPreview ? '0.55' : '0.8';
            g.appendChild(baseline);
            const angleLabel = this.svgText(
              guideEndX + (guideDirection * 8),
              p1.y + 3,
              `${angle.toFixed(2)}°`,
              color,
              11,
            );
            angleLabel.setAttribute('text-anchor', guideDirection > 0 ? 'start' : 'end');
            angleLabel.setAttribute('font-family', 'var(--font-mono), monospace');
            angleLabel.setAttribute('data-geometry-role', 'angle-label');
            g.appendChild(angleLabel);
          } else {
            const timeScale = this.chart!.timeScale();
            const startLogical = d.points[0].logicalIndex
              ?? timeScale.coordinateToLogical(p1.x)
              ?? 0;
            const endLogical = d.points[1].logicalIndex
              ?? timeScale.coordinateToLogical(p2.x)
              ?? startLogical;
            const priceFormat = this.getSeriesPriceFormat();
            const metrics = buildInfoLineMetrics({
              startPrice: d.points[0].price,
              endPrice: d.points[1].price,
              startTime: d.points[0].time,
              endTime: d.points[1].time,
              startScreen: p1,
              endScreen: p2,
              startLogical,
              endLogical,
              minMove: priceFormat.minMove,
              pricePrecision: priceFormat.precision,
            });
            this.appendInfoLinePanel(g, p1, p2, metrics.display, plotW, plotH);
          }
        }

        // Clickable hit-zone (invisible wider line)
        if (!isPreview) {
          const hit = this.svgLine(
            segment.start.x,
            segment.start.y,
            segment.end.x,
            segment.end.y,
            'transparent',
            12,
            'none',
          );
          hit.setAttribute('pointer-events', 'stroke');
          hit.style.cursor = 'pointer';
          hit.addEventListener('pointerdown', e => this.beginDrag(e, d.id, null));
          hit.addEventListener('contextmenu', e => this.onContextMenu(e, d.id));
          g.appendChild(hit);
        }
        break;
      }

      // ─── Equidistant Channel (MT5-correct) ──────────────────────
      case 'channel': {
        if (d.subtype && this.renderTrendChannelVariant(g, d, W, H, color, lw, dash, opacity, isPreview)) {
          break;
        }
        if (d.points.length < 2) break;
        let chOffset = d.channelOffset;
        if (chOffset === undefined && d.points.length >= 2) {
          const priceDelta = Math.abs(d.points[1].price - d.points[0].price);
          chOffset = priceDelta > 0 ? priceDelta * 0.2 : 0.001;
        } else {
          chOffset = chOffset ?? 0;
        }
        const rayL = d.rayLeft ?? false;
        const rayR = d.rayRight ?? false;

        // Data-space → pixel-space for main line anchors
        const mp1_raw = this.px(d.points[0]);
        const mp2_raw = this.px(d.points[1]);
        if (!mp1_raw || !mp2_raw) break;

        let mp1_x = mp1_raw.x;
        if (d.points[0].pixelXOffset !== undefined) {
          const barX = this.chart!.timeScale().timeToCoordinate(d.points[0].time as any);
          if (barX !== null) mp1_x = barX + d.points[0].pixelXOffset;
        }

        let mp2_x = mp2_raw.x;
        if (d.points[1].pixelXOffset !== undefined) {
          const barX = this.chart!.timeScale().timeToCoordinate(d.points[1].time as any);
          if (barX !== null) mp2_x = barX + d.points[1].pixelXOffset;
        }

        const mp1 = { x: mp1_x, y: mp1_raw.y };
        const mp2 = { x: mp2_x, y: mp2_raw.y };

        // Parallel line: same time anchors, price shifted by channelOffset
        const pp1y = this.series!.priceToCoordinate(d.points[0].price + chOffset);
        const pp2y = this.series!.priceToCoordinate(d.points[1].price + chOffset);
        if (pp1y === null || pp2y === null) break;
        const pp1 = { x: mp1.x, y: pp1y };
        const pp2 = { x: mp2.x, y: pp2y };

        // Compute ray extensions (extend to chart edges if ray flag is on)
        const dxLine = mp2.x - mp1.x;
        const dyMain = mp2.y - mp1.y;
        const dyPar = pp2.y - pp1.y;

        // Main line endpoints (bounded by default)
        let mx1 = mp1.x, my1 = mp1.y, mx2 = mp2.x, my2 = mp2.y;
        // Parallel line endpoints
        let px1 = pp1.x, py1 = pp1.y as number, px2 = pp2.x, py2 = pp2.y as number;

        if (Math.abs(dxLine) > 0.01) {
          const slopeMain = dyMain / dxLine;
          const slopePar = dyPar / dxLine;
          if (rayL) {
            const extL = -20;
            my1 = mp1.y + slopeMain * (extL - mp1.x);
            mx1 = extL;
            py1 = pp1.y + slopePar * (extL - pp1.x);
            px1 = extL;
          }
          if (rayR) {
            const extR = W + 20;
            my2 = mp1.y + slopeMain * (extR - mp1.x);
            mx2 = extR;
            py2 = pp1.y + slopePar * (extR - pp1.x);
            px2 = extR;
          }
        }

        // Clip helper
        const clipX = (x: number) => Math.max(-2, Math.min(W + 2, x));
        const clipY = (y: number) => Math.max(-2, Math.min(H + 2, y));

        // Main line (solid)
        const mainLine = this.svgLine(clipX(mx1), clipY(my1), clipX(mx2), clipY(my2), color, lw, dash);
        mainLine.style.opacity = opacity;
        g.appendChild(mainLine);

        // Parallel line (dashed)
        const parLine = this.svgLine(clipX(px1), clipY(py1), clipX(px2), clipY(py2), color, lw, '8 4');
        parLine.style.opacity = opacity;
        g.appendChild(parLine);

        // Channel fill polygon
        const fillEl = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        fillEl.setAttribute('points',
          `${clipX(mx1)},${clipY(my1)} ${clipX(mx2)},${clipY(my2)} ${clipX(px2)},${clipY(py2)} ${clipX(px1)},${clipY(py1)}`);
        fillEl.setAttribute('fill', color);
        fillEl.setAttribute('fill-opacity', '0.06');
        fillEl.style.opacity = opacity;
        g.appendChild(fillEl);

        // ── PREVIEW ONLY: Vertical guide lines at anchor1 and anchor2 ──
        if (isPreview) {
          const vline1 = this.svgLine(mp1.x, 0, mp1.x, H, color, 1, '4 3');
          vline1.style.opacity = '0.5';
          g.appendChild(vline1);

          const vline2 = this.svgLine(mp2.x, 0, mp2.x, H, color, 1, '4 3');
          vline2.style.opacity = '0.5';
          g.appendChild(vline2);

          // Measurement tooltip
          const timeDiff = Math.abs(d.points[1].time - d.points[0].time);
          const priceDiff = Math.abs(d.points[1].price - d.points[0].price);
          const barCount = Math.round(timeDiff / 60);
          const infoText = `${barCount} / ${priceDiff.toFixed(5)}`;
          const labelX = mp2.x + 8;
          const labelY = mp2.y - 8;
          const label = this.svgText(labelX, labelY, infoText, '#ffffff', 11);
          label.setAttribute('font-weight', 'bold');
          g.appendChild(label);

          const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          dot.setAttribute('cx', String(mp2.x));
          dot.setAttribute('cy', String(mp2.y));
          dot.setAttribute('r', '3');
          dot.setAttribute('fill', color);
          dot.style.opacity = '0.8';
          g.appendChild(dot);
        }

        // ── COMMITTED: Measurement label when selected ──
        if (d.selected && !isPreview) {
          const timeDiff = Math.abs(d.points[1].time - d.points[0].time);
          const priceDiff = Math.abs(d.points[1].price - d.points[0].price);
          const midX = (mp1.x + mp2.x) / 2;
          const midY = Math.min(mp1.y, mp2.y) - 14;
          const infoText = `${Math.round(timeDiff / 60)} / ${priceDiff.toFixed(5)}`;
          const label = this.svgText(midX, midY, infoText, color, 10);
          label.setAttribute('text-anchor', 'middle');
          g.appendChild(label);
        }

        // ── Hit zones for interaction (committed only) ──
        if (!isPreview) {
          const mainHit = this.svgLine(mp1.x, mp1.y, mp2.x, mp2.y, 'transparent', 14, 'none');
          mainHit.setAttribute('pointer-events', 'stroke');
          mainHit.style.cursor = 'move';
          mainHit.addEventListener('pointerdown', e => this.beginDrag(e, d.id, null));
          mainHit.addEventListener('contextmenu', e => this.onContextMenu(e, d.id));
          g.appendChild(mainHit);

          const parHit = this.svgLine(pp1.x, pp1.y, pp2.x, pp2.y, 'transparent', 14, 'none');
          parHit.setAttribute('pointer-events', 'stroke');
          parHit.style.cursor = 'ns-resize';
          parHit.addEventListener('pointerdown', e => this.beginDrag(e, d.id, -1));
          parHit.addEventListener('contextmenu', e => this.onContextMenu(e, d.id));
          g.appendChild(parHit);

          // Channel width handle
          if (d.selected) {
            const parMidX = (pp1.x + pp2.x) / 2;
            const parMidY = (pp1.y + pp2.y) / 2;
            const widthHandle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            widthHandle.setAttribute('cx', String(parMidX));
            widthHandle.setAttribute('cy', String(parMidY));
            widthHandle.setAttribute('r', '5');
            widthHandle.setAttribute('fill', '#f59e0b');
            widthHandle.setAttribute('stroke', '#fff');
            widthHandle.setAttribute('stroke-width', '1.5');
            widthHandle.style.cursor = 'ns-resize';
            widthHandle.setAttribute('pointer-events', 'all');
            widthHandle.addEventListener('pointerdown', e => this.beginDrag(e, d.id, -1));
            g.appendChild(widthHandle);
          }
        }
        break;
      }

     
      case 'fibonacci': {
        if (d.points.length < 2) break;
        const p1 = this.px(d.points[0]);
        const p2 = this.px(d.points[1]);
        if (!p1 || !p2) break;

        const priceHi = Math.max(d.points[0].price, d.points[1].price);
        const priceLo = Math.min(d.points[0].price, d.points[1].price);
        const priceRange = priceHi - priceLo;
        const xLeft = Math.min(p1.x, p2.x);
        const xRight = Math.max(p1.x, p2.x);

        FIB_LEVELS.forEach(level => {
          const levelPrice = priceLo + priceRange * (1 - level);
          const yLevel = this.series!.priceToCoordinate(levelPrice);
          if (yLevel === null) return;

          const fibColor = FIB_COLORS[level.toString()] || color;
          const l = this.svgLine(xLeft - 200, yLevel, W + 200, yLevel, fibColor, 1, 'none');
          l.style.opacity = opacity;
          g.appendChild(l);

          // Level label
          const lbl = this.svgText(xRight + 4, yLevel - 3, `${level.toFixed(3)} (${levelPrice.toFixed(5)})`, fibColor, 10);
          g.appendChild(lbl);
        });

        // Diagonal reference line
        const diag = this.svgLine(p1.x, p1.y, p2.x, p2.y, '#888', 1, 'dashed');
        g.appendChild(diag);
        break;
      }

     
      case 'fib_extension': {
        if (d.points.length < 2) break;
        const p1 = this.px(d.points[0]);
        const p2 = this.px(d.points[1]);
        const p3 = d.points[2] ? this.px(d.points[2]) : null;
        if (!p1 || !p2) break;

        // Draw the AB segment
        g.appendChild(this.svgLine(p1.x, p1.y, p2.x, p2.y, color, lw, dash));

        if (p3) {
          // Extension levels from p3 using AB height
          const abDiff = d.points[1].price - d.points[0].price;
          const extLevels = [0, 0.382, 0.618, 1, 1.272, 1.618, 2, 2.618];

          extLevels.forEach(level => {
            const extPrice = d.points[2].price + abDiff * level;
            const yExt = this.series!.priceToCoordinate(extPrice);
            if (yExt === null) return;
            const l = this.svgLine(-200, yExt, W + 200, yExt, color, 1, level === 0 ? 'solid' : 'dashed');
            g.appendChild(l);
            g.appendChild(this.svgText(p3.x + 4, yExt - 3, level.toFixed(3), color, 10));
          });

          g.appendChild(this.svgLine(p2.x, p2.y, p3.x, p3.y, '#888', 1, 'dashed'));
        }
        break;
      }

      // ─── Measure ─────────────────────────────────────────────────
      case 'measure': {
        if (d.points.length < 2) break;
        const p1 = this.px(d.points[0]);
        const p2 = this.px(d.points[1]);
        if (!p1 || !p2) break;

        const minX = Math.min(p1.x, p2.x);
        const maxX = Math.max(p1.x, p2.x);
        const minY = Math.min(p1.y, p2.y);
        const maxY = Math.max(p1.y, p2.y);

        // Semi-transparent rectangle
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', String(minX));
        rect.setAttribute('y', String(minY));
        rect.setAttribute('width', String(maxX - minX));
        rect.setAttribute('height', String(maxY - minY));
        rect.setAttribute('fill', color);
        rect.setAttribute('fill-opacity', '0.1');
        rect.setAttribute('stroke', color);
        rect.setAttribute('stroke-width', '1');
        rect.setAttribute('stroke-dasharray', '4 2');
        g.appendChild(rect);

        // Diagonal measurement line
        g.appendChild(this.svgLine(p1.x, p1.y, p2.x, p2.y, color, 1, 'dashed'));

        const priceDiff = Math.abs(d.points[1].price - d.points[0].price);
        const pricePct = d.points[0].price !== 0
          ? ((d.points[1].price - d.points[0].price) / d.points[0].price * 100)
          : 0;
        const ts = this.chart!.timeScale();
        const l1 = ts.coordinateToLogical(p1.x);
        const l2 = ts.coordinateToLogical(p2.x);
        const bars = l1 !== null && l2 !== null ? Math.abs(Math.round(l2 - l1)) : 0;
        const labelText = `${bars} bars | ${priceDiff.toFixed(5)} pts | ${pricePct >= 0 ? '+' : ''}${pricePct.toFixed(2)}%`;

        const lbl = this.svgText(
          (p1.x + p2.x) / 2,
          minY - 6,
          labelText,
          color,
          11,
        );
        lbl.setAttribute('text-anchor', 'middle');
        lbl.setAttribute('filter', 'drop-shadow(0 0 3px rgba(0,0,0,0.9))');
        g.appendChild(lbl);
        break;
      }

      // ─── Rectangle ───────────────────────────────────────────────
      case 'rectangle': {
        if (d.points.length < 2) break;
        const p1 = this.px(d.points[0]);
        const p2 = this.px(d.points[1]);
        if (!p1 || !p2) break;

        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', String(Math.min(p1.x, p2.x)));
        rect.setAttribute('y', String(Math.min(p1.y, p2.y)));
        rect.setAttribute('width', String(Math.abs(p2.x - p1.x)));
        rect.setAttribute('height', String(Math.abs(p2.y - p1.y)));
        rect.setAttribute('stroke', color);
        rect.setAttribute('stroke-width', String(lw));
        rect.setAttribute('fill', color);
        rect.setAttribute('fill-opacity', '0.1');
        if (dash !== 'none') rect.setAttribute('stroke-dasharray', dash);
        rect.style.opacity = opacity;
        g.appendChild(rect);
        break;
      }

      // ─── Ellipse ─────────────────────────────────────────────────
      case 'ellipse': {
        if (d.points.length < 2) break;
        const p1 = this.px(d.points[0]);
        const p2 = this.px(d.points[1]);
        if (!p1 || !p2) break;

        const cx = (p1.x + p2.x) / 2;
        const cy = (p1.y + p2.y) / 2;
        const rx = Math.abs(p2.x - p1.x) / 2;
        const ry = Math.abs(p2.y - p1.y) / 2;

        const el = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
        el.setAttribute('cx', String(cx));
        el.setAttribute('cy', String(cy));
        el.setAttribute('rx', String(rx));
        el.setAttribute('ry', String(ry));
        el.setAttribute('stroke', color);
        el.setAttribute('stroke-width', String(lw));
        el.setAttribute('fill', color);
        el.setAttribute('fill-opacity', '0.1');
        el.style.opacity = opacity;
        g.appendChild(el);
        break;
      }

      // ─── Freehand ────────────────────────────────────────────────
      case 'freehand': {
        if (d.points.length < 2) break;
        const pts = d.points.map(p => this.px(p)).filter((p): p is { x: number; y: number } => p !== null);
        if (pts.length < 2) break;

        const pathData = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', pathData);
        path.setAttribute('stroke', color);
        path.setAttribute('stroke-width', String(lw));
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        path.style.opacity = opacity;
        g.appendChild(path);
        break;
      }

      // ─── Text ────────────────────────────────────────────────────
      case 'text': {
        if (d.points.length < 1 || !d.text) break;
        const p = this.px(d.points[0]);
        if (!p) break;

        // Background rect
        const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        const textLen = d.text.length * 7 + 10;
        bg.setAttribute('x', String(p.x));
        bg.setAttribute('y', String(p.y - 16));
        bg.setAttribute('width', String(textLen));
        bg.setAttribute('height', '20');
        bg.setAttribute('rx', '3');
        bg.setAttribute('fill', '#18181b');
        bg.setAttribute('fill-opacity', '0.85');
        g.appendChild(bg);

        g.appendChild(this.svgText(p.x + 5, p.y - 1, d.text, color, 12));
        break;
      }

      // ─── Callout ─────────────────────────────────────────────────
      case 'callout': {
        if (d.points.length < 2) break;
        const p1 = this.px(d.points[0]);
        const p2 = this.px(d.points[1]);
        if (!p1 || !p2) break;

        // Arrow line from p1 to box at p2
        g.appendChild(this.svgLine(p1.x, p1.y, p2.x, p2.y, color, 1, 'none'));

        const text = d.text || 'Label';
        const bw = text.length * 7 + 12;
        const bh = 22;
        const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        bg.setAttribute('x', String(p2.x - bw / 2));
        bg.setAttribute('y', String(p2.y - bh / 2));
        bg.setAttribute('width', String(bw));
        bg.setAttribute('height', String(bh));
        bg.setAttribute('rx', '4');
        bg.setAttribute('fill', '#18181b');
        bg.setAttribute('stroke', color);
        bg.setAttribute('stroke-width', '1');
        g.appendChild(bg);

        const t = this.svgText(p2.x, p2.y + 4, text, color, 12);
        t.setAttribute('text-anchor', 'middle');
        g.appendChild(t);
        break;
      }

      // ─── Stamp ───────────────────────────────────────────────────
      case 'stamp': {
        if (d.points.length < 1) break;
        const p = this.px(d.points[0]);
        if (!p) break;

        const sub = d.subtype || 'thumbsUp';
        const icon = STAMP_ICONS[sub];
        if (!icon) break;

        const size = icon.size;
        const iconColor = d.color || icon.color;

        if (icon.kind === 'label') {
          const labelW = 72;
          const labelH = 18;
          const labelX = icon.side === 'left' ? 2 : W - labelW - 2;
          const labelY = p.y - labelH / 2;

          const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          bg.setAttribute('x', String(labelX));
          bg.setAttribute('y', String(labelY));
          bg.setAttribute('width', String(labelW));
          bg.setAttribute('height', String(labelH));
          bg.setAttribute('rx', '3');
          bg.setAttribute('fill', icon.bg || iconColor);
          bg.style.opacity = opacity;
          if (!isPreview) {
            bg.setAttribute('pointer-events', 'all');
            bg.style.cursor = 'pointer';
            bg.addEventListener('pointerdown', e => this.beginDrag(e, d.id, 0));
            bg.addEventListener('contextmenu', e => this.onContextMenu(e, d.id));
          }
          g.appendChild(bg);

          const txt = this.svgText(labelX + labelW / 2, labelY + 12, d.points[0].price.toFixed(5), '#fff', 10);
          txt.setAttribute('text-anchor', 'middle');
          g.appendChild(txt);

          if (d.selected && !isPreview) {
            const sel = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            sel.setAttribute('x', String(labelX - 2));
            sel.setAttribute('y', String(labelY - 2));
            sel.setAttribute('width', String(labelW + 4));
            sel.setAttribute('height', String(labelH + 4));
            sel.setAttribute('rx', '4');
            sel.setAttribute('fill', 'none');
            sel.setAttribute('stroke', '#fff');
            sel.setAttribute('stroke-width', '2');
            g.appendChild(sel);
          }
        } else {
          const scale = size / 24;
          const gIcon = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          gIcon.setAttribute('transform', `translate(${p.x - size / 2}, ${p.y - size / 2})`);

          const circ = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          circ.setAttribute('cx', String(size / 2));
          circ.setAttribute('cy', String(size / 2));
          circ.setAttribute('r', String(size / 2 + 2));
          circ.setAttribute('fill', 'rgba(0,0,0,0.35)');
          gIcon.appendChild(circ);

          if (icon.path) {
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', icon.path);
            path.setAttribute('transform', `scale(${scale})`);
            if (icon.filled) {
              path.setAttribute('fill', iconColor);
              path.setAttribute('stroke', 'none');
            } else {
              path.setAttribute('fill', 'none');
              path.setAttribute('stroke', iconColor);
              path.setAttribute('stroke-width', String(2 / scale));
              path.setAttribute('stroke-linecap', 'round');
              path.setAttribute('stroke-linejoin', 'round');
            }
            gIcon.appendChild(path);
          }

          if (d.selected && !isPreview) {
            const sel = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            sel.setAttribute('cx', String(size / 2));
            sel.setAttribute('cy', String(size / 2));
            sel.setAttribute('r', String(size / 2 + 4));
            sel.setAttribute('fill', 'none');
            sel.setAttribute('stroke', '#fff');
            sel.setAttribute('stroke-width', '2');
            gIcon.appendChild(sel);
          }

          if (!isPreview) {
            const hit = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            hit.setAttribute('x', '0');
            hit.setAttribute('y', '0');
            hit.setAttribute('width', String(size));
            hit.setAttribute('height', String(size));
            hit.setAttribute('fill', 'transparent');
            hit.setAttribute('pointer-events', 'all');
            hit.style.cursor = 'pointer';
            hit.addEventListener('pointerdown', e => this.beginDrag(e, d.id, 0));
            hit.addEventListener('contextmenu', e => this.onContextMenu(e, d.id));
            gIcon.appendChild(hit);
          }

          g.appendChild(gIcon);
        }
        break;
      }

      default: break;
    }

    // ─── Selection handles & drag on completed drawings ──────────
    // Channel handles are rendered inline in the channel case above (3 handles: anchor1, anchor2, width)
    if (!isPreview && d.selected && Array.isArray(d.points) && d.type !== 'channel') {
      const trendTool = getTrendLineToolFromDrawing(d.type, d.subtype);
      if (trendTool) {
        const plotW = Math.max(0, W - (this.chart?.priceScale('right').width() ?? 0));
        const plotH = Math.max(0, H - (this.chart?.timeScale().height() ?? 0));
        const hasTwoPointCoordinates = trendTool.drawingType === 'trendline'
          && trendTool.requiredPoints === 2;

        d.points.forEach((point, index) => {
          const screenPoint = this.px(point);
          if (!screenPoint) return;

          if (trendTool.id === 'horizontal_line') {
            this.appendTrendSelectionHandle(
              g,
              d,
              { x: Math.max(5, plotW - 7), y: screenPoint.y },
              0,
              `selection-anchor-${index + 1}`,
              'square',
            );
            this.appendDrawingAddTextPrompt(
              g,
              Math.max(8, plotW - 76),
              screenPoint.y - 8,
              color,
            );
            return;
          }

          if (trendTool.id === 'vertical_line') {
            this.appendTrendSelectionHandle(
              g,
              d,
              { x: screenPoint.x, y: Math.max(5, plotH - 7) },
              0,
              `selection-anchor-${index + 1}`,
              'square',
            );
            this.appendDrawingAddTextPrompt(
              g,
              screenPoint.x + 8,
              Math.max(14, plotH - 28),
              color,
              -90,
            );
            return;
          }

          this.appendTrendSelectionHandle(
            g,
            d,
            screenPoint,
            index,
            `selection-anchor-${index + 1}`,
          );

          if (hasTwoPointCoordinates) {
            this.appendPriceScaleLabel(
              g,
              plotW,
              screenPoint.y,
              point.price,
              color,
              `endpoint-${index + 1}-price-scale-label`,
            );
            this.appendTimeScaleLabel(
              g,
              screenPoint.x,
              plotH,
              point.time,
              color,
              `endpoint-${index + 1}-time-scale-label`,
            );
          }
        });
      } else {
        d.points.forEach((point, index) => {
          const screenPoint = this.px(point);
          if (!screenPoint) return;
          const handle = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          handle.setAttribute('x', String(screenPoint.x - 4));
          handle.setAttribute('y', String(screenPoint.y - 4));
          handle.setAttribute('width', '8');
          handle.setAttribute('height', '8');
          handle.setAttribute('fill', '#ef4444');
          handle.setAttribute('stroke', '#fff');
          handle.setAttribute('stroke-width', '1');
          handle.style.cursor = 'crosshair';
          handle.setAttribute('pointer-events', 'all');
          handle.addEventListener('pointerdown', event => this.beginDrag(event, d.id, index));
          g.appendChild(handle);
        });
      }
    }

    // Channel-specific anchor handles (rendered separately so they appear on top of hit zones)
    if (!isPreview && d.selected && d.type === 'channel' && d.points.length >= 2) {
      const trendTool = getTrendLineToolFromDrawing(d.type, d.subtype);
      if (trendTool && d.subtype === 'regression_trend') {
        const plotW = Math.max(0, W - (this.chart?.priceScale('right').width() ?? 0));
        const plotH = Math.max(0, H - (this.chart?.timeScale().height() ?? 0));
        const regression = this.getRegressionSegments(d, plotW, plotH);
        if (regression) {
          this.appendTrendSelectionHandle(g, d, regression.center.start, 0, 'selection-anchor-start');
          this.appendTrendSelectionHandle(g, d, regression.center.end, 1, 'selection-anchor-end');
          this.appendTrendSelectionHandle(g, d, regression.upper.start, 0, 'selection-anchor-upper-start');
          this.appendTrendSelectionHandle(g, d, regression.upper.end, 1, 'selection-anchor-upper-end');
        }
      } else if (
        trendTool
        && (
          d.subtype === 'parallel_channel'
          || d.subtype === 'flat_top_bottom'
          || d.subtype === 'disjoint_channel'
        )
        && d.points.length >= 3
      ) {
        const first = this.px(d.points[0]);
        const second = this.px(d.points[1]);
        const rawThird = this.px(d.points[2]);
        if (first && second && rawThird) {
          let controlPoint = rawThird;
          if (d.subtype === 'parallel_channel' && Number.isFinite(d.channelOffset)) {
            const offsetY = this.series?.priceToCoordinate(
              d.points[0].price + (d.channelOffset as number),
            );
            if (offsetY !== null && offsetY !== undefined) {
              controlPoint = { x: first.x, y: offsetY };
            }
          }

          const channel = createChannelGeometry(
            d.subtype,
            first,
            second,
            controlPoint,
            { midpointRatio: d.channelMidpointRatio },
          );
          if (channel) {
            if (d.subtype === 'parallel_channel') {
              this.appendTrendSelectionHandle(g, d, channel.baseline.start, 0, 'selection-anchor-baseline-start');
              this.appendTrendSelectionHandle(g, d, channel.baseline.end, 1, 'selection-anchor-baseline-end');
              this.appendTrendSelectionHandle(g, d, channel.boundary.start, -1, 'selection-anchor-boundary-start');
              this.appendTrendSelectionHandle(g, d, channel.boundary.end, -1, 'selection-anchor-boundary-end');
              this.appendTrendSelectionHandle(
                g,
                d,
                this.segmentMidpoint(channel.baseline),
                null,
                'selection-anchor-baseline-midpoint',
                'square',
              );
              this.appendTrendSelectionHandle(
                g,
                d,
                this.segmentMidpoint(channel.boundary),
                -1,
                'selection-anchor-boundary-midpoint',
                'square',
              );
            } else if (d.subtype === 'flat_top_bottom') {
              this.appendTrendSelectionHandle(g, d, channel.baseline.start, 0, 'selection-anchor-baseline-start');
              this.appendTrendSelectionHandle(g, d, channel.baseline.end, 1, 'selection-anchor-baseline-end');
              this.appendTrendSelectionHandle(g, d, channel.boundary.start, 2, 'selection-anchor-boundary-start');
              this.appendTrendSelectionHandle(g, d, channel.boundary.end, 2, 'selection-anchor-boundary-end');
            } else {
              this.appendTrendSelectionHandle(g, d, channel.baseline.start, 0, 'selection-anchor-baseline-start');
              this.appendTrendSelectionHandle(g, d, channel.baseline.end, 1, 'selection-anchor-baseline-end');
              this.appendTrendSelectionHandle(g, d, rawThird, 2, 'selection-anchor-source-third');
              this.appendTrendSelectionHandle(
                g,
                d,
                channel.boundary.end,
                2,
                'selection-anchor-derived-boundary-end',
                'square',
              );
            }
          }
        }
      } else if (trendTool) {
        const plotW = Math.max(0, W - (this.chart?.priceScale('right').width() ?? 0));
        const plotH = Math.max(0, H - (this.chart?.timeScale().height() ?? 0));
        d.points.forEach((point, index) => {
          const screenPoint = this.px(point);
          if (!screenPoint) return;
          this.appendTrendSelectionHandle(
            g,
            d,
            screenPoint,
            index,
            `selection-anchor-${index + 1}`,
          );
          this.appendPriceScaleLabel(
            g,
            plotW,
            screenPoint.y,
            point.price,
            color,
            `anchor-${index + 1}-price-scale-label`,
          );
          this.appendTimeScaleLabel(
            g,
            screenPoint.x,
            plotH,
            point.time,
            color,
            `anchor-${index + 1}-time-scale-label`,
          );
        });
      } else {
        d.points.forEach((point, index) => {
          const screenPoint = this.px(point);
          if (!screenPoint) return;
          const handle = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          handle.setAttribute('x', String(screenPoint.x - 4));
          handle.setAttribute('y', String(screenPoint.y - 4));
          handle.setAttribute('width', '8');
          handle.setAttribute('height', '8');
          handle.setAttribute('fill', '#ef4444');
          handle.setAttribute('stroke', '#fff');
          handle.setAttribute('stroke-width', '1');
          handle.style.cursor = 'crosshair';
          handle.setAttribute('pointer-events', 'all');
          handle.addEventListener('pointerdown', event => this.beginDrag(event, d.id, index));
          g.appendChild(handle);
        });
      }
    }

    // Make whole group clickable (select on click when not in drawing mode)
    if (!isPreview) {
      g.setAttribute('pointer-events', 'auto');
      g.style.cursor = 'pointer';
      g.addEventListener('click', e => {
        e.stopPropagation();
        this.activateContextFromEventTarget(e.target);
        this.selectDrawing(d.id, e.ctrlKey || e.metaKey);
      });
      g.addEventListener('contextmenu', e => this.onContextMenu(e, d.id));
    }

    svg.appendChild(g);
  }

  // ──────────────────────────────────────────────
  // SVG Element Helpers
  // ──────────────────────────────────────────────
  private svgLine(
    x1: number, y1: number, x2: number, y2: number,
    stroke: string, sw: number, dash: string,
  ): SVGLineElement {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    el.setAttribute('x1', String(x1));
    el.setAttribute('y1', String(y1));
    el.setAttribute('x2', String(x2));
    el.setAttribute('y2', String(y2));
    el.setAttribute('stroke', stroke);
    el.setAttribute('stroke-width', String(sw));
    if (dash !== 'none') el.setAttribute('stroke-dasharray', dash);
    el.setAttribute('stroke-linecap', 'round');
    return el;
  }

  private svgText(x: number, y: number, text: string, fill: string, size: number): SVGTextElement {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    el.setAttribute('x', String(x));
    el.setAttribute('y', String(y));
    el.setAttribute('fill', fill);
    el.setAttribute('font-size', String(size));
    el.setAttribute('font-family', 'monospace, sans-serif');
    el.setAttribute('pointer-events', 'none');
    el.textContent = text;
    return el;
  }

  private getSeriesPriceFormat(): { precision: number; minMove: number } {
    const format = (this.series?.options?.() as any)?.priceFormat;
    const explicitPrecision = Number(format?.precision);
    const explicitMinMove = Number(format?.minMove);
    const minMove = Number.isFinite(explicitMinMove) && explicitMinMove > 0
      ? explicitMinMove
      : 1;
    const derivedPrecision = minMove >= 1
      ? 0
      : Math.min(12, Math.max(0, Math.ceil(-Math.log10(minMove) - 1e-10)));
    const precision = Number.isFinite(explicitPrecision)
      ? Math.min(12, Math.max(0, Math.trunc(explicitPrecision)))
      : derivedPrecision;
    return { precision, minMove };
  }

  private formatPrice(value: number): string {
    const { precision } = this.getSeriesPriceFormat();
    try {
      const formatter = (this.series as any)?.priceFormatter?.();
      if (formatter?.format) return formatter.format(value);
    } catch {
      // Lightweight Charts can dispose the formatter between a panel teardown
      // and its final overlay frame. The runtime price format remains safe.
    }
    return value.toLocaleString(undefined, {
      minimumFractionDigits: precision,
      maximumFractionDigits: precision,
    });
  }

  private formatTimeScaleValue(timestampSeconds: number): string {
    const date = new Date(timestampSeconds * 1000);
    if (Number.isNaN(date.getTime())) return '';
    const parts = new Intl.DateTimeFormat('en-GB', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const value = (type: Intl.DateTimeFormatPartTypes): string =>
      parts.find(part => part.type === type)?.value ?? '';
    const weekday = value('weekday');
    const day = value('day');
    const month = value('month');
    const year = value('year');
    const hour = value('hour');
    const minute = value('minute');
    if (![weekday, day, month, year, hour, minute].every(Boolean)) return '';
    return `${weekday} ${day} ${month} '${year} ${hour}:${minute}`;
  }

  private getThemeToken(name: string, fallback: string): string {
    const host = this.overlayContainer || document.documentElement;
    const value = window.getComputedStyle(host).getPropertyValue(name).trim()
      || window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  }

  private appendPriceScaleLabel(
    group: SVGGElement,
    plotWidth: number,
    y: number,
    price: number,
    accent: string,
    role = 'price-scale-label',
  ): void {
    const value = this.formatPrice(price);
    const scaleWidth = Math.max(42, this.chart?.priceScale('right').width() ?? 0);
    const labelWidth = Math.min(scaleWidth, Math.max(48, value.length * 6.4 + 12));
    const labelHeight = 18;
    const top = y - labelHeight / 2;
    const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    background.setAttribute('x', String(plotWidth));
    background.setAttribute('y', String(top));
    background.setAttribute('width', String(labelWidth));
    background.setAttribute('height', String(labelHeight));
    background.setAttribute('rx', '2');
    background.setAttribute('fill', accent);
    background.setAttribute('data-geometry-role', role);
    background.setAttribute('pointer-events', 'none');
    group.appendChild(background);

    const label = this.svgText(plotWidth + labelWidth / 2, top + 12.5, value, '#ffffff', 10);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('font-family', 'var(--font-mono), monospace');
    label.setAttribute('data-geometry-role', `${role}-text`);
    group.appendChild(label);
  }

  private appendTimeScaleLabel(
    group: SVGGElement,
    x: number,
    plotHeight: number,
    timestampSeconds: number,
    accent: string,
    role = 'time-scale-label',
  ): void {
    const value = this.formatTimeScaleValue(timestampSeconds);
    if (!value) return;
    const width = Math.max(76, value.length * 6.2 + 12);
    const left = Math.max(0, Math.min(x - width / 2, Math.max(0, (this.overlayContainer?.clientWidth ?? x + width) - width)));
    const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    background.setAttribute('x', String(left));
    background.setAttribute('y', String(plotHeight));
    background.setAttribute('width', String(width));
    background.setAttribute('height', '18');
    background.setAttribute('rx', '2');
    background.setAttribute('fill', accent);
    background.setAttribute('data-geometry-role', role);
    background.setAttribute('pointer-events', 'none');
    group.appendChild(background);

    const label = this.svgText(left + width / 2, plotHeight + 12.5, value, '#ffffff', 10);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('font-family', 'var(--font-mono), monospace');
    label.setAttribute('data-geometry-role', `${role}-text`);
    group.appendChild(label);
  }

  private segmentMidpoint(segment: ScreenSegment): { x: number; y: number } {
    return {
      x: (segment.start.x + segment.end.x) / 2,
      y: (segment.start.y + segment.end.y) / 2,
    };
  }

  private appendDrawingAddTextPrompt(
    group: SVGGElement,
    x: number,
    y: number,
    accent: string,
    rotation = 0,
  ): void {
    const label = this.svgText(x, y, '+ Add text', accent, 10);
    label.setAttribute('font-family', 'var(--font-sans), sans-serif');
    label.setAttribute('font-weight', '600');
    label.setAttribute('data-geometry-role', 'drawing-add-text-prompt');
    if (rotation !== 0) label.setAttribute('transform', `rotate(${rotation} ${x} ${y})`);
    group.appendChild(label);
  }

  private appendTrendSelectionHandle(
    group: SVGGElement,
    drawing: Drawing,
    point: { x: number; y: number },
    nodeIndex: number | null,
    role: string,
    shape: 'circle' | 'square' = 'circle',
  ): void {
    const handle = shape === 'circle'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'circle')
      : document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    if (shape === 'circle') {
      handle.setAttribute('cx', String(point.x));
      handle.setAttribute('cy', String(point.y));
      handle.setAttribute('r', '5');
    } else {
      handle.setAttribute('x', String(point.x - 5));
      handle.setAttribute('y', String(point.y - 5));
      handle.setAttribute('width', '10');
      handle.setAttribute('height', '10');
      handle.setAttribute('rx', '1');
    }
    handle.setAttribute('fill', this.getThemeToken('--bg-primary', '#0d0d11'));
    handle.setAttribute('stroke', drawing.color || this.getThemeToken('--drawing-tool-accent', '#2962ff'));
    handle.setAttribute('stroke-width', '2');
    handle.setAttribute('data-geometry-role', role);
    handle.setAttribute('pointer-events', 'all');
    handle.style.cursor = nodeIndex === null ? 'move' : 'crosshair';
    handle.addEventListener('pointerdown', event => this.beginDrag(event, drawing.id, nodeIndex));
    handle.addEventListener('contextmenu', event => this.onContextMenu(event, drawing.id));
    group.appendChild(handle);
  }

  // ──────────────────────────────────────────────
  // Drag Handling
  // ──────────────────────────────────────────────
  private appendInfoBadge(
    group: SVGGElement,
    x: number,
    y: number,
    value: string,
    accent: string,
    centered = false,
  ): void {
    const width = Math.max(44, value.length * 6.2 + 14);
    const left = centered ? x - width / 2 : x;
    const top = y - 17;
    const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    background.setAttribute('x', String(left));
    background.setAttribute('y', String(top));
    background.setAttribute('width', String(width));
    background.setAttribute('height', '20');
    background.setAttribute('rx', '4');
    background.setAttribute('fill', '#17181c');
    background.setAttribute('fill-opacity', '0.94');
    background.setAttribute('stroke', accent);
    background.setAttribute('stroke-opacity', '0.75');
    background.setAttribute('pointer-events', 'none');
    group.appendChild(background);

    const label = this.svgText(centered ? x : left + 7, y - 3, value, '#f5f7fb', 10);
    if (centered) label.setAttribute('text-anchor', 'middle');
    group.appendChild(label);
  }

  private appendInfoLinePanel(
    group: SVGGElement,
    start: { x: number; y: number },
    end: { x: number; y: number },
    display: InfoLineMetricDisplay,
    plotWidth: number,
    plotHeight: number,
  ): void {
    let firstRow = display.priceChange;
    if (display.percentChange !== null) firstRow += ` (${display.percentChange}%)`;
    if (display.priceSteps !== null) firstRow += `, ${display.priceSteps}`;
    const rows = [
      firstRow,
      `${display.bars} (${display.elapsed}), distance: ${display.pixelDistance}`,
      display.angle,
    ];
    const width = Math.max(190, Math.min(270, Math.max(...rows.map(row => row.length)) * 6.25 + 24));
    const rowHeight = 26;
    const height = rows.length * rowHeight + 8;
    const midpointX = (start.x + end.x) / 2;
    const midpointY = (start.y + end.y) / 2;
    const left = Math.max(4, Math.min(midpointX + 12, Math.max(4, plotWidth - width - 4)));
    const preferredTop = midpointY + 13;
    const top = preferredTop + height <= plotHeight - 4
      ? preferredTop
      : Math.max(4, midpointY - height - 13);

    const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    background.setAttribute('x', String(left));
    background.setAttribute('y', String(top));
    background.setAttribute('width', String(width));
    background.setAttribute('height', String(height));
    background.setAttribute('rx', '4');
    background.setAttribute('fill', this.getThemeToken('--bg-elevated', '#2a2a30'));
    background.setAttribute('fill-opacity', '0.96');
    background.setAttribute('data-geometry-role', 'measurement-panel');
    background.setAttribute('pointer-events', 'none');
    group.appendChild(background);

    rows.forEach((row, index) => {
      if (index > 0) {
        const separator = this.svgLine(
          left,
          top + (index * rowHeight) + 4,
          left + width,
          top + (index * rowHeight) + 4,
          this.getThemeToken('--border-secondary', '#3d3d43'),
          1,
          'none',
        );
        separator.setAttribute('data-geometry-role', 'measurement-separator');
        separator.setAttribute('pointer-events', 'none');
        group.appendChild(separator);
      }
      const label = this.svgText(
        left + 12,
        top + 19 + (index * rowHeight),
        row,
        this.getThemeToken('--text-primary', '#f5f7fb'),
        11,
      );
      label.setAttribute('font-family', 'var(--font-sans), sans-serif');
      label.setAttribute('font-weight', '600');
      label.setAttribute('data-geometry-role', `measurement-row-${index + 1}`);
      group.appendChild(label);
    });
  }

  private appendInteractiveSegment(
    group: SVGGElement,
    drawing: Drawing,
    segment: ScreenSegment,
    color: string,
    lineWidth: number,
    dash: string,
    opacity: string,
    isPreview: boolean,
    cursor = 'move',
    role?: string,
  ): void {
    const line = this.svgLine(
      segment.start.x,
      segment.start.y,
      segment.end.x,
      segment.end.y,
      color,
      lineWidth,
      dash,
    );
    line.style.opacity = opacity;
    if (role) line.setAttribute('data-geometry-role', role);
    group.appendChild(line);

    if (isPreview) return;
    const hit = this.svgLine(
      segment.start.x,
      segment.start.y,
      segment.end.x,
      segment.end.y,
      'transparent',
      14,
      'none',
    );
    hit.setAttribute('pointer-events', 'stroke');
    if (role) hit.setAttribute('data-geometry-role', `${role}-hit`);
    hit.style.cursor = cursor;
    hit.addEventListener('pointerdown', event => this.beginDrag(event, drawing.id, null));
    hit.addEventListener('contextmenu', event => this.onContextMenu(event, drawing.id));
    group.appendChild(hit);
  }

  private appendChannelFill(
    group: SVGGElement,
    first: ScreenSegment,
    second: ScreenSegment,
    color: string,
    opacity: string,
  ): SVGPolygonElement {
    const fill = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    fill.setAttribute(
      'points',
      `${first.start.x},${first.start.y} ${first.end.x},${first.end.y} ${second.end.x},${second.end.y} ${second.start.x},${second.start.y}`,
    );
    fill.setAttribute('fill', color);
    fill.setAttribute('fill-opacity', '0.075');
    fill.style.opacity = opacity;
    fill.setAttribute('pointer-events', 'none');
    group.appendChild(fill);
    return fill;
  }

  private makeChannelFillInteractive(
    fill: SVGPolygonElement,
    drawing: Drawing,
    isPreview: boolean,
    role = 'channel-fill',
  ): void {
    fill.setAttribute('data-geometry-role', role);
    if (isPreview) return;
    fill.setAttribute('pointer-events', 'all');
    fill.style.cursor = 'move';
    fill.addEventListener('pointerdown', event => this.beginDrag(event, drawing.id, null));
    fill.addEventListener('contextmenu', event => this.onContextMenu(event, drawing.id));
  }

  private appendInteractivePolygon(
    group: SVGGElement,
    drawing: Drawing,
    points: readonly { x: number; y: number }[],
    color: string,
    fillOpacity: number,
    opacity: string,
    isPreview: boolean,
    role: string,
  ): SVGPolygonElement {
    const fill = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    fill.setAttribute('points', points.map(point => `${point.x},${point.y}`).join(' '));
    fill.setAttribute('fill', color);
    fill.setAttribute('fill-opacity', String(fillOpacity));
    fill.style.opacity = opacity;
    group.appendChild(fill);
    this.makeChannelFillInteractive(fill, drawing, isPreview, role);
    return fill;
  }

  private renderTrendChannelVariant(
    group: SVGGElement,
    drawing: Drawing,
    width: number,
    height: number,
    color: string,
    lineWidth: number,
    dash: string,
    opacity: string,
    isPreview: boolean,
  ): boolean {
    const subtype = drawing.subtype;
    const supported = [
      'parallel_channel',
      'regression_trend',
      'flat_top_bottom',
      'disjoint_channel',
      'pitchfork',
      'schiff_pitchfork',
      'modified_schiff_pitchfork',
      'inside_pitchfork',
    ];
    if (!subtype || !supported.includes(subtype)) return false;

    const plotW = Math.max(0, width - (this.chart?.priceScale('right').width() ?? 0));
    const plotH = Math.max(0, height - (this.chart?.timeScale().height() ?? 0));
    const screenPoints = drawing.points.map(point => this.px(point));
    const first = screenPoints[0];
    const second = screenPoints[1];
    const third = screenPoints[2];
    if (!first) return true;

    if (subtype === 'regression_trend') {
      if (!second) return true;
      const regression = this.getRegressionSegments(drawing, plotW, plotH);
      if (!regression) return true;
      const lossColor = this.getThemeToken('--color-loss', '#ff4d4f');
      this.appendInteractivePolygon(
        group,
        drawing,
        [
          regression.upper.start,
          regression.upper.end,
          regression.center.end,
          regression.center.start,
        ],
        color,
        0.18,
        opacity,
        isPreview,
        'regression-upper-fill',
      );
      this.appendInteractivePolygon(
        group,
        drawing,
        [
          regression.center.start,
          regression.center.end,
          regression.lower.end,
          regression.lower.start,
        ],
        lossColor,
        0.2,
        opacity,
        isPreview,
        'regression-lower-fill',
      );
      this.appendInteractiveSegment(
        group,
        drawing,
        regression.upper,
        color,
        lineWidth,
        dash,
        opacity,
        isPreview,
        'move',
        'regression-upper',
      );
      this.appendInteractiveSegment(
        group,
        drawing,
        regression.lower,
        color,
        lineWidth,
        dash,
        opacity,
        isPreview,
        'move',
        'regression-lower',
      );
      this.appendInteractiveSegment(
        group,
        drawing,
        regression.center,
        lossColor,
        Math.max(1, lineWidth - 1),
        '5 4',
        opacity,
        isPreview,
        'move',
        'regression-center',
      );
      if (drawing.showRegressionPearson !== false && regression.pearsonCorrelation !== null) {
        const pearson = this.svgText(
          regression.center.start.x + 4,
          Math.max(regression.upper.start.y, regression.lower.start.y) + 18,
          `Pearson's R = ${regression.pearsonCorrelation.toFixed(6)}`,
          color,
          10,
        );
        pearson.setAttribute('font-family', 'var(--font-mono), monospace');
        pearson.setAttribute('data-geometry-role', 'regression-pearson');
        group.appendChild(pearson);
      }
      return true;
    }

    if (!second) return true;
    const baseline = clipLineToViewport(first, second, plotW, plotH, 'segment')
      ?? { start: first, end: second };

    if (!third) {
      this.appendInteractiveSegment(group, drawing, baseline, color, lineWidth, dash, opacity, isPreview);
      return true;
    }

    if (
      subtype === 'parallel_channel'
      || subtype === 'flat_top_bottom'
      || subtype === 'disjoint_channel'
    ) {
      let controlPoint = third;
      if (
        subtype === 'parallel_channel'
        && !isPreview
        && Number.isFinite(drawing.channelOffset)
      ) {
        const offsetY = this.series!.priceToCoordinate(
          drawing.points[0].price + (drawing.channelOffset as number),
        );
        if (offsetY !== null) controlPoint = { x: first.x, y: offsetY };
      }
      const channel = createChannelGeometry(subtype, first, second, controlPoint, {
        midpointRatio: drawing.channelMidpointRatio,
      });
      if (!channel) return true;
      const channelFill = this.appendChannelFill(
        group,
        channel.baseline,
        channel.boundary,
        color,
        opacity,
      );
      this.makeChannelFillInteractive(channelFill, drawing, isPreview);
      this.appendInteractiveSegment(
        group,
        drawing,
        channel.baseline,
        color,
        lineWidth,
        dash,
        opacity,
        isPreview,
        'move',
        'channel-baseline',
      );
      this.appendInteractiveSegment(
        group,
        drawing,
        channel.boundary,
        color,
        lineWidth,
        dash,
        opacity,
        isPreview,
        'move',
        'channel-boundary',
      );
      if (subtype === 'parallel_channel') {
        this.appendInteractiveSegment(
          group,
          drawing,
          channel.midpoint,
          color,
          1,
          '4 4',
          opacity,
          isPreview,
          'move',
          'channel-middle-level',
        );
      }
      return true;
    }

    const pitchfork = createPitchforkLevels(
      first,
      second,
      third,
      plotW,
      plotH,
      subtype as 'pitchfork' | 'schiff_pitchfork' | 'modified_schiff_pitchfork' | 'inside_pitchfork',
      drawing.pitchforkLevels,
    );
    if (!pitchfork) return true;

    const lossColor = this.getThemeToken('--color-loss', '#ff4d4f');
    const profitColor = this.getThemeToken('--color-profit', '#00c896');
    pitchfork.bands.forEach((band: PitchforkBand) => {
      const bandColor = band.outerRatio <= 0.5 ? profitColor : color;
      this.appendInteractivePolygon(
        group,
        drawing,
        band.polygon,
        bandColor,
        0.105,
        opacity,
        isPreview,
        `${band.role}-${band.innerRatio}-${band.outerRatio}`,
      );
    });

    const constructionSegments: ScreenSegment[] = subtype === 'pitchfork'
      ? [{ start: second, end: third }]
      : [
        { start: first, end: second },
        { start: second, end: third },
      ];
    constructionSegments.forEach((segment, index) => {
      const construction = this.svgLine(
        segment.start.x,
        segment.start.y,
        segment.end.x,
        segment.end.y,
        lossColor,
        1,
        'none',
      );
      construction.setAttribute('data-geometry-role', `pitchfork-construction-${index + 1}`);
      construction.style.opacity = isPreview ? '0.45' : '0.75';
      group.appendChild(construction);
    });

    pitchfork.rays.forEach((ray: PitchforkRay) => {
      const isMedian = ray.role === 'median';
      const rayColor = isMedian
        ? lossColor
        : ray.ratio <= 0.5
          ? profitColor
          : color;
      this.appendInteractiveSegment(
        group,
        drawing,
        ray.segment,
        rayColor,
        isMedian ? Math.max(1, lineWidth - 1) : lineWidth,
        isMedian ? 'none' : dash,
        opacity,
        isPreview,
        'move',
        `pitchfork-${ray.role}-${ray.ratio}`,
      );
    });
    return true;
  }

  private getRegressionSegments(
    drawing: Drawing,
    _width: number,
    _height: number,
  ): {
    center: ScreenSegment;
    upper: ScreenSegment;
    lower: ScreenSegment;
    pearsonCorrelation: number | null;
    sampleCount: number;
  } | null {
    if (drawing.points.length < 2) return null;
    const anchorA = this.px(drawing.points[0]);
    const anchorB = this.px(drawing.points[1]);
    if (!anchorA || !anchorB) return null;

    let rawData: any[] = [];
    try {
      const context = this.activeContainer
        ? this.chartContexts.get(this.activeContainer)
        : undefined;
      const data = context?.seriesDataProvider?.() ?? (this.series as any)?.data?.();
      if (Array.isArray(data)) rawData = data;
    } catch {
      return null;
    }

    const minTime = Math.min(drawing.points[0].time, drawing.points[1].time);
    const maxTime = Math.max(drawing.points[0].time, drawing.points[1].time);
    const source = drawing.regressionSource ?? 'close';
    const selectedSamples = rawData
      .map((item) => {
        const time = typeof item?.time === 'number' ? item.time : Number.NaN;
        let value: number = Number.NaN;
        if (source === 'hl2') {
          value = typeof item?.high === 'number' && typeof item?.low === 'number'
            ? (item.high + item.low) / 2
            : Number.NaN;
        } else if (typeof item?.[source] === 'number') {
          value = item[source];
        } else if (typeof item?.value === 'number') {
          value = item.value;
        }
        return { time, value };
      })
      .filter((item) => Number.isFinite(item.time) && Number.isFinite(item.value) && item.time >= minTime && item.time <= maxTime)
      .sort((a, b) => a.time - b.time);

    if (selectedSamples.length < 2) return null;

    const calculated = calculateRegressionTrend(
      selectedSamples.map((sample, index) => ({ x: index, value: sample.value })),
      {
        upperDeviationMultiplier: drawing.regressionUpperDeviation ?? 2,
        lowerDeviationMultiplier: drawing.regressionLowerDeviation ?? 2,
      },
    );
    if (!calculated) return null;

    const startX = this.chart!.timeScale().timeToCoordinate(selectedSamples[0].time as any) ?? anchorA.x;
    const endX = this.chart!.timeScale().timeToCoordinate(
      selectedSamples[selectedSamples.length - 1].time as any,
    ) ?? anchorB.x;
    const startY = this.series!.priceToCoordinate(calculated.center.start.value);
    const endY = this.series!.priceToCoordinate(calculated.center.end.value);
    const upperStartY = this.series!.priceToCoordinate(calculated.upper.start.value);
    const upperEndY = this.series!.priceToCoordinate(calculated.upper.end.value);
    const lowerStartY = this.series!.priceToCoordinate(calculated.lower.start.value);
    const lowerEndY = this.series!.priceToCoordinate(calculated.lower.end.value);
    if ([startY, endY, upperStartY, upperEndY, lowerStartY, lowerEndY].some((value) => value === null)) {
      return null;
    }

    return {
      center: { start: { x: startX, y: startY! }, end: { x: endX, y: endY! } },
      upper: { start: { x: startX, y: upperStartY! }, end: { x: endX, y: upperEndY! } },
      lower: { start: { x: startX, y: lowerStartY! }, end: { x: endX, y: lowerEndY! } },
      pearsonCorrelation: calculated.pearsonCorrelation,
      sampleCount: calculated.sampleCount,
    };
  }

  private beginDrag(e: PointerEvent, id: string, nodeIndex: number | null): void {
    e.stopPropagation();
    e.preventDefault();
    const context = this.activateContextFromEventTarget(e.target);

    const drawing = this.drawings.find(d => d.id === id);
    if (!drawing || drawing.locked) return;

    this.selectDrawing(id);
    this.draggingId = id;
    this.draggingOwner = context ? this.identityForContext(context) : this.currentContextIdentity;
    this.draggingNodeIndex = nodeIndex;
    this.dragStartX = e.clientX;
    this.dragStartY = e.clientY;
    this.dragInitialPoints = JSON.parse(JSON.stringify(drawing.points));
    this.dragInitialDrawingCopy = JSON.parse(JSON.stringify(drawing));
    this.draggingScrollLockCallbacks = this.draggingOwner
      ? (this.scrollLockCallbacksByContext.get(this.draggingOwner.contextId) || null)
      : null;

    this.draggingScrollLockCallbacks?.lock();
    try { (e.target as Element).setPointerCapture(e.pointerId); } catch { }
  }

  private resetDragState(): void {
    this.draggingId = null;
    this.draggingOwner = null;
    this.draggingNodeIndex = null;
    this.dragInitialPoints = [];
    this.dragInitialDrawingCopy = null;
    this.draggingScrollLockCallbacks = null;
  }

  private onGlobalPointerMove = (e: PointerEvent): void => {
    this.activateDrawingOwner(this.draggingOwner);
    if (!this.draggingId || !this.chart || !this.series) return;
    const drawing = this.drawings.find(d => d.id === this.draggingId);
    if (!drawing) return;

    const dx = e.clientX - this.dragStartX;
    const dy = e.clientY - this.dragStartY;

    // ── Channel parallel-offset drag (sentinel nodeIndex = -1) ─────────
    if (this.draggingNodeIndex === -1 && drawing.type === 'channel') {
      // Only update channelOffset — main line stays fixed
      const svgRect = this.svgOverlay?.getBoundingClientRect();
      const cursorY = e.clientY - (svgRect?.top ?? 0);
      const cursorPrice = this.series.coordinateToPrice(cursorY);
      if (cursorPrice !== null && drawing.points.length >= 2) {
        // Interpolate the main line price at cursor X position
        const cursorX = e.clientX - (svgRect?.left ?? 0);
        const p1x = this.chart.timeScale().timeToCoordinate(this.dragInitialPoints[0].time as any);
        const p2x = this.chart.timeScale().timeToCoordinate(this.dragInitialPoints[1].time as any);
        if (p1x !== null && p2x !== null) {
          const t = Math.abs(p2x - p1x) > 0.01 ? (cursorX - p1x) / (p2x - p1x) : 0;
          const mainPriceAtCursor = this.dragInitialPoints[0].price + t * (this.dragInitialPoints[1].price - this.dragInitialPoints[0].price);
          drawing.channelOffset = cursorPrice - mainPriceAtCursor;
        }
      }
    } else if (this.draggingNodeIndex !== null && this.draggingNodeIndex >= 0) {
      // ── Single node drag ──────────────────────────────────────────────
      const init = this.dragInitialPoints[this.draggingNodeIndex];

      if (init.pixelXOffset !== undefined) {
        // VLINE: pixel-perfect horizontal drag
        const newOffset = init.pixelXOffset + dx;
        const barX = this.chart.timeScale().timeToCoordinate(init.time as any);
        const newAbsX = barX !== null ? barX + newOffset : null;
        const newTime = newAbsX !== null
          ? this.chart.timeScale().coordinateToTime(newAbsX)
          : null;
        const oy = this.series.priceToCoordinate(init.price);
        const np = oy !== null ? this.series.coordinateToPrice(oy + dy) : null;
        drawing.points[this.draggingNodeIndex] = {
          time: (newTime ?? init.time) as number,
          price: np ?? init.price,
          pixelXOffset: newOffset,
        };
      } else {
        // Non-vline nodes
        const ox = init.logicalIndex !== undefined
          ? this.chart.timeScale().logicalToCoordinate(init.logicalIndex as any)
          : this.chart.timeScale().timeToCoordinate(init.time as any);
        const oy = this.series.priceToCoordinate(init.price);
        if (ox === null || oy === null) return;
        const nt = this.chart.timeScale().coordinateToTime(ox + dx);
        const nl = this.chart.timeScale().coordinateToLogical(ox + dx);
        const np = this.series.coordinateToPrice(oy + dy);
        if (nt !== null && np !== null) {
          drawing.points[this.draggingNodeIndex] = {
            time: nt as number,
            price: np,
            logicalIndex: init.logicalIndex !== undefined ? (nl ?? undefined) : undefined,
          };
        }
      }
    } else {
      // ── Whole drawing drag ────────────────────────────────────────────
      drawing.points = this.dragInitialPoints.map(pt => {
        if (pt.pixelXOffset !== undefined) {
          // VLINE: pure pixel offset addition
          const newOffset = pt.pixelXOffset + dx;
          const barX = this.chart!.timeScale().timeToCoordinate(pt.time as any);
          const newAbsX = barX !== null ? barX + newOffset : null;
          const newTime = newAbsX !== null
            ? this.chart!.timeScale().coordinateToTime(newAbsX)
            : null;
          const oy = this.series!.priceToCoordinate(pt.price);
          const np = oy !== null ? this.series!.coordinateToPrice(oy + dy) : null;
          return {
            time: (newTime ?? pt.time) as number,
            price: np ?? pt.price,
            pixelXOffset: newOffset,
          };
        }
        // Non-vline fallback
        const ox = pt.logicalIndex !== undefined
          ? this.chart!.timeScale().logicalToCoordinate(pt.logicalIndex as any)
          : this.chart!.timeScale().timeToCoordinate(pt.time as any);
        const oy = this.series!.priceToCoordinate(pt.price);
        if (ox === null || oy === null) return pt;
        const nt = this.chart!.timeScale().coordinateToTime(ox + dx);
        const nl = this.chart!.timeScale().coordinateToLogical(ox + dx);
        const np = this.series!.coordinateToPrice(oy + dy);
        if (nt !== null && np !== null) {
          return {
            time: nt as number,
            price: np,
            logicalIndex: pt.logicalIndex !== undefined ? (nl ?? undefined) : undefined,
          };
        }
        return pt;
      });
    }

    this.renderAll();
  };

  private onGlobalPointerUp = (): void => {
    const scrollLockCallbacks = this.draggingScrollLockCallbacks;
    this.activateDrawingOwner(this.draggingOwner);
    if (this.draggingId) {
      const drawing = this.drawings.find(d => d.id === this.draggingId);
      if (drawing && this.dragInitialDrawingCopy) {
        const changed = JSON.stringify(drawing) !== JSON.stringify(this.dragInitialDrawingCopy);
        if (changed) {
          this.undoStack.push({
            action: 'modify',
            oldDrawing: this.dragInitialDrawingCopy,
            newDrawing: JSON.parse(JSON.stringify(drawing)),
          });
          this.redoStack = [];
          void this.saveToBackend(drawing, this.draggingOwner);
          if (this.draggingOwner) {
            this.persistLocalFor(this.draggingOwner, this.getDrawingsFor(this.draggingOwner));
          }
        }
      }
    }
    this.resetDragState();
    scrollLockCallbacks?.unlock();
  };

  // ──────────────────────────────────────────────
  // Context Menu
  // ──────────────────────────────────────────────
  private onContextMenu(e: MouseEvent, id: string): void {
    e.preventDefault();
    e.stopPropagation();
    const context = this.activateContextFromEventTarget(e.target);
    this.selectDrawing(id);
    window.dispatchEvent(new CustomEvent('drawing:contextmenu', {
      detail: {
        x: e.clientX,
        y: e.clientY,
        drawingId: id,
        contextId: context?.contextId,
        symbol: context?.symbol,
        timeframe: context?.timeframe,
      },
    }));
  }

  // ──────────────────────────────────────────────
  // Persistence
  // ──────────────────────────────────────────────
  private persistLocal(): void {
    const identity = this.currentContextIdentity;
    if (!identity) return;
    this.persistLocalFor(identity, this.getDrawingsFor(identity));
  }

  /** Persist one registered chart context without relying on the last active panel. */
  persistCurrentContext(targetContextId?: string): boolean {
    const identity = targetContextId
      ? Array.from(this.chartContexts.values())
        .find(context => context.contextId === targetContextId)
      : this.currentContextIdentity;
    if (!identity) return false;
    this.persistLocalFor(identity, this.getDrawingsFor(identity));
    return true;
  }

  private persistLocalFor(identity: DrawingContextIdentity, drawings: Drawing[]): void {
    try {
      const key = buildDrawingStorageKey(identity);
      const vlines = drawings.filter(d => d.type === 'vline');
      vlines.forEach(d => {
        const pt = d.points[0];
        console.log('[VLine][4-PERSIST] id=', d.id,
          '| logicalIndex=', pt?.logicalIndex,
          '| will survive JSON?', pt?.logicalIndex !== undefined);
      });
      localStorage.setItem(key, JSON.stringify(drawings));
    } catch { }
  }

  async saveToBackend(
    drawing: Drawing,
    identity: DrawingContextIdentity | null = this.currentContextIdentity,
  ): Promise<void> {
    if (!identity?.symbol) return;
    const drawingContextKey = buildDrawingContextKey(identity);
    try {
      const serverId = await drawingApi.saveDrawing(drawing as unknown as ClientDrawing, identity.symbol);
      const targetDrawings = this.drawingsBySymbol.get(drawingContextKey) || [];
      const idx = targetDrawings.findIndex(d => d.id === drawing.id);
      if (idx !== -1) {
        targetDrawings[idx].serverId = serverId;
        // The optimistic local write happens before the API response. Persist
        // again after the server id arrives so a reload can still delete it.
        this.persistLocalFor(identity, targetDrawings);
      }
    } catch { }
  }

  async loadFromBackend(identityOrSymbol: DrawingContextIdentity | string): Promise<void> {
    const currentIdentity = this.currentContextIdentity;
    const identity: DrawingContextIdentity = typeof identityOrSymbol === 'string'
      ? {
        contextId: currentIdentity?.contextId || `legacy:${identityOrSymbol}:${this.currentTimeframe}`,
        symbol: identityOrSymbol,
        timeframe: currentIdentity?.timeframe || this.currentTimeframe,
        accountScope: currentIdentity?.accountScope,
      }
      : { ...identityOrSymbol };
    const drawingContextKey = buildDrawingContextKey(identity);

    try {
      const drawings = await drawingApi.loadDrawings(identity.symbol);
      if (drawings.length > 0) {
        const purgeKey = `drawings_purged_${drawingContextKey}`;
        const shouldPurge = !sessionStorage.getItem(purgeKey);
        if (shouldPurge) {
          for (const drawing of drawings) {
            if (drawing.serverId) await drawingApi.deleteDrawing(drawing.serverId).catch(() => { });
          }
          sessionStorage.setItem(purgeKey, '1');
          this.drawingsBySymbol.set(drawingContextKey, []);
          this.renderAll();
          return;
        }

        const existing = this.drawingsBySymbol.get(drawingContextKey) || [];
        if (existing.length > 0) return;
        const loadedDrawings = drawings.map(drawing => ({
          id: drawing.id,
          type: drawing.type as DrawingType,
          points: drawing.points,
          text: drawing.text,
          color: drawing.color,
          lineWidth: drawing.lineWidth,
          lineStyle: drawing.lineStyle,
          selected: false as const,
          locked: drawing.locked ?? false,
          subtype: drawing.subtype,
          channelOffset: drawing.channelOffset,
          channelMidpointRatio: drawing.channelMidpointRatio,
          regressionSource: drawing.regressionSource,
          regressionUpperDeviation: drawing.regressionUpperDeviation,
          regressionLowerDeviation: drawing.regressionLowerDeviation,
          showRegressionPearson: drawing.showRegressionPearson,
          pitchforkLevels: drawing.pitchforkLevels,
          serverId: drawing.serverId ?? undefined,
        } as Drawing));
        this.drawingsBySymbol.set(drawingContextKey, loadedDrawings);
        this.renderAll();
        this.persistLocalFor(identity, loadedDrawings);
      } else {
        this.loadFromLocal(identity);
      }
    } catch {
      this.loadFromLocal(identity);
    }
  }

  private loadFromLocal(identityOrSymbol: DrawingContextIdentity | string): void {
    const currentIdentity = this.currentContextIdentity;
    const identity: DrawingContextIdentity = typeof identityOrSymbol === 'string'
      ? {
        contextId: currentIdentity?.contextId || `legacy:${identityOrSymbol}:${this.currentTimeframe}`,
        symbol: identityOrSymbol,
        timeframe: currentIdentity?.timeframe || this.currentTimeframe,
        accountScope: currentIdentity?.accountScope,
      }
      : { ...identityOrSymbol };
    const drawingContextKey = buildDrawingContextKey(identity);

    try {
      const key = buildDrawingStorageKey(identity);
      const legacyKey = buildDrawingStorageKey({
        symbol: identity.symbol,
        timeframe: identity.timeframe,
      });
      const scopedRaw = localStorage.getItem(key);
      const legacyRaw = identity.accountScope && key !== legacyKey
        ? localStorage.getItem(legacyKey)
        : null;
      const raw = scopedRaw || legacyRaw;
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const existing = this.drawingsBySymbol.get(drawingContextKey) || [];
        if (existing.length > 0) return;
        const loadedDrawings = parsed.filter(
          d => d && typeof d.id === 'string' && typeof d.type === 'string' && Array.isArray(d.points),
        ) as Drawing[];
        this.drawingsBySymbol.set(drawingContextKey, loadedDrawings);
        if (!scopedRaw && legacyRaw) {
          localStorage.setItem(key, JSON.stringify(loadedDrawings));
        }
        // Audit vlines for lost logicalIndex
        loadedDrawings.filter(d => d.type === 'vline').forEach(d => {
          const pt = d.points[0];
          console.log('[VLine][4-RELOAD] id=', d.id,
            '| logicalIndex=', pt?.logicalIndex,
            '| recovered?', pt?.logicalIndex !== undefined,
            '(undefined here means it was never saved or was stripped during JSON.parse)');
        });
        this.renderAll();
      }
    } catch { }
  }

  async deleteFromBackend(
    id: string,
    serverId?: string,
    identity: DrawingContextIdentity | null = this.currentContextIdentity,
  ): Promise<void> {
    if (serverId) {
      await drawingApi.deleteDrawing(serverId).catch(() => { });
    }
    if (identity) this.persistLocalFor(identity, this.getDrawingsFor(identity));
  }

  saveToStorage(symbol: string): void {
    const identity = this.currentContextIdentity;
    if (!identity) return;
    const target = { ...identity, symbol };
    this.persistLocalFor(target, this.getDrawingsFor(target));
  }

  deleteByType(type: DrawingType): void {
    this.drawings.filter(d => d.type === type).forEach(d => this.deleteDrawing(d.id));
  }

  updateActiveDrawing(props: Partial<Drawing>): void {
    if (this.activeDrawing) Object.assign(this.activeDrawing, props);
  }

  /** Public alias — TradingChart.tsx calls this to finish freehand drawings */
  finishDrawing(contextId?: string): Drawing | null {
    if (contextId && this.activeDrawingOwner?.contextId !== contextId) return null;
    return this._completeDrawing();
  }

  /** Public alias — backward compat */
  renderAllDrawings(): void {
    this.renderAll();
  }

  /** Unselect a single drawing by id */
  unselectDrawing(id: string): void {
    const d = this.drawings.find(d => d.id === id);
    if (d) d.selected = false;
    this.renderAll();
  }

  /** Public alias — backward compat for old loadFromStorage calls */
  loadFromStorage(symbol: string): void {
    const identity = this.currentContextIdentity;
    this.loadFromLocal(identity ? { ...identity, symbol } : symbol);
  }

  /** Public alias — backward compat for undoDelete */
  undoDelete(): void { this.undo(); }
}

// ──────────────────────────────────────────────
// Singleton export
// ──────────────────────────────────────────────
export const drawingManager = new DrawingManager();
