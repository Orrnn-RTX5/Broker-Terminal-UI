import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LoginDialog } from './LoginDialog';

const runtime = vi.hoisted(() => ({ login: vi.fn(), persist: vi.fn() }));
vi.mock('../hooks/useUiTranslation', () => ({ useUiTranslation: () => (text: string) => text }));
vi.mock('../api/trade', () => ({ authV2Api: { login: runtime.login } }));
vi.mock('../services/brokerSession', () => ({ persistBrokerSessionDiscovery: runtime.persist }));
vi.mock('../store/useAppStore', () => ({ useAppStore: { getState: () => ({ accountId: '' }) } }));
vi.mock('../config/api', () => ({
  BROKER_DISCOVERY_URL: 'https://directory.test',
  normalizeBrokerServerUrl: (url: string) => url,
  toLocalDevProxyUrl: (url: string) => url,
  updateDynamicUrls: vi.fn(),
}));
vi.mock('../config/backendTarget.js', async importOriginal => ({
  ...await importOriginal<typeof import('../config/backendTarget.js')>(),
  isDesktopBackendTarget: () => true,
  getBackendTarget: () => 'https://superbackend.orrnn.com',
  normalizeBrokerInfoForTarget: (broker: unknown) => broker,
  resolveBrokerBackendUrl: () => 'https://wrong-environment.test',
  resolveBrokerExtApiUrl: () => 'https://wrong-environment.test',
}));
vi.mock('./WelcomeTerminal', () => ({ pickDiscoveryBroker: (rows: unknown[]) => rows[0] }));

const brokers = [
  { broker_id: 'achiever', broker_name: 'Achiever Financials', server_url: 'https://achiever.test' },
  { broker_id: 'Nexa', broker_name: 'Nexa', server_url: 'https://nexa.test' },
  { broker_id: 'disabled', broker_name: 'Disabled Broker', server_url: 'https://disabled.test', enabled: false },
];
const fetchMock = vi.fn();
beforeEach(() => {
  (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__ = { BACKEND_TARGET: 'desktop' };
  vi.clearAllMocks();
  localStorage.clear();
  fetchMock.mockImplementation(async (url: string) => new Response(JSON.stringify(url.endsWith('/broker/servers') ? brokers : { status: 'ok' })));
  vi.stubGlobal('fetch', fetchMock);
  runtime.login.mockRejectedValue(new Error('Test authentication rejected'));
});
afterEach(() => {
  delete (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__;
  vi.unstubAllGlobals();
});

it('explains the blocked guest trade and lets the user continue viewing without authentication', async () => {
  const close = vi.fn();
  render(<LoginDialog isOpen onClose={close} reason="trade" />);
  const dialog = screen.getByRole('dialog', { name: 'Log in to trade' });
  expect(dialog).toHaveAttribute('aria-modal', 'true');
  expect(dialog).toHaveTextContent('No order has been placed.');
  await screen.findByText('Server online');
  expect(screen.getByRole('button', { name: 'Log in' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Continue viewing' }));
  expect(close).toHaveBeenCalledOnce();
  expect(runtime.login).not.toHaveBeenCalled();
});

it('lists all servers before credentials, clears the password, and logs in to the selected directory endpoint', async () => {
  render(<LoginDialog isOpen onClose={vi.fn()} />);
  const server = screen.getByRole('combobox', { name: 'Server' });
  await screen.findByText('Server online');
  expect(screen.getByRole('option', { name: 'Achiever Financials' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Nexa' })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'Grow Trading Academy' })).not.toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'MyProp' })).not.toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Disabled Broker (Unavailable)' })).toBeDisabled();
  const account = screen.getByPlaceholderText('Account ID');
  const password = screen.getByPlaceholderText('Password');
  expect(screen.getByLabelText('Account ID', { exact: true })).toBe(account);
  expect(screen.getByLabelText('Password', { exact: true })).toBe(password);
  expect(server.compareDocumentPosition(account) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.change(password, { target: { value: 'old-password' } });
  fireEvent.change(server, { target: { value: 'Nexa' } });
  expect(password).toHaveValue('');
  await screen.findByText('Server online');
  expect(fetchMock).toHaveBeenCalledWith('https://nexa.test/health', expect.anything());
  fireEvent.change(account, { target: { value: '12345' } });
  fireEvent.change(password, { target: { value: 'new-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
  await waitFor(() => expect(runtime.login).toHaveBeenCalledWith(
    { username: '12345', password: 'new-password', broker_id: 'Nexa' },
    expect.objectContaining({ baseUrl: 'https://nexa.test/api/v2', skipDynamicUrl: true }),
  ));
  await screen.findByText('Test authentication rejected');
});

it('blocks credentials and login when the selected server is offline', async () => {
  fetchMock.mockImplementation(async (url: string) => new Response(JSON.stringify(url.endsWith('/broker/servers') ? brokers : {}), { status: url.endsWith('/health') ? 503 : 200 }));
  render(<LoginDialog isOpen onClose={vi.fn()} />);
  await screen.findByText('Server unavailable');
  expect(screen.getByPlaceholderText('Password')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Log in' })).toBeDisabled();
  fireEvent.submit(screen.getByRole('button', { name: 'Log in' }).closest('form')!);
  expect(runtime.login).not.toHaveBeenCalled();
});
