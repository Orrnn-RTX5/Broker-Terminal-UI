import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createWebRuntimeConfig, renderWebRuntimeConfig } from '../../viteWebRuntimeConfig';

const directories: string[] = [];
const shell = process.platform === 'win32'
  ? join(process.env.ProgramFiles || 'C:/Program Files', 'Git/bin/bash.exe')
  : '/bin/sh';
afterEach(() => {
  for (const directory of directories.splice(0)) {
    if (!directory.startsWith(join(tmpdir(), 'rtx-docker-env-test-'))) throw new Error('Unexpected test directory');
    rmSync(directory, { recursive: true, force: true });
  }
});

const builtHtml = `<!doctype html><html><head><meta charset="UTF-8">
<script src="./runtime-config.js"></script>
<script>window.configAtBootstrap = window.RUNTIME_CONFIG.BROKER_ID;</script>
<script type="module" crossorigin src="./assets/index-AbCd1234.js"></script>
<link rel="stylesheet" crossorigin href="./assets/index-AbCd1234.css">
</head><body><div id="root"></div></body></html>`;

const createContainer = (buildEnv: Record<string, string> = {}, template = builtHtml) => {
  const directory = mkdtempSync(join(tmpdir(), 'rtx-docker-env-test-'));
  directories.push(directory);
  const path = join(directory, 'runtime-config.js');
  const built = renderWebRuntimeConfig(createWebRuntimeConfig({
    VITE_BROKER_ID: 'TEST', VITE_BACKEND_URL: 'https://fxtrustbrokerbackend.orrnn.com',
    ...buildEnv,
  }));
  writeFileSync(path, built);
  const templatePath = join(directory, 'index.template.html');
  const indexPath = join(directory, 'index.html');
  writeFileSync(templatePath, template);
  writeFileSync(indexPath, template);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(NGINX_|RTX_RUNTIME_|VITE_|BACKEND_|API_|WS_|BROKER_|FEED_|DISCOVERY_|DEFAULT_MT5_|SHARED_DISCOVERY_|USE_MOCK_)/.test(key)));
  const start = (overrides: Record<string, string> = {}) => {
    execFileSync(shell, [resolve('docker-entrypoint.sh').replace(/\\/g, '/')], {
      env: {
        ...env,
        NGINX_HTML_DIR: directory.replace(/\\/g, '/'),
        NGINX_INDEX_TEMPLATE: templatePath.replace(/\\/g, '/'),
        NGINX_INLINE_HELPER: resolve('docker-inline-runtime-config.awk').replace(/\\/g, '/'),
        ...overrides,
      },
      encoding: 'utf8', timeout: process.platform === 'win32' ? 60000 : 10000, stdio: 'pipe',
    });
    return { built, source: readFileSync(path, 'utf8'), html: readFileSync(indexPath, 'utf8') };
  };
  return { start, directory, templatePath, indexPath, configPath: path };
};

const generate = (overrides: Record<string, string> = {}) => createContainer().start(overrides);

const inlineScript = (html: string): string => {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  expect(parsed.querySelector('script[src$="/runtime-config.js"]')).toBeNull();
  expect(parsed.querySelectorAll('#rtx-runtime-config')).toHaveLength(1);
  expect(parsed.querySelectorAll('script')).toHaveLength(3);
  expect(parsed.querySelector('[data-injected]')).toBeNull();
  return parsed.querySelector('#rtx-runtime-config')!.textContent!;
};

const evaluate = (source: string) => {
  const runtimeWindow: Record<string, any> = { location: { protocol: 'https:' } };
  new Function('window', 'navigator', source)(runtimeWindow, { userAgent: 'Mozilla/5.0' });
  return runtimeWindow;
};

describe.skipIf(!existsSync(shell))('container broker environment', {
  timeout: process.platform === 'win32' ? 90000 : 10000,
}, () => {
  it('preserves the .env.web build when no broker override is supplied', () => {
    const { built, source, html } = generate();
    expect(source).toBe(built);
    expect(inlineScript(html)).toBe(`\n${built}`);
    expect(evaluate(inlineScript(html)).RUNTIME_CONFIG.BROKER_ID).toBe('TEST');
    expect(html.indexOf('id="rtx-runtime-config"')).toBeLessThan(html.indexOf('window.configAtBootstrap'));
    expect(html).toContain('src="./assets/index-AbCd1234.js"');
    expect(html).toContain('href="./assets/index-AbCd1234.css"');
  });
  it('also supports a root-relative runtime script for root-hosted builds', () => {
    const template = builtHtml.replaceAll('"./', '"/');
    const { built, source, html } = createContainer({}, template).start();
    expect(source).toBe(built);
    expect(evaluate(inlineScript(html)).RUNTIME_CONFIG.BROKER_ID).toBe('TEST');
    expect(html).toContain('src="/assets/index-AbCd1234.js"');
  });
  it('preserves surrounding HTML line endings from a Windows Vite build', () => {
    const template = builtHtml.replace(/\n/g, '\r\n');
    const { html } = createContainer({}, template).start();
    inlineScript(html);
    const restored = html.replace(/<script id="rtx-runtime-config">[\s\S]*?<\/script>/,
      '<script src="./runtime-config.js"></script>');
    expect(restored.trimEnd()).toBe(template.trimEnd());
  });
  it('sets complete broker identity for an explicit deployment override', () => {
    const { source, html } = generate({
      BROKER_ID: 'achiever-financials', API_HOST: 'https://service.achieverfinancials.com',
      WS_HOST: 'wss://service.achieverfinancials.com', DEFAULT_MT5_SERVER: 'Achiever Financials',
    });
    expect(inlineScript(html)).toBe(`\n${source}`);
    const runtimeWindow = evaluate(inlineScript(html));
    expect(runtimeWindow.RUNTIME_CONFIG).toMatchObject({
      BROKER_ID: 'achiever-financials', VITE_BROKER_ID: 'achiever-financials', FEED_BROKER_ID: 'achiever-financials',
      API_HOST: 'https://service.achieverfinancials.com', DEFAULT_MT5_SERVER: 'Achiever Financials',
    });
    runtimeWindow.location.protocol = 'file:';
    runtimeWindow.RUNTIME_CONFIG = { selectedByDesktop: true };
    new Function('window', 'navigator', source)(runtimeWindow, { userAgent: 'Electron' });
    expect(runtimeWindow.RUNTIME_CONFIG).toEqual({ selectedByDesktop: true });
  });

  it('escapes hostile broker strings and preserves multiline/control characters', () => {
    const hostile = `broker'\\"</ScRiPt><script data-injected>window.injected=true</script><!--\r\n\t\b\f\u0001\u2028\u2029\n`;
    const { source, html } = generate({
      BROKER_ID: hostile, API_HOST: 'https://example.test', DEFAULT_MT5_SERVER: hostile,
    });
    expect(source).not.toContain('<');
    const runtimeWindow = evaluate(inlineScript(html));
    expect(runtimeWindow.RUNTIME_CONFIG.BROKER_ID).toBe(hostile);
    expect(runtimeWindow.RUNTIME_CONFIG.DEFAULT_MT5_SERVER).toBe(hostile);
    expect(runtimeWindow.injected).toBeUndefined();
  });

  it('safely embeds hostile values preserved from the Vite build', () => {
    const hostile = `broker'</SCRIPT><script data-injected>bad()</script><!--`;
    const { html } = createContainer({ VITE_BROKER_ID: hostile }).start();
    expect(evaluate(inlineScript(html)).RUNTIME_CONFIG.BROKER_ID).toBe(hostile);
  });

  it('restarts from the pristine template and applies the latest override once', () => {
    const container = createContainer();
    const first = container.start({ BROKER_ID: 'first', API_HOST: 'https://first.test' });
    expect(evaluate(inlineScript(first.html)).RUNTIME_CONFIG.BROKER_ID).toBe('first');
    const second = container.start({ BROKER_ID: 'second', API_HOST: 'https://second.test' });
    expect(evaluate(inlineScript(second.html)).RUNTIME_CONFIG).toMatchObject({
      BROKER_ID: 'second', API_HOST: 'https://second.test',
    });
    expect(second.html).not.toContain('https://first.test');
    expect(container.start().html).toBe(second.html);
    expect(readFileSync(container.templatePath, 'utf8')).toBe(builtHtml);
  });

  it.each(['missing', 'duplicate'] as const)('fails before publishing a %s script marker', (kind) => {
    const container = createContainer();
    const initial = container.start();
    const script = '<script src="./runtime-config.js"></script>';
    writeFileSync(container.templatePath, kind === 'missing'
      ? builtHtml.replace(script, '')
      : builtHtml.replace(script, `${script}${script}`));
    expect(() => container.start({ BROKER_ID: 'wrong', API_HOST: 'https://wrong.test' }))
      .toThrow(/exactly one external runtime-config.js script/);
    expect(readFileSync(container.indexPath, 'utf8')).toBe(initial.html);
    expect(readFileSync(container.configPath, 'utf8')).toBe(initial.source);
    expect(readdirSync(container.directory).filter(name => name.startsWith('.'))).toEqual([]);
  }, 60000);

  it('fails clearly when the pristine template is missing', () => {
    const container = createContainer();
    rmSync(container.templatePath);
    expect(() => container.start()).toThrow(/missing readable index template/);
    expect(readFileSync(container.indexPath, 'utf8')).toBe(builtHtml);
  });

  it('rejects unexpected unsafe preserved source without publishing HTML', () => {
    const container = createContainer();
    writeFileSync(container.configPath, 'window.RUNTIME_CONFIG = { BROKER_ID: "</script><script>bad()</script>" };');
    expect(() => container.start()).toThrow(/unsafe HTML script delimiter/);
    expect(readFileSync(container.indexPath, 'utf8')).toBe(builtHtml);
  });
});
