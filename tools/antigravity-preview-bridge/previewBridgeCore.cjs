const { createHash } = require('node:crypto');
const os = require('node:os');
const path = require('node:path');

const EXTENSION_ID = 'rtx5.antigravity-preview-bridge';
const PIPE_PREFIX = 'rtx5-antigravity-preview';

const normalizeWorkspaceRoot = (value) => {
  const resolved = path.resolve(String(value || '.'));
  const withoutTrailingSeparators = resolved.replace(/[\\/]+$/, '');
  return (withoutTrailingSeparators || resolved).toLowerCase();
};

const workspaceKey = (workspaceRoot) => createHash('sha256')
  .update(normalizeWorkspaceRoot(workspaceRoot))
  .digest('hex')
  .slice(0, 16);

const workspacePipeName = (
  workspaceRoot,
  sessionId,
  platform = process.platform,
  temporaryDirectory = os.tmpdir(),
) => {
  const normalizedSessionId = String(sessionId || '').trim().toLowerCase();
  if (!/^[a-f0-9]{16,64}$/.test(normalizedSessionId)) {
    throw new Error('Preview bridge session ID is invalid.');
  }
  const socketName = `${PIPE_PREFIX}-${workspaceKey(workspaceRoot)}-${normalizedSessionId}`;

  return platform === 'win32'
    ? `\\\\.\\pipe\\${socketName}`
    : path.join(temporaryDirectory, `${socketName}.sock`);
};

const bridgeStateDirectory = (
  platform = process.platform,
  environment = process.env,
  temporaryDirectory = os.tmpdir(),
) => platform === 'win32'
  ? path.join(environment.LOCALAPPDATA || temporaryDirectory, 'RTX5', 'AntigravityPreview')
  : path.join(temporaryDirectory, 'rtx5-antigravity-preview');

const workspaceStateFile = (
  workspaceRoot,
  platform = process.platform,
  environment = process.env,
  temporaryDirectory = os.tmpdir(),
) => path.join(
  bridgeStateDirectory(platform, environment, temporaryDirectory),
  `${PIPE_PREFIX}-${workspaceKey(workspaceRoot)}.json`,
);

const isLoopbackHostname = (hostname) => {
  const normalized = String(hostname || '')
    .trim()
    .replace(/^\[|\]$/g, '')
    .toLowerCase();

  return normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '::1';
};

const previewPanelKey = (value) => new URL(String(value)).origin;

const previewPanelTitle = (value) => {
  const url = new URL(String(value));
  const locationLabel = url.port || url.hostname.replace(/^\[|\]$/g, '');
  return `Jetski Preview ${locationLabel}`;
};

const validatePreviewRequest = (request, expectedWorkspaceRoot, expectedToken = null) => {
  if (!request || typeof request !== 'object') {
    throw new Error('Preview request must be an object.');
  }

  const workspaceRoot = normalizeWorkspaceRoot(request.workspaceRoot);
  if (workspaceRoot !== normalizeWorkspaceRoot(expectedWorkspaceRoot)) {
    throw new Error('Preview request belongs to a different workspace.');
  }
  if (expectedToken && request.token !== expectedToken) {
    throw new Error('Preview request authentication failed.');
  }

  let url;
  try {
    url = new URL(String(request.url || ''));
  } catch {
    throw new Error('Preview URL is invalid.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Preview URL must use HTTP or HTTPS.');
  }
  if (!isLoopbackHostname(url.hostname)) {
    throw new Error('Preview URL must use a loopback host.');
  }
  if (url.username || url.password) {
    throw new Error('Preview URL must not contain credentials.');
  }

  return {
    workspaceRoot,
    url: url.toString(),
  };
};

const encodePreviewRequest = (request) => Buffer
  .from(JSON.stringify(request), 'utf8')
  .toString('base64url');

const decodePreviewRequest = (encoded) => JSON.parse(
  Buffer.from(String(encoded || ''), 'base64url').toString('utf8'),
);

module.exports = {
  EXTENSION_ID,
  bridgeStateDirectory,
  decodePreviewRequest,
  encodePreviewRequest,
  isLoopbackHostname,
  normalizeWorkspaceRoot,
  previewPanelKey,
  previewPanelTitle,
  validatePreviewRequest,
  workspaceKey,
  workspacePipeName,
  workspaceStateFile,
};
