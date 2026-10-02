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
});
