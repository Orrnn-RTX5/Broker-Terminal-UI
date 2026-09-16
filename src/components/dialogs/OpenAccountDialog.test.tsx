import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
    createAccount: vi.fn(),
    login: vi.fn(),
    persistBrokerSessionDiscovery: vi.fn(),
    updateDynamicUrls: vi.fn(),
    setAuthTokens: vi.fn(),
    setAuthenticated: vi.fn(),
    loadBrokerDirectory: vi.fn(),
    loadAppBrokerDirectory: vi.fn(),
    getCachedBrokerDirectory: vi.fn(),
}));

vi.mock('../../api/trade', () => ({
    tradeApi: {
        account: { create: mocks.createAccount },
        auth: { login: mocks.login },
    },
}));

vi.mock('../../api/client', () => ({
    parseTokenExpiresAt: vi.fn(() => 1_900_000_000_000),
}));

vi.mock('../../config/api', () => ({
    BROKER_DISCOVERY_URL: 'https://directory.test',
    normalizeBrokerServerUrl: (value: string) => value.replace(/\/$/, ''),
    updateDynamicUrls: mocks.updateDynamicUrls,
}));

vi.mock('../../config/backendTarget.js', () => ({
    isDesktopBackendTarget: () => true,
    normalizeBrokerInfoForTarget: (broker: Record<string, unknown>) => broker,
    resolveBrokerBackendUrl: (broker: Record<string, unknown>) =>
        String(broker.backend_url || broker.server_url || broker.server || ''),
    resolveBrokerExtApiUrl: (broker: Record<string, unknown>) =>
        String(broker.market_api_url || broker.backend_url || broker.server_url || broker.server || ''),
}));

vi.mock('../../services/brokerSession', () => ({
    persistBrokerSessionDiscovery: mocks.persistBrokerSessionDiscovery,
}));

vi.mock('../../services/brokerDirectory', () => ({
    loadBrokerDirectory: mocks.loadAppBrokerDirectory,
    loadAppBrokerDirectory: mocks.loadAppBrokerDirectory,
    getCachedBrokerDirectory: mocks.getCachedBrokerDirectory,
}));

vi.mock('../../store/useAppStore', () => ({
    useAppStore: {
        getState: () => ({
            setAuthTokens: mocks.setAuthTokens,
            setAuthenticated: mocks.setAuthenticated,
        }),
    },
}));

import { OpenAccountDialog } from './OpenAccountDialog';

const brokers = [
    {
        id: 1,
        broker_id: 'broker-one',
        broker_name: 'Broker One',
        server: 'one.example:443',
        server_url: 'https://one.example',
        backend_url: 'https://one-backend.example',
        market_api_url: 'https://one-market.example',
        server_ip: '192.0.2.1',
        server_port: 443,
        enabled: true,
    },
    {
        id: 2,
        broker_id: 'broker-two',
        broker_name: 'Broker Two',
        server: 'two.example:443',
        server_url: 'https://two.example',
        backend_url: 'https://two-backend.example',
        market_api_url: 'https://two-market.example',
        server_ip: '192.0.2.2',
        server_port: 443,
        enabled: true,
    },
];

const renderDialog = async (onClose = vi.fn()) => {
    render(<OpenAccountDialog isOpen onClose={onClose} />);
    await screen.findAllByText('Broker One');
    return onClose;
};

const pending = <T,>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
};

const selectSecondBrokerAndContinue = async () => {
    fireEvent.click(screen.getByText('Broker Two'));
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    await screen.findByRole('radio', { name: 'Demo account' });
};

describe('OpenAccountDialog account flows', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        mocks.loadAppBrokerDirectory.mockReset().mockResolvedValue(brokers);
        mocks.getCachedBrokerDirectory.mockReset().mockReturnValue(null);
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => brokers,
        }));
    });

    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
    });

    it('opens a warm directory with broker selection and Next available immediately', () => {
        vi.stubGlobal('electron', { window: {} });
        mocks.getCachedBrokerDirectory.mockReturnValue(brokers);
        mocks.loadAppBrokerDirectory.mockReturnValue(new Promise(() => {}));
        render(<OpenAccountDialog isOpen onClose={vi.fn()} />);

        expect(screen.getByText('Broker One')).toBeInTheDocument();
        expect(screen.getByText('Broker Two')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
        expect(screen.queryByText(/Loading brokers/i)).not.toBeInTheDocument();
        expect(mocks.persistBrokerSessionDiscovery).not.toHaveBeenCalled();
        expect(mocks.updateDynamicUrls).not.toHaveBeenCalled();
    });

    it('preloads while closed and completes an opened picker without changing the active session', async () => {
        vi.stubGlobal('electron', { window: {} });
        const directory = pending<typeof brokers>();
        mocks.loadAppBrokerDirectory.mockReturnValue(directory.promise);
        const onClose = vi.fn();
        const dialog = render(<OpenAccountDialog isOpen={false} onClose={onClose} />);
        expect(mocks.loadAppBrokerDirectory).toHaveBeenCalled();
        expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();

        dialog.rerender(<OpenAccountDialog isOpen onClose={onClose} />);
        expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
        await act(async () => directory.resolve(brokers));
        expect(screen.getByText('Broker One')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
        expect(mocks.persistBrokerSessionDiscovery).not.toHaveBeenCalled();
        expect(mocks.updateDynamicUrls).not.toHaveBeenCalled();
    });

    it('ignores an earlier opening request that finishes after the reopened picker has newer brokers', async () => {
        vi.stubGlobal('electron', { window: {} });
        const earlier = pending<typeof brokers>();
        const latest = pending<typeof brokers>();
        let activeRequest = earlier.promise;
        mocks.loadAppBrokerDirectory.mockImplementation(() => activeRequest);
        const onClose = vi.fn();
        const dialog = render(<OpenAccountDialog isOpen onClose={onClose} />);
        dialog.rerender(<OpenAccountDialog isOpen={false} onClose={onClose} />);
        activeRequest = latest.promise;
        dialog.rerender(<OpenAccountDialog isOpen onClose={onClose} />);

        await act(async () => latest.resolve([brokers[1]]));
        expect(screen.getByText('Broker Two')).toBeInTheDocument();
        await act(async () => earlier.resolve([brokers[0]]));
        expect(screen.getByText('Broker Two')).toBeInTheDocument();
        expect(screen.queryByText('Broker One')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
    });

    it('keeps Next disabled after a directory failure and lets Retry recover the picker', async () => {
        vi.stubGlobal('electron', { window: {} });
        mocks.loadAppBrokerDirectory.mockRejectedValue(new Error('Directory unavailable'));
        render(<OpenAccountDialog isOpen onClose={vi.fn()} />);
        expect(await screen.findByRole('alert')).toHaveTextContent('Broker servers are unavailable');
        expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();

        mocks.loadAppBrokerDirectory.mockResolvedValue(brokers);
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        await screen.findByText('Broker One');
        expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('omits disabled, inactive, and suspended brokers from the cached picker', () => {
        vi.stubGlobal('electron', { window: {} });
        const unavailable = [
            { ...brokers[0], id: 3, broker_id: 'disabled', broker_name: 'Disabled Broker', enabled: false },
            { ...brokers[0], id: 4, broker_id: 'inactive', broker_name: 'Inactive Broker', active: false },
            { ...brokers[0], id: 5, broker_id: 'suspended', broker_name: 'Suspended Broker', status: 'suspended' },
        ];
        mocks.getCachedBrokerDirectory.mockReturnValue([...unavailable, brokers[1]]);
        mocks.loadAppBrokerDirectory.mockReturnValue(new Promise(() => {}));
        render(<OpenAccountDialog isOpen onClose={vi.fn()} />);

        expect(screen.getByText('Broker Two')).toBeInTheDocument();
        for (const broker of unavailable) expect(screen.queryByText(broker.broker_name)).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
        expect(screen.getByRole('radio', { name: 'Demo account' })).toBeInTheDocument();
    });

    it('keeps a typed desktop country through Back and sends its code to the broker', async () => {
        vi.stubGlobal('electron', { window: {} });
        mocks.createAccount.mockResolvedValue({ login: 400001, currency: 'USD', leverage: 100 });
        await renderDialog();
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
        fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Alex' } });
        fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Taylor' } });
        fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'alex@example.test' } });
        fireEvent.change(screen.getByRole('combobox', { name: 'Country' }), { target: { value: 'Canada' } });
        fireEvent.blur(screen.getByRole('combobox', { name: 'Country' }));
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
        expect(screen.getByRole('heading', { name: 'Demo Account Settings' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Back' }));
        expect(screen.getByLabelText('First name')).toHaveValue('Alex');
        expect(screen.getByRole('combobox', { name: 'Country' })).toHaveValue('Canada');
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
        fireEvent.click(screen.getByLabelText('Accept account terms'));
        fireEvent.click(screen.getByRole('button', { name: 'Create Demo Account' }));
        await waitFor(() => expect(mocks.createAccount).toHaveBeenCalledWith(
            expect.objectContaining({ country: 'CA', name: 'Alex Taylor', email: 'alex@example.test' }),
            expect.objectContaining({ baseUrl: 'https://one-market.example/api/v2', skipDynamicUrl: true }),
        ));
    });

    it('keeps desktop details open until a typed country is resolved', async () => {
        vi.stubGlobal('electron', { window: {} });
        await renderDialog();
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
        fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Alex' } });
        fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Taylor' } });
        fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'alex@example.test' } });
        fireEvent.change(screen.getByRole('combobox', { name: 'Country' }), { target: { value: 'Unknown country' } });
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
        expect(screen.getByRole('combobox', { name: 'Country' })).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByRole('heading', { name: 'Demo Account Details' })).toBeInTheDocument();
        expect(mocks.createAccount).not.toHaveBeenCalled();
        fireEvent.change(screen.getByRole('combobox', { name: 'Country' }), { target: { value: 'NZ' } });
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
        expect(screen.getByRole('heading', { name: 'Demo Account Settings' })).toBeInTheDocument();
    });

    it('starts demo registration with empty personal data and no prefilled credentials', async () => {
        await renderDialog();
        fireEvent.click(screen.getByRole('button', { name: /Next/ }));
        fireEvent.click(screen.getByRole('button', { name: /Next/ }));

        expect(screen.getByLabelText('First name')).toHaveValue('');
        expect(screen.getByLabelText('Last name')).toHaveValue('');
        expect(screen.getByLabelText('Email')).toHaveValue('');
        expect(screen.queryByDisplayValue('Strong-Pass-123')).not.toBeInTheDocument();
        expect(screen.queryByDisplayValue('Read-Only-Pass')).not.toBeInTheDocument();
        expect(mocks.createAccount).not.toHaveBeenCalled();
    });

    it('creates only a demo account through the selected broker API', async () => {
        mocks.createAccount.mockResolvedValue({
            login: 400001,
            currency: 'EUR',
            leverage: 200,
            group: 'demo-standard',
        });
        await renderDialog();
        await selectSecondBrokerAndContinue();

        fireEvent.click(screen.getByRole('button', { name: /Next/ }));
        fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Ada' } });
        fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Lovelace' } });
        fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
        fireEvent.change(screen.getByLabelText('Mobile phone'), { target: { value: '+44 20 0000 0000' } });
        fireEvent.click(screen.getByRole('button', { name: /Next/ }));
        fireEvent.change(screen.getByLabelText('Currency'), { target: { value: 'EUR' } });
        fireEvent.change(screen.getByLabelText('Leverage'), { target: { value: '200' } });
        fireEvent.click(screen.getByLabelText('Accept account terms'));
        fireEvent.click(screen.getByRole('button', { name: 'Create Demo Account' }));

        await waitFor(() => expect(mocks.createAccount).toHaveBeenCalledTimes(1));
        expect(mocks.createAccount).toHaveBeenCalledWith({
            name: 'Ada Lovelace',
            email: 'ada@example.com',
            phone: '+44 20 0000 0000',
            country: 'US',
            currency: 'EUR',
            leverage: 200,
        }, {
            baseUrl: 'https://two-market.example/api/v2',
            skipDynamicUrl: true,
        });
        expect(mocks.createAccount.mock.calls[0][0]).not.toHaveProperty('master_pass');
        expect(mocks.createAccount.mock.calls[0][0]).not.toHaveProperty('investor_pass');
        expect(await screen.findByText('Registration Complete')).toBeInTheDocument();
        expect(mocks.login).not.toHaveBeenCalled();
    });

    it('connects an existing account through broker auth and commits the returned session', async () => {
        const onClose = vi.fn();
        mocks.login.mockResolvedValue({
            access_token: 'account-token',
            refresh_token: 'refresh-token',
            expires_at: 1_900_000_000,
            account_login: 200009,
            broker_id: 'broker-two',
            user: { username: 'Existing Trader' },
        });
        await renderDialog(onClose);
        await selectSecondBrokerAndContinue();

        fireEvent.click(screen.getByRole('radio', { name: 'Existing account' }));
        fireEvent.change(screen.getByLabelText('Existing account ID'), { target: { value: '200009' } });
        fireEvent.change(screen.getByLabelText('Existing account password'), { target: { value: 'runtime-secret' } });
        fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

        await waitFor(() => expect(mocks.login).toHaveBeenCalledTimes(1));
        expect(mocks.login).toHaveBeenCalledWith({
            username: '200009',
            password: 'runtime-secret',
            broker_id: 'broker-two',
        }, {
            baseUrl: 'https://two-market.example/api/v2',
            skipDynamicUrl: true,
        });
        expect(mocks.persistBrokerSessionDiscovery).toHaveBeenCalledWith(expect.objectContaining({
            access_token: 'account-token',
            broker_id: 'broker-two',
            market_api_url: 'https://two-market.example',
        }));
        expect(mocks.setAuthTokens).toHaveBeenCalledWith('account-token', 'refresh-token', 1_900_000_000_000);
        expect(mocks.setAuthenticated).toHaveBeenCalledWith(
            true,
            '200009',
            'account-token',
            'refresh-token',
            1_900_000_000_000,
            expect.objectContaining({ login: 200009, server: 'Broker Two' }),
        );
        expect(localStorage.getItem('rtx_saved_password')).toBeNull();
        expect(mocks.createAccount).not.toHaveBeenCalled();
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not create a real account without a broker KYC/onboarding contract', async () => {
        const onClose = vi.fn();
        await renderDialog(onClose);
        fireEvent.click(screen.getByRole('button', { name: /Next/ }));
        fireEvent.click(screen.getByRole('radio', { name: 'Real account' }));
        fireEvent.click(screen.getByRole('button', { name: /Next/ }));

        expect(await screen.findByText('Identity verification is required')).toBeInTheDocument();
        expect(screen.getByText(/will not create or fund a real account automatically/i)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Done' }));

        expect(onClose).toHaveBeenCalledTimes(1);
        expect(mocks.createAccount).not.toHaveBeenCalled();
        expect(mocks.login).not.toHaveBeenCalled();
    });

    it('validates demo identity and existing account credentials before any API call', async () => {
        await renderDialog();
        fireEvent.click(screen.getByRole('button', { name: /Next/ }));
        fireEvent.click(screen.getByRole('button', { name: /Next/ }));
        fireEvent.click(screen.getByRole('button', { name: /Next/ }));

        expect(screen.getByRole('alert')).toHaveTextContent('First name and last name are required.');
        expect(mocks.createAccount).not.toHaveBeenCalled();

        cleanup();
        await renderDialog();
        fireEvent.click(screen.getByRole('button', { name: /Next/ }));
        fireEvent.click(screen.getByRole('radio', { name: 'Existing account' }));
        fireEvent.change(screen.getByLabelText('Existing account ID'), { target: { value: 'not-an-account' } });
        fireEvent.change(screen.getByLabelText('Existing account password'), { target: { value: 'secret' } });
        fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid positive account ID.');
        expect(mocks.login).not.toHaveBeenCalled();
    });
});
