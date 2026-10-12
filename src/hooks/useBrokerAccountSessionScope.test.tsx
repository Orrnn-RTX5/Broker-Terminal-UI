import React from 'react';
import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  commitBrokerAccountSessionScope,
  emitSessionChange,
} from '../services/brokerSession';
import { useAppStore } from '../store/useAppStore';
import { useBrokerAccountSessionScope } from './useBrokerAccountSessionScope';
import { useSelectedHistoryRequestOwner } from './useSelectedHistoryRequestOwner';

type RuntimeWindow = Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> };

const CommittedScopeHistoryHarness = ({
  onAbort,
  onClear,
  onLoad,
  onScope,
}: {
  onAbort: () => void;
  onClear: () => void;
  onLoad: () => void;
  onScope?: (scope: string) => void;
}) => {
  const scopeRevision = useBrokerAccountSessionScope();
  onScope?.(scopeRevision);
  useSelectedHistoryRequestOwner({
    symbol: 'XAUUSD',
    timeframe: 'M5',
    scopeRevision,
    abort: onAbort,
    load: () => {
      onClear();
      onLoad();
    },
  });
  return null;
};

const flushHistoryOwner = () => act(async () => {
  await Promise.resolve();
});

describe('committed broker/account chart scope', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    (window as RuntimeWindow).__RTX_RUNTIME_CONFIG__ = { backendTarget: 'desktop' };
    localStorage.setItem('broker_id', 'broker-a');
    localStorage.setItem('server_url', 'https://broker-a.example');
    useAppStore.setState({ isAuthenticated: true, accountId: '100', authToken: 'token-a' });
    commitBrokerAccountSessionScope({ authenticated: true, accountId: '100' });
  });

  it('observes a session committed between rendering and subscribing', () => {
    const CommitDuringMount = () => {
      const scope = useBrokerAccountSessionScope();
      React.useLayoutEffect(() => {
        commitBrokerAccountSessionScope({
          authenticated: true,
          accountId: '200',
          brokerId: 'broker-b',
          serverUrl: 'https://broker-b.example',
        });
      }, []);
      return <output data-testid="committed-scope">{scope}</output>;
    };

    const { getByTestId } = render(<CommitDuringMount />);

    expect(getByTestId('committed-scope')).toHaveTextContent(
      'authenticated|200|broker-b|https://broker-b.example',
    );
  });

  it('starts anonymous when legacy storage claims an unvalidated authenticated account', async () => {
    commitBrokerAccountSessionScope({
      authenticated: false,
      accountId: null,
      brokerId: '',
      serverUrl: '',
    });
    localStorage.setItem('rtx_committed_broker_account_scope_v1', JSON.stringify({
      authenticated: true,
      accountId: '999',
      brokerId: 'stale-broker',
      serverUrl: 'https://stale.example',
    }));
    useAppStore.setState({ isAuthenticated: false, accountId: null, authToken: null });

    const onAbort = vi.fn();
    const onClear = vi.fn();
    const onLoad = vi.fn();
    const onScope = vi.fn();
    render(React.createElement(CommittedScopeHistoryHarness, {
      onAbort,
      onClear,
      onLoad,
      onScope,
    }));
    await flushHistoryOwner();

    expect(onScope).toHaveBeenLastCalledWith('anonymous|||');
    expect(localStorage.getItem('rtx_committed_broker_account_scope_v1')).toBeNull();
    onAbort.mockClear();
    onClear.mockClear();
    onLoad.mockClear();

    act(() => {
      useAppStore.getState().setAuthenticated(true, '401', 'validated-token');
      useAppStore.getState().setActiveAccount(401);
    });
    await flushHistoryOwner();
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onLoad).toHaveBeenCalledTimes(1);
  });

  it('reloads exactly once per committed logical transition', async () => {
    const onAbort = vi.fn();
    const onClear = vi.fn();
    const onLoad = vi.fn();
    render(React.createElement(CommittedScopeHistoryHarness, { onAbort, onClear, onLoad }));
    await flushHistoryOwner();
    onAbort.mockClear();
    onClear.mockClear();
    onLoad.mockClear();

    act(() => {
      localStorage.setItem('broker_id', 'broker-b');
      localStorage.setItem('server_url', 'https://broker-b.example');
      emitSessionChange('broker_url_change');
      emitSessionChange('login');
    });
    await flushHistoryOwner();
    expect(onAbort).not.toHaveBeenCalled();
    expect(onClear).not.toHaveBeenCalled();
    expect(onLoad).not.toHaveBeenCalled();

    act(() => {
      useAppStore.getState().setAuthenticated(true, '200', 'token-b');
      useAppStore.getState().setActiveAccount(200);
    });
    await flushHistoryOwner();
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onLoad).toHaveBeenCalledTimes(1);

    onAbort.mockClear();
    onClear.mockClear();
    onLoad.mockClear();
    act(() => {
      emitSessionChange('token_rotation');
      useAppStore.getState().setAuthTokens('rotated-token');
    });
    await flushHistoryOwner();
    expect(onAbort).not.toHaveBeenCalled();
    expect(onClear).not.toHaveBeenCalled();
    expect(onLoad).not.toHaveBeenCalled();

    act(() => useAppStore.getState().logout());
    await flushHistoryOwner();
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onLoad).toHaveBeenCalledTimes(1);

    onAbort.mockClear();
    onClear.mockClear();
    onLoad.mockClear();
    act(() => {
      useAppStore.getState().setAuthenticated(true, '300', 'token-c');
      useAppStore.getState().setActiveAccount(300);
    });
    await flushHistoryOwner();
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onLoad).toHaveBeenCalledTimes(1);

    onAbort.mockClear();
    onClear.mockClear();
    onLoad.mockClear();
    act(() => {
      localStorage.setItem('broker_id', 'broker-c');
      localStorage.setItem('server_url', 'https://broker-c.example');
      emitSessionChange('broker_url_change');
      emitSessionChange('login');
    });
    await flushHistoryOwner();
    expect(onLoad).not.toHaveBeenCalled();
    act(() => {
      useAppStore.getState().setAuthenticated(true, '300', 'token-d');
      useAppStore.getState().setActiveAccount(300);
    });
    await flushHistoryOwner();
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onLoad).toHaveBeenCalledTimes(1);
  });
});
