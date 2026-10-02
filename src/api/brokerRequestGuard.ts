import {
  getBrokerConfigurationError,
  isConfiguredBrokerEndpoint,
  isDesktopBackendTarget,
} from '../config/backendTarget.js';

/** Resolve the existing development proxy format before checking broker ownership. */
export const brokerRequestTarget = (url: string): string => {
  const match = url.match(/^\/__broker_api\/([^/]+)(\/.*)?$/);
  if (!match) return url;
  try {
    return `${decodeURIComponent(match[1])}${match[2] || ''}`;
  } catch {
    return '';
  }
};

/** Routing validation complements, and never replaces, gateway authorization. */
export const assertBrokerRequestAllowed = (url: string): void => {
  if (isDesktopBackendTarget()) return;
  const error = getBrokerConfigurationError();
  if (error) throw new Error(error);
  if (!url || !isConfiguredBrokerEndpoint(brokerRequestTarget(url), 'http')) {
    throw new Error('Broker configuration error: request does not belong to the configured deployment broker.');
  }
};
