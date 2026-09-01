import { describe, expect, it, vi } from 'vitest';
import {
  SQUARE_CHART_GRID_CELL_SIZE_PX,
  SquareChartGridPrimitive,
  getSquareGridLinePositions,
} from './squareChartGridPrimitive';

describe('square chart grid geometry', () => {
  it('uses the same fixed pitch for both axes', () => {
    const horizontal = getSquareGridLinePositions(420, SQUARE_CHART_GRID_CELL_SIZE_PX);
    const vertical = getSquareGridLinePositions(290, SQUARE_CHART_GRID_CELL_SIZE_PX);

    expect(horizontal).toEqual([64, 128, 192, 256, 320, 384]);
    expect(vertical).toEqual([64, 128, 192, 256]);
  });

  it('returns no geometry for an invalid extent', () => {
    expect(getSquareGridLinePositions(0)).toEqual([]);
    expect(getSquareGridLinePositions(Number.NaN)).toEqual([]);
  });

  it('clamps unsafe cell sizes to a professional readable range', () => {
    expect(getSquareGridLinePositions(100, 2)).toEqual([24, 48, 72, 96]);
    expect(getSquareGridLinePositions(350, 500)).toEqual([160, 320]);
  });
});

describe('SquareChartGridPrimitive', () => {
  it('renders in the bottom layer and requests a redraw after option changes', () => {
    const requestUpdate = vi.fn();
    const primitive = new SquareChartGridPrimitive({
      visible: true,
      cellSizeCssPx: SQUARE_CHART_GRID_CELL_SIZE_PX,
      verticalColor: 'rgba(255, 255, 255, 0.10)',
      horizontalColor: 'rgba(255, 255, 255, 0.14)',
    });

    primitive.attached({ requestUpdate } as never);
    const [paneView] = primitive.paneViews();

    expect(paneView?.zOrder?.()).toBe('bottom');
    expect(paneView?.renderer()).toBeTruthy();

    primitive.applyOptions({ visible: false });
    expect(requestUpdate).toHaveBeenCalledTimes(1);

    primitive.detached();
    primitive.applyOptions({ visible: true });
    expect(requestUpdate).toHaveBeenCalledTimes(1);
  });
});
