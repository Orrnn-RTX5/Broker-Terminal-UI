import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Timeframe } from '../../types/chart';
import { TimeframePicker } from './TimeframePicker';

const EXPECTED_TIMEFRAMES = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1', 'MN'];

describe('TimeframePicker', () => {
  it('renders every timeframe in one horizontal strip', () => {
    render(
      <TimeframePicker
        timeframe="M1"
        advancedViewEnabled={false}
        onSelect={vi.fn()}
      />,
    );

    const group = screen.getByRole('radiogroup', { name: 'Chart timeframes' });
    const options = within(group).getAllByRole('radio');

    expect(group).toHaveAttribute('aria-orientation', 'horizontal');
    expect(group).toHaveClass('flex-nowrap', 'overflow-x-auto');
    expect(options.map((option) => option.textContent)).toEqual(EXPECTED_TIMEFRAMES);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('selects a timeframe directly from the strip', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <TimeframePicker
        timeframe="M1"
        advancedViewEnabled={false}
        onSelect={onSelect}
      />,
    );

    expect(screen.getByRole('radio', { name: 'M1 — Timeframe: 1 minute' })).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('radio', { name: 'M15 — Timeframe: 15 minutes' }));
    expect(onSelect).toHaveBeenCalledWith('M15');
  });

  it('keeps the horizontal group to one natural tab stop', async () => {
    const user = userEvent.setup();

    render(
      <div>
        <button type="button">Before timeframes</button>
        <TimeframePicker
          timeframe="M15"
          advancedViewEnabled={false}
          onSelect={vi.fn()}
        />
        <button type="button">After timeframes</button>
      </div>,
    );

    const options = screen.getAllByRole('radio');
    const selected = screen.getByRole('radio', { name: 'M15 — Timeframe: 15 minutes' });
    expect(selected).toHaveAttribute('tabindex', '0');
    options.filter((option) => option !== selected).forEach((option) => {
      expect(option).toHaveAttribute('tabindex', '-1');
    });

    screen.getByRole('button', { name: 'Before timeframes' }).focus();
    await user.tab();
    expect(selected).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'After timeframes' })).toHaveFocus();
  });

  it('supports horizontal arrow navigation plus Home and End', async () => {
    const user = userEvent.setup();
    const selections: Timeframe[] = [];

    const Harness = () => {
      const [timeframe, setTimeframe] = useState<Timeframe>('M15');
      return (
        <TimeframePicker
          timeframe={timeframe}
          advancedViewEnabled={false}
          onSelect={(nextTimeframe) => {
            selections.push(nextTimeframe);
            setTimeframe(nextTimeframe);
          }}
        />
      );
    };

    render(<Harness />);

    const selected = screen.getByRole('radio', { name: 'M15 — Timeframe: 15 minutes' });
    selected.focus();

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'M30 — Timeframe: 30 minutes' })).toHaveFocus();
    expect(screen.getByRole('radio', { name: 'M30 — Timeframe: 30 minutes' })).toBeChecked();

    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('radio', { name: 'M15 — Timeframe: 15 minutes' })).toHaveFocus();

    await user.keyboard('{End}');
    expect(screen.getByRole('radio', { name: 'MN — Timeframe: 1 month' })).toHaveFocus();

    await user.keyboard('{Home}');
    expect(screen.getByRole('radio', { name: 'M1 — Timeframe: 1 minute' })).toHaveFocus();
    expect(selections).toEqual(['M30', 'M15', 'MN', 'M1']);
  });

  it('wraps keyboard navigation at both ends', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <TimeframePicker
        timeframe="M1"
        advancedViewEnabled
        onSelect={onSelect}
      />,
    );

    const first = screen.getByRole('radio', { name: 'M1 — Timeframe: 1 minute' });
    first.focus();
    await user.keyboard('{ArrowLeft}');
    expect(onSelect).toHaveBeenLastCalledWith('MN');

    const last = screen.getByRole('radio', { name: 'MN — Timeframe: 1 month' });
    last.focus();
    await user.keyboard('{ArrowRight}');
    expect(onSelect).toHaveBeenLastCalledWith('M1');
  });
});
