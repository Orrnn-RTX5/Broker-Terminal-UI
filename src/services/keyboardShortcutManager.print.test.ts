import { expect, it, vi } from 'vitest';
import { keyboardShortcutManager } from './keyboardShortcutManager';

it('lets the print dialog own Ctrl+P without dispatching a second global print', () => {
  const globalPrint = vi.fn();
  const localPrint = vi.fn();
  const unregister = keyboardShortcutManager.register({ id: 'test.print', key: 'p', ctrl: true, description: 'Print', handler: globalPrint });
  const dispose = keyboardShortcutManager.initialize();
  const dialog = document.createElement('div');
  dialog.dataset.shortcutScope = 'local';
  const button = document.createElement('button');
  dialog.append(button);
  document.body.append(dialog);
  dialog.addEventListener('keydown', localPrint);
  button.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true }));
  expect(localPrint).toHaveBeenCalledTimes(1);
  expect(globalPrint).not.toHaveBeenCalled();
  dialog.removeAttribute('data-shortcut-scope');
  button.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true }));
  expect(globalPrint).toHaveBeenCalledTimes(1);
  dispose(); unregister(); dialog.remove();
});
