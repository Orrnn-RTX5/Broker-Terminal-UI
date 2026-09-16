import React from 'react';
import { createRoot } from 'react-dom/client';
import { FileMenu } from '../../src/components/layout/FileMenu';

const fixtureWindow = window as any;
fixtureWindow.electron = { window: {} };
fixtureWindow.fixtureCalls = { discovery: [], create: [], login: [], auth: [], persisted: [], logout: 0 };
const brokers = [
  { id: 1, broker_id: 'fixture-one', broker_name: 'Example Financial Services',
    server: 'https://one.fixture.invalid', server_url: 'https://one.fixture.invalid',
    backend_url: 'https://one-backend.fixture.invalid', market_api_url: 'https://one-api.fixture.invalid', enabled: true },
  { id: 2, broker_id: 'fixture-two', broker_name: 'Sample Trading Group',
    server: 'https://two.fixture.invalid', server_url: 'https://two.fixture.invalid',
    backend_url: 'https://two-backend.fixture.invalid', market_api_url: 'https://two-api.fixture.invalid', enabled: true },
];
window.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  fixtureWindow.fixtureCalls.discovery.push(url);
  if (!url.endsWith('/api/v2/broker/servers')) throw new Error('Unexpected fixture fetch: ' + url);
  return { ok: true, status: 200, json: async () => brokers.slice(0, fixtureWindow.fixtureConfig.count) } as Response;
});
createRoot(document.getElementById('root')!).render(
  <FileMenu accountId="900011" onLogout={() => fixtureWindow.fixtureCalls.logout++} />,
);
