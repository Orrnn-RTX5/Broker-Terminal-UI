import assert from 'node:assert/strict';
import test from 'node:test';
import { startSyntheticGateway } from './tradingBrowser/syntheticGateway.mjs';

const wsOnce = (ws, timeoutMs = 5000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('ws timeout')), timeoutMs);
  ws.addEventListener('message', (event) => {
    clearTimeout(timer);
    resolve(JSON.parse(String(event.data)));
  }, { once: true });
  ws.addEventListener('error', (event) => {
    clearTimeout(timer);
    reject(event?.error || new Error('ws error'));
  }, { once: true });
});

test('synthetic gateway fills orders over a real WebSocket', async () => {
  const gateway = await startSyntheticGateway({ fillDelayMs: 5 });
  try {
    const ws = new WebSocket(gateway.wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
    ws.send(JSON.stringify({ action: 'auth', token: 'synthetic' }));
    await wsOnce(ws);
    const requestId = '11111111-1111-4111-8111-111111111111';
    const clientOrderId = '22222222-2222-4222-8222-222222222222';
    ws.send(JSON.stringify({
      action: 'place_order',
      request_id: requestId,
      client_order_id: clientOrderId,
      account_login: 900001,
      symbol: 'EURUSD',
      side: 'buy',
      type: 'market',
      volume: 0.01,
    }));
    const accepted = await wsOnce(ws);
    assert.equal(accepted.type, 'order_accepted');
    assert.equal(accepted.request_id, requestId);
    const filled = await wsOnce(ws);
    assert.equal(filled.type, 'order_filled');
    assert.equal(filled.client_order_id, clientOrderId);
    assert.equal(gateway.state.placeOrderByIntent.get(clientOrderId), 1);
    ws.close();
  } finally {
    await gateway.close();
  }
});

test('withheld fill recovers with original ids and no second place_order', async () => {
  const gateway = await startSyntheticGateway({ fillDelayMs: 5 });
  try {
    const ws = new WebSocket(gateway.wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
    const requestId = '33333333-3333-4333-8333-333333333333';
    const clientOrderId = '44444444-4444-4434-8434-444444444444';
    gateway.state.dropNextFill = true;
    ws.send(JSON.stringify({
      action: 'place_order',
      request_id: requestId,
      client_order_id: clientOrderId,
      account_login: 900001,
      symbol: 'EURUSD',
      side: 'buy',
      type: 'market',
      volume: 0.01,
    }));
    const accepted = await wsOnce(ws);
    assert.equal(accepted.type, 'order_accepted');
    // Recovery reuses the ORIGINAL request_id/client_order_id (tradeSocket.ts).
    ws.send(JSON.stringify({
      action: 'get_order_status',
      request_id: requestId,
      client_order_id: clientOrderId,
      account_login: 900001,
    }));
    const filled = await wsOnce(ws);
    assert.equal(filled.type, 'order_filled');
    assert.equal(filled.request_id, requestId);
    assert.equal(filled.client_order_id, clientOrderId);
    assert.equal(gateway.state.placeOrderByIntent.get(clientOrderId), 1);
    assert.equal(gateway.state.statusRecoveryByIntent.get(clientOrderId), 1);
    ws.close();
  } finally {
    await gateway.close();
  }
});

test('dropped close reply recovers by querying the same client_order_id, never resubmitting', async () => {
  const gateway = await startSyntheticGateway();
  try {
    const clientOrderId = '55555555-5555-4555-8555-555555555555';
    gateway.state.dropNextCloseReply = true;
    await assert.rejects(
      fetch(`${gateway.httpUrl}/api/v2/positions/720007/close`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client_order_id: clientOrderId, volume: 0 }),
      }),
    );
    const status = await fetch(
      `${gateway.httpUrl}/api/v2/order-commands/${clientOrderId}?account_login=900001`,
    );
    assert.equal(status.status, 200);
    const body = await status.json();
    assert.equal(body.status, 'filled');
    assert.equal(body.client_order_id, clientOrderId);
    assert.equal(body.data?.client_order_id, clientOrderId);
    assert.equal(gateway.state.closeCommandsByIntent.get(clientOrderId)?.executions, 1);
    assert.equal(gateway.state.closeStatusPollsByIntent.get(clientOrderId), 1);
    const posts = gateway.state.restAttempts.filter((a) => a.kind === 'rest_close');
    assert.equal(posts.length, 1);
    assert.equal(posts[0].client_order_id, clientOrderId);
  } finally {
    await gateway.close();
  }
});
