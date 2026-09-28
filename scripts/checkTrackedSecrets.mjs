import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const workspaceRoot = process.cwd();
const tracked = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
  cwd: workspaceRoot,
  encoding: 'utf8',
});

if (tracked.status !== 0) {
  console.error('Unable to enumerate tracked and pending repository files for the secret scan.');
  process.exit(1);
}

const credentialKey = /(?:TOKEN|SECRET|PASSWORD|PASSCODE|PRIVATE_KEY|CLIENT_SECRET|API_KEY)$/i;
const safePlaceholder = /^(?:|change-?me|example|placeholder|replace-?me|your[-_].*|<.*>)$/i;
const findings = [];

for (const relativePath of tracked.stdout.split('\0').filter(Boolean)) {
  const absolutePath = path.join(workspaceRoot, relativePath);
  if (!fs.existsSync(absolutePath) || fs.statSync(absolutePath).size > 2_000_000) continue;

  let source;
  try {
    source = fs.readFileSync(absolutePath, 'utf8');
  } catch {
    continue;
  }

  source.split(/\r?\n/).forEach((line, index) => {
    const match = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || !credentialKey.test(match[1])) return;
    const value = match[2].replace(/^['"]|['"]$/g, '').trim();
    if (safePlaceholder.test(value)) return;
    findings.push(`${relativePath}:${index + 1} contains a non-placeholder credential value for ${match[1]}`);
  });

  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(source)) {
    findings.push(`${relativePath} contains a private key block`);
  }
}

if (findings.length > 0) {
  console.error('Tracked-secret guard failed:');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log('Tracked-secret guard passed.');
}
