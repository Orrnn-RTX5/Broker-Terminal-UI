import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyBrokerChrome,
  buildBrokerPresentationUrl,
  loadBrokerPresentation,
  mergeBrokerPresentation,
  normalizeBrokerPresentationConfig,
  normalizeBrokerThemeColor,
  resolveBrokerPresentationAssetUrl,
} from './brokerPresentation';

describe('broker presentation', () => {
  afterEach(() => {
    applyBrokerChrome({});
    document.title = '';
    vi.unstubAllGlobals();
  });

  it('builds a selected broker config endpoint without changing its server origin', () => {
    expect(buildBrokerPresentationUrl('https://nexa.orrnn.com/', 'Nexa')).toBe(
      'https://nexa.orrnn.com/api/v2/broker/config?broker_id=Nexa',
    );
    expect(buildBrokerPresentationUrl('not a URL', 'Nexa')).toBe('');
  });

  it('resolves relative branding assets onto the selected broker origin', () => {
    expect(resolveBrokerPresentationAssetUrl('/assets/logo.png', 'https://service.achieverfinancials.com'))
      .toBe('https://service.achieverfinancials.com/assets/logo.png');
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
      logo_url: '/assets/logo.png',
      theme_color: '#1a73e8',
    }, 'https://service.achieverfinancials.com')).toEqual({
      broker_name: 'Achiever Financials',
      logo_url: 'https://service.achieverfinancials.com/assets/logo.png',
      theme_color: '#1a73e8',
    });
    expect(normalizeBrokerPresentationConfig({ broker_name: 'Broker', theme_color: '' })).toBeNull();

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
    expect(document.title).toBe('RTX Terminal - Nexa');

    applyBrokerChrome({
      brokerId: 'gta_broker',
      brokerName: 'Grow Trading Academy',
      updateLoginTitle: true,
    });
    expect(document.documentElement).toHaveAttribute('data-broker-id', 'gta_broker');
    expect(document.documentElement.style.getPropertyValue('--rtx-broker-accent')).toBe('');
    expect(document.title).toBe('RTX Terminal - Grow Trading Academy');
  });
});
