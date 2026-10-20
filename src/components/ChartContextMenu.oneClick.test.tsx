// @vitest-environment jsdom

import '@testing-library/jest-dom';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';

import { ChartContextMenu } from './ChartContextMenu';
import { useSettingsStore } from '../store/useSettingsStore';

const setOneClick = (value: boolean) => {
  act(() => {
    useSettingsStore.setState((s) => ({ trade: { ...s.trade, oneClickTrading: value } }));
  });
};

const renderMenu = (overrides: Partial<ComponentProps<typeof ChartContextMenu>> = {}) => {
  const noop = vi.fn();
  const onOpenNewOrder = vi.fn();
  render(
    <ChartContextMenu
      visible
      x={20}
      y={20}
      symbol="XAUUSD"
      currentChartType="line"
      currentTimeframe="M1"
      onChangeChartType={noop}
      onChangeTimeframe={noop}
      onToggleOneClickTrading={noop}
      onToggleGrid={noop}
      onToggleVolumes={noop}
      onToggleAutoScroll={noop}
      onToggleChartShift={noop}
      onOpenProperties={noop}
      onSaveAsPicture={noop}
      onPrintChart={noop}
      onRefresh={noop}
      onZoomIn={noop}
      onZoomOut={noop}
      onDeleteIndicators={noop}
      onOpenNewOrder={onOpenNewOrder}
      onOpenDOM={noop}
      onOpenTemplateDialog={noop}
      onAddIndicator={noop}
      targetContextId="chart-test"
      onClose={noop}
      clickPrice={901.5}
      {...overrides}
    />,
  );
  return { onOpenNewOrder };
};

const openTradingSubmenu = () => {
  fireEvent.click(screen.getByRole('menuitem', { name: 'Trading' }));
};

type OrderEvent = { symbol?: unknown; side?: unknown };

describe('ChartContextMenu one-click gate + prefill (SUI-T9/T10)', () => {
  beforeEach(() => {
    setOneClick(false);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    setOneClick(false);
  });

  it('one-click OFF: Buy Market opens the order dialog, never an instant order', async () => {
    const trades: OrderEvent[] = [];
    const dialogs: OrderEvent[] = [];
    const onTrade = (e: Event) => trades.push((e as CustomEvent).detail ?? {});
    const onDialog = (e: Event) => dialogs.push((e as CustomEvent).detail ?? {});
    window.addEventListener('quickTrade', onTrade);
    window.addEventListener('openNewOrder', onDialog);
    try {
      renderMenu();
      openTradingSubmenu();
      fireEvent.click(screen.getByRole('menuitem', { name: 'Buy Market' }));

      await waitFor(() => {
        expect(dialogs).toEqual([{ symbol: 'XAUUSD', side: 'BUY' }]);
      });
      expect(trades).toEqual([]);
    } finally {
      window.removeEventListener('quickTrade', onTrade);
      window.removeEventListener('openNewOrder', onDialog);
    }
  });

  it('one-click ON: Buy Market sends instantly with no dialog', async () => {
    setOneClick(true);
    const trades: OrderEvent[] = [];
    const dialogs: OrderEvent[] = [];
    const onTrade = (e: Event) => trades.push((e as CustomEvent).detail ?? {});
    const onDialog = (e: Event) => dialogs.push((e as CustomEvent).detail ?? {});
    window.addEventListener('quickTrade', onTrade);
    window.addEventListener('openNewOrder', onDialog);
    try {
      renderMenu();
      openTradingSubmenu();
      fireEvent.click(screen.getByRole('menuitem', { name: 'Buy Market' }));
      await waitFor(() => {
        expect(trades).toEqual([{ side: 'BUY', symbol: 'XAUUSD' }]);
      });
      expect(dialogs).toEqual([]);
    } finally {
      window.removeEventListener('quickTrade', onTrade);
      window.removeEventListener('openNewOrder', onDialog);
    }
  });

  it('limit/stop items open prefilled with type, side and click price', async () => {
    const { onOpenNewOrder } = renderMenu();
    openTradingSubmenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Buy Limit' }));
    // Menu actions dispatch async via closeThen (rAF + timeout).
    await waitFor(() => {
      expect(onOpenNewOrder).toHaveBeenCalledWith({
        symbol: 'XAUUSD',
        orderType: 'Buy Limit',
        side: 'BUY',
        price: 901.5,
      });
    });
  });

  it('stop items open prefilled with stop type', async () => {
    const { onOpenNewOrder } = renderMenu();
    openTradingSubmenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sell Stop' }));
    await waitFor(() => {
      expect(onOpenNewOrder).toHaveBeenCalledWith({
        symbol: 'XAUUSD',
        orderType: 'Sell Stop',
        side: 'SELL',
        price: 901.5,
      });
    });
  });
});
