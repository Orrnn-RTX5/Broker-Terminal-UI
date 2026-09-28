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

import { type IChartApi, type ISeriesApi, type SeriesType } from 'lightweight-charts';
import {
  buildDrawingContextKey,
  type DrawingContextIdentity,
} from '../drawing-tools/contextKey';
import type {
  Drawing,
  DrawingCollectionChangeDetail,
  DrawingCollectionChangeReason,
  DrawingHistoryEntry,
  DrawingPoint,
  DrawingSeriesDataPoint,
  DrawingSeriesDataProvider,
  DrawingType,
} from '../drawing-tools/model/drawing';
import {
  DrawingContextRegistry,
  type ChartContext,
} from '../drawing-tools/runtime/DrawingContextRegistry';
import { DrawingDocumentStore } from '../drawing-tools/runtime/DrawingDocumentStore';
import { DrawingPersistenceCoordinator } from '../drawing-tools/runtime/DrawingPersistenceCoordinator';
import { DrawingGlobalEventBindings } from '../drawing-tools/runtime/DrawingGlobalEventBindings';
import { applyDrawingDragUpdate } from '../drawing-tools/runtime/applyDrawingDragUpdate';
import { DrawingGeometryRuntime } from '../drawing-tools/runtime/DrawingGeometryRuntime';
import { ensureDrawingSvgOverlay } from '../drawing-tools/runtime/drawingSvgOverlay';
import {
  DrawingAxisOverlayRenderer,
  DRAWING_AXIS_OVERLAY_ATTRIBUTE,
  segmentMidpoint,
} from '../drawing-tools/rendering/DrawingAxisOverlayRenderer';
import { DrawingTrendChannelRenderer } from '../drawing-tools/rendering/DrawingTrendChannelRenderer';
import { DrawingSelectionRenderer } from '../drawing-tools/rendering/DrawingSelectionRenderer';
import { DrawingAnnotationRenderer } from '../drawing-tools/rendering/DrawingAnnotationRenderer';
import { DrawingSvgRenderer } from '../drawing-tools/rendering/DrawingSvgRenderer';
import { getTrendLineToolFromDrawing } from '../drawing-tools/toolCatalog';
import { getGannFibonacciTool } from '../drawing-tools/gannFibonacciToolCatalog';
import { getChartPatternTool } from '../drawing-tools/chartPatternToolCatalog';
import { isPictographStamp } from '../drawing-tools/pictographCatalog';
import { getBrushShapeTool } from '../drawing-tools/brushShapeToolCatalog';
import { defaultCurveBend, defaultDoubleCurveBends } from '../drawing-tools/brushShapeGeometry';
import { freehandPointAt, projectFreehandPoint } from '../drawing-tools/geometry/freehandGeometry';
import {
  getTrendToolRuntimeDefaults,
} from '../drawing-tools/toolDefaults';
import { getForecastingMeasurementTool } from '../drawing-tools/forecastingMeasurementToolCatalog';
import { getAnnotationTool, annotationTable } from '../drawing-tools/annotationToolCatalog';

export type {
  AnnotationStyle,
  Drawing,
  DrawingCollectionChangeDetail,
  DrawingCollectionChangeReason,
  DrawingPoint,
  DrawingSeriesDataPoint,
  DrawingSeriesDataProvider,
  DrawingType,
  PositionSizing,
  RegressionSource,
} from '../drawing-tools/model/drawing';
export type { ChartContext } from '../drawing-tools/runtime/DrawingContextRegistry';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────
/**
 * Stamp tools are persisted as `type: "stamp"` plus a subtype. These are the
 * stamp subtypes that represent directional arrows; deleting the legacy
 * `shapes` bucket would also remove unrelated objects and is therefore unsafe.
 */
export const ARROW_STAMP_SUBTYPES = [
  'arrowUp',
  'arrowDown',
  'arrow',
  'buy',
  'sell',
] as const;

const ARROW_STAMP_SUBTYPE_SET = new Set<string>(ARROW_STAMP_SUBTYPES);

export const isArrowDrawing = (drawing: Pick<Drawing, 'type' | 'subtype'>): boolean =>
  drawing.type === 'stamp'
  && typeof drawing.subtype === 'string'
  && ARROW_STAMP_SUBTYPE_SET.has(drawing.subtype);

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
  pattern: 5,
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
  getAnnotationTool(drawing)?.requiredPoints
  ?? getChartPatternTool(drawing)?.requiredPoints
  ?? getBrushShapeTool(drawing)?.requiredPoints
  ?? getTrendLineToolFromDrawing(drawing.type, drawing.subtype)?.requiredPoints
  ?? (drawing.type === 'measure'
    ? getForecastingMeasurementTool(drawing.subtype)?.requiredPoints
    : undefined)
  ?? REQUIRED_POINTS[drawing.type];

// ──────────────────────────────────────────────
// Class
// ──────────────────────────────────────────────
export class DrawingManager {
  private readonly documents = new DrawingDocumentStore();
  private activeDrawing: Drawing | null = null;
  private activeDrawingOwner: DrawingContextIdentity | null = null;
  private previewPoint: DrawingPoint | null = null;
  private previewCursorVisible = false;
  private rawTrendlinePreviewPoint: DrawingPoint | null = null;
  private magnetMode: 'off' | 'weak' | 'strong' = 'off';
  private snapToIndicatorsEnabled = false;
  private magnetSnapSources: Map<string, (time: number) => number[]> = new Map();
  private hiddenDrawingContexts: Set<string> = new Set();

  private readonly chartContexts = new DrawingContextRegistry();
  private activeContainer: HTMLElement | null = null;

  private chart: IChartApi | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private currentContextId: string | null = null;
  private currentSymbol: string | null = null;
  private currentTimeframe: string = 'M1'; // default matches app default timeframe
  private currentAccountScope: string | undefined;
  private renderSeriesDataCache: DrawingSeriesDataPoint[] | null = null;
  private readonly geometryRuntime = new DrawingGeometryRuntime({
    getChart: () => this.chart,
    getSeries: () => this.series,
    getTimeframe: () => this.currentTimeframe,
    getContainerHeight: () => this.activeContainer?.clientHeight ?? 0,
    getMinMove: () => this.getSeriesPriceFormat().minMove,
    resolveOwnerContext: owner => {
      const context = this.resolveTargetContextEntry(owner.contextId, owner)?.[1];
      return context
        ? { series: context.series, seriesDataProvider: context.seriesDataProvider }
        : null;
    },
  });
  private readonly axisOverlay = new DrawingAxisOverlayRenderer({
    getChart: () => this.chart,
    getSeries: () => this.series,
    getOverlayContainer: () => this.overlayContainer,
    projectPoint: point => this.px(point),
    resolvePositionDefaults: drawing => this.resolvePositionDefaults(drawing),
    getSeriesData: () => this.getSeriesDataForActiveContext(),
  });
  private readonly getSeriesPriceFormat = this.axisOverlay.getSeriesPriceFormat.bind(this.axisOverlay);
  private readonly formatPrice = this.axisOverlay.formatPrice.bind(this.axisOverlay);
  private readonly formatTimeScaleValue = this.axisOverlay.formatTimeScaleValue.bind(this.axisOverlay);
  private readonly getThemeToken = this.axisOverlay.getThemeToken.bind(this.axisOverlay);
  private readonly appendAnnotationScaleHighlights = this.axisOverlay.appendAnnotationScaleHighlights.bind(this.axisOverlay);
  private readonly appendSelectionScaleBands = this.axisOverlay.appendSelectionScaleBands.bind(this.axisOverlay);
  private readonly appendForecastingScaleHighlights = this.axisOverlay.appendForecastingScaleHighlights.bind(this.axisOverlay);
  private readonly appendPriceScaleRangeBand = this.axisOverlay.appendPriceScaleRangeBand.bind(this.axisOverlay);
  private readonly appendPriceScaleLabel = this.axisOverlay.appendPriceScaleLabel.bind(this.axisOverlay);
  private readonly appendTimeScaleRangeBand = this.axisOverlay.appendTimeScaleRangeBand.bind(this.axisOverlay);
  private readonly appendTimeScaleLabel = this.axisOverlay.appendTimeScaleLabel.bind(this.axisOverlay);
  private readonly segmentMidpoint = segmentMidpoint;
  private readonly trendChannelRenderer = new DrawingTrendChannelRenderer({
    getChart: () => this.chart,
    getSeries: () => this.series,
    getPreviewPoint: () => this.previewPoint,
    isPreviewCursorVisible: () => this.previewCursorVisible,
    getSeriesData: () => this.getSeriesDataForActiveContext(),
    projectPoint: point => this.px(point),
    formatPrice: price => this.formatPrice(price),
    getThemeToken: (name, fallback) => this.getThemeToken(name, fallback),
    appendPriceScaleRangeBand: (...args) => this.appendPriceScaleRangeBand(...args),
    appendPriceScaleLabel: (...args) => this.appendPriceScaleLabel(...args),
    appendTimeScaleLabel: (...args) => this.appendTimeScaleLabel(...args),
    createLine: (...args) => this.svgLine(...args),
    createText: (...args) => this.svgText(...args),
    beginDrag: (event, drawingId, nodeIndex) => this.beginDrag(event, drawingId, nodeIndex),
    openContextMenu: (event, drawingId) => this.onContextMenu(event, drawingId),
  });
  private readonly getTrendChannelGeometry = this.trendChannelRenderer.getTrendChannelGeometry.bind(this.trendChannelRenderer);
  private readonly appendChannelScaleLabels = this.trendChannelRenderer.appendChannelScaleLabels.bind(this.trendChannelRenderer);
  private readonly appendDrawingAddTextPrompt = this.trendChannelRenderer.appendDrawingAddTextPrompt.bind(this.trendChannelRenderer);
  private readonly appendTrendSelectionHandle = this.trendChannelRenderer.appendTrendSelectionHandle.bind(this.trendChannelRenderer);
  private readonly appendInfoLinePanel = this.trendChannelRenderer.appendInfoLinePanel.bind(this.trendChannelRenderer);
  private readonly renderTrendChannelVariant = this.trendChannelRenderer.renderTrendChannelVariant.bind(this.trendChannelRenderer);
  private readonly getRegressionSegments = this.trendChannelRenderer.getRegressionSegments.bind(this.trendChannelRenderer);
  private readonly selectionRenderer = new DrawingSelectionRenderer({
    getChart: () => this.chart,
    getSeries: () => this.series,
    projectPoint: point => this.px(point),
    shapeAnchorScreen: (drawing, index) => this.shapeAnchorScreen(drawing, index),
    shapeLabelTime: (point, x) => this.shapeLabelTime(point, x),
    beginDrag: (event, drawingId, nodeIndex) => this.beginDrag(event, drawingId, nodeIndex),
    appendAnnotationScaleHighlights: (...args) => this.appendAnnotationScaleHighlights(...args),
    appendSelectionScaleBands: (...args) => this.appendSelectionScaleBands(...args),
    appendPriceScaleRangeBand: (...args) => this.appendPriceScaleRangeBand(...args),
    appendPriceScaleLabel: (...args) => this.appendPriceScaleLabel(...args),
    appendTimeScaleRangeBand: (...args) => this.appendTimeScaleRangeBand(...args),
    appendTimeScaleLabel: (...args) => this.appendTimeScaleLabel(...args),
    appendChannelScaleLabels: (...args) => this.appendChannelScaleLabels(...args),
    appendDrawingAddTextPrompt: (...args) => this.appendDrawingAddTextPrompt(...args),
    appendTrendSelectionHandle: (...args) => this.appendTrendSelectionHandle(...args),
    getTrendChannelGeometry: (...args) => this.getTrendChannelGeometry(...args),
    getRegressionSegments: drawing => this.getRegressionSegments(drawing),
    segmentMidpoint: segment => this.segmentMidpoint(segment),
  });
  private readonly annotationRenderer = new DrawingAnnotationRenderer({
    projectPoint: point => this.px(point),
    formatPrice: price => this.formatPrice(price),
    getThemeToken: (name, fallback) => this.getThemeToken(name, fallback),
    createLine: (...args) => this.svgLine(...args),
    createText: (...args) => this.svgText(...args),
    beginDrag: (event, drawingId, nodeIndex) => this.beginDrag(event, drawingId, nodeIndex),
    openContextMenu: (event, drawingId) => this.onContextMenu(event, drawingId),
    editAnnotation: drawingId => this.editAnnotation(drawingId),
  });
  private readonly svgDrawingRenderer = new DrawingSvgRenderer({
    getChart: () => this.chart,
    getSeries: () => this.series,
    getContextId: () => this.currentContextId,
    px: point => this.px(point),
    toDashArray: (style, lineWidth) => this.toDashArray(style, lineWidth),
    svgLine: (...args) => this.svgLine(...args),
    svgText: (...args) => this.svgText(...args),
    beginDrag: (event, drawingId, nodeIndex) => this.beginDrag(event, drawingId, nodeIndex),
    onContextMenu: (event, drawingId) => this.onContextMenu(event, drawingId),
    activateContextFromEventTarget: target => this.activateContextFromEventTarget(target),
    selectDrawing: (drawingId, multi) => this.selectDrawing(drawingId, multi),
    getSeriesPriceFormat: () => this.getSeriesPriceFormat(),
    formatPrice: price => this.formatPrice(price),
    formatTimeScaleValue: time => this.formatTimeScaleValue(time),
    appendForecastingScaleHighlights: (...args) => this.appendForecastingScaleHighlights(...args),
    appendPriceScaleLabel: (...args) => this.appendPriceScaleLabel(...args),
    appendSelectionScaleBands: (...args) => this.appendSelectionScaleBands(...args),
    appendTimeScaleLabel: (...args) => this.appendTimeScaleLabel(...args),
    appendInfoLinePanel: (...args) => this.appendInfoLinePanel(...args),
    renderTrendChannelVariant: (...args) => this.renderTrendChannelVariant(...args),
    getSeriesDataForActiveContext: () => this.getSeriesDataForActiveContext(),
    resolvePositionDefaults: drawing => this.resolvePositionDefaults(drawing),
    renderAnnotation: (...args) => this.annotationRenderer.render(...args),
    renderSelection: (...args) => this.selectionRenderer.render(...args),
  });

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
    return this.documents.get(key);
  }

  private set drawings(val: Drawing[]) {
    const key = this.currentDrawingContextKey;
    if (key) this.documents.replace(key, val);
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

  private get undoStack(): DrawingHistoryEntry[] {
    const key = this.currentDrawingContextKey || 'legacy';
    return this.documents.undoStack(key);
  }

  private get redoStack(): DrawingHistoryEntry[] {
    const key = this.currentDrawingContextKey || 'legacy';
    return this.documents.redoStack(key);
  }

  private getUndoStackFor(identity: DrawingContextIdentity): DrawingHistoryEntry[] {
    return this.documents.undoStack(buildDrawingContextKey(identity));
  }

  private getRedoStackFor(identity: DrawingContextIdentity): DrawingHistoryEntry[] {
    return this.documents.redoStack(buildDrawingContextKey(identity));
  }

  private getDrawingsFor(identity: DrawingContextIdentity): Drawing[] {
    return this.documents.get(buildDrawingContextKey(identity));
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
    const targetEntry = this.resolveTargetContextEntry(identity.contextId, identity);
    if (!targetEntry) return false;
    this.activateContext(targetEntry[0], targetEntry[1]);
    return true;
  }

  /**
   * Resolve duplicate registrations deterministically. React remounts can leave
   * an older container registered briefly, so insertion-order-first lookup may
   * target a detached chart that happens to share the same context id.
   */
  private resolveTargetContextEntry(
    contextId: string,
    expectedIdentity?: DrawingContextIdentity,
  ): [HTMLElement, ChartContext] | null {
    return this.chartContexts.resolve(contextId, this.activeContainer, expectedIdentity);
  }

  private resolveTargetContextIdentity(contextId?: string): DrawingContextIdentity | null {
    if (!contextId) return this.currentContextIdentity;
    const targetEntry = this.resolveTargetContextEntry(contextId);
    return targetEntry ? this.identityForContext(targetEntry[1]) : null;
  }

  /**
   * Runs an operation against one registered chart without leaving that chart
   * as the manager's implicit active context. This is important for dialogs and
   * menu commands that may operate on a background dock tab.
   */
  private withTargetContext<T>(
    targetContextId: string | undefined,
    operation: (identity: DrawingContextIdentity) => T,
  ): T | undefined {
    if (!targetContextId) {
      const identity = this.currentContextIdentity;
      return identity ? operation(identity) : undefined;
    }

    const targetEntry = this.resolveTargetContextEntry(targetContextId);
    if (!targetEntry) return undefined;

    const previous = {
      activeContainer: this.activeContainer,
      chart: this.chart,
      series: this.series,
      currentContextId: this.currentContextId,
      currentSymbol: this.currentSymbol,
      currentTimeframe: this.currentTimeframe,
      currentAccountScope: this.currentAccountScope,
    };
    const [container, context] = targetEntry;
    this.activateContext(container, context);

    try {
      return operation(this.identityForContext(context));
    } finally {
      this.activeContainer = previous.activeContainer;
      this.chart = previous.chart;
      this.series = previous.series;
      this.currentContextId = previous.currentContextId;
      this.currentSymbol = previous.currentSymbol;
      this.currentTimeframe = previous.currentTimeframe;
      this.currentAccountScope = previous.currentAccountScope;
    }
  }

  private dispatchDrawingsChanged(
    identity: DrawingContextIdentity,
    reason: DrawingCollectionChangeReason,
  ): void {
    window.dispatchEvent(new CustomEvent<DrawingCollectionChangeDetail>('drawings:changed', {
      detail: {
        contextId: identity.contextId,
        symbol: identity.symbol,
        timeframe: identity.timeframe,
        accountScope: identity.accountScope,
        reason,
      },
    }));
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
  private readonly globalEventBindings: DrawingGlobalEventBindings;
  private readonly persistence: DrawingPersistenceCoordinator;

  constructor() {
    this.persistence = new DrawingPersistenceCoordinator({
      documents: this.documents,
      getCurrentIdentity: () => this.currentContextIdentity,
      getCurrentTimeframe: () => this.currentTimeframe,
      getDrawings: identity => this.getDrawingsFor(identity),
      resolveContextIdentity: contextId => this.resolveTargetContextIdentity(contextId),
      renderAll: () => this.renderAll(),
      dispatchChanged: (identity, reason) => this.dispatchDrawingsChanged(identity, reason),
    });
    this.globalEventBindings = new DrawingGlobalEventBindings(window, {
      pointerMove: this.onGlobalPointerMove,
      pointerUp: this.onGlobalPointerUp,
      undo: contextId => this.undo(contextId),
      redo: contextId => this.redo(contextId),
      deleteSelected: contextId => this.deleteSelected(contextId),
      deleteLast: contextId => this.deleteLast(contextId),
    });
  }

  /** Release manager-owned global listeners when an instance is retired. */
  dispose(): void {
    this.globalEventBindings.dispose();
    this.draggingScrollLockCallbacks?.unlock();
    this.resetDragState();
  }

  // ──────────────────────────────────────────────
  // Setup
  // ──────────────────────────────────────────────
  setChart(
    chart: IChartApi | null,
    series: ISeriesApi<SeriesType> | null,
    symbol: string | null = null,
    _accountId = 1,
    overlayContainer?: HTMLElement | null,
    timeframe?: string,
    contextId?: string,
    accountScope?: string,
    seriesDataProvider?: DrawingSeriesDataProvider,
  ): void {
    void _accountId; // Preserve the legacy positional API while accountScope owns isolation.
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
    if (!this.documents.has(drawingContextKey)) {
      this.documents.replace(drawingContextKey, []);
    }

    this.renderAll();
    if (nextSymbol && this.documents.markLoaded(drawingContextKey)) {
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
    context.svgOverlay = ensureDrawingSvgOverlay(container, context.svgOverlay);
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

  setMagnetMode(mode: 'off' | 'weak' | 'strong'): void {
    this.magnetMode = mode;
  }

  setSnapToIndicators(enabled: boolean): void {
    this.snapToIndicatorsEnabled = enabled;
  }

  /** Resolves the hovered candle from the owning chart's rendered series data. */
  private resolveMagnetSeriesData(time: number): DrawingSeriesDataPoint | null {
    const ownerContextId = this.activeDrawingOwner?.contextId ?? this.currentContextId;
    if (!ownerContextId) return null;
    for (const context of this.chartContexts.values()) {
      if (context.contextId !== ownerContextId || !context.seriesDataProvider) continue;
      const candles = context.seriesDataProvider();
      if (!candles.length) return null;
      let leftIndex = 0;
      let rightIndex = candles.length - 1;
      while (rightIndex - leftIndex > 1) {
        const mid = (leftIndex + rightIndex) >> 1;
        if (Number(candles[mid].time) <= time) leftIndex = mid;
        else rightIndex = mid;
      }
      return Math.abs(Number(candles[leftIndex].time) - time) <= Math.abs(Number(candles[rightIndex].time) - time)
        ? candles[leftIndex]
        : candles[rightIndex];
    }
    return null;
  }

  private snapMagnetPrice(
    time: number,
    price: number,
    seriesData?: { open?: number; high?: number; low?: number; close?: number } | null,
  ): number {
    if (this.magnetMode === 'off') return price;
    const data = seriesData ?? this.resolveMagnetSeriesData(time);
    if (!data) return price;
    const candidates = [data.open, data.high, data.low, data.close]
      .filter((p): p is number => typeof p === 'number');
    if (this.snapToIndicatorsEnabled) {
      const snapSource = this.magnetSnapSources.get(this.activeDrawingOwner?.contextId ?? '');
      if (snapSource) {
        candidates.push(...snapSource(time).filter((p) => typeof p === 'number' && Number.isFinite(p)));
      }
    }
    if (!candidates.length) return price;
    const nearest = candidates.reduce((best, p) =>
      Math.abs(p - price) < Math.abs(best - price) ? p : best,
    );
    const candleRange = typeof data.high === 'number' && typeof data.low === 'number'
      ? data.high - data.low
      : 0;
    const withinWeakRange = candleRange > 0
      ? Math.abs(nearest - price) <= candleRange
      : nearest === price;
    return this.magnetMode === 'strong' || withinWeakRange ? nearest : price;
  }

  /** Registers extra snap candidates (e.g. indicator levels) for one chart context. */
  registerMagnetSnapSource(contextId: string, source: (time: number) => number[]): () => void {
    this.magnetSnapSources.set(contextId, source);
    return () => {
      if (this.magnetSnapSources.get(contextId) === source) {
        this.magnetSnapSources.delete(contextId);
      }
    };
  }

  setAllDrawingsLocked(locked: boolean, targetContextId?: string): number {
    let changed = 0;
    this.getDrawings(targetContextId).forEach((drawing) => {
      if (drawing.locked === locked) return;
      drawing.locked = locked;
      changed += 1;
    });
    if (changed > 0) {
      this.persistCurrentContext(targetContextId);
      this.renderAll();
    }
    return changed;
  }

  setDrawingsVisible(contextId: string, visible: boolean): void {
    const wasHidden = this.hiddenDrawingContexts.has(contextId);
    if (visible) {
      this.hiddenDrawingContexts.delete(contextId);
    } else {
      this.hiddenDrawingContexts.add(contextId);
    }
    if (wasHidden === visible) this.renderAll();
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
    const patternTool = getChartPatternTool(this.activeDrawing);
    if (patternTool?.background) {
      this.activeDrawing.fillColor = color;
      this.activeDrawing.fillOpacity = patternTool.id === 'time_cycles' ? .3 : .12;
    }
    if (type === 'shapes' && meta?.subtype === 'arrow_mark_up') this.activeDrawing.color = '#089981';
    if (getBrushShapeTool(this.activeDrawing)?.background && getBrushShapeTool(this.activeDrawing)?.defaultFill !== false) {
      this.activeDrawing.fillColor = color;
      this.activeDrawing.fillOpacity = .2;
    }
    if (type === 'shapes' && meta?.subtype === 'arrow_mark_down') this.activeDrawing.color = '#f23645';
    if (type === 'freehand' && meta?.subtype === 'highlighter') {
      this.activeDrawing.lineWidth = 20;
      this.activeDrawing.fillOpacity = .3;
    }
    this.activeDrawingOwner = this.currentContextIdentity
      ? { ...this.currentContextIdentity }
      : {
        contextId: 'legacy:detached',
        symbol: 'UNKNOWN',
        timeframe: this.currentTimeframe,
      };
    this.previewPoint = null;
    this.rawTrendlinePreviewPoint = null;
    if (
      getTrendLineToolFromDrawing(this.activeDrawing.type, this.activeDrawing.subtype)
      && this.getDrawingsFor(this.activeDrawingOwner).some(drawing => drawing.selected)
    ) {
      this.unselectAll(this.activeDrawingOwner.contextId);
    }
    this.renderAll();
    return id;
  }

  cancelDrawing(contextId?: string): void {
    if (contextId && this.activeDrawingOwner?.contextId !== contextId) return;
    const cancelledOwner = this.activeDrawingOwner;
    this.activeDrawing = null;
    this.activeDrawingOwner = null;
    this.previewPoint = null;
    this.rawTrendlinePreviewPoint = null;
    this.renderAll();
    if (cancelledOwner) {
      window.dispatchEvent(new CustomEvent('drawing:cancelled', {
        detail: { ...cancelledOwner },
      }));
    }
  }

  /**
   * Called on every chart click while a drawing tool is active.
   * Returns true when the drawing is complete.
   */
  addPoint(
    time: number,
    price: number,
    seriesData?: { open?: number; high?: number; low?: number; close?: number } | null,
    contextId?: string,
    logicalIndex?: number,
    shiftPressed = false,
  ): boolean {
    if (!this.activeDrawing) return false;
    if (contextId && this.activeDrawingOwner?.contextId !== contextId) return false;

    // Magnet snap to OHLC (and indicator levels when enabled). Weak mode only
    // snaps while the cursor stays within the hovered candle's range.
    let finalPrice = this.snapMagnetPrice(time, price, seriesData);

    let finalTime = time;
    let finalLogicalIndex = Number.isFinite(logicalIndex) ? logicalIndex : undefined;
    if (shiftPressed && this.canConstrainTrendline(this.activeDrawing)) {
      const projected = this.projectTrendlinePoint(this.activeDrawing, {
        time: finalTime,
        price: finalPrice,
        ...(finalLogicalIndex !== undefined ? { logicalIndex: finalLogicalIndex } : {}),
      });
      finalTime = projected.time;
      finalPrice = projected.price;
      finalLogicalIndex = projected.logicalIndex;
    }
    if (this.activeDrawing.type === 'measure' && this.activeDrawing.subtype === 'sector') {
      const pointIndex = this.activeDrawing.points.length;
      const origin = this.activeDrawing.points[0];
      const radiusPoint = this.activeDrawing.points[1];
      if (pointIndex === 2 && origin && radiusPoint) {
        // Click three selects the angle. TradingView projects it onto the exact
        // circular radius established by click two while retaining that angle.
        const projected = this.projectSectorPoint(this.activeDrawing, {
          time: finalTime,
          price: finalPrice,
          ...(finalLogicalIndex !== undefined ? { logicalIndex: finalLogicalIndex } : {}),
        });
        finalTime = projected.time;
        finalPrice = projected.price;
        finalLogicalIndex = projected.logicalIndex;
      }
    }

    if (
      this.activeDrawing.subtype === 'fib_wedge'
      && this.activeDrawing.points.length === 2
    ) {
      const projected = this.projectFibWedgePoint(this.activeDrawing, {
        time: finalTime,
        price: finalPrice,
        ...(finalLogicalIndex !== undefined ? { logicalIndex: finalLogicalIndex } : {}),
      });
      finalTime = projected.time;
      finalPrice = projected.price;
      finalLogicalIndex = projected.logicalIndex;
    }

    const nextShapePoint = this.anchorShapePoint(this.activeDrawing, this.clampRegressionPoint(this.activeDrawing, {
      time: finalTime,
      price: finalPrice,
      ...(finalLogicalIndex !== undefined ? { logicalIndex: finalLogicalIndex } : {}),
    }, this.activeDrawingOwner));
    const isOpenEnded = getBrushShapeTool(this.activeDrawing)?.requiredPoints === 0
      || (this.activeDrawing.type === 'measure' && this.activeDrawing.subtype === 'ghost_feed');
    if (isOpenEnded && this.activeDrawing.points.length) {
      const previous = this.px(this.activeDrawing.points.at(-1)!);
      const next = this.px(nextShapePoint);
      // The second press of a double-click must not create a duplicate vertex.
      if (previous && next && Math.hypot(previous.x - next.x, previous.y - next.y) < 1) return false;
    }
    if (this.activeDrawing.type === 'pattern' && this.activeDrawing.subtype === 'time_cycles' && this.activeDrawing.points[0]) {
      nextShapePoint.price = this.activeDrawing.points[0].price;
    }
    this.activeDrawing.points.push(nextShapePoint);
    this.rawTrendlinePreviewPoint = null;
    if (
      this.activeDrawing.type === 'measure'
      && this.activeDrawing.subtype === 'bars_pattern'
      && this.activeDrawing.points.length === 2
    ) {
      // Freeze the selected candles as soon as the source range is complete.
      // The third click only positions that already-captured pattern.
      this.refreshBarsPatternSnapshot(this.activeDrawing);
    }
    const required = requiredPointsForDrawing(this.activeDrawing);
    // A preview sampled before this click belongs to the previous phase. Keep
    // continuous drawings visible by using the just-recorded point as their
    // live endpoint. Info line also shows zero measurements at its first click.
    const showInitialInfoMetrics = this.activeDrawing.type === 'trendline'
      && this.activeDrawing.subtype === 'info_line'
      && this.activeDrawing.points.length === 1;
    this.previewPoint = required === 0 || showInitialInfoMetrics
      ? { ...this.activeDrawing.points[this.activeDrawing.points.length - 1] }
      : null;
    if (required > 0 && this.activeDrawing.points.length >= required) {
      if (this.activeDrawing.type === 'shapes' && ['curve', 'double_curve'].includes(this.activeDrawing.subtype!) && this.activeDrawing.points.length === 2 && this.chart && this.series) {
        const [a, b] = this.activeDrawing.points.map(point => this.px(point));
        if (a && b) {
          const bends = this.activeDrawing.subtype === 'curve' ? [defaultCurveBend(a, b)] : defaultDoubleCurveBends(a, b);
          bends.forEach(bend => {
            const anchor = freehandPointAt(this.chart!, this.series!, bend.x, bend.y);
            if (anchor) this.activeDrawing!.points.push(anchor);
          });
        }
      }
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
  updatePreviewPoint(
    time: number,
    price: number,
    contextId?: string,
    logicalIndex?: number,
    shiftPressed = false,
  ): void {
    if (contextId && this.activeDrawingOwner?.contextId !== contextId) return;
    if (!this.activeDrawing) {
      if (this.previewPoint) {
        this.previewPoint = null;
        this.renderAll();
      }
      return;
    }
    // Always update — both before first click (ghost preview) and after
    const candidatePreview: DrawingPoint = this.anchorShapePoint(this.activeDrawing, {
      time,
      price: this.snapMagnetPrice(time, price),
      ...(Number.isFinite(logicalIndex) ? { logicalIndex } : {}),
    });
    if (this.activeDrawing.type === 'pattern' && this.activeDrawing.subtype === 'time_cycles' && this.activeDrawing.points[0]) {
      candidatePreview.price = this.activeDrawing.points[0].price;
    }
    this.previewCursorVisible = true;
    this.rawTrendlinePreviewPoint = this.canConstrainTrendline(this.activeDrawing)
      ? candidatePreview
      : null;
    this.previewPoint = this.activeDrawing.points.length === 2
      && this.activeDrawing.subtype === 'fib_wedge'
      ? this.projectFibWedgePoint(this.activeDrawing, candidatePreview)
      : this.activeDrawing.points.length === 2
        && this.activeDrawing.type === 'measure'
        && this.activeDrawing.subtype === 'sector'
        ? this.projectSectorPoint(this.activeDrawing, candidatePreview)
        : shiftPressed && this.canConstrainTrendline(this.activeDrawing)
          ? this.projectTrendlinePoint(this.activeDrawing, candidatePreview)
          : this.clampRegressionPoint(this.activeDrawing, candidatePreview, this.activeDrawingOwner);
    this.renderAll();
  }

  /** Raw pointer samples bypass candle snapping and chart crosshair throttling. */
  addFreehandPoint(x: number, y: number, contextId: string, force = false): boolean {
    const drawing = this.getActiveDrawing(contextId);
    if (drawing?.type !== 'freehand' || !this.chart || !this.series) return false;
    const point = freehandPointAt(this.chart, this.series, x, y);
    if (!point) return false;
    const last = drawing.points.at(-1);
    const previous = last ? projectFreehandPoint(this.chart, this.series, last) : null;
    if (previous && Math.hypot(x - previous.x, y - previous.y) < (force ? .001 : .75)) return false;
    drawing.points.push(point);
    this.previewPoint = point;
    this.renderAll();
    return true;
  }

  /** Hide the moving coordinate labels without discarding unfinished geometry. */
  hidePreviewCursor(contextId?: string): void {
    if (contextId && this.activeDrawingOwner?.contextId !== contextId) return;
    if (!this.activeDrawing || !this.previewCursorVisible) return;
    this.previewCursorVisible = false;
    this.renderAll();
  }

  /** Refresh a stationary Trendline/Ray/Info line preview when Shift changes. */
  setPreviewShiftPressed(shiftPressed: boolean, contextId?: string): void {
    if (contextId && this.activeDrawingOwner?.contextId !== contextId) return;
    if (!this.activeDrawing || !this.canConstrainTrendline(this.activeDrawing)) return;
    if (this.activeDrawing.points.length === 0 || !this.rawTrendlinePreviewPoint) return;
    this.activateDrawingOwner(this.activeDrawingOwner);
    const raw = this.rawTrendlinePreviewPoint;
    this.updatePreviewPoint(raw.time, raw.price, contextId, raw.logicalIndex, shiftPressed);
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

    Object.assign(completed, this.resolvePositionDefaults(completed));

    if (
      completed.type === 'measure'
      && completed.subtype === 'bars_pattern'
      && completed.seriesSnapshot === undefined
    ) {
      // Compatibility fallback for callers that complete a legacy/injected
      // active drawing without passing through the normal second-click path.
      this.refreshBarsPatternSnapshot(completed);
    }

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
    this.rawTrendlinePreviewPoint = null;

    this.getUndoStackFor(owner).push({ action: 'add', drawing: JSON.parse(JSON.stringify(completed)) });
    this.documents.clearRedo(buildDrawingContextKey(owner));

    this.renderAll();
    this.dispatchDrawingSelection(completed, owner);
    this.dispatchDrawingsChanged(owner, 'added');
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
      .map(point => drawing.type === 'freehand' && this.chart && this.series
        ? projectFreehandPoint(this.chart, this.series, point) : this.px(point))
      .filter((point): point is { x: number; y: number } => point !== null);
    const containerRect = this.overlayContainer?.getBoundingClientRect();
    const centerX = screenPoints.length > 0
      ? screenPoints.reduce((sum, point) => sum + point.x, 0) / screenPoints.length
      : (this.overlayContainer?.clientWidth ?? 0) / 2;
    const topY = screenPoints.length > 0
      ? Math.min(...screenPoints.map(point => point.y))
      : 0;
    const drawingGroup = Array.from(this.overlayContainer?.querySelectorAll('g[data-id]') ?? [])
      .find(group => group.getAttribute('data-id') === drawing.id);
    const annotationRects = Array.from(drawingGroup?.querySelectorAll(
      '[data-geometry-role="info-line-panel"], [data-geometry-role$="-background"]',
    ) ?? []).map(element => element.getBoundingClientRect()).filter(rect => rect.height > 0
      && (!containerRect || (rect.bottom > containerRect.top && rect.top < containerRect.bottom)));
    const annotationBounds = annotationRects.length ? {
      top: Math.min(...annotationRects.map(rect => rect.top)),
      bottom: Math.max(...annotationRects.map(rect => rect.bottom)),
    } : undefined;
    window.dispatchEvent(new CustomEvent('drawing:selected', {
      detail: {
        drawingId: drawing.id,
        contextId: identity?.contextId,
        type: drawing.type,
        subtype: drawing.subtype,
        color: drawing.color,
        lineWidth: drawing.lineWidth,
        lineStyle: drawing.lineStyle,
        fillColor: drawing.fillColor,
        fillOpacity: drawing.fillOpacity,
        locked: drawing.locked,
        annotation: drawing.annotation,
        anchorClientX: (containerRect?.left ?? 0) + centerX,
        anchorClientY: (containerRect?.top ?? 0) + topY,
        ...(annotationBounds ? {
          annotationClientBounds: annotationBounds,
        } : {}),
      },
    }));
  }

  editAnnotation(id: string, targetContextId?: string, isNew = false): void {
    this.withTargetContext(targetContextId, identity => {
      const drawing = this.getDrawingsFor(identity).find(item => item.id === id);
      if (!drawing || drawing.locked) return;
      const point = this.px(drawing.points.at(-1)!);
      const rect = this.overlayContainer?.getBoundingClientRect();
      if (!point || !rect) return;
      window.dispatchEvent(new CustomEvent('drawing:edit-annotation', { detail: {
        drawing: JSON.parse(JSON.stringify(drawing)), contextId: identity.contextId, isNew,
        x: rect.left + point.x, y: rect.top + point.y,
      } }));
    });
  }

  editTableCell(id: string, row: number, column: number, targetContextId?: string): void {
    this.withTargetContext(targetContextId, identity => {
      const drawing = this.getDrawingsFor(identity).find(item => item.id === id);
      if (!drawing || drawing.locked || drawing.subtype !== 'table') return;
      const cells = annotationTable(drawing.annotation?.tableData);
      if (!cells[row] || column < 0 || column >= cells[row].length) return;
      const point = this.px(drawing.points[0]); const rect = this.overlayContainer?.getBoundingClientRect();
      if (!point || !rect) return;
      const width = Math.max(40, Math.min(300, drawing.annotation?.cellWidth ?? 120));
      const height = Math.max((drawing.annotation?.fontSize ?? 14) + 12, drawing.annotation?.cellHeight ?? 32);
      window.dispatchEvent(new CustomEvent('drawing:edit-table-cell', { detail: {
        drawing: JSON.parse(JSON.stringify(drawing)), contextId: identity.contextId, row, column,
        x: rect.left + point.x + column * width, y: rect.top + point.y + row * height, width, height,
      } }));
    });
  }

  selectDrawing(id: string, multi = false, targetContextId?: string): boolean {
    return this.withTargetContext(targetContextId, identity => {
      const drawings = this.getDrawingsFor(identity);
      const hadSelection = drawings.some(drawing => drawing.selected);
      if (!multi) drawings.forEach(drawing => (drawing.selected = false));
      const drawing = drawings.find(candidate => candidate.id === id);
      if (!drawing) {
        if (!multi && hadSelection) {
          this.renderAll();
          window.dispatchEvent(new CustomEvent('drawing:selection-cleared', {
            detail: { contextId: identity.contextId },
          }));
          this.dispatchDrawingsChanged(identity, 'selection');
        }
        return false;
      }

      drawing.selected = true;
      // Bring to front without changing any other chart's z-order.
      const index = drawings.indexOf(drawing);
      drawings.splice(index, 1);
      drawings.push(drawing);
      this.renderAll();
      this.dispatchDrawingSelection(drawing, identity);
      this.dispatchDrawingsChanged(identity, 'selection');
      return true;
    }) ?? false;
  }

  /** Select the chart's collection in one batch, preserving its drawing order. */
  selectAll(targetContextId?: string): number {
    return this.withTargetContext(targetContextId, identity => {
      const drawings = this.getDrawingsFor(identity);
      if (drawings.length === 0) return 0;
      drawings.forEach(drawing => (drawing.selected = true));
      this.renderAll();
      this.dispatchDrawingSelection(drawings[drawings.length - 1], identity);
      this.dispatchDrawingsChanged(identity, 'selection');
      return drawings.length;
    }) ?? 0;
  }

  unselectAll(targetContextId?: string): number {
    return this.withTargetContext(targetContextId, identity => {
      const drawings = this.getDrawingsFor(identity);
      const selectedCount = drawings.filter(drawing => drawing.selected).length;
      drawings.forEach(drawing => (drawing.selected = false));
      this.renderAll();
      window.dispatchEvent(new CustomEvent('drawing:selection-cleared', {
        detail: { contextId: identity.contextId },
      }));
      this.dispatchDrawingsChanged(identity, 'selection');
      return selectedCount;
    }) ?? 0;
  }

  deleteDrawing(id: string, targetContextId?: string): boolean {
    return this.withTargetContext(targetContextId, identity => {
      const drawings = this.getDrawingsFor(identity);
      const index = drawings.findIndex(drawing => drawing.id === id);
      if (index === -1) return false;
      const removed = drawings.splice(index, 1)[0];
      const removedSelection = removed.selected === true;
      this.getUndoStackFor(identity).push({
        action: 'delete',
        drawing: JSON.parse(JSON.stringify(removed)),
      });
      this.documents.clearRedo(buildDrawingContextKey(identity));
      this.renderAll();
      void this.deleteFromBackend(id, removed.serverId, identity);
      this.persistLocalFor(identity, drawings);
      window.dispatchEvent(new CustomEvent('drawing:deleted', {
        detail: {
          id,
          contextId: identity.contextId,
          symbol: identity.symbol,
          timeframe: identity.timeframe,
        },
      }));
      if (removedSelection) {
        window.dispatchEvent(new CustomEvent('drawing:selection-cleared', {
          detail: { contextId: identity.contextId },
        }));
      }
      this.dispatchDrawingsChanged(identity, 'deleted');
      return true;
    }) ?? false;
  }

  deleteSelected(targetContextId?: string): number {
    return this.withTargetContext(targetContextId, identity => {
      const ids = this.getDrawingsFor(identity)
        .filter(drawing => drawing.selected)
        .map(drawing => drawing.id);
      return ids.reduce(
        (count, id) => count + (this.deleteDrawing(id) ? 1 : 0),
        0,
      );
    }) ?? 0;
  }

  clearAllDrawings(persist = true, targetContextId?: string): void {
    this.withTargetContext(targetContextId, identity => {
      const drawings = this.getDrawingsFor(identity);
      const deleteInfo = drawings.map(drawing => ({ id: drawing.id, serverId: drawing.serverId }));
      this.documents.replace(buildDrawingContextKey(identity), []);
      this.renderAll();
      if (persist) {
        this.persistLocalFor(identity, []);
        deleteInfo.forEach(({ id, serverId }) => void this.deleteFromBackend(id, serverId, identity));
      }
      const detail = {
        contextId: identity.contextId,
        symbol: identity.symbol,
        timeframe: identity.timeframe,
      };
      window.dispatchEvent(new CustomEvent('drawings:cleared', { detail }));
      window.dispatchEvent(new CustomEvent('drawing:selection-cleared', { detail }));
      this.dispatchDrawingsChanged(identity, 'cleared');
    });
  }

  getDrawings(targetContextId?: string): Drawing[] {
    const identity = this.resolveTargetContextIdentity(targetContextId);
    return identity ? [...this.getDrawingsFor(identity)] : [];
  }

  updateDrawingProperties(
    id: string,
    properties: Partial<Drawing>,
    targetContextId?: string,
  ): boolean {
    return this.withTargetContext(targetContextId, identity => {
      const drawing = this.getDrawingsFor(identity).find(candidate => candidate.id === id);
      if (!drawing) return false;
      const previous = JSON.parse(JSON.stringify(drawing)) as Drawing;
      Object.assign(drawing, properties, { id: drawing.id, type: drawing.type });
      const active = this.getActiveDrawing(identity.contextId);
      if (drawing.type === 'freehand' && active?.type === 'freehand' && active.subtype === drawing.subtype && active.points.length === 0) {
        for (const key of ['color', 'lineWidth', 'lineStyle', 'fillColor', 'fillOpacity'] as const) {
          if (key in properties) Object.assign(active, { [key]: properties[key] });
        }
      }
      if (JSON.stringify(previous) === JSON.stringify(drawing)) return true;
      this.getUndoStackFor(identity).push({
        action: 'modify',
        oldDrawing: previous,
        newDrawing: JSON.parse(JSON.stringify(drawing)),
      });
      this.documents.clearRedo(buildDrawingContextKey(identity));
      this.persistLocalFor(identity, this.getDrawingsFor(identity));
      void this.saveToBackend(drawing, identity);
      this.renderAll();
      this.dispatchDrawingSelection(drawing, identity);
      this.dispatchDrawingsChanged(identity, 'updated');
      return true;
    }) ?? false;
  }

  ownsActiveDrawing(contextId: string): boolean {
    return Boolean(this.activeDrawing && this.activeDrawingOwner?.contextId === contextId);
  }

  getActiveDrawing(contextId?: string): Drawing | null {
    if (contextId && this.activeDrawingOwner?.contextId !== contextId) return null;
    return this.activeDrawing ? { ...this.activeDrawing } : null;
  }

  undo(targetContextId?: string): void {
    this.withTargetContext(targetContextId, identity => {
      const undoStack = this.getUndoStackFor(identity);
      const entry = undoStack.pop();
      if (!entry) return;
      const drawings = this.getDrawingsFor(identity);
      if (entry.action === 'add' && entry.drawing) {
        this.documents.replace(
          buildDrawingContextKey(identity),
          drawings.filter(drawing => drawing.id !== entry.drawing!.id),
        );
        void this.deleteFromBackend(entry.drawing.id, entry.drawing.serverId, identity);
      } else if (entry.action === 'delete' && entry.drawing) {
        drawings.push(entry.drawing);
        void this.saveToBackend(entry.drawing, identity);
      } else if (entry.action === 'modify' && entry.oldDrawing) {
        const index = drawings.findIndex(drawing => drawing.id === entry.oldDrawing!.id);
        if (index !== -1) {
          drawings[index] = entry.oldDrawing;
          void this.saveToBackend(entry.oldDrawing, identity);
        }
      }
      this.getRedoStackFor(identity).push(entry);
      this.renderAll();
      this.persistLocalFor(identity, this.getDrawingsFor(identity));
      this.dispatchDrawingsChanged(identity, 'undo');
    });
  }

  redo(targetContextId?: string): void {
    this.withTargetContext(targetContextId, identity => {
      const redoStack = this.getRedoStackFor(identity);
      const entry = redoStack.pop();
      if (!entry) return;
      const drawings = this.getDrawingsFor(identity);
      if (entry.action === 'add' && entry.drawing) {
        drawings.push(entry.drawing);
        void this.saveToBackend(entry.drawing, identity);
      } else if (entry.action === 'delete' && entry.drawing) {
        this.documents.replace(
          buildDrawingContextKey(identity),
          drawings.filter(drawing => drawing.id !== entry.drawing!.id),
        );
        void this.deleteFromBackend(entry.drawing.id, entry.drawing.serverId, identity);
      } else if (entry.action === 'modify' && entry.newDrawing) {
        const index = drawings.findIndex(drawing => drawing.id === entry.newDrawing!.id);
        if (index !== -1) {
          drawings[index] = entry.newDrawing;
          void this.saveToBackend(entry.newDrawing, identity);
        }
      }
      this.getUndoStackFor(identity).push(entry);
      this.renderAll();
      this.persistLocalFor(identity, this.getDrawingsFor(identity));
      this.dispatchDrawingsChanged(identity, 'redo');
    });
  }

  updateDrawingPositions(): void {
    if (!this.chart || !this.series) return;
    this.renderAll();
  }

  private anchorShapePoint(drawing: Drawing, point: DrawingPoint): DrawingPoint {
    return this.geometryRuntime.anchorShapePoint(drawing, point);
  }

  private shapeLabelTime(point: DrawingPoint, x: number): number {
    return this.geometryRuntime.shapeLabelTime(point, x);
  }

  private shapeAnchorScreen(drawing: Drawing, index: number): { x: number; y: number } | null {
    return this.geometryRuntime.shapeAnchorScreen(drawing, index);
  }

  private px(point: DrawingPoint): { x: number; y: number } | null {
    return this.geometryRuntime.projectPoint(point);
  }

  private pointX(point: DrawingPoint): number | null {
    return this.geometryRuntime.pointX(point);
  }

  private canConstrainTrendline(drawing: Drawing): boolean {
    return this.geometryRuntime.canConstrainTrendline(drawing);
  }

  private clampRegressionPoint(
    drawing: Drawing,
    candidate: DrawingPoint,
    owner: DrawingContextIdentity | null,
  ): DrawingPoint {
    return this.geometryRuntime.clampRegressionPoint(drawing, candidate, owner);
  }

  private projectTrendlinePoint(
    drawing: Drawing,
    candidate: DrawingPoint,
    anchorIndex = 0,
    rawScreen?: { x: number; y: number },
  ): DrawingPoint {
    return this.geometryRuntime.projectTrendlinePoint(
      drawing,
      candidate,
      anchorIndex,
      rawScreen,
    );
  }

  private projectFibWedgePoint(drawing: Drawing, candidate: DrawingPoint): DrawingPoint {
    return this.geometryRuntime.projectFibWedgePoint(drawing, candidate);
  }

  private constrainFibWedge(drawing: Drawing): void {
    this.geometryRuntime.constrainFibWedge(drawing);
  }

  private projectSectorPoint(drawing: Drawing, candidate: DrawingPoint): DrawingPoint {
    return this.geometryRuntime.projectSectorPoint(drawing, candidate);
  }

  private constrainSector(drawing: Drawing): void {
    this.geometryRuntime.constrainSector(drawing);
  }

  private positionEndX(drawing: Drawing, anchor = drawing.points[0]): number | null {
    return this.geometryRuntime.positionEndX(drawing, anchor);
  }

  private offsetCoordinateByLogicalBars(x: number, bars: number): number {
    return this.geometryRuntime.offsetCoordinateByLogicalBars(x, bars);
  }

  private syncPositionEndFromCoordinate(drawing: Drawing, endX: number): void {
    this.geometryRuntime.syncPositionEndFromCoordinate(drawing, endX);
  }
  private getSeriesDataForActiveContext(): DrawingSeriesDataPoint[] {
    if (this.renderSeriesDataCache) return this.renderSeriesDataCache;
    try {
      // renderAll() temporarily swaps chart/series/context fields while walking
      // every registered panel, but intentionally leaves activeContainer alone.
      // Resolve by the currently-rendered identity first so studies never borrow
      // candles from a sibling panel.
      const context = Array.from(this.chartContexts.values()).find((candidate) => (
        candidate.contextId === this.currentContextId
        && candidate.symbol === this.currentSymbol
        && candidate.timeframe === this.currentTimeframe
        && candidate.accountScope === this.currentAccountScope
      )) ?? (this.activeContainer ? this.chartContexts.get(this.activeContainer) : undefined);
      const seriesWithData = this.series as (ISeriesApi<SeriesType> & {
        data?: () => unknown;
      }) | null;
      const source = context?.seriesDataProvider?.() ?? seriesWithData?.data?.();
      const normalized = Array.isArray(source)
        ? source
          .filter((point) => point && Number.isFinite(Number(point.time)))
          .map((point) => ({ ...point, time: Number(point.time) }))
        : [];
      this.renderSeriesDataCache = normalized;
      return normalized;
    } catch {
      return [];
    }
  }

  private refreshBarsPatternSnapshot(drawing: Drawing): void {
    if (
      drawing.type !== 'measure'
      || drawing.subtype !== 'bars_pattern'
      || drawing.points.length < 2
    ) return;

    const [first, second] = drawing.points;
    const startTime = Math.min(first.time, second.time);
    const endTime = Math.max(first.time, second.time);
    drawing.seriesSnapshot = this.getSeriesDataForActiveContext()
      .filter((point) => point.time >= startTime && point.time <= endTime)
      .sort((left, right) => left.time - right.time)
      .map((point) => ({ ...point }));
  }

  private timeframeSeconds(): number {
    return this.geometryRuntime.timeframeSeconds();
  }

  private resolvePositionDefaults(drawing: Drawing): Pick<Drawing,
    'positionTargetPrice' | 'positionStopPrice' | 'positionEndTime' | 'positionEndLogicalIndex'> {
    return this.geometryRuntime.resolvePositionDefaults(drawing);
  }

  private defaultPositionRisk(entry: number): number {
    return this.geometryRuntime.defaultPositionRisk(entry);
  }

  private resolveDraggedPointTime(
    initialPoint: DrawingPoint,
    initialX: number,
    targetX: number,
  ): Pick<DrawingPoint, 'time' | 'logicalIndex'> | null {
    return this.geometryRuntime.resolveDraggedPointTime(initialPoint, initialX, targetX);
  }

  private toDashArray(style?: string, lineWidth?: number): string {
    return this.geometryRuntime.toDashArray(style, lineWidth);
  }
  /** Whether this chart panel currently owns anything that must track its viewport. */
  hasRenderableContent(overlayContainer?: HTMLElement | null): boolean {
    if (!overlayContainer) return false;
    const context = this.chartContexts.get(overlayContainer);
    if (!context) return false;
    if (this.hiddenDrawingContexts.has(context.contextId)) return false;

    const hasDrawings = (
      this.documents.peek(buildDrawingContextKey(this.identityForContext(context)))?.length
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
    this.renderSeriesDataCache = null;
    this.ensureSvgOverlayForContainer(container, context);
    const svg = context.svgOverlay;
    if (!svg) return;

    // Clear only this context. Pan frames must not tear down sibling overlays.
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    if (this.hiddenDrawingContexts.has(context.contextId)) return;
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
    const symbolDrawings = this.documents.peek(
      buildDrawingContextKey(this.identityForContext(context)),
    ) || [];

    // Render drawings for this symbol
    symbolDrawings.forEach(d => this.renderDrawing(svg, d, W, H, false));

    // Render cursor-following ghost BEFORE first click (vline, hline get a ghost from day 0)
    // Only draw the active/preview drawings on the active container if it matches this context!
    if (this.contextOwnsActiveDrawing(context) && this.activeDrawing && this.activeDrawing.points.length === 0 && this.previewPoint) {
      const type = this.activeDrawing.type;
      const showGhost = this.previewCursorVisible || type !== 'stamp' || !isPictographStamp(this.activeDrawing.subtype);
      if (
        showGhost && (type === 'vline'
        || type === 'hline'
        || type === 'stamp'
        || requiredPointsForDrawing(this.activeDrawing) === 1)
      ) {
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

    // Text and notes expose their chart anchors, not the pixel bounds of the
    // text bubble/table. Keep committed coordinates when the cursor leaves.
    if (this.contextOwnsActiveDrawing(context) && this.activeDrawing
      && getAnnotationTool(this.activeDrawing)?.group === 'Text and notes') {
      const points = [...this.activeDrawing.points];
      const cursorIndex = this.previewPoint && this.previewCursorVisible ? points.length : -1;
      if (cursorIndex >= 0) points.push(this.previewPoint!);
      const construction = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      construction.setAttribute('data-id', `${this.activeDrawing.id}-annotation-construction`);
      construction.setAttribute('pointer-events', 'none');
      this.appendAnnotationScaleHighlights(construction, { ...this.activeDrawing, points },
        Math.max(0, W - this.chart.priceScale('right').width()),
        Math.max(0, H - this.chart.timeScale().height()), cursorIndex);
      svg.appendChild(construction);
    }

    // Coordinates belong to the construction as well as the completed drawing.
    const activeTrendGroup = this.activeDrawing
      && getTrendLineToolFromDrawing(this.activeDrawing.type, this.activeDrawing.subtype)?.group;
    const isPitchfork = activeTrendGroup === 'Pitchforks';
    const isChannel = activeTrendGroup === 'Channels';
    const isFibonacci = Boolean(this.activeDrawing && getGannFibonacciTool(this.activeDrawing.subtype));
    const activePattern = getChartPatternTool(this.activeDrawing);
    const isPricePattern = Boolean(activePattern && activePattern.id !== 'time_cycles');
    const isBrushShape = Boolean(getBrushShapeTool(this.activeDrawing) || getChartPatternTool(this.activeDrawing));
    const isForecasting = this.activeDrawing?.type === 'measure'
      && Boolean(getForecastingMeasurementTool(this.activeDrawing.subtype));
    const showAnchorCoordinates = isPitchfork || isFibonacci || isBrushShape || isForecasting;
    // Keep committed anchors visible even before the next pointer move.
    // Construction handles are visual only; clicks still reach the chart.
    if (
      this.contextOwnsActiveDrawing(context)
      && this.activeDrawing
      && (this.canConstrainTrendline(this.activeDrawing) || isChannel || showAnchorCoordinates)
      && (this.activeDrawing.points.length > 0 || ((isChannel || showAnchorCoordinates) && this.previewPoint))
    ) {
      const construction = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      construction.setAttribute('data-id', `${this.activeDrawing.id}-construction`);
      construction.setAttribute('pointer-events', 'none');
      const plotW = Math.max(0, W - (this.chart?.priceScale('right').width() ?? 0));
      const plotH = Math.max(0, H - (this.chart?.timeScale().height() ?? 0));
      if (isForecasting) {
        const points = [...this.activeDrawing.points];
        if (this.previewPoint && this.previewCursorVisible) points.push(this.previewPoint);
        this.appendForecastingScaleHighlights(construction, { ...this.activeDrawing, points }, plotW, plotH, false);
      }
      if (getBrushShapeTool(this.activeDrawing)) {
        const points = [...this.activeDrawing.points];
        if (this.previewPoint && this.previewCursorVisible) points.push(this.previewPoint);
        this.appendSelectionScaleBands(construction,
          points.map(point => this.px(point)).filter((point): point is { x: number; y: number } => point !== null),
          plotW, plotH);
      }
      const committedScreens = this.activeDrawing.points
        .map(point => this.px(point))
        .filter(Boolean) as Array<{ x: number; y: number }>;
      const priceBandScreens = [...committedScreens];
      // Include the visible candidate anchor in the Gann and pattern price range.
      if ((getGannFibonacciTool(this.activeDrawing.subtype)?.group === 'Gann' || activePattern)
        && committedScreens.length > 0 && this.previewPoint && this.previewCursorVisible) {
        const previewScreen = this.px(this.previewPoint);
        if (previewScreen) priceBandScreens.push(previewScreen);
      }
      if (activePattern?.group === 'Cycles' && priceBandScreens.length >= 2) {
        const bandXs = priceBandScreens.map(screen => screen.x);
        this.appendTimeScaleRangeBand(
          construction, plotW, plotH, Math.min(...bandXs), Math.max(...bandXs),
          this.activeDrawing.color || '#2962ff',
        );
      }
      const isTimeBasedFibConstruction = this.activeDrawing.subtype === 'fib_time_zone'
        || this.activeDrawing.subtype === 'trend_based_fib_time';
      if (isTimeBasedFibConstruction) {
        const bandXs = committedScreens.map(screen => screen.x);
        // The second time-zone anchor is still the cursor during construction.
        // Include it so the highlighted interval follows the preview in either direction.
        if (this.activeDrawing.subtype === 'fib_time_zone'
          && committedScreens.length > 0 && this.previewPoint && this.previewCursorVisible) {
          const previewScreen = this.px(this.previewPoint);
          if (previewScreen) bandXs.push(previewScreen.x);
        }
        if (bandXs.length >= 2) {
          this.appendTimeScaleRangeBand(
            construction,
            plotW,
            plotH,
            Math.min(...bandXs),
            Math.max(...bandXs),
            this.activeDrawing.color || '#2962ff',
          );
        }
      } else if (priceBandScreens.length >= 2 && (isPitchfork || isFibonacci || isPricePattern)) {
        const bandYs = priceBandScreens.map(screen => screen.y);
        this.appendPriceScaleRangeBand(
          construction,
          plotW,
          Math.min(...bandYs),
          Math.max(...bandYs),
          this.activeDrawing.color || '#2962ff',
          bandYs.map(y => Number(this.series?.coordinateToPrice(y) ?? 0)),
        );
      }
      const appendCoordinates = (point: DrawingPoint, role: string, accent: string) => {
        const screen = this.px(point);
        if (!screen) return;
        const isProfile = isForecasting && (this.activeDrawing?.subtype === 'fixed_range_volume_profile'
          || this.activeDrawing?.subtype === 'anchored_volume_profile');
        if ((!isProfile || role === 'cursor') && screen.y >= 0 && screen.y <= plotH) {
          this.appendPriceScaleLabel(construction, plotW, screen.y, point.price, accent, `${role}-price-scale-label`);
        }
        if (screen.x >= 0 && screen.x <= plotW) {
          this.appendTimeScaleLabel(construction, screen.x, plotH, isBrushShape || isForecasting ? this.shapeLabelTime(point, screen.x) : point.time, accent, `${role}-time-scale-label`);
        }
      };
      this.activeDrawing.points.forEach((point, index) => {
        const screen = this.px(point);
        if (!screen) return;
        const handle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        handle.setAttribute('cx', String(screen.x));
        handle.setAttribute('cy', String(screen.y));
        handle.setAttribute('r', '5');
        handle.setAttribute('fill', this.getThemeToken('--bg-primary', '#0d0d11'));
        handle.setAttribute('stroke', this.activeDrawing!.color || '#2962ff');
        handle.setAttribute('stroke-width', '2');
        handle.setAttribute('data-geometry-role', `construction-anchor-${index + 1}`);
        handle.setAttribute('pointer-events', 'none');
        construction.appendChild(handle);
        if (showAnchorCoordinates) {
          appendCoordinates(point, `anchor-${index + 1}`, this.activeDrawing!.color || '#2962ff');
        }
      });
      if (showAnchorCoordinates && this.previewPoint && this.previewCursorVisible) {
        appendCoordinates(this.previewPoint, 'cursor', '#131722');
      }
      if (isChannel) {
        this.appendChannelScaleLabels(construction, this.activeDrawing, plotW, plotH, true);
      }
      if (getBrushShapeTool(this.activeDrawing)?.requiredPoints === 0) {
        const hint = this.svgText(16, Math.max(20, plotH - 16), 'Double-click or press Enter to finish', this.activeDrawing.color || '#2962ff', 12);
        hint.setAttribute('data-geometry-role', 'shape-finish-hint');
        construction.appendChild(hint);
      }
      if (isForecasting && this.activeDrawing.subtype === 'ghost_feed') {
        const hint = this.svgText(16, Math.max(20, plotH - 16), 'Double-click or press Enter to finish', this.activeDrawing.color || '#2962ff', 12);
        hint.setAttribute('data-geometry-role', 'forecast-finish-hint');
        construction.appendChild(hint);
      }
      svg.appendChild(construction);
    }

    // Three-click tools have meaningful committed construction geometry after
    // point two. Keep it visible during the brief interval before the pointer
    // supplies the third-point preview.
    if (
      this.contextOwnsActiveDrawing(context)
      && (
        (
          this.activeDrawing?.type === 'measure'
          && (this.activeDrawing.subtype === 'bars_pattern' || this.activeDrawing.subtype === 'sector')
        )
        || this.activeDrawing?.subtype === 'fib_wedge'
        || Boolean(getBrushShapeTool(this.activeDrawing) || getChartPatternTool(this.activeDrawing))
      )
      && this.activeDrawing.points.length >= 2
      && !this.previewPoint
    ) {
      this.renderDrawing(svg, {
        ...this.activeDrawing,
        id: `${this.activeDrawing.id}-stage`,
        selected: false,
      }, W, H, true);
    }
    this.clipDrawingsToPlotArea(svg, context, W, H);
    // Existing fills, strokes, and handles must let anchor clicks reach the
    // chart while placing another tool. Setting only the group's attribute
    // does not override descendants with their own pointer-events values.
    if (this.contextOwnsActiveDrawing(context)) {
      svg.querySelectorAll<SVGElement>('g[data-id], g[data-id] *').forEach(element => {
        element.style.pointerEvents = 'none';
      });
    }
    this.renderSeriesDataCache = null;
  }


  /**
   * Keep drawing geometry inside the price pane. Lines projected far off-screen
   * (e.g. after the price scale is compressed) would otherwise spill over the
   * time axis and the panels below. Axis labels and range bands stay unclipped.
   */
  private clipDrawingsToPlotArea(svg: SVGSVGElement, context: ChartContext, W: number, H: number): void {
    // Minimal chart stubs (and charts torn down mid-render) expose no scales.
    if (typeof this.chart?.priceScale !== 'function' || typeof this.chart.timeScale !== 'function') return;
    const plotW = Math.max(0, W - this.chart.priceScale('right').width());
    const plotH = Math.max(0, H - this.chart.timeScale().height());
    const clipId = `rtx-drawing-plot-clip-${context.contextId.replace(/[^\w-]/g, '_')}`;
    const clip = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
    clip.setAttribute('id', clipId);
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', '0');
    rect.setAttribute('y', '0');
    rect.setAttribute('width', String(plotW));
    rect.setAttribute('height', String(plotH));
    clip.appendChild(rect);
    const defs = svg.querySelector('defs') ?? svg.insertBefore(
      document.createElementNS('http://www.w3.org/2000/svg', 'defs'),
      svg.firstChild,
    );
    defs.appendChild(clip);
    this.applyPlotClip(svg, `url(#${clipId})`);
  }

  private applyPlotClip(parent: Element, clipUrl: string): void {
    for (const child of Array.from(parent.children)) {
      const tag = child.tagName.toLowerCase();
      if (tag === 'defs' || tag === 'clippath' || child.hasAttribute(DRAWING_AXIS_OVERLAY_ATTRIBUTE)) continue;
      if (child.querySelector(`[${DRAWING_AXIS_OVERLAY_ATTRIBUTE}]`)) {
        // Transformed groups would move the clip rectangle with them.
        if (!child.hasAttribute('transform')) this.applyPlotClip(child, clipUrl);
        continue;
      }
      if (child.hasAttribute('clip-path')) {
        // Nest an existing per-shape clip inside the plot clip.
        const wrapper = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        wrapper.setAttribute('clip-path', clipUrl);
        parent.insertBefore(wrapper, child);
        wrapper.appendChild(child);
        continue;
      }
      if (child.hasAttribute('transform')) {
        const wrapper = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        wrapper.setAttribute('clip-path', clipUrl);
        parent.insertBefore(wrapper, child);
        wrapper.appendChild(child);
        continue;
      }
      child.setAttribute('clip-path', clipUrl);
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
    drawing: Drawing,
    width: number,
    height: number,
    isPreview = false,
  ): void {
    this.svgDrawingRenderer.render(svg, drawing, width, height, isPreview);
  }
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

  // ──────────────────────────────────────────────
  // Drag Handling
  // ──────────────────────────────────────────────
  private lastAnnotationPress: { id: string; at: number; x: number; y: number } | null = null;

  private beginDrag(e: PointerEvent, id: string, nodeIndex: number | null): void {
    e.stopPropagation();
    // A secondary press opens the context menu without starting a drag or
    // reducing an existing multi-selection to the drawing under the pointer.
    if (e.button > 0) return;
    e.preventDefault();
    const context = this.activateContextFromEventTarget(e.target);

    const drawing = this.drawings.find(d => d.id === id);
    if (!drawing || drawing.locked) return;

    if (drawing.type === 'text' && nodeIndex === null) {
      const previous = this.lastAnnotationPress;
      this.lastAnnotationPress = { id, at: Date.now(), x: e.clientX, y: e.clientY };
      // Selection rebuilds the SVG between presses, so a native dblclick
      // listener on its old node cannot reliably receive the second press.
      if (previous?.id === id && Date.now() - previous.at < 400
        && Math.hypot(e.clientX - previous.x, e.clientY - previous.y) < 5) {
        this.lastAnnotationPress = null;
        const cell = e.target instanceof Element ? e.target.closest('[data-table-row]') : null;
        if (drawing.subtype === 'table' && cell) this.editTableCell(id, Number(cell.getAttribute('data-table-row')), Number(cell.getAttribute('data-table-column')), context?.contextId);
        else this.editAnnotation(id, context?.contextId);
        return;
      }
    }

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
    try { (e.target as Element).setPointerCapture(e.pointerId); } catch {
      // Pointer capture is optional for synthetic and detached event targets.
    }
  }

  private resetDragState(): void {
    this.draggingId = null;
    this.draggingOwner = null;
    this.draggingNodeIndex = null;
    this.dragInitialPoints = [];
    this.dragInitialDrawingCopy = null;
    this.draggingScrollLockCallbacks = null;
  }

  private onGlobalPointerMove = (event: PointerEvent): void => {
    this.activateDrawingOwner(this.draggingOwner);
    if (!this.draggingId || !this.chart || !this.series) return;
    const drawing = this.drawings.find(candidate => candidate.id === this.draggingId);
    if (!drawing) return;

    applyDrawingDragUpdate({
      event,
      drawing,
      owner: this.draggingOwner,
      nodeIndex: this.draggingNodeIndex,
      startX: this.dragStartX,
      startY: this.dragStartY,
      initialPoints: this.dragInitialPoints,
      initialDrawing: this.dragInitialDrawingCopy,
      chart: this.chart,
      series: this.series,
      overlay: this.svgOverlay,
      projectPoint: point => this.px(point),
      minMove: () => this.getSeriesPriceFormat().minMove,
      resolveDraggedPointTime: (point, initialX, targetX) => (
        this.resolveDraggedPointTime(point, initialX, targetX)
      ),
      clampRegressionPoint: (target, candidate, owner) => (
        this.clampRegressionPoint(target, candidate, owner)
      ),
      canConstrainTrendline: target => this.canConstrainTrendline(target),
      projectTrendlinePoint: (target, candidate, fixedIndex, screen) => (
        this.projectTrendlinePoint(target, candidate, fixedIndex, screen)
      ),
      constrainSector: target => this.constrainSector(target),
      constrainFibWedge: target => this.constrainFibWedge(target),
      positionEndX: (target, anchor) => this.positionEndX(target, anchor),
      offsetCoordinateByLogicalBars: (x, bars) => this.offsetCoordinateByLogicalBars(x, bars),
      syncPositionEndFromCoordinate: (target, endX) => (
        this.syncPositionEndFromCoordinate(target, endX)
      ),
      defaultPositionRisk: entry => this.defaultPositionRisk(entry),
      timeframeSeconds: () => this.timeframeSeconds(),
      refreshBarsPatternSnapshot: target => this.refreshBarsPatternSnapshot(target),
    });
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
          this.documents.clearRedo(this.currentDrawingContextKey || 'legacy');
          void this.saveToBackend(drawing, this.draggingOwner);
          if (this.draggingOwner) {
            this.persistLocalFor(this.draggingOwner, this.getDrawingsFor(this.draggingOwner));
            this.dispatchDrawingsChanged(this.draggingOwner, 'updated');
          }
          if (drawing.subtype === 'info_line' || drawing.type === 'freehand' || drawing.type === 'text' || getBrushShapeTool(drawing) || getChartPatternTool(drawing)) {
            this.dispatchDrawingSelection(drawing, this.draggingOwner);
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
    const drawing = this.drawings.find(candidate => candidate.id === id);
    this.selectDrawing(id, drawing?.selected === true);
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
    this.persistence.persistCurrent();
  }

  /** Persist one registered chart context without relying on the last active panel. */
  persistCurrentContext(targetContextId?: string): boolean {
    return this.persistence.persistContext(targetContextId);
  }

  private persistLocalFor(identity: DrawingContextIdentity, drawings: Drawing[]): void {
    this.persistence.persistFor(identity, drawings);
  }

  async saveToBackend(
    drawing: Drawing,
    identity: DrawingContextIdentity | null = this.currentContextIdentity,
  ): Promise<void> {
    await this.persistence.save(drawing, identity);
  }

  async loadFromBackend(identityOrSymbol: DrawingContextIdentity | string): Promise<void> {
    await this.persistence.load(identityOrSymbol);
  }

  private loadFromLocal(identityOrSymbol: DrawingContextIdentity | string): void {
    this.persistence.loadLocal(identityOrSymbol);
  }

  async deleteFromBackend(
    id: string,
    serverId?: string,
    identity: DrawingContextIdentity | null = this.currentContextIdentity,
  ): Promise<void> {
    void id;
    await this.persistence.delete(serverId, identity);
  }

  saveToStorage(symbol: string): void {
    this.persistence.saveSymbol(symbol);
  }

  deleteLast(targetContextId?: string): boolean {
    return this.withTargetContext(targetContextId, identity => {
      const drawings = this.getDrawingsFor(identity);
      if (drawings.length === 0) return false;

      // Selection changes z-order, so prefer the most recent still-present add
      // history entry. Loaded legacy drawings fall back to persisted order.
      const drawingIds = new Set(drawings.map(drawing => drawing.id));
      const lastAdded = [...this.getUndoStackFor(identity)]
        .reverse()
        .find(entry => (
          entry.action === 'add'
          && entry.drawing
          && drawingIds.has(entry.drawing.id)
        ))?.drawing;
      const candidate = lastAdded ?? drawings[drawings.length - 1];
      return this.deleteDrawing(candidate.id);
    }) ?? false;
  }

  deleteArrows(targetContextId?: string): number {
    return this.withTargetContext(targetContextId, identity => {
      const ids = this.getDrawingsFor(identity)
        .filter(isArrowDrawing)
        .map(drawing => drawing.id);
      return ids.reduce(
        (count, id) => count + (this.deleteDrawing(id) ? 1 : 0),
        0,
      );
    }) ?? 0;
  }

  deleteByType(type: DrawingType, targetContextId?: string): number {
    return this.withTargetContext(targetContextId, identity => {
      const ids = this.getDrawingsFor(identity)
        .filter(drawing => drawing.type === type)
        .map(drawing => drawing.id);
      return ids.reduce(
        (count, id) => count + (this.deleteDrawing(id) ? 1 : 0),
        0,
      );
    }) ?? 0;
  }

  updateActiveDrawing(props: Partial<Drawing>): void {
    if (this.activeDrawing) Object.assign(this.activeDrawing, props);
  }

  /** Public alias — TradingChart.tsx calls this to finish freehand drawings */
  finishDrawing(contextId?: string): Drawing | null {
    if (contextId && this.activeDrawingOwner?.contextId !== contextId) return null;
    const pattern = getChartPatternTool(this.activeDrawing);
    if (pattern && this.activeDrawing!.points.length < pattern.requiredPoints) return null;
    const shape = getBrushShapeTool(this.activeDrawing);
    if (shape && this.activeDrawing!.points.length < (shape.requiredPoints || shape.minimumPoints || 2)) return null;
    if (
      this.activeDrawing?.type === 'measure'
      && this.activeDrawing.subtype === 'ghost_feed'
      && this.activeDrawing.points.length < 2
    ) return null;
    return this._completeDrawing();
  }

  /** Public alias — backward compat */
  renderAllDrawings(): void {
    this.renderAll();
  }

  /** Unselect a single drawing by id in one chart context. */
  unselectDrawing(id: string, targetContextId?: string): boolean {
    return this.withTargetContext(targetContextId, identity => {
      const drawing = this.getDrawingsFor(identity).find(candidate => candidate.id === id);
      if (!drawing) return false;
      drawing.selected = false;
      this.renderAll();
      window.dispatchEvent(new CustomEvent('drawing:selection-cleared', {
        detail: { contextId: identity.contextId, drawingId: id },
      }));
      this.dispatchDrawingsChanged(identity, 'selection');
      return true;
    }) ?? false;
  }

  /** Public alias — backward compat for old loadFromStorage calls */
  loadFromStorage(symbol: string): void {
    this.persistence.loadSymbol(symbol);
  }

  /** Public alias — backward compat for undoDelete */
  undoDelete(targetContextId?: string): void { this.undo(targetContextId); }
}

// ──────────────────────────────────────────────
// Singleton export
// ──────────────────────────────────────────────
export const drawingManager = new DrawingManager();
