export interface ChartGridLineColors {
  vertical: string;
  horizontal: string;
}

interface ParsedChartColor {
  r: number;
  g: number;
  b: number;
  alpha: number;
}

const TRANSPARENT_GRID_LINE = 'rgba(0, 0, 0, 0)';
const DARK_GRID_HORIZONTAL_LUMINANCE_DELTA = 0.135;
const DARK_GRID_VERTICAL_LUMINANCE_DELTA = 0.102;
const LIGHT_GRID_HORIZONTAL_LUMINANCE_DELTA = 0.095;
const LIGHT_GRID_VERTICAL_LUMINANCE_DELTA = 0.045;
const MIN_USEFUL_GRID_LUMINANCE_DELTA = 0.012;

const clampChannel = (value: number): number => Math.round(Math.max(0, Math.min(255, value)));
const clampAlpha = (value: number): number => Math.max(0, Math.min(1, value));

const parseChartColor = (color: string | undefined): ParsedChartColor | null => {
  const value = color?.trim();
  if (!value || value.toLowerCase() === 'transparent') return null;

  const shortHex = /^#([a-f\d])([a-f\d])([a-f\d])$/i.exec(value);
  if (shortHex) {
    const [, r, g, b] = shortHex;
    return {
      r: parseInt(r + r, 16),
      g: parseInt(g + g, 16),
      b: parseInt(b + b, 16),
      alpha: 1,
    };
  }

  const longHex = /^#([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(value);
  if (longHex) {
    const [, r, g, b] = longHex;
    return {
      r: parseInt(r, 16),
      g: parseInt(g, 16),
      b: parseInt(b, 16),
      alpha: 1,
    };
  }

  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+)\s*)?\)$/i.exec(value);
  if (!rgb) return null;

  return {
    r: clampChannel(Number(rgb[1])),
    g: clampChannel(Number(rgb[2])),
    b: clampChannel(Number(rgb[3])),
    alpha: clampAlpha(rgb[4] == null ? 1 : Number(rgb[4])),
  };
};

const getChartColorLuminance = ({ r, g, b }: ParsedChartColor): number => (
  ((r * 0.2126) + (g * 0.7152) + (b * 0.0722)) / 255
);

const formatGridLineColor = (color: ParsedChartColor, alpha: number): string => {
  const roundedAlpha = Number(clampAlpha(alpha).toFixed(3));
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${roundedAlpha})`;
};

/**
 * Builds a restrained two-axis grid from the single user-configurable grid
 * color. Horizontal guides are intentionally stronger because price scanning
 * is the primary chart task; vertical time guides stay quieter.
 */
export const getChartGridLineColors = ({
  background,
  grid,
  showGrid,
}: {
  background: string;
  grid: string;
  showGrid: boolean;
}): ChartGridLineColors => {
  if (!showGrid || grid.trim().toLowerCase() === 'transparent') {
    return {
      vertical: TRANSPARENT_GRID_LINE,
      horizontal: TRANSPARENT_GRID_LINE,
    };
  }

  const parsedBackground = parseChartColor(background) ?? { r: 0, g: 0, b: 0, alpha: 1 };
  const backgroundLuminance = getChartColorLuminance(parsedBackground);
  const isDarkSurface = backgroundLuminance < 0.45;
  const fallbackGrid = isDarkSurface
    ? { r: 148, g: 163, b: 184, alpha: 1 }
    : { r: 71, g: 84, b: 103, alpha: 1 };
  const configuredGrid = parseChartColor(grid) ?? fallbackGrid;
  const configuredDelta = Math.abs(getChartColorLuminance(configuredGrid) - backgroundLuminance);
  const resolvedGrid = configuredDelta >= MIN_USEFUL_GRID_LUMINANCE_DELTA
    ? configuredGrid
    : fallbackGrid;
  const luminanceDelta = Math.max(
    MIN_USEFUL_GRID_LUMINANCE_DELTA,
    Math.abs(getChartColorLuminance(resolvedGrid) - backgroundLuminance),
  );
  const horizontalTarget = isDarkSurface
    ? DARK_GRID_HORIZONTAL_LUMINANCE_DELTA
    : LIGHT_GRID_HORIZONTAL_LUMINANCE_DELTA;
  const verticalTarget = isDarkSurface
    ? DARK_GRID_VERTICAL_LUMINANCE_DELTA
    : LIGHT_GRID_VERTICAL_LUMINANCE_DELTA;
  const horizontalAlpha = Math.min(resolvedGrid.alpha, horizontalTarget / luminanceDelta);
  const verticalAlpha = horizontalAlpha * (verticalTarget / horizontalTarget);

  return {
    vertical: formatGridLineColor(resolvedGrid, verticalAlpha),
    horizontal: formatGridLineColor(resolvedGrid, horizontalAlpha),
  };
};

