// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BottomDock } from './BottomDock';
import { useAppStore } from '../store/useAppStore';
import { normalizePosition, readPositionStreamBatch, reconcilePositionStreamBatch } from '../services/positionStream';

describe('Trade table across symbol updates', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('rtx_saved_username', '200001');
    useAppStore.setState({ isAuthenticated: true, accountId: '200001', authToken: 'test-token', positions: [
      normalizePosition({ ticket: 20165, symbol: 'XAUUSD', side: 'buy', volume: 0.01, price_open: 4291.06, price_current: 4329.06, profit: 38 }),
      normalizePosition({ ticket: 20166, symbol: 'BTCUSD', side: 'sell', volume: 0.02, price_open: 110000, price_current: 109900, profit: 2 }),
    ] });
  });
  afterEach(() => {
    cleanup();
    useAppStore.setState({ isAuthenticated: false, accountId: null, authToken: null, positions: [] });
    localStorage.clear();
  });

  it('keeps both symbols visible in the real Trade tab as each symbol changes', () => {
    render(<BottomDock height={300} onClosePosition={vi.fn()} onModifyPosition={vi.fn()} />);
    expect(screen.getByText('20165')).toBeInTheDocument();
    expect(screen.getByText('20166')).toBeInTheDocument();
    for (const [ticket, symbol] of [[20165, 'XAUUSD'], [20166, 'BTCUSD']] as const) {
      act(() => {
        const batch = readPositionStreamBatch({ channel: 'positions.200001', data: { type: 'pnl_update', symbol, positions: [{ ticket, price_current: 4350, profit: 12 }] } })!;
        useAppStore.getState().setPositions(reconcilePositionStreamBatch(useAppStore.getState().positions, batch).positions);
      });
      expect(screen.getByText('20165')).toBeInTheDocument();
      expect(screen.getByText('20166')).toBeInTheDocument();
      expect(screen.getByText('XAUUSD')).toBeInTheDocument();
      expect(screen.getByText('BTCUSD')).toBeInTheDocument();
    }
  });
});
