import { describe, expect, it } from 'vitest';

import {
  GANN_FIBONACCI_TOOL_GROUPS,
  GANN_FIBONACCI_TOOLS,
  getGannFibonacciTool,
} from './gannFibonacciToolCatalog';

const EXPECTED_TOOLS = [
  ['fib_retracement', 'Fib retracement', 'Fibonacci', 'fibonacci', 2, 'Alt + F'],
  ['trend_based_fib_extension', 'Trend-based fib extension', 'Fibonacci', 'fib_extension', 3, undefined],
  ['fib_channel', 'Fib channel', 'Fibonacci', 'fib_extension', 3, undefined],
  ['fib_time_zone', 'Fib time zone', 'Fibonacci', 'fibonacci', 2, undefined],
  ['fib_speed_resistance_fan', 'Fib speed resistance fan', 'Fibonacci', 'fibonacci', 2, undefined],
  ['trend_based_fib_time', 'Trend-based fib time', 'Fibonacci', 'fib_extension', 3, undefined],
  ['fib_circles', 'Fib circles', 'Fibonacci', 'fibonacci', 2, undefined],
  ['fib_spiral', 'Fib spiral', 'Fibonacci', 'fibonacci', 2, undefined],
  ['fib_speed_resistance_arcs', 'Fib speed resistance arcs', 'Fibonacci', 'fibonacci', 2, undefined],
  ['fib_wedge', 'Fib wedge', 'Fibonacci', 'fib_extension', 3, undefined],
  ['pitchfan', 'Pitchfan', 'Fibonacci', 'fib_extension', 3, undefined],
  ['gann_box', 'Gann box', 'Gann', 'fibonacci', 2, undefined],
  ['gann_square_fixed', 'Gann square fixed', 'Gann', 'fibonacci', 2, undefined],
  ['gann_square', 'Gann square', 'Gann', 'fibonacci', 2, undefined],
  ['gann_fan', 'Gann fan', 'Gann', 'fibonacci', 2, undefined],
] as const;

describe('Gann/Fibonacci drawing-tool catalog', () => {
  it('defines the exact 15 tools in Fibonacci-then-Gann menu order', () => {
    expect(GANN_FIBONACCI_TOOL_GROUPS).toEqual(['Fibonacci', 'Gann']);
    expect(GANN_FIBONACCI_TOOLS).toHaveLength(15);
    expect(new Set(GANN_FIBONACCI_TOOLS.map((tool) => tool.id)).size).toBe(15);
    expect(new Set(GANN_FIBONACCI_TOOLS.map((tool) => tool.label)).size).toBe(15);
    expect(
      GANN_FIBONACCI_TOOLS.map((tool) => [
        tool.id,
        tool.label,
        tool.group,
        tool.drawingType,
        tool.requiredPoints,
        tool.shortcut,
      ]),
    ).toEqual(EXPECTED_TOOLS);
    expect(GANN_FIBONACCI_TOOLS.filter((tool) => tool.group === 'Fibonacci')).toHaveLength(11);
    expect(GANN_FIBONACCI_TOOLS.filter((tool) => tool.group === 'Gann')).toHaveLength(4);
  });

  it('uses the three-anchor lifecycle only for the five source three-point tools', () => {
    expect(
      GANN_FIBONACCI_TOOLS
        .filter((tool) => tool.requiredPoints === 3)
        .map((tool) => tool.id),
    ).toEqual([
      'trend_based_fib_extension',
      'fib_channel',
      'trend_based_fib_time',
      'fib_wedge',
      'pitchfan',
    ]);
    expect(
      GANN_FIBONACCI_TOOLS
        .filter((tool) => tool.requiredPoints === 3)
        .every((tool) => tool.drawingType === 'fib_extension'),
    ).toBe(true);
    expect(
      GANN_FIBONACCI_TOOLS
        .filter((tool) => tool.requiredPoints === 2)
        .every((tool) => tool.drawingType === 'fibonacci'),
    ).toBe(true);
  });

  it.each(EXPECTED_TOOLS)(
    '%s resolves to its exact label, group, base type, and anchor count',
    (id, label, group, drawingType, requiredPoints, shortcut) => {
      expect(getGannFibonacciTool(id)).toEqual({
        id,
        label,
        group,
        drawingType,
        requiredPoints,
        ...(shortcut ? { shortcut } : {}),
      });
    },
  );

  it('does not resolve missing or unknown persisted subtypes as catalog entries', () => {
    expect(getGannFibonacciTool(undefined)).toBeUndefined();
    expect(getGannFibonacciTool('not-a-gann-fibonacci-tool')).toBeUndefined();
  });
});
