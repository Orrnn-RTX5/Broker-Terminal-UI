import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
  .replace(/\r\n/g, '\n');

const chartSource = readSource('src/components/TradingChart.tsx');
const chartRuntimeSource = [
  chartSource,
  readSource('src/features/trading-chart/presentation/TradingChartView.tsx'),
  readSource('src/features/trading-chart/runtime/useTradingChartTradeRuntime.ts'),
  readSource('src/features/trading-chart/runtime/useTradingChartTradeOverlayRenderer.ts'),
  readSource('src/features/trading-chart/runtime/createTradeOverlayModelRuntime.ts'),
  readSource('src/features/trading-chart/runtime/createTradeOverlayDomRuntime.ts'),
  readSource('src/features/trading-chart/runtime/useTradingChartTradeLevelDrag.ts'),
  readSource('src/features/trading-chart/runtime/useTradingChartContextMenu.ts'),
  readSource('src/features/trading-chart/presentation/useTradingChartLivePriceOverlay.ts'),
].join('\n');
const shortcutSource = readSource('src/components/GlobalShortcuts.tsx');

describe('TradingChart Charts-menu runtime contract', () => {
  it('targets crosshair and indicator commands to one chart instance', () => {
    const crosshairStart = chartSource.indexOf("commandBus.subscribe('TOGGLE_CROSSHAIR'");
    const crosshairEnd = chartSource.indexOf('const [brokerTimeOffsetSec', crosshairStart);
    const indicatorStart = chartSource.indexOf("commandBus.subscribe('ADD_INDICATOR'");
    const indicatorEnd = chartSource.indexOf('// Update chart with candles helper', indicatorStart);

    expect(chartSource).toContain('const activeChartSourceId = useMemo(');
    expect(chartSource.slice(crosshairStart, crosshairEnd)).toContain('if (!isChartCommandTarget(payload)) return;');
    expect(chartSource.slice(indicatorStart, indicatorEnd)).toContain('if (!isChartCommandTarget(payload)) return;');
    expect(chartSource).toContain('enabled: isActive && crosshairEnabled,');
  });

  it('isolates persisted indicators by account, panel, symbol, and timeframe', () => {
    const scopeStart = chartSource.indexOf('const indicatorStorageScope = useMemo');
    const scopeEnd = chartSource.indexOf('const indicatorStorageScopeRef', scopeStart);
    const scope = chartSource.slice(scopeStart, scopeEnd);

    expect(scope).toContain("brokerAccountSessionScope || 'default-account'");
    expect(scope).toContain('panelId || activeChartSourceId');
    expect(scope).toContain("symbol.trim().toUpperCase() || 'UNKNOWN'");
    expect(scope).toContain('activeTimeframe');
  });

  it('hot-applies every visible Chart Properties option represented in the menu flow', () => {
    expect(chartRuntimeSource).toContain('(chartSettings.showTicker || chartSettings.showOHLC)');
    expect(chartRuntimeSource).toContain('{chartSettings.showTicker && (');
    expect(chartRuntimeSource).toContain('{chartSettings.showOHLC && (');
    expect(chartRuntimeSource).toContain('setShowOneClick(chartSettings.showQuickTradingButtons);');
    expect(chartRuntimeSource).toContain('style={{ zIndex: chartSettings.chartOnForeground ? 11 : 0 }}');
    expect(chartRuntimeSource).toContain('visible: chartSettings.showGrid,');
    expect(chartRuntimeSource).toContain('autoScale: !chartSettings.scaleFixOneToOne');
    expect(chartRuntimeSource).toContain('settings.showAskPriceLine,');
    expect(chartRuntimeSource).toContain('settings.showLastPriceLine,');
    expect(chartRuntimeSource).toContain('chartSettings.showBidPriceLine');
    expect(chartRuntimeSource).toContain('if (chartSettings.showPeriodSeparators) {\n      schedulePeriodSeparatorRender();');
    expect(chartRuntimeSource).toContain('clearPeriodSeparators();\n  }, [chartSettings.showPeriodSeparators');
  });

  it('keeps keyboard shortcuts under one global owner', () => {
    expect(chartSource).not.toContain("window.addEventListener('keydown'");
    expect(shortcutSource).toContain("id: 'charts.bar-chart'");
    expect(shortcutSource).toContain("id: 'charts.candlestick'");
    expect(shortcutSource).toContain("id: 'charts.line-chart'");
    expect(shortcutSource).toContain("id: 'charts.properties'");
    expect(shortcutSource).toContain("dispatchDrawingShortcut('chart-delete-last-drawing')");
  });
});
