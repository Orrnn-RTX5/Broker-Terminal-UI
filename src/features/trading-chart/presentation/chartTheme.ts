import type { ChartProperties } from '../../../store/useChartSettingsStore';
import type { TradingViewChartTheme } from '../../../types/chart';
import { getChartGridLineColors } from '../../../utils/chartGridStyle';

export type ChartColorPalette = ChartProperties['colors'];

export const MINUTE_SEPARATOR_PIXEL_DEDUP_DISTANCE = 10;
export const CHART_AXIS_FONT_FAMILY = '"Segoe UI", Tahoma, Arial, sans-serif';
export const LIGHT_CHART_AXIS_FONT_FAMILY = '"Segoe UI", Tahoma, Arial, sans-serif';
export const CHART_AXIS_FONT_SIZE = 14;

const parseCssColor = (value: string): { r: number; g: number; b: number } | null => {
  const color = value.trim();
  const hexMatch = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
  if (hexMatch) {
    const hex = hexMatch[1].length === 3
      ? hexMatch[1].split('').map((part) => `${part}${part}`).join('')
      : hexMatch[1];
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16),
    };
  }

  const rgbMatch = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(color);
  if (!rgbMatch) return null;
  return {
    r: Math.min(255, Math.max(0, Number(rgbMatch[1]))),
    g: Math.min(255, Math.max(0, Number(rgbMatch[2]))),
    b: Math.min(255, Math.max(0, Number(rgbMatch[3]))),
  };
};

export const isLightChartBackground = (background: string): boolean => {
  const color = parseCssColor(background);
  if (!color) return false;
  return (0.2126 * color.r) + (0.7152 * color.g) + (0.0722 * color.b) >= 180;
};

export const readChartAxisFontSize = (): number => {
  if (typeof document === 'undefined') return CHART_AXIS_FONT_SIZE;
  const root = document.documentElement;
  const size = Number.parseFloat(getComputedStyle(root).getPropertyValue('--rtx-ui-font-size'));
  return Number.isFinite(size) && size > 0 ? size : CHART_AXIS_FONT_SIZE;
};

export const clampAlpha = (alpha: number): number => Math.max(0, Math.min(1, alpha));

export const colorWithAlpha = (
  color: string | undefined,
  alpha: number,
  fallback: string,
): string => {
  if (!color) return fallback;
  const nextAlpha = clampAlpha(alpha);
  const trimmed = color.trim();
  const shortHex = /^#([a-f\d])([a-f\d])([a-f\d])$/i.exec(trimmed);
  if (shortHex) {
    const [, r, g, b] = shortHex;
    return `rgba(${parseInt(r + r, 16)}, ${parseInt(g + g, 16)}, ${parseInt(b + b, 16)}, ${nextAlpha})`;
  }

  const longHex = /^#([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(trimmed);
  if (longHex) {
    const [, r, g, b] = longHex;
    return `rgba(${parseInt(r, 16)}, ${parseInt(g, 16)}, ${parseInt(b, 16)}, ${nextAlpha})`;
  }

  const rgb = /^rgb\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/i.exec(trimmed);
  if (rgb) {
    const [, r, g, b] = rgb;
    return `rgba(${r}, ${g}, ${b}, ${nextAlpha})`;
  }

  const rgba = /^rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*[\d.]+\s*\)$/i.exec(trimmed);
  if (rgba) {
    const [, r, g, b] = rgba;
    return `rgba(${r}, ${g}, ${b}, ${nextAlpha})`;
  }

  return fallback;
};

const getColorLuminance = (color: string | undefined): number | null => {
  if (!color) return null;
  const trimmed = color.trim();
  const shortHex = /^#([a-f\d])([a-f\d])([a-f\d])$/i.exec(trimmed);
  if (shortHex) {
    const [, r, g, b] = shortHex;
    return ((parseInt(r + r, 16) * 0.2126) + (parseInt(g + g, 16) * 0.7152) + (parseInt(b + b, 16) * 0.0722)) / 255;
  }

  const longHex = /^#([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(trimmed);
  if (longHex) {
    const [, r, g, b] = longHex;
    return ((parseInt(r, 16) * 0.2126) + (parseInt(g, 16) * 0.7152) + (parseInt(b, 16) * 0.0722)) / 255;
  }

  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:,\s*[\d.]+\s*)?\)$/i.exec(trimmed);
  if (rgb) {
    const [, r, g, b] = rgb;
    return ((Number(r) * 0.2126) + (Number(g) * 0.7152) + (Number(b) * 0.0722)) / 255;
  }

  return null;
};

export const buildChartTheme = (
  colors: ChartColorPalette,
  showGrid: boolean,
  useReferenceLightSurface = false,
): TradingViewChartTheme => {
  const candleUp = colors.bullCandle || colors.barUp || '#089981';
  const candleDown = colors.bearCandle || colors.barDown || '#f23645';
  const barUp = colors.barUp || candleUp;
  const barDown = colors.barDown || candleDown;
  const line = colors.lineChart || '#2962ff';
  const rawGrid = colors.grid || 'rgba(120, 144, 156, 0.28)';
  const backgroundLuminance = getColorLuminance(colors.background) ?? 0;
  const backgroundIsDark = backgroundLuminance < 0.45;
  const gridLines = getChartGridLineColors({
    background: colors.background || '#0e0e12',
    grid: rawGrid,
    showGrid,
    preserveConfiguredColor: useReferenceLightSurface,
  });

  return {
    background: colors.background || '#0e0e12',
    text: colors.foreground || '#ffffff',
    axisText: backgroundIsDark
      ? colorWithAlpha(colors.foreground, 0.72, 'rgba(226, 232, 240, 0.72)')
      : (colors.foreground || '#25313c'),
    gridVertical: gridLines.vertical,
    gridHorizontal: gridLines.horizontal,
    scaleBorder: useReferenceLightSurface
      ? 'transparent'
      : colorWithAlpha(colors.foreground, 0.24, 'rgba(255, 255, 255, 0.24)'),
    crosshair: useReferenceLightSurface
      ? '#64748b'
      : colorWithAlpha(colors.foreground, 0.58, 'rgba(255, 255, 255, 0.58)'),
    candleUp,
    candleDown,
    barUp,
    barDown,
    wickUp: barUp,
    wickDown: barDown,
    line,
    areaTop: colorWithAlpha(line, 0.22, 'rgba(41, 98, 255, 0.22)'),
    areaBottom: colorWithAlpha(line, 0, 'rgba(41, 98, 255, 0)'),
    areaUpLine: candleUp,
    areaUpTop: colorWithAlpha(candleUp, 0.28, 'rgba(8, 153, 129, 0.28)'),
    areaUpBottom: colorWithAlpha(candleUp, 0, 'rgba(8, 153, 129, 0)'),
    areaDownLine: candleDown,
    areaDownTop: colorWithAlpha(candleDown, 0.28, 'rgba(242, 54, 69, 0.28)'),
    areaDownBottom: colorWithAlpha(candleDown, 0, 'rgba(242, 54, 69, 0)'),
    volumeUp: useReferenceLightSurface
      ? barUp
      : colorWithAlpha(barUp, 0.28, 'rgba(8, 153, 129, 0.28)'),
    volumeDown: useReferenceLightSurface
      ? barDown
      : colorWithAlpha(barDown, 0.28, 'rgba(242, 54, 69, 0.28)'),
  };
};
