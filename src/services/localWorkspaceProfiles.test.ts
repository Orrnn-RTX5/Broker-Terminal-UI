import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DockLayout } from './dockManager';
import {
  LOCAL_WORKSPACE_PROFILES_STORAGE_KEY,
  MARKET_WATCH_PROFILE_RESTORED_EVENT,
  WORKSPACE_PROFILE_RESTORED_EVENT,
  LocalWorkspaceProfileError,
  LocalWorkspaceProfileService,
} from './localWorkspaceProfiles';
import { useDockLayoutStore } from '../store/useDockLayoutStore';
import {
  defaultChartProperties,
  useChartSettingsStore,
} from '../store/useChartSettingsStore';
import { useWatchlistStore } from '../store/useWatchlistStore';
import { useAppStore } from '../store/useAppStore';

const createLayout = (symbol = 'EURUSD', timeframe = 'M15'): DockLayout => ({
  root: {
    id: 'root',
    type: 'split',
    direction: 'horizontal',
    ratio: 1,
    children: [
      {
        id: `chart-${symbol}`,
        title: `${symbol},${timeframe}`,
        component: 'Chart',
        props: { symbol, timeframe },
        ratio: 1,
      },
    ],
  },
  floatingPanels: [],
  version: '2.6',
});

const setRuntimeState = (symbol = 'EURUSD') => {
  useDockLayoutStore.getState().setLayout(createLayout(symbol));
  useChartSettingsStore.setState({
    globalProperties: {
      ...defaultChartProperties,
      showGrid: false,
      colors: { ...defaultChartProperties.colors },
    },
    symbolProperties: {
      [symbol]: {
        ...defaultChartProperties,
        showOHLC: true,
        colors: { ...defaultChartProperties.colors },
      },
    },
    volumeBarsDefaultMigrationVersion: 3,
    periodSeparatorsDefaultMigrationVersion: 4,
    chartShiftDefaultMigrationVersion: 5,
  });
  useWatchlistStore.setState({
    watchlists: [{
      id: 'desk',
      name: 'Desk',
      symbols: [symbol, 'GBPUSD'],
      isDefault: false,
      createdAt: 10,
      updatedAt: 20,
    }],
    activeWatchlistId: 'desk',
  });
  useAppStore.setState({ selectedSymbol: symbol, orderVolume: 0.25 });
  localStorage.setItem('rtx5_selected_symbol', symbol);
  localStorage.setItem('rtx5_timeframe', 'M15');
  localStorage.setItem('rtx5_chart_type', 'area');
  localStorage.setItem('dockHeight', '360');
  localStorage.setItem('rtx5_hidden_symbols', JSON.stringify(['USDJPY']));
  localStorage.setItem('rtx5_marketwatch_cols', JSON.stringify(['symbol', 'bid', 'ask', 'time']));
  localStorage.setItem('rtx5_marketwatch_options', JSON.stringify({
    useSystemColors: false,
    showMilliseconds: true,
    autoRemoveExpired: false,
    autoArrange: false,
    showGrid: false,
  }));
  localStorage.setItem('rtx5_symbol_sets', JSON.stringify({ Desk: [symbol, 'GBPUSD'] }));
  localStorage.setItem('rtx5_symbol_set_columns', JSON.stringify({
    Desk: ['symbol', 'bid', 'ask', 'time'],
  }));
};

describe('LocalWorkspaceProfileService', () => {
  beforeEach(() => {
    localStorage.clear();
    setRuntimeState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('saves a complete account-scoped snapshot without relying on an API', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const service = new LocalWorkspaceProfileService(
      localStorage,
      () => new Date('2026-09-02T10:00:00.000Z'),
    );

    const saved = service.saveCurrentWorkspaceProfile({
      accountId: '200001',
      profileName: 'Default',
    });

    expect(saved.accountId).toBe('200001');
    expect(saved.state.dockLayout.root.children[0]).toMatchObject({
      component: 'Chart',
      props: { symbol: 'EURUSD', timeframe: 'M15' },
    });
    expect(saved.state.chartView).toEqual({
      selectedSymbol: 'EURUSD',
      timeframe: 'M15',
      chartType: 'area',
      orderVolume: 0.25,
      dockHeight: 360,
    });
    expect(saved.state.chartSettings.globalProperties.showGrid).toBe(false);
    expect(saved.state.chartSettings.symbolProperties.EURUSD.showOHLC).toBe(true);
    expect(saved.state.marketWatch).toMatchObject({
      activeWatchlistId: 'desk',
      hiddenSymbols: ['USDJPY'],
      columns: ['symbol', 'bid', 'ask', 'time'],
      symbolSets: { Desk: ['EURUSD', 'GBPUSD'] },
      symbolSetColumns: { Desk: ['symbol', 'bid', 'ask', 'time'] },
    });
    expect(service.listWorkspaceProfiles('200001')).toHaveLength(1);
    expect(service.listWorkspaceProfiles('200002')).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('overwrites names case-insensitively while preserving the profile identity and creation time', () => {
    const times = [
      new Date('2026-09-02T10:00:00.000Z'),
      new Date('2026-09-02T11:00:00.000Z'),
    ];
    const service = new LocalWorkspaceProfileService(localStorage, () => times.shift()!);

    const first = service.saveCurrentWorkspaceProfile({ accountId: '200001', profileName: 'Default' });
    localStorage.setItem('rtx5_timeframe', 'H1');
    const updated = service.saveCurrentWorkspaceProfile({ accountId: '200001', profileName: 'default' });

    expect(service.listWorkspaceProfiles('200001')).toHaveLength(1);
    expect(updated.id).toBe(first.id);
    expect(updated.createdAt).toBe(first.createdAt);
    expect(updated.updatedAt).toBe('2026-09-02T11:00:00.000Z');
    expect(updated.state.chartView.timeframe).toBe('H1');
  });

  it('restores dock, chart, and Market Watch state and notifies live UI consumers', () => {
    const service = new LocalWorkspaceProfileService(
      localStorage,
      () => new Date('2026-09-02T10:00:00.000Z'),
    );
    service.saveCurrentWorkspaceProfile({ accountId: '200001', profileName: 'Market' });

    useDockLayoutStore.getState().setLayout(createLayout('XAUUSD', 'H4'));
    useChartSettingsStore.setState({
      globalProperties: {
        ...defaultChartProperties,
        showGrid: true,
        colors: { ...defaultChartProperties.colors },
      },
      symbolProperties: {},
    });
    useWatchlistStore.setState({ watchlists: [], activeWatchlistId: '' });
    useAppStore.setState({ selectedSymbol: 'XAUUSD', orderVolume: 1 });
    localStorage.setItem('rtx5_hidden_symbols', '[]');
    localStorage.setItem('rtx5_timeframe', 'H4');
    localStorage.setItem('rtx5_symbol_set_columns', '{}');

    const restoredEvent = vi.fn();
    const marketWatchEvent = vi.fn();
    const timeframeEvent = vi.fn();
    const chartTypeEvent = vi.fn();
    window.addEventListener(WORKSPACE_PROFILE_RESTORED_EVENT, restoredEvent);
    window.addEventListener(MARKET_WATCH_PROFILE_RESTORED_EVENT, marketWatchEvent);
    window.addEventListener('change-timeframe', timeframeEvent);
    window.addEventListener('change-chart-type', chartTypeEvent);

    const result = service.restoreWorkspaceProfile({ accountId: '200001', profileName: 'Market' });

    expect(result.status).toBe('restored');
    expect(useDockLayoutStore.getState().layout.root.children[0]).toMatchObject({
      props: { symbol: 'EURUSD', timeframe: 'M15' },
    });
    expect(useChartSettingsStore.getState().globalProperties.showGrid).toBe(false);
    expect(useChartSettingsStore.getState().symbolProperties.EURUSD.showOHLC).toBe(true);
    expect(useWatchlistStore.getState().watchlists[0]).toMatchObject({
      id: 'desk',
      symbols: ['EURUSD', 'GBPUSD'],
    });
    expect(useAppStore.getState()).toMatchObject({ selectedSymbol: 'EURUSD', orderVolume: 0.25 });
    expect(localStorage.getItem('rtx5_timeframe')).toBe('M15');
    expect(localStorage.getItem('rtx5_chart_type')).toBe('area');
    expect(JSON.parse(localStorage.getItem('rtx5_hidden_symbols')!)).toEqual(['USDJPY']);
    expect(JSON.parse(localStorage.getItem('rtx5_symbol_set_columns')!)).toEqual({
      Desk: ['symbol', 'bid', 'ask', 'time'],
    });
    expect(restoredEvent).toHaveBeenCalledTimes(1);
    expect(marketWatchEvent).toHaveBeenCalledTimes(1);
    expect(timeframeEvent).toHaveBeenCalledTimes(1);
    expect(chartTypeEvent).toHaveBeenCalledTimes(1);

    window.removeEventListener(WORKSPACE_PROFILE_RESTORED_EVENT, restoredEvent);
    window.removeEventListener(MARKET_WATCH_PROFILE_RESTORED_EVENT, marketWatchEvent);
    window.removeEventListener('change-timeframe', timeframeEvent);
    window.removeEventListener('change-chart-type', chartTypeEvent);
  });

  it('normalizes saved-set columns and loads older profiles without the additive field', () => {
    const service = new LocalWorkspaceProfileService(localStorage);
    service.saveCurrentWorkspaceProfile({ accountId: '200001', profileName: 'Portable' });

    const registry = JSON.parse(localStorage.getItem(LOCAL_WORKSPACE_PROFILES_STORAGE_KEY)!);
    registry.profiles[0].state.marketWatch.symbolSetColumns = {
      ' Desk ': ['symbol', 'time', 'unsupported', 'time'],
      Empty: ['unsupported'],
      '   ': ['bid'],
    };
    localStorage.setItem(LOCAL_WORKSPACE_PROFILES_STORAGE_KEY, JSON.stringify(registry));

    expect(service.getWorkspaceProfile({ accountId: '200001', profileName: 'Portable' })
      ?.state.marketWatch.symbolSetColumns).toEqual({
      Desk: ['symbol', 'time'],
      Empty: ['symbol', 'bid', 'ask', 'spread'],
    });

    delete registry.profiles[0].state.marketWatch.symbolSetColumns;
    delete registry.profiles[0].state.marketWatch.options.autoRemoveExpired;
    localStorage.setItem(LOCAL_WORKSPACE_PROFILES_STORAGE_KEY, JSON.stringify(registry));

    const legacyProfile = service.getWorkspaceProfile({
      accountId: '200001',
      profileName: 'Portable',
    });
    expect(legacyProfile?.state.marketWatch.symbolSetColumns).toEqual({});
    expect(legacyProfile?.state.marketWatch.options.autoRemoveExpired).toBe(false);
  });

  it('returns a safe missing result for another account or a corrupt registry', () => {
    const service = new LocalWorkspaceProfileService(localStorage);
    service.saveCurrentWorkspaceProfile({ accountId: '200001', profileName: 'Euro' });

    expect(service.restoreWorkspaceProfile({ accountId: '200002', profileName: 'Euro' })).toEqual({
      status: 'missing',
      profile: null,
    });

    localStorage.setItem(LOCAL_WORKSPACE_PROFILES_STORAGE_KEY, '{bad json');
    expect(service.listWorkspaceProfiles('200001')).toEqual([]);
    expect(service.restoreWorkspaceProfile({ accountId: '200001', profileName: 'Euro' })).toEqual({
      status: 'missing',
      profile: null,
    });
  });

  it('reports storage failures instead of claiming a successful save', () => {
    const failingStorage = {
      getItem: vi.fn(() => null),
      removeItem: vi.fn(),
      setItem: vi.fn(() => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      }),
    };
    const service = new LocalWorkspaceProfileService(failingStorage);

    expect(() => service.saveCurrentWorkspaceProfile({
      accountId: '200001',
      profileName: 'Default',
    })).toThrowError(expect.objectContaining<Partial<LocalWorkspaceProfileError>>({
      code: 'STORAGE_WRITE_FAILED',
    }));
  });

  it('validates account and workspace names before touching storage', () => {
    const service = new LocalWorkspaceProfileService(localStorage);
    expect(() => service.saveCurrentWorkspaceProfile({
      accountId: '',
      profileName: 'Default',
    })).toThrowError(expect.objectContaining({ code: 'INVALID_ACCOUNT' }));
    expect(() => service.saveCurrentWorkspaceProfile({
      accountId: '200001',
      profileName: '   ',
    })).toThrowError(expect.objectContaining({ code: 'INVALID_NAME' }));
  });
});
