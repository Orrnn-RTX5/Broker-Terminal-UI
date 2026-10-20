import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyBrokerChrome,
  buildBrokerPresentationUrl,
  getLoginTitle,
  loadBrokerPresentation,
  mergeBrokerPresentation,
  normalizeBrokerPresentationConfig,
  normalizeBrokerThemeColor,
  resolveBrokerPresentationAssetUrl,
} from './brokerPresentation';

describe('broker presentation', () => {
  beforeEach(() => {
    // This suite exercises directory-selected desktop presentation.
    Object.defineProperty(window, 'electron', { configurable: true, value: { window: {} } });
  });
  afterEach(() => {
    applyBrokerChrome({});
    document.title = '';
    vi.unstubAllGlobals();
    delete window.electron;
  });

  it('builds a selected broker config endpoint without changing its server origin', () => {
    expect(buildBrokerPresentationUrl('https://nexa.orrnn.com/', 'Nexa')).toBe(
      'https://nexa.orrnn.com/api/v2/broker/config?broker_id=Nexa',
    );
    expect(buildBrokerPresentationUrl('not a URL', 'Nexa')).toBe('');
  });

  it('resolves relative branding assets onto the selected broker origin and ignores /assets/logo.png placeholder', () => {
    expect(resolveBrokerPresentationAssetUrl('/branding/logo.png', 'https://service.achieverfinancials.com'))
      .toBe('https://service.achieverfinancials.com/branding/logo.png');
    expect(resolveBrokerPresentationAssetUrl('/assets/logo.png', 'https://service.achieverfinancials.com'))
      .toBe('');
    expect(resolveBrokerPresentationAssetUrl('https://assets.example.test/nexa.svg', 'https://nexa.orrnn.com'))
      .toBe('https://assets.example.test/nexa.svg');
  });

  it('accepts only safe configured colours and keeps directory identity when merging', () => {
    expect(normalizeBrokerThemeColor('#6D4AFF')).toBe('#6D4AFF');
    expect(normalizeBrokerThemeColor('rgb(1, 2, 3)')).toBe('');
    expect(normalizeBrokerPresentationConfig({
      logo_url: 'https://assets.example.test/nexa.svg',
      theme_color: 'linear-gradient(red, blue)',
    })).toEqual({ logo_url: 'https://assets.example.test/nexa.svg' });
    expect(normalizeBrokerPresentationConfig({
      broker_name: 'Achiever Financials',
      logo_url: '/branding/logo.png',
      theme_color: '#1a73e8',
    }, 'https://service.achieverfinancials.com')).toEqual({
      broker_name: 'Achiever Financials',
      logo_url: 'https://service.achieverfinancials.com/branding/logo.png',
      theme_color: '#1a73e8',
    });
    expect(normalizeBrokerPresentationConfig({
      broker_name: 'Achiever Financials',
      logo_url: '/assets/logo.png',
      theme_color: '#1a73e8',
    }, 'https://service.achieverfinancials.com')).toEqual({
      broker_name: 'Achiever Financials',
      theme_color: '#1a73e8',
    });
    expect(normalizeBrokerPresentationConfig({ broker_name: 'Broker', logo_url: '/assets/logo.png', theme_color: '' })).toBeNull();

    const broker = {
      broker_id: 'Nexa',
      broker_name: 'Nexa',
      server_url: 'https://nexa.orrnn.com',
      logo_url: 'https://directory.example.test/nexa.ico',
    };
    expect(mergeBrokerPresentation(broker, { theme_color: '#6D4AFF' })).toEqual({
      ...broker,
      theme_color: '#6D4AFF',
    });
    expect(mergeBrokerPresentation(broker, { broker_name: 'Nexa Markets' })).toEqual({
      ...broker,
      broker_name: 'Nexa Markets',
    });
  });

  it('loads optional branding from the broker selected in the desktop directory', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      broker_name: 'Nexa',
      logo_url: 'https://assets.example.test/nexa.svg',
      theme_color: '#6D4AFF',
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(loadBrokerPresentation({
      broker_id: 'Nexa',
      server_url: 'https://nexa.orrnn.com',
    })).resolves.toEqual({
      broker_name: 'Nexa',
      logo_url: 'https://assets.example.test/nexa.svg',
      theme_color: '#6D4AFF',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://nexa.orrnn.com/api/v2/broker/config?broker_id=Nexa',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('paints selected-broker chrome onto the desktop document without changing routing', () => {
    applyBrokerChrome({
      brokerId: 'Nexa',
      brokerName: 'Nexa',
      logoUrl: 'https://directory.example.test/nexa.ico',
      themeColor: '#6D4AFF',
      updateLoginTitle: true,
    });

    expect(document.documentElement).toHaveAttribute('data-broker-id', 'Nexa');
    expect(document.documentElement).toHaveStyle('--rtx-broker-accent: #6D4AFF');
    expect(document.title).toBe('Terminal - Nexa');

    applyBrokerChrome({
      brokerId: 'gta_broker',
      brokerName: 'Grow Trading Academy',
      updateLoginTitle: true,
    });
    expect(document.documentElement).toHaveAttribute('data-broker-id', 'gta_broker');
    expect(document.documentElement.style.getPropertyValue('--rtx-broker-accent')).toBe('');
    expect(document.title).toBe('Terminal - Grow Trading Academy');
  });

  it('derives the login title from broker config, never a vendor default (ds-16)', () => {
    const runtimeWindow = window as unknown as Record<string, unknown>;
    const previous = runtimeWindow.__RTX_RUNTIME_CONFIG__;
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = {
      BACKEND_TARGET: 'web',
      BROKER_ID: 'acme',
      BROKER_NAME: 'Acme Trading',
      API_HOST: 'https://acme.example.com',
    };
    try {
      expect(getLoginTitle()).toBe('Acme Trading');
      applyBrokerChrome({ brokerId: 'acme', brokerName: 'Acme Trading', updateLoginTitle: true });
      expect(document.title).toContain('Acme Trading');
      expect(document.title).not.toMatch(/RTX/);
    } finally {
      if (previous === undefined) delete runtimeWindow.__RTX_RUNTIME_CONFIG__;
      else runtimeWindow.__RTX_RUNTIME_CONFIG__ = previous;
    }
    delete runtimeWindow.__RTX_RUNTIME_CONFIG__;
    expect(getLoginTitle()).toBe('Web Terminal');
    expect(getLoginTitle()).not.toMatch(/RTX/);
  });

  it('updates the browser tab icon for each broker and restores the app icon when cleared', () => {
    document.querySelectorAll('link[rel~="icon"]').forEach(link => link.remove());
    const icon = document.createElement('link');
    icon.rel = 'icon';
    icon.type = 'image/png';
    icon.setAttribute('href', '/favicon.png');
    document.head.appendChild(icon);
    applyBrokerChrome({ brokerId: 'broker-a', logoUrl: 'https://broker-a.example/logo.svg' });
    expect(icon).toHaveAttribute('href', 'https://broker-a.example/logo.svg');
    expect(icon).not.toHaveAttribute('type');
    applyBrokerChrome({ brokerId: 'broker-b', logoUrl: 'https://broker-b.example/logo.ico' });
    expect(icon).toHaveAttribute('href', 'https://broker-b.example/logo.ico');
    applyBrokerChrome({});
    expect(icon).toHaveAttribute('href', '/favicon.png');
    expect(icon).toHaveAttribute('type', 'image/png');
    icon.remove();
  });
});
