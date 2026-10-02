import { updateDynamicUrls } from '../config/api';

type RuntimeWindow = Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> };

/** Opt-in broker deployment for tests that exercise real routing with mocked transports. */
export function installTestBrokerRuntime(overrides: Record<string, unknown> = {}): () => void {
  const runtime = window as RuntimeWindow;
  const previous = runtime.__RTX_RUNTIME_CONFIG__;
  runtime.__RTX_RUNTIME_CONFIG__ = {
    BACKEND_TARGET: 'web',
    API_HOST: 'https://broker.example',
    WS_HOST: 'wss://broker.example',
    BROKER_ID: 'test-broker',
    DEFAULT_MT5_SERVER: 'Test-Demo',
    ...overrides,
  };
  updateDynamicUrls();
  return () => {
    if (previous === undefined) delete runtime.__RTX_RUNTIME_CONFIG__;
    else runtime.__RTX_RUNTIME_CONFIG__ = previous;
    updateDynamicUrls();
  };
}
