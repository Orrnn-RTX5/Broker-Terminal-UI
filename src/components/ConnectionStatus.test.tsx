import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectionStatus } from './ConnectionStatus';
import { useWebSocketStore } from '../store/useWebSocketStore';

vi.mock('./LoginDialog', () => ({ LoginDialog: () => null }));

afterEach(() => vi.useRealTimers());

describe('connection measurement display', () => {
  it('shows measured FIX RTT, no claimed VPS improvement, and expires old samples', () => {
    vi.useFakeTimers();
    useWebSocketStore.setState({ connectionState: 'connected', fixConnectionState: 'connected', legacyConnectionState: 'disconnected', isStale: false,
      fixMetrics: { ...useWebSocketStore.getState().fixMetrics, lastLatency: 800, latencyMeasuredAt: Date.now() } });
    render(<ConnectionStatus />);
    expect(screen.getByText('Connected 800ms')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Click for connection details'));
    expect(screen.getByText('RTT 800.00 ms')).toBeInTheDocument();
    expect(screen.getByText('VPS Hosting Speed Up').parentElement?.parentElement).toHaveTextContent('Unavailable');
    act(() => { vi.advanceTimersByTime(61_000); });
    expect(screen.getByText('RTT unavailable')).toBeInTheDocument();
  });
});
