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
  | 'shapes';

export interface DrawingPoint {
  time: number;  // unix timestamp (seconds)
  price: number;
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
  private drawings: Drawing[] = [];
  private activeDrawing: Drawing | null = null;
  private previewPoint: DrawingPoint | null = null;
  private magnetEnabled = false;

  private chart: IChartApi | null = null;
  private series: ISeriesApi<any> | null = null;
  private svgOverlay: SVGSVGElement | null = null;
  private overlayContainer: HTMLElement | null = null;  // stored for self-healing
  private currentSymbol: string | null = null;
  private currentTimeframe: string = 'M1'; // default matches app default timeframe

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
    this.chart = chart;
    this.series = series;

    // Detect changes BEFORE updating state
    const symbolChanged = !!(symbol && symbol !== this.currentSymbol);
    const timeframeChanged = !!(timeframe && timeframe !== this.currentTimeframe);

    // Now update state
    if (symbol) this.currentSymbol = symbol;
    if (timeframe) this.currentTimeframe = timeframe;

    // Store overlay container for self-healing
    if (overlayContainer) {
      this.overlayContainer = overlayContainer;
    }

    // Build or relocate the SVG overlay
    this.ensureSvgOverlay();

    if (symbolChanged || timeframeChanged) {
      this.drawings = [];
      this.renderAll();
      if (this.currentSymbol) this.loadFromBackend(this.currentSymbol);
    } else if (this.chart) {
      this.renderAll();
    }
  }

  /** Create or heal the SVG overlay. Tries stored container, then document.body as last resort. */
  private ensureSvgOverlay(): void {
    const container = this.overlayContainer;

    if (!container) {
      // No container yet — can't create overlay
      return;
    }

    // Remove old SVG if it's in a different parent
    if (this.svgOverlay && this.svgOverlay.parentElement !== container) {
      this.svgOverlay.remove();
      this.svgOverlay = null;
    }

    if (!this.svgOverlay) {
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
      this.svgOverlay = svg;
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
  startDrawing(type: DrawingType, color = '#2196F3'): string {
    const id = `d-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this.activeDrawing = { id, type, points: [], color, lineWidth: 2 };
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

  private _completeDrawing(): Drawing | null {
    if (!this.activeDrawing) return null;

    const completed: Drawing = { ...this.activeDrawing, selected: false };
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

  // ──────────────────────────────────────────────
  // Selection & Deletion
  // ──────────────────────────────────────────────
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

  // ──────────────────────────────────────────────
  // Undo / Redo
  // ──────────────────────────────────────────────
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

  // ──────────────────────────────────────────────
  // Update on chart scroll / zoom / resize
  // ──────────────────────────────────────────────
  updateDrawingPositions(): void {
    if (!this.chart || !this.series) return;
    this.renderAll();
  }

  // ──────────────────────────────────────────────
  // Coordinate helpers
  // ──────────────────────────────────────────────
  private px(point: DrawingPoint): { x: number; y: number } | null {
    if (!this.chart || !this.series) return null;
    const x = this.chart.timeScale().timeToCoordinate(point.time as any);
    const y = this.series.priceToCoordinate(point.price);
    if (x === null || y === null) return null;
    return { x, y };
  }

  private toDashArray(style?: string): string {
    if (style === 'dashed') return '8 4';
    if (style === 'dotted') return '3 3';
    return 'none';
  }

  // ──────────────────────────────────────────────
  // Render
  // ──────────────────────────────────────────────
  renderAll(): void {
    // Self-heal: recreate SVG overlay if missing
    if (!this.svgOverlay) {
      this.ensureSvgOverlay();
    }
    const svg = this.svgOverlay;
    if (!svg) return;

    // Clear all contents
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    if (!this.chart || !this.series) return;

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

    // Render all saved drawings
    this.drawings.forEach(d => this.renderDrawing(svg, d, W, H));

    // Render cursor-following ghost BEFORE first click (vline, hline get a ghost from day 0)
    if (this.activeDrawing && this.activeDrawing.points.length === 0 && this.previewPoint) {
      const type = this.activeDrawing.type;
      if (type === 'vline' || type === 'hline') {
        // Render a single ghost point as if it were placed
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
    if (this.activeDrawing && this.activeDrawing.points.length > 0 && this.previewPoint) {
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

      // ─── Vertical Line ────────────────────────────────────────────
      case 'vline': {
        if (d.points.length < 1) break;
        const x = this.chart!.timeScale().timeToCoordinate(d.points[0].time as any);
        if (x === null) break;

        const line = this.svgLine(x, -100, x, H + 100, color, lw, dash);
        line.style.opacity = opacity;
        g.appendChild(line);
        break;
      }

      // ─── Trend Line ───────────────────────────────────────────────
      case 'trendline': {
        if (d.points.length < 2) break;
        const p1 = this.px(d.points[0]);
        const p2 = this.px(d.points[1]);
        if (!p1 || !p2) break;

        // Extend line to full chart width via slope
        const slope = (p2.y - p1.y) / (p2.x - p1.x || 1);
        const extL = { x: -200, y: p1.y + slope * (-200 - p1.x) };
        const extR = { x: W + 200, y: p1.y + slope * (W + 200 - p1.x) };

        const line = this.svgLine(extL.x, extL.y, extR.x, extR.y, color, lw, dash);
        line.style.opacity = opacity;
        g.appendChild(line);

        // Clickable hit-zone (invisible wider line)
        if (!isPreview) {
          const hit = this.svgLine(extL.x, extL.y, extR.x, extR.y, 'transparent', 12, 'none');
          hit.style.pointerEvents = 'stroke';
          hit.style.cursor = 'pointer';
          hit.addEventListener('pointerdown', e => this.beginDrag(e, d.id, null));
          hit.addEventListener('contextmenu', e => this.onContextMenu(e, d.id));
          g.appendChild(hit);
        }
        break;
      }

      // ─── Channel ─────────────────────────────────────────────────
      case 'channel': {
        if (d.points.length < 2) break;
        const p1 = this.px(d.points[0]);
        const p2 = this.px(d.points[1]);
        if (!p1 || !p2) break;

        const slope = (p2.y - p1.y) / (p2.x - p1.x || 1);
        const dx = W + 200;

        // Main line
        const l1 = this.svgLine(-200, p1.y + slope * (-200 - p1.x), dx, p1.y + slope * (dx - p1.x), color, lw, dash);
        g.appendChild(l1);

        // Parallel line (offset vertically by same delta if only 2 pts, otherwise use 3rd point)
        const offset = p2.y - p1.y;
        const l2 = this.svgLine(-200, p1.y + offset + slope * (-200 - p1.x), dx, p1.y + offset + slope * (dx - p1.x), color, lw, 'dashed');
        g.appendChild(l2);

        // Channel fill
        const fillEl = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        const yL1 = p1.y + slope * (-200 - p1.x);
        const yR1 = p1.y + slope * (dx - p1.x);
        const yL2 = p1.y + offset + slope * (-200 - p1.x);
        const yR2 = p1.y + offset + slope * (dx - p1.x);
        fillEl.setAttribute('points', `-200,${yL1} ${dx},${yR1} ${dx},${yR2} -200,${yL2}`);
        fillEl.setAttribute('fill', color);
        fillEl.setAttribute('fill-opacity', '0.06');
        fillEl.style.opacity = opacity;
        g.appendChild(fillEl);
        break;
      }

      // ─── Fibonacci Retracement ────────────────────────────────────
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

      // ─── Fibonacci Extension ──────────────────────────────────────
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

      default: break;
    }

    // ─── Selection handles & drag on completed drawings ──────────
    if (!isPreview && d.selected && Array.isArray(d.points)) {
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
      g.style.pointerEvents = 'all';
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
    try { (e.target as Element).setPointerCapture(e.pointerId); } catch {}
  }

  private onGlobalPointerMove = (e: PointerEvent): void => {
    if (!this.draggingId || !this.chart || !this.series) return;
    const drawing = this.drawings.find(d => d.id === this.draggingId);
    if (!drawing) return;

    const dx = e.clientX - this.dragStartX;
    const dy = e.clientY - this.dragStartY;

    if (this.draggingNodeIndex !== null) {
      // Move single node
      const init = this.dragInitialPoints[this.draggingNodeIndex];
      const ox = this.chart.timeScale().timeToCoordinate(init.time as any);
      const oy = this.series.priceToCoordinate(init.price);
      if (ox === null || oy === null) return;

      const nt = this.chart.timeScale().coordinateToTime(ox + dx);
      const np = this.series.coordinateToPrice(oy + dy);
      if (nt !== null && np !== null) {
        drawing.points[this.draggingNodeIndex] = { time: nt as number, price: np };
      }
    } else {
      // Move entire drawing
      drawing.points = this.dragInitialPoints.map(pt => {
        const ox = this.chart!.timeScale().timeToCoordinate(pt.time as any);
        const oy = this.series!.priceToCoordinate(pt.price);
        if (ox === null || oy === null) return pt;
        const nt = this.chart!.timeScale().coordinateToTime(ox + dx);
        const np = this.series!.coordinateToPrice(oy + dy);
        if (nt !== null && np !== null) return { time: nt as number, price: np };
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
      localStorage.setItem(key, JSON.stringify(this.drawings));
    } catch {}
  }

  async saveToBackend(drawing: Drawing): Promise<void> {
    if (!this.currentSymbol) return;
    try {
      const serverId = await drawingApi.saveDrawing(drawing as unknown as ClientDrawing, this.currentSymbol);
      const idx = this.drawings.findIndex(d => d.id === drawing.id);
      if (idx !== -1) (this.drawings[idx] as Drawing).serverId = serverId;
    } catch {}
  }

  async loadFromBackend(symbol: string): Promise<void> {
    try {
      const drawings = await drawingApi.loadDrawings(symbol);
      if (drawings.length > 0) {
        const shouldPurge = !sessionStorage.getItem('drawings_purged_' + symbol);
        if (shouldPurge) {
          for (const d of drawings) {
            if (d.serverId) await drawingApi.deleteDrawing(d.serverId).catch(() => {});
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
        this.renderAll();
      }
    } catch {}
  }

  async deleteFromBackend(id: string, serverId?: string): Promise<void> {
    if (serverId) {
      await drawingApi.deleteDrawing(serverId).catch(() => {});
    }
    this.persistLocal();
  }

  saveToStorage(symbol: string): void {
    try {
      const key = `drawings-${symbol}-${this.currentTimeframe}`;
      localStorage.setItem(key, JSON.stringify(this.drawings));
    } catch {}
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
