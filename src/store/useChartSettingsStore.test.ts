import { describe, expect, it } from 'vitest';
import {
  applyPeriodSeparatorsDefaultMigration,
  applyVolumeBarsDefaultMigration,
  clampChartOpacityPercent,
  defaultChartProperties,
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
    expect(defaultChartProperties.tradeHistoryLineOpacity).toBe(25);
    expect(defaultChartProperties.tradeHistoryBoxOpacity).toBe(40);
  });

  it('shows period separators by default', () => {
    expect(defaultChartProperties.showPeriodSeparators).toBe(true);
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
    expect(normalized.tradeHistoryLineOpacity).toBe(25);
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
});
