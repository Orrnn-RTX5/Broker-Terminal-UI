import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');

describe('App market-order feedback source contract', () => {
  it('reports blocked and rejected quick orders without a blocking browser alert', () => {
    expect(source).toContain("const ORDER_FEEDBACK_EVENT = 'rtx:order-feedback'");
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
    expect(source).toContain('openOrderPanelForSymbol(detail?.symbol);');
    expect(source).toContain('const submitSymbol = getAllowedSymbol(requestedOrderPanelSymbol);');
  });

  it('keeps concurrent feedback visible for a full timeout window', () => {
    // A new id remounts the toast, which restarts its own full lifetime timer.
    expect(source).toContain('feedbackToastSeqRef.current += 1;');
    expect(source).toContain('key={feedbackToast.id}');
    expect(source).toContain('onDismiss={() => dismissFeedbackToast(feedbackToast.id)}');
  });

  it('publishes a structured execution report for bulk closes', () => {
    expect(source).toContain('closeReportRows.push(...buildPositionCloseReportRows(candidates));');
    expect(source).toContain('const closeReport = buildPositionCloseReport({');
    expect(source).toContain("displayToast(detail.messageParts ?? detail.message, detail.type || 'error', detail.report);");
  });
});
