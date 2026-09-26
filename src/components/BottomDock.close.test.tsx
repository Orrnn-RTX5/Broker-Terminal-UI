// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

describe('Toolbox title-bar close control', () => {
    beforeEach(() => {
        localStorage.clear();
        toolboxMocks.refresh.mockClear();
    });

    afterEach(() => {
        cleanup();
        localStorage.clear();
        vi.clearAllMocks();
    });

    it('closes the whole Toolbox from every section without invoking trade bulk-close actions', () => {
        const onClose = vi.fn();
        const onCloseBulk = vi.fn();

        const { container } = render(
            <DockPanel
                panel={{
                    id: 'toolbox',
                    title: 'Toolbox',
                    component: 'Terminal',
                    closable: true,
                    ratio: 0.25,
                }}
                onClose={onClose}
            >
                <BottomDock
                    height={300}
                    onClosePosition={vi.fn()}
                    onModifyPosition={vi.fn()}
                    onCloseBulk={onCloseBulk}
                />
            </DockPanel>,
        );

        expect(screen.getByRole('button', { name: 'Close In-Profit' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Close In-Loss' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Close All' })).toBeInTheDocument();

        TAB_LABELS.forEach((tabLabel, index) => {
            fireEvent.click(screen.getByText(tabLabel, { selector: '.rtx-dock-tab' }));

            const closeButton = screen.getByTitle('Close');
            expect(closeButton.closest('.dock-panel__header')).not.toBeNull();
            expect(container.querySelector('.rtx-bottom-dock__close')).toBeNull();

            fireEvent.click(closeButton);
            expect(onClose).toHaveBeenCalledTimes(index + 1);
        });

        expect(onCloseBulk).not.toHaveBeenCalled();
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

        expect(screen.getByRole('button', { name: 'Open positions and live account summary' })).toHaveClass('active-tab');
        fireEvent.click(screen.getByRole('button', { name: 'Terminal logs and connection events' }));
        expect(screen.getByRole('button', { name: 'Terminal logs and connection events' })).toHaveClass('active-tab');

        window.dispatchEvent(new CustomEvent('rtx:open-bottom-dock-tab', { detail: { tab: 'Calendar' } }));
        expect(screen.getByRole('button', { name: 'Terminal logs and connection events' })).toHaveClass('active-tab');
        expect(screen.getByRole('button', { name: 'Calendar' })).toBeDisabled();
    });
});
