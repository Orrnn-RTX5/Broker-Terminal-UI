import { afterEach, describe, expect, it } from 'vitest';
import { useAppStore } from './useAppStore';
import { normalizeAccountMetrics } from '../services/accountMetrics';

afterEach(() => useAppStore.setState({ account: null }));

describe('account publication ordering across store writers', () => {
  it('prevents a delayed tokenless REST writer from replacing streamed metrics', () => {
    const latest = normalizeAccountMetrics({ balance: 0, publication_token: '17895582000000000002' }, null, { scope: 'session-a' });
    useAppStore.setState({ account: latest });
    useAppStore.getState().setAccount(normalizeAccountMetrics({ balance: 500 }));
    expect(useAppStore.getState().account).toBe(latest);
    useAppStore.getState().setAccount(normalizeAccountMetrics({ balance: 500, publication_token: '17895582000000000001' }));
    expect(useAppStore.getState().account).toBe(latest);
  });

  it('permits an explicit session reset', () => {
    useAppStore.setState({ account: normalizeAccountMetrics({ balance: 0, publication_token: '17895582000000000002' }) });
    useAppStore.getState().setAccount(null);
    useAppStore.getState().setAccount(normalizeAccountMetrics({ balance: 100, publication_token: '17895582000000000001' }));
    expect(useAppStore.getState().account?.balance).toBe(100);
  });
});
