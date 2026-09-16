import { useUiTranslation } from '../../hooks/useUiTranslation';
import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { Copy, Minus, Square, X } from 'lucide-react';
import { BROKER_CHROME_EVENT, getBrokerChrome, type BrokerChromeState } from '../../services/brokerPresentation';
import './DesktopWindowShell.css';

interface DesktopWindowShellProps {
  children: ReactNode;
}

type ElectronWindowApi = NonNullable<Window['electron']>['window'];

const DEFAULT_DESKTOP_TITLE = 'RTX Terminal';
const DEFAULT_TITLEBAR_ICON = './titlebar-icon.png';

const readDesktopTitle = (): string => {
  const title = typeof document === 'undefined' ? '' : document.title.trim();
  return !title || title === 'RTX 5 Web Terminal' ? DEFAULT_DESKTOP_TITLE : title;
};

const readDesktopBrokerLogo = (): string => getBrokerChrome().logoUrl || DEFAULT_TITLEBAR_ICON;

// Preserve the UTC clock previously displayed in the desktop status bar.
function DesktopTitleClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <time className="rtx-desktop-titlebar__clock" dateTime={now.toISOString()} title="UTC">{now.toISOString().slice(11, 19)} UTC</time>;
}

function ElectronDesktopWindowShell({
  children,
  electronWindow,
}: DesktopWindowShellProps & { electronWindow: ElectronWindowApi }) {
    const tr = useUiTranslation();
  const [isMaximized, setIsMaximized] = useState(false);
  const [title, setTitle] = useState(readDesktopTitle);
  const [brokerLogo, setBrokerLogo] = useState(readDesktopBrokerLogo);

  useLayoutEffect(() => {
    document.documentElement.classList.add('rtx-desktop-shell-active');
    return () => document.documentElement.classList.remove('rtx-desktop-shell-active');
  }, []);

  useEffect(() => {
    let active = true;

    electronWindow.isMaximized()
      .then((maximized) => {
        if (active) setIsMaximized(maximized);
      })
      .catch(() => {
        if (active) setIsMaximized(false);
      });

    const unsubscribe = electronWindow.onMaximizeChange((maximized) => {
      if (active) setIsMaximized(maximized);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [electronWindow]);

  useEffect(() => {
    const refreshTitle = () => setTitle(readDesktopTitle());
    refreshTitle();
    setBrokerLogo(readDesktopBrokerLogo());

    const observer = new MutationObserver(refreshTitle);
    const titleElement = document.querySelector('title');
    if (titleElement) {
      observer.observe(titleElement, { childList: true, characterData: true, subtree: true });
    } else {
      observer.observe(document.head, { childList: true, subtree: true });
    }

    const onBrokerChrome = (event: Event) => {
      const detail = (event as CustomEvent<BrokerChromeState>).detail;
      setBrokerLogo(detail?.logoUrl || DEFAULT_TITLEBAR_ICON);
      refreshTitle();
    };
    window.addEventListener(BROKER_CHROME_EVENT, onBrokerChrome);

    return () => {
      observer.disconnect();
      window.removeEventListener(BROKER_CHROME_EVENT, onBrokerChrome);
    };
  }, []);

  return (
    <div className="rtx-desktop-shell" data-rtx-desktop-shell="true">
      <header className="rtx-desktop-titlebar" aria-label={tr("Application title bar")}>
        <div className="rtx-desktop-titlebar__drag-region">
          <img
            className="rtx-desktop-titlebar__icon"
            src={brokerLogo}
            alt=""
            aria-hidden="true"
            draggable={false}
            onError={event => {
              if (event.currentTarget.src.endsWith(DEFAULT_TITLEBAR_ICON.replace('./', ''))) return;
              event.currentTarget.src = DEFAULT_TITLEBAR_ICON;
            }}
          />
          <DesktopTitleClock />
          <span className="rtx-desktop-titlebar__title" title={tr(title)}>{tr(title)}</span>
        </div>

        <div
          className="rtx-desktop-titlebar__controls"
          data-window-controls
          role="toolbar"
          aria-label={tr("Window controls")}
        >
          <button
            type="button"
            className="rtx-desktop-titlebar__control"
            aria-label={tr("Minimize window")}
            title={tr("Minimize")}
            onClick={() => electronWindow.minimize()}
          >
            <Minus size={13} strokeWidth={1.5} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="rtx-desktop-titlebar__control"
            aria-label={isMaximized ? tr("Restore window") : tr("Maximize window")}
            title={isMaximized ? tr("Restore") : tr("Maximize")}
            onClick={() => electronWindow.maximize()}
          >
            {isMaximized ? (
              <Copy size={12} strokeWidth={1.45} aria-hidden="true" />
            ) : (
              <Square size={11} strokeWidth={1.45} aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            className="rtx-desktop-titlebar__control rtx-desktop-titlebar__control--close"
            aria-label={tr("Close window")}
            title={tr("Close")}
            onClick={() => electronWindow.close()}
          >
            <X size={14} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>
      </header>

      <main className="rtx-desktop-shell__content">{children}</main>
    </div>
  );
}

/**
 * Adds native-feeling chrome only when the secure Electron preload bridge is
 * available. Browser builds receive their children without an extra wrapper.
 */
export function DesktopWindowShell({ children }: DesktopWindowShellProps) {
  const electronWindow = typeof window === 'undefined' ? undefined : window.electron?.window;
  if (!electronWindow) return <>{children}</>;

  return (
    <ElectronDesktopWindowShell electronWindow={electronWindow}>
      {children}
    </ElectronDesktopWindowShell>
  );
}
