import type {
  IChartApi,
  ISeriesApi,
  SeriesType,
  Time,
} from 'lightweight-charts';
import {
  arrowLinePath,
  arrowMarkerPath,
  arrowMarkDownPath,
  arrowMarkUpPath,
  arcGeometry,
  circlePath,
  curvePath,
  doubleCurvePath,
  ellipseGeometry,
  multiPointPath,
  rectanglePath,
  rotatedRectangle,
} from '../brushShapeGeometry';
import { getBrushShapeTool } from '../brushShapeToolCatalog';
import { renderChartPattern } from '../chartPatternRenderer';
import { renderForecastingMeasurementDrawing } from '../forecastingMeasurementRenderer';
import { getForecastingMeasurementTool } from '../forecastingMeasurementToolCatalog';
import { renderGannFibonacciDrawing } from '../gannFibonacciRenderer';
import { drawingLogicalToCoordinate } from '../geometry/drawingCoordinates';
import { freehandPath, projectFreehandPoint } from '../geometry/freehandGeometry';
import { clipLineToViewport, screenAngleDegrees } from '../geometry/trendToolGeometry';
import { buildInfoLineMetrics } from '../geometry/tradingViewTrendGeometry';
import type {
  Drawing,
  DrawingPoint,
  DrawingSeriesDataPoint,
} from '../model/drawing';
import type { DrawingAxisOverlayRenderer } from './DrawingAxisOverlayRenderer';
import type { DrawingTrendChannelRenderer } from './DrawingTrendChannelRenderer';

type ScreenPoint = { x: number; y: number };

export interface DrawingSvgRendererOptions {
  getChart: () => IChartApi | null;
  getSeries: () => ISeriesApi<SeriesType> | null;
  getContextId: () => string | null;
  px: (point: DrawingPoint) => ScreenPoint | null;
  toDashArray: (style?: string, lineWidth?: number) => string;
  svgLine: (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    stroke: string,
    lineWidth: number,
    dash: string,
  ) => SVGLineElement;
  svgText: (
    x: number,
    y: number,
    text: string,
    fill: string,
    size: number,
  ) => SVGTextElement;
  beginDrag: (event: PointerEvent, drawingId: string, nodeIndex: number | null) => void;
  onContextMenu: (event: MouseEvent, drawingId: string) => void;
  activateContextFromEventTarget: (target: EventTarget | null) => unknown;
  selectDrawing: (drawingId: string, multi?: boolean) => boolean;
  getSeriesPriceFormat: DrawingAxisOverlayRenderer['getSeriesPriceFormat'];
  formatPrice: DrawingAxisOverlayRenderer['formatPrice'];
  formatTimeScaleValue: DrawingAxisOverlayRenderer['formatTimeScaleValue'];
  appendForecastingScaleHighlights: DrawingAxisOverlayRenderer['appendForecastingScaleHighlights'];
  appendPriceScaleLabel: DrawingAxisOverlayRenderer['appendPriceScaleLabel'];
  appendSelectionScaleBands: DrawingAxisOverlayRenderer['appendSelectionScaleBands'];
  appendTimeScaleLabel: DrawingAxisOverlayRenderer['appendTimeScaleLabel'];
  appendInfoLinePanel: DrawingTrendChannelRenderer['appendInfoLinePanel'];
  renderTrendChannelVariant: DrawingTrendChannelRenderer['renderTrendChannelVariant'];
  getSeriesDataForActiveContext: () => DrawingSeriesDataPoint[];
  resolvePositionDefaults: (drawing: Drawing) => Pick<
    Drawing,
    'positionTargetPrice' | 'positionStopPrice' | 'positionEndTime' | 'positionEndLogicalIndex'
  >;
  renderAnnotation: (
    group: SVGGElement,
    drawing: Drawing,
    width: number,
    height: number,
    isPreview: boolean,
    color: string,
    lineWidth: number,
    dash: string,
    opacity: string,
  ) => boolean;
  renderSelection: (
    group: SVGGElement,
    drawing: Drawing,
    width: number,
    height: number,
    isPreview: boolean,
    color: string,
  ) => void;
}

/** Renders one drawing's committed or preview SVG geometry and interactions. */
export class DrawingSvgRenderer {
  constructor(private readonly options: DrawingSvgRendererOptions) {}

  render(
    svg: SVGSVGElement,
    d: Drawing,
    W: number,
    H: number,
    isPreview = false,
  ): void {
    const color = d.color || '#2196F3';
    const lw = d.lineWidth || 2;
    const usesScaledLineStyle = d.type === 'trendline'
      && (!d.subtype || d.subtype === 'trendline' || d.subtype === 'ray' || d.subtype === 'info_line');
    const dash = this.options.toDashArray(d.lineStyle, usesScaledLineStyle ? lw : undefined);
    const opacity = isPreview ? '0.7' : '1';

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('data-id', d.id);

    switch (d.type) {

      case 'pattern': {
        const plotWidth = Math.max(0, W - (this.options.getChart()?.priceScale('right').width() ?? 0));
        const plotHeight = Math.max(0, H - (this.options.getChart()?.timeScale().height() ?? 0));
        const geometry = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        const clip = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
        clip.id = `pattern-clip-${d.id}`;
        const bounds = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        bounds.setAttribute('width', String(plotWidth));
        bounds.setAttribute('height', String(plotHeight));
        clip.appendChild(bounds);
        g.appendChild(clip);
        geometry.setAttribute('clip-path', `url(#${clip.id})`);
        geometry.style.opacity = opacity;
        renderChartPattern(geometry, d, d.points.map(point => this.options.px(point)), plotWidth, plotHeight);
        if (!isPreview) geometry.querySelectorAll<SVGPathElement>('path').forEach(path => {
          const hit = path.cloneNode(false) as SVGPathElement;
          hit.setAttribute('stroke', 'transparent');
          hit.setAttribute('stroke-width', String(Math.max(12, lw + 8)));
          hit.setAttribute('fill', 'none');
          hit.removeAttribute('stroke-dasharray');
          hit.setAttribute('pointer-events', 'stroke');
          hit.setAttribute('data-geometry-role', 'pattern-hit');
          for (const target of [path, hit]) {
            target.style.cursor = d.locked ? 'default' : 'move';
            target.addEventListener('pointerdown', event => this.options.beginDrag(event, d.id, null));
          }
          geometry.insertBefore(hit, path);
        });
        g.appendChild(geometry);
        break;
      }

      case 'shapes': {
        const tool = getBrushShapeTool(d);
        if (!tool || d.points.length < Math.min(2, tool.requiredPoints || 2)) break;
        const a = this.options.px(d.points[0]), b = this.options.px(d.points[1] ?? d.points[0]);
        if (!a || !b) break;
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('data-geometry-role', d.subtype!);
        const isLine = d.subtype === 'arrow' || tool.group === 'Shapes';
        path.setAttribute('d', d.subtype === 'rectangle' ? rectanglePath(a, b) : d.subtype === 'arrow_mark_down' ? arrowMarkDownPath(a) : d.subtype === 'arrow_mark_up' ? arrowMarkUpPath(a) : isLine ? arrowLinePath(a, b, lw) : arrowMarkerPath(a, b));
        if (d.subtype === 'rotated_rectangle') path.setAttribute('d', rotatedRectangle(a, b, this.options.px(d.points[2] ?? d.points[1]) ?? b).path);
        if (d.subtype === 'circle') path.setAttribute('d', circlePath(a, b));
        if (d.subtype === 'ellipse') path.setAttribute('d', ellipseGeometry(a, b, this.options.px(d.points[2] ?? d.points[1]) ?? b).path);
        if (d.subtype === 'arc') path.setAttribute('d', arcGeometry(a, b, this.options.px(d.points[2] ?? d.points[1]) ?? b).path);
        if (d.subtype === 'curve') path.setAttribute('d', curvePath(a, b, d.points[2] ? this.options.px(d.points[2]) ?? undefined : undefined));
        if (d.subtype === 'double_curve') {
          const c = d.points[2] && this.options.px(d.points[2]), e = d.points[3] && this.options.px(d.points[3]);
          path.setAttribute('d', doubleCurvePath(a, b, c && e ? [c, e] : undefined));
        }
        if (d.subtype === 'path' || d.subtype === 'polyline') path.setAttribute('d', multiPointPath(d.points.map(point => this.options.px(point)).filter((point): point is { x: number; y: number } => point !== null), d.subtype === 'path', lw));
        if (d.subtype === 'triangle') path.setAttribute('d', multiPointPath(d.points.map(point => this.options.px(point)).filter((point): point is { x: number; y: number } => point !== null)) + ' Z');
        const clip = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
        clip.id = `shape-clip-${this.options.getContextId()}-${d.id}`.replace(/[^a-zA-Z0-9_-]/g, '_');
        const bounds = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        bounds.setAttribute('width', String(Math.max(0, W - (this.options.getChart()?.priceScale('right').width() ?? 0))));
        bounds.setAttribute('height', String(Math.max(0, H - (this.options.getChart()?.timeScale().height() ?? 0))));
        clip.appendChild(bounds);
        g.appendChild(clip);
        path.setAttribute('clip-path', `url(#${clip.id})`);
        path.setAttribute('fill', tool.background ? d.fillColor || 'none' : isLine ? 'none' : color);
        if (tool.background) path.setAttribute('fill-opacity', String(d.fillOpacity ?? .2));
        path.setAttribute('stroke', color);
        path.setAttribute('stroke-width', isLine ? String(lw) : '1');
        if (isLine && dash !== 'none') path.setAttribute('stroke-dasharray', dash);
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        path.style.opacity = opacity;
        if (!isPreview) {
          if (isLine) {
            const hit = path.cloneNode(false) as SVGPathElement;
            hit.setAttribute('data-geometry-role', 'arrow-hit');
            hit.setAttribute('stroke', 'transparent');
            hit.setAttribute('fill', 'none');
            hit.setAttribute('stroke-width', String(Math.max(12, lw + 8)));
            hit.removeAttribute('stroke-dasharray');
            hit.setAttribute('pointer-events', 'stroke');
            hit.style.cursor = d.locked ? 'default' : 'move';
            hit.addEventListener('pointerdown', event => this.options.beginDrag(event, d.id, null));
            g.appendChild(hit);
          }
          path.setAttribute('pointer-events', 'all');
          path.style.cursor = d.locked ? 'default' : 'move';
          path.addEventListener('pointerdown', event => this.options.beginDrag(event, d.id, null));
          path.addEventListener('contextmenu', event => this.options.onContextMenu(event, d.id));
        }
        g.appendChild(path);
        break;
      }

      // ─── Horizontal Line ─────────────────────────────────────────
      case 'hline': {
        if (d.points.length < 1) break;
        const y = this.options.getSeries()!.priceToCoordinate(d.points[0].price);
        if (y === null) break;

        const anchor = this.options.px(d.points[0]);
        const plotW = Math.max(0, W - (this.options.getChart()?.priceScale('right').width() ?? 0));
        const x1 = d.subtype === 'horizontal_ray' && anchor ? anchor.x : 0;

        const line = this.options.svgLine(x1, y, plotW, y, color, lw, dash);
        line.style.opacity = opacity;
        g.appendChild(line);

        if (!isPreview) {
          const hit = this.options.svgLine(x1, y, plotW, y, 'transparent', 12, 'none');
          hit.setAttribute('pointer-events', 'stroke');
          hit.style.cursor = 'move';
          hit.addEventListener('pointerdown', e => this.options.beginDrag(e, d.id, null));
          hit.addEventListener('contextmenu', e => this.options.onContextMenu(e, d.id));
          g.appendChild(hit);
        }

        this.options.appendPriceScaleLabel(g, plotW, y, d.points[0].price, color);
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
          const barX = this.options.getChart()!.timeScale().timeToCoordinate(pt.time as Time);
          if (barX !== null) x = barX + pt.pixelXOffset;
        } else if (pt.logicalIndex !== undefined) {
          // Backward compat: old saved drawings that used logicalIndex
          x = drawingLogicalToCoordinate(this.options.getChart()!.timeScale(), pt.logicalIndex);
        } else {
          // Absolute fallback — snaps to bar centre
          x = this.options.getChart()!.timeScale().timeToCoordinate(pt.time as Time);
        }
        if (x === null) break;

        const plotW = Math.max(0, W - (this.options.getChart()?.priceScale('right').width() ?? 0));
        const plotH = Math.max(0, H - (this.options.getChart()?.timeScale().height() ?? 0));
        const crossY = this.options.getSeries()!.priceToCoordinate(pt.price);

        const line = this.options.svgLine(x, 0, x, plotH, color, lw, dash);
        line.style.opacity = opacity;
        g.appendChild(line);

        if (d.subtype === 'crossline' && crossY !== null) {
          const horizontal = this.options.svgLine(0, crossY, plotW, crossY, color, lw, dash);
          horizontal.style.opacity = opacity;
          g.appendChild(horizontal);
          this.options.appendPriceScaleLabel(g, plotW, crossY, pt.price, color);
        }

        this.options.appendTimeScaleLabel(g, x, plotH, pt.time, color);

        // Invisible wide hit-zone for interaction
        if (!isPreview) {
          const hit = this.options.svgLine(x, 0, x, plotH, 'transparent', 12, 'none');
          hit.setAttribute('pointer-events', 'stroke');
          hit.style.cursor = 'ew-resize';
          hit.addEventListener('pointerdown', e => this.options.beginDrag(e, d.id, 0));
          hit.addEventListener('contextmenu', e => this.options.onContextMenu(e, d.id));
          g.appendChild(hit);

          if (d.subtype === 'crossline' && crossY !== null) {
            const horizontalHit = this.options.svgLine(0, crossY, plotW, crossY, 'transparent', 12, 'none');
            horizontalHit.setAttribute('pointer-events', 'stroke');
            horizontalHit.style.cursor = 'move';
            horizontalHit.addEventListener('pointerdown', e => this.options.beginDrag(e, d.id, 0));
            horizontalHit.addEventListener('contextmenu', e => this.options.onContextMenu(e, d.id));
            g.appendChild(horizontalHit);
          }

        }
        break;
      }

      // ─── Trend Line (Segment) ─────────────────────────────────────────
      case 'trendline': {
        if (d.points.length < 2) break;
        const p1 = this.options.px(d.points[0]);
        const p2 = this.options.px(d.points[1]);
        if (!p1 || !p2) break;

        const plotW = Math.max(0, W - (this.options.getChart()?.priceScale('right').width() ?? 0));
        const plotH = Math.max(0, H - (this.options.getChart()?.timeScale().height() ?? 0));
        const extent = d.subtype === 'ray'
          ? 'ray'
          : d.subtype === 'extended_line'
            ? 'infinite'
            : 'segment';
        const segment = clipLineToViewport(p1, p2, plotW, plotH, extent) ?? { start: p1, end: p2 };

        const line = this.options.svgLine(
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

        if (usesScaledLineStyle && dash !== 'none') line.setAttribute('stroke-linecap', 'butt');

        if (d.subtype === 'info_line' || d.subtype === 'trend_angle') {
          const angle = screenAngleDegrees(p1, p2);
          if (d.subtype === 'trend_angle') {
            const guideDirection = p2.x >= p1.x ? 1 : -1;
            const guideLength = Math.min(72, Math.max(28, Math.abs(p2.x - p1.x) * 0.36));
            const guideEndX = p1.x + (guideDirection * guideLength);
            const baseline = this.options.svgLine(p1.x, p1.y, guideEndX, p1.y, color, 1, '2 2');
            baseline.setAttribute('data-geometry-role', 'angle-reference');
            baseline.style.opacity = isPreview ? '0.55' : '0.8';
            g.appendChild(baseline);
            const angleLabel = this.options.svgText(
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
            const timeScale = this.options.getChart()!.timeScale();
            // Counts follow the rendered candle anchors. Raw click fractions
            // can span 13.2 bars while their snapped candle times span 14.
            const startLogical = timeScale.timeToIndex?.(d.points[0].time as Time, false)
              ?? timeScale.coordinateToLogical(p1.x)
              ?? d.points[0].logicalIndex
              ?? 0;
            const endLogical = timeScale.timeToIndex?.(d.points[1].time as Time, false)
              ?? timeScale.coordinateToLogical(p2.x)
              ?? d.points[1].logicalIndex
              ?? startLogical;
            const priceFormat = this.options.getSeriesPriceFormat();
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
              anglePrecision: 1,
            });
            this.options.appendInfoLinePanel(g, p1, p2, metrics.display, plotW, plotH, d, isPreview);
          }
        }

        // Clickable hit-zone (invisible wider line)
        if (!isPreview) {
          const hit = this.options.svgLine(
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
          hit.addEventListener('pointerdown', e => this.options.beginDrag(e, d.id, null));
          hit.addEventListener('contextmenu', e => this.options.onContextMenu(e, d.id));
          g.appendChild(hit);
        }
        break;
      }

      // ─── Equidistant Channel (MT5-correct) ──────────────────────
      case 'channel': {
        if (d.subtype && this.options.renderTrendChannelVariant(g, d, W, H, color, lw, dash, opacity, isPreview)) {
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
        const mp1_raw = this.options.px(d.points[0]);
        const mp2_raw = this.options.px(d.points[1]);
        if (!mp1_raw || !mp2_raw) break;

        let mp1_x = mp1_raw.x;
        if (d.points[0].pixelXOffset !== undefined) {
          const barX = this.options.getChart()!.timeScale().timeToCoordinate(d.points[0].time as Time);
          if (barX !== null) mp1_x = barX + d.points[0].pixelXOffset;
        }

        let mp2_x = mp2_raw.x;
        if (d.points[1].pixelXOffset !== undefined) {
          const barX = this.options.getChart()!.timeScale().timeToCoordinate(d.points[1].time as Time);
          if (barX !== null) mp2_x = barX + d.points[1].pixelXOffset;
        }

        const mp1 = { x: mp1_x, y: mp1_raw.y };
        const mp2 = { x: mp2_x, y: mp2_raw.y };

        // Parallel line: same time anchors, price shifted by channelOffset
        const pp1y = this.options.getSeries()!.priceToCoordinate(d.points[0].price + chOffset);
        const pp2y = this.options.getSeries()!.priceToCoordinate(d.points[1].price + chOffset);
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
        const mainLine = this.options.svgLine(clipX(mx1), clipY(my1), clipX(mx2), clipY(my2), color, lw, dash);
        mainLine.style.opacity = opacity;
        g.appendChild(mainLine);

        // Parallel line (dashed)
        const parLine = this.options.svgLine(clipX(px1), clipY(py1), clipX(px2), clipY(py2), color, lw, '8 4');
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
          const vline1 = this.options.svgLine(mp1.x, 0, mp1.x, H, color, 1, '4 3');
          vline1.style.opacity = '0.5';
          g.appendChild(vline1);

          const vline2 = this.options.svgLine(mp2.x, 0, mp2.x, H, color, 1, '4 3');
          vline2.style.opacity = '0.5';
          g.appendChild(vline2);

          // Measurement tooltip
          const timeDiff = Math.abs(d.points[1].time - d.points[0].time);
          const priceDiff = Math.abs(d.points[1].price - d.points[0].price);
          const barCount = Math.round(timeDiff / 60);
          const infoText = `${barCount} / ${priceDiff.toFixed(5)}`;
          const labelX = mp2.x + 8;
          const labelY = mp2.y - 8;
          const label = this.options.svgText(labelX, labelY, infoText, '#ffffff', 11);
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
          const label = this.options.svgText(midX, midY, infoText, color, 10);
          label.setAttribute('text-anchor', 'middle');
          g.appendChild(label);
        }

        // ── Hit zones for interaction (committed only) ──
        if (!isPreview) {
          const mainHit = this.options.svgLine(mp1.x, mp1.y, mp2.x, mp2.y, 'transparent', 14, 'none');
          mainHit.setAttribute('pointer-events', 'stroke');
          mainHit.style.cursor = 'move';
          mainHit.addEventListener('pointerdown', e => this.options.beginDrag(e, d.id, null));
          mainHit.addEventListener('contextmenu', e => this.options.onContextMenu(e, d.id));
          g.appendChild(mainHit);

          const parHit = this.options.svgLine(pp1.x, pp1.y, pp2.x, pp2.y, 'transparent', 14, 'none');
          parHit.setAttribute('pointer-events', 'stroke');
          parHit.style.cursor = 'ns-resize';
          parHit.addEventListener('pointerdown', e => this.options.beginDrag(e, d.id, -1));
          parHit.addEventListener('contextmenu', e => this.options.onContextMenu(e, d.id));
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
            widthHandle.addEventListener('pointerdown', e => this.options.beginDrag(e, d.id, -1));
            g.appendChild(widthHandle);
          }
        }
        break;
      }


      case 'fibonacci':
      case 'fib_extension': {
        const screenPoints = d.points.map((point) => this.options.px(point));
        if (!screenPoints[0] || !screenPoints[1]) break;
        renderGannFibonacciDrawing({
          group: g,
          subtype: d.subtype
            ?? (d.type === 'fib_extension' ? 'trend_based_fib_extension' : 'fib_retracement'),
          dataPoints: d.points,
          screenPoints,
          plotWidth: Math.max(0, W - (this.options.getChart()?.priceScale('right').width() ?? 0)),
          plotHeight: Math.max(0, H - (this.options.getChart()?.timeScale().height() ?? 0)),
          color,
          lineWidth: lw,
          dash,
          opacity,
          priceToCoordinate: (price) => this.options.getSeries()!.priceToCoordinate(price),
          formatPrice: (price) => this.options.formatPrice(price),
        });
        if (!isPreview) {
          g.querySelectorAll<SVGElement>('[data-geometry-role]').forEach((geometry) => {
            const tagName = geometry.tagName.toLowerCase();
            if (tagName === 'text') return;
            const role = geometry.getAttribute('data-geometry-role');
            const hitTarget = geometry.cloneNode(false) as SVGElement;
            hitTarget.removeAttribute('data-geometry-role');
            if (role) hitTarget.setAttribute('data-geometry-hit-for', role);
            hitTarget.setAttribute('fill', 'transparent');
            hitTarget.setAttribute('stroke', 'transparent');
            hitTarget.style.opacity = '1';
            hitTarget.style.cursor = 'move';
            if (tagName === 'rect' || tagName === 'polygon') {
              hitTarget.setAttribute('pointer-events', 'all');
            } else {
              hitTarget.setAttribute('stroke-width', '12');
              hitTarget.setAttribute('pointer-events', 'stroke');
            }
            hitTarget.addEventListener('pointerdown', (event) => {
              this.options.beginDrag(event as PointerEvent, d.id, null);
            });
            hitTarget.addEventListener('contextmenu', (event) => this.options.onContextMenu(event, d.id));
            g.appendChild(hitTarget);
          });
        }
        break;
      }

      // ─── Measure ─────────────────────────────────────────────────
      case 'measure': {
        const forecastingTool = getForecastingMeasurementTool(d.subtype);
        if (forecastingTool) {
          const screenPoints = d.points.map((point) => this.options.px(point));
          const needsSeriesData = d.subtype === 'anchored_vwap'
            || d.subtype === 'long_position'
            || d.subtype === 'short_position'
            || d.subtype === 'fixed_range_volume_profile'
            || d.subtype === 'anchored_volume_profile'
            || d.subtype === 'position_forecast'
            || d.subtype === 'date_range'
            || d.subtype === 'date_and_price_range'
            || (d.subtype === 'bars_pattern' && d.seriesSnapshot === undefined);
          const seriesData = needsSeriesData ? this.options.getSeriesDataForActiveContext() : [];
          const latestBar = seriesData[seriesData.length - 1];
          const latestPrice = latestBar
            ? [latestBar.close, latestBar.value, latestBar.open]
              .find((value): value is number => typeof value === 'number' && Number.isFinite(value))
            : undefined;
          renderForecastingMeasurementDrawing({
            group: g,
            subtype: forecastingTool.id,
            points: d.points,
            screenPoints,
            plot: {
              width: Math.max(0, W - (this.options.getChart()?.priceScale('right').width() ?? 0)),
              height: Math.max(0, H - (this.options.getChart()?.timeScale().height() ?? 0)),
            },
            series: seriesData,
            seriesSnapshot: d.seriesSnapshot,
            latestPrice,
            currentPrice: latestPrice,
            positionSizing: d.positionSizing,
            ...this.options.resolvePositionDefaults(d),
            selected: Boolean(d.selected) && !isPreview,
            timeToCoordinate: (time) => this.options.getChart()!.timeScale().timeToCoordinate(time as Time),
            logicalToCoordinate: (logical) => drawingLogicalToCoordinate(this.options.getChart()!.timeScale(), logical),
            priceToCoordinate: (price) => this.options.getSeries()!.priceToCoordinate(price),
            formatPrice: (price) => this.options.formatPrice(price),
            formatTime: (time) => this.options.formatTimeScaleValue(time),
            color,
            lineWidth: lw,
            dash,
            opacity: Number(opacity),
            tickSize: this.options.getSeriesPriceFormat().minMove,
          });

          if (d.subtype === 'long_position' || d.subtype === 'short_position') {
            const defaults = this.options.resolvePositionDefaults(d);
            const plotW = Math.max(0, W - (this.options.getChart()?.priceScale('right').width() ?? 0));
            for (const [role, price, labelColor] of [
              ['entry', d.points[0]?.price, color],
              ['target', defaults.positionTargetPrice, '#089981'],
              ['stop', defaults.positionStopPrice, '#f23645'],
            ] as const) {
              if (price === undefined) continue;
              const y = this.options.getSeries()!.priceToCoordinate(price);
              if (y !== null) this.options.appendPriceScaleLabel(g, plotW, y, price, labelColor, `position-${role}-price-scale-label`);
            }
          }

          if (!isPreview) {
            g.querySelectorAll<SVGElement>('[data-geometry-role]').forEach((geometry) => {
              const tagName = geometry.tagName.toLowerCase();
              const role = geometry.getAttribute('data-geometry-role');
              if (
                tagName === 'text'
                || role?.startsWith('bars-pattern-candle')
                || role?.startsWith('ghost-feed-candle')
              ) return;
              const hitTarget = geometry.cloneNode(false) as SVGElement;
              hitTarget.removeAttribute('data-geometry-role');
              if (role) hitTarget.setAttribute('data-geometry-hit-for', role);
              hitTarget.setAttribute('fill', 'transparent');
              hitTarget.setAttribute('stroke', 'transparent');
              hitTarget.style.opacity = '1';
              hitTarget.style.cursor = 'move';
              const isFilledArea = ['rect', 'polygon', 'circle', 'ellipse'].includes(tagName)
                || (tagName === 'path' && geometry.getAttribute('fill') !== 'none');
              if (isFilledArea) {
                hitTarget.setAttribute('pointer-events', 'all');
              } else {
                hitTarget.setAttribute('stroke-width', '12');
                hitTarget.setAttribute('pointer-events', 'stroke');
              }
              const dragNodeIndex = role?.startsWith('bars-pattern-candle')
                || role === 'bars-pattern-ghost-path'
                ? 2
                : role?.endsWith('-target')
                  || role?.endsWith('-target-handle')
                  || role?.includes('-target-label')
                  ? -10
                  : role?.endsWith('-stop')
                    || role?.endsWith('-stop-handle')
                    || role?.includes('-stop-label')
                    ? -11
                    : role?.endsWith('-duration-edge') || role?.endsWith('-width-handle')
                      ? -12
                      : null;
              hitTarget.addEventListener('pointerdown', (event) => {
                this.options.beginDrag(event as PointerEvent, d.id, dragNodeIndex);
              });
              hitTarget.addEventListener('contextmenu', (event) => this.options.onContextMenu(event, d.id));
              g.appendChild(hitTarget);
            });
          }
          if (!isPreview && d.selected) {
            this.options.appendForecastingScaleHighlights(
              g, d, Math.max(0, W - (this.options.getChart()?.priceScale('right').width() ?? 0)),
              Math.max(0, H - (this.options.getChart()?.timeScale().height() ?? 0)), true,
            );
          }
          break;
        }

        if (d.points.length < 2) break;
        const p1 = this.options.px(d.points[0]);
        const p2 = this.options.px(d.points[1]);
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
        g.appendChild(this.options.svgLine(p1.x, p1.y, p2.x, p2.y, color, 1, 'dashed'));

        const priceDiff = Math.abs(d.points[1].price - d.points[0].price);
        const pricePct = d.points[0].price !== 0
          ? ((d.points[1].price - d.points[0].price) / d.points[0].price * 100)
          : 0;
        const ts = this.options.getChart()!.timeScale();
        const l1 = ts.coordinateToLogical(p1.x);
        const l2 = ts.coordinateToLogical(p2.x);
        const bars = l1 !== null && l2 !== null ? Math.abs(Math.round(l2 - l1)) : 0;
        const labelText = `${bars} bars | ${priceDiff.toFixed(5)} pts | ${pricePct >= 0 ? '+' : ''}${pricePct.toFixed(2)}%`;

        const lbl = this.options.svgText(
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
        const p1 = this.options.px(d.points[0]);
        const p2 = this.options.px(d.points[1]);
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
        const p1 = this.options.px(d.points[0]);
        const p2 = this.options.px(d.points[1]);
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
        if (!this.options.getChart() || !this.options.getSeries() || !d.points.length) break;
        const pts = d.points.map(p => projectFreehandPoint(this.options.getChart()!, this.options.getSeries()!, p)).filter((p): p is { x: number; y: number } => p !== null);
        if (!pts.length) break;

        const pathData = freehandPath(pts);
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('data-geometry-role', 'brush-stroke');
        path.setAttribute('d', pathData);
        path.setAttribute('stroke', color);
        path.setAttribute('stroke-width', String(lw));
        path.setAttribute('fill', d.fillColor || 'none');
        if (d.subtype === 'highlighter') path.setAttribute('stroke-opacity', String(d.fillOpacity ?? .3));
        path.setAttribute('fill-opacity', String(d.fillOpacity ?? .2));
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        if (d.lineStyle === 'dashed') path.setAttribute('stroke-dasharray', '8 4');
        if (d.lineStyle === 'dotted') path.setAttribute('stroke-dasharray', '2 4');
        path.style.opacity = opacity;
        const clip = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
        clip.id = `brush-clip-${this.options.getContextId()}-${d.id}`.replace(/[^a-zA-Z0-9_-]/g, '_');
        const bounds = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        bounds.setAttribute('width', String(Math.max(0, W - this.options.getChart().priceScale('right').width())));
        bounds.setAttribute('height', String(Math.max(0, H - this.options.getChart().timeScale().height())));
        clip.appendChild(bounds);
        g.appendChild(clip);
        path.setAttribute('clip-path', `url(#${clip.id})`);
        g.appendChild(path);
        if (!isPreview) {
          const hit = path.cloneNode(false) as SVGPathElement;
          hit.setAttribute('data-geometry-role', 'brush-hit');
          hit.setAttribute('stroke', 'transparent');
          hit.setAttribute('fill', 'none');
          hit.setAttribute('stroke-width', String(Math.max(12, lw + 8)));
          hit.removeAttribute('stroke-dasharray');
          hit.setAttribute('pointer-events', 'stroke');
          hit.style.cursor = d.locked ? 'default' : 'move';
          hit.addEventListener('pointerdown', event => this.options.beginDrag(event, d.id, null));
          g.appendChild(hit);
        }
        if (isPreview || d.selected) {
          this.options.appendSelectionScaleBands(g, pts,
            Math.max(0, W - this.options.getChart().priceScale('right').width()),
            Math.max(0, H - this.options.getChart().timeScale().height()));
        }
        break;
      }

      // ─── Text ────────────────────────────────────────────────────
      case 'text':
      case 'callout':
      case 'stamp': {
        this.options.renderAnnotation(g, d, W, H, isPreview, color, lw, dash, opacity);
        break;
      }
      default: break;
    }

    // ─── Selection handles & drag on completed drawings ──────────
    this.options.renderSelection(g, d, W, H, isPreview, color);

    // Make whole group clickable (select on click when not in drawing mode)
    if (!isPreview) {
      g.setAttribute('pointer-events', 'auto');
      g.style.cursor = 'pointer';
      g.addEventListener('click', e => {
        e.stopPropagation();
        this.options.activateContextFromEventTarget(e.target);
        this.options.selectDrawing(d.id, e.ctrlKey || e.metaKey);
      });
      g.addEventListener('contextmenu', e => this.options.onContextMenu(e, d.id));
    }

    svg.appendChild(g);
  }

  // ──────────────────────────────────────────────
  // SVG Element Helpers
  // ──────────────────────────────────────────────
}
