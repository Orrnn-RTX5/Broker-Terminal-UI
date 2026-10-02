import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import ts from 'typescript';

const workspaceRoot = process.cwd();
const sourceRoot = path.join(workspaceRoot, 'src');
const baselinePath = path.join(workspaceRoot, 'config', 'architecture-baseline.json');

const normalizePath = (value) => path.relative(workspaceRoot, value).replaceAll('\\', '/');
const isTestFile = (file) => /\.(test|spec)\.(?:[cm]?[jt]sx?)$/.test(file)
  || /[\\/](?:test|tests|__tests__)[\\/]/.test(file);
const isCodeFile = (file) => /\.(?:[cm]?[jt]sx?)$/.test(file);

const walk = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const absolutePath = path.join(directory, entry.name);
  return entry.isDirectory() ? walk(absolutePath) : [absolutePath];
});

const allSourceFiles = walk(sourceRoot);
const moduleFiles = allSourceFiles.filter((file) => isCodeFile(file) && !isTestFile(file));
const knownModules = new Set(moduleFiles.map((file) => path.normalize(file)));
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const failures = [];

const resolveModule = (fromFile, specifier) => {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.mjs`,
    `${base}.cjs`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
    path.join(base, 'index.js'),
    path.join(base, 'index.jsx'),
  ];
  return candidates.map((candidate) => path.normalize(candidate)).find((candidate) => knownModules.has(candidate)) ?? null;
};

const importHasRuntimeValue = (node) => {
  const clause = node.importClause;
  if (!clause || clause.isTypeOnly) return false;
  if (clause.name) return true;
  const bindings = clause.namedBindings;
  if (!bindings) return false;
  if (ts.isNamespaceImport(bindings)) return true;
  return bindings.elements.some((element) => !element.isTypeOnly);
};

const buildGraph = (includeTypes) => {
  const graph = new Map(moduleFiles.map((file) => [path.normalize(file), []]));
  for (const file of moduleFiles) {
    const sourceFile = ts.createSourceFile(
      file,
      fs.readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.getScriptKindFromFileName(file),
    );
    for (const statement of sourceFile.statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
        if (!includeTypes && !importHasRuntimeValue(statement)) continue;
        const target = resolveModule(file, statement.moduleSpecifier.text);
        if (target) graph.get(path.normalize(file)).push(target);
      } else if (
        ts.isExportDeclaration(statement)
        && statement.moduleSpecifier
        && ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        if (!includeTypes && statement.isTypeOnly) continue;
        const target = resolveModule(file, statement.moduleSpecifier.text);
        if (target) graph.get(path.normalize(file)).push(target);
      }
    }
  }
  return graph;
};

const findStronglyConnectedComponents = (graph) => {
  let index = 0;
  const indexes = new Map();
  const lowLinks = new Map();
  const stack = [];
  const onStack = new Set();
  const components = [];

  const visit = (node) => {
    indexes.set(node, index);
    lowLinks.set(node, index);
    index += 1;
    stack.push(node);
    onStack.add(node);

    for (const target of graph.get(node) ?? []) {
      if (!indexes.has(target)) {
        visit(target);
        lowLinks.set(node, Math.min(lowLinks.get(node), lowLinks.get(target)));
      } else if (onStack.has(target)) {
        lowLinks.set(node, Math.min(lowLinks.get(node), indexes.get(target)));
      }
    }

    if (lowLinks.get(node) !== indexes.get(node)) return;
    const component = [];
    let current;
    do {
      current = stack.pop();
      onStack.delete(current);
      component.push(current);
    } while (current !== node);

    if (component.length > 1 || (graph.get(node) ?? []).includes(node)) {
      components.push(component);
    }
  };

  for (const node of graph.keys()) {
    if (!indexes.has(node)) visit(node);
  }
  return components;
};

const cycleKey = (component) => component.map(normalizePath).sort().join('|');
const runtimeCycles = findStronglyConnectedComponents(buildGraph(false));
for (const cycle of runtimeCycles) {
  failures.push(`runtime dependency cycle: ${cycleKey(cycle)}`);
}

const allowedTypeCycles = new Set(baseline.allowedTypeCycles);
const typeCycles = findStronglyConnectedComponents(buildGraph(true));
const currentTypeCycleKeys = new Set(typeCycles.map(cycleKey));
for (const cycle of typeCycles) {
  const key = cycleKey(cycle);
  if (!allowedTypeCycles.has(key)) failures.push(`new type dependency cycle: ${key}`);
}
for (const key of allowedTypeCycles) {
  if (!currentTypeCycleKeys.has(key)) failures.push(`stale allowed type dependency cycle: ${key}`);
}

if (failures.length > 0) {
  console.error('Architecture guard failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `Architecture guard passed (${moduleFiles.length} production modules, ${runtimeCycles.length} runtime cycles, ${typeCycles.length} allowed type cycles).`,
  );
}
