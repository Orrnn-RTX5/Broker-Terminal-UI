import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveLoginHeroAsset, toPublicAssetPath } from './welcomeHeroAssets';

const runtimeWindow = window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown>; RUNTIME_CONFIG?: Record<string, unknown>; __RUNTIME_CONFIG__?: Record<string, unknown> };
const configure = (extra: Record<string, unknown> = {}) => {
  runtimeWindow.__RTX_RUNTIME_CONFIG__ = {
    CONFIG_SOURCE: 'deployment', BACKEND_TARGET: 'web', API_HOST: 'https://unknown-broker.example',
    WS_HOST: 'wss://unknown-broker.example', BROKER_ID: 'NewRegisteredID', DEFAULT_MT5_SERVER: 'Provisioned-Live', ...extra,
  };
};
const clear = () => {
  delete runtimeWindow.__RTX_RUNTIME_CONFIG__;
  delete runtimeWindow.RUNTIME_CONFIG;
  delete runtimeWindow.__RUNTIME_CONFIG__;
};
beforeEach(clear);
afterEach(clear);

describe('configuration-driven login artwork', () => {
  it('resolves public asset paths for Electron and web bases', () => {
    expect(toPublicAssetPath('/login/trading-desk-hero.webp', './')).toBe('./login/trading-desk-hero.webp');
    expect(toPublicAssetPath('/login/trading-desk-hero.webp', '/')).toBe('/login/trading-desk-hero.webp');
  });
  it.each(['achiever', 'myprop-trade', 'gta_broker', 'Orrnn', 'previously-unknown'])('does not select artwork from a broker name, ID or domain: %s', id => {
    configure({ BROKER_ID: id });
    expect(resolveLoginHeroAsset({ broker_id: id, broker_name: id, server_url: `https://${id.toLowerCase()}.example` }).src)
      .toBe(toPublicAssetPath('login/trading-desk-hero.webp'));
  });
  it('uses explicit runtime artwork without needing a broker in source code', () => {
    configure({ BROKER_LOGIN_HERO_URL: 'https://cdn.unrelated.example/new-hero.webp', BROKER_LOGIN_HERO_MOBILE_URL: 'https://cdn.unrelated.example/mobile.jpg' });
    expect(resolveLoginHeroAsset(null)).toMatchObject({ src: 'https://cdn.unrelated.example/new-hero.webp', mobileSrc: 'https://cdn.unrelated.example/mobile.jpg', theme: 'accent', fit: 'cover', mobileFit: 'contain' });
  });
  it('uses the configured desktop image on mobile if no mobile image is supplied', () => {
    configure({ BROKER_LOGIN_HERO_URL: 'https://cdn.example/hero.webp' });
    expect(resolveLoginHeroAsset(null).mobileSrc).toBe('https://cdn.example/hero.webp');
  });
  it('never takes artwork from stale or foreign metadata for a pinned web deployment', () => {
    configure({ BROKER_LOGIN_HERO_URL: 'https://cdn.example/current.webp' });
    expect(resolveLoginHeroAsset({ broker_id: 'NewRegisteredID', login_hero_url: 'https://foreign.example/hero.webp' }).src).toBe('https://cdn.example/current.webp');
    expect(resolveLoginHeroAsset({ broker_id: 'foreign', login_hero_url: 'https://foreign.example/hero.webp' }).src).toContain('trading-desk-hero');
  });
  it('does not show configured artwork when deployment configuration is invalid', () => {
    configure({ WS_HOST: '', BROKER_LOGIN_HERO_URL: 'https://cdn.example/hero.webp' });
    expect(resolveLoginHeroAsset(null).src).toContain('trading-desk-hero');
  });
  it('uses explicit directory artwork for independently selected Electron brokers', () => {
    configure({ BACKEND_TARGET: 'desktop', CONFIG_SOURCE: 'build' });
    expect(resolveLoginHeroAsset({ broker_id: 'new', login_hero_url: 'https://cdn.example/new.webp' }).src).toBe('https://cdn.example/new.webp');
    expect(resolveLoginHeroAsset({ broker_id: 'other' }).src).toContain('trading-desk-hero');
  });
  it.each(['javascript:alert(1)', 'http://cdn.example/hero.jpg', 'https://user:password@cdn.example/hero.jpg', '//cdn.example/hero.jpg'])('ignores unsafe directory artwork: %s', login_hero_url => {
    configure({ BACKEND_TARGET: 'desktop', CONFIG_SOURCE: 'build' });
    expect(resolveLoginHeroAsset({ broker_id: 'new', login_hero_url }).src).toContain('trading-desk-hero');
  });
});
