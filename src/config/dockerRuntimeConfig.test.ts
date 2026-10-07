import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createWebRuntimeConfig, renderWebRuntimeConfig } from '../../viteWebRuntimeConfig';

const directories: string[] = [];
const shell = process.platform === 'win32'
  ? join(process.env.ProgramFiles || 'C:/Program Files', 'Git/bin/bash.exe') : '/bin/sh';
// Git Bash startup shares the existing 60-second Windows child-process budget.
const containerTestTimeoutMs = process.platform === 'win32' ? 90000 : 10000;
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
const profile = {
  API_HOST: 'https://api.independent-broker.test', WS_HOST: 'wss://api.independent-broker.test',
  BROKER_ID: 'independent-broker', DEFAULT_MT5_SERVER: 'Independent Broker Trading',
};
const createContainer = (template = builtHtml) => {
  const directory = mkdtempSync(join(tmpdir(), 'rtx-docker-env-test-'));
  directories.push(directory);
  const path = join(directory, 'runtime-config.js');
  // This same image fixture deliberately contains another compiled broker.
  const built = renderWebRuntimeConfig(createWebRuntimeConfig({
    VITE_BROKER_ID: 'Orrnn', VITE_BACKEND_URL: 'https://service.orrnn.com',
    VITE_WS_HOST: 'wss://service.orrnn.com', VITE_DEFAULT_MT5_SERVER: 'Orrnn',
    VITE_DISCOVERY_BASE_URL: 'https://old-directory.orrnn.com',
  }));
  writeFileSync(path, built);
  const runtimeTemplatePath = join(directory, 'runtime-config.template.js');
  writeFileSync(runtimeTemplatePath, built);
  const templatePath = join(directory, 'index.template.html');
  const indexPath = join(directory, 'index.html');
  writeFileSync(templatePath, template);
  writeFileSync(indexPath, template);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(NGINX_|RTX_RUNTIME_|TERMINAL_QUOTE_FRESHNESS$|VITE_|BACKEND_|API_|WS_|BROKER_|FEED_|DISCOVERY_|DEFAULT_MT5_|SHARED_DISCOVERY_|USE_MOCK_|PUBLIC_CANDLE_|FIX_|RTX5_|MARKET_WS_)/.test(key)));
  const start = (overrides: Record<string, string> = {}) => {
    execFileSync(shell, [resolve('docker-entrypoint.sh').replace(/\\/g, '/')], {
      env: {
        ...env, NGINX_HTML_DIR: directory.replace(/\\/g, '/'),
        NGINX_INDEX_TEMPLATE: templatePath.replace(/\\/g, '/'),
        NGINX_RUNTIME_CONFIG_TEMPLATE: runtimeTemplatePath.replace(/\\/g, '/'),
        NGINX_INLINE_HELPER: resolve('docker-inline-runtime-config.awk').replace(/\\/g, '/'), ...overrides,
      },
      encoding: 'utf8', timeout: process.platform === 'win32' ? 60000 : 10000, stdio: 'pipe',
    });
    return { built, source: readFileSync(path, 'utf8'), html: readFileSync(indexPath, 'utf8') };
  };
  return { start, directory, templatePath, runtimeTemplatePath, indexPath, configPath: path };
};
const generate = (overrides: Record<string, string> = {}) => createContainer().start({ ...profile, ...overrides });
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

describe('Docker runtime image contract', () => {
  it.each(['', 'VITE_'])('takes optional public presentation from %s env aliases while excluding secrets', prefix => {
    const generated = generate({
      [`${prefix}BROKER_LOGIN_HERO_URL`]: 'https://cdn.unknown.example/hero.webp?v=2',
      [`${prefix}BROKER_LOGIN_HERO_MOBILE_URL`]: 'https://cdn.unknown.example/mobile.jpg',
      [`${prefix}BROKER_TERMS_URL`]: 'https://registered-broker.example/terms',
      MANAGER_PASSWORD: 'DO_NOT_EXPOSE_MANAGER_PASSWORD', PRIVATE_KEY: 'DO_NOT_EXPOSE_KEY',
      VITE_ADMIN_PASSWORD: 'DO_NOT_EXPOSE_ADMIN_PASSWORD',
    });
    const config = evaluate(generated.source).__RTX_RUNTIME_CONFIG__;
    expect(config.BROKER_LOGIN_HERO_URL).toBe('https://cdn.unknown.example/hero.webp?v=2');
    expect(config.BROKER_LOGIN_HERO_MOBILE_URL).toBe('https://cdn.unknown.example/mobile.jpg');
    expect(config.BROKER_TERMS_URL).toBe('https://registered-broker.example/terms');
    expect(generated.source).not.toContain('DO_NOT_EXPOSE');
  }, containerTestTimeoutMs);
  it.each(['BROKER_LOGIN_HERO_URL', 'BROKER_LOGIN_HERO_MOBILE_URL', 'BROKER_TERMS_URL'])('rejects credential-bearing or insecure %s before startup', key => {
    expect(() => generate({ [key]: 'https://user:secret@cdn.example/asset' })).toThrow();
    expect(() => generate({ [key]: 'http://cdn.example/asset' })).toThrow();
  }, 30_000);
  it('keeps pristine HTML but never installs a compiled broker runtime template', () => {
    const dockerfile = readFileSync(resolve('Dockerfile'), 'utf8');
    expect(dockerfile).toContain('COPY --from=build /app/dist/index.html /etc/nginx/rtx-index.template.html');
    expect(dockerfile).not.toContain('/etc/nginx/rtx-runtime-config.template.js');
  });
  it('forwards deployment env through Compose without fixed broker overrides', () => {
    const compose = readFileSync(resolve('docker-compose.yml'), 'utf8');
    expect(compose).toContain('env_file:');
    expect(compose).toContain('${BROKER_ENV_FILE:-.env}');
    expect(compose).not.toMatch(/service\.orrnn\.com|superadmin-prod\.orrnn\.com|BROKER_ID=Orrnn|rtx5\.broker_id=orrnn|webterminal\.orrnn\.com/);
  });
  it('requires deployment env and removes unrelated broker CORS hardcoding', () => {
    const workflow = readFileSync(resolve('.github/workflows/deploy.yml'), 'utf8');
    const deploy = readFileSync(resolve('.github/scripts/deploy-broker-ui.sh'), 'utf8');
    expect(workflow).toContain('complete per-broker runtime environment is required');
    expect(workflow).not.toContain('--label "rtx5.domain=webterminal.orrnn.com"');
    expect(deploy).toContain('if (\\$http_origin = "https://${domain}")');
    expect(deploy).not.toContain('growtradingacademy');
    expect(deploy).toContain('complete per-broker .env object is required');
  });
  it('prevents caching browser runtime config', () => {
    const nginx = readFileSync(resolve('nginx.conf'), 'utf8');
    expect(nginx).toContain('location = /runtime-config.js');
    expect(nginx).toContain('location = /runtime-config-validator.js');
    expect(nginx).toContain('no-store, no-cache, must-revalidate, proxy-revalidate');
  });
});

describe.skipIf(!existsSync(shell))('container broker environment', {
  timeout: containerTestTimeoutMs,
}, () => {
  it.each([
    ['achiever', 'https://service.achiever.orrnn.com'],
    ['independent-broker', 'https://api.independent-broker.test'],
    ['previously-unknown', 'https://gateway.new-financial.network'],
  ])('configures the same image for %s without compiled broker settings', (id, origin) => {
    const { source, html } = generate({ API_HOST: origin, WS_HOST: origin.replace('https:', 'wss:'), BROKER_ID: id });
    expect(inlineScript(html)).toBe(`\n${source}`);
    expect(source).not.toContain('https://service.orrnn.com');
    expect(source).not.toContain('old-directory.orrnn.com');
    expect(evaluate(inlineScript(html)).RUNTIME_CONFIG).toMatchObject({
      CONFIG_SOURCE: 'deployment', PINNED_BROKER: true, CONFIG_ERRORS: [],
      API_HOST: origin, API_HOST_EXT: origin, WS_HOST: origin.replace('https:', 'wss:'),
      BROKER_ID: id, VITE_BROKER_ID: id, FEED_BROKER_ID: id, DISCOVERY_BASE_URL: '', BROKER_DISCOVERY_URL: '',
      PUBLIC_MARKET_API: 'gateway-v2',
    });
    expect(html.indexOf('id="rtx-runtime-config"')).toBeLessThan(html.indexOf('window.configAtBootstrap'));
    expect(html).toContain('src="./assets/index-AbCd1234.js"');
    expect(html).toContain('href="./assets/index-AbCd1234.css"');
  });
  it.each(['API_HOST', 'WS_HOST', 'BROKER_ID', 'DEFAULT_MT5_SERVER'])('refuses missing %s instead of using compiled Orrnn', (name) => {
    const env: Record<string, string> = { ...profile };
    delete env[name];
    const container = createContainer();
    expect(() => container.start(env)).toThrow(new RegExp(`missing required deployment setting ${name}`));
    expect(readFileSync(container.indexPath, 'utf8')).toBe(builtHtml);
    expect(readdirSync(container.directory).filter(file => file.startsWith('.'))).toEqual([]);
  });
  it('refuses no config and explicit emptiness despite a valid Vite alias', () => {
    expect(() => createContainer().start()).toThrow(/missing required deployment setting API_HOST/);
    expect(() => generate({ API_HOST: '', VITE_API_HOST: 'https://otherwise-valid.test' })).toThrow(/missing required deployment setting API_HOST/);
  });
  it.each([
    ['API_HOST', 'http://api.example.test', /API_HOST must be a valid HTTPS/],
    ['API_HOST', 'https://user:password@api.example.test', /API_HOST must be a valid HTTPS/],
    ['API_HOST', 'https://api.example.test?key=secret', /API_HOST must be a valid HTTPS/],
    ['API_HOST', 'https://api.example.test#hash', /API_HOST must be a valid HTTPS/],
    ['API_HOST', 'https://api.example.test:99999', /API_HOST must be a valid HTTPS/],
    ['API_HOST', 'https://localhost', /API_HOST must be a valid HTTPS/],
    ['WS_HOST', 'ws://api.independent-broker.test', /WS_HOST must be a valid WSS/],
    ['WS_HOST', 'wss://api.another-broker.test', /WS_HOST belongs to an unconfigured broker/],
    ['API_HOST_EXT', 'https://service.orrnn.com', /API_HOST_EXT belongs to an unconfigured broker/],
    ['DISCOVERY_BASE_URL', 'http://directory.example.test', /DISCOVERY_BASE_URL must be a valid HTTPS/],
    ['BROKER_ALLOWED_ORIGINS', 'https://good.test,http://bad.test', /BROKER_ALLOWED_ORIGINS must contain valid/],
    ['USE_MOCK_DISCOVERY', 'true', /mock discovery is not allowed/],
    ['PUBLIC_MARKET_API', 'unknown-contract', /PUBLIC_MARKET_API must be gateway-v2 or mt5-bridge-v1/],
  ] as const)('rejects malformed/inconsistent %s=%s', (name, value, expected) => {
    expect(() => generate({ [name]: value })).toThrow(expected);
  });
  it('allows configured extra backend origins, keeping discovery separate', () => {
    const { html } = generate({
      API_HOST_EXT: 'https://account.independent-broker.test', WS_HOST: 'wss://stream.independent-broker.test',
      BROKER_ALLOWED_ORIGINS: 'https://account.independent-broker.test,https://stream.independent-broker.test',
      DISCOVERY_BASE_URL: 'https://directory.independent.test',
    });
    expect(evaluate(inlineScript(html)).RUNTIME_CONFIG).toMatchObject({
      API_HOST_EXT: 'https://account.independent-broker.test', WS_HOST: 'wss://stream.independent-broker.test',
      BROKER_ALLOWED_ORIGINS: 'https://account.independent-broker.test,https://stream.independent-broker.test',
      DISCOVERY_BASE_URL: 'https://directory.independent.test',
    });
    expect(() => generate({ WS_HOST: 'wss://directory.independent.test', DISCOVERY_BASE_URL: 'https://directory.independent.test' }))
      .toThrow(/WS_HOST belongs to an unconfigured broker/);
  });
  it('accepts complete Vite aliases, branding, feed identity and candle capability', () => {
    const { html } = createContainer().start({
      VITE_BACKEND_MODE: 'web', VITE_API_URL: 'https://alias-api.test/',
      VITE_API_URL_EXT: 'https://alias-api.test/', VITE_WS_URL: 'wss://alias-api.test/',
      VITE_DEFAULT_MT5_SERVER: 'Alias MT5', VITE_BROKER_DISCOVERY_URL: 'https://alias-directory.test/',
      VITE_BROKER_ID: 'alias-broker', VITE_FEED_BROKER_ID: 'alias-canonical-feed',
      VITE_PUBLIC_CANDLE_BRIDGE: 'yes', VITE_BROKER_NAME: 'Alias Broker',
      VITE_PUBLIC_MARKET_API: 'mt5-bridge-v1',
      VITE_BROKER_LOGO_URL: 'https://images.alias.test/logo.svg', VITE_USE_MOCK_DISCOVERY: 'false',
    });
    expect(evaluate(inlineScript(html)).RUNTIME_CONFIG).toMatchObject({
      API_HOST: 'https://alias-api.test', API_HOST_EXT: 'https://alias-api.test', WS_HOST: 'wss://alias-api.test',
      DEFAULT_MT5_SERVER: 'Alias MT5', BROKER_ID: 'alias-broker', VITE_BROKER_ID: 'alias-broker',
      FEED_BROKER_ID: 'alias-canonical-feed', BROKER_NAME: 'Alias Broker',
      BROKER_LOGO_URL: 'https://images.alias.test/logo.svg', PUBLIC_CANDLE_BRIDGE: true,
      PUBLIC_MARKET_API: 'mt5-bridge-v1',
      DISCOVERY_BASE_URL: 'https://alias-directory.test', BROKER_DISCOVERY_URL: 'https://alias-directory.test',
    });
  });
  it('accepts unprefixed aliases and gives canonical input precedence', () => {
    const { html } = createContainer().start({
      API_URL: profile.API_HOST, RTX5_WS_URL: profile.WS_HOST,
      BROKER_ID: profile.BROKER_ID, DEFAULT_MT5_SERVER: profile.DEFAULT_MT5_SERVER,
      VITE_API_URL: 'https://service.orrnn.com', VITE_WS_HOST: 'wss://service.orrnn.com',
    });
    expect(evaluate(inlineScript(html)).RUNTIME_CONFIG).toMatchObject(profile);
  });
  it.each(['API_V2_URL', 'VITE_API_V2_URL'])('accepts the supported %s alias', (name) => {
    const { html } = createContainer().start({
      [name]: profile.API_HOST, WS_HOST: profile.WS_HOST,
      BROKER_ID: profile.BROKER_ID, DEFAULT_MT5_SERVER: profile.DEFAULT_MT5_SERVER,
    });
    expect(evaluate(inlineScript(html)).RUNTIME_CONFIG).toMatchObject(profile);
  });
  it('keeps alias priorities consistent across API, WebSocket, and discovery inputs', () => {
    const { html } = createContainer().start({
      API_V2_URL: profile.API_HOST, VITE_API_HOST: 'https://service.orrnn.com',
      RTX5_WS_URL: profile.WS_HOST, FIX_WS_URL: 'wss://service.orrnn.com',
      BROKER_ID: profile.BROKER_ID, DEFAULT_MT5_SERVER: profile.DEFAULT_MT5_SERVER,
      SHARED_DISCOVERY_BASE_URL: 'https://catalog.reference.test',
      VITE_SHARED_DISCOVERY_BASE_URL: 'https://catalog.reference.test',
    });
    expect(evaluate(inlineScript(html)).RUNTIME_CONFIG).toMatchObject({ ...profile, DISCOVERY_BASE_URL: 'https://catalog.reference.test' });
  });
  it('rejects desktop transport in a production web container', () => {
    expect(() => generate({ BACKEND_TARGET: 'desktop' })).toThrow(/web containers require BACKEND_TARGET=web/);
  });
  it('derives an explicitly empty optional EXT from the configured broker API', () => {
    const { html } = generate({ API_HOST_EXT: '', VITE_API_HOST_EXT: 'https://service.orrnn.com' });
    expect(evaluate(inlineScript(html)).RUNTIME_CONFIG.API_HOST_EXT).toBe(profile.API_HOST);
  });
  it('allows public logo CDN asset paths, queries and fragments without accepting credentials', () => {
    const url = 'https://images.independent.test/brand/@2x.svg?v=2#icon';
    expect(evaluate(inlineScript(generate({ BROKER_LOGO_URL: url }).html)).RUNTIME_CONFIG.BROKER_LOGO_URL).toBe(url);
    expect(() => generate({ BROKER_LOGO_URL: 'https://private:password@images.independent.test/logo.svg' }))
      .toThrow(/BROKER_LOGO_URL must be a valid HTTPS URL without credentials/);
  });
  it.each(['invalid\nbroker', 'invalid\rbroker', 'invalid\tbroker', 'invalid\u0001broker', 'invalid\u007fbroker'])('rejects control characters in broker identity %j', (id) => {
    expect(() => generate({ BROKER_ID: id })).toThrow(/BROKER_ID must not contain control characters/);
  });
  it('requires the startup validator asset whenever built HTML references it', () => {
    const withValidator = builtHtml.replace('<script src="./runtime-config.js">', '<script src="./runtime-config-validator.js"></script>\n<script src="./runtime-config.js">');
    const container = createContainer(withValidator);
    expect(() => container.start(profile)).toThrow(/missing readable nonempty runtime configuration validator/);
    expect(readFileSync(container.indexPath, 'utf8')).toBe(withValidator);
    const validatorPath = join(container.directory, 'runtime-config-validator.js');
    writeFileSync(validatorPath, 'window.__RTX_VALIDATE_BROKER_CONFIG__ = function () { return {}; };');
    expect(container.start(profile).html).toContain('src="./runtime-config-validator.js"');
  });
  it('rejects conflicting discovery aliases', () => {
    expect(() => generate({ DISCOVERY_BASE_URL: 'https://one-directory.test', VITE_BROKER_DISCOVERY_URL: 'https://another-directory.test' }))
      .toThrow(/discovery settings disagree/);
  });
  it('never publishes backend passwords, privileged tokens or private keys', () => {
    const { source, html } = generate({ FEED_BROKER_TOKEN: 'permanent-token', BACKEND_PASSWORD: 'backend-password', PRIVATE_KEY: 'private-key' });
    expect(source + html).not.toMatch(/permanent-token|backend-password|private-key/);
    expect(evaluate(inlineScript(html)).RUNTIME_CONFIG.FEED_BROKER_TOKEN).toBeUndefined();
  });
  it.each([
    [{}, false],
    [{ VITE_TERMINAL_QUOTE_FRESHNESS: 'true' }, true],
    [{ TERMINAL_QUOTE_FRESHNESS: 'true' }, true],
    [{ TERMINAL_QUOTE_FRESHNESS: 'false', VITE_TERMINAL_QUOTE_FRESHNESS: 'true' }, false],
    [{ TERMINAL_QUOTE_FRESHNESS: '', VITE_TERMINAL_QUOTE_FRESHNESS: 'true' }, false],
  ] as Array<[Record<string, string>, boolean]>)('uses explicit public quote freshness settings %j', (settings, expected) => {
    const { html } = generate(settings);
    expect(evaluate(inlineScript(html)).RUNTIME_CONFIG.TERMINAL_QUOTE_FRESHNESS).toBe(expected);
  });
  it('preserves Electron runtime isolation', () => {
    const { source } = generate();
    const runtimeWindow = { location: { protocol: 'file:' }, RUNTIME_CONFIG: { selectedByDesktop: true } };
    new Function('window', 'navigator', source)(runtimeWindow, { userAgent: 'Electron' });
    expect(runtimeWindow.RUNTIME_CONFIG).toEqual({ selectedByDesktop: true });
  });
  it('safely escapes hostile strings and preserves multiline/control characters', () => {
    const hostile = `broker'\\"</ScRiPt><script data-injected>window.injected=true</script><!--\r\n\t\b\f\u0001\u2028\u2029\n`;
    const { source, html } = generate({ DEFAULT_MT5_SERVER: hostile, BROKER_NAME: hostile });
    expect(source).not.toContain('<');
    const actual = evaluate(inlineScript(html));
    expect(actual.RUNTIME_CONFIG.BROKER_ID).toBe(profile.BROKER_ID);
    expect(actual.RUNTIME_CONFIG.BROKER_NAME).toBe(hostile);
    expect(actual.RUNTIME_CONFIG.DEFAULT_MT5_SERVER).toBe(hostile);
    expect(actual.injected).toBeUndefined();
  });
  it('supports root-relative scripts and preserves Windows HTML line endings', () => {
    const template = builtHtml.replaceAll('"./', '"/').replace(/\n/g, '\r\n');
    const { html } = createContainer(template).start(profile);
    expect(evaluate(inlineScript(html)).RUNTIME_CONFIG.BROKER_ID).toBe(profile.BROKER_ID);
    const restored = html.replace(/<script id="rtx-runtime-config">[\s\S]*?<\/script>/, '<script src="/runtime-config.js"></script>');
    expect(restored.trimEnd()).toBe(template.trimEnd());
    expect(html).toContain('src="/assets/index-AbCd1234.js"');
  });
  it('restarts with current settings without restoring previous or compiled brokers', () => {
    const container = createContainer();
    const first = container.start({ ...profile, BROKER_ID: 'first', API_HOST: 'https://first.test', WS_HOST: 'wss://first.test' });
    const second = container.start({ ...profile, BROKER_ID: 'second', API_HOST: 'https://second.test', WS_HOST: 'wss://second.test' });
    expect(evaluate(inlineScript(first.html)).RUNTIME_CONFIG.BROKER_ID).toBe('first');
    expect(evaluate(inlineScript(second.html)).RUNTIME_CONFIG.BROKER_ID).toBe('second');
    expect(second.html).not.toContain('https://first.test');
    expect(second.html).not.toContain('https://service.orrnn.com');
    expect(() => container.start()).toThrow(/missing required deployment setting API_HOST/);
    expect(readFileSync(container.indexPath, 'utf8')).toBe(second.html);
    expect(readFileSync(container.templatePath, 'utf8')).toBe(builtHtml);
  });
  it.each(['missing', 'duplicate'] as const)('does not publish a %s script marker', (kind) => {
    const container = createContainer();
    const initial = container.start(profile);
    const script = '<script src="./runtime-config.js"></script>';
    writeFileSync(container.templatePath, kind === 'missing' ? builtHtml.replace(script, '') : builtHtml.replace(script, `${script}${script}`));
    expect(() => container.start({ ...profile, BROKER_ID: 'wrong' })).toThrow(/exactly one external runtime-config.js script/);
    expect(readFileSync(container.indexPath, 'utf8')).toBe(initial.html);
    expect(readFileSync(container.configPath, 'utf8')).toBe(initial.source);
    expect(readdirSync(container.directory).filter(name => name.startsWith('.'))).toEqual([]);
  }, 60000);
  it('fails clearly when pristine HTML is missing', () => {
    const container = createContainer();
    rmSync(container.templatePath);
    expect(() => container.start(profile)).toThrow(/missing readable index template/);
    expect(readFileSync(container.indexPath, 'utf8')).toBe(builtHtml);
  });
  it('ignores missing or unsafe compiled templates entirely', () => {
    const container = createContainer();
    rmSync(container.runtimeTemplatePath);
    expect(evaluate(inlineScript(container.start(profile).html)).RUNTIME_CONFIG.BROKER_ID).toBe(profile.BROKER_ID);
    writeFileSync(container.runtimeTemplatePath, 'window.RUNTIME_CONFIG = { BROKER_ID: "</script><script>bad()</script>" };');
    expect(evaluate(inlineScript(container.start(profile).html)).RUNTIME_CONFIG.BROKER_ID).toBe(profile.BROKER_ID);
  });

  it.each(['webterminal.achiever.orrnn.com', 'terminal.independent-financial.network'])('renders managed CORS for only deployment %s', (terminalDomain) => {
    const directory = mkdtempSync(join(tmpdir(), 'rtx-docker-env-test-'));
    directories.push(directory);
    const source = readFileSync(resolve('.github/scripts/deploy-broker-ui.sh'), 'utf8').replace(/\r\n/g, '\n');
    const functionSource = source.slice(source.indexOf('write_services_vhost() {'), source.indexOf('\ndisable_conflicting_vhosts() {'));
    execFileSync(shell, ['-c', `${functionSource}\nwrite_services_vhost services.reference.test true http://127.0.0.1:8090 http://127.0.0.1:8091 http://127.0.0.1:8094`], {
      env: { ...process.env, managed_dir: directory.replace(/\\/g, '/'), domain: terminalDomain },
      encoding: 'utf8', timeout: 30000, stdio: 'pipe',
    });
    const nginx = readFileSync(join(directory, 'services.reference.test.conf'), 'utf8');
    expect(nginx).toContain(`if ($http_origin = "https://${terminalDomain}")`);
    expect(nginx).toContain('proxy_set_header Authorization $http_authorization;');
    expect(nginx).toContain('add_header Access-Control-Allow-Credentials "true" always;');
    expect(nginx).not.toContain('growtradingacademy');
    expect(nginx).not.toMatch(/Access-Control-Allow-Origin\s+["']?\*/);
  });
});
