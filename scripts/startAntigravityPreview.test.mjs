import assert from 'node:assert/strict';
import test from 'node:test';
import previewBridgeCore from '../tools/antigravity-preview-bridge/previewBridgeCore.cjs';
import { parsePreviewArgs, resolvePreviewUrl } from './startAntigravityPreview.mjs';

const {
  decodePreviewRequest,
  encodePreviewRequest,
  previewPanelKey,
  previewPanelTitle,
  validatePreviewRequest,
  workspacePipeName,
  workspaceStateFile,
} = previewBridgeCore;

test('uses a non-strict 5173 preference so Vite can select 5174', () => {
  assert.deepEqual(parsePreviewArgs([]), {
    host: '127.0.0.1',
    mode: 'web',
    port: 5173,
    strictPort: false,
  });
});

test('accepts explicit mode, host, port, and strict-port options', () => {
  assert.deepEqual(
    parsePreviewArgs(['--mode', 'desktop', '--host=localhost', '--port', '5174', '--strict-port']),
    {
      host: 'localhost',
      mode: 'desktop',
      port: 5174,
      strictPort: true,
    },
  );
});

test('prefers the URL reported by the running Vite server', () => {
  const server = {
    resolvedUrls: { local: ['http://127.0.0.1:5174/app/'] },
  };
  assert.equal(resolvePreviewUrl(server, '127.0.0.1'), 'http://127.0.0.1:5174/app/');
});

test('uses the same workspace-specific pipe name on both sides', () => {
  assert.equal(
    workspacePipeName('C:\\work\\project', '1234567890abcdef', 'win32'),
    workspacePipeName('c:\\WORK\\project\\', '1234567890abcdef', 'win32'),
  );
  assert.notEqual(
    workspacePipeName('C:\\work\\project', '1234567890abcdef', 'win32'),
    workspacePipeName('C:\\work\\project', 'fedcba0987654321', 'win32'),
  );
  assert.equal(
    workspaceStateFile('C:\\work\\project', 'win32', { LOCALAPPDATA: 'C:\\state' }),
    workspaceStateFile('c:\\WORK\\project\\', 'win32', { LOCALAPPDATA: 'C:\\state' }),
  );
});

test('URI request encoding round-trips without shell metacharacters', () => {
  const request = { workspaceRoot: 'C:\\work\\project', url: 'http://127.0.0.1:5174/' };
  const encoded = encodePreviewRequest(request);
  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodePreviewRequest(encoded), request);
});

test('uses a separate editor preview identity for each port', () => {
  assert.equal(previewPanelKey('http://127.0.0.1:5173/'), 'http://127.0.0.1:5173');
  assert.equal(previewPanelKey('http://127.0.0.1:5174/app'), 'http://127.0.0.1:5174');
  assert.notEqual(
    previewPanelKey('http://127.0.0.1:5173/'),
    previewPanelKey('http://127.0.0.1:5174/'),
  );
  assert.equal(previewPanelTitle('http://127.0.0.1:5174/'), 'Jetski Preview 5174');
});

test('accepts only matching-workspace loopback preview URLs', () => {
  const workspaceRoot = process.cwd();
  const token = 'a'.repeat(64);
  assert.equal(
    validatePreviewRequest(
      { workspaceRoot, url: 'http://127.0.0.1:5174/', token },
      workspaceRoot,
      token,
    ).url,
    'http://127.0.0.1:5174/',
  );
  assert.throws(
    () => validatePreviewRequest(
      { workspaceRoot, url: 'https://example.com/' },
      workspaceRoot,
    ),
    /loopback host/,
  );
  assert.throws(
    () => validatePreviewRequest(
      { workspaceRoot: `${workspaceRoot}-other`, url: 'http://127.0.0.1:5174/' },
      workspaceRoot,
    ),
    /different workspace/,
  );
  assert.throws(
    () => validatePreviewRequest(
      { workspaceRoot, url: 'http://127.0.0.1:5174/', token: 'wrong' },
      workspaceRoot,
      token,
    ),
    /authentication failed/,
  );
  assert.throws(
    () => validatePreviewRequest(
      { workspaceRoot, url: 'http://0.0.0.0:5174/' },
      workspaceRoot,
    ),
    /loopback host/,
  );
});
