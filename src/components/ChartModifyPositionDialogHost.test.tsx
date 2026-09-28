// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore, type Position } from '../store/useAppStore';
import {
  commitBrokerAccountSessionScope,
  getCommittedBrokerAccountSessionScope,
  getCommittedBrokerAccountSessionScopeKey,
} from '../services/brokerSession';
import {
  CHART_POSITION_MODIFY_EVENT,
  type ChartPositionModifyDetail,
} from '../utils/chartTradeControls';
import { ChartModifyPositionDialogHost } from './ChartModifyPositionDialogHost';

const dialogHarness = vi.hoisted(() => ({
  onClose: null as null | ((sl?: number, tp?: number, comment?: string) => void),
}));

vi.mock('./ModifyPositionDialog', () => ({
  ModifyPositionDialog: ({ isOpen, onClose, position }: any) => {
    dialogHarness.onClose = onClose;
    return isOpen && position ? (
      <div role="dialog" aria-label={`Modify Position #${position.id}`}>
        <span>{position.symbol}</span>
        <span data-testid="dialog-digits">{position.digits}</span>
        <button type="button" onClick={() => onClose(1.08, 1.12, 'chart-edit')}>Save test edit</button>
      </div>
    ) : null;
  },
}));

const position: Position & { digits: number; stopsLevel: number } = {
  id: 456,
  symbol: 'EURUSD',
  side: 'BUY',
  volume: 0.2,
  openPrice: 1.1,
  currentPrice: 1.105,
  openTime: '2026-09-25T08:30:00.000Z',
  sl: 1.07,
  tp: 1.13,
  swap: 0,
  commission: 0,
  unrealizedPnL: 100,
  digits: 5,
  stopsLevel: 12,
};

const currentScope = () => getCommittedBrokerAccountSessionScopeKey(
  getCommittedBrokerAccountSessionScope(),
);

const dispatchModifyRequest = (overrides: Partial<ChartPositionModifyDetail> = {}) => {
  window.dispatchEvent(new CustomEvent<ChartPositionModifyDetail>(CHART_POSITION_MODIFY_EVENT, {
    detail: {
      ticket: position.id,
      symbol: position.symbol,
      sessionScope: currentScope(),
      ...overrides,
    },
  }));
};

describe('ChartModifyPositionDialogHost', () => {
  beforeEach(() => {
    commitBrokerAccountSessionScope({
      authenticated: true,
      accountId: '77',
      brokerId: 'broker-a',
      serverUrl: 'https://broker.example',
    });
    useAppStore.setState({ positions: [position] });
  });

  afterEach(() => {
    cleanup();
    dialogHarness.onClose = null;
    useAppStore.setState({ positions: [] });
    commitBrokerAccountSessionScope({ authenticated: false, brokerId: '', serverUrl: '' });
    vi.restoreAllMocks();
  });

  it('opens from the current scoped store snapshot and publishes saved levels', async () => {
    const user = userEvent.setup();
    const modified: any[] = [];
    const listener = (event: Event) => modified.push((event as CustomEvent).detail);
    window.addEventListener('rtx:trade-modified', listener);
    render(<ChartModifyPositionDialogHost onClosePosition={() => undefined} resolveAllowedSymbol={symbol => String(symbol)} />);

    act(() => dispatchModifyRequest());

    expect(await screen.findByRole('dialog', { name: 'Modify Position #456' })).toBeInTheDocument();
    expect(screen.getByTestId('dialog-digits')).toHaveTextContent('5');
    await user.click(screen.getByRole('button', { name: 'Save test edit' }));

    expect(modified).toEqual([{
      id: 456,
      symbol: 'EURUSD',
      sl: 1.08,
      tp: 1.12,
      comment: 'chart-edit',
      sessionScope: currentScope(),
    }]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    window.removeEventListener('rtx:trade-modified', listener);
  });

  it('rejects another session and closes if the current ticket disappears', async () => {
    render(<ChartModifyPositionDialogHost onClosePosition={() => undefined} resolveAllowedSymbol={symbol => String(symbol)} />);

    act(() => dispatchModifyRequest({ sessionScope: 'authenticated|88|broker-a|https://broker.example' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    act(() => dispatchModifyRequest());
    expect(await screen.findByRole('dialog', { name: 'Modify Position #456' })).toBeInTheDocument();

    act(() => useAppStore.setState({ positions: [] }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('closes on a committed scope change and ignores the stale dialog callback', async () => {
    const modified: any[] = [];
    const listener = (event: Event) => modified.push((event as CustomEvent).detail);
    window.addEventListener('rtx:trade-modified', listener);
    render(<ChartModifyPositionDialogHost onClosePosition={() => undefined} resolveAllowedSymbol={symbol => String(symbol)} />);

    act(() => dispatchModifyRequest());
    expect(await screen.findByRole('dialog', { name: 'Modify Position #456' })).toBeInTheDocument();
    const staleOnClose = dialogHarness.onClose;
    expect(staleOnClose).not.toBeNull();

    act(() => commitBrokerAccountSessionScope({
      authenticated: true,
      accountId: '88',
      brokerId: 'broker-a',
      serverUrl: 'https://broker.example',
    }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    act(() => staleOnClose?.(1.09, 1.14, 'stale-edit'));
    expect(modified).toEqual([]);
    window.removeEventListener('rtx:trade-modified', listener);
  });
});
