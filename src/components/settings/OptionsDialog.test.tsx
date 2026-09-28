// @vitest-environment jsdom

import '@testing-library/jest-dom';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '../../store/useSettingsStore';

vi.mock('../../hooks/useUiTranslation', () => {
    const translate = <T,>(value: T) => value;
    return { useUiTranslation: () => translate };
});

import { OptionsDialog } from './OptionsDialog';

function OptionsHarness() {
    const [isOpen, setIsOpen] = useState(false);
    return (
        <>
            <button onClick={() => setIsOpen(true)}>Open options</button>
            <OptionsDialog isOpen={isOpen} onClose={() => setIsOpen(false)} />
        </>
    );
}

function openOptions() {
    render(<OptionsHarness />);
    const launcher = screen.getByRole('button', { name: 'Open options' });
    launcher.focus();
    fireEvent.click(launcher);
    return launcher;
}

beforeEach(() => {
    useSettingsStore.getState().resetToDefaults();
});

afterEach(() => {
    cleanup();
    useSettingsStore.getState().resetToDefaults();
    vi.restoreAllMocks();
});

describe('OptionsDialog settings changes', () => {
    it('applies settings without closing and keeps the applied values on a subsequent Cancel', () => {
        openOptions();
        const news = screen.getByLabelText('Enable news');
        expect(news).toBeChecked();
        fireEvent.click(news);
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

        expect(screen.getByRole('dialog', { name: 'Options' })).toBeInTheDocument();
        expect(useSettingsStore.getState().server.enableNews).toBe(false);
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(useSettingsStore.getState().server.enableNews).toBe(false);
    });

    it.each(['Cancel', 'Close options', 'Escape'])('restores only changes made after Apply when dismissed with %s', (dismissal) => {
        openOptions();
        fireEvent.click(screen.getByLabelText('Enable news'));
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
        fireEvent.click(screen.getByLabelText('Enable news'));
        expect(useSettingsStore.getState().server.enableNews).toBe(true);

        if (dismissal === 'Escape') {
            fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
        } else {
            fireEvent.click(screen.getByRole('button', { name: dismissal }));
        }

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(useSettingsStore.getState().server.enableNews).toBe(false);
    });

    it('restores the opening settings when changes are cancelled before Apply', () => {
        openOptions();
        fireEvent.click(screen.getByLabelText('Enable news'));
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(useSettingsStore.getState().server.enableNews).toBe(true);

        fireEvent.click(screen.getByRole('button', { name: 'Open options' }));
        expect(screen.getByLabelText('Enable news')).toBeChecked();
    });

    it('keeps changes when confirmed with OK', () => {
        openOptions();
        fireEvent.click(screen.getByLabelText('Enable news'));
        fireEvent.click(screen.getByRole('button', { name: 'OK' }));

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(useSettingsStore.getState().server.enableNews).toBe(false);
    });

    it('keeps the rollback baseline when the parent rerenders with a new close callback', () => {
        const { rerender } = render(<OptionsHarness />);
        fireEvent.click(screen.getByRole('button', { name: 'Open options' }));
        fireEvent.click(screen.getByLabelText('Enable news'));

        rerender(<OptionsHarness />);
        expect(screen.getByLabelText('Enable news')).not.toBeChecked();
        expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(useSettingsStore.getState().server.enableNews).toBe(true);
    });
});

describe('OptionsDialog navigation and accessibility', () => {
    it('exposes all ten sections as labelled tabs with an associated selected panel', () => {
        openOptions();
        const tabNames = ['Server', 'Charts', 'Trade', 'Automation & Bots', 'Events', 'Notifications', 'Email', 'FTP', 'Community', 'Signals'];
        const tabs = within(screen.getByRole('tablist')).getAllByRole('tab');
        expect(tabs).toHaveLength(tabNames.length);

        for (const name of tabNames) {
            const tab = screen.getByRole('tab', { name });
            fireEvent.click(tab);
            expect(tab).toHaveAttribute('aria-selected', 'true');
            expect(tabs.filter((candidate) => candidate.getAttribute('aria-selected') === 'true')).toEqual([tab]);
            const panel = screen.getByRole('tabpanel');
            expect(panel).toHaveAttribute('aria-labelledby', tab.id);
            expect(tab).toHaveAttribute('aria-controls', panel.id);
            expect(panel).toBeVisible();
        }
    }, 30_000);

    it('moves through the section tabs with arrow, Home, and End keys', async () => {
        openOptions();
        const server = screen.getByRole('tab', { name: 'Server' });
        const charts = screen.getByRole('tab', { name: 'Charts' });
        const signals = screen.getByRole('tab', { name: 'Signals' });
        await waitFor(() => expect(server).toHaveFocus());

        fireEvent.keyDown(server, { key: 'ArrowDown' });
        expect(charts).toHaveFocus();
        expect(charts).toHaveAttribute('aria-selected', 'true');
        fireEvent.keyDown(charts, { key: 'End' });
        expect(signals).toHaveFocus();
        fireEvent.keyDown(signals, { key: 'Home' });
        expect(server).toHaveFocus();
        expect(server).toHaveAttribute('aria-selected', 'true');
    });

    it('contains Tab and Shift+Tab focus, then returns focus to the launcher on close', async () => {
        const user = userEvent.setup();
        const launcher = openOptions();
        await waitFor(() => expect(screen.getByRole('tab', { name: 'Server' })).toHaveFocus());
        const close = screen.getByRole('button', { name: 'Close options' });
        const ok = screen.getByRole('button', { name: 'OK' });

        ok.focus();
        expect(ok).toHaveFocus();
        await user.tab();
        expect(close).toHaveFocus();
        await user.tab({ shift: true });
        expect(ok).toHaveFocus();

        await user.keyboard('{Escape}');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        await waitFor(() => expect(launcher).toHaveFocus());
    });
});

describe('OptionsDialog automation preferences', () => {
    it('keeps strategy safeguards disabled until automated strategies are enabled', () => {
        openOptions();
        fireEvent.click(screen.getByRole('tab', { name: 'Automation & Bots' }));
        const accountChange = screen.getByLabelText(/account.*chang/i);
        const profileChange = screen.getByLabelText(/profile.*chang/i);
        const chartChange = screen.getByLabelText(/chart.*chang|symbol.*period/i);
        for (const control of [accountChange, profileChange, chartChange]) expect(control).toBeDisabled();

        fireEvent.click(screen.getByLabelText('Enable automated strategies'));
        for (const control of [accountChange, profileChange, chartChange]) expect(control).toBeEnabled();
        fireEvent.click(accountChange);
        expect(useSettingsStore.getState().automation.disableOnAccountChange).toBe(false);
        fireEvent.click(screen.getByLabelText('Enable automated strategies'));
        expect(accountChange).toBeDisabled();
        expect(useSettingsStore.getState().automation.disableOnAccountChange).toBe(false);
    });

    it('adds and removes allowed URLs without changing the existing entries', () => {
        useSettingsStore.getState().updateAutomationSettings({ allowedURLs: ['https://existing.example.com'] });
        openOptions();
        fireEvent.click(screen.getByRole('tab', { name: 'Automation & Bots' }));
        const url = 'https://api.example.com';
        const input = screen.getByLabelText('Allowed URL');
        fireEvent.change(input, { target: { value: url } });
        fireEvent.click(screen.getByRole('button', { name: 'Add URL' }));

        expect(input).toHaveValue('');
        expect(useSettingsStore.getState().automation.allowedURLs).toEqual(['https://existing.example.com', url]);
        fireEvent.click(screen.getByRole('button', { name: `Remove ${url}` }));
        expect(useSettingsStore.getState().automation.allowedURLs).toEqual(['https://existing.example.com']);
    });

    it('announces invalid and duplicate URL entries without saving them', () => {
        const existingURL = 'https://existing.example.com';
        useSettingsStore.getState().updateAutomationSettings({ allowedURLs: [existingURL] });
        openOptions();
        fireEvent.click(screen.getByRole('tab', { name: 'Automation & Bots' }));
        const input = screen.getByLabelText('Allowed URL');

        fireEvent.change(input, { target: { value: 'ftp://files.example.com' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add URL' }));
        expect(input).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid HTTP or HTTPS URL.');
        expect(useSettingsStore.getState().automation.allowedURLs).toEqual([existingURL]);

        fireEvent.change(input, { target: { value: existingURL } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(screen.getByRole('alert')).toHaveTextContent('This URL is already in the list.');
        expect(useSettingsStore.getState().automation.allowedURLs).toEqual([existingURL]);
    });
});
