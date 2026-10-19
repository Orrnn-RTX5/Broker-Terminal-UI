import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ModifyPositionDialog } from './ModifyPositionDialog';
import { commitBrokerAccountSessionScope } from '../services/brokerSession';

const mocks = vi.hoisted(() => ({
  modifyPendingOrder: vi.fn(),
  getPendingOrders: vi.fn(),
  setOrders: vi.fn(),
  setPositions: vi.fn(),
  positions: [] as any[],
  tick: {
    symbol: 'BTCUSD', bid: 81754.9, ask: 81755.1, spread: 2,
    timestamp: 1_797_341_377_000,
  },
}));

vi.mock('../store/useMarketDataStore', () => ({
  useCurrentTick: () => mocks.tick,
}));

vi.mock('../store/useAppStore', () => ({
  useAppStore: {
    getState: () => ({
      positions: mocks.positions,
      accountId: '200313',
      setPositions: mocks.setPositions,
      setOrders: mocks.setOrders,
    }),
  },
}));

vi.mock('../services/api', () => ({
  default: {
    orders: {
      modifyPendingOrder: mocks.modifyPendingOrder,
      getPendingOrders: mocks.getPendingOrders,
    },
    positions: {
      closePosition: vi.fn(),
      modifyPosition: vi.fn(),
    },
  },
}));

const pendingPosition = {
  id: 34671,
  symbol: 'BTCUSD',
  side: 'BUY' as const,
  volume: 0.01,
  openPrice: 81754.9,
  sl: 0,
  tp: 0,
};

describe('ModifyPositionDialog pending-order', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.positions = [];
    mocks.modifyPendingOrder.mockResolvedValue({ ticket: 34671 });
    mocks.getPendingOrders.mockResolvedValue([]);
    localStorage.clear();
    sessionStorage.clear();
    commitBrokerAccountSessionScope({
      authenticated: true,
      accountId: '200313',
      brokerId: 'broker-a',
      serverUrl: 'https://broker.example',
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('edits price/SL/TP/expiry and sends identity without comment or trailing fields', async () => {
    render(
      <ModifyPositionDialog
        isOpen
        onClose={() => {}}
        position={pendingPosition}
        kind="pending-order"
      />,
    );

    expect(screen.getByText('Modify Pending Order')).toBeTruthy();

    const priceInput = document.getElementById('modify-position-34671-price') as HTMLInputElement;
    const expiryInput = document.getElementById('modify-position-34671-expiry') as HTMLInputElement;
    expect(priceInput).toBeTruthy();
    expect(expiryInput).toBeTruthy();

    fireEvent.change(priceInput, { target: { value: '81700.5' } });
    fireEvent.change(expiryInput, { target: { value: '1792504500' } });

    const slInput = document.getElementById('modify-position-34671-sl') as HTMLInputElement;
    fireEvent.change(slInput, { target: { value: '81600' } });

    fireEvent.click(screen.getByRole('button', { name: /modify #34671/i }));

    await waitFor(() => {
      expect(mocks.modifyPendingOrder).toHaveBeenCalledTimes(1);
    });
    const [ticket, payload] = mocks.modifyPendingOrder.mock.calls[0] as any;
    expect(ticket).toBe(34671);
    expect(payload.price).toBe(81700.5);
    expect(payload.price_sl).toBe(81600);
    // Identity UUID is attached by the API normalizer (covered in
    // endpoints.pending-order.test.ts), not by the dialog.
    expect(payload.comment).toBeUndefined();
    expect(payload.trailing_stop).toBeUndefined();
    expect(payload.trailing_step).toBeUndefined();
    expect(payload.expiry).toBe(1792504500);
  });

  it('refreshes the pending list from the backend after modify', async () => {
    mocks.getPendingOrders.mockResolvedValue([{ ticket: 34671, symbol: 'BTCUSD' }]);
    render(
      <ModifyPositionDialog
        isOpen
        onClose={() => {}}
        position={pendingPosition}
        kind="pending-order"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /modify #34671/i }));

    await waitFor(() => {
      expect(mocks.getPendingOrders).toHaveBeenCalledWith(200313);
    });
    expect(mocks.setOrders).toHaveBeenCalledTimes(1);
  });

  it('requires a positive price for pending modify', async () => {
    render(
      <ModifyPositionDialog
        isOpen
        onClose={() => {}}
        position={pendingPosition}
        kind="pending-order"
      />,
    );

    const priceInput = document.getElementById('modify-position-34671-price') as HTMLInputElement;
    fireEvent.change(priceInput, { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: /modify #34671/i }));

    await waitFor(() => {
      expect(screen.getByText('Enter a valid order price')).toBeTruthy();
    });
    expect(mocks.modifyPendingOrder).not.toHaveBeenCalled();
  });
});
