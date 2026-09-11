import { StrictMode } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { keyboardShortcutManager, type ShortcutDefinition } from '../services/keyboardShortcutManager';
import { useKeyboardShortcut, useKeyboardShortcuts } from './useKeyboardShortcut';

type Declaration = Omit<ShortcutDefinition, 'id'> & { id?: string };
const Multiple = ({ shortcuts }: { shortcuts: Declaration[] }) => { useKeyboardShortcuts(shortcuts); return null; };
const Single = ({ shortcut }: { shortcut: Declaration }) => { useKeyboardShortcut(shortcut); return null; };
const press = (key: string) => fireEvent.keyDown(document.body, { key });
let disposeManager: () => void;

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  keyboardShortcutManager.clear();
  keyboardShortcutManager.setGlobalEnabled(true);
  disposeManager = keyboardShortcutManager.initialize();
});
afterEach(() => {
  cleanup(); disposeManager(); keyboardShortcutManager.clear(); vi.restoreAllMocks();
});

describe('React shortcut declaration lifetime', () => {
  it('uses the newest handler without relying on a caller dependency list', () => {
    const oldHandler = vi.fn(); const newHandler = vi.fn();
    const { rerender } = render(<Single shortcut={{ id: 'save', key: 's', description: 'Save', handler: oldHandler }} />);
    press('s');
    rerender(<Single shortcut={{ id: 'save', key: 's', description: 'Save', handler: newHandler }} />);
    press('s');
    expect(oldHandler).toHaveBeenCalledOnce(); expect(newHandler).toHaveBeenCalledOnce();
    expect(keyboardShortcutManager.getShortcuts()).toHaveLength(1);
  });

  it('rebinds changed keys, explicit IDs and enabled state', () => {
    const handler = vi.fn();
    const { rerender } = render(<Single shortcut={{ id: 'first', key: 'a', description: 'Action', handler }} />);
    rerender(<Single shortcut={{ id: 'second', key: 'b', description: 'Action', handler }} />);
    press('a'); press('b'); expect(handler).toHaveBeenCalledOnce();
    expect(keyboardShortcutManager.findShortcut('first')).toBeUndefined();
    rerender(<Single shortcut={{ id: 'second', key: 'b', description: 'Action', handler, enabled: false }} />);
    press('b'); expect(handler).toHaveBeenCalledOnce();
    expect(keyboardShortcutManager.getShortcuts()).toEqual([]);
  });

  it('handles insertions, removal and reordering without assigning undefined or swapped IDs', () => {
    const a = { key: 'a', description: 'A', handler: vi.fn() };
    const b = { key: 'b', description: 'B', handler: vi.fn() };
    const c = { key: 'c', description: 'C', handler: vi.fn() };
    const { rerender, unmount } = render(<Multiple shortcuts={[a, b]} />);
    const originalIds = new Map(keyboardShortcutManager.getShortcuts().map(({ key, id }) => [key, id]));
    rerender(<Multiple shortcuts={[c, b, a]} />);
    const reorderedIds = new Map(keyboardShortcutManager.getShortcuts().map(({ key, id }) => [key, id]));
    expect(reorderedIds.get('a')).toBe(originalIds.get('a'));
    expect(reorderedIds.get('b')).toBe(originalIds.get('b'));
    expect(reorderedIds.get('c')).toBeTruthy();
    press('a'); press('b'); press('c');
    expect(a.handler).toHaveBeenCalledOnce(); expect(b.handler).toHaveBeenCalledOnce(); expect(c.handler).toHaveBeenCalledOnce();
    rerender(<Multiple shortcuts={[c, a]} />);
    press('b'); expect(b.handler).toHaveBeenCalledOnce();
    unmount(); expect(keyboardShortcutManager.getShortcuts()).toEqual([]);
  });

  it('replaces a declaration in a same-length array and reflects changed metadata', () => {
    const oldHandler = vi.fn(); const newHandler = vi.fn();
    const { rerender } = render(<Multiple shortcuts={[{ id: 'old', key: 'a', description: 'Old', handler: oldHandler }]} />);
    rerender(<Multiple shortcuts={[{ id: 'new', key: 'b', description: 'New', handler: newHandler, priority: 50 }]} />);
    press('a'); press('b');
    expect(oldHandler).not.toHaveBeenCalled(); expect(newHandler).toHaveBeenCalledOnce();
    expect(keyboardShortcutManager.getShortcuts()).toMatchObject([{ id: 'new', key: 'b', description: 'New', priority: 50 }]);
  });

  it('survives StrictMode effect replay and fully unregisters on unmount', () => {
    const handler = vi.fn();
    const { unmount } = render(<StrictMode><Multiple shortcuts={[{ id: 'action', key: 'a', description: 'Action', handler }]} /></StrictMode>);
    expect(keyboardShortcutManager.getShortcuts()).toHaveLength(1);
    press('a'); expect(handler).toHaveBeenCalledOnce();
    unmount(); press('a'); expect(handler).toHaveBeenCalledOnce();
    expect(keyboardShortcutManager.getShortcuts()).toEqual([]);
  });
});
