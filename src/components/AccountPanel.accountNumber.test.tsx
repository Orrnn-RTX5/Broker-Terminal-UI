import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The account number is the broker login as issued, with no vendor prefix.
const gateway = vi.hoisted(() => ({ getAccount: vi.fn() }));
vi.mock('../api/tradeGateway', () => ({
  getStoredAccountLogin: () => 0,
  tradeGatewayApi: { getAccount: gateway.getAccount },
}));

import { AccountPanel } from './AccountPanel';
import { useAppStore } from '../store/useAppStore';

afterEach(() => {
  cleanup();
  gateway.getAccount.mockReset();
});

describe('AccountPanel account number', () => {
  it('shows the plain login before and after the profile loads', async () => {
    gateway.getAccount.mockResolvedValue({ leverage: 200 });
    useAppStore.setState({ accountId: '4242' });

    const view = render(<AccountPanel onClose={() => undefined} wsConnection={null} />);

    expect(screen.getAllByText('4242').length).toBeGreaterThan(0);
    await waitFor(() => expect(gateway.getAccount).toHaveBeenCalledWith(4242));
    expect(screen.getAllByText('4242').length).toBeGreaterThan(0);
    expect(view.container.textContent).not.toMatch(/RTX-?\d/);
  });
});
