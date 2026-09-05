import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CalendarTab } from './CalendarTab';

describe('CalendarTab', () => {
  it('renders a high-contrast event table with date groups and impact marks', () => {
    const { container } = render(<CalendarTab />);

    expect(container.querySelector('.rtx-calendar-tab')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Time' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Event' })).toBeInTheDocument();
    expect(screen.getByText('German PPI m/m')).toBeInTheDocument();
    expect(screen.getByText('Martin Luther King, Jr. Day')).toBeInTheDocument();
    expect(container.querySelector('.rtx-calendar-impact--high')).toBeTruthy();
    expect(container.querySelectorAll('.rtx-calendar-tab td.border-r')).toHaveLength(0);
  });

  it('filters events from the context menu and can restore all of them', () => {
    render(<CalendarTab />);

    fireEvent.contextMenu(screen.getByText('German PPI m/m'));
    const menu = screen.getByRole('menu', { name: 'Calendar filters' });
    fireEvent.click(within(menu).getByRole('menuitem', { name: /^Medium$/ }));

    expect(screen.queryByText('German PPI m/m')).not.toBeInTheDocument();
    expect(screen.getAllByText('Retail Sales m/m').length).toBeGreaterThan(0);

    fireEvent.contextMenu(screen.getAllByText('Retail Sales m/m')[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add All Events' }));
    expect(screen.getByText('German PPI m/m')).toBeInTheDocument();
  });
});
