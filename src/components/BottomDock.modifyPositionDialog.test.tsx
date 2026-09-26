// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BottomDock } from './BottomDock';
import { useAppStore } from '../store/useAppStore';
import {
  commitBrokerAccountSessionScope,
  getCommittedBrokerAccountSessionScope,
  getCommittedBrokerAccountSessionScopeKey,
} from '../services/brokerSession';

const trade = vi.hoisted(() => ({
  account: null,
  positions: [] as any[],
  pendingPositions: [] as any[],
  loading: false,
  error: null,
  login: 1,
  restBaseUrl: '',
  wsUrl: '',
  wsState: 'connected',
  lastRestAt: null as number | null,
  lastWsAt: null as number | null,
  debug: [],
  refresh: vi.fn(),
  removePosition: vi.fn(),
  removePositionsByMode: vi.fn(),
}));

vi.mock('../hooks/useToolboxTradeData', () => ({
  useToolboxTradeData: () => trade,
}));

// The dialog has its own behavior suite. This probe keeps this test focused on
// the Trade-table handoff while still exercising BottomDock's lazy dialog host.
vi.mock('./ModifyPositionDialog', () => ({
  ModifyPositionDialog: ({ isOpen, onClose, position }: any) => (
    isOpen && position ? (
      <div
        role="dialog"
        aria-label={`Modify Position #${position.id}`}
        data-ticket={String(position.id)}
        data-symbol={position.symbol}
        data-side={position.side}
        data-sl={String(position.sl)}
        data-tp={String(position.tp)}
      >
        <button type="button" onClick={() => onClose()}>Close test dialog</button>
      </div>
    ) : null
  ),
}));

const makePosition = (id: number, symbol: string, side: 'BUY' | 'SELL') => ({
  id,
  ticket: id,
  symbol,
  side,
  volume: 0.17,
  openPrice: 1.27456,
  currentPrice: 1.27501,
  hasBackendCurrentPrice: true,
  profit: 8.25,
  unrealizedPnL: 8.25,
  hasBackendProfit: true,
  openTime: '2026-09-25T08:30:00.000Z',
  sl: 1.26543,
  tp: 1.28976,
  swap: 0,
  commission: 0,
});

const renderDock = (onModifyPosition = vi.fn()) => render(
  <BottomDock
    height={300}
    onClosePosition={vi.fn()}
    onModifyPosition={onModifyPosition}
  />,
);

const currentScope = () => getCommittedBrokerAccountSessionScopeKey(
  getCommittedBrokerAccountSessionScope(),
);

describe('BottomDock SL/TP modify-position dialog handoff', () => {
  beforeEach(() => {
    localStorage.clear();
    trade.positions = [
      makePosition(91001, 'EURUSD', 'BUY'),
      makePosition(91002, 'GBPUSD', 'SELL'),
    ];
    trade.pendingPositions = [];
    useAppStore.setState({ positions: trade.positions });
    commitBrokerAccountSessionScope({
      authenticated: true,
      accountId: '77',
      brokerId: 'broker-a',
      serverUrl: 'https://broker.example',
    });
  });

  afterEach(() => {
    cleanup();
    useAppStore.setState({ positions: [] });
    commitBrokerAccountSessionScope({ authenticated: false, brokerId: '', serverUrl: '' });
    localStorage.clear();
    vi.clearAllMocks();
  });

  it.each([
    ['Stop Loss', '.rtx-trade-sl-cell'],
    ['Take Profit', '.rtx-trade-tp-cell'],
  ])('opens the existing dialog for the exact position from one %s click', async (_label, cellSelector) => {
    const user = userEvent.setup();
    const onModifyPosition = vi.fn();
    renderDock(onModifyPosition);

    const ticketCell = screen.getByText('91002', { selector: 'td' });
    const row = ticketCell.closest('tr');
    const levelButton = row?.querySelector<HTMLButtonElement>(`${cellSelector} button`);

    expect(row).not.toBeNull();
    expect(levelButton).not.toBeNull();
    await user.click(levelButton!);

    const dialog = await screen.findByRole('dialog', { name: 'Modify Position #91002' });
    expect(dialog).toHaveAttribute('data-ticket', '91002');
    expect(dialog).toHaveAttribute('data-symbol', 'GBPUSD');
    expect(dialog).toHaveAttribute('data-side', 'SELL');
    expect(dialog).toHaveAttribute('data-sl', '1.26543');
    expect(dialog).toHaveAttribute('data-tp', '1.28976');
    expect(onModifyPosition).not.toHaveBeenCalled();
  });

  it('opens from keyboard activation of the real S/L button', async () => {
    const user = userEvent.setup();
    const onModifyPosition = vi.fn();
    renderDock(onModifyPosition);

    const ticketCell = screen.getByText('91001', { selector: 'td' });
    const button = ticketCell.closest('tr')?.querySelector<HTMLButtonElement>('.rtx-trade-sl-value');
    expect(button).not.toBeNull();

    button!.focus();
    await user.keyboard('{Enter}');

    expect(await screen.findByRole('dialog', { name: 'Modify Position #91001' })).toBeInTheDocument();
    expect(onModifyPosition).not.toHaveBeenCalled();
  });

  it('does not open the dialog when pending-placement SL or TP cells are clicked', async () => {
    const user = userEvent.setup();
    const onModifyPosition = vi.fn();
    trade.positions = [];
    trade.pendingPositions = [{
      ...makePosition(-77, 'XAUUSD', 'BUY'),
      clientOrderId: 'placement-77',
      placementState: 'pending',
    }];

    const { container } = renderDock(onModifyPosition);
    const pendingRow = container.querySelector<HTMLElement>('.rtx-trade-row');
    const slCell = pendingRow?.querySelector<HTMLElement>('.rtx-trade-sl-cell');
    const tpCell = pendingRow?.querySelector<HTMLElement>('.rtx-trade-tp-cell');
    const slButton = slCell?.querySelector<HTMLButtonElement>('button');
    const tpButton = tpCell?.querySelector<HTMLButtonElement>('button');

    expect(pendingRow).not.toBeNull();
    expect(slCell).not.toBeNull();
    expect(tpCell).not.toBeNull();
    expect(slButton).toBeDisabled();
    expect(tpButton).toBeDisabled();

    await user.click(slCell!);
    await user.click(tpCell!);
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onModifyPosition).not.toHaveBeenCalled();
  });

  it('accepts only current scoped ticket-and-symbol updates and resets dialog state on scope change', async () => {
    const user = userEvent.setup();
    renderDock();
    const ticketCell = screen.getByText('91001', { selector: 'td' });
    const row = ticketCell.closest('tr');
    const slButton = row?.querySelector<HTMLButtonElement>('.rtx-trade-sl-value');
    const tpButton = row?.querySelector<HTMLButtonElement>('.rtx-trade-tp-value');
    expect(row).not.toBeNull();
    expect(slButton).not.toBeNull();
    expect(tpButton).not.toBeNull();

    await user.click(slButton!);
    expect(await screen.findByRole('dialog', { name: 'Modify Position #91001' })).toBeInTheDocument();
    const scopeA = currentScope();
    const publish = (detail: Record<string, unknown>) => act(() => {
      window.dispatchEvent(new CustomEvent('rtx:trade-modified', { detail }));
    });

    publish({ id: 91001, symbol: 'EURUSD', sl: 1.25, tp: 1.3 });
    publish({ id: 91001, symbol: 'EURUSD', sl: 1.25, tp: 1.3, sessionScope: 'authenticated|88|broker-a|https://broker.example' });
    publish({ id: 91001, symbol: 'GBPUSD', sl: 1.25, tp: 1.3, sessionScope: scopeA });
    expect(slButton).toHaveTextContent('1.26543');
    expect(tpButton).toHaveTextContent('1.28976');

    publish({ id: 91001, symbol: 'eurusd', sl: 1.25, tp: 1.3, sessionScope: scopeA });
    expect(slButton).toHaveTextContent('1.25000');
    expect(tpButton).toHaveTextContent('1.30000');

    act(() => commitBrokerAccountSessionScope({
      authenticated: true,
      accountId: '88',
      brokerId: 'broker-a',
      serverUrl: 'https://broker.example',
    }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(slButton).toHaveTextContent('1.26543');
    expect(tpButton).toHaveTextContent('1.28976');

    publish({ id: 91001, symbol: 'EURUSD', sl: 1.24, tp: 1.31, sessionScope: scopeA });
    expect(slButton).toHaveTextContent('1.26543');
    expect(tpButton).toHaveTextContent('1.28976');
  });
});
