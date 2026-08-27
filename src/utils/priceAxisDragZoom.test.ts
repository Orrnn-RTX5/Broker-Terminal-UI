import { describe, expect, it } from 'vitest';

import { computePriceAxisDragRange, PRICE_AXIS_DRAG_EFOLD_PX } from './priceAxisDragZoom';

describe('computePriceAxisDragRange', () => {
  const start = { startFrom: 0.978, startTo: 0.998 }; // span 0.02, like the MT probe

  it('matches the measured MT web curve: ~x1.22 per 200px down, ~x1.49 per 400px', () => {
    const down200 = computePriceAxisDragRange({ ...start, dragDeltaY: 200 });
    const down400 = computePriceAxisDragRange({ ...start, dragDeltaY: 400 });
    expect(down200).not.toBeNull();
    expect(down400).not.toBeNull();
    const span200 = down200!.to - down200!.from;
    const span400 = down400!.to - down400!.from;
    expect(span200 / 0.02).toBeCloseTo(Math.exp(200 / PRICE_AXIS_DRAG_EFOLD_PX), 6);
    expect(span200 / 0.02).toBeGreaterThan(1.15);
    expect(span200 / 0.02).toBeLessThan(1.3);
    expect(span400 / 0.02).toBeGreaterThan(1.4);
    expect(span400 / 0.02).toBeLessThan(1.6);
  });

  it('zooms in symmetrically for upward drags', () => {
    const down = computePriceAxisDragRange({ ...start, dragDeltaY: 250 });
    const up = computePriceAxisDragRange({ ...start, dragDeltaY: -250 });
    const spanDown = down!.to - down!.from;
    const spanUp = up!.to - up!.from;
    expect(spanDown * spanUp).toBeCloseTo(0.02 * 0.02, 10); // exp symmetry
    expect(spanUp).toBeLessThan(0.02);
  });

  it('scales around the range center', () => {
    const zoomed = computePriceAxisDragRange({ ...start, dragDeltaY: 300 });
    const centerBefore = (start.startFrom + start.startTo) / 2;
    const centerAfter = (zoomed!.from + zoomed!.to) / 2;
    expect(centerAfter).toBeCloseTo(centerBefore, 12);
  });

  it('clamps to the minimum span and the runaway factor', () => {
    const tiny = computePriceAxisDragRange({ ...start, dragDeltaY: -100000, minSpan: 0.005 });
    expect(tiny!.to - tiny!.from).toBeCloseTo(0.005, 12);
    const huge = computePriceAxisDragRange({ ...start, dragDeltaY: 100000 });
    expect((huge!.to - huge!.from) / 0.02).toBeCloseTo(50, 6);
  });

  it('rejects unusable inputs', () => {
    expect(computePriceAxisDragRange({ startFrom: 1, startTo: 1, dragDeltaY: 100 })).toBeNull();
    expect(computePriceAxisDragRange({ startFrom: Number.NaN, startTo: 1, dragDeltaY: 100 })).toBeNull();
    expect(computePriceAxisDragRange({ startFrom: 0.9, startTo: 1, dragDeltaY: Number.NaN })).toBeNull();
  });
});
