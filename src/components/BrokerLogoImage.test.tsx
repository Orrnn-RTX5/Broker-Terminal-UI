import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BrokerLogoImage, buildBrokerLogoCandidates } from './BrokerLogoImage';

const testBroker = {
  broker_id: 'TEST',
  broker_name: 'TEST',
  server_url: 'https://fxtrustbrokerbackend.orrnn.com',
  logo_url: '/assets/logo.png',
};

describe('BrokerLogoImage', () => {
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
