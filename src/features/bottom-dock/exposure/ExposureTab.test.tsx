import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ExposureTab } from './ExposureTab';

describe('ExposureTab', () => {
  it('uses the full tab width and reports an empty exposure honestly', () => {
    const { container } = render(
      <ExposureTab positions={[]} account={null} formatMoney={(value) => String(value ?? '—')} />,
    );

    expect(screen.getByText('No active asset exposure')).toBeInTheDocument();
    expect(screen.getByText('Assets')).toBeInTheDocument();
    expect(container.querySelector('.rtx-exposure-tab > .flex.min-w-0.flex-1.flex-col')).toBeInTheDocument();
    expect(container).not.toHaveTextContent('Long Positions');
  });

  it('renders the extracted exposure model without changing asset semantics', () => {
    render(
      <ExposureTab
        positions={[{
          symbol: 'XAUUSD',
          side: 'BUY',
          volume: 0.01,
          currentPrice: 2000,
        }]}
        account={{
          balance: 10000,
          equity: 10000,
          margin: 20,
          freeMargin: 9980,
          currency: 'USD',
        }}
        formatMoney={(value) => Number(value ?? 0).toFixed(2)}
      />,
    );

    expect(screen.getByText('XAU')).toBeInTheDocument();
    expect(screen.getAllByText('USD')).toHaveLength(2);
    expect(screen.getByText('1.00')).toBeInTheDocument();
  });
});
