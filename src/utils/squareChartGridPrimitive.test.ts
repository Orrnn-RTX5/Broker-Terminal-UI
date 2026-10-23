import { describe, expect, it, vi } from 'vitest';
import {
  SQUARE_CHART_GRID_CELL_SIZE_PX,
  FINE_CHART_GRID_CELL_SIZE_PX,
  SquareChartGridPrimitive,
  getSquareGridLinePositions,
  getFineGridHorizontalPositions,
  getSquareGridTimeAxisPositions,
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

  it('uses twice the guide density for the Fine profile', () => {
    expect(getSquareGridLinePositions(150, FINE_CHART_GRID_CELL_SIZE_PX)).toEqual([32, 64, 96, 128]);
  });

  it('anchors Fine horizontal rows to the bottom when the pane is resized', () => {
    expect(getFineGridHorizontalPositions(150)).toEqual([21, 53, 85, 117, 149]);
    expect(getFineGridHorizontalPositions(160)).toEqual([31, 63, 95, 127, 159]);
    expect(getFineGridHorizontalPositions(Number.NaN)).toEqual([]);
  });

  it('clamps unsafe cell sizes to a professional readable range', () => {
    expect(getSquareGridLinePositions(100, 2)).toEqual([24, 48, 72, 96]);
    expect(getSquareGridLinePositions(350, 500)).toEqual([160, 320]);
  });

  it('computes MT5 grid-aligned time axis tick positions starting at x=0 with 64px intervals', () => {
    expect(getSquareGridTimeAxisPositions(320, SQUARE_CHART_GRID_CELL_SIZE_PX, 'square')).toEqual([0, 64, 128, 192, 256]);
    expect(getSquareGridTimeAxisPositions(320, FINE_CHART_GRID_CELL_SIZE_PX, 'fine')).toEqual([0, 64, 128, 192, 256]);
    expect(getSquareGridTimeAxisPositions(0)).toEqual([]);
  });
});

describe('SquareChartGridPrimitive', () => {
  const createDrawTarget = (horizontalPixelRatio = 1, verticalPixelRatio = 1) => {
    const strokeWidths: number[] = [];
    const context = {
      save: vi.fn(), restore: vi.fn(), setLineDash: vi.fn(),
      beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(() => { strokeWidths.push(context.lineWidth); }),
      lineWidth: 1, lineCap: 'butt', lineDashOffset: 0, strokeStyle: '',
    };
    return {
      context,
      strokeWidths,
      target: {
        useBitmapCoordinateSpace: (draw: (scope: unknown) => void) => draw({
          context,
          bitmapSize: { width: 150 * horizontalPixelRatio, height: 150 * verticalPixelRatio },
          horizontalPixelRatio,
          verticalPixelRatio,
        }),
      },
    };
  };

  it.each([[1, 1], [2, 2], [2, 1]])('draws 0.75px dashed segments at pixel ratios %s/%s', (horizontalPixelRatio, verticalPixelRatio) => {
    const primitive = new SquareChartGridPrimitive({
      visible: true, cellSizeCssPx: 64,
      verticalColor: '#222', horizontalColor: '#333',
    });
    const { context, target, strokeWidths } = createDrawTarget(horizontalPixelRatio, verticalPixelRatio);
    primitive.paneViews()[0]!.renderer()!.draw(target as never);

    expect(context.setLineDash.mock.calls).toEqual([
      [[8 * verticalPixelRatio, 4 * verticalPixelRatio]],
      [[8 * horizontalPixelRatio, 4 * horizontalPixelRatio]],
    ]);
    expect(strokeWidths).toEqual([0.75 * horizontalPixelRatio, 0.75 * verticalPixelRatio]);
    expect(context.stroke).toHaveBeenCalledTimes(2);
    expect(context.moveTo).toHaveBeenCalledTimes(4);
    expect(context.save).toHaveBeenCalledOnce();
    expect(context.restore).toHaveBeenCalledOnce();
  });

  it('clears the dash pattern when switching to solid and stops drawing while hidden', () => {
    const primitive = new SquareChartGridPrimitive({
      visible: true, lineStyle: 'dashed', cellSizeCssPx: 64,
      verticalColor: '#222', horizontalColor: '#333',
    });
    const requestUpdate = vi.fn();
    primitive.attached({ requestUpdate } as never);
    primitive.applyOptions({ lineStyle: 'solid' });
    const { context, target } = createDrawTarget();
    primitive.paneViews()[0]!.renderer()!.draw(target as never);
    expect(context.setLineDash.mock.calls).toEqual([[[]], [[]]]);
    expect(context.lineWidth).toBe(1);
    expect(requestUpdate).toHaveBeenCalledOnce();

    context.stroke.mockClear();
    primitive.applyOptions({ visible: false });
    primitive.paneViews()[0]!.renderer()!.draw(target as never);
    expect(context.stroke).not.toHaveBeenCalled();
  });

  it.each([[1, 1], [2, 2], [2, 1]])('keeps Fine cells and short dashes consistent at pixel ratios %s/%s', (horizontalPixelRatio, verticalPixelRatio) => {
    const primitive = new SquareChartGridPrimitive({
      visible: true, lineStyle: 'dashed', cellSizeCssPx: FINE_CHART_GRID_CELL_SIZE_PX,
      profile: 'fine', dashPatternCssPx: [3, 3], verticalColor: '#778899', horizontalColor: '#778899',
    });
    const { context, target, strokeWidths } = createDrawTarget(horizontalPixelRatio, verticalPixelRatio);
    primitive.paneViews()[0]!.renderer()!.draw(target as never);
    expect(context.setLineDash.mock.calls).toEqual([
      [[3 * verticalPixelRatio, 3 * verticalPixelRatio]],
      [[3 * horizontalPixelRatio, 3 * horizontalPixelRatio]],
    ]);
    expect(strokeWidths).toEqual([horizontalPixelRatio, verticalPixelRatio]);
    expect(context.moveTo).toHaveBeenCalledTimes(9);
    expect(context.moveTo).toHaveBeenCalledWith(0, 21 * verticalPixelRatio + (Math.round(verticalPixelRatio) % 2) / 2);

    // A hot switch must restore the wider Square pitch and longer dash pattern.
    primitive.applyOptions({ profile: 'square', cellSizeCssPx: SQUARE_CHART_GRID_CELL_SIZE_PX, dashPatternCssPx: [8, 4] });
    context.moveTo.mockClear();
    context.setLineDash.mockClear();
    primitive.paneViews()[0]!.renderer()!.draw(target as never);
    expect(context.moveTo).toHaveBeenCalledTimes(4);
    expect(context.setLineDash.mock.calls).toEqual([
      [[8 * verticalPixelRatio, 4 * verticalPixelRatio]],
      [[8 * horizontalPixelRatio, 4 * horizontalPixelRatio]],
    ]);
  });

  it('labels every Fine row with its actual price and releases the price axis when hidden or switched', () => {
    const labelAt = vi.fn((y: number) => `price ${y}`);
    const primitive = new SquareChartGridPrimitive({
      visible: true, profile: 'fine', cellSizeCssPx: 32,
      verticalColor: '#778899', horizontalColor: '#778899',
    }, { labelAt, appearance: () => ({ color: '#ccc', fontSize: 12, fontFamily: 'Arial' }) });
    const context = { save: vi.fn(), restore: vi.fn(), fillText: vi.fn(), font: '', fillStyle: '', textBaseline: '', textAlign: '' };
    const target = { useMediaCoordinateSpace: (draw: (scope: unknown) => void) => draw({ context, mediaSize: { width: 80, height: 150 } }) };
    const pane = primitive.priceAxisPaneViews()[0]!;
    expect(pane.zOrder?.()).toBe('normal'); // live/trade labels paint above these guides
    pane.renderer()!.draw(target as never);
    expect(labelAt.mock.calls).toEqual([[21], [53], [85], [117]]);
    expect(context.fillText.mock.calls).toEqual([
      ['price 21', 8, 21.5], ['price 53', 8, 53.5], ['price 85', 8, 85.5], ['price 117', 8, 117.5],
    ]);
    context.fillText.mockClear();
    primitive.applyOptions({ visible: false });
    pane.renderer()!.draw(target as never);
    primitive.applyOptions({ visible: true, profile: 'square' });
    pane.renderer()!.draw(target as never);
    expect(context.fillText).not.toHaveBeenCalled();
  });

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

  it('draws MT5 grid-aligned tick marks and left-aligned labels on the time axis when visible', () => {
    const labelAt = vi.fn((x: number, isFirstTick: boolean) =>
      isFirstTick ? '12 Oct 2026' : `12 Oct ${16 + x / 64}:00`,
    );
    const timeKeyAt = vi.fn((x: number) => `t-${x}`);
    const primitive = new SquareChartGridPrimitive(
      {
        visible: true,
        profile: 'fine',
        cellSizeCssPx: FINE_CHART_GRID_CELL_SIZE_PX,
        verticalColor: '#778899',
        horizontalColor: '#778899',
      },
      undefined,
      {
        labelAt,
        timeKeyAt,
        appearance: () => ({
          color: '#cccccc',
          fontSize: 11,
          fontFamily: 'Arial',
          backgroundColor: '#000000',
          borderColor: '#555555',
        }),
      },
    );
    const context = {
      save: vi.fn(),
      restore: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn((text: string) => ({ width: text.length * 5 })),
      font: '',
      fillStyle: '',
      textBaseline: '',
      textAlign: '',
    };
    const target = {
      useMediaCoordinateSpace: (draw: (scope: unknown) => void) =>
        draw({ context, mediaSize: { width: 220, height: 26 } }),
    };

    const timePane = primitive.timeAxisPaneViews()[0]!;
    expect(timePane.zOrder?.()).toBe('normal');
    timePane.renderer()!.draw(target as never);

    expect(labelAt.mock.calls).toEqual([
      [0, true],
      [64, false],
      [128, false],
      [192, false],
    ]);
    expect(context.fillText.mock.calls).toEqual([
      ['12 Oct 2026', 2, 13.5],
      ['12 Oct 17:00', 65, 13.5],
      ['12 Oct 18:00', 129, 13.5],
    ]);

    context.fillText.mockClear();
    primitive.applyOptions({ visible: false });
    timePane.renderer()!.draw(target as never);
    expect(context.fillText).not.toHaveBeenCalled();
  });

  it('draws the centered RTX5 background watermark logo in the bottom layer even when grid is hidden, and hides it when showBackgroundLogo is false', () => {
    const fillStyles: string[] = [];
    const context = {
      save: vi.fn(),
      restore: vi.fn(),
      setLineDash: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(() => { fillStyles.push(context.fillStyle); }),
      stroke: vi.fn(),
      lineWidth: 1,
      lineCap: 'butt',
      lineDashOffset: 0,
      strokeStyle: '',
      fillStyle: '',
    };
    const target = {
      useBitmapCoordinateSpace: (draw: (scope: unknown) => void) => draw({
        context,
        bitmapSize: { width: 800, height: 500 },
        horizontalPixelRatio: 1,
        verticalPixelRatio: 1,
      }),
    };

    const primitive = new SquareChartGridPrimitive({
      visible: false,
      showBackgroundLogo: true,
      isLightBackground: false,
      cellSizeCssPx: SQUARE_CHART_GRID_CELL_SIZE_PX,
      verticalColor: '#222',
      horizontalColor: '#333',
    });

    primitive.paneViews()[0]!.renderer()!.draw(target as never);
    expect(context.fill).toHaveBeenCalledTimes(2);
    expect(fillStyles).toEqual([
      'rgba(255, 255, 255, 0.180)',
      'rgba(128, 195, 66, 0.207)',
    ]);
    expect(context.stroke).not.toHaveBeenCalled();

    context.fill.mockClear();
    fillStyles.length = 0;
    primitive.applyOptions({ isLightBackground: true });
    primitive.paneViews()[0]!.renderer()!.draw(target as never);
    expect(context.fill).toHaveBeenCalledTimes(2);
    expect(fillStyles).toEqual([
      'rgba(15, 23, 42, 0.153)',
      'rgba(101, 163, 13, 0.207)',
    ]);

    context.fill.mockClear();
    primitive.applyOptions({ showBackgroundLogo: false });
    primitive.paneViews()[0]!.renderer()!.draw(target as never);
    expect(context.fill).not.toHaveBeenCalled();
  });
});
