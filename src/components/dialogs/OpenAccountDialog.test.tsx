import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
    createAccount: vi.fn(),
    login: vi.fn(),
    persistBrokerSessionDiscovery: vi.fn(),
    updateDynamicUrls: vi.fn(),
    setAuthTokens: vi.fn(),
    setAuthenticated: vi.fn(),
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
    normalizeBrokerInfoForTarget: (broker: Record<string, unknown>) => broker,
    resolveBrokerBackendUrl: (broker: Record<string, unknown>) =>
        String(broker.backend_url || broker.server_url || broker.server || ''),
    resolveBrokerExtApiUrl: (broker: Record<string, unknown>) =>
        String(broker.market_api_url || broker.backend_url || broker.server_url || broker.server || ''),
}));

vi.mock('../../services/brokerSession', () => ({
    persistBrokerSessionDiscovery: mocks.persistBrokerSessionDiscovery,
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

const selectSecondBrokerAndContinue = async () => {
    fireEvent.click(screen.getByText('Broker Two'));
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    await screen.findByRole('radio', { name: 'Demo account' });
};

describe('OpenAccountDialog account flows', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
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
