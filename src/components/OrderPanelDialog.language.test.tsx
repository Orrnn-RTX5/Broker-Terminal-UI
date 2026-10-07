// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n, { changeInterfaceLanguage, i18nReady } from '../i18n';
import { useAppStore } from '../store/useAppStore';
import { OrderPanelDialog } from './OrderPanelDialog';

vi.mock('../hooks/useSymbolMarketStatus', () => ({
  useSymbolMarketStatus: () => ({
    symbol: 'EURUSD', status: 'open', isOpen: true, isTradeBlocked: false,
    label: 'Market Open', loading: false, error: null, refreshedAt: 1,
  }),
}));

const copy = (source: string) => String(i18n.t(source, {
  ns: 'ui', keySeparator: false, nsSeparator: false, defaultValue: source,
}));

describe('OrderPanelDialog interface language', () => {
  beforeEach(async () => {
    await i18nReady;
    await changeInterfaceLanguage('en');
    localStorage.removeItem('lastLotSize');
    useAppStore.getState().reset();
    useAppStore.getState().setTicks({
      EURUSD: { symbol: 'EURUSD', bid: 1.085, ask: 1.0852, spread: 0.0002, timestamp: Date.now(), digits: 5 },
    });
  });

  afterEach(async () => {
    cleanup();
    await changeInterfaceLanguage('en');
    useAppStore.getState().reset();
  });

  it('translates an open order draft without remounting fields, changing raw values or submitting an order', async () => {
    const onSubmitOrder = vi.fn();
    const onClose = vi.fn();
    render(<OrderPanelDialog isOpen onClose={onClose} symbol="EURUSD"
      currentPrice={{ bid: 1.085, ask: 1.0852 }} onSubmitOrder={onSubmitOrder} />);

    const dialog = screen.getByRole('dialog');
    const volume = screen.getByLabelText('Volume') as HTMLInputElement;
    const comment = screen.getByLabelText('Comment') as HTMLInputElement;
    const symbol = screen.getByLabelText('Symbol') as HTMLSelectElement;
    const fillPolicy = screen.getByLabelText('Fill policy') as HTMLSelectElement;
    const buy = screen.getByRole('button', { name: 'Buy by Market' });
    const sell = screen.getByRole('button', { name: 'Sell by Market' });

    fireEvent.change(volume, { target: { value: '1.23' } });
    fireEvent.change(comment, { target: { value: 'custom' } });
    fireEvent.change(fillPolicy, { target: { value: 'Return' } });

    for (const language of ['fr', 'ar'] as const) {
      await act(async () => { await changeInterfaceLanguage(language); });

      expect(screen.getByRole('dialog')).toBe(dialog);
      expect(screen.getByLabelText(copy('Volume'))).toBe(volume);
      expect(screen.getByLabelText(copy('Comment'))).toBe(comment);
      expect(screen.getByLabelText(copy('Symbol'))).toBe(symbol);
      expect(screen.getByLabelText(copy('Fill policy'))).toBe(fillPolicy);
      expect(volume).toHaveValue('1.23');
      expect(comment).toHaveValue('custom');
      expect(symbol).toHaveValue('EURUSD');
      expect(symbol.selectedOptions[0]).toHaveTextContent(`EURUSD, ${copy('Euro / US Dollar')}`);
      expect(fillPolicy).toHaveValue('Return');
      expect(fillPolicy.selectedOptions[0]).toHaveTextContent(copy('Return'));
      expect(copy('Buy by Market')).not.toBe('Buy by Market');
      expect(copy('Sell by Market')).not.toBe('Sell by Market');
      expect(screen.getByRole('button', { name: copy('Buy by Market') })).toBe(buy);
      expect(screen.getByRole('button', { name: copy('Sell by Market') })).toBe(sell);
      expect(buy).toBeEnabled();
      expect(sell).toBeEnabled();
      expect(document.documentElement).toHaveAttribute('lang', language);
      expect(document.documentElement).toHaveAttribute('dir', 'ltr');
      expect(onSubmitOrder).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    }
  });
});
