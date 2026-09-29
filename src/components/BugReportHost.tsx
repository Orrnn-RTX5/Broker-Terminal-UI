import { useEffect, useState } from 'react';

import { BugReportDialog } from './BugReportDialog';
import type { BugReportTradingContext } from '../services/bugReportService';
import { getActiveChartSource } from '../services/activeChartSource';
import { useMarketDataStore } from '../store/useMarketDataStore';
import { useWebSocketStore } from '../store/useWebSocketStore';
import { getCanonicalTickTimestamp } from '../utils/liveTickSemantics';

/** Event the Help menu dispatches to open the dialog. */
const BUG_REPORT_EVENT = 'rtx5:open-bug-report';

const collectBugReportContext = (context: BugReportTradingContext = {}): BugReportTradingContext => {
    const chart = getActiveChartSource();
    const symbol = context.symbol || chart?.symbol;
    const currentTick = symbol
        ? useMarketDataStore.getState().symbolData[symbol.toUpperCase()]?.currentTick
        : null;
    const tickTimestamp = currentTick ? getCanonicalTickTimestamp(currentTick) : null;
    return {
        ...context,
        symbol,
        timeframe: context.timeframe || chart?.timeframe,
        connectionState: context.connectionState || useWebSocketStore.getState().connectionState,
        quoteAgeMs: context.quoteAgeMs ?? (tickTimestamp === null ? undefined : Math.max(0, Date.now() - tickTimestamp)),
    };
};

export function BugReportHost() {
    const [open, setOpen] = useState(false);
    const [context, setContext] = useState<BugReportTradingContext>({});

    useEffect(() => {
        const onOpen = (event: Event) => {
            const detail = (event as CustomEvent<BugReportTradingContext>).detail || {};
            setContext(collectBugReportContext(detail));
            setOpen(true);
        };
        window.addEventListener(BUG_REPORT_EVENT, onOpen);
        return () => window.removeEventListener(BUG_REPORT_EVENT, onOpen);
    }, []);

    return <BugReportDialog isOpen={open} onClose={() => setOpen(false)} context={context} />;
}

export default BugReportHost;
