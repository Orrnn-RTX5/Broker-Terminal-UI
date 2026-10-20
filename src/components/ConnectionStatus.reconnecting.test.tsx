import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectionStatus } from './ConnectionStatus';
import { useWebSocketStore } from '../store/useWebSocketStore';

vi.mock('./LoginDialog', () => ({ LoginDialog: () => null }));

afterEach(() => {
  cleanup();
  useWebSocketStore.setState({ connectionState: 'disconnected', fixConnectionState: 'disconnected', legacyConnectionState: 'disconnected', isStale: false });
});

describe('status bar while the server is unreachable', () => {
  it('shows "Reconnecting to server…" while the socket reconnects with backoff', () => {
    useWebSocketStore.setState({
      connectionState: 'reconnecting', fixConnectionState: 'reconnecting', legacyConnectionState: 'disconnected', isStale: false,
    });
    render(<ConnectionStatus />);
    expect(screen.getByText('Reconnecting to server…')).toBeInTheDocument();
  });

  it('returns to "Connected" when the socket recovers', () => {
    useWebSocketStore.setState({
      connectionState: 'connected', fixConnectionState: 'connected', legacyConnectionState: 'disconnected', isStale: false,
    });
    render(<ConnectionStatus />);
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.queryByText('Reconnecting to server…')).not.toBeInTheDocument();
  });
});
