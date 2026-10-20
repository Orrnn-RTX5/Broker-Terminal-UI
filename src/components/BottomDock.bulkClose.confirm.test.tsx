// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BottomDock } from './BottomDock';

// Dock shell entries must reach the gated App.handleCloseBulk WITHOUT
// issuing any trade call themselves. The shared BulkCloseConfirmDialog gate
// in App owns confirmation and execution; the dock only delegates, so a
// dismissed dialog aborts with zero API calls by construction.
const toolboxMocks = vi.hoisted(() => ({
  refresh: vi.fn().mockResolvedValue(undefined),
}));

const trade = vi.hoisted(() => ({
  account: null as any,
  positions: [] as any[],
}));

vi.mock('../hooks/useToolboxTradeData', () => ({
  useToolboxTradeData: () => ({
    account: trade.account,
    positions: trade.positions,
    pendingPositions: [],
    loading: false,
    error: null,
    login: null,
    restBaseUrl: '',
    wsUrl: '',
    wsState: 'connected',
    lastRestAt: null,
    lastWsAt: null,
    debug: [],
    refresh: toolboxMocks.refresh,
    removePosition: vi.fn(),
    removePositionsByMode: vi.fn(),
  }),
}));

vi.mock('../features/bottom-dock/trade/TradeTab', () => ({ TradeTab: () => null }));
vi.mock('../features/bottom-dock/history/HistoryTab', () => ({ HistoryTab: () => null }));
vi.mock('../features/bottom-dock/exposure/ExposureTab', () => ({ ExposureTab: () => null }));
vi.mock('../features/bottom-dock/toolbox/ToolboxTab', () => ({ ToolboxTab: () => null }));
vi.mock('./HistoryDownloader', () => ({ HistoryDownloader: () => null }));
vi.mock('./layout/JournalTab', () => ({ JournalTab: () => null }));

const renderDock = (callbacks: {
  onCloseBulk: ReturnType<typeof vi.fn>;
  onClosePosition?: ReturnType<typeof vi.fn>;
  onModifyPosition?: ReturnType<typeof vi.fn>;
  onCancelOrder?: ReturnType<typeof vi.fn>;
}) => render(
  <BottomDock
    height={300}
    onClosePosition={callbacks.onClosePosition ?? vi.fn()}
    onModifyPosition={callbacks.onModifyPosition ?? vi.fn()}
    onCancelOrder={callbacks.onCancelOrder ?? vi.fn()}
    onCloseBulk={callbacks.onCloseBulk}
  />,
);

describe('dock bulk-close entries route to confirmation', () => {
  beforeEach(() => {
    localStorage.clear();
    // One winner + one loser keeps Close All / In-Profit / In-Loss enabled.
    trade.account = null;
    trade.positions = [{ profit: 5 }, { profit: -3 }];
    toolboxMocks.refresh.mockClear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('routes Close In-Profit to the gated bulk handler without trading itself', () => {
    const onCloseBulk = vi.fn();
    const onClosePosition = vi.fn();
    const onModifyPosition = vi.fn();
    const onCancelOrder = vi.fn();
    renderDock({ onCloseBulk, onClosePosition, onModifyPosition, onCancelOrder });

    fireEvent.click(screen.getByRole('button', { name: 'Close In-Profit' }));

    expect(onCloseBulk).toHaveBeenCalledTimes(1);
    expect(onCloseBulk).toHaveBeenCalledWith('WINNERS', undefined);
    expect(onClosePosition).not.toHaveBeenCalled();
    expect(onModifyPosition).not.toHaveBeenCalled();
    expect(onCancelOrder).not.toHaveBeenCalled();
  });

  it('routes Close In-Loss to the gated bulk handler without trading itself', () => {
    const onCloseBulk = vi.fn();
    const onClosePosition = vi.fn();
    const onModifyPosition = vi.fn();
    const onCancelOrder = vi.fn();
    renderDock({ onCloseBulk, onClosePosition, onModifyPosition, onCancelOrder });

    fireEvent.click(screen.getByRole('button', { name: 'Close In-Loss' }));

    expect(onCloseBulk).toHaveBeenCalledTimes(1);
    expect(onCloseBulk).toHaveBeenCalledWith('LOSERS', undefined);
    expect(onClosePosition).not.toHaveBeenCalled();
    expect(onModifyPosition).not.toHaveBeenCalled();
    expect(onCancelOrder).not.toHaveBeenCalled();
  });

  it('routes Close All to the gated bulk handler without trading itself', () => {
    const onCloseBulk = vi.fn();
    const onClosePosition = vi.fn();
    const onModifyPosition = vi.fn();
    const onCancelOrder = vi.fn();
    renderDock({ onCloseBulk, onClosePosition, onModifyPosition, onCancelOrder });

    fireEvent.click(screen.getByRole('button', { name: 'Close All' }));

    expect(onCloseBulk).toHaveBeenCalledTimes(1);
    expect(onCloseBulk).toHaveBeenCalledWith('ALL', undefined);
    expect(onClosePosition).not.toHaveBeenCalled();
    expect(onModifyPosition).not.toHaveBeenCalled();
    expect(onCancelOrder).not.toHaveBeenCalled();
  });

  it('sends nothing when no bulk entry is triggered', () => {
    const onCloseBulk = vi.fn();
    const onClosePosition = vi.fn();
    renderDock({ onCloseBulk, onClosePosition });

    expect(screen.getByRole('button', { name: 'Close All' })).toBeInTheDocument();
    expect(onCloseBulk).not.toHaveBeenCalled();
    expect(onClosePosition).not.toHaveBeenCalled();
  });
});
