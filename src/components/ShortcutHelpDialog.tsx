import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Keyboard, Search, X } from 'lucide-react';
import { useKeyboardShortcutContext } from '../contexts/KeyboardShortcutContext';
import { useUiTranslation } from '../hooks/useUiTranslation';
import { keyboardShortcutManager, SHORTCUT_CATEGORIES } from '../services/keyboardShortcutManager';
import { getShortcutHelpEntries, type ShortcutHelpEntry } from '../services/shortcutCatalog';
import './ShortcutHelpDialog.css';

interface ShortcutHelpDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const normalizeSearch = (value: string) => value.toLocaleLowerCase().trim().replace(/\s*\+\s*/g, '+').replace(/\s+/g, ' ');
const noAction = () => undefined;

function shortcutKeys(entry: ShortcutHelpEntry): string[] {
  if (Array.isArray(entry.displayKeys) && entry.displayKeys.length > 0
    && entry.displayKeys.every(key => typeof key === 'string' && key.trim().length > 0)) {
    return entry.displayKeys;
  }
  // The final '+' can itself be a key; splitting every plus loses Zoom In.
  return keyboardShortcutManager.formatShortcut({ ...entry, handler: noAction }).split(/\+(?!$)/);
}

export function ShortcutHelpDialog({ isOpen, onClose }: ShortcutHelpDialogProps) {
  const tr = useUiTranslation();
  const { shortcuts } = useKeyboardShortcutContext();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const categoryRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const entries = useMemo(() => getShortcutHelpEntries(shortcuts), [shortcuts]);
  const categories = useMemo(() => {
    const present = new Set(entries.map(entry => entry.category || 'Tools'));
    return [...Object.values(SHORTCUT_CATEGORIES), ...present].filter((category, index, all) =>
      present.has(category) && all.indexOf(category) === index);
  }, [entries]);
  const currentCategory = selectedCategory && categories.includes(selectedCategory) ? selectedCategory : null;
  const query = normalizeSearch(searchQuery);
  const groups = useMemo(() => categories.flatMap(category => {
    if (currentCategory && category !== currentCategory) return [];
    const matches = entries.filter(entry => {
      if ((entry.category || 'Tools') !== category) return false;
      if (!query) return true;
      const keys = shortcutKeys(entry);
      const translatedKeys = keys.map(key => tr(key));
      const namedKeys = [entry.ctrl && 'Ctrl', entry.shift && 'Shift', entry.alt && 'Alt', entry.meta && 'Cmd', entry.key].filter(Boolean);
      const searchable = [entry.description, tr(entry.description), category, tr(category),
        entry.scope || '', tr(entry.scope || ''), entry.key,
        keys.join('+'), keys.join(' '), translatedKeys.join('+'), translatedKeys.join(' '), namedKeys.join('+'), namedKeys.join(' ')];
      return searchable.some(value => normalizeSearch(value).includes(query));
    });
    return matches.length ? [{ category, entries: matches }] : [];
  }), [categories, currentCategory, entries, query, tr]);
  const resultCount = groups.reduce((count, group) => count + group.entries.length, 0);

  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSearchQuery('');
    setSelectedCategory(null);
    searchRef.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, [isOpen]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // This modal owns its input. F-keys and trading combinations must not
    // reach the chart while someone is browsing the help list.
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('*') ?? [])
      .filter(element => element.tabIndex >= 0 && !element.matches(':disabled'));
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) {
      event.preventDefault();
      first?.focus();
    }
  };

  const navigateCategories = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const buttons = Array.from(categoryRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
    const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (currentIndex < 0) return;
    event.preventDefault();
    const step = (event.key === 'ArrowRight' ? 1 : -1) * (document.documentElement.dir === 'rtl' ? -1 : 1);
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (currentIndex + step + buttons.length) % buttons.length;
    setSelectedCategory(nextIndex === 0 ? null : categories[nextIndex - 1]);
    buttons[nextIndex]?.focus();
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="rtx-shortcut-backdrop" onPointerDown={event => event.stopPropagation()} onClick={event => {
      event.stopPropagation();
      if (event.target === event.currentTarget) onClose();
    }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        data-shortcut-scope="local" className="rtx-shortcut-dialog" onKeyDown={handleKeyDown}>
        <header className="rtx-shortcut-dialog__header">
          <div><Keyboard size={18} aria-hidden="true" /><h2 id={titleId}>{tr('Keyboard Shortcuts')}</h2></div>
          <button type="button" className="rtx-shortcut-dialog__icon-button" onClick={onClose} aria-label={tr('Close')}>
            <X size={17} aria-hidden="true" />
          </button>
        </header>

        <div className="rtx-shortcut-dialog__filters">
          <label className="rtx-shortcut-dialog__search">
            <Search size={16} aria-hidden="true" />
            <input ref={searchRef} type="search" value={searchQuery} aria-label={tr('Search shortcuts...')}
              placeholder={tr('Search shortcuts...')} onChange={event => setSearchQuery(event.target.value)} />
          </label>
          <div ref={categoryRef} role="toolbar" aria-label={tr('Category')}
            className="rtx-shortcut-dialog__categories" onKeyDown={navigateCategories}>
            {[null, ...categories].map(category => (
              <button key={category || 'all-categories'} type="button" aria-pressed={currentCategory === category}
                tabIndex={currentCategory === category ? 0 : -1} onClick={() => setSelectedCategory(category)}>
                {tr(category || 'All')}
              </button>
            ))}
          </div>
        </div>

        <div className="rtx-shortcut-dialog__results" tabIndex={0} role="region" aria-label={tr('Shortcuts')}>
          {groups.map(({ category, entries: matches }) => (
            <section key={category} className="rtx-shortcut-dialog__group" aria-label={tr(category)}>
              <h3>{tr(category)}</h3>
              <dl>
                {matches.map((entry, index) => {
                  const keys = shortcutKeys(entry);
                  const rowId = [entry.id, entry.ctrl, entry.shift, entry.alt, entry.meta, entry.key, entry.scope, index].join(':');
                  return <div key={rowId} className="rtx-shortcut-dialog__row">
                    <dt>
                      <span>{tr(entry.description)}</span>
                      {entry.scope && <small>{tr(entry.scope)}</small>}
                      {entry.enabled === false && <small>{tr('(Disabled)')}</small>}
                    </dt>
                    <dd dir="ltr">{keys.map((key, keyIndex) => (
                      <span className="rtx-shortcut-dialog__key-part" key={`${keyIndex}:${key}`}>
                        {keyIndex > 0 && <span className="rtx-shortcut-dialog__key-separator" aria-hidden="true">+</span>}
                        <kbd>{tr(key)}</kbd>
                      </span>
                    ))}</dd>
                  </div>;
                })}
              </dl>
            </section>
          ))}
          {resultCount === 0 && <div className="rtx-shortcut-dialog__empty">
            <Search size={24} aria-hidden="true" />
            <p>{tr('No matches found')}</p>
            {searchQuery && <button type="button" onClick={() => { setSearchQuery(''); searchRef.current?.focus(); }}>
              {tr('Clear search')}
            </button>}
          </div>}
        </div>

        <footer className="rtx-shortcut-dialog__footer">
          <span role="status" aria-live="polite">{tr('{{value0}} shortcuts', { value0: resultCount })}</span>
          <button type="button" onClick={onClose}>{tr('Close')}<kbd>Esc</kbd></button>
        </footer>
      </div>
    </div>, document.body,
  );
}
