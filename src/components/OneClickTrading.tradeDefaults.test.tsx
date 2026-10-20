// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAppStore } from '../store/useAppStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { normalizeMarketStatus } from '../utils/marketStatus';
import { OneClickTrading } from './OneClickTrading';

const mocks = vi.hoisted(() => ({ placeMarketOrder: vi.fn() }));

vi.mock('../services/api', () => {
  const api = { orders: { placeMarketOrder: mocks.placeMarketOrder } };
  return { api, default: api };
});

const lotInput = (): HTMLInputElement => {
  const element = screen.getByRole('spinbutton');
  if (!(element instanceof HTMLInputElement)) throw new Error('Expected lot size input');
  return element;
};

const renderPanel = () => {
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
    <OneClickTrading
      symbol="EURUSD"
      timeframe="M5"
      visible
      tradeAllowed={false}
      marketStatus={normalizeMarketStatus({ symbol: 'EURUSD', status: 'open' })}
    />,
  );
};

describe('OneClickTrading Options default volume (SUI-T8)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    useAppStore.getState().reset();
    useSettingsStore.getState().resetToDefaults();
    mocks.placeMarketOrder.mockReset();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    useAppStore.getState().reset();
    useSettingsStore.getState().resetToDefaults();
    vi.restoreAllMocks();
  });

  it('seeds the lot input from the configured default in default mode', () => {
    useSettingsStore.getState().updateTradeSettings({ defaultVolumeMode: 'default', defaultVolume: 0.25 });

    renderPanel();

    expect(lotInput().value).toBe('0.25');
  });

  it('prefers the ticket last lot size in last-used mode', () => {
    localStorage.setItem('lastLotSize', '1.5');

    renderPanel();

    expect(lotInput().value).toBe('1.50');
  });

  it('falls back to the store default when the configured volume is invalid', () => {
    useSettingsStore.getState().updateTradeSettings({ defaultVolumeMode: 'default', defaultVolume: 0 });

    renderPanel();

    expect(lotInput().value).toBe('0.01');
  });

  it('follows live changes to the configured default while default mode is active', () => {
    useSettingsStore.getState().updateTradeSettings({ defaultVolumeMode: 'default', defaultVolume: 0.25 });
    renderPanel();
    expect(lotInput().value).toBe('0.25');

    act(() => {
      useSettingsStore.getState().updateTradeSettings({ defaultVolume: 0.75 });
    });

    expect(lotInput().value).toBe('0.75');
  });
});
