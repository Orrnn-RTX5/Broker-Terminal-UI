// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DesktopWindowShell } from './DesktopWindowShell';

type ElectronWindowApi = NonNullable<Window['electron']>['window'];

const installElectronBridge = () => {
  let maximizeListener: ((maximized: boolean) => void) | undefined;
  const unsubscribe = vi.fn();
  const windowApi: ElectronWindowApi = {
    minimize: vi.fn(),
    maximize: vi.fn(),
    close: vi.fn(),
    isMaximized: vi.fn().mockResolvedValue(false),
    setTitle: vi.fn(),
    onMaximizeChange: vi.fn((listener) => {
      maximizeListener = listener;
      return unsubscribe;
    }),
  };

  Object.defineProperty(window, 'electron', {
    configurable: true,
    writable: true,
    value: { window: windowApi },
  });

  return {
    windowApi,
    unsubscribe,
    emitMaximizeChange: (maximized: boolean) => maximizeListener?.(maximized),
  };
};

describe('DesktopWindowShell', () => {
  beforeEach(() => {
    document.title = 'RTX 5 Web Terminal';
    delete window.electron;
  });

  afterEach(() => {
    cleanup();
    delete window.electron;
    document.documentElement.classList.remove('rtx-desktop-shell-active');
  });

  it('leaves the browser render tree unchanged when the Electron window bridge is absent', () => {
    const view = render(
      <DesktopWindowShell>
        <div data-testid="content">Browser content</div>
      </DesktopWindowShell>,
    );

    expect(view.container.querySelector('[data-rtx-desktop-shell="true"]')).toBeNull();
    expect(document.documentElement.classList.contains('rtx-desktop-shell-active')).toBe(false);
    expect(view.container.children).toHaveLength(1);
    expect(view.container.firstElementChild).toBe(view.getByTestId('content'));
  });

  it('renders compact desktop chrome and delegates all window actions to the preload bridge', async () => {
    const bridge = installElectronBridge();
    const view = render(
      <DesktopWindowShell>
        <div data-testid="content">Desktop content</div>
      </DesktopWindowShell>,
    );

    const shell = view.container.querySelector('[data-rtx-desktop-shell="true"]');
    expect(shell).not.toBeNull();
    expect(document.documentElement.classList.contains('rtx-desktop-shell-active')).toBe(true);
    expect(view.getByText('RTX Terminal')).toBeTruthy();

    fireEvent.click(view.getByRole('button', { name: 'Minimize window' }));
    fireEvent.click(view.getByRole('button', { name: 'Maximize window' }));
    fireEvent.click(view.getByRole('button', { name: 'Close window' }));

    expect(bridge.windowApi.minimize).toHaveBeenCalledTimes(1);
    expect(bridge.windowApi.maximize).toHaveBeenCalledTimes(1);
    expect(bridge.windowApi.close).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(bridge.windowApi.isMaximized).toHaveBeenCalledTimes(1));

    act(() => bridge.emitMaximizeChange(true));
    expect(view.getByRole('button', { name: 'Restore window' })).toBeTruthy();

    view.unmount();
    expect(bridge.unsubscribe).toHaveBeenCalledTimes(1);
    expect(document.documentElement.classList.contains('rtx-desktop-shell-active')).toBe(false);
  });

  it('tracks the authenticated terminal title without importing authenticated state', async () => {
    installElectronBridge();
    const view = render(
      <DesktopWindowShell>
        <div>Desktop content</div>
      </DesktopWindowShell>,
    );

    act(() => {
      document.title = '100043 - RTX-Server - Hedge - RTX - EURUSD,M15';
    });

    await waitFor(() => {
      expect(view.getByText('100043 - RTX-Server - Hedge - RTX - EURUSD,M15')).toBeTruthy();
    });
  });
});
