import { Profiler } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useWebSocketStore } from '../store/useWebSocketStore';
import { useAppStore } from '../store/useAppStore';
import { ConnectionStatus } from './ConnectionStatus';

vi.mock('../hooks/useUiTranslation', () => ({ useUiTranslation: () => (value: string) => value }));
vi.mock('../store/useAppStore', async () => {
  const { create } = await import('zustand');
  return { useAppStore: create(() => ({
    wsConnected: false,
    tradeApiStatus: { loading: false, error: null, lastSuccessAt: null },
  })) };
});
vi.mock('./LoginDialog', () => ({ LoginDialog: () => null }));

const initialSocket = useWebSocketStore.getState();
const initialApp = useAppStore.getState();
beforeEach(() => {
  useWebSocketStore.setState(initialSocket, true);
  useAppStore.setState(initialApp, true);
  useWebSocketStore.getState().setConnectionState('connected', 'fix_socket');
  // Latency is only displayed while its sample is fresh, so stamp it.
  useWebSocketStore.getState().updateMetrics({ lastLatency: 12, latencyMeasuredAt: Date.now() }, 'fix_socket');
});
afterEach(cleanup);

it('does not commit renders for message metadata or closed-menu diagnostics', () => {
  const rendered = vi.fn();
  render(<Profiler id="connection" onRender={rendered}><ConnectionStatus /></Profiler>);
  const initialCommits = rendered.mock.calls.length;
  for (let index = 1; index <= 5; index++) {
    act(() => {
      useWebSocketStore.getState().updateLastMessageTime(index);
      useWebSocketStore.getState().updateMetrics({ messagesReceived: index, uptime: index }, 'fix_socket');
      useWebSocketStore.getState().updateMetrics({ lastLatency: 80 + index }, 'legacy_mt5');
      useAppStore.setState({
        wsConnected: index % 2 === 0,
        tradeApiStatus: { ...useAppStore.getState().tradeApiStatus, loading: true, error: 'poll unavailable' },
      });
    });
  }
  expect(rendered).toHaveBeenCalledTimes(initialCommits);
  expect(screen.getByRole('button', { name: 'Connected 12ms' })).toBeVisible();

  fireEvent.click(screen.getByRole('button', { name: 'Connected 12ms' }));
  expect(screen.getByText('REST error')).toHaveAttribute('title', 'poll unavailable');
  act(() => useAppStore.setState({
    tradeApiStatus: { ...useAppStore.getState().tradeApiStatus, loading: true, error: null },
  }));
  expect(screen.getByText('syncing')).toBeVisible();
});

it('updates displayed latency, fallback transport, and stale state immediately', () => {
  render(<ConnectionStatus />);
  act(() => useWebSocketStore.getState().updateMetrics({ lastLatency: 25, latencyMeasuredAt: Date.now() }, 'fix_socket'));
  expect(screen.getByRole('button', { name: 'Connected 25ms' })).toBeVisible();

  act(() => {
    useWebSocketStore.getState().setConnectionState('connected', 'legacy_mt5');
    useWebSocketStore.getState().updateMetrics({ lastLatency: 31, latencyMeasuredAt: Date.now() }, 'legacy_mt5');
    useWebSocketStore.getState().setConnectionState('disconnected', 'fix_socket');
  });
  expect(screen.getByRole('button', { name: 'Connected 31ms' })).toBeVisible();
  act(() => useWebSocketStore.getState().markStale(true));
  expect(screen.getByText('(Stale)')).toBeVisible();
  act(() => useWebSocketStore.getState().updateLastMessageTime(100));
  expect(screen.queryByText('(Stale)')).toBeNull();
});
