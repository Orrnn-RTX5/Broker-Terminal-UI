/**
 * Resolve harness dependencies without installing anything.
 *
 * The isolated worktree has no node_modules; the original frontend tree does
 * (vite, ws, puppeteer + cached Chromium). Resolution order per package:
 *   1. normal resolution from this worktree
 *   2. original frontend node_modules (read-only reference, never modified)
 *   3. report UNAVAILABLE (caller fails closed — never fake success)
 */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const ORIGINAL_FRONTEND_ROOT = (() => { if (process.env.TRADING_BROWSER_DEPENDENCY_ROOT) return path.resolve(process.env.TRADING_BROWSER_DEPENDENCY_ROOT); try { const common=execFileSync('git',['rev-parse','--git-common-dir'],{encoding:'utf8',windowsHide:true}).trim(); return path.dirname(path.resolve(common)); } catch { return process.cwd(); } })();

const worktreeRequire = createRequire(`${process.cwd()}/package.json`);

const tryResolve = (spec) => {
  try {
    return worktreeRequire.resolve(spec);
  } catch {
    return null;
  }
};

export const dependencySearchPaths = () => {
  const paths = [];
  if (existsSync(ORIGINAL_FRONTEND_ROOT)) paths.push(ORIGINAL_FRONTEND_ROOT);
  return paths;
};

export const resolvePackage = (packageName, subpath = 'package.json') => {
  const direct = tryResolve(subpath === 'package.json' ? `${packageName}/package.json` : `${packageName}/${subpath}`);
  if (direct) return { name: packageName, path: direct, source: 'worktree' };
  for (const root of dependencySearchPaths()) {
    const fallbackRequire = createRequire(`${root}/package.json`);
    try {
      return {
        name: packageName,
        path: fallbackRequire.resolve(subpath === 'package.json' ? `${packageName}/package.json` : `${packageName}/${subpath}`),
        source: `original-frontend:${root}`,
      };
    } catch {
      // keep looking
    }
  }
  return null;
};

export const loadPackage = (packageName) => {
  const resolved = resolvePackage(packageName);
  if (!resolved) return null;
  const loader = resolved.source === 'worktree'
    ? worktreeRequire
    : createRequire(`${ORIGINAL_FRONTEND_ROOT}/package.json`);
  return { ...resolved, module: loader(packageName) };
};

export const findSystemChrome = () => {
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
  ];
  return candidates.find((p) => p && existsSync(p)) || null;
};

/**
 * Resolve a launchable Chromium for puppeteer. Returns
 * { ok:true, puppeteer, executablePath? } or { ok:false, reason }.
 * Never throws for missing deps — the entrypoint prints `reason` and exits 2.
 */
export const resolveChromium = () => {
  const puppeteerPkg = loadPackage('puppeteer');
  if (!puppeteerPkg) {
    const systemChrome = findSystemChrome();
    return {
      ok: false,
      reason:
        'TRADING_BROWSER_UNAVAILABLE: puppeteer is not installed in this worktree or the original frontend node_modules. '
        + `System Chrome fallback: ${systemChrome || 'none found'}. Install dependencies or run from a tree with puppeteer.`,
    };
  }
  return { ok: true, puppeteer: puppeteerPkg.module, source: puppeteerPkg.source };
};

export const resolveVite = () => {
  const vitePkg = loadPackage('vite');
  if (!vitePkg) {
    return {
      ok: false,
      reason:
        'TRADING_BROWSER_UNAVAILABLE: vite is not resolvable from this worktree or the original frontend node_modules. '
        + 'The fixture page needs Vite to transform the actual frontend TypeScript services.',
    };
  }
  return { ok: true, vite: vitePkg.module, source: vitePkg.source };
};
