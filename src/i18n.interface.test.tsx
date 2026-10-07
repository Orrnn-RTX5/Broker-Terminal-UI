// @vitest-environment jsdom
import '@testing-library/jest-dom';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n, { changeInterfaceLanguage, i18nReady } from './i18n';
import { translateUi, useUiTranslation } from './hooks/useUiTranslation';
import { useState, useMemo, useEffect, memo } from 'react';

vi.mock('./components/layout/FileMenu', () => ({ FileMenu: () => null }));
vi.mock('./components/settings/OptionsDialog', () => ({ OptionsDialog: () => null }));
vi.mock('./components/SymbolsDialog', () => ({ SymbolsDialog: () => null }));
vi.mock('./store/useAppStore', () => {
    const state = { isAuthenticated: false, selectedSymbol: 'XAUUSD', savedAccounts: [] };
    const useAppStore = (selector: (s: typeof state) => unknown) => selector(state);
    useAppStore.getState = () => state;
    return { useAppStore };
});
import { MenuBar } from './components/layout/MenuBar';

const DraftPanel = memo(() => {
    const tr = useUiTranslation();
    const [comment, setComment] = useState('');
    return <section>
        <h2>{tr('New Order')}</h2>
        <label>{tr('Comment')}<input data-testid="draft" value={comment} onChange={e => setComment(e.target.value)} /></label>
        <span data-testid="broker-value">XAUUSD · 200001 · 4,414.650</span>
    </section>;
});

beforeAll(async () => { await i18nReady; });
beforeEach(async () => { await changeInterfaceLanguage('en'); });
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await changeInterfaceLanguage('en'); });

describe('interface language changes', () => {
    it.each(['web', 'desktop'])('keeps the %s layout LTR when Arabic is selected from the language menu', async (surface) => {
        if (surface === 'desktop') {
            Object.defineProperty(window, 'electron', { configurable: true, writable: true, value: { window: {} } });
        }
        try {
            render(<><MenuBar /><DraftPanel /></>);
            const input = screen.getByTestId('draft');
            fireEvent.change(input, { target: { value: 'EURUSD 200004' } });
            const openLanguages = () => {
                if (surface === 'desktop') {
                    fireEvent.click(screen.getByRole('menuitem', { name: translateUi('View') }));
                    fireEvent.click(screen.getByRole('menuitem', { name: i18n.t('menu.view.languages') }));
                } else {
                    fireEvent.click(screen.getByRole('button', { name: translateUi('Open application menu') }));
                    fireEvent.click(screen.getByRole('menuitem', { name: translateUi('Language') }));
                }
            };
            openLanguages();
            const arabicName = (await import('./config/supportedLanguages')).supportedLanguages.find(l => l.code === 'ar')!.name;
            fireEvent.click(screen.getByRole('menuitemradio', { name: arabicName }));
            await waitFor(() => expect(screen.getByRole('heading').textContent).toMatch(/[\u0600-\u06ff]/));
            expect(document.documentElement).toHaveAttribute('lang', 'ar');
            expect(document.documentElement).toHaveAttribute('dir', 'ltr');
            expect(screen.getByTestId('draft')).toBe(input);
            expect(input).toHaveValue('EURUSD 200004');
            expect(screen.getByTestId('broker-value')).toHaveTextContent('XAUUSD · 200001 · 4,414.650');

            openLanguages();
            const selected = screen.getByRole('menuitemradio', { name: arabicName });
            expect(selected).toHaveAttribute('aria-checked', 'true');
            // Only the label determines its own text direction; the menu row,
            // icons, checkmark and body portal inherit the fixed LTR layout.
            expect(selected.querySelector('span[dir="auto"]')).toHaveTextContent(arabicName);
            expect(selected.closest('[dir]')).toBe(document.documentElement);
            fireEvent.click(screen.getByRole('menuitemradio', { name: 'English' }));
            await waitFor(() => expect(document.documentElement).toHaveAttribute('lang', 'en'));
            expect(document.documentElement).toHaveAttribute('dir', 'ltr');
        } finally {
            cleanup();
            delete window.electron;
        }
    });

    it('refreshes memoized labels and imperative drawing effects on language changes', async () => {
        const effects = vi.fn();
        function CachedLabels() {
            const tr = useUiTranslation();
            const label = useMemo(() => tr('New Order'), [tr]);
            useEffect(() => { effects(tr('New Order')); }, [tr]);
            return <h2>{label}</h2>;
        }
        render(<CachedLabels />);
        expect(screen.getByRole('heading')).toHaveTextContent('New Order');
        await act(async () => { await changeInterfaceLanguage('fr'); });
        expect(screen.getByRole('heading')).toHaveTextContent('Nouvel ordre');
        expect(effects).toHaveBeenLastCalledWith('Nouvel ordre');
        await act(async () => { await changeInterfaceLanguage('en'); });
        expect(effects).toHaveBeenLastCalledWith('New Order');
    });

    it('uses the same language change flow from the desktop View menu and translates its menu labels', async () => {
        Object.defineProperty(window, 'electron', { configurable: true, writable: true, value: { window: {} } });
        try {
            render(<><MenuBar /><DraftPanel /></>);
            fireEvent.change(screen.getByTestId('draft'), { target: { value: 'Preserved desktop draft' } });
            fireEvent.click(screen.getByRole('menuitem', { name: 'View' }));
            fireEvent.click(screen.getByRole('menuitem', { name: 'Languages' }));
            const portal = document.querySelector('[data-rtx-desktop-submenu]');
            expect(portal?.parentElement).toBe(document.body);
            const french = (await import('./config/supportedLanguages')).supportedLanguages.find(l => l.code === 'fr')!;
            const option = screen.getByRole('menuitemradio', { name: french.name });
            fireEvent.mouseDown(option); // The outside-click handler must accept portal children.
            fireEvent.click(option);
            await waitFor(() => expect(screen.getByRole('heading')).toHaveTextContent('Nouvel ordre'));
            expect(document.documentElement.lang).toBe('fr');
            expect(localStorage.getItem('i18nextLng')).toBe('fr');
            expect(screen.getByTestId('draft')).toHaveValue('Preserved desktop draft');
            expect(screen.getByRole('menuitem', { name: translateUi('View') })).toBeInTheDocument();
            expect(screen.queryByRole('menuitem', { name: 'View' })).not.toBeInTheDocument();
            fireEvent.click(screen.getByRole('menuitem', { name: translateUi('View') }));
            fireEvent.click(screen.getByRole('menuitem', { name: i18n.t('menu.view.languages') }));
            fireEvent.click(screen.getByRole('menuitemradio', { name: 'English' }));
            await waitFor(() => expect(screen.getByRole('menuitem', { name: 'View' })).toBeInTheDocument());
        } finally { cleanup(); delete window.electron; }
    });

    it('changes the actual dropdown, main copy, HTML language, and saved preference together', async () => {
        render(<><MenuBar /><DraftPanel /></>);
        const draft = screen.getByTestId('draft');
        fireEvent.change(draft, { target: { value: 'Keep my draft 123' } });
        fireEvent.click(screen.getByRole('button', { name: 'Open application menu' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Language' }));
        fireEvent.click(screen.getByRole('menuitemradio', { name: 'Français' }));
        await waitFor(() => expect(screen.getByRole('heading')).toHaveTextContent('Nouvel ordre'));
        expect(document.documentElement.lang).toBe('fr');
        expect(document.documentElement.dir).toBe('ltr');
        expect(localStorage.getItem('i18nextLng')).toBe('fr');
        expect(screen.getByTestId('draft')).toBe(draft);
        expect(draft).toHaveValue('Keep my draft 123');
        expect(screen.getByTestId('broker-value')).toHaveTextContent('XAUUSD · 200001 · 4,414.650');
        fireEvent.click(screen.getByRole('button', { name: 'Ouvrir le menu des applications' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Langue' }));
        expect(screen.getByRole('menuitemradio', { name: 'Français' })).toHaveAttribute('aria-checked', 'true');
        // Autonyms remain readable regardless of the active interface language.
        expect(screen.getByRole('menuitemradio', { name: 'English' })).toBeInTheDocument();
    });

    it('updates memoized UI in Hindi and Arabic without replacing local state', async () => {
        render(<DraftPanel />);
        const input = screen.getByTestId('draft');
        fireEvent.change(input, { target: { value: 'EURUSD' } });
        await act(async () => { await changeInterfaceLanguage('hi'); });
        expect(screen.getByRole('heading').textContent).toMatch(/[\u0900-\u097f]/);
        expect(input).toHaveValue('EURUSD');
        await act(async () => { await changeInterfaceLanguage('ar'); });
        expect(screen.getByRole('heading').textContent).toMatch(/[\u0600-\u06ff]/);
        expect(document.documentElement.lang).toBe('ar');
        expect(document.documentElement.dir).toBe('ltr');
        expect(screen.getByTestId('draft')).toBe(input);
    });

    it('keeps the current language when loading fails or the requested language is unsupported', async () => {
        const load = vi.spyOn(i18n, 'loadLanguages').mockImplementation((_language, callback) => {
            callback?.(new Error('Chunk unavailable'), i18n.t);
            return Promise.resolve();
        });
        await expect(changeInterfaceLanguage('de')).rejects.toThrow('Chunk unavailable');
        expect(i18n.language).toBe('en');
        expect(localStorage.getItem('i18nextLng')).toBe('en');
        load.mockRestore();
        await expect(changeInterfaceLanguage('xx')).rejects.toThrow('Unsupported interface language');
        expect(i18n.language).toBe('en');
    });

    it('does not let an older load replace a more recent language choice', async () => {
        await changeInterfaceLanguage('fr');
        await changeInterfaceLanguage('de');
        const callbacks: Array<() => void> = [];
        vi.spyOn(i18n, 'loadLanguages').mockImplementation((_language, callback) => {
            callbacks.push(() => callback?.(null, i18n.t));
            return Promise.resolve();
        });
        const first = changeInterfaceLanguage('fr');
        const second = changeInterfaceLanguage('en');
        await Promise.resolve();
        callbacks[1](); await second;
        callbacks[0](); await first;
        expect(i18n.language).toBe('en');
    });

    it('interpolates display values without translating or escaping market data', async () => {
        await changeInterfaceLanguage('fr');
        expect(translateUi('Symbol: {{value0}}', { value0: 'XAUUSD<&>' })).toContain('XAUUSD<&>');
        expect(translateUi(4414.65)).toBe(4414.65);
        expect(translateUi(null)).toBeNull();
        expect(translateUi('FXTrust custom broker text')).toBe('FXTrust custom broker text');
    });
});
