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

export interface ChartContext {
  chart: IChartApi;
  series: ISeriesApi<any>;
  symbol: string;
  timeframe: string;
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
}

interface DrawingHistory {
  action: 'add' | 'delete' | 'modify';
  drawing?: Drawing;
  oldDrawing?: Drawing;
  newDrawing?: Drawing;
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
  private drawingsBySymbol: Map<string, Drawing[]> = new Map();
  private activeDrawing: Drawing | null = null;
  private previewPoint: DrawingPoint | null = null;
  private magnetEnabled = false;

  private chartContexts: Map<HTMLElement, ChartContext> = new Map();
  private activeContainer: HTMLElement | null = null;

  private chart: IChartApi | null = null;
  private series: ISeriesApi<any> | null = null;
  private currentSymbol: string | null = null;
  private currentTimeframe: string = 'M1'; // default matches app default timeframe

  private get drawings(): Drawing[] {
    if (!this.currentSymbol) return [];
    let list = this.drawingsBySymbol.get(this.currentSymbol);
    if (!list) {
      list = [];
      this.drawingsBySymbol.set(this.currentSymbol, list);
    }
    return list;
  }

  private set drawings(val: Drawing[]) {
    if (this.currentSymbol) {
      this.drawingsBySymbol.set(this.currentSymbol, val);
    }
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

  private undoStack: DrawingHistory[] = [];
  private redoStack: DrawingHistory[] = [];

  // Drag state
  private draggingId: string | null = null;
  private draggingNodeIndex: number | null = null; // null = whole drawing
  private dragStartX = 0;
  private dragStartY = 0;
  private dragInitialPoints: DrawingPoint[] = [];
  private dragInitialDrawingCopy: Drawing | null = null;

  // Scroll lock callbacks
  private onLockScroll: (() => void) | null = null;
  private onUnlockScroll: (() => void) | null = null;

  constructor() {
    // Global pointer events for drag
    window.addEventListener('pointermove', this.onGlobalPointerMove);
    window.addEventListener('pointerup', this.onGlobalPointerUp);

    // Shortcut listeners
    window.addEventListener('chart-undo-drawing', () => this.undo());
    window.addEventListener('chart-redo-drawing', () => this.redo());
    window.addEventListener('chart-delete-drawing', () => this.deleteSelected());
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
  ): void {
    if (!overlayContainer) return;

    if (!chart || !series) {
      // Cleanup / dispose chart panel
      const context = this.chartContexts.get(overlayContainer);
      if (context?.svgOverlay) {
        context.svgOverlay.remove();
      }
      this.chartContexts.delete(overlayContainer);
      if (this.activeContainer === overlayContainer) {
        this.activeContainer = null;
      }
      return;
    }

    this.activeContainer = overlayContainer;
    this.chart = chart;
    this.series = series;
    if (symbol) this.currentSymbol = symbol;
    if (timeframe) this.currentTimeframe = timeframe;

    // Get or create context
    let context = this.chartContexts.get(overlayContainer);
    const symbolChanged = !context || context.symbol !== symbol;
    const timeframeChanged = !context || context.timeframe !== timeframe;

    if (!context) {
      context = {
        chart,
        series,
        symbol: symbol || '',
        timeframe: timeframe || 'M1',
        svgOverlay: null,
      };
      this.chartContexts.set(overlayContainer, context);
    } else {
      context.chart = chart;
      context.series = series;
      if (symbol) context.symbol = symbol;
      if (timeframe) context.timeframe = timeframe;
    }

    // Build or relocate the SVG overlay for this container
    this.ensureSvgOverlayForContainer(overlayContainer, context);

    if (symbolChanged || timeframeChanged) {
      this.drawings = [];
      this.renderAll();
      if (this.currentSymbol) {
        this.loadFromBackend(this.currentSymbol).then(() => {
          this.renderAll();
        });
      }
    } else {
      this.renderAll();
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
      svg.style.cssText = [
        'position:absolute',
        'top:0',
        'left:0',
        'width:100%',
        'height:100%',
        'overflow:visible',
        'pointer-events:none',
        'z-index:10',
      ].join(';');
      container.appendChild(svg);
      context.svgOverlay = svg;
      console.log('[DrawingManager] SVG overlay created in', container.className || container.tagName);
    }
  }

  setScrollLockCallbacks(lock: () => void, unlock: () => void): void {
    this.onLockScroll = lock;
    this.onUnlockScroll = unlock;
  }

  setMagnetEnabled(enabled: boolean): void {
    this.magnetEnabled = enabled;
  }

  // ──────────────────────────────────────────────
  // Drawing Lifecycle
  // ──────────────────────────────────────────────
  startDrawing(type: DrawingType, color = '#2196F3', meta?: { subtype?: string }): string {
    const id = `d-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this.activeDrawing = { id, type, points: [], color, lineWidth: 2 };
    if (meta?.subtype) this.activeDrawing.subtype = meta.subtype;
    this.previewPoint = null;
    return id;
  }

  cancelDrawing(): void {
    this.activeDrawing = null;
    this.previewPoint = null;
    this.renderAll();
  }

  /**
   * Called on every chart click while a drawing tool is active.
   * Returns true when the drawing is complete.
   */
  addPoint(time: number, price: number, seriesData?: any): boolean {
    if (!this.activeDrawing) return false;

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

    const required = REQUIRED_POINTS[this.activeDrawing.type];
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
  addPointWithLogical(time: number, price: number, pixelXOffset: number): boolean {
    if (!this.activeDrawing) return false;
    this.activeDrawing.points.push({ time, price, pixelXOffset });

    const required = REQUIRED_POINTS[this.activeDrawing.type];
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
  updatePreviewPoint(time: number, price: number): void {
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
  updatePreviewPointWithLogical(time: number, price: number, pixelXOffset?: number): void {
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

    const completed: Drawing = { ...this.activeDrawing, selected: false };

    // Channel: set default channelOffset in price units if not yet set
    if (completed.type === 'channel' && completed.channelOffset === undefined && completed.points.length >= 2) {
      const priceDelta = Math.abs(completed.points[1].price - completed.points[0].price);
      completed.channelOffset = priceDelta > 0 ? priceDelta * 0.2 : 0.001;
      completed.rayLeft = false;
      completed.rayRight = false;
    }

    this.drawings.push(completed);
    this.activeDrawing = null;
    this.previewPoint = null;

    this.undoStack.push({ action: 'add', drawing: JSON.parse(JSON.stringify(completed)) });
    this.redoStack = [];

    this.renderAll();
    this.saveToBackend(completed);
    this.persistLocal();

    window.dispatchEvent(new CustomEvent('drawing:saved', { detail: completed }));
    return completed;
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
  }

  unselectAll(): void {
    this.drawings.forEach(d => (d.selected = false));
    this.renderAll();
  }

  deleteDrawing(id: string): boolean {
    const idx = this.drawings.findIndex(d => d.id === id);
    if (idx === -1) return false;
    const removed = this.drawings.splice(idx, 1)[0];
    this.undoStack.push({ action: 'delete', drawing: JSON.parse(JSON.stringify(removed)) });
    this.redoStack = [];
    this.renderAll();
    this.deleteFromBackend(id, removed.serverId);
    this.persistLocal();
    window.dispatchEvent(new CustomEvent('drawing:deleted', { detail: { id } }));
    return true;
  }

  deleteSelected(): void {
    const toDelete = this.drawings.filter(d => d.selected).map(d => d.id);
    toDelete.forEach(id => this.deleteDrawing(id));
  }

  clearAllDrawings(persist = true): void {
    const deleteInfo = this.drawings.map(d => ({ id: d.id, serverId: d.serverId }));
    this.drawings = [];
    this.renderAll();
    if (persist) {
      this.persistLocal();
      deleteInfo.forEach(({ id, serverId }) => this.deleteFromBackend(id, serverId));
    }
    window.dispatchEvent(new CustomEvent('drawings:cleared'));
  }

  getDrawings(): Drawing[] {
    return [...this.drawings];
  }

  getActiveDrawing(): Drawing | null {
    return this.activeDrawing ? { ...this.activeDrawing } : null;
  }

  undo(): void {
    const entry = this.undoStack.pop();
    if (!entry) return;
    if (entry.action === 'add' && entry.drawing) {
      this.drawings = this.drawings.filter(d => d.id !== entry.drawing!.id);
      this.deleteFromBackend(entry.drawing.id, entry.drawing.serverId);
    } else if (entry.action === 'delete' && entry.drawing) {
      this.drawings.push(entry.drawing);
      this.saveToBackend(entry.drawing);
    } else if (entry.action === 'modify' && entry.oldDrawing) {
      const idx = this.drawings.findIndex(d => d.id === entry.oldDrawing!.id);
      if (idx !== -1) {
        this.drawings[idx] = entry.oldDrawing;
        this.saveToBackend(entry.oldDrawing);
      }
    }
    this.redoStack.push(entry);
    this.renderAll();
    this.persistLocal();
  }

  redo(): void {
    const entry = this.redoStack.pop();
    if (!entry) return;
    if (entry.action === 'add' && entry.drawing) {
      this.drawings.push(entry.drawing);
      this.saveToBackend(entry.drawing);
    } else if (entry.action === 'delete' && entry.drawing) {
      this.drawings = this.drawings.filter(d => d.id !== entry.drawing!.id);
      this.deleteFromBackend(entry.drawing.id, entry.drawing.serverId);
    } else if (entry.action === 'modify' && entry.newDrawing) {
      const idx = this.drawings.findIndex(d => d.id === entry.newDrawing!.id);
      if (idx !== -1) {
        this.drawings[idx] = entry.newDrawing;
        this.saveToBackend(entry.newDrawing);
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


  renderAll(): void {
    const origChart = this.chart;
    const origSeries = this.series;
    const origSymbol = this.currentSymbol;

    try {
      for (const [container, context] of this.chartContexts.entries()) {
        if (!context.svgOverlay) {
          this.ensureSvgOverlayForContainer(container, context);
        }
        const svg = context.svgOverlay;
        if (!svg) continue;

        // Clear all contents
        while (svg.firstChild) svg.removeChild(svg.firstChild);

        if (!context.chart || !context.series) continue;

        // Set active context temporarily for px() and rendering helpers
        this.chart = context.chart;
        this.series = context.series;
        this.currentSymbol = context.symbol;

        // Get chart container dimensions for full-span lines (hline, vline)
        const parent = svg.parentElement;
        const W = parent ? parent.clientWidth : 2000;
        const H = parent ? parent.clientHeight : 1200;

        // Add defs for arrowhead
        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        defs.innerHTML = `
          <marker id="arr" markerWidth="7" markerHeight="7" refX="3" refY="3.5" orient="auto">
            <polygon points="0 0, 7 3.5, 0 7" fill="#2196F3" />
          </marker>`;
        svg.appendChild(defs);

        // Fetch drawings for this context's symbol
        const symbolDrawings = this.drawingsBySymbol.get(context.symbol) || [];

        // Render drawings for this symbol
        symbolDrawings.forEach(d => this.renderDrawing(svg, d, W, H, false));

        // Render cursor-following ghost BEFORE first click (vline, hline get a ghost from day 0)
        // Only draw the active/preview drawings on the active container if it matches this context!
        if (this.activeContainer === container && this.activeDrawing && this.activeDrawing.points.length === 0 && this.previewPoint) {
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
        if (this.activeContainer === container && this.activeDrawing && this.activeDrawing.points.length > 0 && this.previewPoint) {
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
    } finally {
      // Restore original references
      this.chart = origChart;
      this.series = origSeries;
      this.currentSymbol = origSymbol;
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

        const line = this.svgLine(-100, y, W + 100, y, color, lw, dash);
        line.style.opacity = opacity;
        g.appendChild(line);

        // Price label on right
        const label = this.svgText(W - 4, y - 4, d.points[0].price.toFixed(5), color, 10);
        label.setAttribute('text-anchor', 'end');
        g.appendChild(label);
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

        const line = this.svgLine(x, -100, x, H + 100, color, lw, dash);
        line.style.opacity = opacity;
        g.appendChild(line);

        // Invisible wide hit-zone for interaction
        if (!isPreview) {
          const hit = this.svgLine(x, -100, x, H + 100, 'transparent', 12, 'none');
          hit.style.pointerEvents = 'stroke';
          hit.style.cursor = 'ew-resize';
          hit.addEventListener('pointerdown', e => this.beginDrag(e, d.id, 0));
          hit.addEventListener('contextmenu', e => this.onContextMenu(e, d.id));
          g.appendChild(hit);

          // Selection dot in middle
          if (d.selected) {
            const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            dot.setAttribute('cx', String(x));
            dot.setAttribute('cy', String(H / 2));
            dot.setAttribute('r', '5');
            dot.setAttribute('fill', color);
            dot.setAttribute('stroke', '#fff');
            dot.setAttribute('stroke-width', '1.5');
            g.appendChild(dot);
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

        // Draw finite segment between the two points
        const line = this.svgLine(p1.x, p1.y, p2.x, p2.y, color, lw, dash);
        line.style.opacity = opacity;
        g.appendChild(line);

        // Clickable hit-zone (invisible wider line)
        if (!isPreview) {
          const hit = this.svgLine(p1.x, p1.y, p2.x, p2.y, 'transparent', 12, 'none');
          hit.style.pointerEvents = 'stroke';
          hit.style.cursor = 'pointer';
          hit.addEventListener('pointerdown', e => this.beginDrag(e, d.id, null));
          hit.addEventListener('contextmenu', e => this.onContextMenu(e, d.id));
          g.appendChild(hit);
        }
        break;
      }

      // ─── Equidistant Channel (MT5-correct) ──────────────────────
      case 'channel': {
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
          mainHit.style.pointerEvents = 'stroke';
          mainHit.style.cursor = 'move';
          mainHit.addEventListener('pointerdown', e => this.beginDrag(e, d.id, null));
          mainHit.addEventListener('contextmenu', e => this.onContextMenu(e, d.id));
          g.appendChild(mainHit);

          const parHit = this.svgLine(pp1.x, pp1.y, pp2.x, pp2.y, 'transparent', 14, 'none');
          parHit.style.pointerEvents = 'stroke';
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
            widthHandle.style.pointerEvents = 'all';
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
            bg.style.pointerEvents = 'all';
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
            hit.style.pointerEvents = 'all';
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
      d.points.forEach((point, i) => {
        const p = this.px(point);
        if (!p) return;

        const handle = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        handle.setAttribute('x', String(p.x - 4));
        handle.setAttribute('y', String(p.y - 4));
        handle.setAttribute('width', '8');
        handle.setAttribute('height', '8');
        handle.setAttribute('fill', '#ef4444');
        handle.setAttribute('stroke', '#fff');
        handle.setAttribute('stroke-width', '1');
        handle.style.cursor = 'crosshair';
        handle.style.pointerEvents = 'all';
        handle.addEventListener('pointerdown', e => this.beginDrag(e, d.id, i));
        g.appendChild(handle);
      });
    }

    // Channel-specific anchor handles (rendered separately so they appear on top of hit zones)
    if (!isPreview && d.selected && d.type === 'channel' && d.points.length >= 2) {
      d.points.forEach((point, i) => {
        const p = this.px(point);
        if (!p) return;
        const handle = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        handle.setAttribute('x', String(p.x - 4));
        handle.setAttribute('y', String(p.y - 4));
        handle.setAttribute('width', '8');
        handle.setAttribute('height', '8');
        handle.setAttribute('fill', '#ef4444');
        handle.setAttribute('stroke', '#fff');
        handle.setAttribute('stroke-width', '1');
        handle.style.cursor = 'crosshair';
        handle.style.pointerEvents = 'all';
        handle.addEventListener('pointerdown', e => this.beginDrag(e, d.id, i));
        g.appendChild(handle);
      });
    }

    // Make whole group clickable (select on click when not in drawing mode)
    if (!isPreview) {
      g.style.pointerEvents = 'auto';
      g.style.cursor = 'pointer';
      g.addEventListener('click', e => {
        e.stopPropagation();
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
    el.style.pointerEvents = 'none';
    el.textContent = text;
    return el;
  }

  // ──────────────────────────────────────────────
  // Drag Handling
  // ──────────────────────────────────────────────
  private beginDrag(e: PointerEvent, id: string, nodeIndex: number | null): void {
    e.stopPropagation();
    e.preventDefault();

    const drawing = this.drawings.find(d => d.id === id);
    if (!drawing || drawing.locked) return;

    this.selectDrawing(id);
    this.draggingId = id;
    this.draggingNodeIndex = nodeIndex;
    this.dragStartX = e.clientX;
    this.dragStartY = e.clientY;
    this.dragInitialPoints = JSON.parse(JSON.stringify(drawing.points));
    this.dragInitialDrawingCopy = JSON.parse(JSON.stringify(drawing));

    this.onLockScroll?.();
    try { (e.target as Element).setPointerCapture(e.pointerId); } catch { }
  }

  private onGlobalPointerMove = (e: PointerEvent): void => {
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
    if (this.draggingId) {
      const drawing = this.drawings.find(d => d.id === this.draggingId);
      if (drawing && this.dragInitialDrawingCopy) {
        const changed = JSON.stringify(drawing.points) !== JSON.stringify(this.dragInitialPoints);
        if (changed) {
          this.undoStack.push({
            action: 'modify',
            oldDrawing: this.dragInitialDrawingCopy,
            newDrawing: JSON.parse(JSON.stringify(drawing)),
          });
          this.redoStack = [];
          this.saveToBackend(drawing);
          this.persistLocal();
        }
      }
    }
    this.draggingId = null;
    this.draggingNodeIndex = null;
    this.dragInitialPoints = [];
    this.dragInitialDrawingCopy = null;
    this.onUnlockScroll?.();
  };

  // ──────────────────────────────────────────────
  // Context Menu
  // ──────────────────────────────────────────────
  private onContextMenu(e: MouseEvent, id: string): void {
    e.preventDefault();
    e.stopPropagation();
    this.selectDrawing(id);
    window.dispatchEvent(new CustomEvent('drawing:contextmenu', {
      detail: { x: e.clientX, y: e.clientY, drawingId: id },
    }));
  }

  // ──────────────────────────────────────────────
  // Persistence
  // ──────────────────────────────────────────────
  private persistLocal(): void {
    if (!this.currentSymbol) return;
    try {
      const key = `drawings-${this.currentSymbol}-${this.currentTimeframe}`;
      const vlines = this.drawings.filter(d => d.type === 'vline');
      vlines.forEach(d => {
        const pt = d.points[0];
        console.log('[VLine][4-PERSIST] id=', d.id,
          '| logicalIndex=', pt?.logicalIndex,
          '| will survive JSON?', pt?.logicalIndex !== undefined);
      });
      localStorage.setItem(key, JSON.stringify(this.drawings));
    } catch { }
  }

  async saveToBackend(drawing: Drawing): Promise<void> {
    if (!this.currentSymbol) return;
    try {
      const serverId = await drawingApi.saveDrawing(drawing as unknown as ClientDrawing, this.currentSymbol);
      const idx = this.drawings.findIndex(d => d.id === drawing.id);
      if (idx !== -1) (this.drawings[idx] as Drawing).serverId = serverId;
    } catch { }
  }

  async loadFromBackend(symbol: string): Promise<void> {
    try {
      const drawings = await drawingApi.loadDrawings(symbol);
      if (drawings.length > 0) {
        const shouldPurge = !sessionStorage.getItem('drawings_purged_' + symbol);
        if (shouldPurge) {
          for (const d of drawings) {
            if (d.serverId) await drawingApi.deleteDrawing(d.serverId).catch(() => { });
          }
          sessionStorage.setItem('drawings_purged_' + symbol, '1');
          this.drawings = [];
          this.renderAll();
          return;
        }
        this.drawings = drawings.map(d => ({
          id: d.id,
          type: d.type as DrawingType,
          points: d.points,
          text: d.text,
          color: d.color,
          lineWidth: d.lineWidth,
          lineStyle: d.lineStyle,
          selected: false as const,
          locked: d.locked ?? false,
          subtype: d.subtype,
          serverId: d.serverId ?? undefined,
        } as Drawing));
        this.renderAll();
        this.persistLocal();
      } else {
        this.loadFromLocal(symbol);
      }
    } catch {
      this.loadFromLocal(symbol);
    }
  }

  private loadFromLocal(symbol: string): void {
    try {
      const key = `drawings-${symbol}-${this.currentTimeframe}`;
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        this.drawings = parsed.filter(
          d => d && typeof d.id === 'string' && typeof d.type === 'string' && Array.isArray(d.points),
        );
        // Audit vlines for lost logicalIndex
        this.drawings.filter(d => d.type === 'vline').forEach(d => {
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

  async deleteFromBackend(id: string, serverId?: string): Promise<void> {
    if (serverId) {
      await drawingApi.deleteDrawing(serverId).catch(() => { });
    }
    this.persistLocal();
  }

  saveToStorage(symbol: string): void {
    try {
      const key = `drawings-${symbol}-${this.currentTimeframe}`;
      localStorage.setItem(key, JSON.stringify(this.drawings));
    } catch { }
  }

  deleteByType(type: DrawingType): void {
    this.drawings.filter(d => d.type === type).forEach(d => this.deleteDrawing(d.id));
  }

  updateActiveDrawing(props: Partial<Drawing>): void {
    if (this.activeDrawing) Object.assign(this.activeDrawing, props);
  }

  /** Public alias — TradingChart.tsx calls this to finish freehand drawings */
  finishDrawing(): Drawing | null {
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
    this.loadFromLocal(symbol);
  }

  /** Public alias — backward compat for undoDelete */
  undoDelete(): void { this.undo(); }
}

// ──────────────────────────────────────────────
// Singleton export
// ──────────────────────────────────────────────
export const drawingManager = new DrawingManager();
