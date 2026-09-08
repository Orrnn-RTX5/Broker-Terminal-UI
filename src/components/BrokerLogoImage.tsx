import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { normalizeBrokerServerUrl } from '../config/api';
import {
  getBackendTarget,
  getRuntimeDiscoveryBaseUrl,
} from '../config/backendTarget.js';
import { toPublicAssetPath } from './welcomeHeroAssets';

export interface BrokerLogoSource {
  broker_id?: string | number;
  broker_name?: string;
  logo_url?: string;
  server_url?: string;
  backend_url?: string;
  market_api_url?: string;
  public_backend_url?: string;
  public_ext_api_url?: string;
  web_backend_url?: string;
  web_ext_api_url?: string;
  API_HOST?: string;
  API_HOST_EXT?: string;
  api_host?: string;
  api_host_ext?: string;
}

const RTX5_FALLBACK_LOGO_SRC = toPublicAssetPath('brand/rtx5-app-icon.png');
const ABSOLUTE_IMAGE_URL = /^(?:https?:|data:|blob:)/i;

const appendUnique = (values: string[], value: unknown): void => {
  const normalized = String(value || '').trim();
  if (normalized && !values.includes(normalized)) values.push(normalized);
};

const normalizeLogoBaseUrl = (value: unknown): string => {
  const normalized = normalizeBrokerServerUrl(String(value || '').trim());
  return normalized.replace(/\/+$/, '');
};

export const buildBrokerDirectoryLogoUrl = (
  brokerId: string | number | null | undefined,
  discoveryBaseUrl = getRuntimeDiscoveryBaseUrl(),
): string => {
  const normalizedBrokerId = String(brokerId || '').trim();
  const discoveryBase = normalizeLogoBaseUrl(discoveryBaseUrl);
  if (!normalizedBrokerId || !discoveryBase) return '';
  return `${discoveryBase}/api/v1/brokers/${encodeURIComponent(normalizedBrokerId)}/logo`;
};

export const buildBrokerLogoCandidates = (
  broker: BrokerLogoSource | null | undefined,
  discoveryBaseUrl = getRuntimeDiscoveryBaseUrl(),
  appFallbackUrl = RTX5_FALLBACK_LOGO_SRC,
): string[] => {
  if (!broker) return appFallbackUrl ? [appFallbackUrl] : [];

  const candidates: string[] = [];
  const rawLogoUrl = String(broker.logo_url || '').trim();

  if (ABSOLUTE_IMAGE_URL.test(rawLogoUrl)) {
    appendUnique(candidates, rawLogoUrl);
  } else if (rawLogoUrl.startsWith('//')) {
    const protocol = typeof window !== 'undefined' && window.location.protocol === 'http:' ? 'http:' : 'https:';
    appendUnique(candidates, `${protocol}${rawLogoUrl}`);
  } else if (rawLogoUrl) {
    const baseCandidates = [
      broker.server_url,
      broker.backend_url,
      broker.market_api_url,
      broker.public_backend_url,
      broker.public_ext_api_url,
      broker.web_backend_url,
      broker.web_ext_api_url,
      broker.API_HOST,
      broker.API_HOST_EXT,
      broker.api_host,
      broker.api_host_ext,
    ].filter(value => String(value || '').trim());
    if (baseCandidates.length === 0) baseCandidates.push(getBackendTarget());

    for (const baseValue of baseCandidates) {
      const baseUrl = normalizeLogoBaseUrl(baseValue);
      if (!baseUrl) continue;
      try {
        appendUnique(candidates, new URL(rawLogoUrl, `${baseUrl}/`).toString());
      } catch {
        // Try the next broker base before falling back to directory branding.
      }
    }
  }

  appendUnique(candidates, buildBrokerDirectoryLogoUrl(broker.broker_id, discoveryBaseUrl));

  appendUnique(candidates, appFallbackUrl);
  return candidates;
};

interface BrokerLogoImageProps {
  broker: BrokerLogoSource | null | undefined;
  alt?: string;
  className?: string;
  decoding?: 'async' | 'auto' | 'sync';
  fallback?: ReactNode;
}

export function BrokerLogoImage({
  broker,
  alt = '',
  className,
  decoding = 'async',
  fallback = null,
}: BrokerLogoImageProps) {
  const candidates = useMemo(() => buildBrokerLogoCandidates(broker), [broker]);
  const candidateSignature = candidates.join('\n');
  const [candidateIndex, setCandidateIndex] = useState(0);

  useEffect(() => {
    setCandidateIndex(0);
  }, [candidateSignature]);

  const src = candidates[candidateIndex];
  if (!src) return fallback;

  return (
    <img
      key={src}
      src={src}
      alt={alt}
      className={className}
      decoding={decoding}
      onError={() => setCandidateIndex(index => index + 1)}
    />
  );
}
