import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type ChartTypeEnum = "Bar" | "Candlesticks" | "Line" | "Area";
export type ChartGridLineStyle = "dashed" | "solid";
// The legacy persisted id "mt5" identifies the user-facing Fine grid.
export type ChartGridType = "square" | "scale" | "mt5";
export type ChartBackgroundLogoMode = "none" | "default" | "url" | "file";
export type ChartBackgroundLogoArea = "chart" | "chart_and_axes";
export type LegacyColorScheme =
  | "Green on Black"
  | "Blue on Black"
  | "Black on White"
  | "Yellow on Black"
  | "Green on White";

export type ColorScheme =
  | "Green and Red"
  | "Green and White"
  | "Green and Blue"
  | "Blue and White"
  | "Blue and Red"
  | "Gray and White"
  | "Yellow and White"
  | "Custom";

export const normalizeColorSchemeName = (
  scheme?: ColorScheme | LegacyColorScheme | null,
): ColorScheme => {
  switch (scheme) {
    case "Green on Black":
      return "Green and Red";
    case "Blue on Black":
      return "Blue and Red";
    case "Black on White":
      return "Gray and White";
    case "Yellow on Black":
      return "Yellow and White";
    case "Green on White":
      return "Green and White";
    case "Green and Red":
    case "Green and White":
    case "Green and Blue":
    case "Blue and White":
    case "Blue and Red":
    case "Gray and White":
    case "Yellow and White":
    case "Custom":
      return scheme;
    default:
      return "Blue and Red";
  }
};

export const CHART_PROFIT_COLOR = "#00C896";
export const CHART_LOSS_COLOR = "#FF4D4F";
// Candle bodies, borders and wicks share the reference chart's directional hues.
// Price levels and trading controls have their own semantic colors.
export const CHART_CANDLE_UP_COLOR = "#089981";
export const CHART_CANDLE_DOWN_COLOR = "#F23645";
export const CHART_BLUE_COLOR = "#4597ff";
const BLUE_TEMPLATE_RED_COLOR = "#ff5858";

const LEGACY_CHART_PROFIT_COLOR = "#10B981";
const LEGACY_CHART_LOSS_COLOR = "#EF4444";

export interface ChartProperties {
  // Common
  chartType: ChartTypeEnum;
  chartOnForeground: boolean;
  chartShift: boolean;
  chartAutoScroll: boolean;
  scaleFixOneToOne: boolean;
  scaleFix: boolean;
  fixedMaximum: number;
  fixedMinimum: number;

  // Show
  showTicker: boolean;
  showOHLC: boolean;
  showQuickTradingButtons: boolean;
  showBidPriceLine: boolean;
  showAskPriceLine: boolean;
  showLastPriceLine: boolean;
  showPeriodSeparators: boolean;
  showGrid: boolean;
  showBackgroundLogo: boolean;
  backgroundLogoMode?: ChartBackgroundLogoMode;
  backgroundLogoOpacity?: number;
  backgroundLogoArea?: ChartBackgroundLogoArea;
  backgroundLogoUrl?: string;
  backgroundLogoFileName?: string;
  backgroundLogoFileDataUrl?: string;
  gridType: ChartGridType;
  gridLineStyle: ChartGridLineStyle;
  showTickVolumes: boolean;
  showRealVolumes: boolean;
  showObjectDescriptions: boolean;
  showTradeLevels: boolean;
  showTradeHistory: boolean;
  showTradeHistoryBoxes: boolean;
  showTradeHistoryArrows: boolean;
  tradeHistoryLineOpacity: number;
  tradeHistoryBoxOpacity: number;

  // Colors
  colorScheme: ColorScheme;
  colors: {
    background: string;
    foreground: string;
    grid: string;
    barUp: string;
    barDown: string;
    bullCandle: string;
    bearCandle: string;
    lineChart: string;
    volumes: string;
    bidPriceLine: string;
    askPriceLine: string;
    lastPriceLine: string;
    stopLevels: string;
  };
}

const greenSchemeColors: ChartProperties["colors"] = {
  background: "#000000",
  foreground: "#ffffff",
  grid: "rgba(255,255,255,0.12)",
  barUp: CHART_CANDLE_UP_COLOR,
  barDown: CHART_CANDLE_DOWN_COLOR,
  bullCandle: CHART_CANDLE_UP_COLOR,
  bearCandle: CHART_CANDLE_DOWN_COLOR,
  lineChart: CHART_PROFIT_COLOR,
  volumes: "rgba(0, 200, 150, 0.32)",
  bidPriceLine: "#778899",
  askPriceLine: CHART_LOSS_COLOR,
  lastPriceLine: CHART_PROFIT_COLOR,
  stopLevels: CHART_LOSS_COLOR,
};

// Match the Market Watch Bid/Ask directional palette.
const blueSchemeColors: ChartProperties["colors"] = {
  ...greenSchemeColors,
  barUp: CHART_BLUE_COLOR,
  bullCandle: CHART_BLUE_COLOR,
  lineChart: CHART_BLUE_COLOR,
  volumes: "rgba(69, 151, 255, 0.32)",
  barDown: BLUE_TEMPLATE_RED_COLOR,
  bearCandle: BLUE_TEMPLATE_RED_COLOR,
  askPriceLine: BLUE_TEMPLATE_RED_COLOR,
  stopLevels: BLUE_TEMPLATE_RED_COLOR,
  lastPriceLine: CHART_BLUE_COLOR,
};

// Used only to correct saved settings from the earlier misunderstood preset.
const legacyGreenOnWhiteSchemeColors: ChartProperties["colors"] = {
  background: "#ffffff",
  foreground: "#000000",
  grid: "#f1ecf2",
  barUp: "#26a69a",
  barDown: "#ef5350",
  bullCandle: "#26a69a",
  bearCandle: "#ef5350",
  lineChart: "#56ba84",
  volumes: "#26a69a",
  bidPriceLine: "#26a69a",
  askPriceLine: "#ef5350",
  lastPriceLine: "#9cbaf0",
  stopLevels: "#ef5350",
};

// The native reference has hollow black bulls, white bears, and lime outlines.
const greenAndWhiteSchemeColors: ChartProperties["colors"] = {
  background: "#000000",
  foreground: "#ffffff",
  grid: "#778899",
  barUp: "#00ff00",
  barDown: "#00ff00",
  bullCandle: "#000000",
  bearCandle: "#ffffff",
  lineChart: "#00ff00",
  volumes: "#32cd32",
  bidPriceLine: "#778899",
  askPriceLine: "#ff0000",
  lastPriceLine: "#00c000",
  stopLevels: "#ff0000",
};

// Reference preset with green bulls, blue bears, and lime outlines on black.
const greenAndBlueSchemeColors: ChartProperties["colors"] = {
  ...greenAndWhiteSchemeColors,
  bullCandle: "#7cfc00",
  bearCandle: "#0000ff",
};

// Reference preset with blue bulls and white bears on black.
const blueAndWhiteSchemeColors: ChartProperties["colors"] = {
  ...blueSchemeColors,
  barUp: "#2557ff",
  barDown: "#ffffff",
  bullCandle: "#2557ff",
  bearCandle: "#ffffff",
  lineChart: "#2557ff",
  volumes: "rgba(37, 87, 255, 0.32)",
  lastPriceLine: "#2557ff",
};

export const defaultChartProperties: ChartProperties = {
  chartType: "Candlesticks",
  chartOnForeground: false,
  chartShift: false,
  chartAutoScroll: true,
  scaleFixOneToOne: false,
  scaleFix: false,
  fixedMaximum: 0,
  fixedMinimum: 0,

  showTicker: true,
  showOHLC: true,
  showQuickTradingButtons: true,
  showBidPriceLine: true,
  showAskPriceLine: false,
  showLastPriceLine: false,
  showPeriodSeparators: true,
  showGrid: true,
  showBackgroundLogo: true,
  backgroundLogoMode: "default",
  backgroundLogoOpacity: 18,
  backgroundLogoArea: "chart",
  backgroundLogoUrl: "",
  backgroundLogoFileName: "",
  backgroundLogoFileDataUrl: "",
  gridType: "square",
  gridLineStyle: "dashed",
  showTickVolumes: false,
  showRealVolumes: false,
  showObjectDescriptions: false,
  showTradeLevels: true,
  showTradeHistory: true,
  showTradeHistoryBoxes: true,
  showTradeHistoryArrows: true,
  tradeHistoryLineOpacity: 70,
  tradeHistoryBoxOpacity: 40,

  colorScheme: "Blue and Red",
  colors: { ...blueSchemeColors },
};

const VOLUME_BARS_DEFAULT_MIGRATION_VERSION = 1;
const PERIOD_SEPARATORS_DEFAULT_MIGRATION_VERSION = 1;
const CHART_SHIFT_DEFAULT_MIGRATION_VERSION = 1;
const OHLC_DEFAULT_MIGRATION_VERSION = 1;
const BLUE_RED_DEFAULT_MIGRATION_VERSION = 1;

export const clampChartOpacityPercent = (value: unknown, fallback: number): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(100, Math.round(numeric)));
};

type PersistedChartProperties = Partial<Omit<ChartProperties, "colors" | "colorScheme">> & {
  colorScheme?: ColorScheme | LegacyColorScheme;
  colors?: Partial<ChartProperties["colors"]>;
};

const normalizeSchemeColors = (
  rawColorScheme: ColorScheme | LegacyColorScheme,
  colors: ChartProperties["colors"],
): ChartProperties["colors"] => {
  const colorScheme = normalizeColorSchemeName(rawColorScheme);
  if (colorScheme === "Blue and White") {
    return {
      ...colors,
      background: "#000000",
      grid: colors.grid === "rgba(255,255,255,0.06)"
        ? blueAndWhiteSchemeColors.grid
        : colors.grid,
    };
  }

  if (colorScheme === "Blue and Red") {
    const migrateBlue = (value: string) => ["#2962ff", "#5b8fd9"].includes(value.toLowerCase()) ? CHART_BLUE_COLOR : value;
    const migrateRed = (value: string) => value.toUpperCase() === CHART_LOSS_COLOR ? BLUE_TEMPLATE_RED_COLOR : value;
    return {
      ...colors,
      barUp: migrateBlue(colors.barUp),
      bullCandle: migrateBlue(colors.bullCandle),
      lineChart: migrateBlue(colors.lineChart),
      lastPriceLine: migrateBlue(colors.lastPriceLine),
      barDown: migrateRed(colors.barDown),
      bearCandle: migrateRed(colors.bearCandle),
      askPriceLine: migrateRed(colors.askPriceLine),
      stopLevels: migrateRed(colors.stopLevels),
      volumes: ["rgba(41, 98, 255, 0.32)", "rgba(91, 143, 217, 0.32)"].includes(colors.volumes)
        ? "rgba(69, 151, 255, 0.32)"
        : colors.volumes,
    };
  }

  if (colorScheme === "Green and Red") {
    const migrateLegacyColor = (value: string, legacy: string, replacement: string) => (
      value.toUpperCase() === legacy ? replacement : value
    );
    // Only migrate known built-in candle colors. Custom schemes are not routed
    // through this branch, and other explicitly configured colors stay intact.
    const migrateCandleColor = (value: string, direction: "up" | "down") => {
      const previousDefaults = direction === "up"
        ? [LEGACY_CHART_PROFIT_COLOR, CHART_PROFIT_COLOR, "#059669"]
        : [LEGACY_CHART_LOSS_COLOR, CHART_LOSS_COLOR, "#DC2626"];
      return previousDefaults.includes(value.toUpperCase())
        ? direction === "up" ? CHART_CANDLE_UP_COLOR : CHART_CANDLE_DOWN_COLOR
        : value;
    };

    return {
      ...colors,
      background: "#000000",
      barUp: migrateCandleColor(colors.barUp, "up"),
      barDown: migrateCandleColor(colors.barDown, "down"),
      bullCandle: migrateCandleColor(colors.bullCandle, "up"),
      bearCandle: migrateCandleColor(colors.bearCandle, "down"),
      lineChart: migrateLegacyColor(colors.lineChart, LEGACY_CHART_PROFIT_COLOR, CHART_PROFIT_COLOR),
      volumes: colors.volumes === "rgba(34, 197, 94, 0.4)"
        ? greenSchemeColors.volumes
        : colors.volumes,
      askPriceLine: migrateLegacyColor(colors.askPriceLine, LEGACY_CHART_LOSS_COLOR, CHART_LOSS_COLOR),
      lastPriceLine: colors.lastPriceLine.toUpperCase() === "#00C000"
        ? CHART_PROFIT_COLOR
        : colors.lastPriceLine,
      stopLevels: migrateLegacyColor(colors.stopLevels, LEGACY_CHART_LOSS_COLOR, CHART_LOSS_COLOR),
    };
  }

  return colors;
};

export const normalizeChartProperties = (properties?: PersistedChartProperties | null): ChartProperties => {
  const legacyWhitePreset = properties?.colorScheme === "Green on White";
  const colorScheme: ColorScheme = normalizeColorSchemeName(
    properties?.colorScheme ?? defaultChartProperties.colorScheme,
  );
  const rawSavedColors = legacyWhitePreset
    ? Object.fromEntries(Object.entries(properties?.colors ?? {}).filter(([key, value]) => (
      value?.toLowerCase() !== legacyGreenOnWhiteSchemeColors[key as keyof ChartProperties["colors"]]?.toLowerCase()
    )))
    : properties?.colors;
  const savedColors = rawSavedColors
    ? {
        ...rawSavedColors,
        ...(rawSavedColors.background?.toLowerCase() === "#14171f" ? { background: "#000000" } : {}),
        ...(rawSavedColors.grid === "rgba(255,255,255,0.06)" ? { grid: defaultChartProperties.colors.grid } : {}),
      }
    : rawSavedColors;
  const normalized: ChartProperties = {
    ...defaultChartProperties,
    ...(properties ?? {}),
    colorScheme,
    showBackgroundLogo: properties?.showBackgroundLogo ?? defaultChartProperties.showBackgroundLogo,
    gridType: properties?.gridType === "scale" || properties?.gridType === "mt5" ? properties.gridType : "square",
    gridLineStyle: properties?.gridLineStyle === "solid" ? "solid" : "dashed",
    showTradeHistoryBoxes: properties?.showTradeHistoryBoxes ?? defaultChartProperties.showTradeHistoryBoxes,
    showTradeHistoryArrows: properties?.showTradeHistoryArrows ?? defaultChartProperties.showTradeHistoryArrows,
    tradeHistoryLineOpacity: clampChartOpacityPercent(
      properties?.tradeHistoryLineOpacity,
      defaultChartProperties.tradeHistoryLineOpacity,
    ),
    tradeHistoryBoxOpacity: clampChartOpacityPercent(
      properties?.tradeHistoryBoxOpacity,
      defaultChartProperties.tradeHistoryBoxOpacity,
    ),
    colors: {
      ...getPresetSchemeColors(colorScheme),
      ...(savedColors ?? {}),
    },
  };

  return {
    ...normalized,
    colors: normalizeSchemeColors(normalized.colorScheme, normalized.colors),
  };
};

const normalizeSymbolProperties = (
  symbolProperties?: Record<string, PersistedChartProperties> | null,
): Record<string, ChartProperties> => {
  if (!symbolProperties) return {};

  return Object.fromEntries(
    Object.entries(symbolProperties).map(([symbol, properties]) => [
      symbol,
      normalizeChartProperties(properties),
    ]),
  );
};

const migrateDefaultPalette = (properties: ChartProperties): ChartProperties => {
  // Upgrade only the untouched former default. Customized palettes and other
  // templates keep their saved colors; users can select Green again afterward.
  const normalizedScheme = normalizeColorSchemeName(properties.colorScheme);
  const isPreviousDefault = normalizedScheme === "Green and Red"
    && (Object.keys(greenSchemeColors) as (keyof ChartProperties["colors"])[])
      .every((key) => properties.colors[key].toLowerCase() === greenSchemeColors[key].toLowerCase());
  return isPreviousDefault
    ? { ...properties, colorScheme: "Blue and Red", colors: { ...blueSchemeColors } }
    : { ...properties, colorScheme: normalizedScheme };
};

const hideVolumeBars = (properties: ChartProperties): ChartProperties => ({
  ...properties,
  showTickVolumes: false,
  showRealVolumes: false,
});

const disableChartShift = (properties: ChartProperties): ChartProperties => ({
  ...properties,
  chartShift: false,
});

export const applyVolumeBarsDefaultMigration = (
  globalProperties: ChartProperties,
  symbolProperties: Record<string, ChartProperties>,
  migrationVersion?: number,
): {
  globalProperties: ChartProperties;
  symbolProperties: Record<string, ChartProperties>;
  volumeBarsDefaultMigrationVersion: number;
} => {
  if ((migrationVersion ?? 0) >= VOLUME_BARS_DEFAULT_MIGRATION_VERSION) {
    return {
      globalProperties,
      symbolProperties,
      volumeBarsDefaultMigrationVersion: VOLUME_BARS_DEFAULT_MIGRATION_VERSION,
    };
  }

  return {
    globalProperties: hideVolumeBars(globalProperties),
    symbolProperties: Object.fromEntries(
      Object.entries(symbolProperties).map(([symbol, properties]) => [
        symbol,
        hideVolumeBars(properties),
      ]),
    ),
    volumeBarsDefaultMigrationVersion: VOLUME_BARS_DEFAULT_MIGRATION_VERSION,
  };
};

export const applyChartShiftDefaultMigration = (
  globalProperties: ChartProperties,
  symbolProperties: Record<string, ChartProperties>,
  migrationVersion?: number,
): {
  globalProperties: ChartProperties;
  symbolProperties: Record<string, ChartProperties>;
  chartShiftDefaultMigrationVersion: number;
} => {
  if ((migrationVersion ?? 0) >= CHART_SHIFT_DEFAULT_MIGRATION_VERSION) {
    return {
      globalProperties,
      symbolProperties,
      chartShiftDefaultMigrationVersion: CHART_SHIFT_DEFAULT_MIGRATION_VERSION,
    };
  }

  return {
    globalProperties: disableChartShift(globalProperties),
    symbolProperties: Object.fromEntries(
      Object.entries(symbolProperties).map(([symbol, properties]) => [
        symbol,
        disableChartShift(properties),
      ]),
    ),
    chartShiftDefaultMigrationVersion: CHART_SHIFT_DEFAULT_MIGRATION_VERSION,
  };
};

const showPeriodSeparators = (properties: ChartProperties): ChartProperties => ({
  ...properties,
  showPeriodSeparators: true,
});

export const applyPeriodSeparatorsDefaultMigration = (
  globalProperties: ChartProperties,
  symbolProperties: Record<string, ChartProperties>,
  migrationVersion?: number,
): {
  globalProperties: ChartProperties;
  symbolProperties: Record<string, ChartProperties>;
  periodSeparatorsDefaultMigrationVersion: number;
} => {
  if ((migrationVersion ?? 0) >= PERIOD_SEPARATORS_DEFAULT_MIGRATION_VERSION) {
    return {
      globalProperties,
      symbolProperties,
      periodSeparatorsDefaultMigrationVersion: PERIOD_SEPARATORS_DEFAULT_MIGRATION_VERSION,
    };
  }

  return {
    globalProperties: showPeriodSeparators(globalProperties),
    symbolProperties: Object.fromEntries(
      Object.entries(symbolProperties).map(([symbol, properties]) => [
        symbol,
        showPeriodSeparators(properties),
      ]),
    ),
    periodSeparatorsDefaultMigrationVersion: PERIOD_SEPARATORS_DEFAULT_MIGRATION_VERSION,
  };
};

const showOHLC = (properties: ChartProperties): ChartProperties => ({
  ...properties,
  showOHLC: true,
});

export const applyOhlcDefaultMigration = (
  globalProperties: ChartProperties,
  symbolProperties: Record<string, ChartProperties>,
  migrationVersion?: number,
): {
  globalProperties: ChartProperties;
  symbolProperties: Record<string, ChartProperties>;
  ohlcDefaultMigrationVersion: number;
} => {
  if ((migrationVersion ?? 0) >= OHLC_DEFAULT_MIGRATION_VERSION) {
    return {
      globalProperties,
      symbolProperties,
      ohlcDefaultMigrationVersion: OHLC_DEFAULT_MIGRATION_VERSION,
    };
  }

  return {
    globalProperties: showOHLC(globalProperties),
    symbolProperties: Object.fromEntries(
      Object.entries(symbolProperties).map(([symbol, properties]) => [
        symbol,
        showOHLC(properties),
      ]),
    ),
    ohlcDefaultMigrationVersion: OHLC_DEFAULT_MIGRATION_VERSION,
  };
};

export const getPresetSchemeColors = (
  rawScheme: ColorScheme | LegacyColorScheme,
  fallbackColors: ChartProperties["colors"] = defaultChartProperties.colors,
): ChartProperties["colors"] => {
  const scheme = normalizeColorSchemeName(rawScheme);
  if (scheme === "Green and Red") {
    return { ...greenSchemeColors };
  }

  if (scheme === "Green and White") {
    return { ...greenAndWhiteSchemeColors };
  }

  if (scheme === "Green and Blue") {
    return { ...greenAndBlueSchemeColors };
  }

  if (scheme === "Blue and White") {
    return { ...blueAndWhiteSchemeColors };
  }

  if (scheme === "Blue and Red") {
    return { ...blueSchemeColors };
  }

  if (scheme === "Gray and White") {
    return {
      background: "#000000",
      foreground: "#ffffff",
      grid: "#c9c9c9",
      barUp: "#adadad",
      barDown: "#ffffff",
      bullCandle: "#ffffff",
      bearCandle: "#000000",
      lineChart: "#000000",
      volumes: "rgba(173, 173, 173, 0.4)",
      bidPriceLine: "#64748b",
      askPriceLine: "#dc2626",
      lastPriceLine: "#adadad",
      stopLevels: "#dc2626",
    };
  }

  if (scheme === "Yellow and White") {
    return {
      background: "#000000",
      foreground: "#f8fafc",
      grid: "#e0ded7",
      barUp: "#facc15",
      barDown: "#facc15",
      bullCandle: "#000000",
      bearCandle: "#f8fafc",
      lineChart: "#facc15",
      volumes: "rgba(250, 204, 21, 0.4)",
      bidPriceLine: "#94a3b8",
      askPriceLine: "#ef4444",
      lastPriceLine: "#facc15",
      stopLevels: "#ef4444",
    };
  }

  return { ...fallbackColors };
};

const readConfiguredThemeChartSurface = (
  expectedMode: "light" | "dark",
): { background?: string; foreground?: string; grid?: string } | null => {
  if (typeof document === "undefined" || !document.documentElement) return null;
  const root = document.documentElement;
  if (root.getAttribute("data-rtx-theme-configured") !== "true") return null;
  const preset = root.getAttribute("data-rtx-theme-preset") || root.getAttribute("data-rtx-preset") || "";
  if (expectedMode === "light" && preset === "default-light") return null;
  if (expectedMode === "dark" && preset === "default-dark") return null;
  const bg = root.style.getPropertyValue("--rtx-theme-chart-bg").trim();
  const fg = root.style.getPropertyValue("--rtx-theme-chart-fg").trim();
  const grid = root.style.getPropertyValue("--rtx-theme-chart-grid").trim();
  if (!bg && !fg && !grid) return null;
  return {
    ...(bg ? { background: bg } : {}),
    ...(fg ? { foreground: fg } : {}),
    ...(grid ? { grid } : {}),
  };
};

export const getEffectiveChartColors = (
  properties: { colorScheme: ColorScheme | LegacyColorScheme; colors: ChartProperties["colors"] },
  options: { isAdvancedUntitledLight?: boolean } = {},
): ChartProperties["colors"] => {
  const colorScheme = normalizeColorSchemeName(properties.colorScheme);
  if (!options.isAdvancedUntitledLight) {
    const baseColors = colorScheme === "Blue and White" || properties.colors.background?.toLowerCase() === "#14171f"
      ? {
          ...properties.colors,
          background: "#000000",
          ...(properties.colors.grid === "rgba(255,255,255,0.06)" ? { grid: blueAndWhiteSchemeColors.grid } : {}),
        }
      : properties.colors;
    const darkThemeSurface = colorScheme !== "Custom"
      ? readConfiguredThemeChartSurface("dark")
      : null;
    return darkThemeSurface
      ? { ...baseColors, ...darkThemeSurface }
      : baseColors;
  }

  // Apply the shared light palette at render time so switching back to dark
  // restores the saved template and custom chart colors remain authoritative.
  const lightSurface = {
    background: "#fafbfc",
    foreground: "#334155",
    grid: "rgba(71, 85, 105, 0.07)",
    ...(readConfiguredThemeChartSurface("light") ?? {}),
  };

  if (colorScheme === "Green and Red" || colorScheme === "Blue and Red") {
    const colors = {
      ...properties.colors,
      ...lightSurface,
    };
    if (colorScheme === "Green and Red") {
      const referenceColor = (color: string): string => {
        if (color.toUpperCase() === CHART_PROFIT_COLOR) return "#06634e";
        if (color.toUpperCase() === CHART_LOSS_COLOR) return "#a51f26";
        return color;
      };
      // Deepen only built-in candle hues so thin bodies and wicks remain
      // visible on the neutral light canvas. User-selected colors stay intact.
      for (const key of ["barUp", "barDown", "bullCandle", "bearCandle"] as const) {
        if (colors[key].toLowerCase() === CHART_CANDLE_UP_COLOR.toLowerCase()) colors[key] = "#087f6c";
        if (colors[key].toLowerCase() === CHART_CANDLE_DOWN_COLOR.toLowerCase()) colors[key] = "#ce2938";
      }
      colors.lineChart = referenceColor(colors.lineChart);
      colors.lastPriceLine = referenceColor(colors.lastPriceLine);
    } else {
      // Use the same contrast-safe quote colors as Market Watch in light mode.
      const quoteColor = (color: string): string => {
        if (color.toLowerCase() === CHART_BLUE_COLOR) return "#1746bc";
        if (color.toLowerCase() === BLUE_TEMPLATE_RED_COLOR) return "#a51f26";
        return color;
      };
      for (const key of ["barUp", "barDown", "bullCandle", "bearCandle", "lineChart", "askPriceLine", "lastPriceLine", "stopLevels"] as const) {
        colors[key] = quoteColor(colors[key]);
      }
    }
    return colors;
  }

  if (colorScheme === "Gray and White") {
    return {
      ...properties.colors,
      ...lightSurface,
      barUp: "#000000",
      barDown: "#000000",
      bullCandle: "#ffffff",
      bearCandle: "#000000",
      lineChart: "#000000",
      volumes: "rgba(0, 0, 0, 0.4)",
      lastPriceLine: "#000000",
    };
  }

  if (colorScheme === "Green and White") {
    return {
      ...properties.colors,
      ...lightSurface,
      barUp: "#15803d",
      barDown: "#15803d",
      bullCandle: "#ffffff",
      bearCandle: "#15803d",
      lineChart: "#15803d",
      volumes: "rgba(21, 128, 61, 0.4)",
      lastPriceLine: "#15803d",
    };
  }

  if (colorScheme === "Green and Blue") {
    return {
      ...properties.colors,
      ...lightSurface,
      barUp: "#15803d",
      barDown: "#15803d",
      bullCandle: "#16a34a",
      bearCandle: "#0000ff",
      lineChart: "#15803d",
      volumes: "rgba(21, 128, 61, 0.4)",
      lastPriceLine: "#15803d",
    };
  }

  if (colorScheme === "Blue and White") {
    return {
      ...properties.colors,
      ...lightSurface,
      barUp: "#1746bc",
      barDown: "#334155",
      bullCandle: "#2557ff",
      bearCandle: "#ffffff",
      lineChart: "#1746bc",
      volumes: "rgba(37, 87, 255, 0.32)",
      lastPriceLine: "#1746bc",
    };
  }

  if (colorScheme === "Yellow and White") {
    return {
      ...properties.colors,
      ...lightSurface,
      barUp: "#795000",
      barDown: "#795000",
      bullCandle: "#000000",
      bearCandle: "#f8fafc",
      lineChart: "#795000",
      volumes: "rgba(250, 204, 21, 0.4)",
      lastPriceLine: "#795000",
    };
  }

  return properties.colors;
};

export interface ChartDirectionalQuoteColors {
  upColor: string;
  downColor: string;
  isDefaultPalette: boolean;
}

const normalizeReadableQuoteColor = (color: string, isDarkSurface: boolean): string => {
  const norm = color.trim().toLowerCase();
  if (isDarkSurface) {
    if (norm === "#7cfc00" || norm === "#00ff00" || norm === "#0f0" || norm === "#32cd32") {
      return CHART_CANDLE_UP_COLOR;
    }
    if (norm === "#0000ff" || norm === "#00f" || norm === "#2557ff") {
      return CHART_BLUE_COLOR;
    }
    if (norm === "#ff0000" || norm === "#f00") {
      return CHART_CANDLE_DOWN_COLOR;
    }
    return color;
  }
  if (
    norm === "#7cfc00"
    || norm === "#00ff00"
    || norm === "#0f0"
    || norm === "#32cd32"
    || norm === "#16a34a"
    || norm === "#15803d"
    || norm === CHART_CANDLE_UP_COLOR.toLowerCase()
  ) {
    return "#087f6c";
  }
  if (norm === "#0000ff" || norm === "#00f" || norm === "#2557ff" || norm === CHART_BLUE_COLOR.toLowerCase()) {
    return "#1746bc";
  }
  if (
    norm === "#ff0000"
    || norm === "#f00"
    || norm === CHART_CANDLE_DOWN_COLOR.toLowerCase()
    || norm === BLUE_TEMPLATE_RED_COLOR.toLowerCase()
  ) {
    return "#a51f26";
  }
  return color;
};

export const getChartDirectionalQuoteColors = (
  properties: { colorScheme: ColorScheme | LegacyColorScheme; colors: ChartProperties["colors"] } & Partial<Pick<ChartProperties, "chartType">>,
  options: { isAdvancedUntitledLight?: boolean } = {},
): ChartDirectionalQuoteColors => {
  const normalizedColorScheme = normalizeColorSchemeName(properties.colorScheme);
  const effective = getEffectiveChartColors({ ...properties, colorScheme: normalizedColorScheme }, options);
  const isDarkSurface = !options.isAdvancedUntitledLight;
  const bgNorm = (effective.background || "#000000").trim().toLowerCase();
  const isInvisibleOnSurface = (color: string | undefined): boolean => {
    if (!color) return true;
    const norm = color.trim().toLowerCase();
    if (isDarkSurface) {
      return norm === "#000000" || norm === "#000" || norm === bgNorm;
    }
    return norm === "#ffffff" || norm === "#fff" || norm === "#f8fafc" || norm === bgNorm;
  };

  const preferBar = properties.chartType === "Bar";
  const isCustomScheme = normalizedColorScheme === "Custom";
  const primaryUp = preferBar
    ? effective.barUp
    : isCustomScheme
      && effective.bullCandle?.trim().toLowerCase() === CHART_BLUE_COLOR.toLowerCase()
      && effective.barUp?.trim().toLowerCase() !== CHART_BLUE_COLOR.toLowerCase()
      && !isInvisibleOnSurface(effective.barUp)
      ? effective.barUp
      : effective.bullCandle;
  const secondaryUp = preferBar ? effective.bullCandle : effective.barUp;
  const rawUpColor = (!isInvisibleOnSurface(primaryUp) ? primaryUp : secondaryUp) || CHART_BLUE_COLOR;

  const primaryDown = preferBar
    ? effective.barDown
    : isCustomScheme
      && effective.bearCandle?.trim().toLowerCase() === BLUE_TEMPLATE_RED_COLOR.toLowerCase()
      && effective.barDown?.trim().toLowerCase() !== BLUE_TEMPLATE_RED_COLOR.toLowerCase()
      && !isInvisibleOnSurface(effective.barDown)
      ? effective.barDown
      : effective.bearCandle;
  const secondaryDown = preferBar ? effective.bearCandle : effective.barDown;
  let rawDownColor = (!isInvisibleOnSurface(primaryDown) ? primaryDown : secondaryDown) || BLUE_TEMPLATE_RED_COLOR;
  if (
    rawDownColor.trim().toLowerCase() === rawUpColor.trim().toLowerCase()
    && !isInvisibleOnSurface(effective.barUp)
    && effective.barUp.trim().toLowerCase() !== rawUpColor.trim().toLowerCase()
  ) {
    rawDownColor = effective.barUp;
  } else if (rawDownColor.trim().toLowerCase() === rawUpColor.trim().toLowerCase()) {
    rawDownColor = isDarkSurface ? "#adadad" : "#334155";
  }

  const upColor = normalizeReadableQuoteColor(rawUpColor, isDarkSurface);
  let downColor = normalizeReadableQuoteColor(rawDownColor, isDarkSurface);
  if (downColor.trim().toLowerCase() === upColor.trim().toLowerCase()) {
    downColor = isDarkSurface ? "#adadad" : "#334155";
  }

  const isDefaultPalette = normalizedColorScheme === defaultChartProperties.colorScheme
    && (options.isAdvancedUntitledLight
      ? upColor.trim().toLowerCase() === "#1746bc"
        && downColor.trim().toLowerCase() === "#a51f26"
      : upColor.trim().toLowerCase() === CHART_BLUE_COLOR.toLowerCase()
        && downColor.trim().toLowerCase() === BLUE_TEMPLATE_RED_COLOR.toLowerCase());

  return {
    upColor,
    downColor,
    isDefaultPalette,
  };
};

const hasCustomQuotePalette = (
  properties: { colorScheme: ColorScheme | LegacyColorScheme; colors: ChartProperties["colors"] } & Partial<Pick<ChartProperties, "chartType">>,
): boolean => {
  if (normalizeColorSchemeName(properties.colorScheme) !== defaultChartProperties.colorScheme) {
    return true;
  }
  return !getChartDirectionalQuoteColors(properties).isDefaultPalette;
};

interface ChartSettingsState {
  globalProperties: ChartProperties;
  symbolProperties: Record<string, ChartProperties>; // Allow specific overrides per chart symbol
  activeColorSymbol?: string | null;
  syncQuoteColorsWithChart: boolean;
  volumeBarsDefaultMigrationVersion: number;
  periodSeparatorsDefaultMigrationVersion: number;
  chartShiftDefaultMigrationVersion: number;
  ohlcDefaultMigrationVersion: number;
  blueRedDefaultMigrationVersion: number;

  updateGlobalProperty: <K extends keyof ChartProperties>(
    key: K,
    value: ChartProperties[K],
  ) => void;
  updateGlobalColor: (
    key: keyof ChartProperties["colors"],
    value: string,
  ) => void;
  updateSymbolColor: (
    symbol: string,
    key: keyof ChartProperties["colors"],
    value: string,
  ) => void;
  updateSymbolProperty: <K extends keyof ChartProperties>(
    symbol: string,
    key: K,
    value: ChartProperties[K],
  ) => void;
  applyPresetScheme: (scheme: ColorScheme | LegacyColorScheme) => void;
  applySymbolPresetScheme: (symbol: string, scheme: ColorScheme | LegacyColorScheme) => void;
  setActiveColorSymbol: (symbol: string | null) => void;
  setSyncQuoteColorsWithChart: (enabled: boolean) => void;
  inheritSymbolProperties: (from: string, to: string) => void;
  resetSymbolToDefaults: (symbol: string) => void;
  resetToDefaults: () => void;
}

export const selectChartPropertiesForQuote = (
  state: Pick<ChartSettingsState, "globalProperties" | "symbolProperties" | "activeColorSymbol"> & {
    syncQuoteColorsWithChart?: boolean;
  },
  symbol?: string | null,
): ChartProperties => {
  if (!state.syncQuoteColorsWithChart) {
    return defaultChartProperties;
  }
  const normalizedSymbol = symbol?.trim();
  const activeSymbol = state.activeColorSymbol?.trim();
  if (activeSymbol) {
    return state.symbolProperties[activeSymbol] || state.globalProperties;
  }
  if (
    normalizedSymbol
    && state.symbolProperties[normalizedSymbol]
    && hasCustomQuotePalette(state.symbolProperties[normalizedSymbol])
  ) {
    return state.symbolProperties[normalizedSymbol];
  }
  if (hasCustomQuotePalette(state.globalProperties)) {
    return state.globalProperties;
  }
  const customizedSymbolProperties = Object.values(state.symbolProperties).find(hasCustomQuotePalette);
  if (customizedSymbolProperties) {
    return customizedSymbolProperties;
  }
  return (normalizedSymbol ? state.symbolProperties[normalizedSymbol] : undefined)
    || state.globalProperties;
};

export const resolveChartQuoteColors = (
  state: Pick<ChartSettingsState, "globalProperties" | "symbolProperties" | "activeColorSymbol"> & {
    syncQuoteColorsWithChart?: boolean;
  },
  symbol?: string | null,
  options: { isAdvancedUntitledLight?: boolean } = {},
): ChartDirectionalQuoteColors => {
  return getChartDirectionalQuoteColors(selectChartPropertiesForQuote(state, symbol), options);
};

export const useChartSettingsStore = create<ChartSettingsState>()(
  persist(
    (set) => ({
      globalProperties: { ...defaultChartProperties },
      symbolProperties: {},
      activeColorSymbol: null,
      syncQuoteColorsWithChart: false,
      volumeBarsDefaultMigrationVersion: VOLUME_BARS_DEFAULT_MIGRATION_VERSION,
      periodSeparatorsDefaultMigrationVersion: PERIOD_SEPARATORS_DEFAULT_MIGRATION_VERSION,
      chartShiftDefaultMigrationVersion: CHART_SHIFT_DEFAULT_MIGRATION_VERSION,
      ohlcDefaultMigrationVersion: OHLC_DEFAULT_MIGRATION_VERSION,
      blueRedDefaultMigrationVersion: BLUE_RED_DEFAULT_MIGRATION_VERSION,

      updateGlobalProperty: (key, value) => {
        set((state) => ({
          ...(key === "colorScheme" || key === "colors" ? { activeColorSymbol: null } : {}),
          globalProperties: { ...state.globalProperties, [key]: value },
        }));
      },

      updateGlobalColor: (key, value) => {
        set((state) => ({
          activeColorSymbol: null,
          globalProperties: {
            ...state.globalProperties,
            colorScheme: "Custom",
            colors: {
              ...state.globalProperties.colors,
              [key]: value,
            },
          },
        }));
      },

      updateSymbolColor: (symbol, key, value) => {
        set((state) => {
          const currentProperties = state.symbolProperties[symbol] || state.globalProperties;
          const nextColors = {
            ...currentProperties.colors,
            [key]: value,
          };
          const syncedSymbols = Object.fromEntries(
            Object.entries(state.symbolProperties).map(([sym, props]) => [
              sym,
              {
                ...props,
                colorScheme: "Custom" as const,
                colors: { ...nextColors },
              },
            ]),
          );

          return {
            activeColorSymbol: symbol,
            symbolProperties: {
              ...syncedSymbols,
              [symbol]: {
                ...currentProperties,
                colorScheme: "Custom",
                colors: nextColors,
              },
            },
          };
        });
      },

      updateSymbolProperty: (symbol, key, value) => {
        set((state) => {
          const activeProps = state.activeColorSymbol
            ? state.symbolProperties[state.activeColorSymbol]
            : undefined;
          const baseProperties = state.symbolProperties[symbol] || (
            activeProps
              ? {
                  ...state.globalProperties,
                  colorScheme: activeProps.colorScheme,
                  colors: { ...activeProps.colors },
                }
              : state.globalProperties
          );
          return {
            ...(key === "colorScheme" || key === "colors" ? { activeColorSymbol: symbol } : {}),
            symbolProperties: {
              ...state.symbolProperties,
              [symbol]: {
                ...baseProperties,
                [key]: value,
              },
            },
          };
        });
      },

      applyPresetScheme: (rawScheme) => {
        set((state) => {
          const scheme = normalizeColorSchemeName(rawScheme);
          const newColors = getPresetSchemeColors(scheme, state.globalProperties.colors);

          return {
            activeColorSymbol: null,
            globalProperties: {
              ...state.globalProperties,
              colorScheme: scheme,
              colors: newColors,
            },
          };
        });
      },

      applySymbolPresetScheme: (symbol, rawScheme) => {
        set((state) => {
          const scheme = normalizeColorSchemeName(rawScheme);
          const currentProperties = state.symbolProperties[symbol] || state.globalProperties;
          const nextColors = getPresetSchemeColors(scheme, currentProperties.colors);
          const syncedSymbols = Object.fromEntries(
            Object.entries(state.symbolProperties).map(([sym, props]) => [
              sym,
              {
                ...props,
                colorScheme: scheme,
                colors: { ...nextColors },
              },
            ]),
          );

          return {
            activeColorSymbol: symbol,
            symbolProperties: {
              ...syncedSymbols,
              [symbol]: {
                ...currentProperties,
                colorScheme: scheme,
                colors: nextColors,
              },
            },
          };
        });
      },

      setActiveColorSymbol: (symbol) => {
        set((state) => {
          const normalized = symbol?.trim() || null;
          return state.activeColorSymbol === normalized ? state : { activeColorSymbol: normalized };
        });
      },

      setSyncQuoteColorsWithChart: (enabled) => {
        set((state) => {
          const next = Boolean(enabled);
          return state.syncQuoteColorsWithChart === next ? state : { syncQuoteColorsWithChart: next };
        });
      },

      inheritSymbolProperties: (from, to) => {
        set((state) => {
          const source = state.symbolProperties[from];
          // The chart window keeps its Show-section choices when its rendered
          // symbol settles from a fallback to the saved broker contract.
          if (!source || from === to || state.symbolProperties[to]) return state;
          return {
            activeColorSymbol: state.activeColorSymbol === from ? to : state.activeColorSymbol,
            symbolProperties: { ...state.symbolProperties, [to]: source },
          };
        });
      },

      resetSymbolToDefaults: (symbol) => {
        set((state) => {
          const remainingSymbolProperties = { ...state.symbolProperties };
          delete remainingSymbolProperties[symbol];
          return {
            activeColorSymbol: state.activeColorSymbol === symbol ? null : state.activeColorSymbol,
            syncQuoteColorsWithChart: false,
            symbolProperties: remainingSymbolProperties,
          };
        });
      },

      resetToDefaults: () => {
        set({
          globalProperties: { ...defaultChartProperties },
          activeColorSymbol: null,
          syncQuoteColorsWithChart: false,
          volumeBarsDefaultMigrationVersion: VOLUME_BARS_DEFAULT_MIGRATION_VERSION,
          periodSeparatorsDefaultMigrationVersion: PERIOD_SEPARATORS_DEFAULT_MIGRATION_VERSION,
          chartShiftDefaultMigrationVersion: CHART_SHIFT_DEFAULT_MIGRATION_VERSION,
          ohlcDefaultMigrationVersion: OHLC_DEFAULT_MIGRATION_VERSION,
          blueRedDefaultMigrationVersion: BLUE_RED_DEFAULT_MIGRATION_VERSION,
        });
      },
    }),
    {
      name: "rtx-chart-settings",
      storage: createJSONStorage(() => localStorage),
      merge: (persisted, current) => {
        const persistedState = persisted as Partial<ChartSettingsState> | undefined;
        const volumeMigrated = applyVolumeBarsDefaultMigration(
          normalizeChartProperties(persistedState?.globalProperties),
          normalizeSymbolProperties(persistedState?.symbolProperties),
          persistedState?.volumeBarsDefaultMigrationVersion,
        );
        const chartShiftMigrated = applyChartShiftDefaultMigration(
          volumeMigrated.globalProperties,
          volumeMigrated.symbolProperties,
          persistedState?.chartShiftDefaultMigrationVersion,
        );
        const periodMigrated = applyPeriodSeparatorsDefaultMigration(
          chartShiftMigrated.globalProperties,
          chartShiftMigrated.symbolProperties,
          persistedState?.periodSeparatorsDefaultMigrationVersion,
        );
        const ohlcMigrated = applyOhlcDefaultMigration(
          periodMigrated.globalProperties,
          periodMigrated.symbolProperties,
          persistedState?.ohlcDefaultMigrationVersion,
        );
        const needsPaletteMigration = (persistedState?.blueRedDefaultMigrationVersion ?? 0) < BLUE_RED_DEFAULT_MIGRATION_VERSION;
        const resolvedGlobalProperties = needsPaletteMigration
          ? migrateDefaultPalette(ohlcMigrated.globalProperties)
          : ohlcMigrated.globalProperties;
        const resolvedSymbolProperties = needsPaletteMigration
          ? Object.fromEntries(Object.entries(ohlcMigrated.symbolProperties).map(([symbol, properties]) => [symbol, migrateDefaultPalette(properties)]))
          : ohlcMigrated.symbolProperties;
        const persistedActiveSymbol = persistedState?.activeColorSymbol?.trim();
        const resolvedActiveColorSymbol = (persistedActiveSymbol && resolvedSymbolProperties[persistedActiveSymbol])
          ? persistedActiveSymbol
          : Object.entries(resolvedSymbolProperties).find(([, properties]) => hasCustomQuotePalette(properties))?.[0] ?? null;

        return {
          ...current,
          ...persistedState,
          activeColorSymbol: resolvedActiveColorSymbol,
          syncQuoteColorsWithChart: Boolean(persistedState?.syncQuoteColorsWithChart),
          volumeBarsDefaultMigrationVersion: volumeMigrated.volumeBarsDefaultMigrationVersion,
          chartShiftDefaultMigrationVersion: chartShiftMigrated.chartShiftDefaultMigrationVersion,
          periodSeparatorsDefaultMigrationVersion: periodMigrated.periodSeparatorsDefaultMigrationVersion,
          ohlcDefaultMigrationVersion: ohlcMigrated.ohlcDefaultMigrationVersion,
          ...ohlcMigrated,
          blueRedDefaultMigrationVersion: BLUE_RED_DEFAULT_MIGRATION_VERSION,
          globalProperties: resolvedGlobalProperties,
          symbolProperties: resolvedSymbolProperties,
        };
      },
    },
  ),
);
