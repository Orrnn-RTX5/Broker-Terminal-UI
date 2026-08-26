import { authV2Api } from '../api/trade';
import { persistBrokerSessionDiscovery } from '../services/brokerSession';

/**
 * Submit-only login dependencies. Keeping this module behind a dynamic import
 * lets the real login form become interactive before the API and broker-session
 * graphs are evaluated.
 */
export { authV2Api, persistBrokerSessionDiscovery };
