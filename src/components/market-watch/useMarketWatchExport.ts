import { useCallback, useEffect, useRef } from 'react';
import { onCommittedBrokerAccountSessionScopeChange } from '../../services/brokerSession';
import {
  hydrateClosedMarketDailyChanges,
} from '../../hooks/useClosedMarketDailyChanges';
import {
  hydrateLastMarketWatchQuotes,
  type MarketWatchLastPrice,
} from '../../hooks/useLastMarketWatchQuotes';
import { getMarketWatchDisplayMetadata, resolveMarketWatchDisplayMetadata } from '../../store/useMarketWatchDisplayMetadataStore';
import { copyTextToClipboard } from '../../utils/tradeShareLink';
import { downloadMarketWatchCsv } from '../../utils/marketWatchExport';
import type { MarketWatchColumnId } from '../../utils/marketWatchView';
import type { ActionFeedbackNotice } from '../notifications/ActionFeedbackToast';
import { createMarketWatchExportSnapshot } from './marketWatchExportSnapshot';
import {
  getTickSnapshot,
  hasMarketWatchQuote,
  readFiniteDailyChange,
} from './marketWatchPanelModel';
import { resolveMarketWatchSymbolGroup } from '../../utils/marketWatchGroups';
import { waitForMarketWatchExportHydration } from './marketWatchExportHydration';

type Translate = (source: string, values?: Record<string, unknown>) => string;

type PublishFeedback = (
  message: string,
  type?: 'success' | 'error',
  notice?: ActionFeedbackNotice,
) => void;

interface UseMarketWatchExportOptions {
  activeSymbolSet: ReadonlySet<string>;
  brokerAccountScopeKey: string;
  canIdentifyClosedSymbols: boolean;
  /** Broker catalog price digits by normalized symbol. */
  catalogPriceDigits?: ReadonlyMap<string, number>;
  closedDailyChanges: ReadonlyMap<string, number>;
  dailyChangeScopeKey: string | null;
  displayedColumns: readonly MarketWatchColumnId[];
  getInstrumentSources?: (symbol: string) => readonly unknown[];
  isTraditionalMarketWeekend: boolean;
  lastPrices: ReadonlyMap<string, MarketWatchLastPrice>;
  publishFeedback: PublishFeedback;
  rows: readonly string[];
  showMilliseconds: boolean;
  symbolGroupKeyByName: ReadonlyMap<string, string>;
  translate: Translate;
}

/**
 * Owns the bounded Market Watch export transaction.
 *
 * The request is tied to the broker/account scope captured at invocation, so a
 * session change cannot publish or download data gathered for the old account.
 */
export const useMarketWatchExport = ({
  activeSymbolSet,
  brokerAccountScopeKey,
  canIdentifyClosedSymbols,
  catalogPriceDigits,
  closedDailyChanges,
  dailyChangeScopeKey,
  displayedColumns,
  getInstrumentSources,
  isTraditionalMarketWeekend,
  lastPrices,
  publishFeedback,
  rows,
  showMilliseconds,
  symbolGroupKeyByName,
  translate,
}: UseMarketWatchExportOptions): (() => Promise<void>) => {
  const exportAbortControllerRef = useRef<AbortController | null>(null);
  const latestBrokerAccountScopeKeyRef = useRef(brokerAccountScopeKey);
  latestBrokerAccountScopeKeyRef.current = brokerAccountScopeKey;

  const cancelActiveExport = useCallback(() => {
    const controller = exportAbortControllerRef.current;
    exportAbortControllerRef.current = null;
    controller?.abort();
  }, []);

  useEffect(() => {
    const unsubscribe = onCommittedBrokerAccountSessionScopeChange(cancelActiveExport);
    return () => {
      unsubscribe();
      cancelActiveExport();
    };
  }, [cancelActiveExport]);

  useEffect(() => () => {
    // Also covers injected/test scope owners that do not publish the session event.
    cancelActiveExport();
  }, [brokerAccountScopeKey, cancelActiveExport]);

  return useCallback(async () => {
    cancelActiveExport();
    const exportScopeKey = brokerAccountScopeKey;
    const controller = new AbortController();
    exportAbortControllerRef.current = controller;
    const isCurrentExport = () => (
      exportAbortControllerRef.current === controller
      && latestBrokerAccountScopeKeyRef.current === exportScopeKey
    );
    let exportLastPrices = lastPrices;
    let exportDailyChanges = closedDailyChanges;

    try {
      if (!isCurrentExport()) return;
      if (dailyChangeScopeKey) {
        const missingQuoteSymbols = rows.filter(
          (symbol) => !hasMarketWatchQuote(getTickSnapshot(symbol)),
        );
        const closedSymbols = (canIdentifyClosedSymbols || isTraditionalMarketWeekend)
          ? rows.filter((symbol) => {
            if (canIdentifyClosedSymbols && activeSymbolSet.has(symbol)) return false;
            const groupKey = symbolGroupKeyByName.get(symbol)
              ?? resolveMarketWatchSymbolGroup(symbol).key;
            return groupKey !== 'crypto';
          })
          : [];
        const dailySymbols = displayedColumns.includes('dailyChange')
          ? closedSymbols.filter((symbol) => {
            const display = resolveMarketWatchDisplayMetadata(
              getTickSnapshot(symbol),
              getMarketWatchDisplayMetadata(symbol),
            );
            return readFiniteDailyChange(display.dailyChange) === null;
          })
          : [];
        const hydrationOutcome = await waitForMarketWatchExportHydration(Promise.all([
          hydrateLastMarketWatchQuotes({
            scopeKey: dailyChangeScopeKey,
            symbols: missingQuoteSymbols,
            candleSymbols: closedSymbols,
            signal: controller.signal,
          }),
          hydrateClosedMarketDailyChanges({
            scopeKey: dailyChangeScopeKey,
            symbols: dailySymbols,
            signal: controller.signal,
          }),
        ]), controller);
        if (hydrationOutcome.status === 'aborted' || !isCurrentExport()) return;
        if (hydrationOutcome.status === 'complete') {
          const [hydratedPrices, hydratedDailyChanges] = hydrationOutcome.value;
          const mergedPrices = new Map(lastPrices);
          hydratedPrices.forEach((price, symbol) => {
            const current = mergedPrices.get(symbol);
            if (!current || price.asOf >= current.asOf) mergedPrices.set(symbol, price);
          });
          exportLastPrices = mergedPrices;
          exportDailyChanges = new Map([...closedDailyChanges, ...hydratedDailyChanges]);
        }
      }

      if (!isCurrentExport()) return;
      const { clipboardPayload, result: exportSnapshot } = createMarketWatchExportSnapshot({
        symbols: rows,
        columns: displayedColumns,
        closedDailyChanges: exportDailyChanges,
        lastPrices: exportLastPrices,
        showMilliseconds,
        getTick: getTickSnapshot,
        getInstrumentSources,
        catalogPriceDigits,
        translate,
      });
      const copied = await copyTextToClipboard(clipboardPayload);
      if (!isCurrentExport()) return;
      if (copied) {
        const message = translate('Market Watch exported to clipboard ({{value0}} symbols)', { value0: exportSnapshot.symbolCount });
        publishFeedback(message, 'success', {
          title: translate('Market Watch'),
          description: message,
          metaLabel: translate('Destination'),
          meta: translate('System clipboard'),
          metaIcon: 'copy',
          hint: translate('No file was created. Press Ctrl+V to paste into Excel or another app.'),
          exportResult: { destination: 'clipboard', ...exportSnapshot },
        });
        return;
      }

      try {
        downloadMarketWatchCsv(exportSnapshot.csv, exportSnapshot.fileName);
        const message = translate('Market Watch exported to CSV ({{value0}} symbols)', { value0: exportSnapshot.symbolCount });
        publishFeedback(message, 'success', {
          title: translate('Market Watch'),
          description: message,
          metaLabel: translate('Destination'),
          meta: translate('Browser download: {{value0}}', { value0: exportSnapshot.fileName }),
          metaIcon: 'download',
          exportResult: { destination: 'download', ...exportSnapshot },
        });
      } catch {
        publishFeedback(translate('Market Watch export failed'), 'error', {
          title: translate('Market Watch'),
          description: translate('Market Watch export failed'),
          meta: translate('Failed'),
          metaIcon: 'error',
          exportResult: { destination: 'failed', ...exportSnapshot },
        });
      }
    } finally {
      if (exportAbortControllerRef.current === controller) {
        exportAbortControllerRef.current = null;
      }
    }
  }, [
    activeSymbolSet,
    brokerAccountScopeKey,
    cancelActiveExport,
    canIdentifyClosedSymbols,
    catalogPriceDigits,
    closedDailyChanges,
    dailyChangeScopeKey,
    displayedColumns,
    getInstrumentSources,
    isTraditionalMarketWeekend,
    lastPrices,
    publishFeedback,
    rows,
    showMilliseconds,
    symbolGroupKeyByName,
    translate,
  ]);
};
