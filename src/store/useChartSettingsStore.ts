import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type ChartTypeEnum = "Bar" | "Candlesticks" | "Line";
export type ColorScheme =
  | "Green on Black"
  | "Black on White"
  | "Yellow on Black"
  | "Custom";

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
  tradeHistoryLineOpacity: 25,
  tradeHistoryBoxOpacity: 40,

  colorScheme: "Green on Black",
  colors: {
    background: "#0e0e12",
    foreground: "#ffffff",
    grid: "rgba(255,255,255,0.15)",
    barUp: "#10B981",
    barDown: "#EF4444",
    bullCandle: "#10B981",
    bearCandle: "#EF4444",
    lineChart: "#10B981",
    volumes: "rgba(34, 197, 94, 0.4)",
    bidPriceLine: "#778899",
    askPriceLine: "#EF4444",
    lastPriceLine: "#00C000",
    stopLevels: "#EF4444",
  },
};

const VOLUME_BARS_DEFAULT_MIGRATION_VERSION = 1;
const PERIOD_SEPARATORS_DEFAULT_MIGRATION_VERSION = 1;

export const clampChartOpacityPercent = (value: unknown, fallback: number): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(100, Math.round(numeric)));
};

type PersistedChartProperties = Partial<Omit<ChartProperties, "colors">> & {
  colors?: Partial<ChartProperties["colors"]>;
};

export const normalizeChartProperties = (properties?: PersistedChartProperties | null): ChartProperties => ({
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
});

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

interface ChartSettingsState {
  globalProperties: ChartProperties;
  symbolProperties: Record<string, ChartProperties>; // Allow specific overrides per chart symbol
  volumeBarsDefaultMigrationVersion: number;
  periodSeparatorsDefaultMigrationVersion: number;

  updateGlobalProperty: <K extends keyof ChartProperties>(
    key: K,
    value: ChartProperties[K],
  ) => void;
  updateGlobalColor: (
    key: keyof ChartProperties["colors"],
    value: string,
  ) => void;
  updateSymbolProperty: <K extends keyof ChartProperties>(
    symbol: string,
    key: K,
    value: ChartProperties[K],
  ) => void;
  applyPresetScheme: (scheme: ColorScheme) => void;
  resetToDefaults: () => void;
}

export const useChartSettingsStore = create<ChartSettingsState>()(
  persist(
    (set) => ({
      globalProperties: { ...defaultChartProperties },
      symbolProperties: {},
      volumeBarsDefaultMigrationVersion: VOLUME_BARS_DEFAULT_MIGRATION_VERSION,
      periodSeparatorsDefaultMigrationVersion: PERIOD_SEPARATORS_DEFAULT_MIGRATION_VERSION,

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
          let newColors = { ...state.globalProperties.colors };

          if (scheme === "Green on Black") {
            newColors = { ...defaultChartProperties.colors };
          } else if (scheme === "Black on White") {
            newColors = {
              background: "#ffffff",
              foreground: "#000000",
              grid: "#e2e8f0",
              barUp: "#000000",
              barDown: "#000000",
              bullCandle: "#ffffff",
              bearCandle: "#000000",
              lineChart: "#000000",
              volumes: "rgba(0, 0, 0, 0.4)",
              bidPriceLine: "#64748b",
              askPriceLine: "#dc2626",
              lastPriceLine: "#16a34a",
              stopLevels: "#dc2626",
            };
          } else if (scheme === "Yellow on Black") {
            newColors = {
              background: "#000000",
              foreground: "#ffffff",
              grid: "#333333",
              barUp: "#eab308",
              barDown: "#eab308",
              bullCandle: "#000000",
              bearCandle: "#ffffff",
              lineChart: "#eab308",
              volumes: "rgba(234, 179, 8, 0.4)",
              bidPriceLine: "#94a3b8",
              askPriceLine: "#ef4444",
              lastPriceLine: "#22c55e",
              stopLevels: "#ef4444",
            };
          }

          return {
            globalProperties: {
              ...state.globalProperties,
              colorScheme: scheme,
              colors: newColors,
            },
          };
        });
      },

      resetToDefaults: () => {
        set({
          globalProperties: { ...defaultChartProperties },
          volumeBarsDefaultMigrationVersion: VOLUME_BARS_DEFAULT_MIGRATION_VERSION,
          periodSeparatorsDefaultMigrationVersion: PERIOD_SEPARATORS_DEFAULT_MIGRATION_VERSION,
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
        const migrated = applyPeriodSeparatorsDefaultMigration(
          volumeMigrated.globalProperties,
          volumeMigrated.symbolProperties,
          persistedState?.periodSeparatorsDefaultMigrationVersion,
        );

        return {
          ...current,
          ...persistedState,
          volumeBarsDefaultMigrationVersion: volumeMigrated.volumeBarsDefaultMigrationVersion,
          ...migrated,
        };
      },
    },
  ),
);
