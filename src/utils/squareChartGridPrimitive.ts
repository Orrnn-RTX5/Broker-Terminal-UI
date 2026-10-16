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

/**
 * MT5 bottom time-axis tick positions start at the left chart border (0px)
 * and repeat at every 64px major vertical grid line (every cell in Square
 * mode, and every second 32px cell in Fine/MT5 mode).
 */
export const getSquareGridTimeAxisPositions = (
  extentCssPx: number,
  cellSizeCssPx: number = SQUARE_CHART_GRID_CELL_SIZE_PX,
  profile: 'square' | 'fine' = 'square',
): number[] => {
  if (!Number.isFinite(extentCssPx) || extentCssPx <= 0) return [];
  const baseStep = normalizeCellSize(cellSizeCssPx);
  const step = profile === 'fine' ? baseStep * 2 : baseStep;
  const positions: number[] = [];
  for (let x = 0; x < extentCssPx; x += step) {
    positions.push(x);
  }
  return positions;
};

export interface FineGridPriceAxis {
  labelAt: (coordinate: number) => string | null;
  appearance: () => { color: string; fontSize: number; fontFamily: string };
}

export interface SquareGridTimeAxis {
  labelAt: (coordinate: number, isFirstTick: boolean) => string | null;
  timeKeyAt?: (coordinate: number) => string | number | null;
  appearance: () => {
    color: string;
    backgroundColor?: string;
    borderColor?: string;
    fontSize: number;
    fontFamily: string;
  };
}

const MT5_TIME_AXIS_MAX_FONT_SIZE_PX = 10;
const MT5_TIME_AXIS_TICK_LENGTH_PX = 4;

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

class SquareGridTimeAxisRenderer implements IPrimitivePaneRenderer {
  constructor(
    private readonly readOptions: () => Readonly<SquareChartGridOptions>,
    private readonly timeAxis: SquareGridTimeAxis,
  ) {}

  draw(target: CanvasRenderingTarget2D): void {
    const options = this.readOptions();
    if (!options.visible) return;
    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      const appearance = this.timeAxis.appearance();
      const positions = getSquareGridTimeAxisPositions(
        mediaSize.width,
        options.cellSizeCssPx,
        options.profile,
      );
      if (positions.length === 0) return;

      const fontSize = Math.max(
        8,
        Math.min(
          Number.isFinite(appearance.fontSize) && appearance.fontSize > 0
            ? appearance.fontSize
            : MT5_TIME_AXIS_MAX_FONT_SIZE_PX,
          MT5_TIME_AXIS_MAX_FONT_SIZE_PX,
        ),
      );
      const borderColor = appearance.borderColor && appearance.borderColor !== 'transparent'
        ? appearance.borderColor
        : appearance.color;

      context.save();
      if (appearance.backgroundColor && typeof context.fillRect === 'function') {
        context.fillStyle = appearance.backgroundColor;
        context.fillRect(0, 1, mediaSize.width, Math.max(0, mediaSize.height - 1));
        context.fillStyle = borderColor;
        context.fillRect(0, 0, mediaSize.width, 1);
      }

      context.font = `${fontSize}px ${appearance.fontFamily}`;
      context.textBaseline = 'middle';
      context.textAlign = 'left';

      const textY = Math.max(
        MT5_TIME_AXIS_TICK_LENGTH_PX + fontSize / 2 + 2,
        Math.floor(mediaSize.height / 2) + 0.5,
      );
      let hasDrawnFirstTick = false;
      let lastTimeKey: string | number | null = null;
      let minNextX = 0;

      for (const x of positions) {
        if (x < minNextX) continue;
        const timeKey = this.timeAxis.timeKeyAt?.(x) ?? null;
        if (hasDrawnFirstTick && timeKey !== null && timeKey === lastTimeKey) continue;

        const text = this.timeAxis.labelAt(x, !hasDrawnFirstTick);
        if (text === null || text === '') continue;

        const textX = x === 0 ? 2 : x + 1;
        const measuredWidth = typeof context.measureText === 'function'
          ? context.measureText(text).width
          : 0;
        if (x > 0 && measuredWidth > 0 && textX + measuredWidth > mediaSize.width - 2) {
          continue;
        }

        if (typeof context.fillRect === 'function') {
          context.fillStyle = appearance.color;
          context.fillRect(x === 0 ? 0 : Math.round(x), 1, 1, MT5_TIME_AXIS_TICK_LENGTH_PX);
        }

        context.fillStyle = appearance.color;
        context.fillText(text, textX, textY);

        hasDrawnFirstTick = true;
        if (timeKey !== null) lastTimeKey = timeKey;
        minNextX = measuredWidth > 0 ? textX + measuredWidth : x + 1;
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
  private readonly timePaneViews: readonly IPrimitivePaneView[];

  constructor(
    options: SquareChartGridOptions,
    priceAxis?: FineGridPriceAxis,
    timeAxis?: SquareGridTimeAxis,
  ) {
    this.options = {
      ...options,
      cellSizeCssPx: normalizeCellSize(options.cellSizeCssPx),
    };
    this.pricePaneViews = priceAxis
      ? [new SquareChartGridPaneView(new FineGridPriceAxisRenderer(() => this.options, priceAxis), 'normal')]
      : [];
    this.timePaneViews = timeAxis
      ? [new SquareChartGridPaneView(new SquareGridTimeAxisRenderer(() => this.options, timeAxis), 'normal')]
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

  timeAxisPaneViews(): readonly IPrimitivePaneView[] {
    return this.timePaneViews;
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
