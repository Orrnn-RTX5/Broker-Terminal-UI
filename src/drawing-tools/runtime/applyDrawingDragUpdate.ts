import type { IChartApi, ISeriesApi, SeriesType, Time } from 'lightweight-charts';
import { annotationTable } from '../annotationToolCatalog';
import { rectangleHandles, rotatedRectangle } from '../brushShapeGeometry';
import { getBrushShapeTool } from '../brushShapeToolCatalog';
import { drawingLogicalToCoordinate } from '../geometry/drawingCoordinates';
import { freehandPointAt, projectFreehandPoint } from '../geometry/freehandGeometry';
import type { Drawing, DrawingPoint } from '../model/drawing';
import type { DrawingContextIdentity } from '../contextKey';

type ScreenPoint = { x: number; y: number };

export interface DrawingDragUpdateOptions {
  event: PointerEvent;
  drawing: Drawing;
  owner: DrawingContextIdentity | null;
  nodeIndex: number | null;
  startX: number;
  startY: number;
  initialPoints: DrawingPoint[];
  initialDrawing: Drawing | null;
  chart: IChartApi;
  series: ISeriesApi<SeriesType>;
  overlay: SVGSVGElement | null;
  projectPoint: (point: DrawingPoint) => ScreenPoint | null;
  minMove: () => number;
  resolveDraggedPointTime: (
    initialPoint: DrawingPoint,
    initialX: number,
    targetX: number,
  ) => Pick<DrawingPoint, 'time' | 'logicalIndex'> | null;
  clampRegressionPoint: (
    drawing: Drawing,
    candidate: DrawingPoint,
    owner: DrawingContextIdentity | null,
  ) => DrawingPoint;
  canConstrainTrendline: (drawing: Drawing) => boolean;
  projectTrendlinePoint: (
    drawing: Drawing,
    candidate: DrawingPoint,
    fixedIndex: number,
    candidateScreen: ScreenPoint,
  ) => DrawingPoint;
  constrainSector: (drawing: Drawing) => void;
  constrainFibWedge: (drawing: Drawing) => void;
  positionEndX: (drawing: Drawing, anchor?: DrawingPoint) => number | null;
  offsetCoordinateByLogicalBars: (x: number, bars: number) => number;
  syncPositionEndFromCoordinate: (drawing: Drawing, endX: number) => void;
  defaultPositionRisk: (entry: number) => number;
  timeframeSeconds: () => number;
  refreshBarsPatternSnapshot: (drawing: Drawing) => void;
}

/** Applies one pointer-move frame to a drawing without owning manager state. */
export function applyDrawingDragUpdate(options: DrawingDragUpdateOptions): void {
  const {
    event,
    drawing,
    nodeIndex,
    startX,
    startY,
    initialPoints,
    initialDrawing,
    chart,
    series,
    overlay,
  } = options;
  const deltaX = event.clientX - startX;
  const deltaY = event.clientY - startY;

  if (drawing.type === 'text' && nodeIndex === -101) {
    const initial = initialDrawing?.annotation;
    if (drawing.subtype === 'image') {
      const width = Math.max(24, Math.min(1200, (initial?.width ?? 240) + deltaX));
      const ratio = (initial?.height ?? 160) / (initial?.width ?? 240);
      drawing.annotation = {
        ...initial,
        width,
        height: event.shiftKey
          ? Math.max(24, Math.min(1200, (initial?.height ?? 160) + deltaY))
          : Math.max(24, Math.min(1200, width * ratio)),
      };
    } else if (drawing.subtype === 'table') {
      const cells = annotationTable(initial?.tableData);
      drawing.annotation = {
        ...initial,
        cellWidth: Math.max(
          40,
          Math.min(300, (initial?.cellWidth ?? 120) + deltaX / cells[0].length),
        ),
        cellHeight: Math.max(
          (initial?.fontSize ?? 14) + 12,
          Math.min(300, (initial?.cellHeight ?? 32) + deltaY / cells.length),
        ),
      };
    }
    return;
  }

  const isPositionDrawing = drawing.type === 'measure'
    && (drawing.subtype === 'long_position' || drawing.subtype === 'short_position');

  if (
    drawing.type === 'shapes'
    && ['rotated_rectangle', 'ellipse', 'arc'].includes(drawing.subtype!)
    && nodeIndex !== null
  ) {
    const [firstAnchor, secondAnchor, widthAnchor] = initialPoints.map(options.projectPoint);
    if (firstAnchor && secondAnchor && widthAnchor) {
      const geometry = rotatedRectangle(firstAnchor, secondAnchor, widthAnchor);
      let first = firstAnchor;
      let second = secondAnchor;
      let width = geometry.width;
      if (nodeIndex === 0) first = { x: firstAnchor.x + deltaX, y: firstAnchor.y + deltaY };
      if (nodeIndex === 1) second = { x: secondAnchor.x + deltaX, y: secondAnchor.y + deltaY };
      if (nodeIndex <= -200) {
        width += (geometry.nx * deltaX + geometry.ny * deltaY)
          * (-200 - nodeIndex < 2 ? 1 : -1);
      }
      if (drawing.subtype === 'arc' && nodeIndex === 2) {
        width += geometry.nx * deltaX + geometry.ny * deltaY;
      }
      const axis = rotatedRectangle(first, second, second);
      const origin = drawing.subtype === 'arc'
        ? { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
        : second;
      drawing.points = [
        first,
        second,
        { x: origin.x + axis.nx * width, y: origin.y + axis.ny * width },
      ].map((point, index) => (
        freehandPointAt(chart, series, point.x, point.y) ?? initialPoints[index]
      ));
    }
  } else if (
    drawing.type === 'shapes'
    && drawing.subtype === 'rectangle'
    && nodeIndex !== null
    && nodeIndex <= -100
  ) {
    const first = options.projectPoint(initialPoints[0]);
    const second = options.projectPoint(initialPoints[1]);
    if (first && second) {
      const handle = rectangleHandles(first, second)[-100 - nodeIndex];
      if (handle) {
        drawing.points = [first, second].map((point, index) => (
          freehandPointAt(
            chart,
            series,
            point.x + (handle.xAnchor === index ? deltaX : 0),
            point.y + (handle.yAnchor === index ? deltaY : 0),
          ) ?? initialPoints[index]
        ));
      }
    }
  } else if (isPositionDrawing && (nodeIndex === -10 || nodeIndex === -11)) {
    const overlayRect = overlay?.getBoundingClientRect();
    const cursorY = event.clientY - (overlayRect?.top ?? 0);
    const cursorPrice = series.coordinateToPrice(cursorY);
    const entry = drawing.points[0]?.price;
    if (cursorPrice !== null && entry !== undefined) {
      const minMove = Math.max(options.minMove(), 0.000001);
      const isLong = drawing.subtype === 'long_position';
      if (nodeIndex === -10) {
        drawing.positionTargetPrice = isLong
          ? Math.max(entry + minMove, cursorPrice)
          : Math.min(entry - minMove, cursorPrice);
      } else {
        drawing.positionStopPrice = isLong
          ? Math.min(entry - minMove, cursorPrice)
          : Math.max(entry + minMove, cursorPrice);
      }
    }
  } else if (isPositionDrawing && nodeIndex === -12 && drawing.points[0]) {
    const overlayRect = overlay?.getBoundingClientRect();
    const cursorX = event.clientX - (overlayRect?.left ?? 0);
    const timeScale = chart.timeScale();
    const anchor = drawing.points[0];
    const anchorX = timeScale.timeToCoordinate(anchor.time as Time)
      ?? (anchor.logicalIndex !== undefined
        ? drawingLogicalToCoordinate(timeScale, anchor.logicalIndex)
        : null);
    const anchorLogical = anchorX !== null
      ? timeScale.coordinateToLogical(anchorX)
      : anchor.logicalIndex;
    const cursorLogical = timeScale.coordinateToLogical(cursorX);
    if (anchorLogical !== null && cursorLogical !== null) {
      const endLogical = Math.max(Number(anchorLogical) + 1, Number(cursorLogical));
      const endX = drawingLogicalToCoordinate(timeScale, endLogical) ?? cursorX;
      options.syncPositionEndFromCoordinate(drawing, endX);
    }
  } else if (nodeIndex === -1 && drawing.type === 'channel') {
    const overlayRect = overlay?.getBoundingClientRect();
    const cursorY = event.clientY - (overlayRect?.top ?? 0);
    const cursorPrice = series.coordinateToPrice(cursorY);
    if (cursorPrice !== null && drawing.points.length >= 2) {
      const cursorX = event.clientX - (overlayRect?.left ?? 0);
      const firstX = chart.timeScale().timeToCoordinate(initialPoints[0].time as Time);
      const secondX = chart.timeScale().timeToCoordinate(initialPoints[1].time as Time);
      if (firstX !== null && secondX !== null) {
        const ratio = Math.abs(secondX - firstX) > 0.01
          ? (cursorX - firstX) / (secondX - firstX)
          : 0;
        const mainPriceAtCursor = initialPoints[0].price
          + ratio * (initialPoints[1].price - initialPoints[0].price);
        drawing.channelOffset = cursorPrice - mainPriceAtCursor;
      }
    }
  } else if (nodeIndex !== null && nodeIndex >= 0) {
    updateSingleNode({ ...options, isPositionDrawing, deltaX, deltaY });
  } else {
    updateWholeDrawing({ ...options, isPositionDrawing, deltaX, deltaY });
  }

  options.constrainSector(drawing);
  if (
    drawing.type === 'measure'
    && drawing.subtype === 'bars_pattern'
    && (nodeIndex === 0 || nodeIndex === 1 || nodeIndex === null)
  ) {
    options.refreshBarsPatternSnapshot(drawing);
  }
}

interface DragBranchOptions extends DrawingDragUpdateOptions {
  isPositionDrawing: boolean;
  deltaX: number;
  deltaY: number;
}

function updateSingleNode(options: DragBranchOptions): void {
  const {
    drawing,
    nodeIndex,
    initialPoints,
    initialDrawing,
    chart,
    series,
    deltaX,
    deltaY,
    event,
  } = options;
  if (nodeIndex === null) return;
  const initial = initialPoints[nodeIndex];
  if (initial.barOffset !== undefined && getBrushShapeTool(drawing)) {
    const origin = options.projectPoint(initial);
    const next = origin
      ? freehandPointAt(chart, series, origin.x + deltaX, origin.y + deltaY)
      : null;
    if (next) drawing.points[nodeIndex] = next;
    return;
  }
  if (initial.pixelXOffset !== undefined) {
    const newOffset = initial.pixelXOffset + deltaX;
    const barX = chart.timeScale().timeToCoordinate(initial.time as Time);
    const newAbsoluteX = barX !== null ? barX + newOffset : null;
    const newTime = newAbsoluteX !== null
      ? chart.timeScale().coordinateToTime(newAbsoluteX)
      : null;
    const originalY = series.priceToCoordinate(initial.price);
    const newPrice = originalY !== null ? series.coordinateToPrice(originalY + deltaY) : null;
    drawing.points[nodeIndex] = {
      time: (typeof newTime === 'number' ? newTime : initial.time),
      price: newPrice ?? initial.price,
      pixelXOffset: newOffset,
    };
    return;
  }

  const originalX = chart.timeScale().timeToCoordinate(initial.time as Time)
    ?? (initial.logicalIndex !== undefined
      ? drawingLogicalToCoordinate(chart.timeScale(), initial.logicalIndex)
      : null);
  const originalY = series.priceToCoordinate(initial.price);
  if (originalX === null || originalY === null) return;
  let targetX = originalX + deltaX;
  const isSector = drawing.type === 'measure' && drawing.subtype === 'sector';
  const fixedPositionEndX = options.isPositionDrawing && nodeIndex === 0 && initialDrawing
    ? options.positionEndX(initialDrawing, initial)
    : null;
  if (fixedPositionEndX !== null) {
    targetX = Math.min(options.offsetCoordinateByLogicalBars(fixedPositionEndX, -1), targetX);
  }
  const resolvedTime = options.resolveDraggedPointTime(initial, originalX, targetX);
  const newPrice = series.coordinateToPrice(originalY + deltaY);
  if (!resolvedTime || newPrice === null) return;
  let nextPrice = Number(newPrice);
  if (options.isPositionDrawing && nodeIndex === 0) {
    const minMove = Math.max(options.minMove(), 0.000001);
    const target = drawing.positionTargetPrice;
    const stop = drawing.positionStopPrice;
    if (target !== undefined && stop !== undefined) {
      nextPrice = drawing.subtype === 'long_position'
        ? Math.max(stop + minMove, Math.min(target - minMove, nextPrice))
        : Math.max(target + minMove, Math.min(stop - minMove, nextPrice));
    }
  }
  drawing.points[nodeIndex] = options.clampRegressionPoint(
    drawing,
    { ...resolvedTime, price: nextPrice },
    options.owner,
  );
  if (event.shiftKey && options.canConstrainTrendline(drawing)) {
    drawing.points[nodeIndex] = options.projectTrendlinePoint(
      drawing,
      drawing.points[nodeIndex],
      nodeIndex === 0 ? 1 : 0,
      { x: targetX, y: originalY + deltaY },
    );
  }
  if (isSector) options.constrainSector(drawing);
  if (fixedPositionEndX !== null) {
    options.syncPositionEndFromCoordinate(drawing, fixedPositionEndX);
  }
  if (drawing.type === 'pattern' && drawing.subtype === 'time_cycles') {
    const baseline = nodeIndex === 0 ? nextPrice : drawing.points[0].price;
    drawing.points.forEach(point => { point.price = baseline; });
  }
  options.constrainFibWedge(drawing);
}

function updateWholeDrawing(options: DragBranchOptions): void {
  const {
    drawing,
    initialPoints,
    initialDrawing,
    chart,
    series,
    deltaX,
    deltaY,
  } = options;
  drawing.points = initialPoints.map(point => {
    if (drawing.type === 'freehand' || getBrushShapeTool(drawing)) {
      const origin = projectFreehandPoint(chart, series, point);
      return origin
        ? freehandPointAt(chart, series, origin.x + deltaX, origin.y + deltaY) ?? point
        : point;
    }
    if (point.pixelXOffset !== undefined) {
      const newOffset = point.pixelXOffset + deltaX;
      const barX = chart.timeScale().timeToCoordinate(point.time as Time);
      const newAbsoluteX = barX !== null ? barX + newOffset : null;
      const newTime = newAbsoluteX !== null
        ? chart.timeScale().coordinateToTime(newAbsoluteX)
        : null;
      const originalY = series.priceToCoordinate(point.price);
      const newPrice = originalY !== null ? series.coordinateToPrice(originalY + deltaY) : null;
      return {
        time: typeof newTime === 'number' ? newTime : point.time,
        price: newPrice ?? point.price,
        pixelXOffset: newOffset,
      };
    }
    const originalX = chart.timeScale().timeToCoordinate(point.time as Time)
      ?? (point.logicalIndex !== undefined
        ? drawingLogicalToCoordinate(chart.timeScale(), point.logicalIndex)
        : null);
    const originalY = series.priceToCoordinate(point.price);
    if (originalX === null || originalY === null) return point;
    const resolvedTime = options.resolveDraggedPointTime(point, originalX, originalX + deltaX);
    const newPrice = series.coordinateToPrice(originalY + deltaY);
    return resolvedTime && newPrice !== null
      ? { ...resolvedTime, price: newPrice }
      : point;
  });

  if (
    !options.isPositionDrawing
    || !initialDrawing
    || !initialPoints[0]
    || !drawing.points[0]
  ) return;
  const initialEndX = options.positionEndX(initialDrawing, initialPoints[0]);
  const initialEntry = initialPoints[0].price;
  const priceDelta = drawing.points[0].price - initialEntry;
  const minMove = Math.max(options.minMove(), 0.000001);
  const initialRisk = Math.max(options.defaultPositionRisk(initialEntry), minMove);
  const direction = drawing.subtype === 'long_position' ? 1 : -1;
  const initialTarget = initialDrawing.positionTargetPrice
    ?? initialEntry + direction * initialRisk;
  const initialStop = initialDrawing.positionStopPrice
    ?? initialEntry - direction * initialRisk;
  drawing.positionTargetPrice = initialTarget + priceDelta;
  drawing.positionStopPrice = initialStop + priceDelta;
  if (initialEndX !== null) {
    options.syncPositionEndFromCoordinate(drawing, initialEndX + deltaX);
  } else {
    const timeDelta = drawing.points[0].time - initialPoints[0].time;
    drawing.positionEndTime = (
      initialDrawing.positionEndTime
      ?? initialPoints[0].time + 40 * options.timeframeSeconds()
    ) + timeDelta;
    drawing.positionEndLogicalIndex = undefined;
  }
}
