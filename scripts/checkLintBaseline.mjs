import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { ESLint } from 'eslint';

const workspaceRoot = process.cwd();
const baselinePath = path.join(workspaceRoot, 'config', 'lint-baseline.json');
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const eslint = new ESLint();
const results = await eslint.lintFiles(['.']);

const current = {
  errors: 0,
  warnings: 0,
  rules: {},
};

for (const result of results) {
  current.errors += result.errorCount;
  current.warnings += result.warningCount;
  for (const message of result.messages) {
    const ruleId = message.ruleId ?? 'fatal/parse';
    current.rules[ruleId] = (current.rules[ruleId] ?? 0) + 1;
  }
}

const failures = [];
if (current.errors > baseline.errors) {
  failures.push(`errors increased from ${baseline.errors} to ${current.errors}`);
} else if (current.errors < baseline.errors) {
  failures.push(`lint baseline is stale; lower errors from ${baseline.errors} to ${current.errors}`);
}
if (current.warnings > baseline.warnings) {
  failures.push(`warnings increased from ${baseline.warnings} to ${current.warnings}`);
} else if (current.warnings < baseline.warnings) {
  failures.push(`lint baseline is stale; lower warnings from ${baseline.warnings} to ${current.warnings}`);
}
for (const [ruleId, count] of Object.entries(current.rules)) {
  const allowed = baseline.rules[ruleId] ?? 0;
  if (count > allowed) failures.push(`${ruleId} increased from ${allowed} to ${count}`);
}
for (const [ruleId, allowed] of Object.entries(baseline.rules)) {
  const count = current.rules[ruleId] ?? 0;
  if (count < allowed) failures.push(`lint baseline is stale; lower ${ruleId} from ${allowed} to ${count}`);
}

if (failures.length > 0) {
  console.error('Lint ratchet failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Lint ratchet passed (${current.errors} errors, ${current.warnings} warnings; no new debt).`);
}
