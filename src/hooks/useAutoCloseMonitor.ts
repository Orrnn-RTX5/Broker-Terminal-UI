import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';

const PENDING_REFRESHES = new Set<number>();

export function useAutoCloseMonitor(intervalMs = 500) {
    const isRunning = useRef(false);

    useEffect(() => {
        if (isRunning.current) return;
        isRunning.current = true;

        const intervalId = setInterval(() => {
            const appState = useAppStore.getState();
            const positions = appState.positions;
            const ticks = appState.ticks;

            // Pre-compute normalized ticks dictionary for ultra-fast fuzzy resolution
            const normalizedTicks: Record<string, any> = {};
            for (const key in ticks) {
                 const norm = key.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
                 normalizedTicks[norm] = ticks[key];
            }

            positions.forEach(pos => {
                if (!pos.id || PENDING_REFRESHES.has(pos.id)) return;

                // Only check if we actually have SL or TP defined locally or from server
                if ((!pos.sl || pos.sl === 0) && (!pos.tp || pos.tp === 0)) return;

                const symbolStr = (pos.symbol || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
                
                // O(1) lookup against normalized dictionary
                const tick = ticks[pos.symbol] || normalizedTicks[symbolStr];

                if (!tick) return;

                // Handle string variation of Side/Action mappings ('BUY', 'buy', 0)
                const isBuy = String(pos.side || '').toLowerCase() === 'buy';
                
                const livePrice = isBuy ? tick.bid : tick.ask;

                let shouldRefreshForCross = false;
                let reason = '';

                if (isBuy) {
                    if (pos.tp > 0 && livePrice >= pos.tp) { shouldRefreshForCross = true; reason = 'TP (Profit)'; }
                    if (pos.sl > 0 && livePrice <= pos.sl) { shouldRefreshForCross = true; reason = 'SL (Loss)'; }
                } else {
                    if (pos.tp > 0 && livePrice <= pos.tp) { shouldRefreshForCross = true; reason = 'TP (Profit)'; }
                    if (pos.sl > 0 && livePrice >= pos.sl) { shouldRefreshForCross = true; reason = 'SL (Loss)'; }
                }

                if (shouldRefreshForCross) {
                    console.log(`[SLTPRefresh] ${reason} crossed for ticket ${pos.id} at live price ${livePrice}; requesting server refresh`);
                    PENDING_REFRESHES.add(pos.id);

                    window.dispatchEvent(new Event('rtx:force-refresh-positions'));
                    const login = Number.parseInt(String(appState.accountId ?? ''), 10);
                    if (Number.isFinite(login) && login > 0) {
                        window.dispatchEvent(new CustomEvent('rtx:refresh-trade-history-requested', {
                            detail: { login },
                        }));
                    }

                    setTimeout(() => PENDING_REFRESHES.delete(pos.id), 5000);
                }
            });
        }, intervalMs);

        return () => {
            clearInterval(intervalId);
            isRunning.current = false;
        };
    }, [intervalMs]);
}
