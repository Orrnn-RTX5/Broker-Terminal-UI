import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ConnectionStatus } from './ConnectionStatus';

const loginModuleLoaded = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useUiTranslation', () => ({ useUiTranslation: () => (value: string) => value }));
vi.mock('../store/useWebSocketStore', () => ({
  useWebSocketStore: (selector: (state: unknown) => unknown) => selector({ connectionState: 'disconnected', isStale: false, legacyMetrics: { lastLatency: 0 } }),
}));
vi.mock('../store/useAppStore', () => ({
  useAppStore: (selector: (state: unknown) => unknown) => selector({ wsConnected: false, tradeApiStatus: {} }),
}));
vi.mock('./LoginDialog', () => {
  loginModuleLoaded();
  return {
    LoginDialog: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => {
      const [draft, setDraft] = useState('');
      return isOpen ? <div role="dialog" aria-label="Login">
        <input aria-label="Account" value={draft} onChange={event => setDraft(event.target.value)} />
        <button onClick={onClose}>Close login</button>
      </div> : null;
    },
  };
});

afterEach(cleanup);

it('keeps the login module out of startup while retaining global and menu login actions', async () => {
  render(<ConnectionStatus />);
  expect(loginModuleLoaded).not.toHaveBeenCalled();
  act(() => { window.dispatchEvent(new CustomEvent('rtx:openLoginDialog')); });
  expect(await screen.findByRole('dialog', { name: 'Login' })).toBeVisible();
  fireEvent.change(screen.getByRole('textbox', { name: 'Account' }), { target: { value: '200001' } });
  fireEvent.click(screen.getByRole('button', { name: 'Close login' }));
  expect(screen.queryByRole('dialog')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Disconnected' }));
  fireEvent.click(screen.getByRole('button', { name: 'Login' }));
  expect(screen.getByRole('textbox', { name: 'Account' })).toHaveValue('200001');
  expect(loginModuleLoaded).toHaveBeenCalledOnce();
});
