import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ORDER_FEEDBACK_EVENT } from './contracts/terminalEvents';

const source = [
  'src/App.tsx',
  'src/app/trading/orderFeedback.ts',
  'src/app/trading/useOrderExecution.ts',
  'src/app/ui/useTerminalCommandEvents.ts',
].map((path) => readFileSync(resolve(process.cwd(), path), 'utf8')).join('\n');

describe('App market-order feedback source contract', () => {
  it('reports blocked and rejected quick orders without a blocking browser alert', () => {
    expect(ORDER_FEEDBACK_EVENT).toBe('rtx:order-feedback');
    expect(source).toContain('window.addEventListener(ORDER_FEEDBACK_EVENT, handleOrderFeedback)');
    expect(source).toContain('publishOrderFeedback(formatOrderError(err))');
    expect(source).not.toContain('alert(formatOrderError(err))');
    expect(source).not.toContain('alert(getMarketStatusTradeBlockMessage');
  });

  it('never substitutes a different order-panel symbol when the requested quote is unavailable', () => {
    expect(source).toContain(
      'const requestedOrderPanelSymbol = normalizeSymbolName(order.symbol || orderPanelSymbol);',
    );
    expect(source).toContain('const submitSymbol = getAllowedSymbol(requestedOrderPanelSymbol);');
    expect(source).not.toContain(
      'getAllowedSymbol(order.symbol) || getAllowedSymbol(orderPanelSymbol)',
    );
  });

  it('opens New Order for the requested or active chart without weakening submit validation', () => {
    expect(source).toContain('const openOrderPanelForSymbol = useCallback((');
    expect(source).toContain('getActiveChartCommandTarget(selectedSymbol, timeframe).symbol');
    expect(source).toContain(
      'const dialogSymbol = getChartEligibleSymbol(targetSymbol) || getAllowedSymbol(targetSymbol);',
    );
    expect(source).toContain('setOrderPanelOpen(true);');
    expect(source).toContain('openOrderPanelForSymbol(event.detail?.symbol, undefined, event.detail?.draft)) as EventListener');
    expect(source).toContain('const submitSymbol = getAllowedSymbol(requestedOrderPanelSymbol);');
  });

  it('keeps concurrent feedback visible for a full timeout window', () => {
    // A new id remounts the toast, which restarts its own full lifetime timer.
    expect(source).toContain('feedbackToastSeqRef.current += 1;');
    expect(source).toContain('key={feedbackToast.id}');
    expect(source).toContain('onDismiss={() => dismissFeedbackToast(feedbackToast.id)}');
  });

  it('never renders a completed position-close receipt as a second action sheet', () => {
    const listenerStart = source.indexOf('const handleOrderFeedback = (event: Event) => {');
    const listenerEnd = source.indexOf('window.addEventListener(ORDER_FEEDBACK_EVENT', listenerStart);
    const listener = source.slice(listenerStart, listenerEnd);

    expect(listenerStart).toBeGreaterThan(-1);
    expect(listenerEnd).toBeGreaterThan(listenerStart);
    expect(listener).not.toContain("detail.report?.scope === 'SINGLE'");
    expect(listener).toContain("detail.type === 'success'");
    expect(listener).toContain('getPositionCloseOutcome(detail.report)');
    expect(listener.indexOf('if (')).toBeLessThan(listener.indexOf('displayToast('));
    expect(listener).toContain('// Close execution details are never rendered as a second modal sheet.');
    expect(listener).toContain('undefined,');
  });

  it('forwards structured compact-notice details without breaking the legacy message contract', () => {
    expect(source).toContain('notice?: ActionFeedbackNotice;');
    expect(source).toContain('message={feedbackToast.message}');
    expect(source).toContain('notice={feedbackToast.notice}');
  });
});
