import { describe, expect, it } from 'vitest';
import {
  formatTradeVolume,
  isTradeVolumeValid,
  normalizeTradeVolume,
  resolveTradeVolumeConstraints,
} from './tradeVolume';

describe('trade volume constraints', () => {
  it('uses the standard 0.01 fallback without floating-point step residue', () => {
    const constraints = resolveTradeVolumeConstraints();

    expect(normalizeTradeVolume(0.99 + constraints.step, constraints)).toBe(1);
    expect(formatTradeVolume(1, constraints)).toBe('1.00');
    expect(isTradeVolumeValid(1.25, constraints)).toBe(true);
  });

  it('honors broker minimum, maximum, and fractional step for any instrument', () => {
    const constraints = resolveTradeVolumeConstraints({
      minVolume: 0.001,
      maxVolume: 2,
      volumeStep: 0.001,
    });

    // FIX regression: instruments with a 0.001 lot step must not be truncated
    // by the former globally hardcoded two-decimal editor.
    expect(formatTradeVolume(1.257, constraints)).toBe('1.257');
    expect(normalizeTradeVolume(3, constraints)).toBe(2);
    expect(isTradeVolumeValid(0.0001, constraints)).toBe(false);
    expect(isTradeVolumeValid(1.257, constraints)).toBe(true);
  });

  it('snaps an off-step draft to the nearest broker-valid value', () => {
    const constraints = resolveTradeVolumeConstraints({
      minVolume: 0.1,
      maxVolume: 5,
      volumeStep: 0.1,
    });

    expect(normalizeTradeVolume(1.26, constraints)).toBe(1.3);
    expect(isTradeVolumeValid(1.26, constraints)).toBe(false);
    expect(formatTradeVolume(1.26, constraints)).toBe('1.3');
  });
});
