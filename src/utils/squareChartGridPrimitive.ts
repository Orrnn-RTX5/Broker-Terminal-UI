import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  PrimitivePaneViewZOrder,
  SeriesAttachedParameter,
  Time,
} from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';

export const SQUARE_CHART_GRID_CELL_SIZE_PX = 64;
export const FINE_CHART_GRID_CELL_SIZE_PX = 32;

export interface SquareChartGridOptions {
  visible: boolean;
  lineStyle?: 'dashed' | 'solid';
  dashPatternCssPx?: readonly [number, number];
  cellSizeCssPx: number;
  verticalColor: string;
  horizontalColor: string;
  profile?: 'square' | 'fine';
}

const MIN_GRID_CELL_SIZE_PX = 24;
const MAX_GRID_CELL_SIZE_PX = 160;

const normalizeCellSize = (value: number): number => {
  if (!Number.isFinite(value)) return SQUARE_CHART_GRID_CELL_SIZE_PX;
  return Math.max(MIN_GRID_CELL_SIZE_PX, Math.min(MAX_GRID_CELL_SIZE_PX, value));
};

export const getSquareGridLinePositions = (
  extentCssPx: number,
  cellSizeCssPx: number = SQUARE_CHART_GRID_CELL_SIZE_PX,
): number[] => {
  if (!Number.isFinite(extentCssPx) || extentCssPx <= 0) return [];

  const step = normalizeCellSize(cellSizeCssPx);
  const positions: number[] = [];
  for (let position = step; position < extentCssPx; position += step) {
    positions.push(position);
  }
  return positions;
};

/** The fine lattice starts at the time-axis edge, as in the desktop reference. */
export const getFineGridHorizontalPositions = (extentCssPx: number): number[] => {
  if (!Number.isFinite(extentCssPx) || extentCssPx <= 0) return [];
  const positions: number[] = [];
  for (let y = extentCssPx - 1; y > 0; y -= FINE_CHART_GRID_CELL_SIZE_PX) positions.push(y);
  return positions.reverse();
};

export interface FineGridPriceAxis {
  labelAt: (coordinate: number) => string | null;
  appearance: () => { color: string; fontSize: number; fontFamily: string };
}

class FineGridPriceAxisRenderer implements IPrimitivePaneRenderer {
  constructor(
    private readonly readOptions: () => Readonly<SquareChartGridOptions>,
    private readonly priceAxis: FineGridPriceAxis,
  ) {}

  draw(target: CanvasRenderingTarget2D): void {
    const options = this.readOptions();
    if (!options.visible || options.profile !== 'fine') return;
    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      const appearance = this.priceAxis.appearance();
      context.save();
      context.font = `${appearance.fontSize}px ${appearance.fontFamily}`;
      context.fillStyle = appearance.color;
      context.textBaseline = 'middle';
      context.textAlign = 'left';
      for (const y of getFineGridHorizontalPositions(mediaSize.height)) {
        if (y < appearance.fontSize / 2 || y > mediaSize.height - appearance.fontSize / 2) continue;
        const text = this.priceAxis.labelAt(y);
        if (text !== null) context.fillText(text, 8, y + 0.5);
      }
      context.restore();
    });
  }
}

class SquareChartGridRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly readOptions: () => Readonly<SquareChartGridOptions>) {}

  draw(target: CanvasRenderingTarget2D): void {
    const options = this.readOptions();
    if (!options.visible) return;

    target.useBitmapCoordinateSpace(({
      context,
      bitmapSize,
      horizontalPixelRatio,
      verticalPixelRatio,
    }) => {
      const cellSize = normalizeCellSize(options.cellSizeCssPx);
      const verticalStep = cellSize * horizontalPixelRatio;

      context.save();
      context.lineCap = 'butt';
      context.lineDashOffset = 0;

      // Dash lengths follow the line direction so segments keep their CSS size
      // on high-DPI displays, independently of the square cell pitch.
      const dashed = options.lineStyle !== 'solid';
      const [dashLength, dashGap] = options.dashPatternCssPx ?? [8, 4];
      const strokeCssPx = options.profile === 'fine' ? 1 : dashed ? 0.75 : 1;
      const verticalLineWidth = strokeCssPx * horizontalPixelRatio;
      context.lineWidth = verticalLineWidth;
      context.setLineDash(dashed ? [dashLength * verticalPixelRatio, dashGap * verticalPixelRatio] : []);
      context.beginPath();
      for (let x = verticalStep; x < bitmapSize.width; x += verticalStep) {
        const crispX = Math.round(x) + (Math.round(verticalLineWidth) % 2) / 2;
        context.moveTo(crispX, 0);
        context.lineTo(crispX, bitmapSize.height);
      }
      context.strokeStyle = options.verticalColor;
      context.stroke();

      const horizontalLineWidth = strokeCssPx * verticalPixelRatio;
      context.lineWidth = horizontalLineWidth;
      context.setLineDash(dashed ? [dashLength * horizontalPixelRatio, dashGap * horizontalPixelRatio] : []);
      context.beginPath();
      const horizontalPositions = options.profile === 'fine'
        ? getFineGridHorizontalPositions(bitmapSize.height / verticalPixelRatio)
        : getSquareGridLinePositions(bitmapSize.height / verticalPixelRatio, cellSize);
      for (const position of horizontalPositions) {
        const y = position * verticalPixelRatio;
        const crispY = Math.round(y) + (Math.round(horizontalLineWidth) % 2) / 2;
        context.moveTo(0, crispY);
        context.lineTo(bitmapSize.width, crispY);
      }
      context.strokeStyle = options.horizontalColor;
      context.stroke();

      context.restore();
    });
  }
}

class SquareChartGridPaneView implements IPrimitivePaneView {
  constructor(private readonly gridRenderer: IPrimitivePaneRenderer, private readonly order: PrimitivePaneViewZOrder = 'bottom') {}

  zOrder(): PrimitivePaneViewZOrder {
    return this.order;
  }

  renderer(): IPrimitivePaneRenderer {
    return this.gridRenderer;
  }
}

export class SquareChartGridPrimitive implements ISeriesPrimitive<Time> {
  private options: SquareChartGridOptions;
  private requestUpdate: (() => void) | null = null;
  private readonly gridRenderer = new SquareChartGridRenderer(() => this.options);
  private readonly gridPaneView = new SquareChartGridPaneView(this.gridRenderer);
  private readonly pricePaneViews: readonly IPrimitivePaneView[];

  constructor(options: SquareChartGridOptions, priceAxis?: FineGridPriceAxis) {
    this.options = {
      ...options,
      cellSizeCssPx: normalizeCellSize(options.cellSizeCssPx),
    };
    this.pricePaneViews = priceAxis
      ? [new SquareChartGridPaneView(new FineGridPriceAxisRenderer(() => this.options, priceAxis), 'normal')]
      : [];
  }

  attached({ requestUpdate }: SeriesAttachedParameter<Time>): void {
    this.requestUpdate = requestUpdate;
  }

  detached(): void {
    this.requestUpdate = null;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.gridPaneView];
  }

  priceAxisPaneViews(): readonly IPrimitivePaneView[] {
    return this.pricePaneViews;
  }

  applyOptions(options: Partial<SquareChartGridOptions>): void {
    this.options = {
      ...this.options,
      ...options,
      cellSizeCssPx: normalizeCellSize(options.cellSizeCssPx ?? this.options.cellSizeCssPx),
    };
    this.requestUpdate?.();
  }
}
