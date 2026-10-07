import { describe, expect, it } from 'vitest';
import { getChartGridLineColors } from './chartGridStyle';

const readAlpha = (color: string): number => {
  const match = /,\s*([\d.]+)\)$/.exec(color);
  if (!match) throw new Error(`Expected an rgba color, received ${color}`);
  return Number(match[1]);
};

describe('getChartGridLineColors', () => {
  it('uses equally visible MT5 slate guides with theme-appropriate contrast and preserves custom colors', () => {
    const options = { grid: '#2b2b2b', showGrid: true, gridType: 'mt5' as const, lineStyle: 'dashed' as const };
    expect(getChartGridLineColors({ ...options, background: '#000000' })).toEqual({ vertical: '#778899', horizontal: '#778899' });
    const light = getChartGridLineColors({ ...options, background: '#ffffff' });
    expect(light).toEqual({ vertical: 'rgba(71, 85, 105, 0.45)', horizontal: 'rgba(71, 85, 105, 0.45)' });
    const custom = { ...options, background: '#000000', colorScheme: 'Custom' as const, grid: 'rgba(120, 30, 180, 0.2)' };
    expect(getChartGridLineColors(custom)).toEqual({ vertical: custom.grid, horizontal: custom.grid });
    expect(getChartGridLineColors({ ...custom, showGrid: false })).toEqual({ vertical: 'rgba(0, 0, 0, 0)', horizontal: 'rgba(0, 0, 0, 0)' });
    expect(getChartGridLineColors({ ...custom, grid: 'transparent' })).toEqual({ vertical: 'rgba(0, 0, 0, 0)', horizontal: 'rgba(0, 0, 0, 0)' });
  });
  it.each(['#000000', '#ffffff'])('uses the configured scale grid color equally on both axes on %s', (background) => {
    const options = { background, grid: 'rgba(120, 144, 156, 0.28)', showGrid: true, gridType: 'scale' as const };
    const solid = getChartGridLineColors({ ...options, lineStyle: 'solid' });
    expect(solid.vertical).toBe(solid.horizontal);
    expect(solid.vertical).toMatch(/^rgba\(120, 144, 156, /);
    expect(readAlpha(solid.vertical)).toBeLessThanOrEqual(0.28);
    const dashed = getChartGridLineColors({ ...options, lineStyle: 'dashed' });
    expect(dashed.vertical).toBe(dashed.horizontal);
    expect(readAlpha(dashed.vertical)).toBeGreaterThan(0.28);
    expect(getChartGridLineColors({ ...options, showGrid: false })).toEqual({
      vertical: 'rgba(0, 0, 0, 0)', horizontal: 'rgba(0, 0, 0, 0)',
    });
  });
  it.each(['#000000', '#ffffff'])('makes dashed grids clearer on %s while retaining the solid palette', (background) => {
    const options = { background, grid: 'rgba(120, 144, 156, 0.28)', showGrid: true };
    const solid = getChartGridLineColors({ ...options, lineStyle: 'solid' });
    const dashed = getChartGridLineColors({ ...options, lineStyle: 'dashed' });
    expect(readAlpha(dashed.vertical)).toBeGreaterThan(readAlpha(solid.vertical));
    expect(readAlpha(dashed.horizontal)).toBeGreaterThan(readAlpha(solid.horizontal));
    expect(dashed.horizontal).toMatch(/^rgba\(120, 144, 156, /);
    expect(getChartGridLineColors({ ...options, lineStyle: 'dashed', showGrid: false })).toEqual({
      vertical: 'rgba(0, 0, 0, 0)', horizontal: 'rgba(0, 0, 0, 0)',
    });
  });

  it('increases reference light dot contrast equally on both axes', () => {
    const options = { background: '#ffffff', grid: 'rgba(46, 46, 46, 0.2)', showGrid: true, preserveConfiguredColor: true };
    expect(getChartGridLineColors({ ...options, lineStyle: 'dashed' })).toEqual({
      vertical: 'rgba(46, 46, 46, 0.56)', horizontal: 'rgba(46, 46, 46, 0.56)',
    });
    expect(readAlpha(getChartGridLineColors({ ...options, lineStyle: 'solid' }).vertical)).toBeLessThan(0.2);
  });

  it.each(['square', 'scale', 'mt5'] as const)('softens the opaque slate solid grid in %s without weakening its dashed preset', (gridType) => {
    const options = { background: '#000000', grid: '#778899', showGrid: true, colorScheme: 'Green and White' as const, gridType };
    const solid = getChartGridLineColors({ ...options, lineStyle: 'solid' });
    expect(solid.vertical).toBe(solid.horizontal);
    expect(solid.horizontal).toMatch(/^rgba\(119, 136, 153, /);
    expect(readAlpha(solid.horizontal)).toBeGreaterThan(0.2);
    expect(readAlpha(solid.horizontal)).toBeLessThan(0.3);
    expect(getChartGridLineColors({ ...options, lineStyle: 'dashed' })).toEqual({ vertical: '#778899', horizontal: '#778899' });
  });

  it.each(['#000000', '#ffffff'])('retains subtle custom solid colors and honors Show grid on %s', (background) => {
    const options = { background, grid: 'rgba(59, 130, 246, 0.04)', showGrid: true, colorScheme: 'Custom' as const, gridType: 'mt5' as const, lineStyle: 'solid' as const };
    expect(getChartGridLineColors(options)).toEqual({ vertical: options.grid, horizontal: options.grid });
    expect(getChartGridLineColors({ ...options, showGrid: false })).toEqual({ vertical: 'rgba(0, 0, 0, 0)', horizontal: 'rgba(0, 0, 0, 0)' });
    expect(getChartGridLineColors({ ...options, grid: 'transparent' })).toEqual({ vertical: 'rgba(0, 0, 0, 0)', horizontal: 'rgba(0, 0, 0, 0)' });
  });

  it('brightens near-background dark dot colors that opacity alone cannot improve', () => {
    const dashed = getChartGridLineColors({ background: '#000000', grid: '#2b2b2b', showGrid: true, lineStyle: 'dashed' });
    expect(dashed.horizontal).toBe('rgba(77, 77, 77, 1)');
    expect(readAlpha(dashed.vertical)).toBeGreaterThan(0.9);
  });

  it('matches both reference light axes while keeping the grid visibility toggle authoritative', () => {
    const options = {
      background: '#ffffff',
      grid: 'rgba(46, 46, 46, 0.2)',
      showGrid: true,
      preserveConfiguredColor: true,
    };
    expect(getChartGridLineColors(options)).toEqual({
      vertical: options.grid,
      horizontal: options.grid,
    });
    expect(getChartGridLineColors({ ...options, showGrid: false })).toEqual({
      vertical: 'rgba(0, 0, 0, 0)',
      horizontal: 'rgba(0, 0, 0, 0)',
    });
  });

  it('turns the legacy dark grid into a restrained price-first hierarchy', () => {
    const colors = getChartGridLineColors({
      background: '#000000',
      grid: 'rgba(255,255,255,0.15)',
      showGrid: true,
    });

    expect(colors).toEqual({
      vertical: 'rgba(255, 255, 255, 0.102)',
      horizontal: 'rgba(255, 255, 255, 0.135)',
    });
  });

  it('keeps light grids quiet while preserving the configured hue', () => {
    const colors = getChartGridLineColors({
      background: '#ffffff',
      grid: '#e5e7eb',
      showGrid: true,
    });

    expect(colors.horizontal).toMatch(/^rgba\(229, 231, 235, /);
    expect(colors.vertical).toMatch(/^rgba\(229, 231, 235, /);
    expect(readAlpha(colors.vertical)).toBeLessThan(readAlpha(colors.horizontal));
  });

  it('never amplifies a deliberately subtle custom grid', () => {
    const colors = getChartGridLineColors({
      background: '#000000',
      grid: 'rgba(59, 130, 246, 0.04)',
      showGrid: true,
    });

    expect(readAlpha(colors.horizontal)).toBeLessThanOrEqual(0.04);
    expect(readAlpha(colors.vertical)).toBeLessThan(readAlpha(colors.horizontal));
    expect(colors.horizontal).toMatch(/^rgba\(59, 130, 246, /);
  });

  it('uses transparent native lines when the grid is disabled', () => {
    expect(getChartGridLineColors({
      background: '#000000',
      grid: '#ffffff',
      showGrid: false,
    })).toEqual({
      vertical: 'rgba(0, 0, 0, 0)',
      horizontal: 'rgba(0, 0, 0, 0)',
    });
  });
});
