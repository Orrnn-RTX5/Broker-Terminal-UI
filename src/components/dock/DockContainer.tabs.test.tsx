// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DockLayout } from '../../services/dockManager';
import { useDockLayoutStore } from '../../store/useDockLayoutStore';
import { DockContainer } from './DockContainer';

const originalLayout = useDockLayoutStore.getState().layout;

const restoredChartTabsLayout = (): DockLayout => ({
  version: 'lazy-tab-mount-test',
  floatingPanels: [],
  root: {
    id: 'root',
    type: 'tabs',
    ratio: 1,
    activeTab: 'chart-a',
    children: [
      {
        id: 'chart-a',
        title: 'Chart A',
        component: 'Chart',
        props: { symbol: 'AAVUSD' },
      },
      {
        id: 'chart-b',
        title: 'Chart B',
        component: 'Chart',
        props: { symbol: 'BTCUSD' },
      },
      {
        id: 'chart-c',
        title: 'Chart C',
        component: 'Chart',
        props: { symbol: 'XAUUSD' },
      },
    ],
  },
});

afterEach(() => {
  cleanup();
  useDockLayoutStore.getState().setLayout(originalLayout);
  vi.restoreAllMocks();
});

describe('DockContainer lazy tab mounting', () => {
  it('mounts only the restored active chart, then keeps visited tabs warm', async () => {
    useDockLayoutStore.getState().setLayout(restoredChartTabsLayout());
    const mounted = vi.fn();
    const unmounted = vi.fn();

    const StatefulChart: React.FC<{ panelId: string }> = ({ panelId }) => {
      const [value, setValue] = React.useState('');

      React.useEffect(() => {
        mounted(panelId);
        return () => unmounted(panelId);
      }, [panelId]);

      return (
        <input
          aria-label={`${panelId} state`}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      );
    };

    const view = render(
      <DockContainer
        isRoot
        renderPanel={(panel) => <StatefulChart panelId={panel.id} />}
      />,
    );

    expect(view.getByLabelText('chart-a state')).toBeTruthy();
    expect(view.queryByLabelText('chart-b state')).toBeNull();
    expect(view.queryByLabelText('chart-c state')).toBeNull();
    expect(mounted.mock.calls).toEqual([['chart-a']]);

    fireEvent.change(view.getByLabelText('chart-a state'), { target: { value: 'preserve-a' } });
    fireEvent.click(view.getByText('Chart B'));

    await waitFor(() => expect(view.getByLabelText('chart-b state')).toBeTruthy());
    expect((view.getByLabelText('chart-a state') as HTMLInputElement).value).toBe('preserve-a');
    expect(view.queryByLabelText('chart-c state')).toBeNull();
    expect(mounted.mock.calls).toEqual([['chart-a'], ['chart-b']]);
    expect(unmounted).not.toHaveBeenCalled();

    fireEvent.change(view.getByLabelText('chart-b state'), { target: { value: 'preserve-b' } });
    fireEvent.click(view.getByText('Chart A'));

    await waitFor(() => {
      expect((view.getByLabelText('chart-a state') as HTMLInputElement).value).toBe('preserve-a');
      expect((view.getByLabelText('chart-b state') as HTMLInputElement).value).toBe('preserve-b');
    });
    expect(mounted.mock.calls).toEqual([['chart-a'], ['chart-b']]);
    expect(unmounted).not.toHaveBeenCalled();
  });
});
