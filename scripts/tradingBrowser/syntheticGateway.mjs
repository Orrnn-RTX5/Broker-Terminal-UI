/**
 * Dependency-free synthetic trade gateway: real TCP sockets, real browser
 * WebSocket/HTTP — no mocks, no fakes.
 *
 * - HTTP: minimal JSON REST for market open / close / modify / pending.
 * - WS: minimal RFC6455 server (masked client frames, fragmented frames,
 *   ping/pong, close) speaking the frontend `place_order` /
 *   `get_order_status` correlation contract from `src/api/tradeSocket.ts`:
 *     * `place_order` carries `request_id` + `client_order_id` (UUIDv4).
 *     * Recovery reuses the ORIGINAL `request_id`/`client_order_id` via
 *       `get_order_status` — a second `place_order` with a new id would be
 *       a duplicate user intent and is counted as such.
 *
 * Never logs auth tokens. `summary()` is safe to print.
 */
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
let nextTicket = 700000;

const readJsonBody = (req) => new Promise((resolve) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    try {
      resolve(raw ? JSON.parse(raw) : {});
    } catch {
      resolve({ __parseError: true });
    }
  });
});

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization',
  // The fixture page is served by Vite on one loopback port while this
  // gateway listens on another: real browser fetch requires CORS.
};

const sendJson = (res, status, payload) => {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
    ...CORS_HEADERS,
  });
  res.end(body);
};

/** Minimal server-side WS connection: parses masked client frames. */
class WsConnection {
  constructor(socket, onMessage, onClose) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.closed = false;
    this.onMessage = onMessage;
    this.onClose = onClose;
    socket.on('data', (chunk) => this.ingest(chunk));
    socket.on('close', () => { this.closed = true; this.onClose?.(); });
    socket.on('error', () => {});
  }

  ingest(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      if (this.buffer.length < 2) return;
      const fin = (this.buffer[0] & 0x80) !== 0;
      const opcode = this.buffer[0] & 0x0f;
      const masked = (this.buffer[1] & 0x80) !== 0;
      let length = this.buffer[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) return;
        const hi = this.buffer.readUInt32BE(2);
        const lo = this.buffer.readUInt32BE(6);
        if (hi !== 0 || lo > 16 * 1024 * 1024) { this.destroy(); return; }
        length = lo;
        offset = 10;
      }
      const maskBytes = masked ? 4 : 0;
      if (this.buffer.length < offset + maskBytes + length) return;
      let payload = this.buffer.subarray(offset + maskBytes, offset + maskBytes + length);
      if (masked) {
        const mask = this.buffer.subarray(offset, offset + 4);
        const out = Buffer.alloc(length);
        for (let i = 0; i < length; i += 1) out[i] = payload[i] ^ mask[i % 4];
        payload = out;
      }
      this.buffer = this.buffer.subarray(offset + maskBytes + length);
      if (opcode === 0x8) { this.destroy(); return; }
      if (opcode === 0x9) { this.pong(payload); continue; }
      if (opcode === 0xa) continue;
      if (opcode === 0x1 || opcode === 0x0) {
        this.fragments = Buffer.concat([this.fragments || Buffer.alloc(0), payload]);
        if (fin) {
          const text = this.fragments.toString('utf8');
          this.fragments = Buffer.alloc(0);
          this.onMessage?.(text);
        }
      }
    }
  }

  frame(text) {
    const payload = Buffer.from(text, 'utf8');
    const header = payload.length < 126
      ? Buffer.from([0x81, payload.length])
      : Buffer.from([0x81, 126, (payload.length >> 8) & 0xff, payload.length & 0xff]);
    if (!this.closed) this.socket.write(Buffer.concat([header, payload]));
  }

  send(obj) {
    this.frame(JSON.stringify(obj));
  }

  pong(payload) {
    const header = Buffer.from([0x8a, payload.length]);
    if (!this.closed) this.socket.write(Buffer.concat([header, payload]));
  }

  destroy() {
    if (this.closed) return;
    this.closed = true;
    try { this.socket.destroy(); } catch { /* noop */ }
    this.onClose?.();
  }
}

const acceptKey = (key) => createHash('sha1').update(`${String(key).trim()}${WS_GUID}`).digest('base64');

export const startSyntheticGateway = async (options = {}) => {
  const state = {
    startedAt: Date.now(),
    // WS intent tracking
    wsFrames: [],
    placeOrderByIntent: new Map(), // client_order_id -> count
    statusRecoveryByIntent: new Map(),
    pendingFills: new Map(), // client_order_id -> fill payload
    // REST intent tracking: closes are durable commands keyed by the
    // client-supplied client_order_id (same contract as the real gateway:
    // POST /positions/{ticket}/close {client_order_id, volume} admits a
    // CLOSE_POSITION command; GET /order-commands/{client_order_id} reads
    // its terminal outcome). One intent executes exactly once; a replay
    // with the same id observes the same result without re-executing.
    restAttempts: [],
    closeExecutionsByTicket: new Map(),
    closeCommandsByIntent: new Map(),
    closeStatusPollsByIntent: new Map(),
    modifyExecutions: [],
    pendingExecutions: [],
    // one-shot scenario flags (reset after firing)
    dropNextFill: false,
    dropNextCloseReply: false,
    delayCloseReplyMs: 0,
    dropConnectionAfterNextFrame: false,
    connections: new Set(),
  };

  const fillFor = (order) => ({
    order_ticket: (nextTicket += 1),
    position_ticket: (nextTicket += 7),
    symbol: order.symbol,
    side: order.side,
    volume: order.volume,
    price: 1.085 + Math.random() * 0.001,
    status: 'filled',
  });

  const handleWsFrame = (conn, text) => {
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    const action = String(msg.action || msg.type || '').toLowerCase();
    state.wsFrames.push({
      at: Date.now(),
      action,
      request_id: msg.request_id,
      client_order_id: msg.client_order_id,
    });

    if (state.dropConnectionAfterNextFrame) {
      state.dropConnectionAfterNextFrame = false;
      conn.destroy();
      return;
    }

    if (action === 'auth') {
      conn.send({ type: 'authenticated' });
      return;
    }
    if (action === 'subscribe') {
      conn.send({ type: 'subscribed', channel: msg.channel });
      return;
    }
    if (action === 'place_order') {
      const clientOrderId = String(msg.client_order_id || '');
      state.placeOrderByIntent.set(clientOrderId, (state.placeOrderByIntent.get(clientOrderId) || 0) + 1);
      conn.send({ type: 'order_accepted', request_id: msg.request_id, client_order_id: clientOrderId });
      if (state.dropNextFill) {
        // Withhold the fill: the client must reconcile with get_order_status
        // reusing the ORIGINAL ids (see tradeSocket.ts recoverPendingOrder).
        state.dropNextFill = false;
        state.pendingFills.set(clientOrderId, {
          requestId: msg.request_id,
          fill: fillFor(msg),
        });
        return;
      }
      setTimeout(() => {
        conn.send({
          type: 'order_filled',
          request_id: msg.request_id,
          client_order_id: clientOrderId,
          data: fillFor(msg),
        });
      }, options.fillDelayMs ?? 20);
      return;
    }
    if (action === 'get_order_status') {
      const clientOrderId = String(msg.client_order_id || '');
      state.statusRecoveryByIntent.set(clientOrderId, (state.statusRecoveryByIntent.get(clientOrderId) || 0) + 1);
      const pending = state.pendingFills.get(clientOrderId);
      const fill = pending ? pending.fill : fillFor({ symbol: 'EURUSD', side: 'buy', volume: 0.01 });
      state.pendingFills.delete(clientOrderId);
      // Correlate with the request_id the client sent (the ORIGINAL one on
      // the recovery path) so routePendingOrderMessage resolves the pending.
      conn.send({
        type: 'order_filled',
        request_id: msg.request_id,
        client_order_id: clientOrderId,
        data: fill,
      });
      return;
    }
  };

  const server = createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...CORS_HEADERS, 'content-length': 0 });
      res.end();
      return;
    }
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const attempt = { at: Date.now(), method: req.method, path: url.pathname };
    if (req.method === 'POST' && url.pathname === '/api/v2/orders') {
      const body = await readJsonBody(req);
      state.restAttempts.push({ ...attempt, kind: 'rest_open' });
      const ticket = (nextTicket += 1);
      sendJson(res, 200, {
        ticket,
        position_ticket: ticket + 1,
        symbol: body.symbol || 'EURUSD',
        client_order_id: body.client_order_id || randomUUID(),
        status: 'filled',
      });
      return;
    }
    const closeMatch = req.method === 'POST' && /^\/api\/v2\/positions\/([^/]+)\/close$/.exec(url.pathname);
    if (closeMatch) {
      const ticket = String(closeMatch[1]);
      const body = await readJsonBody(req);
      const clientOrderId = typeof body?.client_order_id === 'string' ? body.client_order_id : '';
      const volume = typeof body?.volume === 'number' ? body.volume : 0;
      state.restAttempts.push({ ...attempt, kind: 'rest_close', ticket, client_order_id: clientOrderId });
      if (!clientOrderId) {
        sendJson(res, 400, { code: 'INVALID_CLIENT_ORDER_ID', message: 'client_order_id is required' });
        return;
      }
      if (!Number.isFinite(volume) || volume < 0) {
        sendJson(res, 400, { code: 'INVALID_INPUT', message: 'Close volume must be a finite non-negative number' });
        return;
      }
      const existing = state.closeCommandsByIntent.get(clientOrderId);
      if (existing) {
        sendJson(res, 200, existing.result);
        return;
      }
      const result = {
        ticket,
        client_order_id: clientOrderId,
        status: volume > 0 ? 'partial_closed' : 'closed',
        volume_closed: volume,
        closed: true,
      };
      state.closeCommandsByIntent.set(clientOrderId, { ticket, volume, executions: 1, result });
      state.closeExecutionsByTicket.set(ticket, (state.closeExecutionsByTicket.get(ticket) || 0) + 1);
      if (state.dropNextCloseReply) {
        // Drop-after-commit: the close already executed exactly once under
        // this client_order_id; the reply TCP is destroyed without bytes.
        // The real client recovers by querying GET
        // /order-commands/{the same client_order_id} — it never resubmits
        // the close.
        state.dropNextCloseReply = false;
        try { req.socket.destroy(); } catch { /* noop */ }
        return;
      }
      if (state.delayCloseReplyMs > 0) {
        // Held reply: the close already executed exactly once under this
        // client_order_id; the reply is withheld past the client's own
        // deadline so the client observes a timeout and recovers via GET
        // /order-commands/{the same client_order_id}. The connection stays
        // open and silent, so no transport retry can duplicate the POST.
        const waitMs = state.delayCloseReplyMs;
        state.delayCloseReplyMs = 0;
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, waitMs);
          req.on('close', () => { clearTimeout(timer); resolve(); });
        });
        if (req.destroyed) return;
      }
      try {
        sendJson(res, 200, result);
      } catch { /* client already gone; the intent stays single-execution */ }
      return;
    }
    const statusMatch = req.method === 'GET' && /^\/api\/v2\/order-commands\/([^/]+)$/.exec(url.pathname);
    if (statusMatch) {
      const clientOrderId = decodeURIComponent(statusMatch[1]);
      state.restAttempts.push({ ...attempt, kind: 'rest_close_status', client_order_id: clientOrderId });
      state.closeStatusPollsByIntent.set(
        clientOrderId,
        (state.closeStatusPollsByIntent.get(clientOrderId) || 0) + 1,
      );
      const command = state.closeCommandsByIntent.get(clientOrderId);
      if (!command) {
        sendJson(res, 404, { code: 'ORDER_COMMAND_NOT_FOUND', message: 'Order command not found' });
        return;
      }
      sendJson(res, 200, {
        action: 'close_position',
        type: 'position_closed',
        status: 'filled',
        success: true,
        client_order_id: clientOrderId,
        data: command.result,
      });
      return;
    }
    if (req.method === 'PUT' && /^\/api\/v2\/positions\/[^/]+$/.test(url.pathname)) {
      const body = await readJsonBody(req);
      state.restAttempts.push({ ...attempt, kind: 'rest_modify' });
      state.modifyExecutions.push({ at: Date.now(), body: typeof body === 'object' ? Object.keys(body) : [] });
      sendJson(res, 200, { ok: true, ticket: url.pathname.split('/').pop(), ...body });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/v2/orders/pending') {
      const body = await readJsonBody(req);
      state.restAttempts.push({ ...attempt, kind: 'rest_pending' });
      state.pendingExecutions.push({ at: Date.now() });
      sendJson(res, 200, { ticket: `P${(nextTicket += 1)}`, status: 'accepted', ...body });
      return;
    }
    if (req.method === 'PUT' && /^\/api\/v2\/orders\/pending\/[^/]+$/.test(url.pathname)) {
      const body = await readJsonBody(req);
      state.restAttempts.push({ ...attempt, kind: 'rest_modify_pending' });
      sendJson(res, 200, { ok: true, ticket: url.pathname.split('/').pop(), ...body });
      return;
    }
    sendJson(res, 404, { error: 'synthetic-gateway: unknown route' });
  });

  server.on('upgrade', (req, socket) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (!url.pathname.startsWith('/ws/')) {
      socket.destroy();
      return;
    }
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n'
      + 'Upgrade: websocket\r\n'
      + 'Connection: Upgrade\r\n'
      + `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`,
    );
    const conn = new WsConnection(socket, (text) => handleWsFrame(conn, text), () => {
      state.connections.delete(conn);
    });
    state.connections.add(conn);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  return {
    httpUrl: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}/ws/v2`,
    state,
    summary: () => ({
      wsFrames: state.wsFrames.length,
      distinctPlaceOrderIntents: state.placeOrderByIntent.size,
      placeOrderFrames: [...state.placeOrderByIntent.values()].reduce((a, b) => a + b, 0),
      statusRecoveries: state.statusRecoveryByIntent.size,
      restAttempts: state.restAttempts.length,
      closeExecutions: Object.fromEntries(state.closeExecutionsByTicket),
      distinctCloseIntents: state.closeCommandsByIntent.size,
      closeStatusPolls: Object.fromEntries(state.closeStatusPollsByIntent),
    }),
    close: async () => {
      for (const conn of state.connections) conn.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
};
