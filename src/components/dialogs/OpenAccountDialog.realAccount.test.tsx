import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
    REAL_ACCOUNT_UNAVAILABLE_REASON,
    resolveRealAccountAvailability,
} from '../../services/realAccountAvailability';

const mocks = vi.hoisted(() => ({
    createAccount: vi.fn(),
    login: vi.fn(),
    persistBrokerSessionDiscovery: vi.fn(),
    updateDynamicUrls: vi.fn(),
    setAuthTokens: vi.fn(),
    setAuthenticated: vi.fn(),
    loadAppBrokerDirectory: vi.fn(),
    getCachedBrokerDirectory: vi.fn(),
    desktop: true,
    configuration: { valid: true, brokerTermsUrl: '' },
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
    isDesktopBackendTarget: () => mocks.desktop,
    getRuntimeBrokerConfiguration: () => mocks.configuration,
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

const plainBrokers = [
    {
        id: 1,
        broker_id: 'broker-one',
        broker_name: 'Broker One',
        server: 'one.example:443',
        server_url: 'https://one.example',
        backend_url: 'https://one-backend.example',
        market_api_url: 'https://one-market.example',
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
        enabled: true,
    },
];

const brokersWithRealContract = [
    plainBrokers[0],
    {
        ...plainBrokers[1],
        real_account_url: 'https://onboarding.example/real',
    },
];

describe('resolveRealAccountAvailability (broker-config driven)', () => {
    it.each([undefined, null, 'broker-two', 42, []])('resolves unsupported without a broker config entry: %s', (broker) => {
        expect(resolveRealAccountAvailability(broker)).toEqual({
            supported: false,
            onboardingUrl: null,
            reason: REAL_ACCOUNT_UNAVAILABLE_REASON,
        });
    });

    it('resolves unsupported when the broker config advertises no onboarding contract', () => {
        expect(resolveRealAccountAvailability(plainBrokers[1]).supported).toBe(false);
    });

    it.each(['', '   ', 'notaurl', 'javascript:alert(1)', 'ftp://files.example/kyc'])(
        'resolves unsupported for an unusable onboarding value: %s',
        (value) => {
            expect(resolveRealAccountAvailability({ ...plainBrokers[1], real_account_url: value }).supported).toBe(false);
        },
    );

    it.each([
        ['real_account_url', 'https://onboarding.example/real'],
        ['realAccountUrl', 'https://onboarding.example/real'],
        ['onboardingUrl', 'https://onboarding.example/start'],
        ['registrationUrl', 'https://onboarding.example/register'],
        ['signup_url', 'https://onboarding.example/signup'],
        ['kyc_url', 'https://onboarding.example/kyc'],
    ])('resolves supported from a broker-config onboarding contract: %s', (key, url) => {
        expect(resolveRealAccountAvailability({ ...plainBrokers[1], [key]: url })).toEqual({
            supported: true,
            onboardingUrl: url,
            reason: '',
        });
    });

    it('honours an explicit broker-config opt-out even when a contract URL is present', () => {
        const availability = resolveRealAccountAvailability({
            ...plainBrokers[1],
            real_account_url: 'https://onboarding.example/real',
            real_account_enabled: false,
        });
        expect(availability.supported).toBe(false);
        expect(availability.onboardingUrl).toBeNull();
    });

    it('never embeds tenant identifiers in the unavailable reason', () => {
        expect(REAL_ACCOUNT_UNAVAILABLE_REASON).not.toContain('broker-two');
        expect(REAL_ACCOUNT_UNAVAILABLE_REASON).not.toContain('Broker Two');
        expect(REAL_ACCOUNT_UNAVAILABLE_REASON).not.toMatch(/\d{6}/);
    });
});

describe('OpenAccountDialog real-account action (T16)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.desktop = true;
        mocks.configuration = { valid: true, brokerTermsUrl: '' };
        localStorage.clear();
        mocks.getCachedBrokerDirectory.mockReset().mockReturnValue(null);
        mocks.loadAppBrokerDirectory.mockReset().mockResolvedValue(plainBrokers);
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => plainBrokers,
        }));
    });

    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
    });

    it('disables Real with the selected broker reason and never closes without effect', async () => {
        const trackedClose = vi.fn();
        render(<OpenAccountDialog isOpen onClose={trackedClose} />);
        await screen.findAllByText('Broker One');

        fireEvent.click(screen.getByText('Broker Two'));
        fireEvent.click(screen.getByRole('button', { name: /Next/ }));
        const realOption = await screen.findByRole('radio', { name: 'Real account' });
        expect(realOption).toBeDisabled();
        // The reason names the broker taken from the selected broker config.
        const note = screen.getByRole('note');
        expect(note).toHaveTextContent('Broker Two');
        expect(note).toHaveTextContent(/Real-account creation is not enabled for this broker configuration/i);

        fireEvent.click(screen.getByRole('button', { name: /Next/ }));
        expect(screen.getByLabelText('First name')).toBeInTheDocument();
        expect(trackedClose).not.toHaveBeenCalled();
        expect(mocks.createAccount).not.toHaveBeenCalled();
        expect(mocks.login).not.toHaveBeenCalled();
    });

    it('advances a config-supported Real choice through the existing creation path', async () => {
        mocks.loadAppBrokerDirectory.mockResolvedValue(brokersWithRealContract);
        const onClose = vi.fn();
        mocks.createAccount.mockResolvedValue({
            login: 400002,
            currency: 'EUR',
            leverage: 200,
            group: 'live-standard',
        });
        render(<OpenAccountDialog isOpen onClose={onClose} />);
        await screen.findAllByText('Broker One');

        fireEvent.click(screen.getByText('Broker Two'));
        fireEvent.click(screen.getByRole('button', { name: /Next/ }));
        const realOption = await screen.findByRole('radio', { name: 'Real account' });
        expect(realOption).toBeEnabled();
        expect(screen.queryByRole('note')).not.toBeInTheDocument();

        fireEvent.click(realOption);
        fireEvent.click(screen.getByRole('button', { name: /Next/ }));
        // Advances instead of dead-closing: the shared details form opens.
        expect(screen.getByLabelText('First name')).toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();

        fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Robin' } });
        fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Sharma' } });
        fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'robin@example.com' } });
        fireEvent.change(screen.getByLabelText('Mobile phone'), { target: { value: '+91 98 0000 0000' } });
        fireEvent.click(screen.getByRole('button', { name: /Next/ }));
        fireEvent.change(screen.getByLabelText('Currency'), { target: { value: 'EUR' } });
        fireEvent.change(screen.getByLabelText('Leverage'), { target: { value: '200' } });
        fireEvent.click(screen.getByLabelText('Accept account terms'));
        fireEvent.click(screen.getByRole('button', { name: 'Create Real Account' }));

        // Same existing account-creation wiring and request shape as demo.
        await waitFor(() => expect(mocks.createAccount).toHaveBeenCalledTimes(1));
        expect(mocks.createAccount).toHaveBeenCalledWith({
            name: 'Robin Sharma',
            email: 'robin@example.com',
            phone: '+91 98 0000 0000',
            country: 'US',
            currency: 'EUR',
            leverage: 200,
        }, {
            baseUrl: 'https://two-market.example/api/v2',
            skipDynamicUrl: true,
        });
        expect(await screen.findByText('Registration Complete')).toBeInTheDocument();
        expect(screen.getByText(/Your real account has been successfully created/i)).toBeInTheDocument();
        // The dialog only closes after the creation took effect.
        expect(onClose).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(mocks.login).not.toHaveBeenCalled();
    });
});
