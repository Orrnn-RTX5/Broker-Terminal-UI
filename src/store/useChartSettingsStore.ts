import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type ChartTypeEnum = "Bar" | "Candlesticks" | "Line" | "Area";
export type ColorScheme =
  | "Green on Black"
  | "Blue on Black"
  | "Black on White"
  | "Yellow on Black"
  | "Custom";

export const CHART_PROFIT_COLOR = "#00C896";
export const CHART_LOSS_COLOR = "#FF4D4F";
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
  showOHLC: false,
  showQuickTradingButtons: true,
  showBidPriceLine: true,
  showAskPriceLine: false,
  showLastPriceLine: false,
  showPeriodSeparators: true,
  showGrid: true,
  showTickVolumes: false,
  showRealVolumes: false,
  showObjectDescriptions: false,
  showTradeLevels: true,
  showTradeHistory: true,
  showTradeHistoryBoxes: true,
  showTradeHistoryArrows: true,
  tradeHistoryLineOpacity: 70,
  tradeHistoryBoxOpacity: 40,

  colorScheme: "Green on Black",
  colors: {
    background: "#000000",
    foreground: "#ffffff",
    grid: "rgba(255,255,255,0.12)",
    barUp: CHART_PROFIT_COLOR,
    barDown: CHART_LOSS_COLOR,
    bullCandle: CHART_PROFIT_COLOR,
    bearCandle: CHART_LOSS_COLOR,
    lineChart: CHART_PROFIT_COLOR,
    volumes: "rgba(0, 200, 150, 0.32)",
    bidPriceLine: "#778899",
    askPriceLine: CHART_LOSS_COLOR,
    lastPriceLine: CHART_PROFIT_COLOR,
    stopLevels: CHART_LOSS_COLOR,
  },
};

const VOLUME_BARS_DEFAULT_MIGRATION_VERSION = 1;
const PERIOD_SEPARATORS_DEFAULT_MIGRATION_VERSION = 1;
const CHART_SHIFT_DEFAULT_MIGRATION_VERSION = 1;

export const clampChartOpacityPercent = (value: unknown, fallback: number): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(100, Math.round(numeric)));
};

type PersistedChartProperties = Partial<Omit<ChartProperties, "colors">> & {
  colors?: Partial<ChartProperties["colors"]>;
};

const normalizeSchemeColors = (
  colorScheme: ColorScheme,
  colors: ChartProperties["colors"],
): ChartProperties["colors"] => {
  if (colorScheme === "Blue on Black") {
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

  if (colorScheme === "Green on Black") {
    const migrateLegacyColor = (value: string, legacy: string, replacement: string) => (
      value.toUpperCase() === legacy ? replacement : value
    );

    return {
      ...colors,
      background: "#000000",
      barUp: migrateLegacyColor(colors.barUp, LEGACY_CHART_PROFIT_COLOR, CHART_PROFIT_COLOR),
      barDown: migrateLegacyColor(colors.barDown, LEGACY_CHART_LOSS_COLOR, CHART_LOSS_COLOR),
      bullCandle: migrateLegacyColor(colors.bullCandle, LEGACY_CHART_PROFIT_COLOR, CHART_PROFIT_COLOR),
      bearCandle: migrateLegacyColor(colors.bearCandle, LEGACY_CHART_LOSS_COLOR, CHART_LOSS_COLOR),
      lineChart: migrateLegacyColor(colors.lineChart, LEGACY_CHART_PROFIT_COLOR, CHART_PROFIT_COLOR),
      volumes: colors.volumes === "rgba(34, 197, 94, 0.4)"
        ? defaultChartProperties.colors.volumes
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
  const normalized: ChartProperties = {
    ...defaultChartProperties,
    ...(properties ?? {}),
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
      ...defaultChartProperties.colors,
      ...(properties?.colors ?? {}),
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

export const getPresetSchemeColors = (
  scheme: ColorScheme,
  fallbackColors: ChartProperties["colors"] = defaultChartProperties.colors,
): ChartProperties["colors"] => {
  if (scheme === "Green on Black") {
    return { ...defaultChartProperties.colors };
  }

  if (scheme === "Blue on Black") {
    return {
      ...defaultChartProperties.colors,
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
  }

  if (scheme === "Black on White") {
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

  if (scheme === "Yellow on Black") {
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

export const getEffectiveChartColors = (
  properties: Pick<ChartProperties, "colorScheme" | "colors">,
  options: { isAdvancedUntitledLight?: boolean } = {},
): ChartProperties["colors"] => {
  if (!options.isAdvancedUntitledLight) return properties.colors;

  // Apply the shared light palette at render time so switching back to dark
  // restores the saved template and custom chart colors remain authoritative.
  const lightSurface = {
    background: "#f7f8fa",
    foreground: "#4b5563",
    grid: "rgba(46, 46, 46, 0.11)",
  };

  if (properties.colorScheme === "Green on Black" || properties.colorScheme === "Blue on Black") {
    const colors = {
      ...properties.colors,
      ...lightSurface,
    };
    if (properties.colorScheme === "Green on Black") {
      const referenceColor = (color: string): string => {
        if (color.toUpperCase() === CHART_PROFIT_COLOR) return "#059669";
        if (color.toUpperCase() === CHART_LOSS_COLOR) return "#dc2626";
        return color;
      };
      colors.barUp = referenceColor(colors.barUp);
      colors.barDown = referenceColor(colors.barDown);
      colors.bullCandle = referenceColor(colors.bullCandle);
      colors.bearCandle = referenceColor(colors.bearCandle);
      colors.lineChart = referenceColor(colors.lineChart);
      colors.lastPriceLine = referenceColor(colors.lastPriceLine);
    }
    return colors;
  }

  if (properties.colorScheme === "Black on White") {
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

  if (properties.colorScheme === "Yellow on Black") {
    return {
      ...properties.colors,
      ...lightSurface,
      barUp: "#facc15",
      barDown: "#facc15",
      bullCandle: "#000000",
      bearCandle: "#f8fafc",
      lineChart: "#facc15",
      volumes: "rgba(250, 204, 21, 0.4)",
      lastPriceLine: "#facc15",
    };
  }

  return properties.colors;
};

interface ChartSettingsState {
  globalProperties: ChartProperties;
  symbolProperties: Record<string, ChartProperties>; // Allow specific overrides per chart symbol
  volumeBarsDefaultMigrationVersion: number;
  periodSeparatorsDefaultMigrationVersion: number;
  chartShiftDefaultMigrationVersion: number;

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
  applyPresetScheme: (scheme: ColorScheme) => void;
  applySymbolPresetScheme: (symbol: string, scheme: ColorScheme) => void;
  inheritSymbolProperties: (from: string, to: string) => void;
  resetSymbolToDefaults: (symbol: string) => void;
  resetToDefaults: () => void;
}

export const useChartSettingsStore = create<ChartSettingsState>()(
  persist(
    (set) => ({
      globalProperties: { ...defaultChartProperties },
      symbolProperties: {},
      volumeBarsDefaultMigrationVersion: VOLUME_BARS_DEFAULT_MIGRATION_VERSION,
      periodSeparatorsDefaultMigrationVersion: PERIOD_SEPARATORS_DEFAULT_MIGRATION_VERSION,
      chartShiftDefaultMigrationVersion: CHART_SHIFT_DEFAULT_MIGRATION_VERSION,

      updateGlobalProperty: (key, value) => {
        set((state) => ({
          globalProperties: { ...state.globalProperties, [key]: value },
        }));
      },

      updateGlobalColor: (key, value) => {
        set((state) => ({
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

          return {
            symbolProperties: {
              ...state.symbolProperties,
              [symbol]: {
                ...currentProperties,
                colorScheme: "Custom",
                colors: {
                  ...currentProperties.colors,
                  [key]: value,
                },
              },
            },
          };
        });
      },

      updateSymbolProperty: (symbol, key, value) => {
        set((state) => ({
          symbolProperties: {
            ...state.symbolProperties,
            [symbol]: {
              ...(state.symbolProperties[symbol] || state.globalProperties),
              [key]: value,
            },
          },
        }));
      },

      applyPresetScheme: (scheme) => {
        set((state) => {
          const newColors = getPresetSchemeColors(scheme, state.globalProperties.colors);

          return {
            globalProperties: {
              ...state.globalProperties,
              colorScheme: scheme,
              colors: newColors,
            },
          };
        });
      },

      applySymbolPresetScheme: (symbol, scheme) => {
        set((state) => {
          const currentProperties = state.symbolProperties[symbol] || state.globalProperties;

          return {
            symbolProperties: {
              ...state.symbolProperties,
              [symbol]: {
                ...currentProperties,
                colorScheme: scheme,
                colors: getPresetSchemeColors(scheme, currentProperties.colors),
              },
            },
          };
        });
      },

      inheritSymbolProperties: (from, to) => {
        set((state) => {
          const source = state.symbolProperties[from];
          // The chart window keeps its Show-section choices when its rendered
          // symbol settles from a fallback to the saved broker contract.
          if (!source || from === to || state.symbolProperties[to]) return state;
          return { symbolProperties: { ...state.symbolProperties, [to]: source } };
        });
      },

      resetSymbolToDefaults: (symbol) => {
        set((state) => {
          const remainingSymbolProperties = { ...state.symbolProperties };
          delete remainingSymbolProperties[symbol];
          return { symbolProperties: remainingSymbolProperties };
        });
      },

      resetToDefaults: () => {
        set({
          globalProperties: { ...defaultChartProperties },
          volumeBarsDefaultMigrationVersion: VOLUME_BARS_DEFAULT_MIGRATION_VERSION,
          periodSeparatorsDefaultMigrationVersion: PERIOD_SEPARATORS_DEFAULT_MIGRATION_VERSION,
          chartShiftDefaultMigrationVersion: CHART_SHIFT_DEFAULT_MIGRATION_VERSION,
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
        const migrated = applyPeriodSeparatorsDefaultMigration(
          chartShiftMigrated.globalProperties,
          chartShiftMigrated.symbolProperties,
          persistedState?.periodSeparatorsDefaultMigrationVersion,
        );

        return {
          ...current,
          ...persistedState,
          volumeBarsDefaultMigrationVersion: volumeMigrated.volumeBarsDefaultMigrationVersion,
          chartShiftDefaultMigrationVersion: chartShiftMigrated.chartShiftDefaultMigrationVersion,
          ...migrated,
        };
      },
    },
  ),
);
