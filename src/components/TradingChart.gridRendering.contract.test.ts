import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const chartSource = readFileSync(
  resolve(process.cwd(), 'src/components/TradingChart.tsx'),
  'utf8',
).replace(/\r\n/g, '\n');
const dialogSource = readFileSync(
  resolve(process.cwd(), 'src/components/dialogs/ChartPropertiesDialog.tsx'),
  'utf8',
).replace(/\r\n/g, '\n');

describe('TradingChart enterprise grid rendering contract', () => {
  it('disables the rectangular native grid during creation and hot theme updates', () => {
    const creationStart = chartSource.indexOf('const chart = createChartEx(containerRef.current, timeScaleBehavior, {');
    const creationEnd = chartSource.indexOf('crosshair:', creationStart);
    const creationGrid = chartSource.slice(creationStart, creationEnd);
    const hotApplyStart = chartSource.indexOf('// Apply global layout and grid');
    const hotApplyEnd = chartSource.indexOf('crosshair:', hotApplyStart);
    const hotApplyGrid = chartSource.slice(hotApplyStart, hotApplyEnd);

    for (const nativeGrid of [creationGrid, hotApplyGrid]) {
      expect(nativeGrid).toContain('color: chartTheme.gridVertical');
      expect(nativeGrid).toContain('color: chartTheme.gridHorizontal');
      expect(nativeGrid.match(/style: LineStyle\.Solid/g)).toHaveLength(2);
      expect(nativeGrid.match(/visible: false/g)).toHaveLength(2);
      expect(nativeGrid).not.toContain('visible: chartSettings.showGrid');
    }
  });

  it('attaches one bottom-layer square grid primitive to a stable transparent host', () => {
    expect(chartSource).toContain("import {\n  SQUARE_CHART_GRID_CELL_SIZE_PX,\n  SquareChartGridPrimitive,");
    expect(chartSource).toContain("const squareGridHostSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);");
    expect(chartSource).toContain('const squareGridPrimitive = new SquareChartGridPrimitive({');
    expect(chartSource).toContain('cellSizeCssPx: SQUARE_CHART_GRID_CELL_SIZE_PX,');
    expect(chartSource).toContain('verticalColor: chartTheme.gridVertical,');
    expect(chartSource).toContain('horizontalColor: chartTheme.gridHorizontal,');
    expect(chartSource).toContain('squareGridHostSeries.attachPrimitive(squareGridPrimitive);');
    expect(chartSource).toContain('squareGridHostSeriesRef.current.detachPrimitive(squareGridPrimitiveRef.current);');
    expect(chartSource).not.toContain('squareGridHostSeries.setData(');
  });

  it('does not place a DOM grid layer above candles or across the scale gutters', () => {
    const renderedMarkup = chartSource.slice(chartSource.lastIndexOf('\n  return ('));

    expect(chartSource).not.toContain('TRADING_VIEW_GRID_OVERLAY_SIZE');
    expect(chartSource).not.toContain('backgroundImage: `linear-gradient(to right, ${chartTheme.grid}');
    expect(renderedMarkup).not.toContain('chartTheme.gridVertical');
    expect(renderedMarkup).not.toContain('chartTheme.gridHorizontal');
    expect(renderedMarkup).not.toContain('TRADING_VIEW_GRID_OVERLAY_SIZE');
  });

  it('keeps the Chart Properties preview square and consistent with live colors', () => {
    expect(dialogSource).toContain("import { getChartGridLineColors } from '../../utils/chartGridStyle';");
    expect(dialogSource).toContain("import { SQUARE_CHART_GRID_CELL_SIZE_PX } from '../../utils/squareChartGridPrimitive';");
    expect(dialogSource).toContain('grid: effectiveColors.grid');
    expect(dialogSource).toContain('showGrid: showState.showGrid');
    expect(dialogSource).toContain('linear-gradient(to right, ${previewGridColors.vertical}');
    expect(dialogSource).toContain('linear-gradient(to bottom, ${previewGridColors.horizontal}');
    expect(dialogSource).toContain('`${SQUARE_CHART_GRID_CELL_SIZE_PX}px ${SQUARE_CHART_GRID_CELL_SIZE_PX}px`');
    expect(dialogSource).not.toContain("backgroundSize: '48px 32px'");
    expect(dialogSource).not.toContain('rtx-cp-preview-grid');
  });
});
