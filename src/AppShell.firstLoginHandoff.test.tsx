// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AppShell from './AppShell';

const shellMocks = vi.hoisted(() => {
  let releaseTerminalImport: (() => void) | null = null;
  const terminalImportGate = new Promise<void>((resolve) => {
    releaseTerminalImport = resolve;
  });

  return {
    terminalImportGate,
    releaseTerminalImport: () => releaseTerminalImport?.(),
    terminalModuleImport: vi.fn(),
    preloadDockWorkspaceViewport: vi.fn(async () => undefined),
    preloadTradingChartRuntime: vi.fn(async () => undefined),
    terminalRender: vi.fn(),
  };
});

vi.mock('./App', async () => {
  shellMocks.terminalModuleImport();
  await shellMocks.terminalImportGate;

  return {
    default: ({ initialSessionHandoff }: { initialSessionHandoff?: unknown }) => {
      shellMocks.terminalRender(initialSessionHandoff);
      return <div data-testid="authenticated-terminal" />;
    },
  };
});

vi.mock('./i18n', () => ({
  i18nReady: Promise.resolve(),
}));
vi.mock('./authenticatedStyles', () => ({}));
vi.mock('./startup/tradingChartRuntime', () => ({
  preloadTradingChartRuntime: shellMocks.preloadTradingChartRuntime,
}));
vi.mock('./components/dock/DockWorkspace', () => ({
  preloadDockWorkspaceViewport: shellMocks.preloadDockWorkspaceViewport,
}));

vi.mock('./components/WelcomeTerminal', () => ({
  WelcomeTerminal: ({ onLogin, onPrepareTerminal }: {
    onLogin: (accountId: string, handoff: {
      accountId: string;
      token: string;
      expiresAt: number;
      committedAt: number;
    }) => void;
    onPrepareTerminal?: () => Promise<unknown> | void;
  }) => {
    const [preparing, setPreparing] = React.useState(false);

    const finishLogin = () => {
      setPreparing(true);
      void Promise.resolve(onPrepareTerminal?.()).then(() => {
        onLogin('200002', {
          accountId: '200002',
          token: 'fresh-token',
          expiresAt: Date.now() + 60_000,
          committedAt: Date.now(),
        });
      });
    };

    return (
      <div data-testid="login-screen">
        <button data-testid="login-success" onClick={finishLogin}>Login</button>
        {preparing && <span data-testid="login-preparing">Preparing terminal</span>}
      </div>
    );
  },
}));

describe('AppShell first-login handoff', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('keeps login visible in StrictMode while one preload completes without a fallback commit', async () => {
    const view = render(
      <React.StrictMode>
        <AppShell />
      </React.StrictMode>,
    );
    await waitFor(() => expect(view.getByTestId('login-success')).toBeTruthy());

    const fallbackMutations: Element[] = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const addedNode of record.addedNodes) {
          if (!(addedNode instanceof Element)) continue;
          if (addedNode.matches('[data-terminal-module-loading]')) {
            fallbackMutations.push(addedNode);
          }
          fallbackMutations.push(
            ...addedNode.querySelectorAll('[data-terminal-module-loading]'),
          );
        }
      }
    });
    observer.observe(view.container, { childList: true, subtree: true });

    try {
      fireEvent.click(view.getByTestId('login-success'));

      await waitFor(() => expect(view.getByTestId('login-preparing')).toBeTruthy());
      expect(view.getByTestId('login-screen')).toBeTruthy();
      expect(view.container.querySelector('[data-terminal-module-loading]')).toBeNull();
      expect(shellMocks.terminalRender).not.toHaveBeenCalled();

      shellMocks.releaseTerminalImport();

      await waitFor(
        () => expect(view.getByTestId('authenticated-terminal')).toBeTruthy(),
        { timeout: 5_000 },
      );
      await Promise.resolve();

      expect(shellMocks.terminalModuleImport).toHaveBeenCalledTimes(1);
      expect(shellMocks.preloadTradingChartRuntime).toHaveBeenCalledTimes(1);
      // App owns DockWorkspace; only its heavy chart runtime is warmed beside
      // the shell and must not trigger a second workspace import.
      expect(shellMocks.preloadDockWorkspaceViewport).not.toHaveBeenCalled();
      expect(shellMocks.terminalRender).toHaveBeenCalled();
      for (const [handoff] of shellMocks.terminalRender.mock.calls) {
        expect(handoff).toEqual(expect.objectContaining({
          accountId: '200002',
          token: 'fresh-token',
        }));
      }
      expect(fallbackMutations).toEqual([]);
      expect(view.container.querySelector('[data-terminal-module-loading]')).toBeNull();
    } finally {
      observer.disconnect();
    }
  });
});
