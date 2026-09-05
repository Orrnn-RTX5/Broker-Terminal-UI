// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { IndicatorNavigator, isIndicatorSupported } from './IndicatorNavigator';

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
});
