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
  showBackgroundLogo?: boolean;
  isLightBackground?: boolean;
  backgroundLogoOpacity?: number;
  backgroundLogoSrc?: string;
  lineStyle?: 'dashed' | 'solid';
  dashPatternCssPx?: readonly [number, number];
  cellSizeCssPx: number;
  verticalColor: string;
  horizontalColor: string;
  profile?: 'square' | 'fine';
}

export const RTX5_DEFAULT_CHART_WATERMARK_SRC = '/brand/rtx5-chart-watermark.png';
const DEFAULT_WATERMARK_ASSET_PATH = '/brand/rtx5-chart-watermark.png?v=2';
const DEFAULT_WATERMARK_OPACITY_PERCENT = 18;
const watermarkImageCache = new Map<string, HTMLImageElement>();
const lightWatermarkCanvasCache = new Map<string, HTMLCanvasElement>();
const watermarkLoadListeners = new Set<() => void>();

const resolveDefaultWatermarkUrl = (): string => {
  if (typeof document !== 'undefined' && document.baseURI) {
    try {
      return new URL('brand/rtx5-chart-watermark.png?v=2', document.baseURI).href;
    } catch {
      // Fall back to root-relative path.
    }
  }
  return DEFAULT_WATERMARK_ASSET_PATH;
};

const getLoadedWatermarkImage = (customSrc?: string): HTMLImageElement | null => {
  if (typeof Image === 'undefined') return null;
  const src = customSrc?.trim() ? customSrc.trim() : resolveDefaultWatermarkUrl();
  let img = watermarkImageCache.get(src);
  if (!img) {
    img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      for (const listener of watermarkLoadListeners) {
        try {
          listener();
        } catch {
          // Ignore disposed chart listeners.
        }
      }
    };
    img.src = src;
    watermarkImageCache.set(src, img);
  }
  return img.complete && img.naturalWidth > 0 && img.naturalHeight > 0 ? img : null;
};

const getLightTintedWatermarkSource = (
  img: HTMLImageElement,
  key: string,
): HTMLCanvasElement | HTMLImageElement => {
  if (typeof document === 'undefined') return img;
  const cached = lightWatermarkCanvasCache.get(key);
  if (cached) return cached;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return img;
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3]!;
      if (a === 0) continue;
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      // Keep the green '5' accent, tint white 'X' wings to slate for light backgrounds
      if (g - b > 30) {
        data[i] = 101;
        data[i + 1] = 163;
        data[i + 2] = 13;
      } else if (r > 200 && g > 200 && b > 200) {
        data[i] = 15;
        data[i + 1] = 23;
        data[i + 2] = 42;
      }
    }
    ctx.putImageData(imageData, 0, 0);
    lightWatermarkCanvasCache.set(key, canvas);
    return canvas;
  } catch {
    return img;
  }
};

type WatermarkPolygon = readonly (readonly [number, number])[];

const RTX5_WATERMARK_CENTER_X = 395.5;
const RTX5_WATERMARK_CENTER_Y = 414;
const RTX5_WATERMARK_SPAN_UNITS = 745;

const RTX5_WATERMARK_WINGS: readonly WatermarkPolygon[] = [
  [
    [762, 158], [768, 159], [555, 389], [457, 390], [526, 318], [549, 290],
    [553, 284], [551, 276], [543, 267], [534, 263], [507, 262], [463, 265],
    [459, 262], [458, 254], [464, 236], [485, 209], [497, 203], [520, 201],
    [623, 203], [665, 199], [708, 187], [761, 159],
  ],
  [
    [137, 172], [264, 172], [411, 340], [413, 342], [290, 342], [138, 173],
  ],
  [
    [237, 450], [335, 450], [318, 473], [244, 547], [238, 556], [241, 565],
    [253, 575], [262, 577], [300, 577], [328, 574], [333, 579], [333, 587],
    [325, 607], [315, 620], [303, 632], [295, 636], [261, 639], [227, 638],
    [157, 637], [118, 642], [84, 652], [33, 680], [23, 681], [236, 451],
  ],
  [
    [372, 480], [502, 481], [654, 650], [526, 650], [452, 563], [372, 481],
  ],
];

const RTX5_WATERMARK_ACCENT_FIVE: WatermarkPolygon = [
  [355, 367], [432, 368], [425, 388], [374, 389], [375, 397], [415, 397],
  [427, 402], [435, 411], [438, 419], [438, 439], [431, 452], [419, 459],
  [412, 461], [375, 460], [367, 456], [360, 449], [356, 441], [355, 432],
  [374, 432], [375, 436], [379, 439], [415, 439], [419, 434], [419, 423],
  [413, 418], [355, 418], [355, 368],
];

const traceWatermarkPolygon = (
  context: CanvasRenderingContext2D,
  polygon: WatermarkPolygon,
  centerXCss: number,
  centerYCss: number,
  unitScaleCss: number,
  horizontalPixelRatio: number,
  verticalPixelRatio: number,
): void => {
  for (let index = 0; index < polygon.length; index += 1) {
    const [px, py] = polygon[index]!;
    const x = (centerXCss + (px - RTX5_WATERMARK_CENTER_X) * unitScaleCss) * horizontalPixelRatio;
    const y = (centerYCss + (py - RTX5_WATERMARK_CENTER_Y) * unitScaleCss) * verticalPixelRatio;
    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  }
  context.closePath?.();
};

const traceSmoothWatermarkWings = (
  context: CanvasRenderingContext2D,
  mapX: (px: number) => number,
  mapY: (py: number) => number,
): void => {
  // 1. Top-Left Wing
  context.moveTo(mapX(137.0), mapY(172.0));
  context.lineTo(mapX(264.5), mapY(172.0));
  context.lineTo(mapX(413.0), mapY(342.5));
  context.lineTo(mapX(289.5), mapY(342.5));
  context.closePath?.();

  // 2. Bottom-Right Wing
  context.moveTo(mapX(372.0), mapY(480.5));
  context.lineTo(mapX(501.5), mapY(480.5));
  context.lineTo(mapX(654.5), mapY(650.5));
  context.lineTo(mapX(525.5), mapY(650.5));
  context.closePath?.();

  // 3. Top-Right Sweeping Wing (smooth cubic Beziers)
  context.moveTo(mapX(456.5), mapY(390.0));
  context.lineTo(mapX(555.0), mapY(390.0));
  context.bezierCurveTo(mapX(625.0), mapY(314.0), mapX(700.0), mapY(232.0), mapX(766.0), mapY(161.0));
  context.bezierCurveTo(mapX(769.5), mapY(157.5), mapX(767.0), mapY(155.5), mapX(761.0), mapY(158.5));
  context.bezierCurveTo(mapX(718.0), mapY(184.5), mapX(672.0), mapY(202.0), mapX(610.0), mapY(202.0));
  context.lineTo(mapX(512.0), mapY(201.5));
  context.bezierCurveTo(mapX(484.0), mapY(201.5), mapX(466.0), mapY(224.0), mapX(459.0), mapY(250.0));
  context.bezierCurveTo(mapX(456.5), mapY(260.0), mapX(460.0), mapY(265.0), mapX(470.0), mapY(264.5));
  context.lineTo(mapX(526.0), mapY(263.0));
  context.bezierCurveTo(mapX(552.0), mapY(263.0), mapX(559.0), mapY(279.0), mapX(544.0), mapY(296.0));
  context.lineTo(mapX(456.5), mapY(390.0));
  context.closePath?.();

  // 4. Bottom-Left Sweeping Wing (smooth cubic Beziers)
  context.moveTo(mapX(335.0), mapY(450.0));
  context.lineTo(mapX(236.5), mapY(450.0));
  context.bezierCurveTo(mapX(166.5), mapY(526.0), mapX(91.5), mapY(608.0), mapX(25.5), mapY(679.0));
  context.bezierCurveTo(mapX(22.0), mapY(682.5), mapX(24.5), mapY(684.5), mapX(30.5), mapY(681.5));
  context.bezierCurveTo(mapX(73.5), mapY(655.5), mapX(119.5), mapY(638.0), mapX(181.5), mapY(638.0));
  context.lineTo(mapX(279.5), mapY(638.5));
  context.bezierCurveTo(mapX(307.5), mapY(638.5), mapX(325.5), mapY(616.0), mapX(332.5), mapY(590.0));
  context.bezierCurveTo(mapX(335.0), mapY(580.0), mapX(331.5), mapY(575.0), mapX(321.5), mapY(575.5));
  context.lineTo(mapX(265.5), mapY(577.0));
  context.bezierCurveTo(mapX(239.5), mapY(577.0), mapX(232.5), mapY(561.0), mapX(247.5), mapY(544.0));
  context.lineTo(mapX(335.0), mapY(450.0));
  context.closePath?.();
};

const traceSmoothWatermarkFive = (
  context: CanvasRenderingContext2D,
  mapX: (px: number) => number,
  mapY: (py: number) => number,
): void => {
  context.moveTo(mapX(355.0), mapY(367.0));
  context.lineTo(mapX(432.5), mapY(367.0));
  context.lineTo(mapX(425.0), mapY(388.5));
  context.lineTo(mapX(374.5), mapY(388.5));
  context.lineTo(mapX(374.5), mapY(397.0));
  context.lineTo(mapX(410.0), mapY(397.0));
  context.bezierCurveTo(mapX(429.0), mapY(397.0), mapX(438.5), mapY(408.0), mapX(438.5), mapY(428.5));
  context.bezierCurveTo(mapX(438.5), mapY(449.5), mapX(428.0), mapY(460.5), mapX(409.0), mapY(460.5));
  context.lineTo(mapX(382.0), mapY(460.5));
  context.bezierCurveTo(mapX(364.5), mapY(460.5), mapX(355.0), mapY(449.0), mapX(355.0), mapY(432.0));
  context.lineTo(mapX(374.5), mapY(432.0));
  context.bezierCurveTo(mapX(374.5), mapY(437.5), mapX(378.5), mapY(439.5), mapX(385.0), mapY(439.5));
  context.lineTo(mapX(408.0), mapY(439.5));
  context.bezierCurveTo(mapX(416.0), mapY(439.5), mapX(419.5), mapY(435.5), mapX(419.5), mapY(428.5));
  context.bezierCurveTo(mapX(419.5), mapY(421.5), mapX(416.0), mapY(418.0), mapX(408.0), mapY(418.0));
  context.lineTo(mapX(355.0), mapY(418.0));
  context.lineTo(mapX(355.0), mapY(367.0));
  context.closePath?.();
};

export const drawChartBackgroundWatermark = (
  context: CanvasRenderingContext2D,
  bitmapWidth: number,
  bitmapHeight: number,
  horizontalPixelRatio: number,
  verticalPixelRatio: number,
  isLightBackground = false,
  opacityPercent = DEFAULT_WATERMARK_OPACITY_PERCENT,
  customSrc?: string,
): void => {
  const safeHpr = Number.isFinite(horizontalPixelRatio) && horizontalPixelRatio > 0 ? horizontalPixelRatio : 1;
  const safeVpr = Number.isFinite(verticalPixelRatio) && verticalPixelRatio > 0 ? verticalPixelRatio : 1;
  const cssWidth = bitmapWidth / safeHpr;
  const cssHeight = bitmapHeight / safeVpr;
  if (!Number.isFinite(cssWidth) || !Number.isFinite(cssHeight) || cssWidth < 80 || cssHeight < 80) return;

  const normalizedOpacity = Number.isFinite(opacityPercent)
    ? Math.max(0.02, Math.min(1, opacityPercent / 100))
    : DEFAULT_WATERMARK_OPACITY_PERCENT / 100;
  const targetSizeCssPx = Math.max(180, Math.min(400, Math.min(cssWidth, cssHeight) * 0.56));
  const centerXCss = cssWidth * 0.5;
  const centerYCss = cssHeight * 0.5;

  const loadedImage = typeof context.drawImage === 'function'
    ? getLoadedWatermarkImage(customSrc)
    : null;
  if (loadedImage) {
    const aspect = loadedImage.naturalWidth / Math.max(1, loadedImage.naturalHeight);
    const drawWidthCss = aspect >= 1 ? targetSizeCssPx : targetSizeCssPx * aspect;
    const drawHeightCss = aspect >= 1 ? targetSizeCssPx / aspect : targetSizeCssPx;
    const drawX = (centerXCss - drawWidthCss * 0.5) * safeHpr;
    const drawY = (centerYCss - drawHeightCss * 0.5) * safeVpr;
    const drawW = drawWidthCss * safeHpr;
    const drawH = drawHeightCss * safeVpr;
    const isCustom = Boolean(customSrc?.trim());
    const drawSource = isLightBackground && !isCustom
      ? getLightTintedWatermarkSource(loadedImage, loadedImage.src)
      : loadedImage;

    context.save();
    context.globalAlpha = normalizedOpacity;
    context.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in context) {
      context.imageSmoothingQuality = 'high';
    }
    context.drawImage(drawSource, drawX, drawY, drawW, drawH);
    context.restore();
    return;
  }

  if (typeof context.fill !== 'function') return;
  const unitScaleCss = targetSizeCssPx / RTX5_WATERMARK_SPAN_UNITS;
  const mapX = (px: number) => (centerXCss + (px - RTX5_WATERMARK_CENTER_X) * unitScaleCss) * safeHpr;
  const mapY = (py: number) => (centerYCss + (py - RTX5_WATERMARK_CENTER_Y) * unitScaleCss) * safeVpr;
  const useSmoothBeziers = typeof context.bezierCurveTo === 'function';

  context.save();
  context.beginPath();
  if (useSmoothBeziers) {
    traceSmoothWatermarkWings(context, mapX, mapY);
  } else {
    for (const wing of RTX5_WATERMARK_WINGS) {
      traceWatermarkPolygon(context, wing, centerXCss, centerYCss, unitScaleCss, safeHpr, safeVpr);
    }
  }
  context.fillStyle = isLightBackground
    ? `rgba(15, 23, 42, ${Math.min(1, normalizedOpacity * 0.85).toFixed(3)})`
    : `rgba(255, 255, 255, ${normalizedOpacity.toFixed(3)})`;
  context.fill();

  context.beginPath();
  if (useSmoothBeziers) {
    traceSmoothWatermarkFive(context, mapX, mapY);
  } else {
    traceWatermarkPolygon(context, RTX5_WATERMARK_ACCENT_FIVE, centerXCss, centerYCss, unitScaleCss, safeHpr, safeVpr);
  }
  context.fillStyle = isLightBackground
    ? `rgba(101, 163, 13, ${Math.min(1, normalizedOpacity * 1.15).toFixed(3)})`
    : `rgba(128, 195, 66, ${Math.min(1, normalizedOpacity * 1.15).toFixed(3)})`;
  context.fill();
  context.restore();
};

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
    if (!options.visible && !options.showBackgroundLogo) return;

    target.useBitmapCoordinateSpace(({
      context,
      bitmapSize,
      horizontalPixelRatio,
      verticalPixelRatio,
    }) => {
      if (options.showBackgroundLogo) {
        drawChartBackgroundWatermark(
          context,
          bitmapSize.width,
          bitmapSize.height,
          horizontalPixelRatio,
          verticalPixelRatio,
          options.isLightBackground === true,
          options.backgroundLogoOpacity ?? DEFAULT_WATERMARK_OPACITY_PERCENT,
          options.backgroundLogoSrc,
        );
      }
      if (!options.visible) return;

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

  private readonly handleWatermarkImageLoad = (): void => {
    this.requestUpdate?.();
  };

  attached({ requestUpdate }: SeriesAttachedParameter<Time>): void {
    this.requestUpdate = requestUpdate;
    watermarkLoadListeners.add(this.handleWatermarkImageLoad);
    if (this.options.showBackgroundLogo) {
      getLoadedWatermarkImage(this.options.backgroundLogoSrc);
    }
  }

  detached(): void {
    watermarkLoadListeners.delete(this.handleWatermarkImageLoad);
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
