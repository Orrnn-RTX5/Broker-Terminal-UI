import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/authenticatedStyles';
import '../../src/i18n';
import { OpenAccountDialog } from '../../src/components/dialogs/OpenAccountDialog';
import { getCachedBrokerDirectory, loadBrokerDirectory } from '../../src/services/brokerDirectory';

// The actual component and directory cache run against delayed sample metadata.
// Native networking is separately restricted to this local fixture by Electron.
const fixtureWindow = window as any;
fixtureWindow.electron = { window: {} };
localStorage.clear();
sessionStorage.clear();
document.documentElement.className = 'rtx-desktop-shell-active rtx-advanced-view rtx-skin-untitled-light';
document.documentElement.dataset.theme = 'light';
const delayMs = 900;
const calls: Array<{ startedAt: number; resolvedAt?: number }> = [];
const measurements: Array<{ label: string; openedAt: number; readyAt?: number; elapsedMs?: number; requestsBefore: number; requestsAfter?: number }> = [];
const brokers = [
  { id: 1, broker_id: 'fixture-one', broker_name: 'Example Financial Services', server: 'https://one.fixture.invalid', server_url: 'https://one.fixture.invalid', enabled: true },
  { id: 2, broker_id: 'fixture-two', broker_name: 'Sample Trading Group', server: 'https://two.fixture.invalid', server_url: 'https://two.fixture.invalid', enabled: true },
];
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (!url.endsWith('/api/v2/broker/servers')) throw new Error('Blocked unexpected fixture fetch: ' + url);
  const call = { startedAt: performance.now() } as typeof calls[number];
  calls.push(call);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs);
    init?.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
  });
  call.resolvedAt = performance.now();
  return Response.json(brokers);
}) as typeof fetch;

function currentState() {
  const dialog = document.querySelector('.rtx-open-account-dialog');
  const selected = dialog?.querySelector('.rtx-open-account-dialog__broker[aria-pressed="true"]');
  const next = dialog?.querySelector<HTMLButtonElement>('.rtx-account-primary');
  return {
    open: Boolean(dialog),
    loading: Boolean(dialog?.textContent?.includes('Loading brokers')),
    brokerCount: dialog?.querySelectorAll('.rtx-open-account-dialog__broker').length || 0,
    selected: selected?.textContent?.trim() || null,
    nextEnabled: Boolean(next && !next.disabled),
    requests: calls.length,
    cached: getCachedBrokerDirectory() !== null,
  };
}

function Preview() {
  const [mounted, setMounted] = useState(new URLSearchParams(location.search).get('mode') !== 'signin');
  const [open, setOpen] = useState(false);
  useEffect(() => {
    fixtureWindow.loadingPreview = {
      delayMs, calls, measurements,
      snapshot: currentState,
      mount: () => setMounted(true),
      close: () => setOpen(false),
      open: (label: string) => {
        const record = { label, openedAt: performance.now(), requestsBefore: calls.length } as typeof measurements[number];
        measurements.push(record);
        const observer = new MutationObserver(() => {
          const state = currentState();
          if (!state.open || !state.nextEnabled || !state.selected) return;
          record.readyAt = performance.now();
          record.elapsedMs = record.readyAt - record.openedAt;
          record.requestsAfter = calls.length;
          observer.disconnect();
        });
        observer.observe(document.body, { childList: true, subtree: true, attributes: true });
        setOpen(true);
      },
      signInLoad: async () => {
        const startedAt = performance.now();
        const rows = await loadBrokerDirectory({ forceRefresh: true });
        return { startedAt, resolvedAt: performance.now(), rows: rows.length, requests: calls.length };
      },
    };
  }, []);
  return <div style={{ padding: 24 }}>
    <p>Native Electron component sample: broker directory loading</p>
    <p>Sample metadata with a deliberate 900 ms response delay. Isolated storage and blocked external network.</p>
    {mounted && <OpenAccountDialog isOpen={open} onClose={() => setOpen(false)} />}
  </div>;
}

createRoot(document.getElementById('root')!).render(<Preview />);
