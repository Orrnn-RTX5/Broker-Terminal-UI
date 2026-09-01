import { describe, expect, it } from 'vitest';
import { getChartGridLineColors } from './chartGridStyle';

const readAlpha = (color: string): number => {
  const match = /,\s*([\d.]+)\)$/.exec(color);
  if (!match) throw new Error(`Expected an rgba color, received ${color}`);
  return Number(match[1]);
};

describe('getChartGridLineColors', () => {
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
