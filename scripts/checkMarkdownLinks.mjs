import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const workspaceRoot = process.cwd();
const docsRoot = path.join(workspaceRoot, 'docs');

const normalizePath = (value) => path.relative(workspaceRoot, value).replaceAll('\\', '/');

const walkMarkdown = (directory) => {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const absolutePath = path.join(directory, entry.name);
      return entry.isDirectory()
        ? walkMarkdown(absolutePath)
        : entry.name.toLowerCase().endsWith('.md') ? [absolutePath] : [];
    });
};

const rootMarkdown = fs.readdirSync(workspaceRoot, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
  .sort((left, right) => left.name.localeCompare(right.name))
  .map((entry) => path.join(workspaceRoot, entry.name));

const markdownFiles = [...rootMarkdown, ...walkMarkdown(docsRoot)];
const ignoredTarget = (target) => target === ''
  || target.startsWith('#')
  || target.startsWith('//')
  || /^[a-z][a-z\d+.-]*:/i.test(target);

const readInlineTargets = (line) => {
  const targets = [];
  for (let index = 0; index < line.length - 1; index += 1) {
    if (line[index] !== ']' || line[index + 1] !== '(') continue;

    let cursor = index + 2;
    while (/\s/.test(line[cursor] ?? '')) cursor += 1;
    const startsWithAngleBracket = line[cursor] === '<';
    if (startsWithAngleBracket) cursor += 1;

    const start = cursor;
    let nestedParentheses = 0;
    let escaped = false;
    while (cursor < line.length) {
      const character = line[cursor];
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (startsWithAngleBracket && character === '>') {
        break;
      } else if (!startsWithAngleBracket && character === '(') {
        nestedParentheses += 1;
      } else if (!startsWithAngleBracket && character === ')') {
        if (nestedParentheses === 0) break;
        nestedParentheses -= 1;
      } else if (!startsWithAngleBracket && nestedParentheses === 0 && /\s/.test(character)) {
        break;
      }
      cursor += 1;
    }

    targets.push({ column: index + 1, target: line.slice(start, cursor) });
  }
  return targets;
};

const stripQueryAndFragment = (target) => {
  const boundary = target.search(/[?#]/);
  return boundary === -1 ? target : target.slice(0, boundary);
};

const problems = [];
let checkedLinks = 0;

for (const markdownFile of markdownFiles) {
  const lines = fs.readFileSync(markdownFile, 'utf8').split(/\r?\n/);
  let fence = null;

  for (const [lineIndex, line] of lines.entries()) {
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      fence = fence === null ? marker : fence === marker ? null : fence;
      continue;
    }
    if (fence !== null) continue;

    const inlineTargets = readInlineTargets(line);
    const definitionMatch = /^\s{0,3}\[[^\]]+\]:\s*(?:<([^>]+)>|(\S+))/.exec(line);
    const targets = definitionMatch
      ? [...inlineTargets, { column: definitionMatch.index + 1, target: definitionMatch[1] ?? definitionMatch[2] }]
      : inlineTargets;

    for (const { column, target: rawTarget } of targets) {
      const target = rawTarget.replaceAll('\\ ', ' ');
      if (ignoredTarget(target)) continue;
      checkedLinks += 1;

      let decodedTarget;
      try {
        decodedTarget = decodeURIComponent(stripQueryAndFragment(target));
      } catch {
        problems.push({
          file: normalizePath(markdownFile),
          line: lineIndex + 1,
          column,
          target,
          reason: 'invalid URL encoding',
        });
        continue;
      }

      const resolvedPath = decodedTarget.startsWith('/')
        ? path.resolve(workspaceRoot, `.${decodedTarget}`)
        : path.resolve(path.dirname(markdownFile), decodedTarget);
      const relativeResolvedPath = path.relative(workspaceRoot, resolvedPath);
      const outsideWorkspace = relativeResolvedPath === '..'
        || relativeResolvedPath.startsWith(`..${path.sep}`)
        || path.isAbsolute(relativeResolvedPath);

      if (outsideWorkspace || !fs.existsSync(resolvedPath)) {
        problems.push({
          file: normalizePath(markdownFile),
          line: lineIndex + 1,
          column,
          target,
          reason: outsideWorkspace ? 'outside repository' : 'target does not exist',
        });
      }
    }
  }
}

if (problems.length > 0) {
  console.error(`Broken local Markdown links: ${problems.length}`);
  for (const problem of problems) {
    console.error(`${problem.file}:${problem.line}:${problem.column} ${problem.target} (${problem.reason})`);
  }
  process.exitCode = 1;
} else {
  console.log(`Markdown links are valid: ${checkedLinks} local links across ${markdownFiles.length} files.`);
}
