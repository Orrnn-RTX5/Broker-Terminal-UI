import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findAntigravityCliInvocation } from './startAntigravityPreview.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const extensionDirectory = path.join(projectRoot, 'tools', 'antigravity-preview-bridge');
const vsixPath = path.join(os.tmpdir(), `rtx5-antigravity-preview-bridge-${process.pid}.vsix`);
const bundledNpxModule = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
const npxInvocation = fs.existsSync(bundledNpxModule)
  ? { command: process.execPath, argsPrefix: [bundledNpxModule], shell: false }
  : {
      command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
      argsPrefix: [],
      shell: process.platform === 'win32',
    };
const antigravityCli = findAntigravityCliInvocation();

if (!antigravityCli) {
  throw new Error('Antigravity CLI was not found. Set ANTIGRAVITY_CLI to its full path.');
}

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32' && command.endsWith('.cmd'),
    stdio: 'inherit',
    windowsHide: true,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${path.basename(command)} exited with code ${result.status}.`);
  }
};

try {
  run(npxInvocation.command, [
    ...npxInvocation.argsPrefix,
    '--yes',
    '@vscode/vsce@3.9.2',
    'package',
    '--no-dependencies',
    '--allow-missing-repository',
    '--out',
    vsixPath,
  ], { cwd: extensionDirectory, shell: npxInvocation.shell });
  run(
    antigravityCli.command,
    [...antigravityCli.argsPrefix, '--install-extension', vsixPath, '--force'],
    { env: antigravityCli.env, shell: false },
  );
  console.log('\nRTX5 Antigravity Preview Bridge installed.');
  console.log('If this Antigravity window was already open, reload it once before the first dev:editor run.');
} finally {
  if (fs.existsSync(vsixPath)) fs.unlinkSync(vsixPath);
}
