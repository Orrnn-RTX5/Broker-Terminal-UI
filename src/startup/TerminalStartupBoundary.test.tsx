import { StrictMode, useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TerminalStartupBoundary, useTerminalStartupReady } from './TerminalStartupBoundary';

vi.mock('../hooks/useUiTranslation', () => ({
  useUiTranslation: () => (text: string) => text,
}));

interface WorkspaceProps {
  marketWatchReady?: boolean;
  chartReady?: boolean;
  onMount?: () => void;
  onUnmount?: () => void;
}

function Workspace({ marketWatchReady = false, chartReady = false, onMount, onUnmount }: WorkspaceProps) {
  useTerminalStartupReady('marketWatch', marketWatchReady);
  useTerminalStartupReady('chart', chartReady);
  useEffect(() => {
    onMount?.();
    return () => onUnmount?.();
  }, [onMount, onUnmount]);
  return <input aria-label="Workspace state" defaultValue="initial" />;
}

function startup({
  dataReady = false,
  waitForChart = true,
  ...workspace
}: WorkspaceProps & { dataReady?: boolean; waitForChart?: boolean } = {}) {
  return (
    <StrictMode>
      <TerminalStartupBoundary dataReady={dataReady} waitForChart={waitForChart}>
        <Workspace {...workspace} />
      </TerminalStartupBoundary>
    </StrictMode>
  );
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('TerminalStartupBoundary', () => {
  it('mounts the workspace hidden and inert, then reveals the same instance once every part is ready', () => {
    const onMount = vi.fn();
    const onUnmount = vi.fn();
    const view = render(startup({ onMount, onUnmount }));
    const input = screen.getByLabelText('Workspace state');
    const workspace = input.parentElement!;
    expect(onMount).toHaveBeenCalled();
    expect(input).not.toBeVisible();
    expect(workspace).toHaveAttribute('aria-hidden', 'true');
    expect(workspace).toHaveAttribute('inert');
    expect(screen.getByRole('status')).toBeVisible();

    // Preserve an uncontrolled child value across reveal to catch remounts.
    fireEvent.change(input, { target: { value: 'preserved workspace' } });
    const mountsBeforeReveal = onMount.mock.calls.length;
    const unmountsBeforeReveal = onUnmount.mock.calls.length;

    view.rerender(startup({ dataReady: true, marketWatchReady: true, chartReady: true, onMount, onUnmount }));

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Workspace state')).toBe(input);
    expect(input).toBeVisible();
    expect(input).toHaveValue('preserved workspace');
    expect(workspace).not.toHaveAttribute('aria-hidden');
    expect(workspace).not.toHaveAttribute('inert');
    expect(onMount).toHaveBeenCalledTimes(mountsBeforeReveal);
    expect(onUnmount).toHaveBeenCalledTimes(unmountsBeforeReveal);
  });

  it.each(['dataReady', 'marketWatchReady', 'chartReady'] as const)(
    'keeps loading when only %s is still pending',
    missing => {
      const ready = { dataReady: true, marketWatchReady: true, chartReady: true };
      const view = render(startup({ ...ready, [missing]: false }));
      expect(screen.getByRole('status')).toBeVisible();
      expect(screen.getByLabelText('Workspace state')).not.toBeVisible();

      view.rerender(startup(ready));
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Workspace state')).toBeVisible();
    },
  );

  it('keeps the terminal visible when data becomes unavailable after the initial reveal', () => {
    const view = render(startup({ dataReady: true, marketWatchReady: true, chartReady: true }));
    expect(screen.getByLabelText('Workspace state')).toBeVisible();

    view.rerender(startup({ dataReady: false, marketWatchReady: false, chartReady: false }));
    act(() => vi.advanceTimersByTime(15_000));

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Workspace state')).toBeVisible();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not wait for a chart when the workspace has no chart', () => {
    render(startup({ dataReady: true, marketWatchReady: true, waitForChart: false }));

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Workspace state')).toBeVisible();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('auto-opens the pending workspace after 15 seconds without recovery buttons', () => {
    render(startup());
    act(() => vi.advanceTimersByTime(14_999));
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Workspace state')).not.toBeVisible();

    act(() => vi.advanceTimersByTime(1));

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Workspace state')).toBeVisible();
    expect(screen.getByLabelText('Workspace state').parentElement).not.toHaveAttribute('inert');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the slow-connection timer when readiness arrives before the deadline', () => {
    const view = render(startup());
    expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(5_000));

    view.rerender(startup({ dataReady: true, marketWatchReady: true, chartReady: true }));

    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(15_000));
    expect(screen.getByLabelText('Workspace state')).toBeVisible();
  });

  it('clears the pending timer when the workspace unmounts', () => {
    const view = render(startup());
    expect(vi.getTimerCount()).toBe(1);

    view.unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});
