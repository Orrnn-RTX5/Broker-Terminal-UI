import { onCommittedBrokerAccountSessionScopeChange, onSessionChange } from './brokerSession';
import { getQuoteSocketManager } from './quoteSocketManager';

/** Own close quotes until execution settles, even after optimistic row removal. */
export function retainPositionCloseQuotes(sourceId: string, symbols: readonly string[]): {
  addSymbols: (symbols: readonly string[]) => void;
  release: () => void;
} {
  const manager = getQuoteSocketManager();
  const retainedSymbols = new Set<string>();
  let released = false;
  let ownsDemand = false;
  let unsubscribe: (() => void) | undefined;
  let unsubscribeScope: (() => void) | undefined;

  const release = (): void => {
    if (released) return;
    released = true;
    retainedSymbols.clear();
    unsubscribe?.();
    unsubscribe = undefined;
    unsubscribeScope?.();
    unsubscribeScope = undefined;
    if (ownsDemand) {
      ownsDemand = false;
      manager.removeDemand(sourceId);
    }
  };

  const addSymbols = (additionalSymbols: readonly string[]): void => {
    if (released) return;
    const previousSize = retainedSymbols.size;
    for (const symbol of additionalSymbols) {
      const normalized = symbol.trim().toUpperCase();
      if (normalized) retainedSymbols.add(normalized);
    }
    if (retainedSymbols.size === previousSize) return;
    // setDemand can mutate its demand map before opening the socket fails.
    // Claim cleanup ownership before calling it so either failure is removed.
    ownsDemand = true;
    try {
      manager.setDemand(sourceId, Array.from(retainedSymbols).sort());
    } catch (error) {
      try { release(); } catch { /* Preserve the original registration error. */ }
      throw error;
    }
  };

  unsubscribe = onSessionChange((reason) => {
    if (reason !== 'token_rotation') release();
  });
  unsubscribeScope = onCommittedBrokerAccountSessionScopeChange(release);
  addSymbols(symbols);
  return { addSymbols, release };
}
