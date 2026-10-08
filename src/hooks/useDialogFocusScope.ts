import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { isShortcutOwnedBy, shouldIgnoreShortcutEvent } from '../services/keyboardShortcutManager';

interface DialogFocusScopeOptions {
  isOpen: boolean;
  dialogRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
  closeOnEscape?: boolean;
}

const isVisibleControl = (element: HTMLElement, dialog: HTMLElement): boolean => {
  if (element.tabIndex < 0 || element.matches(':disabled, input[type="hidden"]')) return false;
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    if (current.hidden || current.hasAttribute('inert') || current.getAttribute('aria-hidden') === 'true') return false;
    const style = window.getComputedStyle(current);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (current === dialog) break;
  }
  return true;
};

/** Own modal keyboard navigation without capturing another dialog's keys. */
export function useDialogFocusScope({
  isOpen,
  dialogRef,
  onClose,
  initialFocusRef,
  closeOnEscape = true,
}: DialogFocusScopeOptions): void {
  const callbacks = useRef({ onClose, closeOnEscape });
  useLayoutEffect(() => {
    callbacks.current = { onClose, closeOnEscape };
  }, [onClose, closeOnEscape]);

  useEffect(() => {
    if (!isOpen) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (initialFocusRef?.current ?? dialog).focus({ preventScroll: true });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' && event.key !== 'Tab') return;
      // A held Tab key still needs containment; repeated Escape is ignored.
      if ((event.key === 'Escape' && shouldIgnoreShortcutEvent(event))
        || event.defaultPrevented || event.isComposing || event.keyCode === 229
        || event.getModifierState('AltGraph') || !isShortcutOwnedBy(event, dialog)) return;
      if (event.key === 'Escape') {
        if (!callbacks.current.closeOnEscape) return;
        event.preventDefault();
        event.stopPropagation();
        callbacks.current.onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      // Query once in DOM order; only currently available controls participate.
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>('*'))
        .filter(element => isVisibleControl(element, dialog));
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first || !last) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
      } else if (document.activeElement === dialog
        || (event.shiftKey && document.activeElement === first)
        || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (previousFocus?.isConnected
        && (document.activeElement === document.body || dialog.contains(document.activeElement))) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, [isOpen, dialogRef, initialFocusRef]);
}
