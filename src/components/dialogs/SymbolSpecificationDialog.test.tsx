import { act, fireEvent, render, screen, within } from '@testing-library/react';
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

  it('decodes official MT5 modes and retains generic sessions and tiered margin ranges', () => {
    const snapshot = buildSymbolSpecificationSnapshot({
      trade_calc_mode: 32,
      swap_mode: 4,
      swap_rollover_day: 'wednesday',
      sessions: {
        monday: [{ from: '00:00', to: '23:00' }],
      },
      margin_rates: {
        market_buy: [
          { notional_from: 0, notional_to: 100000, initial: 1, maintenance: 1 },
          { notional_from: 100000, initial: 1.5, maintenance: 1.5 },
        ],
      },
    });

    expect(snapshot.calculationMode).toBe('Exchange stocks');
    expect(snapshot.swapMode).toBe('Deposit currency');
    expect(snapshot.swapRolloverDay).toBe('Wednesday');
    expect(snapshot.sessions.find((session) => session.day === 'monday')).toMatchObject({
      quotes: ['00:00-23:00'],
      trade: ['00:00-23:00'],
    });
    expect(snapshot.marginRates).toEqual([
      expect.objectContaining({ label: 'Market Buy', range: '0 - 100 000', initial: 1 }),
      expect.objectContaining({ label: 'Market Buy', range: '>= 100 000', initial: 1.5 }),
    ]);

    expect(buildSymbolSpecificationSnapshot({ trade_calc_mode: 64, swap_mode: 9 })).toMatchObject({
      calculationMode: 'Collateral',
      swapMode: 'Profit currency',
    });
    expect(buildSymbolSpecificationSnapshot({ filling_mode: 0 }).fillingMode).toBeNull();
  });

  it('accepts live backend aliases and preserves advanced MT5 numeric fields', () => {
    expect(buildSymbolSpecificationSnapshot({
      calc_mode: 'cfd_leverage',
      spread: 17,
      is_spread_floating: '1',
      SYMBOL_TRADE_FREEZE_LEVEL: '8',
      SYMBOL_TRADE_TICK_VALUE_PROFIT: '1.25',
      SYMBOL_TRADE_TICK_VALUE_LOSS: '1.1',
      SYMBOL_VOLUME_LIMIT: '250',
      SYMBOL_MARGIN_INITIAL: '1000',
      SYMBOL_MARGIN_MAINTENANCE: '750',
      SYMBOL_MARGIN_HEDGED: '500',
      SYMBOL_MARGIN_HEDGED_USE_LEG: 0,
      triple_swap_day: '3',
    })).toMatchObject({
      calculationMode: 'CFD Leverage',
      spread: 17,
      spreadFloating: true,
      freezeLevel: 8,
      tickValueProfit: 1.25,
      tickValueLoss: 1.1,
      volumeLimit: 250,
      marginInitial: 1000,
      marginMaintenance: 750,
      marginHedged: 500,
      marginHedgedUseLeg: false,
      swapRolloverDay: 'Wednesday',
    });

    expect(buildSymbolSpecificationSnapshot({
      SYMBOL_TRADE_CALC_MODE: 'SYMBOL_CALC_MODE_EXCH_STOCKS',
      SYMBOL_SWAP_MODE: 'SYMBOL_SWAP_MODE_CURRENCY_SYMBOL',
      SYMBOL_CURRENCY_BASE: 'USD',
      SYMBOL_ORDER_MODE: ['SYMBOL_ORDER_MARKET', 'SYMBOL_ORDER_CLOSEBY'],
    })).toMatchObject({
      calculationMode: 'Exchange Stocks',
      swapMode: 'USD',
      orderMode: 'Market, Close By',
    });
  });

  it('keeps direct quote and trade session arrays separate and formats the end-of-day boundary', () => {
    const snapshot = buildSymbolSpecificationSnapshot({
      sessions: [
        { day: 'sunday', from: 0, to: 86400 },
        { day: 'tuesday', quotes: [['02:00', '03:30']], trade: [['02:15', '03:00']] },
      ],
      quote_sessions: [
        { day_of_week: '1', start_seconds: 0, end_seconds: 43200 },
      ],
      trade_sessions: [
        { dayOfWeek: 1, from: '3600', to: '86400' },
      ],
    });

    expect(snapshot.sessions.find((session) => session.day === 'sunday')).toMatchObject({
      quotes: ['00:00-24:00'],
      trade: ['00:00-24:00'],
    });
    expect(snapshot.sessions.find((session) => session.day === 'monday')).toMatchObject({
      quotes: ['00:00-12:00'],
      trade: ['01:00-24:00'],
    });
    expect(snapshot.sessions.find((session) => session.day === 'tuesday')).toMatchObject({
      quotes: ['02:00-03:30'],
      trade: ['02:15-03:00'],
    });
  });

  it('retains margin schedule metadata and inherits its currency into tier rows', () => {
    const snapshot = buildSymbolSpecificationSnapshot({
      margin_rates: {
        mode: 'floating',
        basis: 'notional_value_per_symbol',
        currency: 'USD',
        as_of: '2026-09-25T10:00:00Z',
        groups: [
          {
            order_type: 'market_buy',
            tiers: [
              {
                from: 0,
                to: 300000,
                initial_margin_rate: 1,
                maintenance_margin_rate: 1,
                initial_margin_per_lot: 1000,
                maintenance_margin_per_lot: 1000,
              },
            ],
          },
        ],
      },
    });

    expect(snapshot).toMatchObject({
      marginRatesMode: 'floating',
      marginRatesBasis: 'notional_value_per_symbol',
      marginRatesCurrency: 'USD',
      marginRatesAsOf: '2026-09-25T10:00:00Z',
      marginRates: [expect.objectContaining({
        label: 'Market Buy',
        range: '0 - 300 000',
        initial: 1,
        maintenance: 1,
        initialPerLot: 1000,
        maintenancePerLot: 1000,
        currency: 'USD',
      })],
    });
  });

  it('groups floating margin ranges under each MT5 operation heading', () => {
    render(
      <SymbolSpecificationDialog
        isOpen
        symbol="USDCAD"
        instrument={{
          margin_rate_mode: 'floating',
          margin_rate_basis: 'notional_value_per_symbol',
          margin_rate_currency: 'USD',
          margin_rates: [
            { order_type: 'market_buy', notional_from: 0, notional_to: 300000, initial_rate: 1, maintenance_rate: 1, initial_per_lot: 1000, maintenance_per_lot: 1000 },
            { order_type: 'market_buy', notional_from: 300000, notional_to: 500000, initial_rate: 2, maintenance_rate: 2, initial_per_lot: 2000, maintenance_per_lot: 2000 },
            { order_type: 'market_sell', notional_from: 0, notional_to: 300000, initial_rate: 1, maintenance_rate: 1, initial_per_lot: 1000, maintenance_per_lot: 1000 },
          ],
        }}
        onClose={vi.fn()}
      />,
    );

    const table = screen.getByRole('region', { name: 'Margin rates' });
    expect(within(table).getAllByText('Market Buy')).toHaveLength(1);
    expect(within(table).getAllByText('Market Sell')).toHaveLength(1);
    expect(within(table).getAllByText('0 - 300 000')).toHaveLength(2);
    expect(within(table).getByText('300 000 - 500 000')).toBeInTheDocument();
  });

  it('renders floating spread semantics while retaining a broker fixed-spread value', () => {
    const rendered = render(
      <SymbolSpecificationDialog
        isOpen
        symbol="EURUSD"
        instrument={{ spread: 17, is_spread_floating: true }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('Spread').closest('div')).toHaveTextContent('floating');

    rendered.rerender(
      <SymbolSpecificationDialog
        isOpen
        symbol="EURUSD"
        instrument={{ spread: 17, spread_mode: 'fixed' }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('Spread').closest('div')).toHaveTextContent('17');
    expect(screen.getByText('Spread').closest('div')).not.toHaveTextContent('fixed');
  });

  it('renders the broker specification in the inspected MT5 property-grid order', () => {
    render(
      <SymbolSpecificationDialog
        isOpen
        symbol="XAUUSD"
        instrument={{
          brokerSpecification: {
            description: 'Gold vs US Dollar',
            exchange: 'XCCY',
            sector: 'Commodities',
            industry: 'Precious Metals',
            digits: 2,
            trade_contract_size: 100,
            is_spread_floating: true,
            trade_stops_level: 0,
            trade_freeze_level: 5,
            currency_margin: 'USD',
            currency_profit: 'USD',
            calc_mode: 'cfd_leverage',
            trade_tick_size: 0.01,
            trade_tick_value: 0.1,
            trade_tick_value_profit: 0.11,
            trade_tick_value_loss: 0.09,
            margin_initial: 1000,
            margin_maintenance: 800,
            margin_hedged_use_leg: true,
            chart_mode: 0,
            trade_mode: 4,
            trade_exemode: 2,
            order_gtc_mode: 0,
            filling_mode: 3,
            expiration_mode: 15,
            order_mode: 127,
            volume_min: 0.01,
            volume_max: 100,
            volume_step: 0.01,
            volume_limit: 200,
            swap_mode: 1,
            swap_long: -12.6,
            swap_short: -4.6,
            swap_rates: {
              monday: 1,
              tuesday: 1,
              wednesday: 3,
              thursday: 1,
              friday: 1,
            },
            sessions: {
              sunday: { quotes: [], trade: [] },
              monday: { quotes: [{ start: '00:00', end: '23:00' }], trade: [{ start: '00:00', end: '23:00' }] },
              tuesday: { quotes: ['00:00-23:00'], trade: ['00:00-23:00'] },
              wednesday: { quotes: ['00:00-23:00'], trade: ['00:00-23:00'] },
              thursday: { quotes: ['00:00-23:00'], trade: ['00:00-23:00'] },
              friday: { quotes: ['00:00-23:00'], trade: ['00:00-23:00'] },
              saturday: { quotes: [], trade: [] },
            },
            margin_rates: {
              mode: 'floating',
              basis: 'notional_value_per_symbol',
              currency: 'USD',
              as_of: '2026-09-25T10:00:00Z',
              market_buy: {
                initial: 1,
                maintenance: 1,
                initial_per_lot: 300.4,
                maintenance_per_lot: 300.4,
              },
              market_sell: {
                initial: 1,
                maintenance: 1,
                initial_per_lot: 300.11,
                maintenance_per_lot: 300.11,
              },
            },
          },
        }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'XAUUSD Specification' })).toBeInTheDocument();
    expect(screen.getByText('XAUUSD, Gold vs US Dollar')).toBeInTheDocument();
    expect(screen.getByText('XCCY')).toBeInTheDocument();
    expect(screen.getByText('Precious Metals')).toBeInTheDocument();
    expect(screen.getByText('CFD Leverage')).toBeInTheDocument();
    expect(screen.getByText('Initial margin')).toBeInTheDocument();
    expect(screen.getByText('Maintenance margin')).toBeInTheDocument();
    expect(screen.getByText('Volume limit')).toBeInTheDocument();
    expect(screen.getByText('calculate using larger leg')).toBeInTheDocument();
    expect(screen.getByText('Full access')).toBeInTheDocument();
    expect(screen.getByText('Good till cancelled')).toBeInTheDocument();
    expect(screen.getByText('Fill or Kill, Immediate or Cancel')).toBeInTheDocument();
    expect(screen.getAllByText('All')).toHaveLength(2);

    const propertyLabels = Array.from(
      screen.getByTestId('symbol-specification-dialog').querySelectorAll('dt'),
      (node) => node.lastElementChild?.textContent,
    );
    expect(propertyLabels.slice(0, 29)).toEqual([
      'Exchange',
      'Sector',
      'Industry',
      'Digits',
      'Contract size',
      'Spread',
      'Stops level',
      'Margin currency',
      'Profit currency',
      'Calculation',
      'Tick size',
      'Tick value',
      'Initial margin',
      'Maintenance margin',
      'Hedged margin',
      'Chart mode',
      'Trade',
      'Execution',
      'GTC mode',
      'Filling',
      'Expiration',
      'Orders',
      'Minimal volume',
      'Maximal volume',
      'Volume step',
      'Volume limit',
      'Swap type',
      'Swap long',
      'Swap short',
    ]);
    expect(screen.getByRole('link', { name: 'Symbol specification help' })).toHaveAttribute(
      'href',
      'https://www.metatrader5.com/en/terminal/help/trading/market_watch#specification',
    );

    const swapRates = screen.getByRole('region', { name: 'Swap rates' });
    expect(within(swapRates).getByText('Wednesday')).toBeInTheDocument();
    expect(within(swapRates).getByText('3')).toBeInTheDocument();

    const sessions = screen.getByRole('region', { name: 'Sessions' });
    expect(within(sessions).getByText('Quotes')).toBeInTheDocument();
    expect(within(sessions).getByText('Trade')).toBeInTheDocument();
    expect(within(sessions).getAllByText('00:00-23:00')).toHaveLength(10);

    const marginRates = screen.getByRole('region', { name: 'Margin rates' });
    expect(within(marginRates).getByText('Margin rates: floating, notional value per symbol, USD')).toBeInTheDocument();
    expect(within(marginRates).getByText(/^As of /)).toBeInTheDocument();
    expect(within(marginRates).getByText('Market Buy')).toBeInTheDocument();
    expect(within(marginRates).getByText('Market Sell')).toBeInTheDocument();
    expect(within(marginRates).getAllByText('usd / lot')).toHaveLength(2);
    expect(within(marginRates).getAllByText('300.40')).toHaveLength(2);
    expect(screen.queryByText('Bid')).not.toBeInTheDocument();
  });

  it('renders the dynamic stock-only fields and broker information link observed in MT5', () => {
    render(
      <SymbolSpecificationDialog
        isOpen
        symbol="INTC"
        instrument={{
          description: 'Intel Corporation',
          SYMBOL_PAGE: 'https://www.intel.com/',
          SYMBOL_ISIN: 'US4581401001',
          exchange: 'XNAS',
          sector_name: 'Technology',
          industry_name: 'Semiconductors',
          country: 'United States',
          digits: 2,
          contract_size: 1,
          spread_float: true,
          trade_stops_level: 5,
          currency_margin: 'USD',
          currency_profit: 'USD',
          trade_calc_mode: 32,
          trade_tick_size: 0.01,
          trade_tick_value: 0.01,
          chart_mode: 1,
          subscription: '15 minutes delayed',
          ticks_history: 'None',
          trade_liquidity_rate: 1,
          trade_mode: 4,
          trade_exemode: 3,
        }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('link', { name: 'INTC, Intel Corporation' })).toHaveAttribute(
      'href',
      'https://www.intel.com/',
    );
    expect(screen.getByText('US4581401001')).toBeInTheDocument();
    expect(screen.getByText('United States')).toBeInTheDocument();
    expect(screen.getByText('15 minutes delayed')).toBeInTheDocument();
    expect(screen.getByText('Ticks history')).toBeInTheDocument();
    expect(screen.getByText('1.000')).toBeInTheDocument();

    const labels = Array.from(
      screen.getByTestId('symbol-specification-dialog').querySelectorAll('dt'),
      (node) => node.lastElementChild?.textContent,
    );
    expect(labels.slice(0, 5)).toEqual(['ISIN', 'Exchange', 'Sector', 'Industry', 'Country']);
  });

  it('resets trade-only controls to 0 for a disabled symbol while keeping broker swaps', () => {
    render(
      <SymbolSpecificationDialog
        isOpen
        symbol="US30"
        instrument={{
          trade_mode: 0,
          trade_exemode: 2,
          order_gtc_mode: 0,
          filling_mode: 3,
          expiration_mode: 15,
          order_mode: 127,
          volume_min: 1,
          volume_max: 100,
          currency_base: 'USD',
          swap_mode: 2,
          swap_long: -2.21,
          swap_short: -1.99,
        }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('Disabled')).toBeInTheDocument();
    expect(screen.getByText('Swap type').closest('div')).toHaveTextContent('USD');
    expect(screen.getByText('Execution').closest('div')).toHaveTextContent('0');
    expect(screen.getByText('Orders').closest('div')).toHaveTextContent('0');
    expect(screen.getByText('Minimal volume').closest('div')).toHaveTextContent('0');
  });

  it('keeps fresh nested broker values authoritative and uses fallback only for identity', () => {
    const snapshot = buildSymbolSpecificationSnapshot(
      {
        digits: 5,
        enabled: true,
        specification: { digits: 2 },
      },
      {
        description: 'Gold Spot',
        swap_long: -99,
        trade_mode: 4,
      },
    );

    expect(snapshot.description).toBe('Gold Spot');
    expect(snapshot.digits).toBe(2);
    expect(snapshot.swapLong).toBeNull();
    expect(snapshot.tradeMode).toBeNull();
  });

  it('renders canonical commission tiers and correlated margin spreads from the backend', () => {
    render(
      <SymbolSpecificationDialog
        isOpen
        symbol="FUTURE"
        instrument={{
          commission_schedules: [{
            title: 'Commission',
            charge_mode: 'instant',
            basis: 'volume',
            direction: 'entry_exit_deals',
            tiers: [
              { range_label: '0 - 10', value_display: '1.2 USD per deal' },
              { range_label: '11 - 20', value_display: '1.1 USD per lot' },
            ],
          }],
          margin_spreads: [{
            name: 'Calendar spread',
            leg_a: ['FUT-DEC (1)'],
            leg_b: ['FUT-MAR (1)'],
            margin_type: 'value',
            initial_margin: 2000,
            maintenance_margin: 1800,
            currency: 'USD',
          }],
        }}
        onClose={vi.fn()}
      />,
    );

    const commission = screen.getByRole('region', { name: 'Commission' });
    expect(within(commission).getByText('Commission | instant, volume, entry exit deals')).toBeInTheDocument();
    expect(within(commission).getByText('1.2 USD per deal')).toBeInTheDocument();

    const spreads = screen.getByRole('region', { name: 'Spreads' });
    expect(within(spreads).getByText('Calendar spread')).toBeInTheDocument();
    expect(within(spreads).getByText('FUT-DEC (1)')).toBeInTheDocument();
    expect(within(spreads).getByText('Value: 2000 / 1800 / USD')).toBeInTheDocument();
  });

  it('shows explicit current-request loading state and falls back to 0 rows when unavailable', () => {
    const rendered = render(
      <SymbolSpecificationDialog
        isOpen
        symbol="EURUSD"
        instrument={{ digits: 5 }}
        requestStatus="loading"
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Loading current specification...');
    expect(screen.queryByText('Digits')).not.toBeInTheDocument();

    rendered.rerender(
      <SymbolSpecificationDialog
        isOpen
        symbol="EURUSD"
        requestStatus="unavailable"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Exchange').closest('div')).toHaveTextContent('0');
    expect(screen.getByText('Digits').closest('div')).toHaveTextContent('0');
    expect(screen.getByRole('region', { name: 'Swap rates' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Sessions' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Margin rates' })).toBeInTheDocument();
  });

  it('keeps all MT5 specification rows and sections with hardcoded 0 when values do not come from the backend', () => {
    render(
      <SymbolSpecificationDialog
        isOpen
        symbol="EURUSD"
        instrument={{ symbol: 'EURUSD' }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('Exchange').closest('div')).toHaveTextContent('0');
    expect(screen.getByText('Sector').closest('div')).toHaveTextContent('0');
    expect(screen.getByText('Contract size').closest('div')).toHaveTextContent('0');
    expect(screen.getByText('Spread').closest('div')).toHaveTextContent('0');
    expect(screen.getByRole('region', { name: 'Swap rates' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Sessions' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Margin rates' })).toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();
    expect(screen.queryByText('Bid')).not.toBeInTheDocument();
    expect(screen.queryByText('24/5')).not.toBeInTheDocument();
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

  it('stays modal on backdrop clicks and supports keyboard resizing', () => {
    const onClose = vi.fn();
    render(
      <SymbolSpecificationDialog
        isOpen
        symbol="EURUSD"
        instrument={{ symbol: 'EURUSD', digits: 5 }}
        onClose={onClose}
      />,
    );

    const dialog = screen.getByTestId('symbol-specification-dialog');
    expect(dialog).toHaveStyle({ width: '444px', height: '438px' });

    fireEvent.mouseDown(dialog.parentElement as HTMLElement);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(screen.getByRole('button', { name: 'Resize symbol specification dialog' }), {
      key: 'ArrowRight',
    });
    expect(dialog).toHaveStyle({ width: '460px', height: '438px' });
  });

  it('renders MT5 In points swap type, derives weekday swap rates from rollover day, and highlights clicked rows', () => {
    render(
      <SymbolSpecificationDialog
        isOpen
        symbol="EURUSD"
        instrument={{
          description: 'Euro vs US Dollar',
          exchange: 'XCCY',
          sector: 'Currency',
          digits: 5,
          contract_size: 100000,
          currency_base: 'EUR',
          currency_margin: 'EUR',
          currency_profit: 'USD',
          calc_mode: 0,
          is_spread_floating: true,
          stops_level: 0,
          margin_hedged: 100000,
          chart_mode: 0,
          trade_mode: 4,
          trade_exemode: 2,
          order_gtc_mode: 0,
          filling_mode: 1,
          expiration_mode: 15,
          order_mode: 127,
          volume_min: 0.01,
          volume_max: 500,
          volume_step: 0.01,
          swap_mode: 1,
          swap_long: -0.7,
          swap_short: -1,
          swap_rollover3days: 3,
        }}
        onClose={vi.fn()}
      />,
    );

    const swapTypeRow = screen.getByText('Swap type').closest('.rtx-spec-row') as HTMLElement;
    expect(swapTypeRow).toHaveTextContent('In points');

    const swapRatesRegion = screen.getByRole('region', { name: 'Swap rates' });
    expect(within(swapRatesRegion).getByText('Monday').closest('.rtx-spec-row')).toHaveTextContent('1');
    expect(within(swapRatesRegion).getByText('Wednesday').closest('.rtx-spec-row')).toHaveTextContent('3');

    fireEvent.click(swapTypeRow);
    expect(swapTypeRow).toHaveAttribute('data-selected', 'true');
  });
});
