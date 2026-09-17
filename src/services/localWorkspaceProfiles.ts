import type { DockContainer, DockLayout, DockPanelConfig } from './dockManager';
import { useDockLayoutStore } from '../store/useDockLayoutStore';
import {
  normalizeChartProperties,
  type ChartProperties,
  useChartSettingsStore,
} from '../store/useChartSettingsStore';
import { useAppStore } from '../store/useAppStore';
import { type Watchlist, useWatchlistStore } from '../store/useWatchlistStore';

export const LOCAL_WORKSPACE_PROFILES_STORAGE_KEY = 'rtx5-workspace-profiles-v1';
export const WORKSPACE_PROFILE_RESTORED_EVENT = 'workspace:profile-restored';
export const MARKET_WATCH_PROFILE_RESTORED_EVENT = 'workspace:marketwatch-restored';

const LOCAL_WORKSPACE_SCHEMA_VERSION = 1 as const;
const MAX_PROFILE_NAME_LENGTH = 80;
const MAX_ACCOUNT_ID_LENGTH = 160;
const MAX_PROFILES_PER_ACCOUNT = 50;
const MAX_WATCHLISTS = 100;
const MAX_SYMBOLS_PER_LIST = 1_000;

const SELECTED_SYMBOL_STORAGE_KEY = 'rtx5_selected_symbol';
const TIMEFRAME_STORAGE_KEY = 'rtx5_timeframe';
const CHART_TYPE_STORAGE_KEY = 'rtx5_chart_type';
const DOCK_HEIGHT_STORAGE_KEY = 'dockHeight';
const HIDDEN_SYMBOLS_STORAGE_KEY = 'rtx5_hidden_symbols';
const MARKET_WATCH_COLUMNS_STORAGE_KEY = 'rtx5_marketwatch_cols';
const MARKET_WATCH_OPTIONS_STORAGE_KEY = 'rtx5_marketwatch_options';
const MARKET_WATCH_SYMBOL_SETS_STORAGE_KEY = 'rtx5_symbol_sets';

const CHART_TYPES = ['candlestick', 'bar', 'line', 'area'] as const;
const TIMEFRAMES = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1', 'MN'] as const;
const MARKET_WATCH_COLUMNS = [
  'symbol',
  'bid',
  'ask',
  'spread',
  'dailyChange',
  'last',
  'high',
  'low',
  'volume',
  'time',
] as const;

export type WorkspaceChartType = typeof CHART_TYPES[number];
export type WorkspaceTimeframe = typeof TIMEFRAMES[number];
export type WorkspaceMarketWatchColumn = typeof MARKET_WATCH_COLUMNS[number];

export interface WorkspaceChartViewSnapshot {
  selectedSymbol: string;
  timeframe: WorkspaceTimeframe;
  chartType: WorkspaceChartType;
  orderVolume: number;
  dockHeight: number | null;
}

export interface WorkspaceChartSettingsSnapshot {
  globalProperties: ChartProperties;
  symbolProperties: Record<string, ChartProperties>;
  volumeBarsDefaultMigrationVersion: number;
  periodSeparatorsDefaultMigrationVersion: number;
  chartShiftDefaultMigrationVersion: number;
}

export interface WorkspaceMarketWatchOptions {
  useSystemColors: boolean;
  showMilliseconds: boolean;
  autoRemoveExpired: boolean;
  autoArrange: boolean;
  showGrid: boolean;
}

export interface WorkspaceMarketWatchSnapshot {
  watchlists: Watchlist[];
  activeWatchlistId: string;
  hiddenSymbols: string[];
  columns: WorkspaceMarketWatchColumn[];
  options: WorkspaceMarketWatchOptions;
  symbolSets: Record<string, string[]>;
}

export interface LocalWorkspaceProfileState {
  dockLayout: DockLayout;
  chartView: WorkspaceChartViewSnapshot;
  chartSettings: WorkspaceChartSettingsSnapshot;
  marketWatch: WorkspaceMarketWatchSnapshot;
}

export interface LocalWorkspaceProfile {
  schemaVersion: typeof LOCAL_WORKSPACE_SCHEMA_VERSION;
  id: string;
  accountId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  state: LocalWorkspaceProfileState;
}

export interface WorkspaceProfileSummary {
  id: string;
  accountId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface SaveCurrentWorkspaceProfileOptions {
  accountId: string;
  profileName: string;
  view?: Partial<WorkspaceChartViewSnapshot>;
}

export interface WorkspaceProfileLookup {
  accountId: string;
  profileName: string;
}

export type RestoreWorkspaceProfileResult =
  | { status: 'restored'; profile: LocalWorkspaceProfile }
  | { status: 'missing'; profile: null };

interface LocalWorkspaceProfileRegistry {
  schemaVersion: typeof LOCAL_WORKSPACE_SCHEMA_VERSION;
  profiles: LocalWorkspaceProfile[];
}

type WorkspaceProfileStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export class LocalWorkspaceProfileError extends Error {
  readonly code: 'INVALID_ACCOUNT' | 'INVALID_NAME' | 'STORAGE_UNAVAILABLE' | 'STORAGE_WRITE_FAILED';

  constructor(
    code: LocalWorkspaceProfileError['code'],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'LocalWorkspaceProfileError';
    this.code = code;
  }
}

const emptyRegistry = (): LocalWorkspaceProfileRegistry => ({
  schemaVersion: LOCAL_WORKSPACE_SCHEMA_VERSION,
  profiles: [],
});

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const normalizeAccountId = (value: unknown): string => {
  const accountId = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
  if (!accountId || accountId.length > MAX_ACCOUNT_ID_LENGTH) {
    throw new LocalWorkspaceProfileError(
      'INVALID_ACCOUNT',
      `Account ID must contain between 1 and ${MAX_ACCOUNT_ID_LENGTH} characters.`,
    );
  }
  return accountId;
};

const normalizeProfileName = (value: unknown): string => {
  const profileName = typeof value === 'string' ? value.trim() : '';
  if (!profileName || profileName.length > MAX_PROFILE_NAME_LENGTH) {
    throw new LocalWorkspaceProfileError(
      'INVALID_NAME',
      `Workspace name must contain between 1 and ${MAX_PROFILE_NAME_LENGTH} characters.`,
    );
  }
  return profileName;
};

const normalizeSymbol = (value: unknown): string => {
  const symbol = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return symbol.length <= 32 && /^[A-Z0-9._-]*$/.test(symbol) ? symbol : '';
};

const normalizeSymbolList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(normalizeSymbol).filter(Boolean))).slice(0, MAX_SYMBOLS_PER_LIST);
};

const normalizeTimeframe = (value: unknown): WorkspaceTimeframe => (
  TIMEFRAMES.includes(value as WorkspaceTimeframe) ? value as WorkspaceTimeframe : 'M5'
);

const normalizeChartType = (value: unknown): WorkspaceChartType => (
  CHART_TYPES.includes(value as WorkspaceChartType) ? value as WorkspaceChartType : 'candlestick'
);

const normalizePositiveNumber = (value: unknown, fallback: number): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
};

const normalizeOptionalDockHeight = (value: unknown): number | null => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 80 && numeric <= 2_000 ? numeric : null;
};

const normalizeTimestamp = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string') return fallback;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : fallback;
};

const normalizeWatchlists = (value: unknown): Watchlist[] => {
  if (!Array.isArray(value)) return [];

  return value.slice(0, MAX_WATCHLISTS).flatMap((candidate, index) => {
    if (!isRecord(candidate)) return [];
    const id = typeof candidate.id === 'string' ? candidate.id.trim().slice(0, 100) : '';
    const name = typeof candidate.name === 'string' ? candidate.name.trim().slice(0, 100) : '';
    if (!id || !name) return [];

    const createdAt = normalizePositiveNumber(candidate.createdAt, Date.now() + index);
    const updatedAt = normalizePositiveNumber(candidate.updatedAt, createdAt);
    return [{
      id,
      name,
      symbols: normalizeSymbolList(candidate.symbols),
      isDefault: candidate.isDefault === true,
      createdAt,
      updatedAt,
    }];
  });
};

const DEFAULT_MARKET_WATCH_OPTIONS: WorkspaceMarketWatchOptions = {
  useSystemColors: true,
  showMilliseconds: false,
  autoRemoveExpired: true,
  autoArrange: true,
  showGrid: true,
};

const normalizeMarketWatchOptions = (value: unknown): WorkspaceMarketWatchOptions => {
  const record = isRecord(value) ? value : {};
  return {
    useSystemColors: typeof record.useSystemColors === 'boolean'
      ? record.useSystemColors
      : DEFAULT_MARKET_WATCH_OPTIONS.useSystemColors,
    showMilliseconds: typeof record.showMilliseconds === 'boolean'
      ? record.showMilliseconds
      : DEFAULT_MARKET_WATCH_OPTIONS.showMilliseconds,
    autoRemoveExpired: typeof record.autoRemoveExpired === 'boolean'
      ? record.autoRemoveExpired
      : DEFAULT_MARKET_WATCH_OPTIONS.autoRemoveExpired,
    autoArrange: typeof record.autoArrange === 'boolean'
      ? record.autoArrange
      : DEFAULT_MARKET_WATCH_OPTIONS.autoArrange,
    showGrid: typeof record.showGrid === 'boolean'
      ? record.showGrid
      : DEFAULT_MARKET_WATCH_OPTIONS.showGrid,
  };
};

const normalizeColumns = (value: unknown): WorkspaceMarketWatchColumn[] => {
  if (!Array.isArray(value)) return ['symbol', 'bid', 'ask', 'spread'];
  const columns = Array.from(new Set(
    value.filter((column): column is WorkspaceMarketWatchColumn => (
      MARKET_WATCH_COLUMNS.includes(column as WorkspaceMarketWatchColumn)
    )),
  ));
  return columns.length > 0 ? columns : ['symbol', 'bid', 'ask', 'spread'];
};

const normalizeSymbolSets = (value: unknown): Record<string, string[]> => {
  if (!isRecord(value)) return {};
  const entries = Object.entries(value).slice(0, 100).flatMap(([name, symbols]) => {
    const normalizedName = name.trim().slice(0, 100);
    return normalizedName ? [[normalizedName, normalizeSymbolList(symbols)] as const] : [];
  });
  return Object.fromEntries(entries);
};

const normalizeChartSettings = (value: unknown): WorkspaceChartSettingsSnapshot | null => {
  if (!isRecord(value)) return null;
  const globalProperties = normalizeChartProperties(
    isRecord(value.globalProperties) ? value.globalProperties : undefined,
  );
  const rawSymbolProperties = isRecord(value.symbolProperties) ? value.symbolProperties : {};
  const symbolProperties = Object.fromEntries(
    Object.entries(rawSymbolProperties).flatMap(([symbol, properties]) => {
      const normalizedSymbol = normalizeSymbol(symbol);
      if (!normalizedSymbol || !isRecord(properties)) return [];
      return [[normalizedSymbol, normalizeChartProperties(properties)] as const];
    }),
  );

  return {
    globalProperties,
    symbolProperties,
    volumeBarsDefaultMigrationVersion: Math.max(0, Number(value.volumeBarsDefaultMigrationVersion) || 0),
    periodSeparatorsDefaultMigrationVersion: Math.max(0, Number(value.periodSeparatorsDefaultMigrationVersion) || 0),
    chartShiftDefaultMigrationVersion: Math.max(0, Number(value.chartShiftDefaultMigrationVersion) || 0),
  };
};

const isValidPanel = (value: unknown): value is DockPanelConfig => {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string'
    && value.id.length > 0
    && typeof value.component === 'string'
    && value.component.length > 0
    && (value.ratio === undefined || (Number.isFinite(value.ratio) && Number(value.ratio) >= 0))
  );
};

const isValidContainer = (value: unknown, depth = 0): value is DockContainer => {
  if (depth > 30 || !isRecord(value) || !Array.isArray(value.children)) return false;
  if (
    typeof value.id !== 'string'
    || !['root', 'split', 'tabs', 'panel'].includes(String(value.type))
    || !Number.isFinite(value.ratio)
    || Number(value.ratio) < 0
  ) return false;

  return value.children.every((child) => (
    isRecord(child) && Array.isArray(child.children)
      ? isValidContainer(child, depth + 1)
      : isValidPanel(child)
  ));
};

const normalizeDockLayout = (value: unknown): DockLayout | null => {
  if (!isRecord(value) || !isValidContainer(value.root) || !Array.isArray(value.floatingPanels)) {
    return null;
  }
  if (!value.floatingPanels.every((panel) => isValidContainer(panel))) return null;
  if (typeof value.version !== 'string' || !value.version) return null;
  return cloneJson(value as unknown as DockLayout);
};

const readJson = (storage: WorkspaceProfileStorage, key: string): unknown => {
  const raw = storage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const normalizeStoredProfile = (value: unknown): LocalWorkspaceProfile | null => {
  if (!isRecord(value) || value.schemaVersion !== LOCAL_WORKSPACE_SCHEMA_VERSION) return null;

  let accountId: string;
  let name: string;
  try {
    accountId = normalizeAccountId(value.accountId);
    name = normalizeProfileName(value.name);
  } catch {
    return null;
  }

  if (!isRecord(value.state)) return null;
  const dockLayout = normalizeDockLayout(value.state.dockLayout);
  const chartSettings = normalizeChartSettings(value.state.chartSettings);
  if (!dockLayout || !chartSettings) return null;

  const rawChartView = isRecord(value.state.chartView) ? value.state.chartView : {};
  const rawMarketWatch = isRecord(value.state.marketWatch) ? value.state.marketWatch : {};
  const watchlists = normalizeWatchlists(rawMarketWatch.watchlists);
  const requestedActiveWatchlist = typeof rawMarketWatch.activeWatchlistId === 'string'
    ? rawMarketWatch.activeWatchlistId
    : '';
  const activeWatchlistId = watchlists.some((watchlist) => watchlist.id === requestedActiveWatchlist)
    ? requestedActiveWatchlist
    : (watchlists[0]?.id ?? '');
  const now = new Date().toISOString();

  return {
    schemaVersion: LOCAL_WORKSPACE_SCHEMA_VERSION,
    id: typeof value.id === 'string' && value.id ? value.id : `${accountId}:${name.toLocaleLowerCase()}`,
    accountId,
    name,
    createdAt: normalizeTimestamp(value.createdAt, now),
    updatedAt: normalizeTimestamp(value.updatedAt, now),
    state: {
      dockLayout,
      chartView: {
        selectedSymbol: normalizeSymbol(rawChartView.selectedSymbol),
        timeframe: normalizeTimeframe(rawChartView.timeframe),
        chartType: normalizeChartType(rawChartView.chartType),
        orderVolume: normalizePositiveNumber(rawChartView.orderVolume, 0.01),
        dockHeight: normalizeOptionalDockHeight(rawChartView.dockHeight),
      },
      chartSettings,
      marketWatch: {
        watchlists,
        activeWatchlistId,
        hiddenSymbols: normalizeSymbolList(rawMarketWatch.hiddenSymbols),
        columns: normalizeColumns(rawMarketWatch.columns),
        options: normalizeMarketWatchOptions(rawMarketWatch.options),
        symbolSets: normalizeSymbolSets(rawMarketWatch.symbolSets),
      },
    },
  };
};

const profileMatches = (
  profile: Pick<LocalWorkspaceProfile, 'accountId' | 'name'>,
  accountId: string,
  profileName: string,
): boolean => (
  profile.accountId === accountId
  && profile.name.toLocaleLowerCase() === profileName.toLocaleLowerCase()
);

export class LocalWorkspaceProfileService {
  constructor(
    private readonly storageOverride?: WorkspaceProfileStorage,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private getStorage(): WorkspaceProfileStorage {
    const storage = this.storageOverride
      ?? (typeof globalThis !== 'undefined' ? globalThis.localStorage : undefined);
    if (!storage) {
      throw new LocalWorkspaceProfileError(
        'STORAGE_UNAVAILABLE',
        'Workspace profiles are unavailable because local storage is not accessible.',
      );
    }
    return storage;
  }

  private readRegistry(): LocalWorkspaceProfileRegistry {
    const rawRegistry = readJson(this.getStorage(), LOCAL_WORKSPACE_PROFILES_STORAGE_KEY);
    if (!isRecord(rawRegistry) || rawRegistry.schemaVersion !== LOCAL_WORKSPACE_SCHEMA_VERSION) {
      return emptyRegistry();
    }

    const profiles = Array.isArray(rawRegistry.profiles)
      ? rawRegistry.profiles.map(normalizeStoredProfile).filter((profile): profile is LocalWorkspaceProfile => Boolean(profile))
      : [];
    return { schemaVersion: LOCAL_WORKSPACE_SCHEMA_VERSION, profiles };
  }

  private writeRegistry(registry: LocalWorkspaceProfileRegistry): void {
    try {
      this.getStorage().setItem(LOCAL_WORKSPACE_PROFILES_STORAGE_KEY, JSON.stringify(registry));
    } catch (error) {
      throw new LocalWorkspaceProfileError(
        'STORAGE_WRITE_FAILED',
        'The workspace could not be saved to this device.',
        { cause: error },
      );
    }
  }

  captureCurrentWorkspaceProfile(options: SaveCurrentWorkspaceProfileOptions): LocalWorkspaceProfile {
    const accountId = normalizeAccountId(options.accountId);
    const name = normalizeProfileName(options.profileName);
    const storage = this.getStorage();
    const appState = useAppStore.getState();
    const chartSettings = useChartSettingsStore.getState();
    const watchlistState = useWatchlistStore.getState();
    const currentDate = this.now();
    const timestamp = currentDate.toISOString();

    const selectedSymbol = options.view?.selectedSymbol
      ?? storage.getItem(SELECTED_SYMBOL_STORAGE_KEY)
      ?? appState.selectedSymbol;
    const timeframe = options.view?.timeframe ?? storage.getItem(TIMEFRAME_STORAGE_KEY);
    const chartType = options.view?.chartType ?? storage.getItem(CHART_TYPE_STORAGE_KEY);
    const dockHeight = options.view?.dockHeight ?? storage.getItem(DOCK_HEIGHT_STORAGE_KEY);

    return {
      schemaVersion: LOCAL_WORKSPACE_SCHEMA_VERSION,
      id: `local-ws-${currentDate.getTime()}-${Math.random().toString(36).slice(2, 9)}`,
      accountId,
      name,
      createdAt: timestamp,
      updatedAt: timestamp,
      state: {
        dockLayout: cloneJson(useDockLayoutStore.getState().layout),
        chartView: {
          selectedSymbol: normalizeSymbol(selectedSymbol),
          timeframe: normalizeTimeframe(timeframe),
          chartType: normalizeChartType(chartType),
          orderVolume: normalizePositiveNumber(options.view?.orderVolume ?? appState.orderVolume, 0.01),
          dockHeight: normalizeOptionalDockHeight(dockHeight),
        },
        chartSettings: {
          globalProperties: cloneJson(chartSettings.globalProperties),
          symbolProperties: cloneJson(chartSettings.symbolProperties),
          volumeBarsDefaultMigrationVersion: chartSettings.volumeBarsDefaultMigrationVersion,
          periodSeparatorsDefaultMigrationVersion: chartSettings.periodSeparatorsDefaultMigrationVersion,
          chartShiftDefaultMigrationVersion: chartSettings.chartShiftDefaultMigrationVersion,
        },
        marketWatch: {
          watchlists: cloneJson(watchlistState.watchlists),
          activeWatchlistId: watchlistState.activeWatchlistId,
          hiddenSymbols: normalizeSymbolList(readJson(storage, HIDDEN_SYMBOLS_STORAGE_KEY)),
          columns: normalizeColumns(readJson(storage, MARKET_WATCH_COLUMNS_STORAGE_KEY)),
          options: normalizeMarketWatchOptions(readJson(storage, MARKET_WATCH_OPTIONS_STORAGE_KEY)),
          symbolSets: normalizeSymbolSets(readJson(storage, MARKET_WATCH_SYMBOL_SETS_STORAGE_KEY)),
        },
      },
    };
  }

  saveCurrentWorkspaceProfile(options: SaveCurrentWorkspaceProfileOptions): LocalWorkspaceProfile {
    const captured = this.captureCurrentWorkspaceProfile(options);
    const registry = this.readRegistry();
    const existingIndex = registry.profiles.findIndex((profile) => (
      profileMatches(profile, captured.accountId, captured.name)
    ));

    if (existingIndex >= 0) {
      const existing = registry.profiles[existingIndex];
      captured.id = existing.id;
      captured.createdAt = existing.createdAt;
      registry.profiles[existingIndex] = captured;
    } else {
      const accountProfileCount = registry.profiles.filter(
        (profile) => profile.accountId === captured.accountId,
      ).length;
      if (accountProfileCount >= MAX_PROFILES_PER_ACCOUNT) {
        throw new LocalWorkspaceProfileError(
          'STORAGE_WRITE_FAILED',
          `A maximum of ${MAX_PROFILES_PER_ACCOUNT} workspace profiles can be saved per account.`,
        );
      }
      registry.profiles.push(captured);
    }

    this.writeRegistry(registry);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('workspace:profile-saved', { detail: cloneJson(captured) }));
    }
    return cloneJson(captured);
  }

  getWorkspaceProfile(lookup: WorkspaceProfileLookup): LocalWorkspaceProfile | null {
    const accountId = normalizeAccountId(lookup.accountId);
    const profileName = normalizeProfileName(lookup.profileName);
    const profile = this.readRegistry().profiles.find((candidate) => (
      profileMatches(candidate, accountId, profileName)
    ));
    return profile ? cloneJson(profile) : null;
  }

  listWorkspaceProfiles(accountIdValue: string): WorkspaceProfileSummary[] {
    const accountId = normalizeAccountId(accountIdValue);
    return this.readRegistry().profiles
      .filter((profile) => profile.accountId === accountId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map(({ id, name, createdAt, updatedAt }) => ({
        id,
        accountId,
        name,
        createdAt,
        updatedAt,
      }));
  }

  restoreWorkspaceProfile(lookup: WorkspaceProfileLookup): RestoreWorkspaceProfileResult {
    const profile = this.getWorkspaceProfile(lookup);
    if (!profile) return { status: 'missing', profile: null };

    const normalized = normalizeStoredProfile(profile);
    if (!normalized) return { status: 'missing', profile: null };
    const storage = this.getStorage();

    useDockLayoutStore.getState().setLayout(cloneJson(normalized.state.dockLayout));
    useChartSettingsStore.setState({
      globalProperties: cloneJson(normalized.state.chartSettings.globalProperties),
      symbolProperties: cloneJson(normalized.state.chartSettings.symbolProperties),
      volumeBarsDefaultMigrationVersion: normalized.state.chartSettings.volumeBarsDefaultMigrationVersion,
      periodSeparatorsDefaultMigrationVersion: normalized.state.chartSettings.periodSeparatorsDefaultMigrationVersion,
      chartShiftDefaultMigrationVersion: normalized.state.chartSettings.chartShiftDefaultMigrationVersion,
    });
    useWatchlistStore.setState({
      watchlists: cloneJson(normalized.state.marketWatch.watchlists),
      activeWatchlistId: normalized.state.marketWatch.activeWatchlistId,
    });

    const { chartView, marketWatch } = normalized.state;
    if (chartView.selectedSymbol) {
      storage.setItem(SELECTED_SYMBOL_STORAGE_KEY, chartView.selectedSymbol);
      useAppStore.getState().setSelectedSymbol(chartView.selectedSymbol);
    } else {
      storage.removeItem(SELECTED_SYMBOL_STORAGE_KEY);
    }
    storage.setItem(TIMEFRAME_STORAGE_KEY, chartView.timeframe);
    storage.setItem(CHART_TYPE_STORAGE_KEY, chartView.chartType);
    if (chartView.dockHeight !== null) {
      storage.setItem(DOCK_HEIGHT_STORAGE_KEY, String(chartView.dockHeight));
    }
    useAppStore.getState().setOrderVolume(chartView.orderVolume);

    storage.setItem(HIDDEN_SYMBOLS_STORAGE_KEY, JSON.stringify(marketWatch.hiddenSymbols));
    storage.setItem(MARKET_WATCH_COLUMNS_STORAGE_KEY, JSON.stringify(marketWatch.columns));
    storage.setItem(MARKET_WATCH_OPTIONS_STORAGE_KEY, JSON.stringify(marketWatch.options));
    storage.setItem(MARKET_WATCH_SYMBOL_SETS_STORAGE_KEY, JSON.stringify(marketWatch.symbolSets));

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('change-timeframe', {
        detail: { timeframe: chartView.timeframe },
      }));
      window.dispatchEvent(new CustomEvent('change-chart-type', {
        detail: { chartType: chartView.chartType },
      }));
      if (chartView.selectedSymbol) {
        window.dispatchEvent(new CustomEvent('chartSymbolChanged', {
          detail: { symbol: chartView.selectedSymbol, timeframe: chartView.timeframe },
        }));
      }
      window.dispatchEvent(new CustomEvent(MARKET_WATCH_PROFILE_RESTORED_EVENT, {
        detail: cloneJson(marketWatch),
      }));
      window.dispatchEvent(new CustomEvent(WORKSPACE_PROFILE_RESTORED_EVENT, {
        detail: cloneJson(normalized),
      }));
    }

    return { status: 'restored', profile: cloneJson(normalized) };
  }

  deleteWorkspaceProfile(lookup: WorkspaceProfileLookup): boolean {
    const accountId = normalizeAccountId(lookup.accountId);
    const profileName = normalizeProfileName(lookup.profileName);
    const registry = this.readRegistry();
    const nextProfiles = registry.profiles.filter((profile) => (
      !profileMatches(profile, accountId, profileName)
    ));
    if (nextProfiles.length === registry.profiles.length) return false;
    this.writeRegistry({ ...registry, profiles: nextProfiles });
    return true;
  }
}

export const localWorkspaceProfiles = new LocalWorkspaceProfileService();

export const captureCurrentWorkspaceProfile = (
  options: SaveCurrentWorkspaceProfileOptions,
): LocalWorkspaceProfile => localWorkspaceProfiles.captureCurrentWorkspaceProfile(options);

export const saveCurrentWorkspaceProfile = (
  options: SaveCurrentWorkspaceProfileOptions,
): LocalWorkspaceProfile => localWorkspaceProfiles.saveCurrentWorkspaceProfile(options);

export const getWorkspaceProfile = (
  lookup: WorkspaceProfileLookup,
): LocalWorkspaceProfile | null => localWorkspaceProfiles.getWorkspaceProfile(lookup);

export const listWorkspaceProfiles = (
  accountId: string,
): WorkspaceProfileSummary[] => localWorkspaceProfiles.listWorkspaceProfiles(accountId);

export const restoreWorkspaceProfile = (
  lookup: WorkspaceProfileLookup,
): RestoreWorkspaceProfileResult => localWorkspaceProfiles.restoreWorkspaceProfile(lookup);

export const deleteWorkspaceProfile = (
  lookup: WorkspaceProfileLookup,
): boolean => localWorkspaceProfiles.deleteWorkspaceProfile(lookup);

export const BUILTIN_WORKSPACE_PROFILE_NAMES = ['Default', 'Euro', 'Market Overview'] as const;

export const createBuiltinWorkspaceProfile = (
  accountIdValue: string,
  profileNameValue: string,
): LocalWorkspaceProfile => {
  const accountId = normalizeAccountId(accountIdValue);
  const profileName = normalizeProfileName(profileNameValue);
  const now = new Date().toISOString();

  let dockLayout: DockLayout;
  let primarySymbol = 'EURUSD';
  let primaryTimeframe: WorkspaceTimeframe = 'M15';

  const lowerName = profileName.toLowerCase();
  if (lowerName === 'euro') {
    primarySymbol = 'EURUSD';
    primaryTimeframe = 'M15';
    dockLayout = {
      root: {
        id: 'root',
        type: 'split',
        direction: 'vertical',
        ratio: 1,
        children: [
          {
            id: 'row-1',
            type: 'split',
            direction: 'horizontal',
            ratio: 0.5,
            children: [
              { id: 'chart-eurusd', title: 'EURUSD, M15', component: 'Chart', props: { symbol: 'EURUSD', timeframe: 'M15' }, ratio: 0.5 },
              { id: 'chart-eurgbp', title: 'EURGBP, M15', component: 'Chart', props: { symbol: 'EURGBP', timeframe: 'M15' }, ratio: 0.5 },
            ],
          },
          {
            id: 'row-2',
            type: 'split',
            direction: 'horizontal',
            ratio: 0.5,
            children: [
              { id: 'chart-eurjpy', title: 'EURJPY, M15', component: 'Chart', props: { symbol: 'EURJPY', timeframe: 'M15' }, ratio: 0.5 },
              { id: 'chart-eurchf', title: 'EURCHF, M15', component: 'Chart', props: { symbol: 'EURCHF', timeframe: 'M15' }, ratio: 0.5 },
            ],
          },
        ],
      },
      floatingPanels: [],
      version: '2.6',
    };
  } else if (lowerName === 'market overview' || lowerName === 'market') {
    primarySymbol = 'EURUSD';
    primaryTimeframe = 'H1';
    dockLayout = {
      root: {
        id: 'root',
        type: 'split',
        direction: 'vertical',
        ratio: 1,
        children: [
          {
            id: 'row-1',
            type: 'split',
            direction: 'horizontal',
            ratio: 0.5,
            children: [
              { id: 'chart-eurusd', title: 'EURUSD, H1', component: 'Chart', props: { symbol: 'EURUSD', timeframe: 'H1' }, ratio: 0.5 },
              { id: 'chart-gbpusd', title: 'GBPUSD, H1', component: 'Chart', props: { symbol: 'GBPUSD', timeframe: 'H1' }, ratio: 0.5 },
            ],
          },
          {
            id: 'row-2',
            type: 'split',
            direction: 'horizontal',
            ratio: 0.5,
            children: [
              { id: 'chart-usdjpy', title: 'USDJPY, H1', component: 'Chart', props: { symbol: 'USDJPY', timeframe: 'H1' }, ratio: 0.5 },
              { id: 'chart-xauusd', title: 'XAUUSD, H1', component: 'Chart', props: { symbol: 'XAUUSD', timeframe: 'H1' }, ratio: 0.5 },
            ],
          },
        ],
      },
      floatingPanels: [],
      version: '2.6',
    };
  } else {
    // Default profile
    const currentSymbol = useAppStore.getState().selectedSymbol || 'EURUSD';
    primarySymbol = currentSymbol;
    primaryTimeframe = 'M15';
    dockLayout = cloneJson(useDockLayoutStore.getState().layout);
  }

  const chartSettings = useChartSettingsStore.getState();
  const watchlistState = useWatchlistStore.getState();

  return {
    schemaVersion: LOCAL_WORKSPACE_SCHEMA_VERSION,
    id: `local-builtin-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    accountId,
    name: profileName,
    createdAt: now,
    updatedAt: now,
    state: {
      dockLayout,
      chartView: {
        selectedSymbol: primarySymbol,
        timeframe: primaryTimeframe,
        chartType: 'candlestick',
        orderVolume: 0.01,
        dockHeight: null,
      },
      chartSettings: {
        globalProperties: cloneJson(chartSettings.globalProperties),
        symbolProperties: cloneJson(chartSettings.symbolProperties),
        volumeBarsDefaultMigrationVersion: chartSettings.volumeBarsDefaultMigrationVersion,
        periodSeparatorsDefaultMigrationVersion: chartSettings.periodSeparatorsDefaultMigrationVersion,
        chartShiftDefaultMigrationVersion: chartSettings.chartShiftDefaultMigrationVersion,
      },
      marketWatch: {
        watchlists: cloneJson(watchlistState.watchlists),
        activeWatchlistId: watchlistState.activeWatchlistId,
        hiddenSymbols: [],
        columns: ['symbol', 'bid', 'ask', 'dailyChange'],
        options: {
          useSystemColors: false,
          showMilliseconds: false,
          autoRemoveExpired: false,
          autoArrange: true,
          showGrid: true,
        },
        symbolSets: {},
      },
    },
  };
};

export const restoreBuiltinWorkspaceProfile = (
  accountOrName: string,
  maybeProfileName?: string,
): RestoreWorkspaceProfileResult => {
  const effectiveAccountId = maybeProfileName ? (accountOrName || 'default') : 'default';
  const effectiveProfileName = maybeProfileName || accountOrName;

  const existing = localWorkspaceProfiles.getWorkspaceProfile({
    accountId: effectiveAccountId,
    profileName: effectiveProfileName,
  });
  if (existing) {
    return localWorkspaceProfiles.restoreWorkspaceProfile({
      accountId: effectiveAccountId,
      profileName: effectiveProfileName,
    });
  }

  const builtin = createBuiltinWorkspaceProfile(effectiveAccountId, effectiveProfileName);
  const registry = (localWorkspaceProfiles as any).readRegistry();
  registry.profiles.push(builtin);
  (localWorkspaceProfiles as any).writeRegistry(registry);

  return localWorkspaceProfiles.restoreWorkspaceProfile({
    accountId: effectiveAccountId,
    profileName: effectiveProfileName,
  });
};

