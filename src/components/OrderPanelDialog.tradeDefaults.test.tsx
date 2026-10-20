// @vitest-environment jsdom

// SUI-T8 consumer proof: the New Order ticket seeds its volume/deviation
// from the persisted Options trade defaults (no literals), re-seeds on
// every open (documented reset semantics), and submits the deviation.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAppStore } from '../store/useAppStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { OrderPanelDialog } from './OrderPanelDialog';

vi.mock('../hooks/useSymbolMarketStatus', () => ({
  useSymbolMarketStatus: () => ({
    symbol: 'EURUSD',
    status: 'open',
    isOpen: true,
    isTradeBlocked: false,
    label: 'Market Open',
    loading: false,
    error: null,
    refreshedAt: 1,
  }),
}));

const renderTicket = (props?: { isOpen?: boolean; onSubmitOrder?: (order: any) => void | Promise<void> }) => {
  useAppStore.getState().reset();
  useAppStore.getState().setTicks({
    EURUSD: {
      symbol: 'EURUSD',
      bid: 1.085,
      ask: 1.0852,
      spread: 0.0002,
      timestamp: Date.now(),
      digits: 5,
    },
  });
  return render(
    <OrderPanelDialog
      isOpen={props?.isOpen ?? true}
      onClose={vi.fn()}
      symbol="EURUSD"
      currentPrice={{ bid: 1.085, ask: 1.0852 }}
      onSubmitOrder={props?.onSubmitOrder ?? vi.fn()}
    />,
  );
};

const volumeInput = (): HTMLInputElement => screen.getByLabelText('Volume') as HTMLInputElement;
const deviationInput = (): HTMLInputElement =>
  screen.getByLabelText('Deviation') as HTMLInputElement;

describe('OrderPanelDialog Options trade defaults (SUI-T8)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    useAppStore.getState().reset();
    useSettingsStore.getState().resetToDefaults();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    useAppStore.getState().reset();
    useSettingsStore.getState().resetToDefaults();
    vi.restoreAllMocks();
  });

  it('seeds volume and deviation from the configured defaults in default mode', () => {
    useSettingsStore.getState().updateTradeSettings({
      defaultVolumeMode: 'default',
      defaultVolume: 2.5,
      defaultDeviationMode: 'default',
      defaultDeviation: 7,
    });

    renderTicket();

    expect(volumeInput().value).toBe('2.5');
    expect(deviationInput().value).toBe('7');
  });

  it('prefers the ticket last lot size in last-used volume mode', () => {
    localStorage.setItem('lastLotSize', '1.5');
    useSettingsStore.getState().updateTradeSettings({
      defaultVolumeMode: 'last-used',
      defaultVolume: 2.5,
    });

    renderTicket();

    expect(volumeInput().value).toBe('1.5');
  });

  it('falls back to the store defaults when last-used/configured values are missing or invalid', () => {
    useSettingsStore.getState().updateTradeSettings({
      defaultVolumeMode: 'default',
      defaultVolume: 0,
      defaultDeviationMode: 'default',
      defaultDeviation: -1,
    });

    renderTicket();

    // Fallbacks derive from the store's own defaults — never literals.
    expect(volumeInput().value).toBe('0.01');
    expect(deviationInput().value).toBe('0');
  });

  it('re-seeds from the store on reopen after edits made while closed', () => {
    useSettingsStore.getState().updateTradeSettings({
      defaultVolumeMode: 'default',
      defaultVolume: 2.5,
      defaultDeviationMode: 'default',
      defaultDeviation: 7,
    });
    const onSubmitOrder = vi.fn();
    const { rerender } = renderTicket({ onSubmitOrder });
    expect(volumeInput().value).toBe('2.5');

    // Trader edits the draft, then closes the ticket.
    fireEvent.change(volumeInput(), { target: { value: '9.99' } });
    rerender(
      <OrderPanelDialog
        isOpen={false}
        onClose={vi.fn()}
        symbol="EURUSD"
        currentPrice={{ bid: 1.085, ask: 1.0852 }}
        onSubmitOrder={onSubmitOrder}
      />,
    );

    // Options change while the ticket is closed.
    act(() => {
      useSettingsStore.getState().updateTradeSettings({ defaultVolume: 0.5, defaultDeviation: 3 });
    });

    rerender(
      <OrderPanelDialog
        isOpen
        onClose={vi.fn()}
        symbol="EURUSD"
        currentPrice={{ bid: 1.085, ask: 1.0852 }}
        onSubmitOrder={onSubmitOrder}
      />,
    );

    expect(volumeInput().value).toBe('0.5');
    expect(deviationInput().value).toBe('3');
  });

  it('does not clobber drafts edited while the dialog is open', () => {
    useSettingsStore.getState().updateTradeSettings({
      defaultVolumeMode: 'default',
      defaultVolume: 2.5,
      defaultDeviationMode: 'default',
      defaultDeviation: 7,
    });
    renderTicket();
    fireEvent.change(volumeInput(), { target: { value: '9.99' } });

    act(() => {
      useSettingsStore.getState().updateTradeSettings({ defaultVolume: 0.75, defaultDeviation: 4 });
    });

    expect(volumeInput().value).toBe('9.99');
    expect(deviationInput().value).toBe('7');
  });

  it('submits the store-seeded deviation with market orders', () => {
    useSettingsStore.getState().updateTradeSettings({
      defaultVolumeMode: 'default',
      defaultVolume: 0.25,
      defaultDeviationMode: 'default',
      defaultDeviation: 5,
    });
    const onSubmitOrder = vi.fn();
    renderTicket({ onSubmitOrder });

    fireEvent.click(screen.getByRole('button', { name: /buy by market/i }));

    expect(onSubmitOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'buy',
        symbol: 'EURUSD',
        volume: 0.25,
        deviation: 5,
      }),
    );
  });
});
