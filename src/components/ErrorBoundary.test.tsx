// @vitest-environment jsdom

import { lazy, Suspense, useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

vi.mock('../hooks/useUiTranslation', () => ({
  translateUi: (source: string) => source,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Deferred component recovery', () => {
  it.each([
    'Failed to fetch dynamically imported module: https://terminal.example/assets/JournalTab-old.js',
    'error loading dynamically imported module: https://terminal.example/assets/JournalTab-old.js',
    'Importing a module script failed.',
  ])('offers an explicit reload for a rejected lazy import: %s', async (message) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const reload = vi.fn();
    vi.stubGlobal('window', new Proxy(window, {
      get(target, property) {
        return property === 'location' ? { reload } : Reflect.get(target, property, target);
      },
    }));
    const loadJournal = vi.fn(() => Promise.reject(new TypeError(message)));
    const Journal = lazy(loadJournal);

    render(
      <>
        <section aria-label="Trading terminal">Chart stays open</section>
        <ErrorBoundary label="Journal">
          <Suspense fallback="Loading journal"><Journal /></Suspense>
        </ErrorBoundary>
      </>,
    );

    const button = await screen.findByRole('button', { name: 'Reload terminal' });
    expect(reload).not.toHaveBeenCalled();
    expect(loadJournal).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Trading terminal' })).toBeVisible();

    fireEvent.click(button);

    expect(reload).toHaveBeenCalledTimes(1);
    expect(loadJournal).toHaveBeenCalledTimes(1);
  });

  it('keeps ordinary fetch and rendering TypeErrors on the normal Retry path', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let fails = true;
    function Panel() {
      if (fails) throw new TypeError('Failed to fetch');
      return <div>Panel recovered</div>;
    }

    render(<ErrorBoundary><Panel /></ErrorBoundary>);

    expect(screen.queryByRole('button', { name: 'Reload terminal' })).not.toBeInTheDocument();
    fails = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(screen.getByText('Panel recovered')).toBeVisible();
  });
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
