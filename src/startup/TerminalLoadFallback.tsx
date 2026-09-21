import { useUiTranslation } from '../hooks/useUiTranslation';
import type { ReactNode } from 'react';
import { useDesktopStartupReady } from './useDesktopStartupReady';

interface TerminalLoadFallbackProps {
  sessionRestorePending?: boolean;
  message?: string;
  children?: ReactNode;
  isError?: boolean;
}

/** Shared startup surface until the terminal can present its initial data. */
export function TerminalLoadFallback({
  sessionRestorePending = false,
  message = 'Loading terminal…',
  children,
  isError = false,
}: TerminalLoadFallbackProps) {
  const tr = useUiTranslation();
  useDesktopStartupReady(isError);
  return (
    <div
      className="rtx-terminal-loading"
      data-terminal-module-loading="true"
      data-session-restore-pending={sessionRestorePending ? 'true' : undefined}
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      aria-busy={!isError}
    >
      <div className="rtx-terminal-loading__brand">RTX 5</div>
      {!isError && <div className="rtx-terminal-loading__spinner" aria-hidden="true" />}
      <div className="rtx-terminal-loading__message">{tr(message)}</div>
      {children}
    </div>
  );
}
