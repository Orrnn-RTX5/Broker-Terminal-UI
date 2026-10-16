import { describe, expect, it } from 'vitest';
import {
  applyChartShiftDefaultMigration,
  applyOhlcDefaultMigration,
  applyPeriodSeparatorsDefaultMigration,
  applyVolumeBarsDefaultMigration,
  CHART_CANDLE_DOWN_COLOR,
  CHART_CANDLE_UP_COLOR,
  CHART_LOSS_COLOR,
  CHART_PROFIT_COLOR,
  clampChartOpacityPercent,
  defaultChartProperties,
  getEffectiveChartColors,
  getPresetSchemeColors,
  normalizeChartProperties,
  useChartSettingsStore,
} from './useChartSettingsStore';

describe('chart settings trade history overlay defaults', () => {
  it('keeps the green outlines and white bears on black in dark mode and adapts to the light surface in light mode', () => {
    const initial = useChartSettingsStore.getState();
    const colors = getPresetSchemeColors('Green and White');
    try {
      useChartSettingsStore.setState({ globalProperties: { ...defaultChartProperties }, symbolProperties: {} });
      useChartSettingsStore.getState().updateSymbolProperty('XAUUSD', 'gridType', 'mt5');
      useChartSettingsStore.getState().applySymbolPresetScheme('XAUUSD', 'Green and White');
      const saved = JSON.parse(JSON.stringify(useChartSettingsStore.getState()));
      const restored = useChartSettingsStore.persist.getOptions().merge!(saved, initial);
      const properties = restored.symbolProperties.XAUUSD;
      expect(properties.colorScheme).toBe('Green and White');
      expect(properties.gridType).toBe('mt5');
      expect(properties.colors).toEqual(colors);
      expect(getEffectiveChartColors(properties, { isAdvancedUntitledLight: false })).toMatchObject({
        background: '#000000', foreground: '#ffffff', bullCandle: '#000000', bearCandle: '#ffffff',
        barUp: '#00ff00', barDown: '#00ff00',
      });
      expect(getEffectiveChartColors(properties, { isAdvancedUntitledLight: true })).toMatchObject({
        background: '#fafbfc', foreground: '#334155', grid: 'rgba(71, 85, 105, 0.07)',
        bullCandle: '#ffffff', bearCandle: '#15803d', barUp: '#15803d', barDown: '#15803d',
      });
      expect(restored.globalProperties.colorScheme).toBe(defaultChartProperties.colorScheme);
    } finally {
      useChartSettingsStore.setState(initial);
    }
  });
  it('keeps the green bulls, blue bears, and lime outlines on black in dark mode and adapts to light mode for Green and Blue', () => {
    const initial = useChartSettingsStore.getState();
    const colors = getPresetSchemeColors('Green and Blue');
    try {
      useChartSettingsStore.setState({ globalProperties: { ...defaultChartProperties }, symbolProperties: {} });
      useChartSettingsStore.getState().applySymbolPresetScheme('XAUUSD', 'Green and Blue');
      const saved = JSON.parse(JSON.stringify(useChartSettingsStore.getState()));
      const restored = useChartSettingsStore.persist.getOptions().merge!(saved, initial);
      const properties = restored.symbolProperties.XAUUSD;
      expect(properties.colorScheme).toBe('Green and Blue');
      expect(properties.colors).toEqual(colors);
      expect(getEffectiveChartColors(properties, { isAdvancedUntitledLight: false })).toMatchObject({
        background: '#000000', foreground: '#ffffff', bullCandle: '#7cfc00', bearCandle: '#0000ff',
        barUp: '#00ff00', barDown: '#00ff00', volumes: '#32cd32', bidPriceLine: '#778899',
      });
      expect(getEffectiveChartColors(properties, { isAdvancedUntitledLight: true })).toMatchObject({
        background: '#fafbfc', foreground: '#334155', grid: 'rgba(71, 85, 105, 0.07)',
        bullCandle: '#16a34a', bearCandle: '#0000ff', barUp: '#15803d', barDown: '#15803d',
        volumes: 'rgba(21, 128, 61, 0.4)', bidPriceLine: '#778899',
      });
    } finally {
      useChartSettingsStore.setState(initial);
    }
  });
  it('corrects the mistaken saved white-background preset while retaining explicit color edits', () => {
    const oldPreset = {
      background: '#ffffff', foreground: '#000000', grid: '#f1ecf2',
      barUp: '#26a69a', barDown: '#ef5350', bullCandle: '#26a69a', bearCandle: '#ef5350',
      lineChart: '#56ba84', volumes: '#26a69a', bidPriceLine: '#26a69a', askPriceLine: '#ef5350',
      lastPriceLine: '#9cbaf0', stopLevels: '#ef5350',
    };
    const corrected = normalizeChartProperties({ colorScheme: 'Green on White', colors: oldPreset, gridType: 'mt5' });
    expect(corrected.colorScheme).toBe('Green and White');
    expect(corrected.colors).toEqual(getPresetSchemeColors('Green and White'));
    expect(corrected.gridType).toBe('mt5');
    expect(normalizeChartProperties({ colorScheme: 'Green on White', colors: { ...oldPreset, lineChart: '#123456' } }).colors.lineChart).toBe('#123456');
    expect(normalizeChartProperties({ colorScheme: 'Custom', colors: oldPreset }).colors).toEqual(oldPreset);
  });
  it('hides chart volume bars by default', () => {
    expect(defaultChartProperties.showTickVolumes).toBe(false);
    expect(defaultChartProperties.showRealVolumes).toBe(false);
  });

  it('keeps closed trade history overlays visible by default with reduced clutter opacity', () => {
    expect(defaultChartProperties.showTradeHistory).toBe(true);
    expect(defaultChartProperties.showTradeHistoryBoxes).toBe(true);
    expect(defaultChartProperties.showTradeHistoryArrows).toBe(true);
    expect(defaultChartProperties.tradeHistoryLineOpacity).toBe(70);
    expect(defaultChartProperties.tradeHistoryBoxOpacity).toBe(40);
  });

  it('shows period separators by default', () => {
    expect(defaultChartProperties.showPeriodSeparators).toBe(true);
  });

  it('defaults to a dashed grid and normalizes missing or invalid saved styles', () => {
    expect(defaultChartProperties.gridLineStyle).toBe('dashed');
    expect(normalizeChartProperties({ showGrid: false })).toMatchObject({
      showGrid: false,
      gridLineStyle: 'dashed',
    });
    expect(normalizeChartProperties(JSON.parse('{"gridLineStyle":"invalid"}')).gridLineStyle).toBe('dashed');
    expect(normalizeChartProperties(JSON.parse('{"gridLineStyle":"dotted"}')).gridLineStyle).toBe('dashed');
    expect(normalizeChartProperties({ gridLineStyle: 'solid' }).gridLineStyle).toBe('solid');
    expect(normalizeChartProperties({ gridLineStyle: 'dashed' }).gridLineStyle).toBe('dashed');
  });

  it('keeps existing square grids and restores saved grid types independently of line style', () => {
    expect(defaultChartProperties.gridType).toBe('square');
    expect(normalizeChartProperties({ gridLineStyle: 'solid' })).toMatchObject({
      gridType: 'square',
      gridLineStyle: 'solid',
    });
    expect(normalizeChartProperties(JSON.parse('{"gridType":"invalid"}')).gridType).toBe('square');
    expect(normalizeChartProperties({ gridType: 'scale', gridLineStyle: 'dashed' })).toMatchObject({
      gridType: 'scale',
      gridLineStyle: 'dashed',
    });
    expect(normalizeChartProperties({ gridType: 'mt5', gridLineStyle: 'solid' })).toMatchObject({
      gridType: 'mt5',
      gridLineStyle: 'solid',
    });
  });

  it('hydrates legacy square grids and preserves global and symbol grid choices', () => {
    const initial = useChartSettingsStore.getState();
    const merge = useChartSettingsStore.persist.getOptions().merge!;
    const legacy = merge({
      globalProperties: { showGrid: true },
      symbolProperties: { EURUSD: { showGrid: false } },
    }, initial);
    expect(legacy.globalProperties.gridLineStyle).toBe('dashed');
    expect(legacy.globalProperties.gridType).toBe('square');
    expect(legacy.symbolProperties.EURUSD).toMatchObject({ showGrid: false, gridType: 'square', gridLineStyle: 'dashed' });

    try {
      initial.updateGlobalProperty('gridLineStyle', 'solid');
      initial.updateGlobalProperty('gridType', 'scale');
      initial.updateSymbolProperty('EURUSD', 'gridLineStyle', 'dashed');
      initial.updateSymbolProperty('EURUSD', 'gridType', 'square');
      initial.updateSymbolProperty('XAUUSD', 'gridLineStyle', 'solid');
      initial.updateSymbolProperty('USDCAD', 'gridType', 'mt5');
      initial.updateSymbolProperty('USDCAD', 'gridLineStyle', 'solid');
      const saved = JSON.parse(JSON.stringify(useChartSettingsStore.getState()));
      const restored = merge(saved, initial);
      expect(restored.globalProperties.gridLineStyle).toBe('solid');
      expect(restored.globalProperties.gridType).toBe('scale');
      expect(restored.symbolProperties.EURUSD.gridLineStyle).toBe('dashed');
      expect(restored.symbolProperties.EURUSD.gridType).toBe('square');
      expect(restored.symbolProperties.XAUUSD.gridLineStyle).toBe('solid');
      expect(restored.symbolProperties.XAUUSD.gridType).toBe('scale');
      expect(restored.symbolProperties.USDCAD).toMatchObject({ gridType: 'mt5', gridLineStyle: 'solid' });
    } finally {
      useChartSettingsStore.setState(initial);
    }
  });

  it('opens and resets charts with the blue/red Bid/Ask palette', () => {
    const initial = useChartSettingsStore.getState();
    const hydrated = useChartSettingsStore.persist.getOptions().merge!({}, initial);
    expect(hydrated.globalProperties.colorScheme).toBe('Blue on Black');
    expect(defaultChartProperties.colorScheme).toBe('Blue on Black');
    expect(defaultChartProperties.colors).toMatchObject({
      barUp: '#4597ff',
      bullCandle: '#4597ff',
      lineChart: '#4597ff',
      lastPriceLine: '#4597ff',
      barDown: '#ff5858',
      bearCandle: '#ff5858',
      askPriceLine: '#ff5858',
      stopLevels: '#ff5858',
    });
    expect(defaultChartProperties.showBidPriceLine).toBe(true);
    expect(defaultChartProperties.showAskPriceLine).toBe(false);
    expect(defaultChartProperties.showLastPriceLine).toBe(false);
    try {
      initial.applyPresetScheme('Green on Black');
      initial.resetToDefaults();
      expect(useChartSettingsStore.getState().globalProperties).toEqual(defaultChartProperties);
    } finally {
      useChartSettingsStore.setState(initial);
    }
  });

  it('upgrades only untouched legacy Green on Black colors', () => {
    const legacyColors = {
      ...defaultChartProperties.colors,
      barUp: '#10B981',
      barDown: '#EF4444',
      bullCandle: '#10b981',
      bearCandle: '#ef4444',
      lineChart: '#10B981',
      volumes: 'rgba(34, 197, 94, 0.4)',
      askPriceLine: '#EF4444',
      lastPriceLine: '#00C000',
      stopLevels: '#EF4444',
    };

    expect(normalizeChartProperties({
      colorScheme: 'Green on Black',
      colors: legacyColors,
    }).colors).toMatchObject({
      barUp: CHART_CANDLE_UP_COLOR,
      barDown: CHART_CANDLE_DOWN_COLOR,
      bullCandle: CHART_CANDLE_UP_COLOR,
      bearCandle: CHART_CANDLE_DOWN_COLOR,
      lineChart: CHART_PROFIT_COLOR,
      volumes: 'rgba(0, 200, 150, 0.32)',
      askPriceLine: CHART_LOSS_COLOR,
      lastPriceLine: CHART_PROFIT_COLOR,
      stopLevels: CHART_LOSS_COLOR,
    });

    expect(normalizeChartProperties({
      colorScheme: 'Custom',
      colors: legacyColors,
    }).colors).toMatchObject(legacyColors);
  });

  it('migrates saved global and per-symbol defaults without changing customized palettes', () => {
    const previous = {
      ...defaultChartProperties,
      colorScheme: 'Green on Black' as const,
      colors: {
        ...getPresetSchemeColors('Green on Black'),
        barUp: '#00c896', barDown: '#ff4d4f',
        bullCandle: '#00C896', bearCandle: '#FF4D4F',
      },
    };
    const custom = { ...previous, colorScheme: 'Custom' as const };
    const customizedPreset = {
      ...previous,
      colors: { ...previous.colors, bullCandle: '#123456', barDown: '#abcdef' },
    };
    const merge = useChartSettingsStore.persist.getOptions().merge!;
    const hydrated = merge({
      globalProperties: previous,
      symbolProperties: { XAUUSD: previous, EURUSD: custom, BTCUSD: customizedPreset },
      volumeBarsDefaultMigrationVersion: 1,
      periodSeparatorsDefaultMigrationVersion: 1,
      chartShiftDefaultMigrationVersion: 1,
      blueRedDefaultMigrationVersion: 1,
    }, useChartSettingsStore.getState());

    for (const properties of [hydrated.globalProperties, hydrated.symbolProperties.XAUUSD]) {
      for (const isAdvancedUntitledLight of [false, true]) {
        expect(getEffectiveChartColors(properties, { isAdvancedUntitledLight })).toMatchObject({
          barUp: isAdvancedUntitledLight ? '#087f6c' : '#089981',
          barDown: isAdvancedUntitledLight ? '#ce2938' : '#F23645',
          bullCandle: isAdvancedUntitledLight ? '#087f6c' : '#089981',
          bearCandle: isAdvancedUntitledLight ? '#ce2938' : '#F23645',
        });
      }
    }
    expect(hydrated.symbolProperties.EURUSD.colors).toEqual(custom.colors);
    expect(hydrated.symbolProperties.BTCUSD.colors).toMatchObject({
      bullCandle: '#123456', barDown: '#abcdef',
      barUp: '#089981', bearCandle: '#F23645',
    });
    expect(previous.colors.bullCandle).toBe('#00C896');
  });

  it('upgrades the former default once while keeping custom colors and other presets', () => {
    const green = normalizeChartProperties({ colorScheme: 'Green on Black', chartShift: true });
    const custom = { ...green, colorScheme: 'Custom' as const };
    const customizedGreen = { ...green, colors: { ...green.colors, bullCandle: '#123456' } };
    const yellow = normalizeChartProperties({ colorScheme: 'Yellow on Black' });
    const merge = useChartSettingsStore.persist.getOptions().merge!;
    const hydrated = merge({
      globalProperties: green,
      symbolProperties: { BTCUSD: green, EURUSD: custom, XAUUSD: customizedGreen, GBPUSD: yellow },
      chartShiftDefaultMigrationVersion: 1,
    }, useChartSettingsStore.getState());

    expect(hydrated.globalProperties).toMatchObject({ colorScheme: 'Blue on Black', chartShift: true });
    expect(hydrated.symbolProperties.BTCUSD.colors).toEqual(getPresetSchemeColors('Blue on Black'));
    expect(hydrated.symbolProperties.EURUSD.colors).toEqual(custom.colors);
    expect(hydrated.symbolProperties.XAUUSD.colors).toEqual(customizedGreen.colors);
    expect(hydrated.symbolProperties.GBPUSD.colors).toEqual(yellow.colors);
    expect(green.colorScheme).toBe('Green on Black');
    expect(hydrated.blueRedDefaultMigrationVersion).toBe(1);

    // A later explicit Green choice must survive subsequent reloads.
    const reloaded = merge({ ...hydrated, globalProperties: green, symbolProperties: { BTCUSD: green } }, hydrated);
    expect(reloaded.globalProperties.colors).toEqual(green.colors);
    expect(reloaded.symbolProperties.BTCUSD.colorScheme).toBe('Green on Black');
  });

  it('hydrates old persisted chart settings with the new trade history overlay fields', () => {
    const oldPersistedProperties = {
      showTradeHistory: false,
      colors: {
        background: '#101010',
      },
    };

    const normalized = normalizeChartProperties(oldPersistedProperties);

    expect(normalized.showTradeHistory).toBe(false);
    expect(normalized.showTickVolumes).toBe(false);
    expect(normalized.showRealVolumes).toBe(false);
    expect(normalized.showPeriodSeparators).toBe(true);
    expect(normalized.showTradeHistoryBoxes).toBe(true);
    expect(normalized.showTradeHistoryArrows).toBe(true);
    expect(normalized.tradeHistoryLineOpacity).toBe(70);
    expect(normalized.tradeHistoryBoxOpacity).toBe(40);
    expect(normalized.colors.background).toBe('#101010');
    expect(normalized.colors.foreground).toBe(defaultChartProperties.colors.foreground);
  });

  it('preserves explicit hidden period separators from persisted settings', () => {
    const normalized = normalizeChartProperties({
      showPeriodSeparators: false,
    });

    expect(normalized.showPeriodSeparators).toBe(false);
  });

  it('migrates old persisted period separator defaults to visible once', () => {
    const oldPersistedProperties = normalizeChartProperties({
      showPeriodSeparators: false,
    });

    const migrated = applyPeriodSeparatorsDefaultMigration(
      oldPersistedProperties,
      { XAUUSD: oldPersistedProperties },
      undefined,
    );

    expect(migrated.globalProperties.showPeriodSeparators).toBe(true);
    expect(migrated.symbolProperties.XAUUSD.showPeriodSeparators).toBe(true);
  });

  it('preserves hidden period separator preference after migration has run', () => {
    const migratedProperties = normalizeChartProperties({
      showPeriodSeparators: false,
    });

    const migrated = applyPeriodSeparatorsDefaultMigration(
      migratedProperties,
      {},
      1,
    );

    expect(migrated.globalProperties.showPeriodSeparators).toBe(false);
  });

  it('migrates old persisted visible volume bars to hidden once', () => {
    const oldPersistedProperties = normalizeChartProperties({
      showTickVolumes: true,
      showRealVolumes: true,
    });

    const migrated = applyVolumeBarsDefaultMigration(
      oldPersistedProperties,
      { XAUUSD: oldPersistedProperties },
      undefined,
    );

    expect(migrated.globalProperties.showTickVolumes).toBe(false);
    expect(migrated.globalProperties.showRealVolumes).toBe(false);
    expect(migrated.symbolProperties.XAUUSD.showTickVolumes).toBe(false);
    expect(migrated.symbolProperties.XAUUSD.showRealVolumes).toBe(false);
  });

  it('preserves visible volume preference after volume default migration has run', () => {
    const migratedProperties = normalizeChartProperties({
      showTickVolumes: true,
      showRealVolumes: false,
    });

    const migrated = applyVolumeBarsDefaultMigration(
      migratedProperties,
      {},
      1,
    );

    expect(migrated.globalProperties.showTickVolumes).toBe(true);
    expect(migrated.globalProperties.showRealVolumes).toBe(false);
  });

  it('migrates old persisted chart shift to disabled once', () => {
    const oldPersistedProperties = normalizeChartProperties({
      chartShift: true,
    });

    const migrated = applyChartShiftDefaultMigration(
      oldPersistedProperties,
      { XAUUSD: oldPersistedProperties },
      undefined,
    );

    expect(migrated.globalProperties.chartShift).toBe(false);
    expect(migrated.symbolProperties.XAUUSD.chartShift).toBe(false);
  });

  it('preserves explicit chart shift preference after migration has run', () => {
    const migratedProperties = normalizeChartProperties({
      chartShift: true,
    });

    const migrated = applyChartShiftDefaultMigration(
      migratedProperties,
      {},
      1,
    );

    expect(migrated.globalProperties.chartShift).toBe(true);
  });

  it('normalizes explicit visible volume settings before migration', () => {
    const normalized = normalizeChartProperties({
      showTickVolumes: true,
      showRealVolumes: false,
    });

    expect(normalized.showTickVolumes).toBe(true);
    expect(normalized.showRealVolumes).toBe(false);
  });

  it('clamps persisted opacity values into slider range', () => {
    expect(clampChartOpacityPercent(-20, 75)).toBe(0);
    expect(clampChartOpacityPercent(135, 75)).toBe(100);
    expect(clampChartOpacityPercent('42', 75)).toBe(42);
    expect(clampChartOpacityPercent('bad-value', 75)).toBe(75);
  });

  it('keeps Green on Black pure black in dark mode, including older persisted backgrounds', () => {
    const greenOnBlack = normalizeChartProperties({
      colorScheme: 'Green on Black',
      colors: {
        ...getPresetSchemeColors('Green on Black'),
        background: '#0e0e12',
      },
    });

    expect(greenOnBlack.colors.background).toBe('#000000');
    expect(getEffectiveChartColors(greenOnBlack, { isAdvancedUntitledLight: false }).background).toBe('#000000');
    expect(getEffectiveChartColors(greenOnBlack, { isAdvancedUntitledLight: true })).toMatchObject({
      background: '#fafbfc',
      foreground: '#334155',
      grid: 'rgba(71, 85, 105, 0.07)',
    });
  });

  it('keeps built-in candle colors readable on the neutral light canvas without mutating saved custom palettes', () => {
    const properties = normalizeChartProperties({ colorScheme: 'Green on Black' });
    const savedColors = { ...properties.colors };
    const light = getEffectiveChartColors(properties, { isAdvancedUntitledLight: true });
    expect(light).toMatchObject({
      barUp: '#087f6c', bullCandle: '#087f6c',
      barDown: '#ce2938', bearCandle: '#ce2938',
      lineChart: '#06634e', lastPriceLine: '#06634e',
    });
    expect(properties.colors).toEqual(savedColors);
    expect(getEffectiveChartColors(properties)).toBe(properties.colors);
    const custom = { ...properties, colorScheme: 'Custom' as const, colors: { ...savedColors, background: '#fef8ed', bullCandle: '#123456' } };
    expect(getEffectiveChartColors(custom, { isAdvancedUntitledLight: true })).toBe(custom.colors);
    expect(getEffectiveChartColors({ ...properties, colors: custom.colors }, { isAdvancedUntitledLight: true }).bullCandle).toBe('#123456');
  });

  it('preserves blue bullish and red bearish colors when normalizing the new preset', () => {
    const properties = normalizeChartProperties({ colorScheme: 'Blue on Black', colors: getPresetSchemeColors('Blue on Black') });
    expect(getEffectiveChartColors(properties)).toMatchObject({
      background: '#000000', barUp: '#4597ff', bullCandle: '#4597ff',
      barDown: '#ff5858', bearCandle: '#ff5858',
    });
    expect(getEffectiveChartColors(properties, { isAdvancedUntitledLight: true })).toMatchObject({
      background: '#fafbfc', barUp: '#1746bc', bullCandle: '#1746bc',
      barDown: '#a51f26', bearCandle: '#a51f26',
    });
    expect(properties.colors.bullCandle).toBe('#4597ff');
    expect(properties.colors.bearCandle).toBe('#ff5858');
  });

  it('updates saved original blue colors while preserving customized colors and other schemes', () => {
    const colors = {
      ...getPresetSchemeColors('Blue on Black'),
      barUp: '#2962FF', bullCandle: '#5B8FD9', lineChart: '#abcdef',
      barDown: CHART_LOSS_COLOR, bearCandle: CHART_LOSS_COLOR,
      lastPriceLine: '#2962ff', volumes: 'rgba(41, 98, 255, 0.32)',
    };
    expect(normalizeChartProperties({ colorScheme: 'Blue on Black', colors }).colors).toMatchObject({
      barUp: '#4597ff', bullCandle: '#4597ff', lineChart: '#abcdef',
      lastPriceLine: '#4597ff', volumes: 'rgba(69, 151, 255, 0.32)',
      bearCandle: '#ff5858', barDown: '#ff5858',
    });
    expect(normalizeChartProperties({ colorScheme: 'Custom', colors }).colors).toEqual(colors);
  });

  it('keeps Yellow on Black yellow in dark mode and uses readable amber on the light surface', () => {
    const yellowOnBlack = normalizeChartProperties({
      colorScheme: 'Yellow on Black',
      colors: getPresetSchemeColors('Yellow on Black'),
    });

    expect(yellowOnBlack.colors.grid).toBe('#e0ded7');
    expect(yellowOnBlack.colors.lastPriceLine).toBe('#facc15');
    expect(getEffectiveChartColors(yellowOnBlack, { isAdvancedUntitledLight: false })).toMatchObject({
      background: '#000000',
      barUp: '#facc15',
      barDown: '#facc15',
      lineChart: '#facc15',
      lastPriceLine: '#facc15',
    });
    expect(getEffectiveChartColors(yellowOnBlack, { isAdvancedUntitledLight: true })).toMatchObject({
      background: '#fafbfc',
      foreground: '#334155',
      grid: 'rgba(71, 85, 105, 0.07)',
      barUp: '#795000',
      barDown: '#795000',
      lineChart: '#795000',
      lastPriceLine: '#795000',
    });
  });

  it('applies the dark-mode Black on White scheme while preserving light gray in light mode', () => {
    const blackOnWhite = normalizeChartProperties({
      colorScheme: 'Black on White',
      colors: getPresetSchemeColors('Black on White'),
    });

    expect(getEffectiveChartColors(blackOnWhite, { isAdvancedUntitledLight: false })).toMatchObject({
      background: '#000000',
      foreground: '#ffffff',
      grid: '#c9c9c9',
      barUp: '#adadad',
      barDown: '#ffffff',
      bullCandle: '#ffffff',
      bearCandle: '#000000',
      lineChart: '#000000',
      lastPriceLine: '#adadad',
    });
    expect(getEffectiveChartColors(blackOnWhite, { isAdvancedUntitledLight: true })).toMatchObject({
      background: '#fafbfc',
      foreground: '#334155',
      grid: 'rgba(71, 85, 105, 0.07)',
      barUp: '#000000',
      barDown: '#000000',
      bullCandle: '#ffffff',
      bearCandle: '#000000',
      lineChart: '#000000',
      lastPriceLine: '#000000',
    });
  });

  it('shows OHLC values by default in defaultChartProperties', () => {
    expect(defaultChartProperties.showOHLC).toBe(true);
  });

  it('migrates old persisted hidden OHLC to visible once', () => {
    const oldPersistedProperties = normalizeChartProperties({
      showOHLC: false,
    });

    const migrated = applyOhlcDefaultMigration(
      oldPersistedProperties,
      { XAUUSD: oldPersistedProperties },
      undefined,
    );

    expect(migrated.globalProperties.showOHLC).toBe(true);
    expect(migrated.symbolProperties.XAUUSD.showOHLC).toBe(true);
    expect(migrated.ohlcDefaultMigrationVersion).toBe(1);
  });

  it('preserves explicit hidden OHLC preference after migration has run', () => {
    const migratedProperties = normalizeChartProperties({
      showOHLC: false,
    });

    const migrated = applyOhlcDefaultMigration(
      migratedProperties,
      { XAUUSD: migratedProperties },
      1,
    );

    expect(migrated.globalProperties.showOHLC).toBe(false);
    expect(migrated.symbolProperties.XAUUSD.showOHLC).toBe(false);
    expect(migrated.ohlcDefaultMigrationVersion).toBe(1);
  });
});
