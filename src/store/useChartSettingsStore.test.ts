import { describe, expect, it } from 'vitest';
import {
  applyChartShiftDefaultMigration,
  applyPeriodSeparatorsDefaultMigration,
  applyVolumeBarsDefaultMigration,
  CHART_LOSS_COLOR,
  CHART_PROFIT_COLOR,
  clampChartOpacityPercent,
  defaultChartProperties,
  getEffectiveChartColors,
  getPresetSchemeColors,
  normalizeChartProperties,
} from './useChartSettingsStore';

describe('chart settings trade history overlay defaults', () => {
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

  it('uses the terminal semantic palette for chart direction and price levels', () => {
    expect(defaultChartProperties.colors).toMatchObject({
      barUp: CHART_PROFIT_COLOR,
      bullCandle: CHART_PROFIT_COLOR,
      lineChart: CHART_PROFIT_COLOR,
      lastPriceLine: CHART_PROFIT_COLOR,
      barDown: CHART_LOSS_COLOR,
      bearCandle: CHART_LOSS_COLOR,
      askPriceLine: CHART_LOSS_COLOR,
      stopLevels: CHART_LOSS_COLOR,
    });
    expect(defaultChartProperties.showBidPriceLine).toBe(true);
    expect(defaultChartProperties.showAskPriceLine).toBe(false);
    expect(defaultChartProperties.showLastPriceLine).toBe(false);
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
      barUp: CHART_PROFIT_COLOR,
      barDown: CHART_LOSS_COLOR,
      bullCandle: CHART_PROFIT_COLOR,
      bearCandle: CHART_LOSS_COLOR,
      lineChart: CHART_PROFIT_COLOR,
      volumes: defaultChartProperties.colors.volumes,
      askPriceLine: CHART_LOSS_COLOR,
      lastPriceLine: CHART_PROFIT_COLOR,
      stopLevels: CHART_LOSS_COLOR,
    });

    expect(normalizeChartProperties({
      colorScheme: 'Custom',
      colors: legacyColors,
    }).colors).toMatchObject(legacyColors);
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
    expect(normalized.colors.background).toBe('#000000');
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
      background: '#f7f8fa',
      foreground: '#4b5563',
      grid: 'rgba(46, 46, 46, 0.11)',
    });
  });

  it('applies enterprise light candles without mutating the saved dark or custom palette', () => {
    const properties = normalizeChartProperties({ colorScheme: 'Green on Black' });
    const savedColors = { ...properties.colors };
    const light = getEffectiveChartColors(properties, { isAdvancedUntitledLight: true });
    expect(light).toMatchObject({
      barUp: '#059669', bullCandle: '#059669',
      barDown: '#dc2626', bearCandle: '#dc2626',
      lineChart: '#059669', lastPriceLine: '#059669',
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
      background: '#f7f8fa', bullCandle: '#4597ff', bearCandle: '#ff5858',
    });
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

  it('keeps Yellow on Black black in dark mode but light gray in advanced light mode', () => {
    const yellowOnBlack = normalizeChartProperties({
      colorScheme: 'Yellow on Black',
      colors: getPresetSchemeColors('Yellow on Black'),
    });

    expect(yellowOnBlack.colors.grid).toBe('#e0ded7');
    expect(yellowOnBlack.colors.lastPriceLine).toBe('#facc15');
    expect(getEffectiveChartColors(yellowOnBlack, { isAdvancedUntitledLight: false }).background).toBe('#000000');
    expect(getEffectiveChartColors(yellowOnBlack, { isAdvancedUntitledLight: true })).toMatchObject({
      background: '#f7f8fa',
      foreground: '#4b5563',
      grid: 'rgba(46, 46, 46, 0.11)',
      barUp: '#facc15',
      barDown: '#facc15',
      lastPriceLine: '#facc15',
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
      background: '#f7f8fa',
      foreground: '#4b5563',
      grid: 'rgba(46, 46, 46, 0.11)',
      barUp: '#000000',
      barDown: '#000000',
      bullCandle: '#ffffff',
      bearCandle: '#000000',
      lineChart: '#000000',
      lastPriceLine: '#000000',
    });
  });
});
