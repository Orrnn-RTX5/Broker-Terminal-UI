import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAppStore } from '../../../store/useAppStore';
import { setToken, removeToken } from '../../../api/client';
import { PendingOrdersPanel, toPendingOrderView } from './PendingOrdersPanel';

vi.mock('../../../store/useConfirmStore', () => ({
  useConfirmStore: {
    getState: () => ({
      showConfirm: vi.fn().mockResolvedValue(true),
    }),
  },
}));

// Real backend row shape: GET /api/v2/orders/pending/{login} (handlers/pending.go:
// ticket/account_login/symbol/type/volume/price(_decimal)/price_sl/price_tp/
// sl_decimal/tp_decimal/status/time_setup/state_version/time_expiry/...).
const BACKEND_ROWS = [
  {
    ticket_text: '34671', execution_owner: 'internal_fix',
    ticket: 34671, account_login: 200313, symbol: 'BTCUSD',
    type: 'buy_limit', volume: 0.01, price: 81754.9,
    price_decimal: '81754.9', sl_decimal: null, tp_decimal: null,
    price_limit_decimal: null, status: 'pending', time_setup: 1792418000,
    state_version: '1', exact_modify_available: false,
    price_limit: null, trigger_phase: null, trigger_phase_version: null,
  },
  {
    ticket_text: '34672', execution_owner: 'internal_fix',
    ticket: 34672, account_login: 200313, symbol: 'EURUSD',
    type: 'sell_stop', volume: 0.02, price: 1.0845,
    price_decimal: '1.0845', sl_decimal: '1.0900', tp_decimal: '1.0800',
    price_sl: 1.09, price_tp: 1.08,
    price_limit_decimal: null, status: 'pending', time_setup: 1792418100,
    time_expiry: 1792504500, state_version: '2', exact_modify_available: false,
    price_limit: null, trigger_phase: null, trigger_phase_version: null,
  },
];

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

describe('PendingOrdersPanel (real store + backend shapes)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([])));
    localStorage.clear();
    sessionStorage.clear();
    removeToken();
    setToken('test-access-token');
    (window as any).__RTX_RUNTIME_CONFIG__ = {
      BACKEND_TARGET: 'web', API_HOST: 'https://broker.example', WS_HOST: 'wss://broker.example',
      BROKER_ID: 'Fixture', DEFAULT_MT5_SERVER: 'Fixture-Live',
    };
    localStorage.setItem('server_url', 'https://broker.example');
    localStorage.setItem('broker_id', 'Fixture');
    act(() => {
      useAppStore.getState().setOrders(BACKEND_ROWS as any);
      useAppStore.setState({ accountId: '200313' });
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    removeToken();
    delete (window as any).__RTX_RUNTIME_CONFIG__;
    act(() => {
      useAppStore.getState().setOrders([]);
    });
  });

  it('maps backend rows to views without mirrored logic', () => {
    const view = toPendingOrderView(BACKEND_ROWS[0] as unknown as Record<string, any>);
    expect(view).toMatchObject({
      ticket: 34671, symbol: 'BTCUSD', orderType: 'buy_limit', side: 'BUY',
      volume: 0.01, price: 81754.9, sl: 0, tp: 0, status: 'pending',
    });
    const sell = toPendingOrderView(BACKEND_ROWS[1] as unknown as Record<string, any>);
    expect(sell).toMatchObject({ ticket: 34672, side: 'SELL', sl: 1.09, tp: 1.08, expiry: 1792504500 });
    expect(toPendingOrderView({} as any)).toBeNull();
  });

  it('lists live pending orders with modify/cancel actions', () => {
    const onModify = vi.fn();
    const onCancel = vi.fn();
    render(<PendingOrdersPanel onModifyOrder={onModify} onCancelOrder={onCancel} />);

    expect(screen.getByText('34671')).toBeTruthy();
    expect(screen.getByText('34672')).toBeTruthy();
    expect(screen.getByText('buy_limit')).toBeTruthy();
    expect(screen.getByText('sell_stop')).toBeTruthy();

    const row = screen.getByText('34671').closest('tr')!;
    fireEvent.click(row.querySelectorAll('button')[0]);
    expect(onModify).toHaveBeenCalledTimes(1);
    expect(onModify.mock.calls[0][0]).toMatchObject({ ticket: 34671, symbol: 'BTCUSD', side: 'BUY' });

    fireEvent.click(row.querySelectorAll('button')[1]);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledWith(34671);
  });

  it('cancel-all cancels each resting order then refreshes from the backend', async () => {
    const onModify = vi.fn();
    const onCancel = vi.fn().mockResolvedValue(undefined);

    render(<PendingOrdersPanel onModifyOrder={onModify} onCancelOrder={onCancel} />);
    fireEvent.click(screen.getByText('Cancel All'));

    await waitFor(() => {
      expect(onCancel).toHaveBeenCalledTimes(2);
    });
    expect(onCancel).toHaveBeenNthCalledWith(1, 34671);
    expect(onCancel).toHaveBeenNthCalledWith(2, 34672);
    // Refresh: the panel re-reads the list and replaces store rows.
    await waitFor(() => {
      expect(useAppStore.getState().orders).toEqual([]);
    });
  });

  it('single-row cancel refreshes from the backend and surfaces failures', async () => {
    const onModify = vi.fn();
    const onCancel = vi.fn().mockResolvedValue(undefined);

    const { rerender } = render(<PendingOrdersPanel onModifyOrder={onModify} onCancelOrder={onCancel} />);
    const row = screen.getByText('34671').closest('tr')!;
    fireEvent.click(row.querySelectorAll('button')[1]);

    await waitFor(() => {
      expect(onCancel).toHaveBeenCalledWith(34671);
    });
    await waitFor(() => {
      expect(useAppStore.getState().orders).toEqual([]);
    });

    // A failing cancel shows a user-visible error and keeps the row.
    act(() => {
      useAppStore.getState().setOrders(BACKEND_ROWS as any);
    });
    onCancel.mockRejectedValueOnce(new Error('broker refused cancel'));
    rerender(<PendingOrdersPanel onModifyOrder={onModify} onCancelOrder={onCancel} />);
    fireEvent.click(screen.getByText('34672').closest('tr')!.querySelectorAll('button')[1]);

    await waitFor(() => {
      expect(screen.getByText('broker refused cancel')).toBeTruthy();
    });
    expect(useAppStore.getState().orders).toHaveLength(2);
  });

  it('shows the empty state when no pendings rest', () => {
    act(() => {
      useAppStore.getState().setOrders([]);
    });
    render(<PendingOrdersPanel onModifyOrder={vi.fn()} onCancelOrder={vi.fn()} />);
    expect(screen.getByText('No pending orders')).toBeTruthy();
  });
});
