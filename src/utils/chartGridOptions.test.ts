import { LineStyle } from 'lightweight-charts';
import { describe, expect, it } from 'vitest';
import { getChartGridRenderingOptions } from './chartGridOptions';

const colors = { gridVertical: '#333333', gridHorizontal: '#444444' };

describe('chart grid type selection', () => {
  it.each(['dashed', 'solid'] as const)('selects one grid and retains %s style and colors', (gridLineStyle) => {
    const square = getChartGridRenderingOptions({ gridType: 'square', gridLineStyle, showGrid: true }, colors);
    const mt5 = getChartGridRenderingOptions({ gridType: 'mt5', gridLineStyle, showGrid: true }, colors);
    const scale = getChartGridRenderingOptions({ gridType: 'scale', gridLineStyle, showGrid: true }, colors);
    const expectedStyle = gridLineStyle === 'solid' ? LineStyle.Solid : LineStyle.Dashed;
    expect(square.squareVisible).toBe(true);
    expect(square.nativeGrid.vertLines.visible).toBe(false);
    expect(square.nativeGrid.horzLines.visible).toBe(false);
    expect(square.fixedGrid).toMatchObject({ visible: true, cellSizeCssPx: 64, dashPatternCssPx: [8, 4], lineStyle: gridLineStyle });
    expect(mt5.fixedGrid).toEqual({
      profile: 'fine',
      visible: true, cellSizeCssPx: 32, dashPatternCssPx: [3, 3], lineStyle: gridLineStyle,
      verticalColor: colors.gridVertical, horizontalColor: colors.gridHorizontal,
    });
    expect(mt5.nativeGrid.vertLines.visible).toBe(false);
    expect(mt5.nativeGrid.horzLines.visible).toBe(false);
    expect(scale.squareVisible).toBe(false);
    expect(scale.nativeGrid).toEqual({
      vertLines: { color: colors.gridVertical, style: expectedStyle, visible: true },
      horzLines: { color: colors.gridHorizontal, style: expectedStyle, visible: true },
    });
  });

  it.each(['square', 'scale', 'mt5'] as const)('hides both renderers when Show grid is off for %s', (gridType) => {
    const options = getChartGridRenderingOptions({ gridType, gridLineStyle: 'dashed', showGrid: false }, colors);
    expect(options.squareVisible).toBe(false);
    expect(options.fixedGrid.visible).toBe(false);
    expect(options.nativeGrid.vertLines.visible).toBe(false);
    expect(options.nativeGrid.horzLines.visible).toBe(false);
  });

  it('forwards showBackgroundLogo and theme lightness to the bottom-layer primitive options', () => {
    const darkLogoOn = getChartGridRenderingOptions(
      { gridType: 'square', gridLineStyle: 'dashed', showGrid: false, showBackgroundLogo: true },
      { ...colors, background: '#000000' },
    );
    expect(darkLogoOn.fixedGrid.showBackgroundLogo).toBe(true);
    expect(darkLogoOn.fixedGrid.isLightBackground).toBe(false);

    const lightLogoOff = getChartGridRenderingOptions(
      { gridType: 'square', gridLineStyle: 'dashed', showGrid: true, showBackgroundLogo: false },
      { ...colors, background: '#fafbfc' },
    );
    expect(lightLogoOff.fixedGrid.showBackgroundLogo).toBe(false);
    expect(lightLogoOff.fixedGrid.isLightBackground).toBe(true);
  });
});
