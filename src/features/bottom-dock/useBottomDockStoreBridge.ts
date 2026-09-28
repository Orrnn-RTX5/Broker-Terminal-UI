import { useEffect, useRef, useState } from 'react';
import { useAppStore, type Account, type Position } from '../../store/useAppStore';

const accountSignature = (account: Account | null | undefined): string => (
  account ? JSON.stringify(account) : ''
);

const positionsSignature = (positions: readonly Position[]): string => positions
  .map(position => [
    position.id,
    position.symbol,
    position.side,
    position.volume,
    position.openPrice,
    position.openTime,
    position.sl,
    position.tp,
    position.currentPrice,
    position.swap,
    position.commission,
    position.unrealizedPnL,
    position.comment,
  ].join('-'))
  .join('|');

/**
 * Isolates the lightweight account/position subscription used by retained
 * dock tabs. Keeping this bridge below DockWorkspace prevents live trade
 * updates from repainting the chart workspace.
 */
export const useBottomDockStoreBridge = (): {
  account: Account | null;
  positions: Position[];
} => {
  const [account, setAccount] = useState<Account | null>(
    () => useAppStore.getState().account ?? null,
  );
  const [positions, setPositions] = useState<Position[]>(
    () => useAppStore.getState().positions,
  );
  const cachedAccountSignature = useRef('');
  const cachedPositionsSignature = useRef('');

  useEffect(() => {
    let lastFired = 0;
    let pending: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      const state = useAppStore.getState();
      const nextAccountSignature = accountSignature(state.account);
      const nextPositionsSignature = positionsSignature(state.positions ?? []);
      if (nextAccountSignature !== cachedAccountSignature.current) {
        cachedAccountSignature.current = nextAccountSignature;
        setAccount(state.account ?? null);
      }
      if (nextPositionsSignature !== cachedPositionsSignature.current) {
        cachedPositionsSignature.current = nextPositionsSignature;
        setPositions(state.positions);
      }
    };

    const unsubscribe = useAppStore.subscribe((state, previous) => {
      if (state.account === previous.account && state.positions === previous.positions) return;
      const now = Date.now();
      const remaining = 50 - (now - lastFired);
      if (remaining <= 0) {
        lastFired = now;
        flush();
      } else if (!pending) {
        pending = setTimeout(() => {
          lastFired = Date.now();
          pending = null;
          flush();
        }, remaining);
      }
    });

    return () => {
      unsubscribe();
      if (pending) clearTimeout(pending);
    };
  }, []);

  return { account, positions };
};
