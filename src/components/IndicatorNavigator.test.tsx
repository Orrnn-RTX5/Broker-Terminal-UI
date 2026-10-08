// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { IndicatorNavigator } from './IndicatorNavigator';
import { isIndicatorSupported } from '../utils/indicatorSupport';

describe('IndicatorNavigator availability contract', () => {
  it('adds supported indicators and keeps unsupported entries non-interactive', () => {
    const onAddIndicator = vi.fn();
    render(
      <IndicatorNavigator
        isOpen
        onClose={vi.fn()}
        onAddIndicator={onAddIndicator}
      />,
    );

    const movingAverage = screen.getByText('Moving Average').closest('div[aria-disabled]');
    expect(movingAverage).toHaveAttribute('aria-disabled', 'false');
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]);
    expect(onAddIndicator).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Moving Average',
      category: 'Trend',
    }));

    const ichimoku = screen.getByText('Ichimoku Cloud').closest('div[aria-disabled]');
    expect(ichimoku).toHaveAttribute('aria-disabled', 'true');
    fireEvent.doubleClick(ichimoku!);
    expect(onAddIndicator).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('button', { name: 'Unavailable' })[0]).toBeDisabled();
  });

  it('recognizes persisted unique IDs by their indicator prefix', () => {
    expect(isIndicatorSupported('macd-1700000000000')).toBe(true);
    expect(isIndicatorSupported('volume')).toBe(true);
    expect(isIndicatorSupported('ichimoku-1700000000000')).toBe(false);
  });

  it('preserves the Volume Enable action and its chart command payload', () => {
    const onAddIndicator = vi.fn();
    render(
      <IndicatorNavigator
        isOpen
        initialCategory="Volume"
        onClose={vi.fn()}
        onAddIndicator={onAddIndicator}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Enable' }));

    expect(onAddIndicator).toHaveBeenCalledExactlyOnceWith({
      id: expect.stringMatching(/^volume-\d+$/),
      name: 'Volume',
      category: 'Volume',
      description: 'Trading volume bars',
      parameters: {},
    });
  });
});

describe('IndicatorNavigator browsing and keyboard interactions', () => {
  it('shows an empty state for a category and search intersection, then finds the indicator in All', () => {
    render(
      <IndicatorNavigator
        isOpen
        initialCategory="Trend"
        onClose={vi.fn()}
        onAddIndicator={vi.fn()}
      />,
    );

    const search = screen.getByRole('textbox', { name: 'Search indicators...' });
    fireEvent.change(search, { target: { value: 'RSI' } });

    expect(screen.getByRole('button', { name: 'Trend' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('No indicators found matching "RSI"');
    expect(screen.queryByRole('heading', { name: 'RSI' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'All' }));

    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Trend' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'RSI' })).toBeInTheDocument();
  });

  it('names the modal and close control, and handles Escape without sending it to the terminal', () => {
    const onClose = vi.fn();
    const onTerminalKeyDown = vi.fn();
    render(
      <div onKeyDown={onTerminalKeyDown}>
        <IndicatorNavigator isOpen onClose={onClose} onAddIndicator={vi.fn()} />
      </div>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Indicators' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');

    expect(fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onTerminalKeyDown).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('keeps forward and reverse Tab navigation inside the modal, skipping unavailable actions', async () => {
    const user = userEvent.setup();
    render(<IndicatorNavigator isOpen onClose={vi.fn()} onAddIndicator={vi.fn()} />);

    const close = screen.getByRole('button', { name: 'Close' });
    const lastAvailableAction = screen.getByRole('button', { name: 'Enable' });
    close.focus();
    expect(close).toHaveFocus();

    await user.tab({ shift: true });
    expect(lastAvailableAction).toHaveFocus();

    await user.tab();
    expect(close).toHaveFocus();

    await user.tab();
    expect(screen.getByRole('textbox', { name: 'Search indicators...' })).toHaveFocus();
  });

  it('focuses search on opening and restores focus to the opener when isOpen becomes false', () => {
    const onClose = vi.fn();
    const onAddIndicator = vi.fn();
    const contents = (isOpen: boolean) => (
      <>
        <button type="button">Open indicators</button>
        <IndicatorNavigator isOpen={isOpen} onClose={onClose} onAddIndicator={onAddIndicator} />
      </>
    );
    const { rerender } = render(contents(false));
    const opener = screen.getByRole('button', { name: 'Open indicators' });
    opener.focus();

    rerender(contents(true));
    expect(screen.getByRole('textbox', { name: 'Search indicators...' })).toHaveFocus();

    rerender(contents(false));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();

    rerender(contents(true));
    expect(screen.getByRole('textbox', { name: 'Search indicators...' })).toHaveFocus();
  });
});
