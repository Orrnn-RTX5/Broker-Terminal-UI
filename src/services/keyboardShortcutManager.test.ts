import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { keyboardShortcutManager, type ShortcutDefinition } from './keyboardShortcutManager';

const keyDown = (key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};
const register = (key: string, options: Partial<ShortcutDefinition> = {}) => {
  const handler = vi.fn();
  const dispose = keyboardShortcutManager.register({ id: key, key, description: key, handler, ...options });
  return { handler, dispose };
};
let disposeManager: () => void;

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  keyboardShortcutManager.clear();
  keyboardShortcutManager.setGlobalEnabled(true);
  disposeManager = keyboardShortcutManager.initialize();
});
afterEach(() => {
  disposeManager();
  keyboardShortcutManager.clear();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('focused control keyboard ownership', () => {
  it.each(['true', '', 'plaintext-only'])('protects descendants of contenteditable=%s', (value) => {
    const { handler } = register('c');
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', value);
    const child = document.createElement('span');
    editor.append(child);
    document.body.append(editor);
    expect(keyDown('c', {}, child).defaultPrevented).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it('honors a nested contenteditable=false boundary', () => {
    const { handler } = register('c');
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    const nonEditable = document.createElement('div');
    nonEditable.setAttribute('contenteditable', 'false');
    const child = document.createElement('span');
    nonEditable.append(child); editor.append(nonEditable); document.body.append(editor);
    keyDown('c', {}, child);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('lets focused handlers consume events before global shortcuts', () => {
    const { handler } = register('s', { ctrl: true });
    const button = document.createElement('button');
    button.addEventListener('keydown', (event) => event.preventDefault());
    document.body.append(button);
    keyDown('s', { ctrlKey: true }, button);
    expect(handler).not.toHaveBeenCalled();
  });

  it.each([{ isComposing: true }, { keyCode: 229 }, { repeat: true }])('ignores composition and repeats: %j', (flags) => {
    const { handler } = register('F9', { allowInInput: true });
    keyDown('F9', flags);
    expect(handler).not.toHaveBeenCalled();
  });

  it.each(['dialog', 'alertdialog', 'menu', 'menubar', 'listbox', 'tablist', 'tree', 'grid', 'slider'])('preserves navigation in %s controls', (role) => {
    const arrow = register('ArrowRight');
    const typeahead = register('c');
    const close = register('Escape');
    const surface = document.createElement('div');
    surface.setAttribute('role', role);
    const button = document.createElement('button');
    surface.append(button); document.body.append(surface);
    const local = vi.fn();
    surface.addEventListener('keydown', local);
    expect(keyDown('ArrowRight', {}, button).defaultPrevented).toBe(false);
    keyDown('c', {}, button);
    keyDown('Escape', {}, button);
    expect(local).toHaveBeenCalledTimes(3);
    expect(arrow.handler).not.toHaveBeenCalled();
    expect(typeahead.handler).not.toHaveBeenCalled();
    expect(close.handler).not.toHaveBeenCalled();
  });

  it('keeps F1, F9 and explicit allowed shortcuts available while typing', () => {
    const help = register('F1');
    const order = register('F9');
    const save = register('s', { ctrl: true, allowInInput: true });
    const grid = register('g', { ctrl: true });
    const input = document.createElement('input'); document.body.append(input);
    keyDown('F1', {}, input); keyDown('F9', {}, input);
    keyDown('s', { ctrlKey: true }, input); keyDown('g', { ctrlKey: true }, input);
    expect(help.handler).toHaveBeenCalledOnce();
    expect(order.handler).toHaveBeenCalledOnce();
    expect(save.handler).toHaveBeenCalledOnce();
    expect(grid.handler).not.toHaveBeenCalled();
  });

  it('keeps explicit local scope authoritative even for F-keys and Escape', () => {
    const order = register('F9', { allowInInput: true });
    const close = register('Escape', { allowInInput: true });
    const dialog = document.createElement('div'); dialog.dataset.shortcutScope = 'local';
    const input = document.createElement('input'); dialog.append(input); document.body.append(dialog);
    const local = vi.fn(); dialog.addEventListener('keydown', local);
    keyDown('F9', {}, input); keyDown('Escape', {}, input);
    expect(local).toHaveBeenCalledTimes(2);
    expect(order.handler).not.toHaveBeenCalled();
    expect(close.handler).not.toHaveBeenCalled();
  });

  it('allows Escape to reach existing window close and cancel handlers', () => {
    const close = register('Escape');
    const local = vi.fn(); window.addEventListener('keydown', local);
    try {
      keyDown('Escape');
      expect(close.handler).toHaveBeenCalledOnce();
      expect(local).toHaveBeenCalledOnce();
    } finally { window.removeEventListener('keydown', local); }
  });
});

describe('keyboard layout normalization', () => {
  it.each([
    { key: '+', code: 'Equal', shiftKey: true },
    { key: '=', code: 'Equal', shiftKey: true },
    { key: '+', code: 'NumpadAdd' },
    { key: 'Add', code: 'NumpadAdd' },
  ])('matches a real plus key without requiring a separate Shift binding: %j', ({ key, ...flags }) => {
    const { handler } = register('+');
    expect(keyDown(key, flags).defaultPrevented).toBe(true);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('matches numpad subtraction and preserves explicit Ctrl/Meta modifiers', () => {
    const minus = register('-');
    const plus = register('+');
    keyDown('Subtract', { code: 'NumpadSubtract' });
    expect(minus.handler).toHaveBeenCalledOnce();
    expect(keyDown('+', { code: 'Equal', shiftKey: true, ctrlKey: true }).defaultPrevented).toBe(false);
    expect(keyDown('+', { code: 'Equal', shiftKey: true, metaKey: true }).defaultPrevented).toBe(false);
    expect(plus.handler).not.toHaveBeenCalled();
  });
});

describe('registration ownership and lifetime', () => {
  it('restores the lower-priority action after an override unmounts', () => {
    const base = register('p', { id: 'base', priority: 10 });
    const override = register('p', { id: 'override', priority: 20 });
    keyDown('p'); expect(override.handler).toHaveBeenCalledOnce();
    expect(base.handler).not.toHaveBeenCalled();
    expect(keyboardShortcutManager.getConflicts()).toHaveLength(1);
    override.dispose(); keyDown('p');
    expect(base.handler).toHaveBeenCalledOnce();
    expect(keyboardShortcutManager.getShortcuts()).toHaveLength(1);
    expect(keyboardShortcutManager.getConflicts()).toEqual([]);
  });

  it('retains later lower-priority registrations and promotes them when needed', () => {
    const override = register('p', { id: 'override', priority: 20 });
    const base = register('p', { id: 'base', priority: 10 });
    keyboardShortcutManager.setEnabled('override', false);
    keyDown('p'); expect(base.handler).toHaveBeenCalledOnce();
    keyboardShortcutManager.setEnabled('override', true);
    keyDown('p'); expect(override.handler).toHaveBeenCalledOnce();
  });

  it('does not let stale cleanup remove a newer registration with the same ID', () => {
    const previous = register('p', { id: 'same' });
    const current = register('p', { id: 'same' });
    previous.dispose(); previous.dispose(); keyDown('p');
    expect(current.handler).toHaveBeenCalledOnce();
    expect(previous.handler).not.toHaveBeenCalled();
    current.dispose(); expect(keyboardShortcutManager.getShortcuts()).toEqual([]);
  });

  it('attaches one listener across repeated initialization and independent cleanup', () => {
    const { handler } = register('p');
    const secondDispose = keyboardShortcutManager.initialize();
    keyDown('p'); expect(handler).toHaveBeenCalledTimes(1);
    disposeManager(); disposeManager(); keyDown('p');
    expect(handler).toHaveBeenCalledTimes(2);
    secondDispose(); keyDown('p'); expect(handler).toHaveBeenCalledTimes(2);
  });
});
