import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeyboardShortcutProvider } from '../contexts/KeyboardShortcutContext';
import { keyboardShortcutManager, type ShortcutDefinition } from '../services/keyboardShortcutManager';
import i18n, { i18nReady } from '../i18n';
import { ShortcutHelpDialog } from './ShortcutHelpDialog';

const register = (entry: Partial<ShortcutDefinition> & Pick<ShortcutDefinition, 'id' | 'key' | 'description'>) =>
  keyboardShortcutManager.register({ handler: vi.fn(), category: 'Charts', ...entry });
const open = (onClose = vi.fn()) => render(
  <KeyboardShortcutProvider><ShortcutHelpDialog isOpen onClose={onClose} /></KeyboardShortcutProvider>,
);
const search = (query: string) => fireEvent.change(screen.getByRole('searchbox'), { target: { value: query } });
const results = () => screen.getByRole('region', { name: 'Shortcuts' });

beforeEach(async () => {
  await i18nReady;
  await i18n.changeLanguage('en');
  keyboardShortcutManager.clear();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  keyboardShortcutManager.clear();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('ShortcutHelpDialog', () => {
  it('exposes an accessible local modal and focuses search immediately', () => {
    open();
    const dialog = screen.getByRole('dialog', { name: 'Keyboard Shortcuts' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('data-shortcut-scope', 'local');
    expect(screen.getByRole('searchbox')).toHaveFocus();
    expect(screen.getAllByRole('button', { name: /^Close/ })).toHaveLength(2);
  });

  it('reacts to actual registry changes without closing or losing search', () => {
    register({ id: 'test.print', key: 'p', ctrl: true, description: 'Print chart', category: 'File' });
    open();
    search('print');
    expect(within(results()).getByText('Print chart')).toBeVisible();
    act(() => { register({ id: 'test.preview', key: 'p', ctrl: true, shift: true, description: 'Print Preview', category: 'File' }); });
    expect(within(results()).getByText('Print Preview')).toBeVisible();
    expect(screen.getByRole('searchbox')).toHaveValue('print');
    act(() => keyboardShortcutManager.unregister('test.preview'));
    expect(within(results()).queryByText('Print Preview')).toBeNull();
  });

  it.each(['Ctrl+P', 'ctrl + p', 'ctrl p', 'File', 'Print chart'])(
    'searches action, category and complete combinations: %s', query => {
      register({ id: 'test.print', key: 'p', ctrl: true, description: 'Print chart', category: 'File' });
      register({ id: 'test.zoom', key: '+', description: 'Zoom In' });
      open();
      search(query);
      expect(within(results()).getByText('Print chart')).toBeVisible();
      expect(within(results()).queryByText('Zoom In')).toBeNull();
    },
  );

  it('renders normalized arrow keys, the literal plus key, and same-ID aliases without duplicate React keys', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    register({ id: 'test.scroll', key: 'ArrowLeft', description: 'Scroll Chart Left' });
    register({ id: 'test.zoom', key: '+', description: 'Zoom In' });
    register({ id: 'test.zoom', key: '=', description: 'Zoom In' });
    open();
    const list = results();
    expect(within(list).getByText('←', { selector: 'kbd' })).toBeVisible();
    expect(within(list).getByText('+', { selector: 'kbd' })).toBeVisible();
    expect(within(list).getByText('=', { selector: 'kbd' })).toBeVisible();
    expect(within(list).getAllByText('Zoom In')).toHaveLength(2);
    expect(errors.mock.calls.some(call => call.join(' ').includes('same key'))).toBe(false);
  });

  it('shows actual locally scoped gestures and searches their scope', () => {
    open();
    search('On the chart');
    expect(within(results()).getByText('Measure')).toBeVisible();
    expect(within(results()).getByText('Drag', { selector: 'kbd' })).toBeVisible();
    expect(within(results()).getByText('On the chart')).toBeVisible();
  });

  it('lists both print-preview modifiers with their local scope', () => {
    open();
    search('In Print Preview');
    expect(within(results()).getAllByText('Print')).toHaveLength(2);
    expect(within(results()).getAllByText('In Print Preview')).toHaveLength(2);
    expect(within(results()).getByText('Ctrl', { selector: 'kbd' })).toBeVisible();
    expect(within(results()).getByText('Cmd', { selector: 'kbd' })).toBeVisible();
  });

  it('states that Last Symbol trading shortcuts are available while its panel is open', () => {
    open();
    search('While Last Symbol is open');
    expect(within(results()).getAllByText('While Last Symbol is open')).toHaveLength(3);
    for (const action of ['Buy', 'Sell', 'Close positions']) expect(within(results()).getByText(action)).toBeVisible();
    expect(within(results()).queryByText('In Last Symbol')).toBeNull();
    expect(keyboardShortcutManager.getShortcuts()).toHaveLength(0);
  });

  it('explains that Arrange Icons operates on minimized floating windows', () => {
    register({ id: 'window.arrange-icons', key: 'm', alt: true, shift: true, description: 'Arrange Icons', category: 'Window' });
    open();
    search('When floating windows are minimized');
    expect(within(results()).getByText('Arrange Icons')).toBeVisible();
    expect(within(results()).getByText('When floating windows are minimized')).toBeVisible();
  });

  it('shows both annotation save modifiers with the editing scope and normalized Enter key', () => {
    open();
    search('While editing an annotation');
    expect(within(results()).getAllByText('Save annotation')).toHaveLength(2);
    const combinations = Array.from(results().querySelectorAll('dd')).map(row =>
      Array.from(row.querySelectorAll('kbd')).map(key => key.textContent));
    expect(combinations).toEqual([['Ctrl', '↵'], ['Cmd', '↵']]);
    expect(within(results()).queryByText('Finish drawing')).toBeNull();
  });

  it.each(['Ctrl+Enter', 'Cmd+Enter', 'Shift+Tab'])('finds named combinations when keycaps use symbols: %s', query => {
    open();
    search(query);
    expect(within(results()).getByText(query === 'Shift+Tab' ? 'Save and move to previous cell' : 'Save annotation')).toBeVisible();
    expect(screen.queryByText('No matches found')).toBeNull();
  });

  it('distinguishes committing a table cell from committing and moving to adjacent cells', () => {
    open();
    search('While editing a table cell');
    const combinations = Array.from(results().querySelectorAll('.rtx-shortcut-dialog__row')).map(row => ({
      description: row.querySelector('dt')?.textContent?.replace('While editing a table cell', '').trim(),
      keys: Array.from(row.querySelectorAll('kbd')).map(key => key.textContent),
    }));
    expect(combinations).toEqual([
      { description: 'Save cell', keys: ['↵'] },
      { description: 'Save and move to next cell', keys: ['⇥'] },
      { description: 'Save and move to previous cell', keys: ['Shift', '⇥'] },
    ]);
  });

  it('marks only explicitly disabled entries as disabled', () => {
    register({ id: 'test.disabled', key: 'j', description: 'Unavailable test action', enabled: false });
    open();
    expect(within(results()).getAllByText('(Disabled)')).toHaveLength(1);
    expect(within(results()).getByText('Measure')).toBeVisible();
  });

  it('recovers from an empty result set using Clear search', () => {
    register({ id: 'test.print', key: 'p', ctrl: true, description: 'Print chart' });
    open();
    search('nothing-matches-this-query');
    expect(screen.getByText('No matches found')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(screen.getByRole('searchbox')).toHaveFocus();
    expect(within(results()).getByText('Print chart')).toBeVisible();
  });

  it('supports category arrows, Home and End with one category tab stop', () => {
    register({ id: 'test.print', key: 'p', ctrl: true, description: 'Print chart', category: 'File' });
    open();
    const toolbar = screen.getByRole('toolbar', { name: 'Category' });
    const categories = within(toolbar).getAllByRole('button');
    categories[0].focus();
    fireEvent.keyDown(categories[0], { key: 'ArrowRight' });
    expect(categories[1]).toHaveFocus();
    expect(categories[1]).toHaveAttribute('aria-pressed', 'true');
    expect(categories.filter(button => button.tabIndex === 0)).toHaveLength(1);
    expect(within(results()).getByText('Print chart')).toBeVisible();
    expect(within(results()).queryByText('Measure')).toBeNull();
    fireEvent.keyDown(categories[1], { key: 'End' });
    expect(categories.at(-1)).toHaveFocus();
    fireEvent.keyDown(categories.at(-1)!, { key: 'Home' });
    expect(categories[0]).toHaveFocus();
    expect(within(results()).getByText('Measure')).toBeVisible();
  });

  it('traps Tab at both boundaries and returns focus when Escape closes locally', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    const onClose = vi.fn();
    const view = open(onClose);
    const closeButtons = screen.getAllByRole('button', { name: /^Close/ });
    closeButtons.at(-1)!.focus();
    fireEvent.keyDown(closeButtons.at(-1)!, { key: 'Tab' });
    expect(closeButtons[0]).toHaveFocus();
    fireEvent.keyDown(closeButtons[0], { key: 'Tab', shiftKey: true });
    expect(closeButtons.at(-1)).toHaveFocus();
    const documentListener = vi.fn();
    document.addEventListener('keydown', documentListener);
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
    expect(documentListener).not.toHaveBeenCalled();
    document.removeEventListener('keydown', documentListener);
    view.rerender(<KeyboardShortcutProvider><ShortcutHelpDialog isOpen={false} onClose={onClose} /></KeyboardShortcutProvider>);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('does not execute global F-key or trading shortcuts while help owns focus', () => {
    const handler = vi.fn();
    register({ id: 'test.order', key: 'F9', description: 'New Order', handler, allowInInput: true });
    register({ id: 'test.buy', key: 'b', shift: true, description: 'Buy', handler, allowInInput: true });
    const toggle = vi.spyOn(keyboardShortcutManager, 'setGlobalEnabled');
    open();
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'F9' });
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'B', shiftKey: true });
    expect(handler).not.toHaveBeenCalled();
    expect(toggle).not.toHaveBeenCalled();
  });

  it('preserves left-to-right key combinations and follows visual category order in RTL', async () => {
    await i18n.changeLanguage('ar');
    register({ id: 'test.rtl', key: 'p', ctrl: true, description: 'Print chart', category: 'File' });
    open();
    const toolbar = screen.getByRole('toolbar');
    const categories = within(toolbar).getAllByRole('button');
    categories[0].focus();
    fireEvent.keyDown(categories[0], { key: 'ArrowLeft' });
    expect(categories[1]).toHaveFocus();
    const combo = screen.getByText(i18n.t('Print chart', { ns: 'ui' })).closest('.rtx-shortcut-dialog__row')?.querySelector('dd');
    expect(combo).toHaveAttribute('dir', 'ltr');
    expect(Array.from(combo!.querySelectorAll('kbd')).map(key => key.textContent)).toEqual(['Ctrl', 'P']);
  });

  it('localizes categories, descriptions and scope, and updates filtered results on language changes', async () => {
    register({ id: 'test.localized', key: 'j', description: 'Test action', category: 'Test category' });
    await i18n.loadLanguages('fr');
    i18n.addResourceBundle('fr', 'ui', {
      'Keyboard Shortcuts': 'Raccourcis clavier', 'Test action': 'Action traduite',
      'Test category': 'Catégorie test', 'On the chart': 'Sur le graphique',
    }, true, true);
    open();
    search('Action traduite');
    expect(screen.getByText('No matches found')).toBeVisible();
    await act(() => i18n.changeLanguage('fr'));
    expect(screen.getByRole('dialog', { name: 'Raccourcis clavier' })).toBeVisible();
    expect(screen.getByRole('searchbox')).toHaveValue('Action traduite');
    expect(screen.getByText('Action traduite')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Catégorie test' })).toBeVisible();
    search('Sur le graphique');
    expect(screen.getByText('Sur le graphique')).toBeVisible();
  });
});
