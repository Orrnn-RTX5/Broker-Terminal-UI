// @vitest-environment jsdom

import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

vi.mock('../hooks/useUiTranslation', () => ({
  translateUi: (source: string) => source,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('New Order error containment', () => {
  it('preserves the terminal when opening a failing ticket and recovers on Retry', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let ticketFails = true;

    function OrderTicket() {
      if (ticketFails) throw new Error('Ticket could not render');
      return <div role="dialog" aria-label="New Order">Order form</div>;
    }

    function Terminal() {
      const [orderOpen, setOrderOpen] = useState(false);
      return (
        <>
          <section aria-label="Trading terminal">
            <label>Chart symbol<input defaultValue="EURUSD" /></label>
            <button type="button" onClick={() => setOrderOpen(true)}>New Order</button>
          </section>
          {orderOpen && (
            <ErrorBoundary label="New Order">
              <OrderTicket />
            </ErrorBoundary>
          )}
        </>
      );
    }

    render(<Terminal />);
    const terminal = screen.getByRole('region', { name: 'Trading terminal' });
    const symbol = screen.getByRole('textbox', { name: 'Chart symbol' });
    fireEvent.change(symbol, { target: { value: 'GBPUSD' } });
    fireEvent.click(screen.getByRole('button', { name: 'New Order' }));

    expect(screen.getByRole('region', { name: 'Trading terminal' })).toBe(terminal);
    expect(symbol).toHaveValue('GBPUSD');
    expect(screen.getByText(/New Order.*Ticket could not render/)).toBeVisible();
    expect(screen.queryByRole('dialog', { name: 'New Order' })).not.toBeInTheDocument();

    ticketFails = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(screen.getByRole('dialog', { name: 'New Order' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Trading terminal' })).toBe(terminal);
    expect(symbol).toHaveValue('GBPUSD');
  });
});
