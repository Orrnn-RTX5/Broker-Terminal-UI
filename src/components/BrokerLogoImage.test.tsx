import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrokerLogoImage, buildBrokerLogoCandidates } from './BrokerLogoImage';

const testBroker = {
  broker_id: 'TEST',
  broker_name: 'TEST',
  server_url: 'https://fxtrustbrokerbackend.orrnn.com',
  logo_url: '/assets/logo.png',
};

describe('BrokerLogoImage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses explicit deployment branding before stale broker metadata and keeps retries', () => {
    vi.stubGlobal('__RTX_RUNTIME_CONFIG__', {
      CONFIG_SOURCE: 'deployment', API_HOST: testBroker.server_url,
      WS_HOST: 'wss://fxtrustbrokerbackend.orrnn.com', BROKER_ID: testBroker.broker_id,
      DEFAULT_MT5_SERVER: 'TEST-Live', DISCOVERY_BASE_URL: 'https://directory.example',
      BROKER_LOGO_URL: 'https://branding.example/current-logo.png',
    });
    render(<BrokerLogoImage broker={testBroker} alt="TEST broker logo" />);
    expect(screen.getByRole('img', { name: 'TEST broker logo' }))
      .toHaveAttribute('src', 'https://branding.example/current-logo.png');
    fireEvent.error(screen.getByRole('img', { name: 'TEST broker logo' }));
    expect(screen.getByRole('img', { name: 'TEST broker logo' }))
      .toHaveAttribute('src', `${testBroker.server_url}/assets/logo.png`);
  });

  it('never applies deployment branding to another broker or a desktop selection', () => {
    vi.stubGlobal('__RTX_RUNTIME_CONFIG__', {
      CONFIG_SOURCE: 'deployment', API_HOST: testBroker.server_url,
      WS_HOST: 'wss://fxtrustbrokerbackend.orrnn.com', BROKER_ID: testBroker.broker_id,
      DEFAULT_MT5_SERVER: 'TEST-Live', DISCOVERY_BASE_URL: 'https://directory.example',
      BROKER_LOGO_URL: 'https://branding.example/current-logo.png',
    });
    expect(buildBrokerLogoCandidates({ broker_id: 'OTHER', logo_url: 'https://other.example/logo.png' }))
      .not.toContain('https://branding.example/current-logo.png');
    vi.stubGlobal('electron', { window: {} });
    expect(buildBrokerLogoCandidates(testBroker)).not.toContain('https://branding.example/current-logo.png');
  });

  it('resolves a relative broker logo and retains the discovery logo as its next source', () => {
    expect(buildBrokerLogoCandidates(
      testBroker,
      'https://fxtrustsuperbackned.orrnn.com',
      '/brand/rtx5-app-icon.png',
    )).toEqual([
      'https://fxtrustbrokerbackend.orrnn.com/assets/logo.png',
      'https://fxtrustsuperbackned.orrnn.com/api/v1/brokers/TEST/logo',
      '/brand/rtx5-app-icon.png',
    ]);
  });

  it('advances to another source instead of leaving a broken image', () => {
    vi.stubGlobal('__RTX_RUNTIME_CONFIG__', {
      CONFIG_SOURCE: 'deployment',
      API_HOST: testBroker.server_url,
      WS_HOST: 'wss://fxtrustbrokerbackend.orrnn.com',
      BROKER_ID: testBroker.broker_id,
      DEFAULT_MT5_SERVER: 'TEST-Live',
      DISCOVERY_BASE_URL: 'https://directory.example',
    });
    render(<BrokerLogoImage broker={{
      ...testBroker,
      logo_url: 'https://assets.example.test/missing.png',
    }} alt="TEST broker logo" />);

    const image = screen.getByRole('img', { name: 'TEST broker logo' });
    expect(image).toHaveAttribute('src', 'https://assets.example.test/missing.png');

    fireEvent.error(image);
    expect(screen.getByRole('img', { name: 'TEST broker logo' })).toHaveAttribute(
      'src',
      expect.stringContaining('/api/v1/brokers/TEST/logo'),
    );

    fireEvent.error(screen.getByRole('img', { name: 'TEST broker logo' }));
    expect(screen.getByRole('img', { name: 'TEST broker logo' })).toHaveAttribute(
      'src',
      expect.stringContaining('/brand/rtx5-app-icon.png'),
    );
  });

  it('shows a newly selected broker immediately after the previous logo failed', () => {
    const { rerender } = render(<BrokerLogoImage broker={{ broker_id: 'broker-a', logo_url: 'https://broker-a.example/logo.png' }} alt="Active broker" />);
    fireEvent.error(screen.getByRole('img', { name: 'Active broker' }));
    rerender(<BrokerLogoImage broker={{ broker_id: 'broker-b', logo_url: 'https://broker-b.example/logo.svg' }} alt="Active broker" />);
    expect(screen.getByRole('img', { name: 'Active broker' })).toHaveAttribute('src', 'https://broker-b.example/logo.svg');
  });
});
