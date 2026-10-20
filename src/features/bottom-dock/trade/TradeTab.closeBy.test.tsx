// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TradeTab } from './TradeTab';
import { useAppStore } from '../../../store/useAppStore';
import { useConfirmStore } from '../../../store/useConfirmStore';
import { ORDER_FEEDBACK_EVENT } from '../../../contracts/terminalEvents';
import type { OrderFeedbackDetail } from '../../../app/trading/orderFeedback';
import { removeToken, setToken } from '../../../api/client';
import { API_V2_BASE_URL, updateDynamicUrls } from '../../../config/api';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const jsonResponse = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });

const position = (overrides: Record<string, unknown>) => ({
  id: 2001,
  ticket: 2001,
  symbol: 'EURUSD',
  side: 'BUY',
  volume: 0.1,
  openPrice: 1.1,
  price_open: 1.1,
  price_current: 1.11,
  currentPrice: 1.11,
  hasBackendCurrentPrice: true,
  profit: 10,
  unrealizedPnL: 10,
  hasBackendProfit: true,
  openTime: '2026-09-21T10:00:00.000Z',
  time_create: '2026-09-21T10:00:00.000Z',
  sl: 0,
  tp: 0,
  swap: 0,
  commission: 0,
  state_version_text: '9007199254740993',
  ...overrides,
});

const LONG = position({ id: 2001, ticket: 2001, side: 'BUY', state_version_text: '9007199254740993' });
const SHORT = position({ id: 2002, ticket: 2002, side: 'SELL', price_current: 1.09, currentPrice: 1.09, profit: 5, unrealizedPnL: 5, state_version_text: '7' });

const renderTradeTab = (positions: Record<string, unknown>[]) => render(
  <TradeTab
    positions={positions as never}
    account={null}
    onClosePosition={vi.fn()}
    onModifyPosition={vi.fn()}
    formatMoney={(value) => String(value)}
    loading={false}
    error={null}
  />,
);

const openRowMenu = (ticketText: string) => {
  const row = screen.getByText(ticketText).closest('tr')!;
  fireEvent.contextMenu(row, { clientX: 120, clientY: 140 });
  expect(screen.getByRole('menu')).toBeInTheDocument();
};

describe('TradeTab close-by row menu', () => {
  let refreshedRows: unknown[];
  let closeByStatus: number;

  beforeEach(() => {
    refreshedRows = [];
    closeByStatus = 200;
    localStorage.clear();
    sessionStorage.clear();
    removeToken();
    (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__ = {
      BACKEND_TARGET: 'web', API_HOST: 'https://broker.example', WS_HOST: 'wss://broker.example',
      BROKER_ID: 'Fixture', DEFAULT_MT5_SERVER: 'Fixture-Live',
    };
    localStorage.setItem('server_url', 'https://broker.example');
    localStorage.setItem('broker_id', 'Fixture');
    updateDynamicUrls();
    setToken('test-access-token');

    useAppStore.setState({ accountId: '777001', positions: [LONG, SHORT] as never });

    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
      const target = String(url);
      if (target.endsWith('/positions/close-by')) {
        const sent = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        return closeByStatus === 200
          ? jsonResponse({ closed: sent.position_ticket, client_order_id: sent.client_order_id })
          : jsonResponse({ message: 'insufficient margin for close-by' }, { status: closeByStatus });
      }
      if (target.includes('/positions/777001')) return jsonResponse(refreshedRows);
      return jsonResponse({ ok: true });
    }));

    vi.spyOn(useConfirmStore.getState(), 'showConfirm').mockResolvedValue(true);
  });

  afterEach(() => {
    cleanup();
    delete (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__;
    localStorage.clear(); sessionStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    useAppStore.setState({ accountId: null, positions: [] });
  });

  it('hides the Close-by item when no opposite-side same-symbol counterpart exists', () => {
    renderTradeTab([LONG]);
    openRowMenu('2001');

    expect(screen.getByRole('menu')).toHaveTextContent('Close Position');
    expect(screen.queryByText(/Close by #/)).toBeNull();
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('names the lowest-ticket counterpart and posts the backend DTO plus a UUID', async () => {
    const third = position({ id: 2009, ticket: 2009, side: 'SELL', state_version_text: '9' });
    renderTradeTab([LONG, SHORT, third]);
    openRowMenu('2001');

    fireEvent.click(screen.getByText('Close by #2002'));

    await waitFor(() => {
      const closeByCall = vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith('/positions/close-by'));
      expect(closeByCall).toBeDefined();
    });
    const closeByCall = vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith('/positions/close-by'))!;
    expect(String(closeByCall[0])).toBe(`${API_V2_BASE_URL}/positions/close-by`);
    const body = JSON.parse(String((closeByCall[1] as RequestInit)?.body)) as Record<string, unknown>;
    // Exact backend DTO (DisallowUnknownFields rejects the old shape).
    expect(body).toEqual({
      client_order_id: expect.stringMatching(UUID_V4),
      account_login: 777001,
      position_ticket: '2001',
      other_position_ticket: '2002',
      expected_state_version: '9007199254740993',
      other_expected_state_version: '7',
    });
  });

  it('requests an authoritative positions refresh after a confirmed close-by', async () => {
    const refreshRequests: Event[] = [];
    const listener = (event: Event) => refreshRequests.push(event);
    window.addEventListener('rtx:force-refresh-positions', listener);
    try {
      renderTradeTab([LONG, SHORT]);
      openRowMenu('2002');

      fireEvent.click(screen.getByText('Close by #2001'));

      // The controller owns the refresh (and the store-shape mapping); the
      // tab only signals it — no direct setPositions, no casts.
      await waitFor(() => expect(refreshRequests).toHaveLength(1));
      expect(useConfirmStore.getState().showConfirm).toHaveBeenCalledWith(
        expect.stringContaining('#2002'),
        expect.stringContaining('#2001'),
        expect.objectContaining({ confirmLabel: 'Close by', danger: true }),
      );
    } finally {
      window.removeEventListener('rtx:force-refresh-positions', listener);
    }
  });

  it('sends nothing when the confirmation is declined', async () => {
    vi.mocked(useConfirmStore.getState().showConfirm).mockResolvedValueOnce(false);
    renderTradeTab([LONG, SHORT]);
    openRowMenu('2001');

    fireEvent.click(screen.getByText('Close by #2002'));

    await waitFor(() => expect(useConfirmStore.getState().showConfirm).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/positions/close-by'))).toBe(false);
    expect(useAppStore.getState().positions).toHaveLength(2);
  });

  it('surfaces a user-visible error when the backend rejects the close-by', async () => {
    closeByStatus = 500;
    refreshedRows = [
      { ticket: 2001, symbol: 'EURUSD', side: 'buy', volume: 0.1, price_open: 1.1 },
      { ticket: 2002, symbol: 'EURUSD', side: 'sell', volume: 0.1, price_open: 1.11 },
    ];
    const feedback: OrderFeedbackDetail[] = [];
    const listener = (event: Event) => { feedback.push((event as CustomEvent<OrderFeedbackDetail>).detail); };
    window.addEventListener(ORDER_FEEDBACK_EVENT, listener);
    try {
      renderTradeTab([LONG, SHORT]);
      openRowMenu('2001');

      fireEvent.click(screen.getByText('Close by #2002'));

      await waitFor(() => expect(feedback.length).toBeGreaterThan(0));
      expect(feedback[0].type).toBe('error');
      expect(feedback[0].message).toMatch(/Close by/);
    } finally {
      window.removeEventListener(ORDER_FEEDBACK_EVENT, listener);
    }
  });
});
