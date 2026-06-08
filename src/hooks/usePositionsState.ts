/**
 * usePositionsState — React hook for Section 4 (Account + Positions /ws/v2)
 *
 * Reads positions from Zustand store, fed by AccountSocketManager.
 * Provides computed helpers (total PnL, position count by symbol, etc.)
 *
 * Usage:
 *   const { positions, totalPnL, isConnected } = usePositionsState(100001);
 */

import { useMemo } from 'react';
import { useAppStore, type Position } from '../store/useAppStore';
import { useLiveAccountState } from './useLiveAccountState';

export function usePositionsState(login?: number | string | null) {
  const { isConnected, login: resolvedLogin } = useLiveAccountState(login);
  const positions = useAppStore((s) => s.positions);

  // Computed helpers
  const totalPnL = useMemo(
    () => positions.reduce((sum, p) => sum + (p.unrealizedPnL || 0), 0),
    [positions],
  );

  const positionCount = positions.length;

  const positionsBySymbol = useMemo(() => {
    const map = new Map<string, Position[]>();
    positions.forEach((p) => {
      const list = map.get(p.symbol) || [];
      list.push(p);
      map.set(p.symbol, list);
    });
    return map;
  }, [positions]);

  return {
    positions,
    totalPnL,
    positionCount,
    positionsBySymbol,
    isConnected,
    login: resolvedLogin,
  };
}
