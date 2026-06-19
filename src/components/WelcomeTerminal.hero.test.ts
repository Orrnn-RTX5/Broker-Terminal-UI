import { beforeEach, describe, expect, it } from 'vitest';
import { resolveLoginHeroAsset, toPublicAssetPath } from './welcomeHeroAssets';

type RuntimeWindow = Window & {
  RUNTIME_CONFIG?: Record<string, unknown>;
  __RTX_RUNTIME_CONFIG__?: Record<string, unknown>;
};

const runtimeWindow = window as RuntimeWindow;

describe('resolveLoginHeroAsset', () => {
  beforeEach(() => {
    delete runtimeWindow.RUNTIME_CONFIG;
    delete runtimeWindow.__RTX_RUNTIME_CONFIG__;
  });

  it('resolves public asset paths for packaged Electron and web bases', () => {
    expect(toPublicAssetPath('/login/trading-desk-hero.webp', './')).toBe('./login/trading-desk-hero.webp');
    expect(toPublicAssetPath('/brand/rtx5-logo.png', '/')).toBe('/brand/rtx5-logo.png');
  });

  it('keeps the default trading desk image for unbranded brokers', () => {
    expect(resolveLoginHeroAsset({
      broker_id: 'other-broker',
      broker_name: 'Other Broker',
      logo_url: '',
    }).src).toBe(toPublicAssetPath('login/trading-desk-hero.webp'));
  });

  it('uses the GTA image for Grow Trading Academy broker identities', () => {
    const growTradingAcademyAsset = resolveLoginHeroAsset({
      broker_id: 'grow-trading-academy',
      broker_name: 'Grow Trading Academy',
      logo_url: '',
    });

    expect(growTradingAcademyAsset.src).toBe(toPublicAssetPath('login/gta-hero-desktop-fit.webp'));
    expect(growTradingAcademyAsset.fit).toBe('cover');
    expect(growTradingAcademyAsset.position).toBe('center center');
    expect(growTradingAcademyAsset.mobileFit).toBe('contain');

    expect(resolveLoginHeroAsset({
      broker_id: 'gta_broker',
      broker_name: 'GTA',
      logo_url: '',
    }).src).toBe(toPublicAssetPath('login/gta-hero-desktop-fit.webp'));
  });

  it('uses the MyProp image for MyProp broker identities', () => {
    const myPropAsset = resolveLoginHeroAsset({
      broker_id: 'myprop-trade',
      broker_name: 'MyProp',
      logo_url: '',
    });

    expect(myPropAsset.src).toBe(toPublicAssetPath('login/myprop-hero-wide.png'));
    expect(myPropAsset.fit).toBe('contain');
    expect(myPropAsset.position).toBe('center center');
    expect(myPropAsset.mobileFit).toBe('contain');
  });

  it('uses runtime broker hosts when discovery has not resolved yet', () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = {
      BACKEND_TARGET: 'web',
      API_HOST: 'https://services.myprop.trade',
    };

    expect(resolveLoginHeroAsset(null).src).toBe(toPublicAssetPath('login/myprop-hero-wide.png'));

    runtimeWindow.__RTX_RUNTIME_CONFIG__ = {
      BACKEND_TARGET: 'web',
      API_HOST: 'https://services.growtradingacademy.com',
    };

    expect(resolveLoginHeroAsset(null).src).toBe(toPublicAssetPath('login/gta-hero-desktop-fit.webp'));
  });

  it('does not let runtime identity override an already selected unbranded broker', () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = {
      BACKEND_TARGET: 'web',
      API_HOST: 'https://services.myprop.trade',
    };

    expect(resolveLoginHeroAsset({
      broker_id: 'other-broker',
      broker_name: 'Other Broker',
      logo_url: '',
    }).src).toBe(toPublicAssetPath('login/trading-desk-hero.webp'));
  });
});
