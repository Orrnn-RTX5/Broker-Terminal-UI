import { beforeEach, describe, expect, it } from 'vitest';
import { resolveLoginHeroAsset, toPublicAssetPath, type LoginHeroBroker } from './welcomeHeroAssets';

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

  it('uses the Achiever image for Achiever broker identities', () => {
    const achieverAsset = resolveLoginHeroAsset({
      broker_id: 'achiever-financials',
      broker_name: 'Achiever Financials',
      logo_url: '',
    });

    expect(achieverAsset.src).toBe(toPublicAssetPath('login/achiever-hero-desktop-fit.png'));
    expect(achieverAsset.mobileSrc).toBe(toPublicAssetPath('login/achiever-hero-mobile.jpg'));
    expect(achieverAsset.theme).toBe('achiever');
    expect(achieverAsset.fit).toBe('cover');
    expect(achieverAsset.mobileFit).toBe('contain');

    for (const brokerId of ['achieverfinancials', 'achiever', 'achiver']) {
      expect(resolveLoginHeroAsset({
        broker_id: brokerId,
        broker_name: 'Neutral Broker',
        logo_url: '',
      }).src).toBe(toPublicAssetPath('login/achiever-hero-desktop-fit.png'));
    }
  });

  it('uses the Achiever image for approved Achiever domain and URL identities', () => {
    for (const domain of [
      'admin.achieverfinancials.com',
      'manager.achieverfinancials.com',
      'webterminal.achieverfinancials.com',
      'service.achieverfinancials.com',
    ]) {
      expect(resolveLoginHeroAsset({
        broker_id: 'unbranded',
        broker_name: 'Unbranded',
        domain,
        logo_url: '',
      }).src).toBe(toPublicAssetPath('login/achiever-hero-desktop-fit.png'));
    }

    expect(resolveLoginHeroAsset({
      broker_id: 'unbranded',
      broker_name: 'Unbranded',
      domains: ['example.com', 'webterminal.achieverfinancials.com'],
      logo_url: '',
    }).src).toBe(toPublicAssetPath('login/achiever-hero-desktop-fit.png'));

    expect(resolveLoginHeroAsset({
      broker_id: 'unbranded',
      broker_name: 'Unbranded',
      domains: 'example.com, manager.achieverfinancials.com',
      logo_url: '',
    }).src).toBe(toPublicAssetPath('login/achiever-hero-desktop-fit.png'));
  });

  it('uses the Achiever image from selected broker webterminal, admin, and manager fields independently', () => {
    const fieldCases = [
      ['webterminal_domain', 'webterminal.achieverfinancials.com'],
      ['admin_domain', 'admin.achieverfinancials.com'],
      ['manager_domain', 'manager.achieverfinancials.com'],
    ] as const satisfies readonly (readonly [keyof LoginHeroBroker, string])[];

    for (const [field, domain] of fieldCases) {
      const broker: LoginHeroBroker = {
        broker_id: 'unbranded',
        broker_name: 'Unbranded',
        logo_url: '',
        [field]: domain,
      };

      expect(resolveLoginHeroAsset(broker).src).toBe(toPublicAssetPath('login/achiever-hero-desktop-fit.png'));
    }
  });

  it('does not use the Achiever image for unrelated words that contain achiever', () => {
    expect(resolveLoginHeroAsset({
      broker_id: 'overachiever-capital',
      broker_name: 'Overachiever Capital',
      logo_url: '',
    }).src).toBe(toPublicAssetPath('login/trading-desk-hero.webp'));
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

    runtimeWindow.__RTX_RUNTIME_CONFIG__ = {
      BACKEND_TARGET: 'desktop',
      API_HOST: 'https://service.achieverfinancials.com',
    };

    expect(resolveLoginHeroAsset(null).src).toBe(toPublicAssetPath('login/achiever-hero-desktop-fit.png'));
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
