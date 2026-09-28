// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BottomDock } from './BottomDock';
import { markPositionsClosed, unmarkPositionsClosed, useAppStore } from '../store/useAppStore';
import {
  normalizePosition,
  readPositionStreamBatch,
  readPositionStreamEvent,
  reconcilePositionStreamBatch,
} from '../services/positionStream';
import { decodePositionStreamMessage } from '../services/tradePositionStream';

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
    useAppStore.getState().setPositions([]);
    unmarkPositionsClosed([20165, 20166]);
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

  it('removes a confirmed stream close and rejects a lagging snapshot for that ticket', () => {
    render(<BottomDock height={300} onClosePosition={vi.fn()} onModifyPosition={vi.fn()} />);

    const closeMessage = {
      channel: 'positions.200001',
      data: {
        type: 'position_closed',
        data: {
          ticket: 20166,
          account_login: 200001,
          status: 'closed',
          volume: 0.02,
          state_version: '1',
        },
      },
    };

    act(() => {
      const decoded = decodePositionStreamMessage(closeMessage);
      expect(decoded?.closedTickets).toEqual([20166]);
      markPositionsClosed(decoded?.closedTickets ?? []);

      const { position } = readPositionStreamEvent(closeMessage);
      const result = reconcilePositionStreamBatch(useAppStore.getState().positions, {
        mode: 'delta',
        positions: [{ ...position, closed: true }],
      });
      useAppStore.getState().setPositions(result.positions, { closedTickets: result.closedTickets });
    });

    expect(screen.queryByText('20166')).not.toBeInTheDocument();
    expect(screen.getByText('20165')).toBeInTheDocument();

    act(() => {
      const staleSnapshot = readPositionStreamBatch({
        channel: 'positions.200001',
        data: {
          type: 'positions_snapshot',
          data: {
            positions: [
              {
                ticket: 20165,
                symbol: 'XAUUSD',
                side: 'buy',
                volume: 0.01,
                price_open: 4291.06,
                state_version: '0',
              },
              {
                ticket: 20166,
                symbol: 'BTCUSD',
                side: 'sell',
                volume: 0.02,
                price_open: 110000,
                state_version: '0',
              },
            ],
          },
        },
      });
      expect(staleSnapshot).not.toBeNull();
      const result = reconcilePositionStreamBatch(useAppStore.getState().positions, staleSnapshot!);
      useAppStore.getState().setPositions(result.positions, { closedTickets: result.closedTickets });
    });

    expect(screen.queryByText('20166')).not.toBeInTheDocument();
    expect(screen.getByText('20165')).toBeInTheDocument();
  });
});
