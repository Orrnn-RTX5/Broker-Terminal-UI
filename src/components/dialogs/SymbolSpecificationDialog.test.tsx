import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAppStore } from '../../store/useAppStore';
import {
  buildSymbolSpecificationSnapshot,
  SymbolSpecificationDialog,
} from './SymbolSpecificationDialog';

describe('SymbolSpecificationDialog', () => {
  afterEach(() => {
    act(() => useAppStore.getState().setTicks({}));
  });

  it('normalizes only broker-supplied contract metadata', () => {
    expect(buildSymbolSpecificationSnapshot({
      display_name: 'Gold Spot',
      asset_class: 'Metals',
      digits: 2,
      contract_size: 100,
      tick_size: 0.01,
      min_volume: 0.01,
      max_volume: 50,
      volume_step: 0.01,
      margin_rate: 0.02,
      swap_long: -2.5,
      swap_short: 1.25,
      commission_per_lot: 3,
      trading_enabled: true,
    })).toMatchObject({
      description: 'Gold Spot',
      category: 'Metals',
      digits: 2,
      contractSize: 100,
      tickSize: 0.01,
      minVolume: 0.01,
      maxVolume: 50,
      volumeStep: 0.01,
      marginRate: 0.02,
      swapLong: -2.5,
      swapShort: 1.25,
      commission: 3,
      tradingEnabled: true,
    });
  });

  it('reads broker metadata from supported nested specification objects', () => {
    expect(buildSymbolSpecificationSnapshot({
      description: 'Nested Gold',
      specification: {
        digits: 2,
        trade_contract_size: '100',
        trade_tick_value: 1,
        currency_profit: 'USD',
      },
      trading_conditions: {
        lots_min: '0.01',
        lots_max: 25,
        lots_step: 0.01,
        swap_long: 0,
        swap_short: -1.2,
        commission: 0,
      },
    })).toMatchObject({
      description: 'Nested Gold',
      digits: 2,
      contractSize: 100,
      tickValue: 1,
      minVolume: 0.01,
      maxVolume: 25,
      volumeStep: 0.01,
      swapLong: 0,
      swapShort: -1.2,
      commission: 0,
      profitCurrency: 'USD',
    });
  });

  it('renders a professional in-app specification with live quote precedence', () => {
    act(() => {
      useAppStore.getState().setTicks({
        XAUUSD: {
          symbol: 'XAUUSD',
          bid: 4425.9,
          ask: 4426.05,
          spread: 0.150000000005457,
          dailyChange: -0.52,
          high: 4434.25,
          low: 4418.1,
          last: 4426,
          volume: 188,
          digits: 2,
          lp: 'FXTrust',
          timestamp: Date.now(),
        },
      });
    });

    render(
      <SymbolSpecificationDialog
        isOpen
        symbol="XAUUSD"
        instrument={{
          display_name: 'Gold Spot',
          asset_class: 'Metals',
          digits: 3,
          contract_size: 100,
          tick_size: 0.01,
          trading_enabled: true,
        }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'XAUUSD Specification' })).toBeInTheDocument();
    expect(screen.getByText('Gold Spot')).toBeInTheDocument();
    expect(screen.getAllByText('Metals').length).toBeGreaterThan(0);
    expect(screen.getByText('4425.90')).toBeInTheDocument();
    expect(screen.getByText('4426.05')).toBeInTheDocument();
    expect(screen.getByText('15 pips')).toBeInTheDocument();
    expect(screen.getByText('-0.52%')).toBeInTheDocument();
    expect(screen.getByText('FXTrust')).toBeInTheDocument();
    expect(screen.queryByText('24/5')).not.toBeInTheDocument();
    expect(screen.queryByText('100,000')).not.toBeInTheDocument();
  });

  it('shows compact truthful states instead of rows of missing values', () => {
    render(
      <SymbolSpecificationDialog
        isOpen
        symbol="EURUSD"
        instrument={{ symbol: 'EURUSD' }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('Waiting for the first live quote from the broker.')).toBeInTheDocument();
    expect(screen.getByText('Contract details were not provided by this broker.')).toBeInTheDocument();
    expect(screen.getByText('Volume and cost terms were not provided by this broker.')).toBeInTheDocument();
    expect(screen.getByText('Waiting for detailed quote data from the broker feed.')).toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();
    expect(screen.getByText('Only values supplied by your broker or live feed are shown.')).toBeInTheDocument();
  });

  it('closes with Escape and never needs a browser alert', () => {
    const onClose = vi.fn();
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    render(
      <SymbolSpecificationDialog
        isOpen
        symbol="EURUSD"
        instrument={{ symbol: 'EURUSD' }}
        onClose={onClose}
      />,
    );

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});
