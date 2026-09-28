import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const chartSource = readFileSync(
  resolve(process.cwd(), 'src/features/trading-chart/runtime/useTradingChartReconfiguration.ts'),
  'utf8',
).replace(/\r\n/g, '\n');

describe('TradingChart forecasting and measurement pointer contract', () => {
  it('routes Ghost Feed through click anchors and finishes on the second double-click event', () => {
    expect(chartSource).toContain('const handleGhostFeedClickCapture = (event: MouseEvent) => {');
    expect(chartSource).toContain('if (event.detail < 2) return;');
    expect(chartSource).toContain("activeDrawing?.type !== 'measure' || activeDrawing.subtype !== 'ghost_feed'");
    expect(chartSource).toContain('drawingManager.finishDrawing(contextId);');
    expect(chartSource).toContain("if (activeDrawing && activeDrawing.type !== 'freehand') {");
    expect(chartSource).toContain("containerRef.current.addEventListener('click', handleGhostFeedClickCapture, true);");
    expect(chartSource).toContain("containerRef.current.removeEventListener('click', handleGhostFeedClickCapture, true);");

    const nativeCompletion = chartSource.indexOf('const handleGhostFeedClickCapture = (event: MouseEvent) => {');
    const chartSubscription = chartSource.indexOf('chart.subscribeClick(clickHandler);', nativeCompletion);
    expect(nativeCompletion).toBeGreaterThan(-1);
    expect(chartSubscription).toBeGreaterThan(nativeCompletion);
  });

  it('keeps press-drag pointer ownership limited to freehand drawing', () => {
    expect(chartSource).toContain('if (!e.isPrimary || e.button !== 0 || isDrawingContinuous) return;');
    expect(chartSource).toContain("if (activeDrawing?.type === 'freehand') {");
    expect(chartSource).toContain('continuousPointerId = e.pointerId;');
    expect(chartSource).toContain('event.pointerId !== continuousPointerId');
    expect(chartSource).toContain("window.addEventListener('pointercancel', handlePointerCancel);");
    expect(chartSource).toContain('drawingManager.cancelDrawing(drawingRuntimeContextRef.current.contextId);');

    const pointerDown = chartSource.slice(
      chartSource.indexOf('const handlePointerDown = (e: PointerEvent) => {'),
      chartSource.indexOf('const handlePointerUp = (event: PointerEvent) => {'),
    );
    expect(pointerDown).not.toContain("activeDrawing.subtype === 'ghost_feed'");
  });

  it('preserves fractional logical anchors when time must be projected into the future margin', () => {
    expect(chartSource).toContain('const coordinateToFractionalLogical = (x: number): number | null => {');
    expect(chartSource).toContain('time = projectDrawingTimeAtLogical(');
    expect(chartSource).toContain('drawingLogical ?? undefined,');
  });
});
