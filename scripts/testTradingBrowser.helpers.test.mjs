import assert from 'node:assert/strict';
import test from 'node:test';
import { runLiveIsolatedGateway } from './tradingBrowser/liveIsolatedGateway.mjs';
import {
  countIntents,
  isLocalGatewayUrl,
  isUuidV4,
  parseTradingBrowserArgs,
  percentile,
  redactIdentity,
  summarizeMs,
  validateSyntheticIdentity,
} from './tradingBrowser/validation.mjs';

test('accepts loopback and RFC1918 gateway URLs only', () => {
  assert.equal(isLocalGatewayUrl('http://127.0.0.1:5173/'), true);
  assert.equal(isLocalGatewayUrl('ws://127.0.0.1:9000/ws/v2'), true);
  assert.equal(isLocalGatewayUrl('http://localhost:8102/'), true);
  assert.equal(isLocalGatewayUrl('http://192.168.1.20:8080/'), true);
  assert.equal(isLocalGatewayUrl('http://10.0.0.5:8080/'), true);
});

test('refuses production, public, and encrypted-scheme gateway URLs', () => {
  assert.equal(isLocalGatewayUrl('https://backend.orrnn.com/'), false);
  assert.equal(isLocalGatewayUrl('https://testbrokerbackend.orrnn.com/'), false);
  assert.equal(isLocalGatewayUrl('http://203.0.113.10:8080/'), false);
  assert.equal(isLocalGatewayUrl('wss://127.0.0.1:9000/ws'), false);
  assert.equal(isLocalGatewayUrl('https://127.0.0.1:9000/'), false);
  assert.equal(isLocalGatewayUrl('not-a-url'), false);
});

test('parses args with bounded samples', () => {
  assert.deepEqual(parseTradingBrowserArgs([]), {
    mode: 'transport',
    gatewayUrl: '',
    identity: '',
    symbol: 'EURUSD',
    volume: 0.01,
    samples: 5,
    timeoutMs: 30_000,
    headless: true,
    screenshots: '',
    vitePort: 0,
  });
  const parsed = parseTradingBrowserArgs(['--mode', 'live', '--gateway-url=http://127.0.0.1:5173', '--samples', '500']);
  assert.equal(parsed.mode, 'live');
  assert.equal(parsed.gatewayUrl, 'http://127.0.0.1:5173');
  assert.equal(parsed.samples, 50);
});

test('summarizes only real measured samples', () => {
  assert.equal(summarizeMs([]), null);
  const summary = summarizeMs([10, 20, 30, 40, 100]);
  assert.equal(summary.count, 5);
  assert.equal(summary.min, 10);
  assert.equal(summary.max, 100);
  assert.equal(summary.p50, 30);
  assert.equal(summary.p95, 100);
  assert.equal(percentile([], 0.5), null);
});

test('counts intents so a same-id retry is not a duplicate', () => {
  const counts = countIntents([
    { client_order_id: 'aaa' },
    { client_order_id: 'aaa' },
    { client_order_id: 'bbb' },
  ]);
  assert.equal(counts.distinctIntents, 2);
  assert.deepEqual(counts.framesByIntent, { aaa: 2, bbb: 1 });
  assert.equal(isUuidV4('550e8400-e29b-41d4-a716-446655440000'), true);
  assert.equal(isUuidV4('not-a-uuid'), false);
});

test('validates synthetic identity and never exposes the token', () => {
  assert.equal(validateSyntheticIdentity(null), 'identity must be a JSON object');
  assert.equal(
    validateSyntheticIdentity({ account_login: 0, token: 'x' }),
    'identity.account_login must be a positive number',
  );
  assert.equal(
    validateSyntheticIdentity({ account_login: 1, token: '  ' }),
    'identity.token must be a non-empty string',
  );
  assert.equal(validateSyntheticIdentity({ account_login: 900001, token: 'secret' }), null);
  const redacted = JSON.stringify(redactIdentity({ account_login: 900001, token: 'secret' }));
  assert.ok(!redacted.includes('secret'));
  assert.ok(redacted.includes('[redacted]'));
});

test('live mode is unsupported and fails closed without measuring', async () => {
  const result = await runLiveIsolatedGateway({ gatewayUrl: 'http://127.0.0.1:5173/' });
  assert.equal(result.ok, false);
  assert.equal(result.unsupported, true);
  assert.match(result.reason, /unsupported/i);
});

test('live identity accepts object and array forms without exposing tokens', async () => {
  const { normalizeLiveIdentity, deriveLiveWsUrl, isLiveSymbol } = await import('./tradingBrowser/validation.mjs');
  assert.deepEqual(normalizeLiveIdentity({ account_login: 900001, token: 'secret' }), { account_login: 900001, token: 'secret' });
  assert.deepEqual(normalizeLiveIdentity({ login: '900002', auth_token: 'tok' }), { account_login: 900002, token: 'tok' });
  assert.deepEqual(normalizeLiveIdentity([900003, 'tok3']), { account_login: 900003, token: 'tok3' });
  assert.deepEqual(normalizeLiveIdentity([{ account_login: 900004, token: 'tok4' }]), { account_login: 900004, token: 'tok4' });
  assert.throws(() => normalizeLiveIdentity({ account_login: 1, token: '  ' }), /token/);
  try {
    normalizeLiveIdentity({ account_login: 0, token: 'x' });
    assert.fail('expected throw');
  } catch (error) {
    assert.ok(!String(error.message).includes('x') || String(error.message).includes('account_login'));
  }
  assert.equal(deriveLiveWsUrl('http://127.0.0.1:8080/'), 'ws://127.0.0.1:8080/ws/v2');
  assert.throws(() => deriveLiveWsUrl('https://127.0.0.1:8080/'), /http/);
  assert.throws(() => deriveLiveWsUrl('http://203.0.113.10:8080/'), /local|loopback/);
  assert.equal(isLiveSymbol('PERFUSD'), true);
  assert.equal(isLiveSymbol('EURUSD'), false);
});

test('live mode requires identity PATH and PERFUSD symbol', async () => {
  const missingIdentity = await runLiveIsolatedGateway({ gatewayUrl: 'http://127.0.0.1:5173/', symbol: 'PERFUSD' });
  assert.equal(missingIdentity.ok, false);
  assert.equal(missingIdentity.unsupported, true);
  const wrongSymbol = await runLiveIsolatedGateway({ gatewayUrl: 'http://127.0.0.1:5173/', identity: '/tmp/nope.json', symbol: 'EURUSD' });
  assert.equal(wrongSymbol.ok, false);
  assert.equal(wrongSymbol.unsupported, true);
  assert.match(wrongSymbol.reason, /PERFUSD/);
});
