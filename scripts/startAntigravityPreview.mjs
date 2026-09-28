import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import previewBridgeCore from '../tools/antigravity-preview-bridge/previewBridgeCore.cjs';

const {
  EXTENSION_ID,
  encodePreviewRequest,
  isLoopbackHostname,
  normalizeWorkspaceRoot,
  workspaceStateFile,
} = previewBridgeCore;

const DEFAULT_OPTIONS = Object.freeze({
  host: '127.0.0.1',
  mode: 'web',
  port: 5173,
  strictPort: false,
});

const readOptionValue = (args, index, optionName) => {
  const argument = args[index];
  const equalsPrefix = `${optionName}=`;
  if (argument.startsWith(equalsPrefix)) {
    return { value: argument.slice(equalsPrefix.length), consumed: 0 };
  }
  if (argument === optionName) {
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`${optionName} requires a value.`);
    }
    return { value, consumed: 1 };
  }
  return null;
};

export const parsePreviewArgs = (args) => {
  const options = { ...DEFAULT_OPTIONS };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const mode = readOptionValue(args, index, '--mode');
    const host = readOptionValue(args, index, '--host');
    const port = readOptionValue(args, index, '--port');

    if (mode) {
      options.mode = mode.value;
      index += mode.consumed;
    } else if (host) {
      options.host = host.value;
      index += host.consumed;
    } else if (port) {
      options.port = Number(port.value);
      index += port.consumed;
    } else if (argument === '--strict-port' || argument === '--strictPort') {
      options.strictPort = true;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unsupported option: ${argument}`);
    }
  }

  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
    throw new Error('--port must be an integer between 0 and 65535.');
  }
  if (!options.mode.trim()) throw new Error('--mode must not be empty.');
  if (!options.host.trim()) throw new Error('--host must not be empty.');
  if (!isLoopbackHostname(options.host) && options.host !== '0.0.0.0' && options.host !== '::') {
    throw new Error('--host must be localhost, 127.0.0.1, ::1, 0.0.0.0, or ::.');
  }

  return options;
};

export const resolvePreviewUrl = (server, fallbackHost) => {
  const resolvedLocalUrl = server.resolvedUrls?.local?.[0];
  if (resolvedLocalUrl) return resolvedLocalUrl;

  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') {
    throw new Error('Vite did not expose its listening address.');
  }

  const configuredHost = String(fallbackHost || '127.0.0.1');
  const browserHost = configuredHost === '0.0.0.0' || configuredHost === '::'
    ? '127.0.0.1'
    : configuredHost;
  const formattedHost = browserHost.includes(':') ? `[${browserHost}]` : browserHost;
  const protocol = server.config.server.https ? 'https' : 'http';
  return new URL(server.config.base || '/', `${protocol}://${formattedHost}:${address.port}`).toString();
};

const readBridgeState = (workspaceRoot) => {
  const stateFile = workspaceStateFile(workspaceRoot);
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  if (normalizeWorkspaceRoot(state.workspaceRoot) !== normalizeWorkspaceRoot(workspaceRoot)) {
    throw new Error('Antigravity preview state belongs to a different workspace.');
  }
  if (typeof state.pipeName !== 'string' || !state.pipeName.includes('rtx5-antigravity-preview-')) {
    throw new Error('Antigravity preview state has an invalid pipe name.');
  }
  if (typeof state.sessionToken !== 'string' || !/^[a-f0-9]{64}$/.test(state.sessionToken)) {
    throw new Error('Antigravity preview state has an invalid session token.');
  }
  return state;
};

const requestPreviewOverPipe = (request, timeoutMs = 2500) => new Promise((resolve, reject) => {
  let state;
  try {
    state = readBridgeState(request.workspaceRoot);
  } catch (error) {
    reject(error);
    return;
  }

  const socket = net.createConnection(state.pipeName);
  let responseText = '';
  let settled = false;

  const finish = (error, response) => {
    if (settled) return;
    settled = true;
    socket.destroy();
    if (error) reject(error);
    else resolve(response);
  };

  socket.setEncoding('utf8');
  socket.setTimeout(timeoutMs);
  socket.on('connect', () => socket.write(`${JSON.stringify({
    ...request,
    token: state.sessionToken,
  })}\n`));
  socket.on('data', (chunk) => {
    responseText += chunk;
    const newlineIndex = responseText.indexOf('\n');
    if (newlineIndex < 0) return;

    try {
      const response = JSON.parse(responseText.slice(0, newlineIndex));
      if (!response.ok) throw new Error(response.error || 'Antigravity rejected the preview request.');
      finish(null, response);
    } catch (error) {
      finish(error);
    }
  });
  socket.on('timeout', () => finish(new Error('Timed out waiting for Antigravity.')));
  socket.on('error', (error) => finish(error));
  socket.on('end', () => {
    if (!settled) finish(new Error('Antigravity closed the preview connection without a response.'));
  });
});

const resolveWindowsInstallRoot = (configuredPath) => {
  const resolved = path.resolve(configuredPath);
  let stats;
  try {
    stats = fs.statSync(resolved);
  } catch {
    return null;
  }
  if (stats.isDirectory()) return resolved;

  const basename = path.basename(resolved).toLowerCase();
  if (basename === 'antigravity-ide.cmd' || basename === 'antigravity-ide') {
    return path.resolve(path.dirname(resolved), '..');
  }
  if (basename === 'antigravity ide.exe') return path.dirname(resolved);
  if (basename === 'cli.js') return path.resolve(path.dirname(resolved), '..', '..', '..');
  return null;
};

export const findAntigravityCliInvocation = () => {
  if (process.platform === 'win32') {
    const configuredPath = process.env.ANTIGRAVITY_CLI;
    const installRoot = configuredPath
      ? resolveWindowsInstallRoot(configuredPath)
      : process.env.LOCALAPPDATA
        ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Antigravity IDE')
        : null;
    if (!installRoot) return null;

    const executable = path.join(installRoot, 'Antigravity IDE.exe');
    const cliModule = path.join(installRoot, 'resources', 'app', 'out', 'cli.js');
    if (!fs.existsSync(executable) || !fs.existsSync(cliModule)) return null;

    return {
      command: executable,
      argsPrefix: [cliModule],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    };
  }

  const configuredPath = process.env.ANTIGRAVITY_CLI;
  const candidates = [configuredPath, '/usr/local/bin/antigravity-ide', '/usr/bin/antigravity-ide']
    .filter(Boolean);
  const command = candidates.find((candidate) => fs.existsSync(candidate));
  return command ? { command, argsPrefix: [], env: process.env } : null;
};

const invokeAntigravityUri = (request) => new Promise((resolve, reject) => {
  const invocation = findAntigravityCliInvocation();
  if (!invocation) {
    reject(new Error('Antigravity CLI was not found. Set ANTIGRAVITY_CLI to its full path.'));
    return;
  }

  const uri = `antigravity-ide://${EXTENSION_ID}/open/${encodePreviewRequest(request)}`;
  const child = spawn(invocation.command, [...invocation.argsPrefix, '--open-url', '--', uri], {
    env: invocation.env,
    shell: false,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.once('error', reject);
  child.once('spawn', () => resolve(child));
});

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export const openAntigravityPreview = async (url, workspaceRoot = process.cwd()) => {
  const request = {
    workspaceRoot: normalizeWorkspaceRoot(workspaceRoot),
    url,
  };

  try {
    return await requestPreviewOverPipe(request);
  } catch (initialError) {
    const activationChild = await invokeAntigravityUri(request);

    try {
      const activationDeadline = Date.now() + 30000;
      while (Date.now() < activationDeadline) {
        try {
          return await requestPreviewOverPipe(request, 750);
        } catch {
          await delay(250);
        }
      }
    } finally {
      if (activationChild.exitCode === null && !activationChild.killed) activationChild.kill();
    }

    throw new Error(
      `The Antigravity preview bridge is not active (${initialError.message}). `
      + 'Run npm run dev:editor:install, then reload the Antigravity window once.',
    );
  }
};

export const startAntigravityPreview = async (options) => {
  const workspaceRoot = process.cwd();
  const server = await createServer({
    mode: options.mode,
    server: {
      host: options.host,
      port: options.port,
      strictPort: options.strictPort,
      open: false,
    },
  });

  let url;
  try {
    await server.listen();
    server.printUrls();
    url = resolvePreviewUrl(server, options.host);
  } catch (error) {
    await server.close();
    throw error;
  }

  try {
    await openAntigravityPreview(url, workspaceRoot);
    console.log(`\n  Antigravity editor preview: ${url}\n`);
  } catch (error) {
    console.error(`\n  Antigravity preview was not opened: ${error.message}\n`);
  }

  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await server.close();
  };
  process.once('SIGINT', () => void close());
  process.once('SIGTERM', () => void close());

  return { server, url };
};

const printHelp = () => {
  console.log(`Usage: npm run dev:editor -- [options]

Options:
  --mode <name>       Vite mode (default: web)
  --host <host>       Listening host (default: 127.0.0.1)
  --port <number>     Preferred port; Vite selects the next free port by default
  --strict-port       Fail instead of selecting the next free port
  -h, --help          Show this help`);
};

const isMainModule = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  try {
    const options = parsePreviewArgs(process.argv.slice(2));
    if (options.help) printHelp();
    else await startAntigravityPreview(options);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
