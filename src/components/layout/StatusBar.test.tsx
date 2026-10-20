import { createPortal } from 'react-dom';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTerminalBarsStore } from '../../store/useTerminalBarsStore';
import { StatusBar } from './StatusBar';

const originalElectronDescriptor = Object.getOwnPropertyDescriptor(window, 'electron');
const originalAppActiveDescriptor = Object.getOwnPropertyDescriptor(window, '__RTX_APP_ACTIVE__');

vi.mock('../../hooks/useUiTranslation', () => ({
  useUiTranslation: () => (value: string) => value,
}));
vi.mock('../../hooks/useTerminalTitle', () => ({
  WEB_TERMINAL_TITLE: 'Web Terminal',
  useTerminalBrokerInfo: () => ({
    accountId: '---',
    brokerName: 'Test Broker',
    marginMode: 'Hedge',
    logoUrl: '',
    logoBaseCandidates: [],
  }),
  getLogoUrl: (url: string) => url,
  formatTerminalTitle: () => 'Web Terminal',
}));
vi.mock('../../hooks/useDesktopUpdater', () => ({
  useDesktopUpdater: () => ({ updatePhase: 'idle', updateLabel: '' }),
}));
vi.mock('../../store/useWebSocketStore', () => ({
  useWebSocketStore: (selector: (state: unknown) => unknown) => selector({
    connectionState: 'disconnected',
    isStale: false,
    legacyMetrics: { lastLatency: 0 },
  }),
}));
vi.mock('../../store/useAppStore', () => ({
  useAppStore: (selector: (state: unknown) => unknown) => selector({
    wsConnected: false,
    tradeApiStatus: { loading: false, error: null },
  }),
}));
vi.mock('../ui/Icon', () => ({ Icon: () => null }));
vi.mock('../LoginDialog', () => ({
  // The real login dialog is portalled outside the status bar as well.
  LoginDialog: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => (
    isOpen ? createPortal(
      <div role="dialog" aria-label="Login">
        <button onClick={onClose}>Close login</button>
      </div>,
      document.body,
    ) : null
  ),
}));

beforeEach(() => {
  useTerminalBarsStore.setState({ statusBarVisible: true, chartsBarVisible: true });
});

afterEach(() => {
  cleanup();
  useTerminalBarsStore.setState({ statusBarVisible: true, chartsBarVisible: true });
  localStorage.removeItem('rtx-terminal-bars');
  if (originalElectronDescriptor) {
    Object.defineProperty(window, 'electron', originalElectronDescriptor);
  } else {
    Reflect.deleteProperty(window, 'electron');
  }
  if (originalAppActiveDescriptor) {
    Object.defineProperty(window, '__RTX_APP_ACTIVE__', originalAppActiveDescriptor);
  } else {
    Reflect.deleteProperty(window, '__RTX_APP_ACTIVE__');
  }
});

describe.each(['web', 'packaged desktop'] as const)('StatusBar in %s', (runtime) => {
  beforeEach(() => {
    Object.defineProperty(window, 'electron', {
      configurable: true,
      writable: true,
      value: runtime === 'packaged desktop' ? {
        appVersion: '1.0.25',
        isPackaged: true,
        updater: { isSupported: false },
      } : undefined,
    });
  });

  it('shows the terminal version without a desktop download shortcut', () => {
    render(<StatusBar wsRef={{ current: null }} />);
    const download = screen.queryByRole('button', { name: 'Desktop App' });
    expect(download).toBeNull();
    expect(screen.getByText(runtime === 'web' ? 'v1.0.0' : 'v1.0.25')).toBeVisible();
  });

  it('hides and restores the bar while preserving the mounted connection control', () => {
    const { container } = render(<StatusBar wsRef={{ current: null }} />);
    const statusBar = container.querySelector('.rtx-status-bar');
    const connectionButton = screen.getByRole('button', { name: 'Disconnected' });
    expect(statusBar).toBeVisible();

    fireEvent.click(connectionButton);
    const networkRescan = screen.getByRole('button', { name: 'Network Rescan' });

    act(() => useTerminalBarsStore.getState().toggleStatusBar());
    expect(statusBar).not.toBeVisible();
    expect(connectionButton).toBeInTheDocument();
    expect(networkRescan).toBeInTheDocument();
    expect(networkRescan).not.toBeVisible();

    act(() => useTerminalBarsStore.getState().toggleStatusBar());
    expect(statusBar).toBeVisible();
    expect(screen.getByRole('button', { name: 'Disconnected' })).toBe(connectionButton);
    expect(screen.getByRole('button', { name: 'Network Rescan' })).toBe(networkRescan);
    expect(useTerminalBarsStore.getState().chartsBarVisible).toBe(true);
  });

  it('opens the external login dialog while the status bar is hidden', async () => {
    const { container } = render(<StatusBar wsRef={{ current: null }} />);
    act(() => useTerminalBarsStore.getState().toggleStatusBar());
    expect(container.querySelector('.rtx-status-bar')).not.toBeVisible();

    await act(async () => { window.dispatchEvent(new CustomEvent('rtx:openLoginDialog')); });
    const dialog = await screen.findByRole('dialog', { name: 'Login' }, { timeout: 5000 });
    expect(dialog).toBeVisible();
    expect(container).not.toContainElement(dialog);
    expect(useTerminalBarsStore.getState().statusBarVisible).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Close login' }));
    expect(screen.queryByRole('dialog', { name: 'Login' })).toBeNull();
  });

  it('leaves external login to the active App without opening a duplicate dialog', async () => {
    Object.defineProperty(window, '__RTX_APP_ACTIVE__', {
      configurable: true,
      writable: true,
      value: true,
    });
    const appLoginHandler = vi.fn();
    window.addEventListener('rtx:openLoginDialog', appLoginHandler);
    try {
      const { container } = render(<StatusBar wsRef={{ current: null }} />);
      act(() => useTerminalBarsStore.getState().toggleStatusBar());

      await act(async () => { window.dispatchEvent(new CustomEvent('rtx:openLoginDialog')); });

      expect(appLoginHandler).toHaveBeenCalledOnce();
      expect(screen.queryByRole('dialog', { name: 'Login' })).toBeNull();
      expect(container.querySelector('.rtx-status-bar')).not.toBeVisible();
    } finally {
      window.removeEventListener('rtx:openLoginDialog', appLoginHandler);
    }
  });
});
