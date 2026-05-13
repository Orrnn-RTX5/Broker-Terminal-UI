import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import api from '../services/api';

const PENDING_CLOSURES = new Set<number>();

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
                if (!pos.id || PENDING_CLOSURES.has(pos.id)) return;

                // Only check if we actually have SL or TP defined locally or from server
                if ((!pos.sl || pos.sl === 0) && (!pos.tp || pos.tp === 0)) return;

                const symbolStr = (pos.symbol || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
                
                // O(1) lookup against normalized dictionary
                const tick = ticks[pos.symbol] || normalizedTicks[symbolStr];

                if (!tick) return;

                // Handle string variation of Side/Action mappings ('BUY', 'buy', 0)
                const isBuy = String(pos.side || '').toLowerCase() === 'buy';
                
                const livePrice = isBuy ? tick.bid : tick.ask;

                let shouldClose = false;
                let reason = '';

                if (isBuy) {
                    if (pos.tp > 0 && livePrice >= pos.tp) { shouldClose = true; reason = 'TP (Profit)'; }
                    if (pos.sl > 0 && livePrice <= pos.sl) { shouldClose = true; reason = 'SL (Loss)'; }
                } else {
                    if (pos.tp > 0 && livePrice <= pos.tp) { shouldClose = true; reason = 'TP (Profit)'; }
                    if (pos.sl > 0 && livePrice >= pos.sl) { shouldClose = true; reason = 'SL (Loss)'; }
                }

                if (shouldClose) {
                    console.log(`[AutoClose] Triggered ${reason} for ticket ${pos.id} at live price ${livePrice}`);
                    PENDING_CLOSURES.add(pos.id);
                    
                    api.positions.closePosition(String(pos.id))
                        .then(() => {
                            console.log(`[AutoClose] Successfully closed ticket ${pos.id}`);
                            // Force an instant reactive update across the UI layer
                            useAppStore.getState().setPositions(useAppStore.getState().positions.filter(p => p.id !== pos.id));
                            window.dispatchEvent(new Event('rtx:force-refresh-positions'));
                            import('../utils/audio').then(m => {
                                if (m.playSystemSound) m.playSystemSound('close');
                            }).catch(() => {});
                        })
                        .catch(err => {
                            console.error(`[AutoClose] Failed to close ticket ${pos.id}:`, err);
                        })
                        .finally(() => {
                            // Release the lock after a few seconds in case it failed so we can retry later
                            setTimeout(() => PENDING_CLOSURES.delete(pos.id), 5000);
                        });
                }
            });
        }, intervalMs);

        return () => {
            clearInterval(intervalId);
            isRunning.current = false;
        };
    }, [intervalMs]);
}
