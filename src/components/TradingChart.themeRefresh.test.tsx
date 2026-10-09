// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { useEffect, useLayoutEffect } from 'react';
import { render } from '@testing-library/react';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { requestChartTradeOverlayRefresh, TRADE_OVERLAY_REFRESH_EVENT, type TradeOverlayRefreshDetail } from '../services/tradeOverlayRefreshEvents';

// Mount the actual theme effects in their source order while leaving broker,
// feed and canvas initialization outside this focused lifecycle regression.
const source = readFileSync(resolve(process.cwd(), 'src/components/TradingChart.tsx'), 'utf8');
const parsed = ts.createSourceFile('TradingChart.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const effects: string[] = [];
const visit = (node: ts.Node) => {
  if (ts.isCallExpression(node) && ['useEffect', 'useLayoutEffect'].includes(node.expression.getText(parsed))) {
    const body = node.arguments[0]?.getText(parsed) ?? '';
    if (body.includes('chartThemeRef.current = chartTheme')
      || body.includes("requestChartTradeOverlayRefresh(drawingRuntimeContextRef.current.contextId, 'rebuild')")) {
      effects.push(node.getText(parsed));
    }
  }
  ts.forEachChild(node, visit);
};
visit(parsed);
if (effects.length !== 2) throw new Error('Expected chart theme synchronization and application effects');
const effectScript = ts.transpileModule(effects.join(';\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

const themes = {
  dark: { background: '#000000', axisText: '#b9bcc6', candleUp: '#089981', candleDown: '#f23645' },
  light: { background: '#fafbfc', axisText: '#475569', candleUp: '#1d4ed8', candleDown: '#b91c1c' },
};

describe('chart theme refresh ordering', () => {
  it.each([['dark', 'light'], ['light', 'dark']] as const)(
    'rebuilds overlays using the new %s to %s palette in the same layout phase',
    (from, to) => {
      const chartThemeRef = { current: themes[from] };
      const applyOptions = vi.fn();
      const observedThemes: typeof themes.dark[] = [];
      const observeRebuild = (event: Event) => {
        const detail = (event as CustomEvent<TradeOverlayRefreshDetail>).detail;
        if (detail.contextId === 'chart-a' && detail.mode === 'rebuild') {
          observedThemes.push(chartThemeRef.current);
        }
      };
      const stableScope = {
        useEffect, useLayoutEffect, chartThemeRef,
        chartRef: { current: { applyOptions } }, isDisposedRef: { current: false },
        chartSettings: { showGrid: false }, chartAxisFontSize: 12,
        getChartGridRenderingOptions: () => ({ nativeGrid: {}, fixedGrid: {} }),
        ColorType: { Solid: 'solid' }, isAdvancedUntitledLight: false,
        LIGHT_CHART_AXIS_FONT_FAMILY: 'sans-serif', CHART_AXIS_FONT_FAMILY: 'sans-serif',
        TRADING_VIEW_HANDLE_SCROLL: {}, TRADING_VIEW_HANDLE_SCALE: {},
        TRADING_CHART_TIME_SCALE_LIVE_SHIFT_OPTIONS: {},
        squareGridPrimitiveRef: { current: null }, prevChartTypeRef: { current: 'candlestick' },
        chartType: 'candlestick', seriesRef: { current: null }, volumeRef: { current: null },
        areaTrendDirectionRef: { current: 'up' }, requestChartDataRender: vi.fn(),
        schedulePeriodSeparatorRender: vi.fn(), symbol: 'BTCUSD', timeframe: 'M1', updateLegendDOM: vi.fn(),
        drawingRuntimeContextRef: { current: { contextId: 'chart-a' } }, requestChartTradeOverlayRefresh,
      };
      const runEffects = new Function(...Object.keys(stableScope), 'chartTheme', effectScript);
      const Harness = ({ theme }: { theme: typeof themes.dark }) => {
        runEffects(...Object.values(stableScope), theme);
        return null;
      };

      window.addEventListener(TRADE_OVERLAY_REFRESH_EVENT, observeRebuild);
      try {
        const view = render(<Harness theme={themes[from]} />);
        observedThemes.length = 0;
        applyOptions.mockClear();

        view.rerender(<Harness theme={themes[to]} />);

        expect(applyOptions).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
          layout: expect.objectContaining({ background: { type: 'solid', color: themes[to].background } }),
        }));
        expect(observedThemes).toEqual([themes[to]]);
      } finally {
        window.removeEventListener(TRADE_OVERLAY_REFRESH_EVENT, observeRebuild);
      }
    },
  );
});
