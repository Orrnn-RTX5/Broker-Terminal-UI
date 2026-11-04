import { useUiTranslation } from '../hooks/useUiTranslation';
import type { ReactNode } from 'react';
import { useDesktopStartupReady } from './useDesktopStartupReady';

interface TerminalLoadFallbackProps {
  sessionRestorePending?: boolean;
  message?: string;
  children?: ReactNode;
  isError?: boolean;
}

function resolveBootBrandLabel(): string {
  if (typeof document !== 'undefined') {
    const bootBrand = document.documentElement.getAttribute('data-rtx-boot-brand')?.trim();
    if (bootBrand) return bootBrand;
  }
  return 'Web Terminal';
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
  const brandLabel = resolveBootBrandLabel();
  return (
    <div
      className="rtx-terminal-loading"
      data-terminal-module-loading="true"
      data-session-restore-pending={sessionRestorePending ? 'true' : undefined}
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      aria-busy={!isError}
    >
      <div className="rtx-terminal-loading__card">
        <div className="rtx-terminal-loading__eyebrow" aria-hidden="true">
          <span className="rtx-terminal-loading__dot" />
          <span>{tr('MULTI-ASSET TRADING WORKSPACE')}</span>
        </div>
        <div className="rtx-terminal-loading__emblem" aria-hidden="true">
          <span className="rtx-terminal-loading__bar" />
          <span className="rtx-terminal-loading__bar" />
          <span className="rtx-terminal-loading__bar" />
          <span className="rtx-terminal-loading__bar" />
        </div>
        <div className="rtx-terminal-loading__brand">{brandLabel === 'Web Terminal' ? tr('Web Terminal') : brandLabel}</div>
        <div className="rtx-terminal-loading__status">
          {!isError && <div className="rtx-terminal-loading__spinner" aria-hidden="true" />}
          <div className="rtx-terminal-loading__message">{tr(message)}</div>
        </div>
        {!isError && (
          <>
            <div className="rtx-terminal-loading__progress" aria-hidden="true">
              <div className="rtx-terminal-loading__progress-bar" />
            </div>
            <div className="rtx-terminal-loading__meta" aria-hidden="true">
              <span className="rtx-terminal-loading__pill">
                <span className="rtx-terminal-loading__pill-dot" />
                {tr('MARKET FEED')}
              </span>
              <span className="rtx-terminal-loading__pill">
                <span className="rtx-terminal-loading__pill-dot" />
                {tr('CHART ENGINE')}
              </span>
              <span className="rtx-terminal-loading__pill">
                <span className="rtx-terminal-loading__pill-dot" />
                {tr('ORDER ROUTER')}
              </span>
            </div>
          </>
        )}
        {children}
      </div>
    </div>
  );
}
