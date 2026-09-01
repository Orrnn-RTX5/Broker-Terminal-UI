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

export interface SquareChartGridOptions {
  visible: boolean;
  cellSizeCssPx: number;
  verticalColor: string;
  horizontalColor: string;
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
      const horizontalStep = cellSize * verticalPixelRatio;

      context.save();
      context.lineWidth = 1;

      context.beginPath();
      for (let x = verticalStep; x < bitmapSize.width; x += verticalStep) {
        const crispX = Math.round(x) + 0.5;
        context.moveTo(crispX, 0);
        context.lineTo(crispX, bitmapSize.height);
      }
      context.strokeStyle = options.verticalColor;
      context.stroke();

      context.beginPath();
      for (let y = horizontalStep; y < bitmapSize.height; y += horizontalStep) {
        const crispY = Math.round(y) + 0.5;
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
  constructor(private readonly gridRenderer: SquareChartGridRenderer) {}

  zOrder(): PrimitivePaneViewZOrder {
    return 'bottom';
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

  constructor(options: SquareChartGridOptions) {
    this.options = {
      ...options,
      cellSizeCssPx: normalizeCellSize(options.cellSizeCssPx),
    };
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

  applyOptions(options: Partial<SquareChartGridOptions>): void {
    this.options = {
      ...this.options,
      ...options,
      cellSizeCssPx: normalizeCellSize(options.cellSizeCssPx ?? this.options.cellSizeCssPx),
    };
    this.requestUpdate?.();
  }
}
