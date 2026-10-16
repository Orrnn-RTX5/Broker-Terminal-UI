import type { ChartProperties } from '../store/useChartSettingsStore';

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
const DASHED_GRID_CONTRAST_MULTIPLIER = 2.8;
const DARK_SOLID_GRID_LUMINANCE_DELTA = 0.14;
const LIGHT_SOLID_GRID_LUMINANCE_DELTA = 0.095;

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
 * Solid guides use equally restrained axes. Dashed Fine and scale guides keep
 * equal axes, while the wider dashed Square grid has stronger price guides.
 */
export const getChartGridLineColors = ({
  background,
  grid,
  showGrid,
  lineStyle,
  gridType,
  colorScheme,
  preserveConfiguredColor = false,
}: {
  background: string;
  grid: string;
  showGrid: boolean;
  lineStyle?: 'dashed' | 'solid';
  gridType?: ChartProperties['gridType'];
  colorScheme?: ChartProperties['colorScheme'];
  preserveConfiguredColor?: boolean;
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
  const isSlateGridPreset = isDarkSurface
    && (colorScheme === 'Green and White' || colorScheme === 'Green and Blue');
  const fineGridColor = colorScheme === 'Custom' || isSlateGridPreset
    ? grid : isDarkSurface ? '#778899' : 'rgba(71, 85, 105, 0.45)';

  if (lineStyle === 'solid') {
    // Continuous guides need much less contrast than short dashes. Keep their
    // configured hue and 1px geometry, with equally quiet axes in every layout.
    const solidGrid = gridType === 'mt5' ? fineGridColor : grid;
    const parsed = parseChartColor(solidGrid);
    const delta = parsed ? Math.abs(getChartColorLuminance(parsed) - backgroundLuminance) : 0;
    const target = isDarkSurface ? DARK_SOLID_GRID_LUMINANCE_DELTA : LIGHT_SOLID_GRID_LUMINANCE_DELTA;
    const color = parsed
      ? formatGridLineColor(parsed, Math.min(parsed.alpha, target / Math.max(MIN_USEFUL_GRID_LUMINANCE_DELTA, delta)))
      : solidGrid;
    return { vertical: color, horizontal: color };
  }

  if (isSlateGridPreset) {
    // The black preset retains the reference's slate guides in every layout.
    return { vertical: grid, horizontal: grid };
  }

  if (gridType === 'mt5') {
    // Fine grid uses the live desktop reference's LightSlateGray short dashes.
    // Custom colors remain authoritative.
    return { vertical: fineGridColor, horizontal: fineGridColor };
  }

  // Dashed segments need stronger contrast than a continuous line. Keep the hue
  // and square geometry; only increase their opacity, in both preview and chart.
  const contrastMultiplier = lineStyle === 'dashed' ? DASHED_GRID_CONTRAST_MULTIPLIER : 1;
  // TradingView's scale grid uses the configured color equally on both axes.
  // Keep the square grid's price-first hierarchy as a separate presentation.
  if (preserveConfiguredColor || gridType === 'scale') {
    const parsed = parseChartColor(grid);
    const color = contrastMultiplier > 1 && parsed
      ? formatGridLineColor(parsed, parsed.alpha * contrastMultiplier)
      : grid;
    return { vertical: color, horizontal: color };
  }

  const fallbackGrid = isDarkSurface
    ? { r: 148, g: 163, b: 184, alpha: 1 }
    : { r: 71, g: 84, b: 103, alpha: 1 };
  const configuredGrid = parseChartColor(grid) ?? fallbackGrid;
  const configuredDelta = Math.abs(getChartColorLuminance(configuredGrid) - backgroundLuminance);
  let resolvedGrid = configuredDelta >= MIN_USEFUL_GRID_LUMINANCE_DELTA
    ? configuredGrid
    : fallbackGrid;
  // A near-background RGB color cannot become clearer through opacity alone.
  // Give dashed guides enough luminance separation to remain visible on dark
  // and light charts, retaining their configured hue.
  const resolvedDelta = Math.abs(getChartColorLuminance(resolvedGrid) - backgroundLuminance);
  if (lineStyle === 'dashed' && resolvedDelta < 0.3) {
    const offset = (0.3 - resolvedDelta) * 255 * (isDarkSurface ? 1 : -1);
    resolvedGrid = {
      ...resolvedGrid,
      r: clampChannel(resolvedGrid.r + offset),
      g: clampChannel(resolvedGrid.g + offset),
      b: clampChannel(resolvedGrid.b + offset),
    };
  }
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
    vertical: formatGridLineColor(resolvedGrid, verticalAlpha * contrastMultiplier),
    horizontal: formatGridLineColor(resolvedGrid, horizontalAlpha * contrastMultiplier),
  };
};
