import { describe, expect, it, vi } from 'vitest';
import { ChartOverlayGeometryPrimitive } from './chartOverlayGeometryPrimitive';

describe('chart committed overlay geometry', () => {
  it('waits for chart paint after a transform change and repaints once using the committed scale', () => {
    let coordinate = 100;
    const arrow = { top: 100 };
    const repaint = vi.fn(() => { arrow.top = coordinate; });
    const primitive = new ChartOverlayGeometryPrimitive(repaint);
    const renderer = primitive.paneViews()[0].renderer()!;
    primitive.attached();
    renderer.draw({} as never);
    expect(repaint).toHaveBeenCalledTimes(1);
    primitive.updateAllViews();
    primitive.updateAllViews();
    // The model invalidates before the library commits its new coordinates.
    coordinate = 250;
    expect(arrow.top).toBe(100);
    renderer.draw({} as never);
    renderer.draw({} as never);
    expect(arrow.top).toBe(250);
    expect(repaint).toHaveBeenCalledTimes(2);
    primitive.updateAllViews();
    coordinate = 60;
    renderer.draw({} as never);
    expect(arrow.top).toBe(60);
  });

  it('cannot move an old chart overlay after detachment', () => {
    const repaint = vi.fn();
    const primitive = new ChartOverlayGeometryPrimitive(repaint);
    const renderer = primitive.paneViews()[0].renderer()!;
    renderer.draw({} as never);
    expect(repaint).not.toHaveBeenCalled();
    primitive.attached();
    primitive.detached();
    primitive.updateAllViews();
    renderer.draw({} as never);
    expect(repaint).not.toHaveBeenCalled();
    primitive.attached();
    renderer.draw({} as never);
    expect(repaint).toHaveBeenCalledTimes(1);
  });
});
