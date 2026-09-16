#!/usr/bin/env node
'use strict';

// Run after build:electron and electron-builder finish. This reads the package
// and workspace; its only write is the verification JSON beside this script.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const asar = require('@electron/asar');

const workspace = path.resolve(__dirname, '../..');
const checkInstalled = process.argv.includes('--installed');
const reportPath = path.join(__dirname, checkInstalled
  ? 'verify-package-installed.json'
  : 'verify-package.json');
const draftPath = path.join(workspace, 'draft/win-unpacked/resources/app.asar');
const report = {
  checkedAt: new Date().toISOString(),
  passed: false,
  workspace,
  draft: null,
  files: [],
  tokens: [],
  checks: [],
  errors: [],
};

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function archived(archivePath, relativePath) {
  return asar.extractFile(archivePath, path.normalize(relativePath));
}

function packageDetails(archivePath) {
  const bytes = fs.readFileSync(archivePath);
  const metadata = JSON.parse(archived(archivePath, 'package.json').toString('utf8'));
  return {
    path: archivePath,
    bytes: bytes.length,
    sha256: sha256(bytes),
    version: metadata.version,
    modifiedAt: fs.statSync(archivePath).mtime.toISOString(),
  };
}

function cssFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return cssFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.css') ? [entryPath] : [];
  });
}

function recordCheck(name, passed) {
  report.checks.push({ name, passed });
}

function normalizeCssValue(value) {
  return value.replace(/["']/g, '').replace(/\s+/g, '').toLowerCase();
}

try {
  const unknownArguments = process.argv.slice(2).filter((argument) => argument !== '--installed');
  if (unknownArguments.length) throw new Error('Usage: node verify-package.cjs [--installed]');

  report.draft = packageDetails(draftPath);
  report.workspaceVersion = JSON.parse(fs.readFileSync(path.join(workspace, 'package.json'), 'utf8')).version;
  recordCheck('Draft version matches workspace', report.draft.version === report.workspaceVersion);

  const stylesheets = cssFiles(path.join(workspace, 'dist')).sort();
  recordCheck('Current dist includes CSS', stylesheets.length > 0);
  const filePaths = [
    'dist/index.html',
    ...stylesheets.map((file) => path.relative(workspace, file).replaceAll('\\', '/')),
    'electron.cjs',
    'electron-network.cjs',
    'preload.cjs',
  ];
  const packagedStyles = [];

  for (const relativePath of filePaths) {
    const expected = fs.readFileSync(path.join(workspace, relativePath));
    const result = {
      path: relativePath,
      workspaceBytes: expected.length,
      workspaceSha256: sha256(expected),
      packageBytes: null,
      packageSha256: null,
      matches: false,
    };
    try {
      const actual = archived(draftPath, relativePath);
      result.packageBytes = actual.length;
      result.packageSha256 = sha256(actual);
      result.matches = expected.equals(actual);
      if (relativePath.endsWith('.css')) packagedStyles.push(actual.toString('utf8'));
    } catch (error) {
      result.error = error.message;
    }
    report.files.push(result);
  }
  recordCheck('Every requested workspace file matches packaged bytes', report.files.every((file) => file.matches));

  const bundle = packagedStyles.join('\n');
  const tokenGroups = [
    {
      source: 'src/styles/app-typography.css',
      names: [
        '--rtx-ui-font-family',
        '--rtx-ui-font-size',
        '--rtx-font-weight-body',
        '--rtx-font-weight-control',
        '--rtx-font-weight-heading',
      ],
    },
    {
      source: 'src/styles/enterprise-light.css',
      names: [
        '--rtx-light-text',
        '--rtx-light-text-secondary',
        '--rtx-light-text-muted',
        '--rtx-light-price',
        '--rtx-light-quote-up',
        '--rtx-light-quote-down',
        '--rtx-light-accent',
        '--rtx-light-buy',
        '--rtx-light-sell',
      ],
    },
  ];
  for (const group of tokenGroups) {
    const source = fs.readFileSync(path.join(workspace, group.source), 'utf8');
    for (const token of group.names) {
      const expected = source.match(new RegExp(`${token}\\s*:\\s*([^;}]+)`))?.[1].trim();
      const values = [...bundle.matchAll(new RegExp(`${token}\\s*:\\s*([^;}]+)`, 'g'))]
        .map((match) => match[1].trim());
      const present = expected !== undefined && values.some((value) =>
        normalizeCssValue(value) === normalizeCssValue(expected));
      report.tokens.push({ token, source: group.source, expected, packagedValues: [...new Set(values)], present });
    }
  }
  recordCheck('Current source typography and light palette tokens are present', report.tokens.every((token) => token.present));
  recordCheck('Shared typography layer is present', /@layer\s+rtx-typography\b/.test(bundle));

  if (checkInstalled) {
    if (!process.env.LOCALAPPDATA) throw new Error('LOCALAPPDATA is required to locate the installed desktop app.');
    const installedPath = path.join(process.env.LOCALAPPDATA, 'Programs/rtx-terminal/resources/app.asar');
    report.installed = packageDetails(installedPath);
    recordCheck('Installed archive SHA256 matches draft', report.installed.sha256 === report.draft.sha256);
    recordCheck('Installed package version matches draft', report.installed.version === report.draft.version);
  }
} catch (error) {
  report.errors.push(error.message);
}

report.passed = report.errors.length === 0 && report.checks.length > 0
  && report.checks.every((check) => check.passed);
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  passed: report.passed,
  reportPath,
  filesChecked: report.files.length,
  tokensChecked: report.tokens.length,
  checks: report.checks,
  errors: report.errors,
}, null, 2));
process.exitCode = report.passed ? 0 : 1;
