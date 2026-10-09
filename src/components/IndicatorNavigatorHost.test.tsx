// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commandBus } from '../services/commandBus';
import { defaultChartProperties, useChartSettingsStore } from '../store/useChartSettingsStore';
import type { ChartCommandTarget } from '../services/chartCommandTarget';
import type { IndicatorInfo } from './IndicatorNavigator';
import { IndicatorNavigatorHost } from './IndicatorNavigatorHost';

const fixture = vi.hoisted(() => ({
  active: {} as ChartCommandTarget,
  dialogRender: vi.fn(),
}));
vi.mock('../services/chartCommandTarget', () => ({
  getActiveChartCommandTarget: (fallbackSymbol?: string, fallbackTimeframe?: string) => ({
    ...fixture.active,
    symbol: fixture.active.symbol ?? fallbackSymbol,
    timeframe: fixture.active.timeframe ?? fallbackTimeframe,
  }),
}));
vi.mock('./IndicatorNavigator', async importOriginal => {
  const original = await importOriginal<typeof import('./IndicatorNavigator')>();
  return {
    ...original,
    IndicatorNavigator: (props: {
      isOpen: boolean; onClose: () => void; onAddIndicator: (indicator: IndicatorInfo) => void; initialCategory?: string;
    }) => {
      fixture.dialogRender();
      return <original.IndicatorNavigator {...props} />;
    },
  };
});

const open = (payload: { category?: string; targetContextId?: string; symbol?: string } = {}) => {
  act(() => { commandBus.dispatch({ type: 'OPEN_INDICATOR_LIST', payload }); });
};
const releases: Array<() => void> = [];
const captureAdds = () => {
  const listener = vi.fn();
  releases.push(commandBus.subscribe('ADD_INDICATOR', listener));
  return listener;
};

beforeEach(() => {
  fixture.active = { targetContextId: 'chart-a', symbol: 'EURUSD.r', timeframe: 'M5' };
  fixture.dialogRender.mockClear();
  useChartSettingsStore.setState({ globalProperties: { ...defaultChartProperties }, symbolProperties: {} });
});
afterEach(() => { cleanup(); releases.splice(0).forEach(release => release()); });

describe('indicator navigator isolated ownership', () => {
  it('opens and closes immediately without rendering the terminal or workspace again', () => {
    const terminalRender = vi.fn();
    const workspaceRender = vi.fn();
    function Workspace() { workspaceRender(); return <div>Workspace</div>; }
    function Terminal() {
      terminalRender();
      return <><Workspace /><IndicatorNavigatorHost selectedSymbol="BTCUSD" timeframe="M1" /></>;
    }
    render(<Terminal />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    open();
    expect(screen.getByRole('dialog', { name: 'Indicators' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(terminalRender).toHaveBeenCalledOnce();
    expect(workspaceRender).toHaveBeenCalledOnce();
  });

  it('does not rerender the open indicator catalog when unrelated parent state updates', () => {
    const contents = (revision: number) => <>
      <div>{revision}</div><IndicatorNavigatorHost selectedSymbol="BTCUSD" timeframe="M1" />
    </>;
    const view = render(contents(0));
    open();
    expect(fixture.dialogRender).toHaveBeenCalledOnce();
    view.rerender(contents(1));
    expect(fixture.dialogRender).toHaveBeenCalledOnce();
  });

  it('keeps the chart selected at opening even if the active chart changes before Add', () => {
    const adds = captureAdds();
    render(<IndicatorNavigatorHost selectedSymbol="BTCUSD" timeframe="M1" />);
    open({ category: 'Trend' });
    fixture.active = { targetContextId: 'chart-b', symbol: 'GBPUSD', timeframe: 'H1' };
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]);
    expect(adds).toHaveBeenCalledExactlyOnceWith({
      id: expect.stringMatching(/^ma-\d+$/), name: 'Moving Average', indicatorType: 'ma',
      params: { period: 20, type: 'SMA' }, targetContextId: 'chart-a', symbol: 'EURUSD.r',
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('honors an explicit command target and initial category', () => {
    const adds = captureAdds();
    render(<IndicatorNavigatorHost selectedSymbol="BTCUSD" timeframe="M1" />);
    open({ category: 'Oscillators', targetContextId: 'chart-explicit', symbol: 'XAUUSD.r' });
    expect(screen.getByRole('button', { name: 'Oscillators' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]);
    expect(adds).toHaveBeenCalledWith(expect.objectContaining({
      indicatorType: 'rsi', params: { period: 14 }, targetContextId: 'chart-explicit', symbol: 'XAUUSD.r',
    }));
  });

  it('resolves the current chart on Add when no target existed at opening', () => {
    const adds = captureAdds();
    fixture.active = {};
    render(<IndicatorNavigatorHost selectedSymbol="BTCUSD" timeframe="M1" />);
    open();
    fixture.active = { targetContextId: 'chart-late', symbol: 'GBPUSD', timeframe: 'H1' };
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]);
    expect(adds).toHaveBeenCalledWith(expect.objectContaining({ targetContextId: 'chart-late', symbol: 'GBPUSD' }));
  });

  it('enables tick volume on the captured symbol without adding a duplicate indicator', () => {
    const adds = captureAdds();
    render(<IndicatorNavigatorHost selectedSymbol="BTCUSD" timeframe="M1" />);
    open({ category: 'Volume' });
    fixture.active = { targetContextId: 'chart-b', symbol: 'GBPUSD' };
    fireEvent.click(screen.getByRole('button', { name: 'Enable' }));
    expect(useChartSettingsStore.getState().symbolProperties['EURUSD.r']).toMatchObject({
      showTickVolumes: true, showRealVolumes: false,
    });
    expect(useChartSettingsStore.getState().symbolProperties.GBPUSD).toBeUndefined();
    expect(adds).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('preserves the selected-symbol and global volume fallback when no chart is registered', () => {
    fixture.active = {};
    const view = render(<IndicatorNavigatorHost selectedSymbol="BTCUSD" timeframe="M1" />);
    open({ category: 'Volume' });
    fireEvent.click(screen.getByRole('button', { name: 'Enable' }));
    expect(useChartSettingsStore.getState().symbolProperties.BTCUSD).toMatchObject({ showTickVolumes: true, showRealVolumes: false });
    view.rerender(<IndicatorNavigatorHost selectedSymbol="" timeframe="M1" />);
    open({ category: 'Volume' });
    fireEvent.click(screen.getByRole('button', { name: 'Enable' }));
    expect(useChartSettingsStore.getState().globalProperties).toMatchObject({ showTickVolumes: true, showRealVolumes: false });
  });

  it('restores focus and resets search/category on the next opening', () => {
    render(<><button>Open</button><IndicatorNavigatorHost selectedSymbol="BTCUSD" timeframe="M1" /></>);
    const opener = screen.getByRole('button', { name: 'Open' });
    opener.focus();
    open({ category: 'Trend' });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Average' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(opener).toHaveFocus();
    open({ category: 'Oscillators' });
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(screen.getByRole('textbox')).toHaveFocus();
    expect(screen.getByRole('heading', { name: 'RSI' })).toBeInTheDocument();
  });

  it('retains one command owner through StrictMode replay and removes it on unmount', () => {
    const before = commandBus.getSubscriberCount('OPEN_INDICATOR_LIST');
    const view = render(<StrictMode><IndicatorNavigatorHost selectedSymbol="BTCUSD" timeframe="M1" /></StrictMode>);
    expect(commandBus.getSubscriberCount('OPEN_INDICATOR_LIST')).toBe(before + 1);
    view.unmount();
    expect(commandBus.getSubscriberCount('OPEN_INDICATOR_LIST')).toBe(before);
  });
});
