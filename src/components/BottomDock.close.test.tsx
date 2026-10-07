// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BottomDock } from './BottomDock';
import { DockPanel } from './dock/DockPanel';

const toolboxMocks = vi.hoisted(() => ({
    refresh: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../hooks/useToolboxTradeData', () => ({
    useToolboxTradeData: () => ({
        account: null,
        positions: [],
        pendingPositions: [],
        loading: false,
        error: null,
        login: null,
        restBaseUrl: '',
        wsUrl: '',
        wsState: 'connected',
        lastRestAt: null,
        lastWsAt: null,
        debug: [],
        refresh: toolboxMocks.refresh,
        removePosition: vi.fn(),
        removePositionsByMode: vi.fn(),
    }),
}));

// This suite verifies the real dock shell and its controls. Individual tab
// bodies have their own integration tests and should not start downloads,
// account-history subscriptions, or Journal filters when switching sections.
vi.mock('../features/bottom-dock/trade/TradeTab', () => ({ TradeTab: () => null }));
vi.mock('../features/bottom-dock/history/HistoryTab', () => ({ HistoryTab: () => null }));
vi.mock('../features/bottom-dock/exposure/ExposureTab', () => ({ ExposureTab: () => null }));
vi.mock('../features/bottom-dock/toolbox/ToolboxTab', () => ({ ToolboxTab: () => null }));
vi.mock('./HistoryDownloader', () => ({ HistoryDownloader: () => null }));
vi.mock('./layout/JournalTab', () => ({ JournalTab: () => null }));

const TAB_LABELS = [
    'Trade',
    'History',
    'Exposure',
    'Toolbox',
    'Historical Data',
    'News',
    'Mailbox',
    'Calendar',
    'Company',
    'Alerts',
    'Articles',
    'Code Base',
    'Experts',
    'Journal',
];

describe('Toolbox header close control', () => {
    beforeEach(() => {
        localStorage.clear();
        toolboxMocks.refresh.mockClear();
    });

    afterEach(() => {
        cleanup();
        localStorage.clear();
        vi.clearAllMocks();
    });

    it('closes the whole Toolbox from every available section without invoking trade actions', async () => {
        const onClose = vi.fn();
        const onCloseBulk = vi.fn();
        const onClosePosition = vi.fn();
        const onModifyPosition = vi.fn();
        const onCancelOrder = vi.fn();

        const { container } = render(
            <DockPanel
                panel={{
                    id: 'toolbox',
                    title: 'Toolbox',
                    component: 'Terminal',
                    closable: true,
                    ratio: 0.25,
                }}
                showHeader={false}
                onClose={onClose}
            >
                <BottomDock
                    height={300}
                    onClose={onClose}
                    onClosePosition={onClosePosition}
                    onModifyPosition={onModifyPosition}
                    onCancelOrder={onCancelOrder}
                    onCloseBulk={onCloseBulk}
                />
            </DockPanel>,
        );

        expect(screen.getByRole('button', { name: 'Close In-Profit' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Close In-Loss' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Close All' })).toBeInTheDocument();

        const tabStrip = within(container.querySelector<HTMLElement>('.rtx-bottom-dock__tabs')!);
        let sectionsClosed = 0;
        for (const tabLabel of TAB_LABELS) {
            const tab = tabStrip.getByText(tabLabel, { selector: '.rtx-dock-tab' });
            if ((tab as HTMLButtonElement).disabled) continue;
            await act(async () => { fireEvent.click(tab); });

            const closeButton = screen.getByRole('button', { name: 'Close Toolbox' });
            expect(closeButton.closest('.rtx-bottom-dock__header')).not.toBeNull();
            expect(tabStrip.queryByRole('button', { name: 'Close Toolbox' })).toBeNull();
            expect(tabStrip.queryByRole('button', { name: 'Minimize Toolbox' })).toBeNull();
            expect(tabStrip.queryByRole('button', { name: 'Restore Toolbox' })).toBeNull();
            expect(container.querySelectorAll('.dock-panel__header')).toHaveLength(1);

            fireEvent.click(closeButton);
            sectionsClosed += 1;
            expect(onClose).toHaveBeenCalledTimes(sectionsClosed);
        }

        expect(sectionsClosed).toBe(6);
        expect(onCloseBulk).not.toHaveBeenCalled();
        expect(onClosePosition).not.toHaveBeenCalled();
        expect(onModifyPosition).not.toHaveBeenCalled();
        expect(onCancelOrder).not.toHaveBeenCalled();
    });

    it('keeps News through Experts visible and locked', () => {
        render(
            <BottomDock
                height={300}
                onClosePosition={vi.fn()}
                onModifyPosition={vi.fn()}
            />,
        );

        const lockedTabs = [
            'News',
            'Mailbox',
            'Calendar',
            'Company',
            'Alerts',
            'Articles',
            'Code Base',
            'Experts',
        ];

        for (const label of lockedTabs) {
            const tab = screen.getByRole('button', { name: label });
            expect(tab).toBeDisabled();
            expect(tab).toHaveClass('rtx-dock-tab--locked');
            expect(tab.querySelector('[aria-hidden="true"]')).toBeTruthy();
            expect(tab.getAttribute('aria-description')).toContain('currently unavailable');
            fireEvent.click(tab);
        }

        expect(screen.getByRole('button', { name: 'Trade — Open positions and live account summary' })).toHaveClass('active-tab');
        fireEvent.click(screen.getByRole('button', { name: 'Journal — Terminal logs and connection events' }));
        expect(screen.getByRole('button', { name: 'Journal — Terminal logs and connection events' })).toHaveClass('active-tab');

        window.dispatchEvent(new CustomEvent('rtx:open-bottom-dock-tab', { detail: { tab: 'Calendar' } }));
        expect(screen.getByRole('button', { name: 'Journal — Terminal logs and connection events' })).toHaveClass('active-tab');
        expect(screen.getByRole('button', { name: 'Calendar' })).toBeDisabled();
    });
});
