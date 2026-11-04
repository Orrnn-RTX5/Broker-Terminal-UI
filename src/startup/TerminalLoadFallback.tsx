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
      <svg
        className="rtx-terminal-loading__icon"
        viewBox="15 145 760 545"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          className="rtx-terminal-loading__icon-wing"
          d="M137 172L264.5 172L413 342.5L289.5 342.5Z M372 480.5L501.5 480.5L654.5 650.5L525.5 650.5Z M456.5 390L555 390C625 314 700 232 766 161C769.5 157.5 767 155.5 761 158.5C718 184.5 672 202 610 202L512 201.5C484 201.5 466 224 459 250C456.5 260 460 265 470 264.5L526 263C552 263 559 279 544 296L456.5 390Z M335 450L236.5 450C166.5 526 91.5 608 25.5 679C22 682.5 24.5 684.5 30.5 681.5C73.5 655.5 119.5 638 181.5 638L279.5 638.5C307.5 638.5 325.5 616 332.5 590C335 580 331.5 575 321.5 575.5L265.5 577C239.5 577 232.5 561 247.5 544L335 450Z"
        />
        <path
          className="rtx-terminal-loading__icon-five"
          d="M355 367L432.5 367L425 388.5L374.5 388.5L374.5 397L410 397C429 397 438.5 408 438.5 428.5C438.5 449.5 428 460.5 409 460.5L382 460.5C364.5 460.5 355 449 355 432L374.5 432C374.5 437.5 378.5 439.5 385 439.5L408 439.5C416 439.5 419.5 435.5 419.5 428.5C419.5 421.5 416 418 408 418L355 418L355 367Z"
        />
      </svg>
      <div className="rtx-terminal-loading__brand">{brandLabel === 'Web Terminal' ? tr('Web Terminal') : brandLabel}</div>
      <div className="rtx-terminal-loading__status">
        <div className="rtx-terminal-loading__message">{tr(message)}</div>
      </div>
      {children}
    </div>
  );
}
