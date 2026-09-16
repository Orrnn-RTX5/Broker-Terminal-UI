const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const serverLog = fs.openSync(path.join(__dirname, 'vite.log'), 'w');
const server = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--config', path.join(__dirname, 'vite.config.mjs')], {
  cwd: root, windowsHide: true, stdio: ['ignore', serverLog, serverLog],
});
let native;
let serverExited = false;
server.on('exit', () => { serverExited = true; });
const pause = () => new Promise(resolve => setTimeout(resolve, 100));
(async () => {
  const deadline = Date.now() + 30000;
  let ready = false;
  while (Date.now() < deadline) {
    if (serverExited) throw new Error('Own Vite helper exited before becoming ready; see vite.log');
    try { const response = await fetch('http://127.0.0.1:5189/artifacts/desktop-broker-loading-20260915/index.html'); if (response.ok) { ready = true; break; } } catch {}
    await pause();
  }
  if (!ready) throw new Error('Own Vite helper did not become ready');
  const childEnv = { ...process.env };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  native = spawn(path.join(root, 'node_modules/electron/dist/electron.exe'), [path.join(__dirname, 'verify-native.cjs')], {
    cwd: root, env: childEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout = fs.createWriteStream(path.join(__dirname, 'native.stdout.log'));
  const stderr = fs.createWriteStream(path.join(__dirname, 'native.stderr.log'));
  native.stdout.pipe(stdout);
  native.stderr.pipe(stderr);
  const exitCode = await new Promise(resolve => native.on('exit', resolve));
  if (exitCode !== 0) throw new Error('Native fixture failed; see native-verification.json');
  console.log(fs.readFileSync(path.join(__dirname, 'native-verification.json'), 'utf8'));
})().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => {
  if (native && native.exitCode === null) native.kill();
  // Only the exact helper process spawned by this run is stopped.
  if (!serverExited) server.kill();
  await pause();
  fs.closeSync(serverLog);
});
