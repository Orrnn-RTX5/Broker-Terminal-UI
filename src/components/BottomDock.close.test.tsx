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

        expect(screen.getByRole('button', { name: 'Close Winners' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Close Losers' })).toBeInTheDocument();
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
});
