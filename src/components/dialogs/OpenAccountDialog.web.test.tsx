import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OpenAccountDialog } from './OpenAccountDialog';
import { loadBrokerDirectory } from '../../services/brokerDirectory';
import { registerRuntimeBrokerDemoAccount } from '../../api/demoRegistration';
import { useAppStore } from '../../store/useAppStore';
import { installTestBrokerRuntime } from '../../test/brokerRuntime';

vi.mock('../../services/brokerDirectory', () => ({
  loadBrokerDirectory: vi.fn(), loadAppBrokerDirectory: vi.fn(), getCachedBrokerDirectory: vi.fn(),
}));
vi.mock('../../api/demoRegistration', () => ({ registerRuntimeBrokerDemoAccount: vi.fn() }));

let restoreRuntime: () => void;
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); useAppStore.getState().reset();
  vi.clearAllMocks();
  restoreRuntime = installTestBrokerRuntime({ CONFIG_SOURCE: 'deployment', BROKER_ID: 'Orrnn', DISCOVERY_BASE_URL: 'https://directory.example' });
  vi.mocked(loadBrokerDirectory).mockResolvedValue([
    { broker_id: 'other-broker', broker_name: 'Other Broker' },
    { broker_id: 'Orrnn', broker_name: 'Orrnn' },
  ]);
});
afterEach(() => { restoreRuntime(); localStorage.clear(); sessionStorage.clear(); });

describe('web Open an Account', () => {
  it('creates a demo for the deployment broker without offering other directory brokers', async () => {
    localStorage.setItem('broker_id', 'other-broker');
    vi.mocked(registerRuntimeBrokerDemoAccount).mockResolvedValue({ token: 'demo-token', login: 123456, broker_id: 'Orrnn' });
    const onClose = vi.fn();
    render(<OpenAccountDialog isOpen onClose={onClose} />);
    expect(screen.getByRole('heading', { name: 'Create demo account' })).toBeInTheDocument();
    expect(await screen.findByText('Orrnn')).toBeInTheDocument();
    expect(screen.queryByText('Other Broker')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Search brokers' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Demo User' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'demo@example.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Password1' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'Password1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create and continue' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(registerRuntimeBrokerDemoAccount).toHaveBeenCalledWith(expect.any(Object), 'Orrnn');
    expect(localStorage.getItem('broker_id')).toBe('Orrnn');
    expect(useAppStore.getState()).toMatchObject({ isAuthenticated: true, accountId: '123456' });
  });

  it('disables registration when the configured broker is absent from discovery', async () => {
    vi.mocked(loadBrokerDirectory).mockResolvedValue([{ broker_id: 'orrnn', broker_name: 'Other tenant' }]);
    render(<OpenAccountDialog isOpen onClose={vi.fn()} />);
    expect(await screen.findByText('This terminal does not have a verified broker configured.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create and continue' })).toBeDisabled();
    expect(registerRuntimeBrokerDemoAccount).not.toHaveBeenCalled();
  });

  it.each([
    ['https://legal.unknown-broker.example/terms', true], ['', false], ['javascript:alert(1)', false],
  ])('uses only valid configured account terms: %s', async (brokerTermsUrl, visible) => {
    const runtime = window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> };
    runtime.__RTX_RUNTIME_CONFIG__!.BROKER_TERMS_URL = brokerTermsUrl;
    render(<OpenAccountDialog isOpen onClose={vi.fn()} />);
    const link = screen.queryByRole('link', { name: 'Terms and data protection policy' });
    if (visible) expect(link).toHaveAttribute('href', brokerTermsUrl);
    else expect(link).toBeNull();
    expect(registerRuntimeBrokerDemoAccount).not.toHaveBeenCalled();
  });
});
