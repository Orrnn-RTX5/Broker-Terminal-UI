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
      background: '#fafbfc',
      foreground: '#4b5563',
      grid: '#e8e8e8',
    });
  });

  it('keeps Yellow on Black black in dark mode but white in advanced light mode', () => {
    const yellowOnBlack = normalizeChartProperties({
      colorScheme: 'Yellow on Black',
      colors: getPresetSchemeColors('Yellow on Black'),
    });

    expect(yellowOnBlack.colors.grid).toBe('#e0ded7');
    expect(yellowOnBlack.colors.lastPriceLine).toBe('#facc15');
    expect(getEffectiveChartColors(yellowOnBlack, { isAdvancedUntitledLight: false }).background).toBe('#000000');
    expect(getEffectiveChartColors(yellowOnBlack, { isAdvancedUntitledLight: true })).toMatchObject({
      background: '#fafbfc',
      foreground: '#4b5563',
      grid: '#e0ded7',
      barUp: '#facc15',
      barDown: '#facc15',
      lastPriceLine: '#facc15',
    });
  });

  it('applies the dark-mode Black on White scheme while preserving white light mode', () => {
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
      foreground: '#202124',
      grid: '#d5d7da',
      barUp: '#000000',
      barDown: '#000000',
      bullCandle: '#ffffff',
      bearCandle: '#000000',
      lineChart: '#000000',
      lastPriceLine: '#000000',
    });
  });
});
