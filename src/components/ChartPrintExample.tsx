/**
 * Chart Print Example
 * Demonstrates how to integrate chart printing functionality
 */

import { Icon } from './ui/Icon';
import { useChartPrint } from '../hooks/useChartPrint';
import { PrintSetupDialog } from './dialogs/PrintSetupDialog';
import { PrintPreviewDialog } from './dialogs/PrintPreviewDialog';
import type { IChartApi } from 'lightweight-charts';

interface ChartPrintExampleProps {
  symbol: string;
  timeframe: string;
  chartApi?: IChartApi | null;
  accountId?: string;
}

/**
 * Example component showing how to add print functionality to a chart
 *
 * Usage:
 * ```tsx
 * <ChartPrintExample
 *   symbol="EURUSD"
 *   timeframe="1H"
 *   chartApi={chartApiRef.current}
 *   accountId={currentAccountId}
 * />
 * ```
 */
export function ChartPrintExample({
  symbol,
  timeframe,
  chartApi,
  accountId,
}: ChartPrintExampleProps) {
  const {
    showSetupDialog,
    showPreviewDialog,
    printPreferences,
    chartData,
    openPrintSetup,
    handleSetupComplete,
    handleDirectPrint,
    closeDialogs,
  } = useChartPrint({
    accountId,
    symbol,
    timeframe,
    chartApi,
    // Optional: provide functions to get indicators and drawings
    getIndicators: () => {
      // Return array of indicators currently displayed on the chart
      // Example: return indicatorManager.getActiveIndicators();
      return [
        { name: 'EMA', parameters: { period: 20 } },
        { name: 'RSI', parameters: { period: 14 } },
      ];
    },
    getDrawings: () => {
      // Return array of drawings currently on the chart
      // Example: return drawingManager.getActiveDrawings();
      return [
        { type: 'TREND_LINE', label: 'Trend Line 1' },
        { type: 'HORIZONTAL_LINE', label: 'Support' },
      ];
    },
  });

  return (
    <>
      {/* Print Button */}
      <button
        onClick={openPrintSetup}
        className="flex items-center gap-2 px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-white text-sm rounded transition-colors"
        title="Print Chart"
      >
        <Icon name="print" size="md" />
        <span>Print</span>
      </button>

      {/* Print Setup Dialog */}
      {showSetupDialog && (
        <PrintSetupDialog
          onConfirm={handleSetupComplete}
          onCancel={closeDialogs}
          accountId={accountId}
        />
      )}

      {/* Print Preview Dialog */}
      {showPreviewDialog && chartData && printPreferences && (
        <PrintPreviewDialog
          onClose={closeDialogs}
          chartData={chartData}
          preferences={printPreferences}
          onPrint={handleDirectPrint}
        />
      )}
    </>
  );
}
