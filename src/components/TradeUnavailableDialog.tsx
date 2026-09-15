import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useUiTranslation } from '../hooks/useUiTranslation';

export function TradeUnavailableDialog({ message, onClose }: { message: string; onClose: () => void }) {
  const tr = useUiTranslation();
  const titleId = useId();
  const messageId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    buttonRef.current?.focus();
    return () => { if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus(); };
  }, []);
  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 p-4"
      onPointerDown={event => { event.stopPropagation(); if (event.target === event.currentTarget) onClose(); }}
      onClick={event => event.stopPropagation()}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); onClose(); }
        if (event.key === 'Tab') { event.preventDefault(); buttonRef.current?.focus(); }
      }}>
      <div role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={messageId}
        className="w-full max-w-[420px] rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-primary)] shadow-2xl">
        <h2 id={titleId} className="border-b border-[var(--border-primary)] px-4 py-3 text-sm font-medium">{tr('Unable to place trade')}</h2>
        <p id={messageId} className="px-4 py-5 text-sm leading-6">{message}</p>
        <div className="flex justify-end px-4 pb-4">
          <button ref={buttonRef} type="button" onClick={onClose} className="rounded bg-blue-600 px-7 py-1.5 text-sm text-white hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400">{tr('OK')}</button>
        </div>
      </div>
    </div>, document.body,
  );
}
