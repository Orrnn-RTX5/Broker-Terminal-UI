// @vitest-environment jsdom

import '@testing-library/jest-dom';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../ui/Icon', () => ({
    Icon: ({ name }: { name: string }) => <span data-testid={`icon-${name}`} />,
}));

import { DesktopQuickActions, DesktopSymbolSearchButton } from './DesktopQuickActions';
import {
    activateActiveChartSource,
    clearActiveChartSources,
    registerActiveChartSource,
} from '../../services/activeChartSource';

const renderQuickActions = (overrides: Partial<React.ComponentProps<typeof DesktopQuickActions>> = {}) => {
    const props: React.ComponentProps<typeof DesktopQuickActions> = {
        accountId: '200002',
        accountName: 'Primary account',
        accountServer: 'Broker-Live',
        savedAccountCount: 2,
        onLogout: vi.fn(),
        ...overrides,
    };

    render(<DesktopQuickActions {...props} />);
    return props;
};

beforeEach(() => {
    localStorage.clear();
    clearActiveChartSources();
});

afterEach(() => {
    cleanup();
    clearActiveChartSources();
    vi.restoreAllMocks();
});

describe('DesktopQuickActions', () => {
    it('renders the reference controls in order inside the fixed right toolbar cluster', () => {
        renderQuickActions();

        const toolbar = screen.getByRole('toolbar', { name: 'Desktop quick actions' });
        expect(toolbar).toHaveAttribute('data-rtx-desktop-toolbar-cluster', 'right');
        expect(toolbar).toHaveClass('rtx-desktop-command-actions', 'ml-auto', 'shrink-0');
        const labels = within(toolbar).getAllByRole('button').map(button => button.getAttribute('aria-label'));
        expect(labels).toEqual([
            'Account',
        ]);
        expect(toolbar.querySelector('.rtx-desktop-connection-button')).toBeNull();
    });

    it('keeps search functional without the removed appearance and crosshair buttons', () => {
        const chartContainer = document.createElement('div');
        document.body.appendChild(chartContainer);
        registerActiveChartSource({ id: 'chart-active', getContainer: () => chartContainer });
        activateActiveChartSource('chart-active');
        const openSymbolsSpy = vi.fn();
        window.addEventListener('openSymbolsDialog', openSymbolsSpy, { once: true });
        renderQuickActions();

        render(<DesktopSymbolSearchButton />);
        fireEvent.click(screen.getByRole('button', { name: 'Search Symbols' }));
        expect(openSymbolsSpy).toHaveBeenCalledTimes(1);

        expect(screen.queryByRole('button', { name: 'Crosshair' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Advanced View Settings' })).not.toBeInTheDocument();

        expect(screen.queryByRole('group', { name: 'Drawing tools' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Stamp Picker' })).not.toBeInTheDocument();
    });

    it('uses the saved-account count and keeps account actions functional', () => {
        const onLogout = vi.fn();
        const tradingAccountsSpy = vi.fn();
        window.addEventListener('toggleAccountPanel', tradingAccountsSpy, { once: true });
        renderQuickActions({ onLogout, savedAccountCount: 105 });

        expect(screen.getByText('99+')).toHaveAttribute('title', '105 saved trading accounts');

        fireEvent.click(screen.getByRole('button', { name: 'Account' }));
        const accountMenu = screen.getByRole('menu', { name: 'Account' });
        expect(within(accountMenu).getByText('200002')).toBeInTheDocument();
        expect(within(accountMenu).getByText('Primary account')).toBeInTheDocument();
        expect(within(accountMenu).getByText('Broker-Live')).toBeInTheDocument();
        fireEvent.click(within(accountMenu).getByRole('menuitem', { name: 'Trading accounts' }));
        expect(tradingAccountsSpy).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole('button', { name: 'Account' }));
        fireEvent.click(within(screen.getByRole('menu', { name: 'Account' })).getByRole('menuitem', { name: 'Log out' }));

        expect(onLogout).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('menu', { name: 'Account' })).not.toBeInTheDocument();
    });

    it('shows the account ID, owner, and broker name without exposing the broker service URL', () => {
        const accountServer = 'https://service.achieverfinancials.com';
        renderQuickActions({
            accountId: '200032', accountName: 'Raj Halder', accountServer,
            accountBrokerName: 'Achiever Financials',
        });

        fireEvent.click(screen.getByRole('button', { name: 'Account' }));
        const accountMenu = screen.getByRole('menu', { name: 'Account' });
        expect(within(accountMenu).getByText('200032')).toBeInTheDocument();
        expect(within(accountMenu).getByText('Raj Halder')).toBeInTheDocument();
        expect(within(accountMenu).getByText('Achiever Financials')).toBeInTheDocument();
        expect(accountMenu).not.toHaveTextContent(accountServer);
    });

    it('uses the resolved broker presentation name for another service URL', () => {
        const accountServer = 'https://trading.example.com';
        renderQuickActions({ accountServer, accountBrokerName: 'Example Markets' });

        fireEvent.click(screen.getByRole('button', { name: 'Account' }));
        const accountMenu = screen.getByRole('menu', { name: 'Account' });
        expect(within(accountMenu).getByText('Example Markets')).toBeInTheDocument();
        expect(accountMenu).not.toHaveTextContent(accountServer);
    });

    it('keeps unknown URLs out of the account menu even when name metadata contains the URL', () => {
        const accountServer = 'https://unknown-broker.example.com';
        renderQuickActions({ accountServer, accountBrokerName: accountServer });

        fireEvent.click(screen.getByRole('button', { name: 'Account' }));
        const accountMenu = screen.getByRole('menu', { name: 'Account' });
        expect(within(accountMenu).getByText('200002')).toBeInTheDocument();
        expect(within(accountMenu).getByText('Primary account')).toBeInTheDocument();
        expect(accountMenu).not.toHaveTextContent(accountServer);
        expect(accountMenu).not.toHaveTextContent('unknown-broker.example.com');
    });

});
