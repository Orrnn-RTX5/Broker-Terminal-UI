import { useEffect, useRef, type FC } from 'react';
import { createPortal } from 'react-dom';
import { useUiTranslation } from '../../hooks/useUiTranslation';

interface MarketWatchSaveSetDialogProps {
  isOpen: boolean;
  value: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}

export const MarketWatchSaveSetDialog: FC<MarketWatchSaveSetDialogProps> = ({
  isOpen,
  value,
  onChange,
  onCancel,
  onSave,
}) => {
  const tr = useUiTranslation();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [isOpen]);

  if (!isOpen) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[10040] flex items-center justify-center bg-black/45"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-label={tr('Save Market Watch set')}
        onSubmit={(event) => { event.preventDefault(); onSave(); }}
        onKeyDown={(event) => { if (event.key === 'Escape') onCancel(); }}
        className="w-[360px] max-w-[calc(100vw-32px)] border border-[var(--border-secondary)] bg-[var(--bg-secondary)] p-4 text-[var(--text-primary)] shadow-2xl"
      >
        <div className="mb-3 text-sm font-semibold">{tr('Save Market Watch set')}</div>
        <label className="mb-1 block text-xs text-[var(--text-secondary)]" htmlFor="market-watch-set-name">
          {tr('Set name')}
        </label>
        <input
          ref={inputRef}
          id="market-watch-set-name"
          value={value}
          maxLength={100}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 w-full border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-2 text-sm text-[var(--text-primary)] outline-none focus:border-[#0078d7]"
          autoComplete="off"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="h-8 border border-[var(--border-secondary)] px-3 text-xs">
            {tr('Cancel')}
          </button>
          <button type="submit" disabled={!value.trim()} className="h-8 bg-[#0078d7] px-3 text-xs text-white disabled:opacity-50">
            {tr('Save')}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
};
