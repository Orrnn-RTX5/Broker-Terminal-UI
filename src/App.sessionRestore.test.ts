import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Execute App's actual restore effect with a deferred account request. Parsing
// the effect avoids importing/mocking the unrelated chart and workspace graph.
const source = ts.createSourceFile(
  'App.tsx',
  readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let restoreEffect: ts.ArrowFunction | undefined;
const findRestoreEffect = (node: ts.Node): void => {
  if (ts.isCallExpression(node)
    && ts.isIdentifier(node.expression)
    && node.expression.text === 'useEffect'
    && node.arguments[0]
    && ts.isArrowFunction(node.arguments[0])
    && node.arguments[0].getText(source).includes('const restoreSession = async')) {
    restoreEffect = node.arguments[0];
  }
  ts.forEachChild(node, findRestoreEffect);
};
findRestoreEffect(source);
if (!restoreEffect) throw new Error('App session restore effect was not found');
const effectJavaScript = ts.transpileModule(
  `const runRestoreEffect = ${restoreEffect.getText(source)};`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
).outputText;

const createRestoreHarness = () => {
  let resolveAccount!: (account: { id: string }) => void;
  let rejectAccount!: (error: Error) => void;
  const accountRequest = new Promise<{ id: string }>((resolveRequest, rejectRequest) => {
    resolveAccount = resolveRequest;
    rejectAccount = rejectRequest;
  });
  let scope = { authenticated: false, accountId: null as string | null };
  let state = {
    isAuthenticated: false,
    accountId: '111111' as string | null,
    tokenExpiresAt: null,
    savedAccounts: [] as Array<{ password?: string }>,
    setAuthTokens: vi.fn(),
    setAuthenticated: vi.fn(),
  };
  const setIsAuthenticated = vi.fn();
  const setAccountId = vi.fn();
  const performSessionExpiredLogout = vi.fn();
  const getAccountSummary = vi.fn(() => accountRequest);
  const bindings = {
    sessionRestoreStartedRef: { current: false },
    // The merged restore effect bails out if a newer auth session started
    // mid-restore. A stable generation keeps that guard inert here.
    authSessionGenerationRef: { current: 0 },
    freshSessionHandoff: null,
    setIsAutoAuthenticating: vi.fn(),
    setAutoAuthError: vi.fn(),
    updateDynamicUrls: vi.fn(),
    // Module-level imports used by the merged restore success path.
    seedValidatedSessionAccountSummary: vi.fn(),
    chartDataService: { preloadStartupHistory: vi.fn() },
    useAppStore: { getState: () => state, setState: vi.fn() },
    getStoredTokenExpiryMs: () => null,
    // Module-level helper in App.tsx; the success path is the only branch that
    // reaches it, so an unbound reference was silently swallowed by the catch.
    getStoredAuthToken: () => localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token'),
    getCommittedBrokerAccountSessionScope: () => scope,
    hasTokenExpiryElapsed: () => false,
    parsePositiveInt: (value: unknown) => Number.parseInt(String(value), 10) || null,
    performSessionExpiredLogout,
    setIsAuthenticated,
    setAccountId,
    api: { account: { getAccountSummary } },
  };
  const run = new Function(...Object.keys(bindings), `${effectJavaScript}\nreturn runRestoreEffect;`)(
    ...Object.values(bindings),
  ) as () => void;
  localStorage.setItem('auth_token', 'stored-token-A');
  localStorage.setItem('rtx_last_login', '111111');
  run();
  expect(getAccountSummary).toHaveBeenCalledWith(111111);

  return {
    setAuthTokens: state.setAuthTokens,
    setAuthenticated: state.setAuthenticated,
    setIsAuthenticated,
    setAccountId,
    performSessionExpiredLogout,
    commitInteractiveLogin: (accountId: string) => {
      localStorage.setItem('auth_token', 'interactive-token-B');
      state = { ...state, isAuthenticated: true, accountId };
      scope = { authenticated: true, accountId };
    },
    logout: () => {
      localStorage.removeItem('auth_token');
      state = { ...state, isAuthenticated: false, accountId: null };
      scope = { authenticated: false, accountId: null };
    },
    complete: async (outcome: 'success' | 'failure') => {
      if (outcome === 'success') resolveAccount({ id: '111111' });
      else rejectAccount(new Error('Stored session rejected'));
      await accountRequest.catch(() => undefined);
      await Promise.resolve();
    },
  };
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('App stored-session restore ownership', () => {
  it.each(['success', 'failure'] as const)(
    'ignores stale restore %s after a newer interactive login',
    async outcome => {
      const harness = createRestoreHarness();
      harness.commitInteractiveLogin('222222');
      await harness.complete(outcome);

      expect(harness.setAuthTokens).not.toHaveBeenCalled();
      expect(harness.setAuthenticated).not.toHaveBeenCalled();
      expect(harness.setAccountId).not.toHaveBeenCalled();
      expect(harness.performSessionExpiredLogout).not.toHaveBeenCalled();
      expect(localStorage.getItem('auth_token')).toBe('interactive-token-B');
    },
  );

  it('ignores an old restore after an interactive login to the same account', async () => {
    const harness = createRestoreHarness();
    harness.commitInteractiveLogin('111111');
    await harness.complete('failure');

    expect(harness.performSessionExpiredLogout).not.toHaveBeenCalled();
    expect(localStorage.getItem('auth_token')).toBe('interactive-token-B');
  });

  it('does not resurrect a session after logout', async () => {
    const harness = createRestoreHarness();
    harness.logout();
    await harness.complete('success');

    expect(harness.setAuthenticated).not.toHaveBeenCalled();
    expect(harness.setAuthTokens).not.toHaveBeenCalled();
    expect(localStorage.getItem('auth_token')).toBeNull();
  });

  it('accepts token refresh performed within the original restore', async () => {
    const harness = createRestoreHarness();
    localStorage.setItem('auth_token', 'rotated-token-A');
    await harness.complete('success');

    expect(harness.setAuthenticated).toHaveBeenCalledWith(
      true, '111111', 'rotated-token-A', undefined, undefined,
    );
    expect(harness.setAccountId).toHaveBeenCalledWith('111111');
    expect(harness.performSessionExpiredLogout).not.toHaveBeenCalled();
  });

  it('still clears a rejected session when the restore retains ownership', async () => {
    const harness = createRestoreHarness();
    await harness.complete('failure');

    expect(harness.performSessionExpiredLogout).toHaveBeenCalledWith('restore_failed');
    expect(harness.setAuthenticated).not.toHaveBeenCalled();
  });
});
