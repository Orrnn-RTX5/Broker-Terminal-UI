import { describe, expect, it } from 'vitest';
import {
  clampChartOpacityPercent,
  defaultChartProperties,
  normalizeChartProperties,
} from './useChartSettingsStore';

describe('chart settings trade history overlay defaults', () => {
  it('keeps closed trade history overlays visible by default with reduced clutter opacity', () => {
    expect(defaultChartProperties.showTradeHistory).toBe(true);
    expect(defaultChartProperties.showTradeHistoryBoxes).toBe(true);
    expect(defaultChartProperties.tradeHistoryLineOpacity).toBe(25);
    expect(defaultChartProperties.tradeHistoryBoxOpacity).toBe(40);
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
    expect(normalized.showTradeHistoryBoxes).toBe(true);
    expect(normalized.tradeHistoryLineOpacity).toBe(25);
    expect(normalized.tradeHistoryBoxOpacity).toBe(40);
    expect(normalized.colors.background).toBe('#101010');
    expect(normalized.colors.foreground).toBe(defaultChartProperties.colors.foreground);
  });

  it('clamps persisted opacity values into slider range', () => {
    expect(clampChartOpacityPercent(-20, 75)).toBe(0);
    expect(clampChartOpacityPercent(135, 75)).toBe(100);
    expect(clampChartOpacityPercent('42', 75)).toBe(42);
    expect(clampChartOpacityPercent('bad-value', 75)).toBe(75);
  });
});
