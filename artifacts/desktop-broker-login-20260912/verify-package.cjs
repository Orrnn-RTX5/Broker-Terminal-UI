const { extractFile } = require('@electron/asar');
const { readFileSync, writeFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const archive = path.join(root, 'draft/win-unpacked/resources/app.asar');
const html = readFileSync(path.join(root, 'dist/index.html'), 'utf8');
const entry = html.match(/src="([^"]*index-[^"]+\.js)"/);
assert.ok(entry, 'Built entry script exists');
const files = ['dist/index.html', 'preload.cjs', path.posix.join('dist', entry[1])];
for (const file of files) {
  assert.ok(extractFile(archive, path.normalize(file)).equals(readFileSync(path.join(root, file))), `Packaged ${file} matches the verified build`);
}
const version = JSON.parse(readFileSync(path.join(root, 'package.json'))).version;
const installer = `draft/RTX.Terminal.Setup.${version}.exe`;
const bytes = readFileSync(path.join(root, installer));
assert.equal(bytes.subarray(0, 2).toString(), 'MZ');
const result = { packagedFilesMatch: true, files, installer, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
writeFileSync(path.join(__dirname, 'package-verification.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
