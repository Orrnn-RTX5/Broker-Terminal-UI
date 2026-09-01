// @vitest-environment jsdom

import '@testing-library/jest-dom';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../ui/Icon', () => ({
    Icon: ({ name }: { name: string }) => <span data-testid={`icon-${name}`} />,
}));

import { DesktopQuickActions } from './DesktopQuickActions';
import { drawingManager } from '../../services/drawingManager';
import {
    activateActiveChartSource,
    clearActiveChartSources,
    registerActiveChartSource,
} from '../../services/activeChartSource';

const renderQuickActions = (overrides: Partial<React.ComponentProps<typeof DesktopQuickActions>> = {}) => {
    const props: React.ComponentProps<typeof DesktopQuickActions> = {
        advancedViewEnabled: false,
        advancedFontSize: 'normal',
        focusChart: false,
        activeDrawingTool: null,
        crosshairEnabled: false,
        accountId: '200002',
        accountName: 'Primary account',
        accountServer: 'Broker-Live',
        savedAccountCount: 2,
        symbol: 'XAUUSD',
        connectionState: 'connected',
        transportSecurity: 'secure',
        feedStatus: {
            symbols: ['XAUUSD'],
            loading: false,
            settled: true,
            current: true,
            error: null,
        },
        dispatchCommand: vi.fn(),
        onSetAdvancedViewEnabled: vi.fn(),
        onSetAdvancedFontSize: vi.fn(),
        onSetFocusChart: vi.fn(),
        onRefreshConnection: vi.fn(),
        onLogout: vi.fn(),
        ...overrides,
    };

    render(<DesktopQuickActions {...props} />);
    return props;
};

beforeEach(() => {
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
        expect(labels.slice(0, -1)).toEqual([
            'Search Symbols',
            'Advanced View Settings',
            'Crosshair',
            'Cursor',
            'Trend Line',
            'Horizontal Line',
            'Vertical Line',
            'Equidistant Channel',
            'Fibonacci Retracement',
            'Thumbs Up Stamp',
            'Stamp Picker',
            'Clear All Drawings',
            'Account',
        ]);
        expect(labels.at(-1)).toBe(
            'Connection details: Connected; secure transport; XAUUSD live feed verified',
        );
    });

    it('dispatches search, crosshair, drawing, stamp, and clear actions', () => {
        const chartContainer = document.createElement('div');
        document.body.appendChild(chartContainer);
        registerActiveChartSource({ id: 'chart-active', getContainer: () => chartContainer });
        activateActiveChartSource('chart-active');
        const openSymbolsSpy = vi.fn();
        window.addEventListener('openSymbolsDialog', openSymbolsSpy, { once: true });
        const clearAllSpy = vi.spyOn(drawingManager, 'clearAllDrawings');
        const props = renderQuickActions();

        fireEvent.click(screen.getByRole('button', { name: 'Search Symbols' }));
        expect(openSymbolsSpy).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole('button', { name: 'Crosshair' }));
        expect(props.dispatchCommand).toHaveBeenCalledWith({ type: 'TOGGLE_CROSSHAIR', payload: {} });

        fireEvent.click(screen.getByRole('button', { name: 'Trend Line' }));
        expect(props.dispatchCommand).toHaveBeenCalledWith({
            type: 'SELECT_TOOL',
            payload: { tool: 'trendline', subtype: undefined },
        });

        fireEvent.click(screen.getByRole('button', { name: 'Thumbs Up Stamp' }));
        expect(props.dispatchCommand).toHaveBeenCalledWith({
            type: 'SELECT_TOOL',
            payload: { tool: 'stamp', subtype: 'thumbsUp' },
        });

        fireEvent.click(screen.getByRole('button', { name: 'Clear All Drawings' }));
        expect(clearAllSpy).toHaveBeenCalledWith(true, 'chart-active');
        expect(props.dispatchCommand).toHaveBeenLastCalledWith({
            type: 'SELECT_TOOL',
            payload: { tool: 'cursor', targetContextId: 'chart-active' },
        });
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
        expect(within(accountMenu).getByText('Primary account · Broker-Live')).toBeInTheDocument();
        fireEvent.click(within(accountMenu).getByRole('menuitem', { name: 'Trading accounts' }));
        expect(tradingAccountsSpy).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole('button', { name: 'Account' }));
        fireEvent.click(within(screen.getByRole('menu', { name: 'Account' })).getByRole('menuitem', { name: 'Log out' }));

        expect(onLogout).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('menu', { name: 'Account' })).not.toBeInTheDocument();
    });

    it('opens exact selected-symbol connection details and refreshes the live sources', () => {
        const onRefreshConnection = vi.fn();
        renderQuickActions({
            symbol: 'EURUSD.r',
            transportSecurity: 'insecure',
            feedStatus: {
                symbols: ['EURUSD.R'],
                loading: true,
                settled: true,
                current: true,
                error: null,
            },
            onRefreshConnection,
        });

        fireEvent.click(screen.getByRole('button', {
            name: 'Connection details: Connected; insecure transport; EURUSD.R live feed verified',
        }));
        const connectionMenu = screen.getByRole('menu', { name: 'Connection' });
        expect(within(connectionMenu).getByText('EURUSD.r')).toBeInTheDocument();
        expect(within(connectionMenu).getByText('WS insecure')).toBeInTheDocument();
        fireEvent.click(within(connectionMenu).getByRole('menuitem', { name: 'Refresh connection' }));

        expect(onRefreshConnection).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('menu', { name: 'Connection' })).not.toBeInTheDocument();
    });
});
