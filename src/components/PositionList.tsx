/**
 * Position List Component
 * Displays open positions with real-time P&L updates
 */

import { Icon } from './ui/Icon';
import { useState, useMemo, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import type { Position } from '../store/useAppStore';

import api from '../services/api';

export const PositionList = () => {
  const positions = useAppStore(s => s.positions);
  const ticks = useAppStore(s => s.ticks);
  const accountId = useAppStore(s => s.accountId);
  // useRef Set for synchronous in-flight guard — prevents double-click spam
  const closingTicketsRef = useRef<Set<number>>(new Set());
  const [closingPositionId, setClosingPositionId] = useState<number | null>(null);
  const [modifyingPosition, setModifyingPosition] = useState<number | null>(null);
  const [newSL, setNewSL] = useState('');
  const [newTP, setNewTP] = useState('');

  // Calculate live P&L for each position
  const enrichedPositions = useMemo(() => {
    return positions.map((pos: Position) => {
      const tick = ticks[pos.symbol];
      if (!tick) return { ...pos, livePrice: pos.currentPrice, livePnL: pos.unrealizedPnL };

      // Use bid for long positions, ask for short positions
      const livePrice = pos.side === 'BUY' ? tick.bid : tick.ask;

      // Calculate P&L
      const priceDiff = pos.side === 'BUY'
        ? livePrice - pos.openPrice
        : pos.openPrice - livePrice;

      const pipValue = 10; // Simplified (actual calculation depends on symbol)
      const livePnL = priceDiff * pos.volume * 100000 / pipValue;

      return {
        ...pos,
        livePrice,
        livePnL: livePnL - (pos.commission + pos.swap),
      };
    });
  }, [positions, ticks]);

  const totalPnL = useMemo(() => {
    return enrichedPositions.reduce((sum: number, pos: { livePnL: number }) => sum + pos.livePnL, 0);
  }, [enrichedPositions]);

  const closePosition = async (positionId: number) => {
    if (!accountId) return;
    // Synchronous guard: prevent duplicate requests from rapid clicks
    if (closingTicketsRef.current.has(positionId)) return;
    closingTicketsRef.current.add(positionId);
    setClosingPositionId(positionId);
    // Optimistically remove from the app store immediately
    useAppStore.getState().setPositions(useAppStore.getState().positions.filter(p => p.id !== positionId));
    window.dispatchEvent(new Event('rtx:force-refresh-positions'));

    try {
      await api.positions.closePosition(String(positionId));
      console.log('Position closed successfully');
    } catch (error: any) {
      console.error('Close position error:', error);
    } finally {
      closingTicketsRef.current.delete(positionId);
      setClosingPositionId(null);
    }
  };

  const modifyPosition = async (positionId: number) => {
    if (!accountId) return;

    const sl = newSL ? parseFloat(newSL) : undefined;
    const tp = newTP ? parseFloat(newTP) : undefined;

    if (!sl && !tp) {
      alert('Please enter at least SL or TP');
      return;
    }

    try {
      await api.positions.modifyPosition(positionId, { price_sl: sl || 0, price_tp: tp || 0 });
      console.log('Position modified successfully');
      setModifyingPosition(null);
      setNewSL('');
      setNewTP('');
    } catch (error: any) {
      console.error('Modify position error:', error);
    }
  };

  const closeAllPositions = async () => {
    if (!accountId || positions.length === 0) return;

    if (!confirm(`Close all ${positions.length} positions?`)) return;

    try {
      // Optimistically remove all from the app store immediately
      useAppStore.getState().setPositions([]);
      window.dispatchEvent(new Event('rtx:force-refresh-positions'));

      await Promise.all(positions.map(pos =>
        api.positions.closePosition(String(pos.id))
      ));
      console.log('All positions closed');
    } catch (error: any) {
      console.error('Close all error:', error);
    }
  };

  const formatTime = (timeString: string) => {
    try {
      const date = new Date(timeString);
      return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return timeString;
    }
  };

  if (positions.length === 0) {
    return (
      <div className="p-6 text-center text-zinc-500">
        <Icon name="credit-card" size="sm" className="w-12 h-12 mx-auto mb-2 text-zinc-700" />
        <p>No open positions</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-zinc-800">
        <div>
          <h3 className="text-sm font-semibold text-white">Open Positions</h3>
          <p className="text-xs text-zinc-500">
            {positions.length} position{positions.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-xs text-zinc-500">Total P&L</div>
            <div
              className={`font-mono font-bold ${totalPnL >= 0 ? 'text-green-400' : 'text-red-400'
                }`}
            >
              {totalPnL >= 0 ? '+' : ''}${totalPnL.toFixed(2)}
            </div>
          </div>
          <button
            onClick={closeAllPositions}
            className="px-3 py-1.5 text-xs bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
          >
            Close All
          </button>
        </div>
      </div>

      {/* Position List */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-zinc-900 border-b border-zinc-800">
            <tr className="text-xs text-zinc-500 text-left">
              <th className="p-2">Symbol</th>
              <th className="p-2">Type</th>
              <th className="p-2">Volume</th>
              <th className="p-2">Open</th>
              <th className="p-2">Current</th>
              <th className="p-2">SL/TP</th>
              <th className="p-2">P&L</th>
              <th className="p-2">Time</th>
              <th className="p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {enrichedPositions.map((position: Position & { livePrice: number; livePnL: number }) => (
              <tr
                key={position.id}
                className="border-b border-zinc-800 hover:bg-zinc-900/50 transition-colors"
              >
                <td className="p-2 font-medium text-white">{position.symbol}</td>
                <td className="p-2">
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${position.side === 'BUY'
                      ? 'bg-green-900/30 text-green-400'
                      : 'bg-red-900/30 text-red-400'
                      }`}
                  >
                    {position.side === 'BUY' ? (
                      <Icon name="trending-up" size="sm" className="w-3 h-3" />
                    ) : (
                      <Icon name="trending-down" size="sm" className="w-3 h-3" />
                    )}
                    {position.side}
                  </span>
                </td>
                <td className="p-2 font-mono text-zinc-300">{position.volume.toFixed(2)}</td>
                <td className="p-2 font-mono text-zinc-400">
                  {position.openPrice.toFixed(5)}
                </td>
                <td className="p-2 font-mono text-white font-medium">
                  {position.livePrice.toFixed(5)}
                </td>
                <td className="p-2 text-xs text-zinc-500">
                  <div>{position.sl > 0 ? position.sl.toFixed(5) : '-'}</div>
                  <div>{position.tp > 0 ? position.tp.toFixed(5) : '-'}</div>
                </td>
                <td className="p-2">
                  <div
                    className={`font-mono font-bold ${position.livePnL >= 0 ? 'text-green-400' : 'text-red-400'
                      }`}
                  >
                    {position.livePnL >= 0 ? '+' : ''}${position.livePnL.toFixed(2)}
                  </div>
                  {(position.commission !== 0 || position.swap !== 0) && (
                    <div className="text-xs text-zinc-500">
                      C: ${position.commission.toFixed(2)} S: ${position.swap.toFixed(2)}
                    </div>
                  )}
                </td>
                <td className="p-2 text-xs text-zinc-500">
                  <Icon name="clock" size="sm" className="inline w-3 h-3 mr-1" />
                  {formatTime(position.openTime)}
                </td>
                <td className="p-2">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setModifyingPosition(position.id)}
                      className="p-1.5 hover:bg-zinc-800 rounded transition-colors"
                      title="Modify SL/TP"
                    >
                      <Icon name="edit" size="sm" className="w-3.5 h-3.5 text-blue-400" />
                    </button>
                    <button
                      onClick={() => closePosition(position.id)}
                      disabled={closingPositionId === position.id}
                      className="p-1.5 hover:bg-zinc-800 rounded transition-colors disabled:opacity-50"
                      title="Close Position"
                    >
                      <Icon name="x-close" size="sm" className="w-3.5 h-3.5 text-red-400" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modify Modal */}
      {modifyingPosition !== null && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-6 w-96">
            <h3 className="text-lg font-bold text-white mb-4">Modify Position</h3>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Stop Loss</label>
                <input
                  type="number"
                  step="0.00001"
                  value={newSL}
                  onChange={(e) => setNewSL(e.target.value)}
                  placeholder="Optional"
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-white focus:outline-none focus:border-zinc-600"
                />
              </div>

              <div>
                <label className="block text-xs text-zinc-400 mb-1">Take Profit</label>
                <input
                  type="number"
                  step="0.00001"
                  value={newTP}
                  onChange={(e) => setNewTP(e.target.value)}
                  placeholder="Optional"
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-white focus:outline-none focus:border-zinc-600"
                />
              </div>
            </div>

            <div className="flex gap-2 mt-6">
              <button
                onClick={() => modifyPosition(modifyingPosition)}
                className="flex-1 px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded font-medium transition-colors"
              >
                Update
              </button>
              <button
                onClick={() => {
                  setModifyingPosition(null);
                  setNewSL('');
                  setNewTP('');
                }}
                className="flex-1 px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded font-medium transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
